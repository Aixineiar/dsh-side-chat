/**
 * Tool masking for the two tool-limited modes. The mask is the authority: the
 * guard only refuses what a mask could not remove, and the prompt renders the
 * closed list from the same computation.
 */

/**
 * Build the tool policy of one plugin instance.
 * @param deps - the plugin's shared state and classifiers.
 * @param deps.ctx - Host plugin context (logger and the agents registry).
 * @param deps.allow - the deployment's readable tool names.
 * @param deps.denied - whether this deployment denies one tool by name.
 * @param deps.sideChats - child id -> thread record.
 * @param deps.modeOf - the mode governing one Session.
 * @param deps.isSideChat - whether one Session is a side chat.
 * @param deps.reportUnmaskable - reports a visible tool the mask cannot reach.
 * @returns the policy functions.
 */
export function createToolPolicy(deps) {
  const { ctx, allow, denied, sideChats, modeOf, isSideChat, reportUnmaskable } = deps;

  /** One applied restriction: its disposer and the exact filter that produced it. */
  const attached = new Map();

  /** Whether a tools/change follow-up is already queued. */
  let toolsChangeQueued = false;

  /** The live Agent for one Session, if the registry currently holds it. */
  function liveAgent(sessionId) {
    try {
      return ctx.get('agents')?.get?.(sessionId);
    } catch {
      return undefined;
    }
  }

  /**
   * The Agent's own tool view: what its request advertises, and which names
   * `restrict()` may mask. A registration made through the Agent's own context
   * is visible but not restrictable, so the difference is the only set a mask
   * silently leaves behind.
   * @param agent - viewing Agent (the scope key).
   * @param tools - the Agent-scoped tools service.
   * @returns the view, or undefined when it cannot be read.
   */
  function toolViewOf(agent, tools) {
    try {
      const view = typeof tools.view === 'function' ? tools.view(agent) : undefined;
      if (view !== undefined && view !== null) return view;
    } catch {
      /* fall through to the visible definitions */
    }
    return undefined;
  }

  /**
   * Every tool name a restriction may mask for one Agent. `restrict()` masks
   * inherited tools only, so the Agent's own view is the authoritative list —
   * the global view misses every preset-registered tool.
   * @param agent - viewing Agent (the scope key).
   * @param tools - the Agent-scoped tools service.
   * @returns the restrictable names, or undefined when the view is unavailable.
   */
  function restrictableNames(agent, tools) {
    const view = toolViewOf(agent, tools);
    if (view?.restrictableNames !== undefined && view?.restrictableNames !== null) return new Set(view.restrictableNames);
    try {
      const fallback = new Set();
      for (const definition of tools.definitions(agent)) fallback.add(definition.name);
      return fallback;
    } catch {
      return undefined;
    }
  }

  /**
   * Visible names this mode cannot mask: they stay callable, so the guard must
   * refuse them and the prompt must not describe them.
   * @param view - the Agent's tool view.
   * @returns the visible-but-unrestrictable names.
   */
  function unmaskableNames(view) {
    const names = new Set();
    if (view === undefined || view.visible === undefined) return names;
    for (const name of view.visible.keys()) if (!view.restrictableNames.has(name)) names.add(name);
    return names;
  }

  /**
   * Compute the tool mask for one mode, the names it leaves callable, and its
   * identity so an unchanged mask is never re-applied (each application
   * notifies `tools/change`).
   * @param mode - `reply` or `read`.
   * @param agent - viewing Agent.
   * @param tools - the Agent-scoped tools service.
   * @returns the filter, the closed list, and the mask identity; undefined when
   *   the tool set cannot be read at all.
   */
  function restrictionFor(mode, agent, tools) {
    const availableNames = restrictableNames(agent, tools);
    if (availableNames === undefined) return undefined;
    const view = toolViewOf(agent, tools);
    const available = [...availableNames].filter((name) => !denied(name)).sort();
    const common = { unmaskable: unmaskableNames(view) };
    if (mode === 'reply') {
      return {
        ...common,
        allowed: [],
        key: `reply|${available.join(',')}`,
        ...(available.length === 0 ? {} : { filter: { deny: available } }),
      };
    }
    const readable = available.filter((name) => allow.has(name));
    if (readable.length === 0) {
      // No read tool exists in this deployment: mask everything rather than
      // leave the write-capable set visible.
      return {
        ...common,
        allowed: [],
        key: `read-empty|${available.join(',')}`,
        ...(available.length === 0 ? {} : { filter: { deny: available } }),
      };
    }
    return { ...common, allowed: readable, key: `read|${readable.join(',')}`, filter: { allow: readable } };
  }

  /**
   * The closed list one mode renders. `full` has none on purpose: it renders
   * "same capabilities as the main conversation" instead of an enumeration.
   * @param agent - viewing Agent.
   * @param mode - the thread's mode.
   * @returns the callable names, or undefined when they cannot be read.
   */
  function allowedToolsFor(agent, mode) {
    if (mode === 'full') return undefined;
    try {
      const tools = agent?.ctx?.tools;
      if (tools === undefined) return undefined;
      const plan = restrictionFor(mode, agent, tools);
      return plan === undefined ? undefined : plan.allowed;
    } catch {
      return undefined;
    }
  }

  /**
   * Narrow the advertised tool schemas for one side-chat Agent, per its mode.
   * The restriction is the authority: the guard is only a backstop for a tool
   * registered after the last application.
   * @param agent - live Agent whose Session is a side chat.
   */
  function attach(agent) {
    const session = agent?.session;
    if (session === undefined || session === null || !isSideChat(session)) return;
    const mode = modeOf(session);
    if (mode === 'full') {
      release(session.id);
      return;
    }
    let tools;
    try {
      tools = agent.ctx?.tools;
    } catch {
      // A context already inside teardown refuses service access.
      return;
    }
    if (tools === undefined) return;
    const plan = restrictionFor(mode, agent, tools);
    if (plan === undefined) return;
    // A visible tool the mask cannot reach is a half-applied mode: say so
    // instead of letting the schema advertise it.
    for (const name of plan.unmaskable) reportUnmaskable(session.id, name);
    const existing = attached.get(session.id);
    if (existing !== undefined && existing.key === plan.key) return;
    if (existing !== undefined) {
      attached.delete(session.id);
      try {
        existing.dispose();
      } catch {
        /* the owning Agent context may already be gone */
      }
    }
    if (plan.filter === undefined) return;
    try {
      const dispose = tools.restrict(plan.filter);
      attached.set(session.id, { dispose: dispose, key: plan.key });
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot restrict tools for "${String(session.id)}": ${String(error)}`);
    }
  }

  /**
   * @param sessionId - Session whose restriction is released.
   */
  function release(sessionId) {
    const entry = attached.get(sessionId);
    if (entry === undefined) return;
    attached.delete(sessionId);
    try {
      entry.dispose();
    } catch {
      /* the owning Agent context may already be gone */
    }
  }

  /**
   * Re-apply every side chat's mask after the registry changed, so a tool
   * registered later never appears in a restricted mode. `restrict()` itself
   * emits `tools/change`, hence the queued single follow-up.
   */
  function refreshRestrictions() {
    for (const sessionId of [...sideChats.keys()]) {
      const agent = liveAgent(sessionId);
      if (agent === undefined) continue;
      try {
        attach(agent);
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cannot refresh tools for "${sessionId}": ${String(error)}`);
      }
    }
  }

  /** Queue one restriction refresh; repeated requests in a tick coalesce. */
  function scheduleRestrictionRefresh() {
    if (toolsChangeQueued) return;
    toolsChangeQueued = true;
    queueMicrotask(() => {
      toolsChangeQueued = false;
      refreshRestrictions();
    });
  }

  return {
    attach: attach,
    release: release,
    refreshRestrictions: refreshRestrictions,
    scheduleRestrictionRefresh: scheduleRestrictionRefresh,
    restrictionFor: restrictionFor,
    allowedToolsFor: allowedToolsFor,
    unmaskableNames: unmaskableNames,
    toolViewOf: toolViewOf,
    restrictableNames: restrictableNames,
    liveAgent: liveAgent,
  };
}
