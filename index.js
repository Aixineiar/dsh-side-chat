/**
 * Host half of the side-chat bundle.
 *
 * A side chat is a throwaway thread seeded from the main Session's committed
 * log at the moment the sidebar card is used. Four properties define it:
 *
 * 1. **Temporary.** The child keeps an ordinary origin but a seeded header; a
 *    `subagent` origin would force the durable parent address, which drops the
 *    native model picker and routes answers back into the main Session. The
 *    thread therefore *is* a normal catalog entry while it lives — it shows up
 *    in the Session catalog under the `侧边 · ` title prefix — and stops
 *    existing when its tab closes (the tab handler disposes it and deletes its
 *    artifact) or when the boot sweep finds it orphaned. Its injected boundary
 *    message — not its title — is the durable owner mark.
 * 2. **Inherited.** The seed copies the parent log through its newest committed
 *    event (including the committed steps of a turn still running) and closes
 *    the open tail with synthetic results so providers accept it.
 * 3. **Self-driven.** The Agent stays live and every command arrives on this
 *    plugin's own route (`prompt` → `followup`/`steer`, `cancel`, `model` →
 *    `agent.model.select`). Nothing enters the subagent runtime, so a side chat
 *    never reports its answer back into the main Session.
 * 4. **Disposable.** Closing the tab disposes the Agent and deletes its
 *    persisted artifact and directory: nothing survives to recover.
 *
 * Three modes decide what the child may do:
 *   `reply` — no tools at all (every inherited tool is masked);
 *   `read`  — read-only allowlist, masked in the Agent's own tool scope;
 *   `full`  — inherited restrictions, only the side-chat stance.
 *
 * Every mode also gets a user-role boundary injection queued once before the
 * first question, and a system-prompt section registered last (order 1e6) that
 * settles the conflict with the inherited general rules. Both render themselves
 * from `prompt.js`, which is the only place a mode rule is written.
 *
 * The prompt itself is not edited from here: the hosting packages render each
 * `tool:*` paragraph against the viewing scope's tool view, so a masked tool's
 * paragraph is already empty for a restricted side chat.
 */

import { basename, dirname } from 'node:path';
import { rm, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { BOUNDARY_SOURCE, DEFAULT_MODE, DENIAL, normalizeMode, sectionText } from './prompt.js';
import { buildSeed } from './seed.js';
import { createToolPolicy } from './tools.js';
import { createRouteHandler, ERROR, ROUTE, SideChatError } from './routes.js';
import { createLifecycle } from './lifecycle.js';

/**
 * Title prefix a live side chat carries in the Session catalog and every list
 * rendered from it. Display only: ownership is proved by the injected boundary
 * message, never by this title.
 */
const MARKER = '侧边 · ';

/** Tools `read` mode may still call: workspace and conversation reading only. */
const READ_ALLOW = [
  'read',
  'read_image',
  'glob',
  'grep',
  'lsp',
  'session_search',
  'session_trace',
  'session_event_read',
  'session_event_search',
  'session_event_trace',
  'web_search',
  'web_fetch',
];

/** Services this half cannot work without. */
export const inject = ['tools', 'systemPrompt', 'webServer'];

/**
 * Read one deployment name list. A declaration that is not a list of non-empty
 * strings is refused instead of being dropped: silently falling back to the
 * default would widen the read-only boundary the operator meant to narrow.
 * @param value - declared config value.
 * @param field - config key, for the error message.
 * @param fallback - value used when the key is absent.
 * @returns the effective string list.
 */
function nameList(value, field, fallback) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new TypeError(`side-chat: config "${field}" must be a list of tool names, got ${typeof value}`);
  }
  const items = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new TypeError(`side-chat: config "${field}" must hold non-empty tool names`);
    }
    items.push(item.trim());
  }
  return items;
}

/**
 * @param ctx - Host plugin context.
 * @param config - bundle row config. A malformed `allow`/`deny` throws here, so
 *   the deployment refuses to activate instead of running with the default
 *   read-only list it never asked for.
 */
export function apply(ctx, config = {}) {
  const settings = config ?? {};
  const allow = new Set(nameList(settings.allow, 'allow', READ_ALLOW));
  const deny = new Set(nameList(settings.deny, 'deny', []));

  /** Side chats this plugin created: child id -> `{ mode, cwd, dispose }`. */
  const sideChats = new Map();

  /**
   * Per-Session fold of the owner mark over the committed log. Only the
   * appended tail is scanned after the first read, so a long main session
   * costs nothing.
   */
  const cache = new WeakMap();

  /**
   * Mode recovered from the injected boundary, for a thread this process
   * adopted. Each entry records the log length it was read at, so a guess made
   * before this thread's own boundary committed cannot outlive that commit.
   */
  const modeCache = new WeakMap();

  /**
   * The boundary payload one committed event carries. The boundary enters the
   * log twice on its way in: as an inbox splice (queued, not yet claimed) and as
   * the claimed user message.
   * @param event - committed Session event.
   * @returns the boundary source, or undefined for any other event.
   */
  function boundaryOwner(event) {
    if (event.type === 'user/message') {
      const source = event.data?.source;
      return source?.kind === BOUNDARY_SOURCE ? source : undefined;
    }
    if (event.type === 'agent/inbox/spliced') {
      const inserted = Array.isArray(event.data?.inserted) ? event.data.inserted : [];
      for (const message of inserted) if (message?.source?.kind === BOUNDARY_SOURCE) return message.source;
    }
    return undefined;
  }

  /**
   * Whether one committed event carries this plugin's boundary mark for a thread.
   * A boundary written before the mark carried its thread id can only belong to
   * the log it sits in, so it still counts for that log.
   * @param event - committed Session event.
   * @param childId - the thread the boundary must belong to; omitted for "any".
   * @returns whether the event owns this plugin's boundary.
   */
  function isBoundaryEvent(event, childId) {
    const owner = boundaryOwner(event);
    if (owner === undefined) return false;
    if (childId === undefined) return true;
    return owner.childId === undefined || owner.childId === childId;
  }

  /**
   * @param session - Session to classify.
   * @returns whether the Session is a side chat.
   */
  function isSideChat(session) {
    if (session === undefined || session === null) return false;
    if (sideChats.has(session.id)) return true;
    // A side chat is always seeded, and the boundary message this plugin
    // injected is its durable, unforgeable owner mark. A user Session renamed
    // with the title marker therefore never matches: the title is display only.
    if (session.header?.isSeeded !== true) return false;
    const cached = cache.get(session);
    if (cached !== undefined && cached.seq === session.seq) return cached.owned;
    let owned = cached !== undefined && cached.owned === true;
    if (!owned) {
      try {
        for (const event of session.snapshotEvents(cached === undefined ? 0 : cached.seq)) {
          if (isBoundaryEvent(event)) {
            owned = true;
            break;
          }
        }
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot read the log of "${String(session.id)}": ${String(error)}`);
      }
    }
    cache.set(session, { seq: session.seq, owned: owned });
    return owned;
  }

  /**
   * The mode governing one Session; unknown Sessions fall back to read-only.
   * A thread this process did not create (a plugin reload during its lifetime)
   * recovers its mode from the boundary message it carries.
   * @param session - Session to inspect.
   * @returns `reply`, `read`, or `full`.
   */
  function modeOf(session) {
    const entry = session === undefined ? undefined : sideChats.get(session.id);
    if (entry !== undefined) return entry.mode;
    if (session === undefined || session === null || !isSideChat(session)) return DEFAULT_MODE;
    return recoveredMode(session);
  }

  /**
   * Read the mode out of the boundary this plugin injected. This thread's own
   * boundary wins over one inherited from a parent side chat — a nested side
   * chat copies its parent's log, mode message included. A mark written before
   * the boundary carried its thread id cannot be attributed from its content
   * alone, so it speaks for the log only when it is the log's single mark;
   * several of them are ambiguous, and the read-only default is the safe answer
   * instead of a guessed mode that would then govern the tool mask. The answer
   * is remembered per log length: a mark that is not this thread's own must not
   * survive a later commit of this thread's own boundary.
   * @param session - side-chat Session without a live map entry.
   * @returns the recorded mode, or the read-only default.
   */
  function recoveredMode(session) {
    const cached = modeCache.get(session);
    if (cached !== undefined && cached.seq === session.seq) return cached.mode;
    let own;
    let inherited;
    let marks = 0;
    let unattributed = 0;
    try {
      for (const event of session.snapshotEvents()) {
        const owner = boundaryOwner(event);
        if (owner === undefined) continue;
        marks += 1;
        const recorded = modeNamedBy(owner, event);
        if (owner.childId === session.id) {
          own = recorded;
          if (own !== undefined) break;
        } else if (owner.childId === undefined) {
          if (inherited === undefined) inherited = recorded;
          unattributed += 1;
        }
      }
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot recover the mode of "${String(session.id)}": ${String(error)}`);
    }
    // Only a log whose every mark is unattributed has one candidate owner.
    const guess = unattributed <= 1 && marks === unattributed ? inherited : undefined;
    const mode = own ?? guess ?? DEFAULT_MODE;
    modeCache.set(session, { seq: session.seq, mode: mode });
    return mode;
  }

  /**
   * @param owner - the boundary source one event carries.
   * @param event - the event that carried it.
   * @returns the mode the boundary records, or undefined when it records none.
   */
  function modeNamedBy(owner, event) {
    if (owner.mode === 'reply' || owner.mode === 'read' || owner.mode === 'full') return owner.mode;
    if (event.type !== 'user/message') return undefined;
    const content = Array.isArray(event.data.content) ? event.data.content : [];
    const text = content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
    if (text.includes('模式：只回复')) return 'reply';
    if (text.includes('模式：完全继承')) return 'full';
    if (text.includes('模式：只读')) return 'read';
    return undefined;
  }

  /** Whether this deployment currently denies one tool by name. */
  const denied = (name) => deny.has(name);

  /** Unmaskable tools already reported, so one deployment is not logged per call. */
  const reportedUnmaskable = new Set();

  /**
   * Record one visible tool this mode cannot mask. Silently half-applying a mode
   * is the failure this reports, so it is error level and de-duplicated per tool.
   * @param sessionId - the side chat whose Agent owns the tool.
   * @param name - the visible tool name.
   */
  function reportUnmaskable(sessionId, name) {
    const key = `${sessionId}|${name}`;
    if (reportedUnmaskable.has(key)) return;
    reportedUnmaskable.add(key);
    const log = ctx.logger?.error ?? ctx.logger?.warn;
    log?.(
      `side-chat: tool "${name}" is registered inside the side-chat Agent's own scope, which restrict() cannot mask; the guard denies it for "${sessionId}".`,
    );
  }

  /**
   * Drop every unmaskable report of one closed thread, so a page that opens and
   * closes thousands of threads does not keep one entry per (thread, tool).
   * @param sessionId - the side chat that no longer exists.
   */
  function forgetUnmaskable(sessionId) {
    const prefix = `${sessionId}|`;
    for (const key of reportedUnmaskable) if (key.startsWith(prefix)) reportedUnmaskable.delete(key);
  }

  const policy = createToolPolicy({ ctx, allow, denied, sideChats, modeOf, isSideChat, reportUnmaskable });
  const { attach, release, restrictionFor, allowedToolsFor, liveAgent, scheduleRestrictionRefresh } = policy;

  const lifecycle = createLifecycle({
    ctx,
    sideChats,
    isSideChat,
    modeOf,
    isBoundaryEvent,
    allowedToolsFor,
    attach,
    release,
    liveAgent,
    scheduleRestrictionRefresh,
    forgetUnmaskable,
  });
  const readQuota = lifecycle.readQuota;
  const currentStepKey = lifecycle.currentStepKey;
  const injectBoundary = lifecycle.injectBoundary;
  const forget = lifecycle.forget;

  /**
   * The preset the main Session runs now. `header.agentPreset` is frozen at
   * creation, so the preset registry's projection is the only current answer;
   * `null` means "no preset recorded" and is passed on as `undefined`.
   * @param session - the main Session.
   * @returns the preset id, or undefined when the Session records none.
   */
  function currentPresetOf(session) {
    try {
      const presets = ctx.get('agentPresets');
      if (typeof presets?.presetForSession === 'function') {
        const value = presets.presetForSession(session);
        return value === null ? undefined : value;
      }
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot read the preset of "${String(session?.id)}": ${String(error)}`);
    }
    return session?.header?.agentPreset;
  }

  /**
   * Compose the child's preset the way the Session controller's own agent
   * controller does: resolve the id, then mount it into the new Agent's context
   * before publication. The controller's `composeAgent` helper is not part of
   * the `sessionController` service (it lives on its internal agent
   * controller), so this is the same two steps performed locally.
   * @param presetId - the main Session's preset, when it recorded one.
   * @returns preset identity plus a pre-publication setup callback.
   */
  async function compose(presetId) {
    try {
      const presets = ctx.get('agentPresets');
      if (presets !== undefined) {
        const resolved = await presets.resolve(presetId);
        return {
          agentPreset: resolved.id,
          setup: async (agentCtx) => {
            await presets.mount(agentCtx, resolved.id);
          },
        };
      }
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: preset composition unavailable: ${String(error)}`);
    }
    return { setup: () => undefined };
  }

  /**
   * Resolve one thread's persisted artifact path. `stat()` is the contract
   * member that reports the artifact this process actually stored, so it is
   * asked first; `locate()` is a backend convenience that computes the path
   * without touching the filesystem, and `list()` is the last resort because it
   * enumerates every stored Session.
   * @param childId - the side-chat Session.
   * @param cwd - the directory the artifact was filed under.
   * @returns the artifact path, or undefined when the backend keeps none.
   */
  async function artifactPath(childId, cwd) {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) return undefined;
    try {
      const snapshot = await persistence.stat?.(childId);
      const path = snapshot?.location?.path;
      if (typeof path === 'string' && path !== '') return path;
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot stat the artifact of "${childId}": ${String(error)}`);
    }
    try {
      const located = persistence.locate?.({ id: childId, ...(cwd === undefined ? {} : { cwd: cwd }) });
      if (typeof located?.path === 'string' && located.path !== '') return located.path;
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot locate the artifact of "${childId}": ${String(error)}`);
    }
    try {
      const snapshots = (await persistence.list?.()) ?? [];
      for (const snapshot of snapshots) {
        if (snapshot?.header?.id !== childId) continue;
        const path = snapshot?.location?.path;
        if (typeof path === 'string' && path !== '') return path;
      }
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot list artifacts for "${childId}": ${String(error)}`);
    }
    return undefined;
  }

  /**
   * Delete one thread's persisted artifact and the directory that held it, so a
   * closed side chat leaves nothing to recover.
   * @param childId - the side-chat Session.
   * @param cwd - the directory the artifact was filed under.
   * @returns whether the artifact is gone.
   */
  async function discardArtifact(childId, cwd) {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) return true;
    let path;
    try {
      path = await artifactPath(childId, cwd);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot resolve the artifact of "${childId}": ${String(error)}`);
      return false;
    }
    if (path === undefined) return true;
    // The backend files one Session per directory named after it, so a path that
    // does not match that shape is not this thread's artifact and is left alone.
    if (basename(dirname(path)) !== childId) {
      ctx.logger?.warn?.(`side-chat: refusing to delete "${path}": it is not filed under "${childId}"`);
      return false;
    }
    try {
      await rm(path, { force: true });
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot delete "${path}": ${String(error)}`);
      return false;
    }
    const parent = dirname(path);
    try {
      await rmdir(parent);
    } catch {
      /* a non-empty directory stays in place */
    }
    return true;
  }

  /**
   * Whether one Session is a thread this plugin owns. A live Agent answers by its
   * own durable mark; an adopted or resumed thread answers from its committed
   * log, with the same test `sweepThreads` uses.
   * @param childId - the Session id a control action names.
   * @returns whether this plugin may dispose and delete it.
   */
  async function ownsThread(childId) {
    if (sideChats.has(childId)) return true;
    const agent = liveAgent(childId);
    if (agent !== undefined) {
      try {
        if (isSideChat(agent.session)) return true;
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot classify "${childId}": ${String(error)}`);
      }
    }
    const query = ctx.get('sessionQuery');
    if (typeof query?.observeSession !== 'function') return false;
    let observation;
    try {
      observation = await query.observeSession(childId);
      const events = Array.isArray(observation?.events) ? observation.events : [];
      return events.some((event) => isBoundaryEvent(event, childId));
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot read "${childId}" for ownership: ${String(error)}`);
      return false;
    } finally {
      try {
        observation?.[Symbol.dispose]?.();
      } catch {
        /* the observation is best-effort */
      }
    }
  }

  /**
   * Close one side chat: prove the Session is a thread this plugin owns, dispose
   * the Agent, then remove the artifact from disk. Nothing is archived and
   * nothing is attached to a Workspace, so the thread cannot be found again in
   * any list. The answer is honest: a refused close names the code, a failed
   * dispose keeps its teardown handle (so the retry can still finish) and leaves
   * the log on disk.
   * @param payload - `{ childId }` from the Client half.
   * @returns acknowledgement of an idempotent close, or a refusal with its code.
   */
  async function closeThread(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    if (childId === '') throw new SideChatError(ERROR.badRequest, 'childId is required', { field: 'childId' });
    if (!(await ownsThread(childId))) return { closed: false, reason: ERROR.notOwned };
    const entry = sideChats.get(childId);
    const live = liveAgent(childId);
    const disposer =
      typeof entry?.dispose === 'function' ? entry.dispose : live === undefined ? undefined : () => live.dispose();
    if (disposer !== undefined) {
      try {
        await disposer();
      } catch (error) {
        // Keep the map entry: the Client retries, and the retry needs a handle.
        throw new SideChatError(ERROR.io, `dispose failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    sideChats.delete(childId);
    forget(childId);
    release(childId);
    forgetUnmaskable(childId);
    const remaining = liveAgent(childId);
    if (remaining !== undefined) {
      try {
        remaining.cancel({ kind: 'user' }, { keepInbox: false });
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cancellation of "${childId}" failed: ${String(error)}`);
      }
    }
    const removed = await discardArtifact(childId, entry?.cwd ?? remaining?.session?.header?.cwd);
    if (!removed) throw new SideChatError(ERROR.io, 'artifact deletion failed', { childId: childId });
    return { closed: true };
  }

  /** The largest single text block the control route accepts from the composer. */
  const MAX_TEXT_CHARS = 200_000;

  /** The largest number of content blocks the control route accepts in one prompt. */
  const MAX_BLOCKS = 64;

  /**
   * Validate one prompt block against the Host's wire `PromptContentPart` shape.
   * The generic Session command validates this with its own schema; a block that
   * reaches the log malformed makes the Session unreadable on replay, so nothing
   * outside the three known shapes is persisted.
   * @param block - one candidate block from the composer.
   * @returns the admitted block, or undefined when the shape is not accepted.
   */
  function admittedBlock(block) {
    if (block === null || typeof block !== 'object') return undefined;
    if (block.type === 'text') {
      if (typeof block.text !== 'string' || block.text.length > MAX_TEXT_CHARS) return undefined;
      return { type: 'text', text: block.text };
    }
    // An attachment already promoted to its durable reference by a Host-aware
    // caller is the only attachment form this route may persist: an encoded
    // image or an upload receipt must be admitted by the Host first, and this
    // route has no upload session to admit against.
    if ((block.type === 'image' || block.type === 'file') && block.attachment !== null && typeof block.attachment === 'object') {
      return { type: block.type, attachment: block.attachment };
    }
    return undefined;
  }

  /**
   * Admit one prompt into a side chat. The thread carries no subagent routing,
   * so its prompts must never travel through subagent delivery: this route is
   * the Client half's replacement for the generic Session command, and it never
   * touches the subagent runtime — the answer therefore stays in the side thread
   * instead of returning to the main Session.
   * @param payload - `{ childId, content, mode?, requestId?, clientTimeZone? }`.
   * @returns the accepted message identity and how many blocks were dropped.
   */
  async function promptThread(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    if (childId === '') throw new SideChatError(ERROR.badRequest, 'childId is required', { field: 'childId' });
    const agent = liveAgent(childId);
    if (agent === undefined) throw new SideChatError(ERROR.agentGone, 'the side chat has no live agent', { childId: childId });
    const declared = Array.isArray(payload.content) ? payload.content : [];
    const raw = declared.slice(0, MAX_BLOCKS);
    const content = [];
    let dropped = declared.length - raw.length;
    for (const block of raw) {
      const admitted = admittedBlock(block);
      if (admitted === undefined) dropped += 1;
      else content.push(admitted);
    }
    if (content.length === 0) {
      throw new SideChatError(ERROR.badRequest, 'no acceptable content block', { dropped: dropped });
    }
    if (dropped > 0) {
      ctx.logger?.warn?.(`side-chat: dropped ${dropped} unsupported content block(s) for "${childId}"`);
    }
    const message = {
      id: randomUUID(),
      role: 'user',
      content: content,
      source: {
        kind: 'user',
        ...(typeof payload.requestId === 'string' ? { rpcId: payload.requestId } : {}),
        ...(typeof payload.clientTimeZone === 'string' ? { clientTimeZone: payload.clientTimeZone } : {}),
      },
    };
    if (payload.mode === 'steer') agent.steer(message);
    else agent.followup(message);
    return { accepted: true, messageId: message.id, dropped: dropped };
  }

  /**
   * Cancel the running turn of one side chat. Cancellation is idempotent: a
   * thread that already finished has nothing left to stop.
   * @param payload - `{ childId }`.
   * @returns acknowledgement.
   */
  async function cancelThread(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    const agent = childId === '' ? undefined : liveAgent(childId);
    if (agent !== undefined) agent.cancel({ kind: 'user' }, { keepInbox: true });
    return { accepted: true };
  }

  /**
   * Record one model selection on a side chat, without touching the deployment
   * default: the thread is temporary and must not rewrite global settings.
   * @param payload - `{ childId, provider, model, reasoningEffort? }`.
   * @returns the selection recorded for the thread.
   */
  async function selectThreadModel(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    const agent = childId === '' ? undefined : liveAgent(childId);
    const selected = {
      provider: payload.provider,
      model: payload.model,
      ...(payload.reasoningEffort === undefined ? {} : { reasoningEffort: payload.reasoningEffort }),
    };
    if (typeof selected.provider !== 'string' || typeof selected.model !== 'string') {
      throw new SideChatError(ERROR.badRequest, 'provider and model are required', { field: 'model' });
    }
    if (agent === undefined) throw new SideChatError(ERROR.agentGone, 'the side chat has no live agent', { childId: childId });
    try {
      await ctx.get('llm')?.resolveCallConfig?.(selected);
    } catch (error) {
      throw new SideChatError(ERROR.badRequest, `model unavailable: ${error instanceof Error ? error.message : String(error)}`, {
        provider: selected.provider,
        model: selected.model,
      });
    }
    agent.model.select(selected);
    return { selected: { ...selected } };
  }

  /**
   * The model selection a child inherits: the parent Agent's live choice, else
   * the deployment default. The side chat never writes either of them back.
   * @param parent - the main Session's Agent.
   * @returns the `agentOptions` for `agents.create`.
   */
  function inheritedAgentOptions(parent) {
    const defaults = ctx.get('agentDefaultModel')?.currentSelection?.() ?? {};
    const options = {};
    const provider = parent.options?.provider ?? defaults.provider;
    const model = parent.options?.model ?? defaults.model;
    if (provider !== undefined) options.provider = provider;
    if (model !== undefined) options.model = model;
    if (parent.options?.reasoningEffort !== undefined) options.reasoningEffort = parent.options.reasoningEffort;
    return options;
  }

  /**
   * The newest committed title of one Session log.
   * @param events - the log, oldest first.
   * @returns the title, or an empty string when the log records none.
   */
  function resolveTitle(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim() !== '') {
        return event.data.title.trim();
      }
    }
    return '';
  }

  /**
   * The child Session header. The ordinary origin is deliberate: only a
   * `subagent` header is filtered out of the Session lists, but that header also
   * forces the durable parent address — which breaks native history, drops the
   * native model picker and routes answers back into the main Session. Native
   * chat UI wins; the thread disappears by being deleted, not by being hidden.
   * @param header - the main Session's header.
   * @param composition - the composed preset identity.
   * @returns the header fields `agents.create` accepts.
   */
  function childMeta(header, composition) {
    return {
      isSeeded: true,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
    };
  }

  /**
   * Create one side chat: a continuable Session seeded from the main Session's
   * log, titled with the marker, and left cold so the native composer can drive
   * it through this plugin's own route.
   * @param payload - `{ sessionId, mode? }` from the Client half.
   * @returns the child Session identity and the boundary it inherited.
   */
  async function openThread(payload) {
    const parentId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (parentId === '') throw new SideChatError(ERROR.badRequest, 'sessionId is required', { field: 'sessionId' });
    const parent = liveAgent(parentId);
    if (parent === undefined) {
      throw new SideChatError(ERROR.agentGone, 'the main session is not running', { sessionId: parentId });
    }
    const mode = normalizeMode(payload.mode);
    const parentSession = parent.session;
    const events = parentSession.snapshotEvents();
    // The Host's newest committed seq is the only boundary that is true at the
    // instant this call runs; a Client-computed seq can lag the running turn.
    const atSeq = events.length === 0 ? -1 : events[events.length - 1].seq;
    if (!Number.isSafeInteger(atSeq) || atSeq < 0) {
      throw new SideChatError(ERROR.noContext, 'the main session has no committed event to inherit', { sessionId: parentId });
    }
    const composition = await compose(currentPresetOf(parentSession));
    const parentTitle = resolveTitle(events);
    const childId = `session-${randomUUID()}`;
    const entry = { mode: mode, cwd: parentSession.header.cwd, dispose: undefined };
    sideChats.set(childId, entry);
    let handle;
    try {
      handle = await ctx.get('agents').create({
        sessionId: childId,
        seed: buildSeed(events, atSeq, mode),
        inheritedEventCount: atSeq + 1,
        meta: childMeta(parentSession.header, composition),
        agentOptions: inheritedAgentOptions(parent),
        setup: composition.setup,
      });
    } catch (error) {
      sideChats.delete(childId);
      throw error;
    }
    entry.dispose = () => handle.dispose();
    try {
      ctx.get('sessionTitle')?.rename?.(handle.agent.session, `${MARKER}${parentTitle === '' ? '主会话' : parentTitle}`);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot pin "${childId}": ${String(error)}`);
    }
    attach(handle.agent);
    // The Agent stays live: its prompts, cancellation and model choice all go
    // through this plugin's own route, so nothing reaches the parent Session and
    // nothing enters the subagent runtime.
    injectBoundary(handle.agent);
    return { childId: childId, atSeq: atSeq, mode: mode, label: parentTitle === '' ? '主会话' : parentTitle };
  }

  /**
   * Delete the artifacts this plugin owns and nobody owns any more:
   * - `stale` (sent by the Client when a page boots): every seeded side chat
   *   without a live Agent, which is what a crash or a reload leaves behind;
   * - otherwise: archived seeded side chats, which older builds parked in the
   *   archived list instead of deleting them.
   * The seeded header and the injected boundary are both required, so a user
   * Session that happens to be renamed with the title marker is never deleted.
   * @param payload - `{ stale?: boolean }`.
   * @returns the number of artifacts removed.
   */
  async function sweepThreads(payload = {}) {
    const persistence = ctx.get('sessionPersistence');
    const registry = ctx.get('workspaceRegistry');
    const archived = new Set(registry?.archivedSessionIds ?? []);
    const stale = payload?.stale === true;
    if (!stale && archived.size === 0) return { removed: 0 };
    const query = ctx.get('sessionQuery');
    const snapshots = (await persistence?.list?.()) ?? [];
    let removed = 0;
    for (const snapshot of snapshots) {
      const id = snapshot?.header?.id;
      if (typeof id !== 'string') continue;
      if (snapshot.header.isSeeded !== true) continue;
      if (liveAgent(id) !== undefined || sideChats.has(id)) continue;
      const owns = archived.has(id);
      if (!stale && !owns) continue;
      let events = [];
      let observation;
      try {
        observation = await query?.observeSession?.(id);
        events = Array.isArray(observation?.events) ? observation.events : [];
      } catch {
        continue;
      } finally {
        try {
          observation?.[Symbol.dispose]?.();
        } catch {
          /* the observation is best-effort */
        }
      }
      const mine = events.some((event) => isBoundaryEvent(event, id));
      if (!mine) continue;
      if (await discardArtifact(id, snapshot.header.cwd)) removed += 1;
      if (owns) {
        try {
          await registry?.unarchiveSession?.(id);
        } catch {
          /* a dangling archived id is harmless */
        }
      }
    }
    return { removed: removed };
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: createRouteHandler(ctx, {
          open: openThread,
          close: closeThread,
          prompt: promptThread,
          cancel: cancelThread,
          model: selectThreadModel,
          sweep: sweepThreads,
        }),
      }),
    'side-chat: control route',
  );

  ctx.effect(() => {
    const disposeSection = ctx.systemPrompt.section({
      name: 'side-chat:policy',
      // The mode section must be the last word in the assembled prompt: the
      // inherited general rules follow every ordinary section, and only a
      // later section can settle the conflict. 1e6 stays above the shipped
      // persona suffix (10200).
      order: 1e6,
      text: (context) => {
        const agent = context?.agent;
        if (agent === undefined || !isSideChat(agent.session)) return '';
        const mode = modeOf(agent.session);
        return sectionText(mode, allowedToolsFor(agent, mode));
      },
    });
    const disposeGuard = ctx.tools.guard((execution) => {
      const agent = execution.agent;
      if (agent === undefined || !isSideChat(agent.session)) return undefined;
      const session = agent.session;
      const mode = modeOf(session);
      if (mode === 'full') return undefined;
      const name = execution.name;
      let tools;
      try {
        tools = agent.ctx?.tools;
      } catch {
        /* a context inside teardown refuses service access */
        return undefined;
      }
      const plan = tools === undefined ? undefined : restrictionFor(mode, agent, tools);
      // The closed list is the guard's authority, so a mask that could not be
      // applied never turns into a silent allow.
      if (plan === undefined) return DENIAL.unreadable(mode);
      if (plan.unmaskable.has(name)) {
        reportUnmaskable(session.id, name);
        return DENIAL.unmaskable(name);
      }
      if (!plan.allowed.includes(name)) {
        // Backstop only: the restriction should already have removed the tool.
        scheduleRestrictionRefresh();
        return DENIAL.denied(mode, name);
      }
      const key = currentStepKey(session);
      const used = readQuota.get(session.id);
      const count = used !== undefined && used.key === key ? used.count : 0;
      if (count >= 1) return DENIAL.quota;
      readQuota.set(session.id, { key: key, count: count + 1 });
      return undefined;
    });
    return () => {
      disposeGuard();
      disposeSection();
    };
  }, 'side-chat: read-only stance');

  // Tool paragraphs are deliberately not edited here. Every hosting package
  // renders its `tool:*` section against the viewing scope's tool view
  // (`text: ({ scope }) => ctx.tools.get(name, scope) === undefined ? '' : …`),
  // so a masked tool's paragraph is already empty for a restricted side chat.
  // Rewriting `system-prompt/assemble` on top of that would delete other
  // plugins' contributions for no gain, which the Host's extension-point rule
  // forbids.

  lifecycle.install();
}
