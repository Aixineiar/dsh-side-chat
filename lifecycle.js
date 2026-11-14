/**
 * Thread lifecycle: the boundary injection, the read quota's step tracking, the
 * adoption of a thread that survived a plugin reload, and the event wiring.
 */

import { randomUUID } from 'node:crypto';

import { BOUNDARY_SOURCE, SWITCH_SOURCE, boundaryText, switchText } from './prompt.js';

/**
 * Install the lifecycle of one plugin instance.
 * @param deps - the plugin's shared state and classifiers.
 * @param deps.ctx - Host plugin context.
 * @param deps.sideChats - child id -> thread record.
 * @param deps.isSideChat - whether one Session is a side chat.
 * @param deps.modeOf - the mode governing one Session.
 * @param deps.isBoundaryEvent - whether one event carries a thread's boundary.
 * @param deps.allowedToolsFor - the closed list one mode renders.
 * @param deps.attach - applies one thread's tool mask.
 * @param deps.release - lifts one thread's tool mask.
 * @param deps.liveAgent - the live Agent for one Session.
 * @param deps.forgetUnmaskable - drops the per-thread unmaskable reports.
 * @returns the lifecycle state and installation entry point.
 */
export function createLifecycle(deps) {
  const { ctx, sideChats, isSideChat, modeOf, isBoundaryEvent, allowedToolsFor, attach, release, liveAgent } = deps;
  const forgetUnmaskable = deps.forgetUnmaskable ?? (() => undefined);

  /**
   * Threads whose boundary was already queued. `inject()` lands in the inbox,
   * so a committed-log scan cannot see a second call before the first commits.
   */
  const boundaryQueued = new Set();

  /**
   * Read-mode quota: the model step each thread already spent its one read call
   * in. `step/start` moves the thread to a new step, which restores the quota;
   * parallel calls inside one step share the entry, so the second one is denied.
   */
  const readQuota = new Map();

  /** Current `turn:step` per Session, tracked from committed step events. */
  const stepKeys = new WeakMap();

  /**
   * Track the committed step of one Session, so the read quota is per step.
   * @param session - Session the event belongs to.
   * @param event - committed Session event.
   */
  function trackStep(session, event) {
    const data = event.data ?? {};
    if (event.type === 'turn/start') stepKeys.set(session, `${data.turn ?? 0}:0`);
    else if (event.type === 'step/start') stepKeys.set(session, `${data.turn ?? 0}:${data.step ?? 0}`);
  }

  /**
   * @param session - Session whose step governs the current tool call.
   * @returns the step identity; an unobserved step shares one key on purpose.
   */
  function currentStepKey(session) {
    return stepKeys.get(session) ?? '0:0';
  }

  /**
   * Queue one mode's own explanation as a user-role context injection. This is
   * the message that carries the owner mark and the recorded mode, so it is also
   * what a reload recovers the thread's mode from — and the last one in the log
   * is the one that governs.
   * @param agent - side-chat Agent.
   * @param mode - the mode the explanation describes.
   */
  function queueExplanation(agent, mode) {
    const session = agent.session;
    agent.inject({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: boundaryText(mode, allowedToolsFor(agent, mode)) }],
      // The thread id and mode travel with the mark: a nested side chat copies
      // its parent's log, so a boundary that names its own thread is the only
      // one an "already injected" scan may accept.
      source: { kind: BOUNDARY_SOURCE, childId: session.id, mode: mode },
    });
  }

  /**
   * Queue the mode's boundary as a user-role context injection, exactly once
   * per thread. It lands in `next-step`, which the opening step claims before
   * the waking user message — so the boundary is the freshest instruction.
   * @param agent - side-chat Agent about to run its first turn.
   */
  function injectBoundary(agent) {
    const session = agent?.session;
    if (session === undefined || !sideChats.has(session.id)) return;
    if (boundaryQueued.has(session.id)) return;
    let events;
    try {
      events = session.snapshotEvents();
    } catch {
      return;
    }
    for (const event of events) {
      if (isBoundaryEvent(event, session.id)) {
        boundaryQueued.add(session.id);
        return;
      }
    }
    try {
      queueExplanation(agent, modeOf(session));
      boundaryQueued.add(session.id);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot queue the boundary for "${session.id}": ${String(error)}`);
    }
  }

  /**
   * Queue the pair a switch writes: the one-line notice, then the new mode's own
   * explanation — in that order, because both are claimed by the same step and
   * only the later one may define the mode.
   * @param agent - the live side-chat Agent.
   * @param from - the mode being left.
   * @param to - the mode being entered.
   * @returns whether the pair was queued.
   */
  function injectSwitch(agent, from, to) {
    const session = agent?.session;
    if (session === undefined || session === null) return false;
    if (from === to) return false;
    try {
      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: switchText(from, to) }],
        source: { kind: SWITCH_SOURCE, childId: session.id, mode: to },
      });
      queueExplanation(agent, to);
      // The thread now carries an explanation a reload must not add to.
      boundaryQueued.add(session.id);
      return true;
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot queue the mode switch for "${session.id}": ${String(error)}`);
      return false;
    }
  }

  /**
   * Take over one side chat this process did not create — a plugin reload during
   * its lifetime leaves the Agent alive but the map empty. Adoption re-applies
   * the mask and records a teardown handle, so closing the tab can still dispose
   * the thread instead of deleting its log from under a live Agent.
   * @param agent - a live Agent.
   */
  function adopt(agent) {
    const session = agent?.session;
    if (session === undefined || session === null) return;
    attach(agent);
    if (sideChats.has(session.id)) return;
    if (!isSideChat(session)) return;
    sideChats.set(session.id, {
      mode: modeOf(session),
      cwd: session.header?.cwd,
      dispose: () => agent.dispose(),
    });
    ctx.logger?.warn?.(`side-chat: adopted the thread "${String(session.id)}" after a plugin reload`);
  }

  /** Register the event handlers and adopt the Agents that outlived a reload. */
  function install() {
    ctx.on('tools/change', () => {
      deps.scheduleRestrictionRefresh();
    });

    ctx.on('agent/created', ({ agent }) => {
      // A listener failure would fail the publication of an unrelated Agent.
      try {
        adopt(agent);
        // A cold-resumed side chat publishes its Agent right before the waking
        // prompt is delivered, so the boundary still lands first.
        injectBoundary(agent);
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot prepare "${String(agent?.id)}": ${String(error)}`);
      }
    });

    ctx.on('agent/disposed', ({ agent }) => {
      const sessionId = agent?.session?.id ?? agent?.id;
      if (sessionId === undefined) return;
      release(sessionId);
      forgetUnmaskable(sessionId);
      boundaryQueued.delete(sessionId);
      readQuota.delete(sessionId);
    });

    ctx.on('session/event', (session, event) => {
      // Steps bound the read quota, so they are tracked even before the boundary
      // commits: the first read call of a thread already belongs to a step.
      if (event.type === 'step/start' || event.type === 'turn/start') {
        try {
          if (isSideChat(session)) trackStep(session, event);
        } catch {
          /* an unreadable log never breaks the dispatch of the event */
        }
      }
      // The boundary is the durable ownership mark: as soon as it commits, the
      // thread is a side chat, even if this process lost its map entry.
      if (event.type !== 'user/message' || event.data?.source?.kind !== BOUNDARY_SOURCE) return;
      try {
        const agent = liveAgent(session.id);
        if (agent !== undefined) attach(agent);
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot attach "${String(session?.id)}": ${String(error)}`);
      }
    });

    // Reconcile Agents that were live before this plugin (re)loaded. A side chat
    // keeps running across the reload, so it is adopted — with a teardown handle —
    // instead of being left with a mask it can no longer update.
    for (const agent of ctx.get('agents')?.list?.() ?? []) {
      try {
        adopt(agent);
        injectBoundary(agent);
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot reconcile "${String(agent?.id)}": ${String(error)}`);
      }
    }
  }

  /** Drop one closed thread's quota entry. */
  function forget(sessionId) {
    boundaryQueued.delete(sessionId);
    readQuota.delete(sessionId);
  }

  return {
    boundaryQueued: boundaryQueued,
    readQuota: readQuota,
    currentStepKey: currentStepKey,
    injectBoundary: injectBoundary,
    injectSwitch: injectSwitch,
    adopt: adopt,
    forget: forget,
    install: install,
  };
}
