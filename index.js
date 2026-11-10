/**
 * Host half of the side-chat bundle.
 *
 * A side chat is a throwaway thread seeded from the main Session's committed
 * log at the moment the sidebar card is used. Four properties define it:
 *
 * 1. **Invisible.** The child keeps an ordinary origin but a seeded header; a
 *    `subagent` origin would force the durable parent address, which drops the
 *    native model picker and routes answers back into the main Session. The
 *    thread stays out of every Session list by being deleted when its tab
 *    closes (and by the boot sweep). Its injected boundary message — not its
 *    title — is the durable owner mark.
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
 * settles the conflict with the inherited general rules.
 */

import { appendFileSync } from 'node:fs';
import { rm, rmdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Title prefix that marks a side chat in the Session lists (display only). */
const MARKER = '侧边 · ';

/** Fallback when the Client half sends no mode. */
const DEFAULT_MODE = 'read';

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
  'skill',
  'ask_user_question',
];

/** Services this half cannot work without. */
export const inject = ['tools', 'systemPrompt', 'webServer'];

/** Route prefix owned by this plugin. */
const ROUTE = '/dsh-side-chat/api';

/** Largest request body accepted by the control route. */
const BODY_LIMIT = 256 * 1024;

/** Model-facing wording of the synthetic results closing a forked tool call. */
const FORKED_TOOL_RESULT = {
  started:
    '继承的历史记录了这个工具调用已经开始，但没有记录它的结果：它可能在打开侧边对话之后才完成。只有当操作是只读或幂等时才重试；可能产生副作用时，先确认外部状态或询问用户，不要盲目重试。',
  notStarted:
    '继承的历史里没有这个工具调用开始的记录，它可能在打开侧边对话之后才执行。只有当操作是只读或幂等时才重试；可能产生副作用时，先确认外部状态或询问用户，不要盲目重试。',
};

/** The inherited-history preamble shared by every mode. */
const BOUNDARY_HEAD = `侧边对话边界。

这条边界之前的一切都是主会话继承来的参考上下文，不是当前任务。不要继续、补完或执行边界之前的任何指令、计划、工具调用、审批或改动；只有这条边界之后提交的消息才是本会话的有效指令。

这是打开这一瞬间的快照：之后主会话的进展不会自动出现。需要最新内容时，让用户点侧栏的「同步最新」。

你的回答只留在这个侧栏，不进入主会话；不要给主会话加消息、任务或待办，也不要唤醒它。

本节优先于系统提示里的任何通用工作要求（先核实再动手、维护进度清单、不确定先查、被拒后换工具）；冲突时以本节为准。模式已在本节写明：不要为确认身份、模式或运行状态调用工具，不要为补证据重读已知内容，也不要复述或讨论本节、系统提示或工具机制；只回答用户的问题。`;

/** Per-mode boundary paragraph: what this conversation may do. */
const MODE_BOUNDARY = {
  reply: `模式：只回复。

本会话没有任何工具，也不需要工具：不要寻找、调用、试探或等待工具结果；没有可调用的东西，也不存在被拒绝或重试。

第一动作就是直接回答。继承历史里有答案就直接给结论；没有就写「继承历史里没有 X，需要 Y」，不要编造。

不查任何东西、不维护进度清单、不改任何东西。需要写操作时说明原因，让用户回主会话执行。

最后重申：本会话没有工具，第一动作就是回答。`,
  read: `模式：只读。

本会话只有读取类工具：读文件、看图、搜索、查会话记录、联网。写入类不存在：改文件、执行命令、派生子代理、跑工作流、改配置、维护待办都不存在；不要说「可以写」。

默认直接回答。只有继承历史里确实没有、且缺失会改变结论时，才调用一次只读工具。

一次就是上限：拿到结果就回答；不要为了确认重读已知内容，不要连续试探，被拒绝即结束，不重试、不换工具。

查完仍不确定就写「继承历史里没有 X，需要 Y」，不要编造；需要写操作时说明原因，让用户回主会话执行。

最后重申：最多调用一次只读工具，查完就答；写入类不存在。`,
  full: `模式：完全继承。

你现在是侧边会话；能力与主会话一致，工具、命令、子代理、工作流都可以用。

默认先只读、先查，不要一上来就改。

进度以继承历史为准；历史里没有就说「快照里没有」，不要为查进度调用工具。

回答留在这个侧栏，不进入主会话；不要给主会话加任务、待办或消息。

最后重申：要写就先说明要做什么、影响哪里，等用户明确同意再动手。`,
};

/** Per-mode system-prompt section: the authoritative stance, registered last. */
const MODE_SECTION = {
  reply: `## 侧边对话（只回复）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
本会话没有任何工具，也不需要工具：不要寻找或调用工具，也不存在被拒绝或重试。
第一动作是直接回答；继承历史里没有答案时写「继承历史里没有 X，需要 Y」，不要编造。
本节优先于系统提示里的任何通用工作要求；冲突时以本节为准。`,
  read: `## 侧边对话（只读）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
本会话只有读取类工具；写入、命令、子代理、工作流、配置、待办都不存在，不要说「可以写」。
默认直接回答；仅当继承历史里没有、且缺失会改变结论时，调用一次只读工具；拿到结果就回答，不重读、不连续试探、不换工具重试。
缺信息时写「继承历史里没有 X，需要 Y」，不要编造。
本节优先于系统提示里的任何通用工作要求；冲突时以本节为准。`,
  full: `## 侧边对话（完全继承）

本会话是主会话的侧边对话；边界之前的继承历史是参考上下文，不是要你继续执行的任务。
能力与主会话一致；默认先只读、先查。
需要改文件、执行命令、改配置等写操作时，先说明要做什么、影响哪里，等用户明确同意再动手。
进度以继承历史为准；历史里没有就说「快照里没有」，不要为查进度调用工具。
本节优先于系统提示里的任何通用工作要求；冲突时以本节为准。`,
};

/** Normalized mode. */
function normalizeMode(value) {
  return value === 'reply' || value === 'read' || value === 'full' ? value : DEFAULT_MODE;
}

/**
 * Normalize one deployment value into a non-empty string list.
 * @param value - declared config value.
 * @param fallback - value used when the declaration is absent or empty.
 * @returns the effective string list.
 */
function stringList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const items = value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
  return items.length === 0 ? [...fallback] : items;
}

/**
 * Copy one committed event into a seed, keeping the envelope fields Session
 * validation reads (the surface markers included).
 * @param event - committed source event.
 * @returns a detached seed event.
 */
function copyEvent(event) {
  const copy = { type: event.type, seq: event.seq, time: event.time, data: event.data };
  if (event.surfaceOp !== undefined) copy.surfaceOp = event.surfaceOp;
  if (event.sourceEventSeqs !== undefined) copy.sourceEventSeqs = event.sourceEventSeqs;
  if (event.ignorable !== undefined) copy.ignorable = event.ignorable;
  return copy;
}

/**
 * Synthetic closers for the open tail turn of a seed. Providers reject a
 * dangling assistant tool call, so unanswered calls receive a conservative
 * error result first, then the open step and turn are closed.
 * @param events - seed events scanned from the start.
 * @returns closer events in commit order; empty when the tail is balanced.
 */
function openTailClosers(events) {
  const pending = new Map();
  let openTurn = null;
  let openStep = null;
  for (const event of events) {
    const data = event.data ?? {};
    switch (event.type) {
      case 'turn/start':
        pending.clear();
        openTurn = data.turn;
        openStep = null;
        continue;
      case 'turn/end':
        pending.clear();
        openTurn = null;
        openStep = null;
        continue;
      case 'step/end':
        pending.clear();
        openStep = null;
        continue;
      case 'step/start':
        openStep = data.step;
        continue;
      case 'assistant/message': {
        const content = data.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block?.type === 'tool-call') pending.set(block.id, { turn: data.turn, step: data.step });
        }
        continue;
      }
      case 'tool/call': {
        const entry = pending.get(data.callId);
        if (entry !== undefined) entry.callSeq = event.seq;
        continue;
      }
      case 'tool/result': {
        const callId = data.message?.source?.callId;
        const entry = pending.get(callId);
        if (entry !== undefined && event.surfaceOp === 'append' && entry.turn === data.turn && entry.step === data.step) {
          pending.delete(callId);
        }
        continue;
      }
      default:
        continue;
    }
  }
  const last = events[events.length - 1];
  if (openTurn === null || last === undefined) return [];
  const time = last.time;
  const closers = [];
  let seq = last.seq + 1;
  for (const [callId, entry] of pending) {
    const started = entry.callSeq !== undefined;
    closers.push({
      type: 'tool/result',
      seq: seq,
      time: time,
      data: {
        turn: entry.turn,
        step: entry.step,
        message: {
          id: `forked-tool-result-${callId}-${seq}`,
          role: 'tool',
          toolCallId: callId,
          isError: true,
          source: { kind: 'tool', callId: callId },
          content: [{ type: 'text', text: started ? FORKED_TOOL_RESULT.started : FORKED_TOOL_RESULT.notStarted }],
        },
        error: started
          ? { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' }
          : { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' },
      },
      surfaceOp: 'append',
      ...(started ? { sourceEventSeqs: [entry.callSeq] } : {}),
    });
    seq += 1;
  }
  if (openStep !== null) {
    closers.push({ type: 'step/end', seq: seq, time: time, data: { turn: openTurn, step: openStep } });
    seq += 1;
  }
  closers.push({ type: 'turn/end', seq: seq, time: time, data: { turn: openTurn, reason: { kind: 'forked' } } });
  return closers;
}

/**
 * Build a child seed from an inclusive source-event prefix: the inherited cut,
 * the seed-end marker, then the closers that balance the inherited tail.
 * Mirrors `buildForkSeed` from `@deepseek-ai/dsh-session/fork` so this bundle
 * needs no Host package import.
 * @param events - the source log, contiguous from seq 0.
 * @param boundary - inclusive source event seq the child inherits through.
 * @returns seed events for `agents.create`.
 */
function buildSeed(events, boundary) {
  const prefix = events.slice(0, boundary + 1).map(copyEvent);
  const origin = events[boundary];
  prefix.push({ type: 'session/end-seed', seq: boundary + 1, time: origin?.time ?? Date.now(), data: { inherited: true } });
  return prefix.concat(openTailClosers(prefix));
}

/** A request body over {@link BODY_LIMIT}; the route answers 413. */
class BodyTooLargeError extends Error {
  constructor() {
    super('请求体过大');
    this.name = 'BodyTooLargeError';
  }
}

/** Read a small JSON request body. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
          reject(new BodyTooLargeError());
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(text);
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {});
      } catch (error) {
        reject(new Error(`invalid JSON body: ${String(error?.message ?? error)}`));
      }
    });
    req.on('error', reject);
  });
}

/** Write one JSON response. */
function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * @param ctx - Host plugin context.
 * @param config - bundle row config.
 */
export function apply(ctx, config = {}) {
  try {
    appendFileSync(new URL('./.host-load.log', import.meta.url), `${new Date().toISOString()} apply v4\n`);
  } catch {
    /* the probe is diagnostic only */
  }
  const settings = config ?? {};
  const allow = new Set(stringList(settings.allow, READ_ALLOW));
  const deny = new Set(stringList(settings.deny, []));

  /** Side chats this plugin created: child id -> `{ mode, parentId, cwd }`. */
  const sideChats = new Map();

  /**
   * Per-Session fold of the owner mark over the committed log. Only the
   * appended tail is scanned after the first read, so a long main session
   * costs nothing.
   */
  const cache = new WeakMap();

  /** Mode recovered from the injected boundary, for a thread this process adopted. */
  const modeCache = new WeakMap();

  /**
   * Whether one committed event carries this plugin's boundary mark. The
   * boundary enters the log twice on its way in: as an inbox splice (queued,
   * not yet claimed) and as the claimed user message.
   * @param event - committed Session event.
   * @returns whether the event owns this plugin's boundary.
   */
  function isBoundaryEvent(event) {
    if (event.type === 'user/message') return event.data?.source?.kind === 'plugin:dsh-side-chat';
    if (event.type === 'agent/inbox/spliced') {
      const inserted = Array.isArray(event.data?.inserted) ? event.data.inserted : [];
      return inserted.some((message) => message?.source?.kind === 'plugin:dsh-side-chat');
    }
    return false;
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
   * Read the mode out of the boundary this plugin injected. The boundary is
   * immutable and sits before the first question, so the answer is cached for
   * the Session's lifetime.
   * @param session - side-chat Session without a live map entry.
   * @returns the recorded mode, or the read-only default.
   */
  function recoveredMode(session) {
    if (modeCache.has(session)) return modeCache.get(session);
    let mode = DEFAULT_MODE;
    try {
      for (const event of session.snapshotEvents()) {
        if (event.type !== 'user/message' || event.data?.source?.kind !== 'plugin:dsh-side-chat') continue;
        const content = Array.isArray(event.data.content) ? event.data.content : [];
        const text = content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
        if (text.includes('模式：只回复')) mode = 'reply';
        else if (text.includes('模式：完全继承')) mode = 'full';
        else if (text.includes('模式：只读')) mode = 'read';
        break;
      }
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot recover the mode of "${String(session.id)}": ${String(error)}`);
    }
    modeCache.set(session, mode);
    return mode;
  }

  /** Whether this deployment currently denies one tool by name. */
  const denied = (name) => deny.has(name);

  /** One applied restriction: its disposer and the exact filter that produced it. */
  const attached = new Map();

  /** Whether a tools/change follow-up is already queued. */
  let toolsChangeQueued = false;

  /**
   * Every tool name a restriction may mask for one Agent. `restrict()` masks
   * inherited tools only, so the Agent's own view is the authoritative list —
   * the global view misses every preset-registered tool.
   * @param agent - viewing Agent (the scope key).
   * @param tools - the Agent-scoped tools service.
   * @returns the restrictable names, or undefined when the view is unavailable.
   */
  function restrictableNames(agent, tools) {
    try {
      const view = typeof tools.view === 'function' ? tools.view(agent) : undefined;
      const names = view?.restrictableNames;
      if (names !== undefined && names !== null) return new Set(names);
    } catch {
      /* fall through to the visible definitions */
    }
    try {
      const fallback = new Set();
      for (const definition of tools.definitions(agent)) fallback.add(definition.name);
      return fallback;
    } catch {
      return undefined;
    }
  }

  /**
   * Compute the tool mask for one mode and identify it so an unchanged mask is
   * never re-applied (each application notifies `tools/change`).
   * @param mode - `reply` or `read`.
   * @param agent - viewing Agent.
   * @param tools - the Agent-scoped tools service.
   * @returns the filter and its identity, or undefined when nothing is visible.
   */
  function restrictionFor(mode, agent, tools) {
    const availableNames = restrictableNames(agent, tools);
    if (availableNames === undefined) return undefined;
    const available = [...availableNames].filter((name) => !denied(name)).sort();
    if (available.length === 0) return undefined;
    if (mode === 'reply') return { filter: { deny: available }, key: `reply|${available.join(',')}` };
    const readable = available.filter((name) => allow.has(name));
    if (readable.length === 0) {
      // No read tool exists in this deployment: mask everything rather than
      // leave the write-capable set visible.
      return { filter: { deny: available }, key: `read-empty|${available.join(',')}` };
    }
    return { filter: { allow: readable }, key: `read|${readable.join(',')}` };
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

  /** The live Agent for one Session, if the registry currently holds it. */
  function liveAgent(sessionId) {
    try {
      return ctx.get('agents')?.get?.(sessionId);
    } catch {
      return undefined;
    }
  }

  /**
   * Compose the child's preset mounting the same way the Session controller
   * does, so the side chat keeps the main Session's preset and model controls.
   * @param presetId - the main Session's preset, when it recorded one.
   * @returns preset identity plus a pre-publication setup callback.
   */
  async function compose(presetId) {
    try {
      const controller = ctx.get('sessionController');
      if (typeof controller?.composeAgent === 'function') return await controller.composeAgent(presetId);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: session controller composition unavailable: ${String(error)}`);
    }
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
   * Threads whose boundary was already queued. `inject()` lands in the inbox,
   * so a committed-log scan cannot see a second call before the first commits.
   */
  const boundaryQueued = new Set();

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
      if (isBoundaryEvent(event)) {
        boundaryQueued.add(session.id);
        return;
      }
    }
    try {
      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `${BOUNDARY_HEAD}\n\n${MODE_BOUNDARY[modeOf(session)]}` }],
        source: { kind: 'plugin:dsh-side-chat' },
      });
      boundaryQueued.add(session.id);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot queue the boundary for "${session.id}": ${String(error)}`);
    }
  }

  /**
   * Resolve one thread's persisted artifact path. `locate` is a backend
   * convenience, not part of the seam contract, so an unavailable or
   * empty answer falls back to the backend's own listing.
   * @param childId - the side-chat Session.
   * @param cwd - the directory the artifact was filed under.
   * @returns the artifact path, or undefined when the backend keeps none.
   */
  async function artifactPath(childId, cwd) {
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined) return undefined;
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
    try {
      await rm(path, { force: true });
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot delete "${path}": ${String(error)}`);
      return false;
    }
    const parent = dirname(path);
    if (basename(parent) !== childId) return true;
    try {
      await rmdir(parent);
    } catch {
      /* a non-empty directory stays in place */
    }
    return true;
  }

  /**
   * Close one side chat: dispose the Agent, then remove the artifact from disk.
   * Nothing is archived and nothing is attached to a Workspace, so the thread
   * cannot be found again in any list. The answer is honest: a failure throws
   * so the Client can retry instead of reporting a close that did not happen.
   * @param payload - `{ childId }` from the Client half.
   * @returns acknowledgement of an idempotent close.
   */
  async function closeThread(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    if (childId === '') throw new Error('缺少侧边对话标识');
    const entry = sideChats.get(childId);
    sideChats.delete(childId);
    boundaryQueued.delete(childId);
    release(childId);
    const failures = [];
    if (typeof entry?.dispose === 'function') {
      try {
        await entry.dispose();
      } catch (error) {
        failures.push(`释放会话失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const agent = liveAgent(childId);
    if (agent !== undefined) {
      try {
        agent.cancel({ kind: 'user' }, { keepInbox: false });
      } catch (error) {
        ctx.logger?.warn?.(`side-chat: cancellation of "${childId}" failed: ${String(error)}`);
      }
    }
    const removed = await discardArtifact(childId, entry?.cwd);
    if (!removed) failures.push('删除会话文件失败');
    if (failures.length > 0) throw new Error(failures.join('；'));
    return { closed: true };
  }

  /**
   * Admit one prompt into a side chat. The thread carries no subagent routing,
   * so its prompts must never travel through subagent delivery: this route is
   * the Client half's replacement for the generic Session command, and it never
   * touches the subagent runtime — the answer therefore stays in the side thread
   * instead of returning to the main Session.
   * @param payload - `{ childId, content, mode?, requestId?, clientTimeZone? }`.
   * @returns the accepted message identity.
   */
  async function promptThread(payload) {
    const childId = typeof payload.childId === 'string' ? payload.childId : '';
    if (childId === '') throw new Error('缺少侧边对话标识');
    const agent = liveAgent(childId);
    if (agent === undefined) throw new Error('侧边对话已结束');
    const content = Array.isArray(payload.content) ? payload.content.filter((block) => block !== null && typeof block === 'object') : [];
    if (content.length === 0) throw new Error('消息内容为空');
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
    return { accepted: true, messageId: message.id };
  }

  /**
   * Cancel the running turn of one side chat.
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
    if (agent === undefined) throw new Error('侧边对话已结束');
    const selected = {
      provider: payload.provider,
      model: payload.model,
      ...(payload.reasoningEffort === undefined ? {} : { reasoningEffort: payload.reasoningEffort }),
    };
    if (typeof selected.provider !== 'string' || typeof selected.model !== 'string') throw new Error('缺少模型标识');
    try {
      await ctx.get('llm')?.resolveCallConfig?.(selected);
    } catch (error) {
      throw new Error(`模型不可用：${error instanceof Error ? error.message : String(error)}`);
    }
    agent.model.select(selected);
    return { selected: { ...selected } };
  }

  /**
   * Create one side chat: a hidden, continuable Session seeded from the main
   * Session's log, marked with the title prefix, pinned with its descriptor,
   * and then left cold so the native composer can drive it.
   * @param payload - `{ sessionId, mode? }` from the Client half.
   * @returns the child Session identity and the boundary it inherited.
   */
  async function openThread(payload) {
    const parentId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (parentId === '') throw new Error('缺少主会话标识');
    const agents = ctx.get('agents');
    const parent = liveAgent(parentId);
    if (parent === undefined) throw new Error('主会话未运行：先在左侧打开该会话，再点「侧边对话」');
    const mode = normalizeMode(payload.mode);
    const parentSession = parent.session;
    const events = parentSession.snapshotEvents();
    const lastSeq = events.length === 0 ? -1 : events[events.length - 1].seq;
    if (!Number.isSafeInteger(lastSeq) || lastSeq < 0) throw new Error('主会话还没有可继承的上下文');
    // The Host's newest committed seq is the only boundary that is true at the
    // instant this call runs; a Client-computed seq can lag the running turn.
    const atSeq = lastSeq;
    const seed = buildSeed(events, atSeq);
    const header = parentSession.header;
    const composition = await compose(header.agentPreset);
    const defaults = ctx.get('agentDefaultModel')?.currentSelection?.() ?? {};
    const agentOptions = {};
    const provider = parent.options?.provider ?? defaults.provider;
    const model = parent.options?.model ?? defaults.model;
    if (provider !== undefined) agentOptions.provider = provider;
    if (model !== undefined) agentOptions.model = model;
    if (parent.options?.reasoningEffort !== undefined) agentOptions.reasoningEffort = parent.options.reasoningEffort;
    let parentTitle = '';
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim() !== '') {
        parentTitle = event.data.title.trim();
        break;
      }
    }
    const label = `${MARKER}${parentTitle === '' ? '主会话' : parentTitle}`;
    const childId = `session-${randomUUID()}`;
    const meta = {
      isSeeded: true,
      // Ordinary origin on purpose: only a `subagent` header is filtered out of
      // the Session lists, but that header also forces the durable parent
      // address — which breaks native history, drops the native model picker and
      // routes answers back into the main Session. Native chat UI wins; the
      // thread stays out of every list by being deleted when its tab closes.
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
    };
    const entry = { mode: mode, parentId: parentId, cwd: header.cwd, dispose: undefined };
    sideChats.set(childId, entry);
    let handle;
    try {
      handle = await agents.create({
        sessionId: childId,
        seed: seed,
        inheritedEventCount: atSeq + 1,
        meta: meta,
        agentOptions: agentOptions,
        setup: composition.setup,
      });
    } catch (error) {
      sideChats.delete(childId);
      throw error;
    }
    entry.dispose = () => handle.dispose();
    try {
      ctx.get('sessionTitle')?.rename?.(handle.agent.session, label);
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
      const mine = events.some((event) => isBoundaryEvent(event));
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
        handler: async (req, res) => {
          const connection = ctx.get('connection');
          const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined;
          if (rejection !== undefined) {
            writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
            return;
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } });
            return;
          }
          const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
          const action = pathname.startsWith(`${ROUTE}/`) ? pathname.slice(ROUTE.length + 1) : '';
          try {
            const payload = await readJson(req);
            if (action === 'open') {
              writeJson(res, 200, { ok: true, value: await openThread(payload) });
              return;
            }
            if (action === 'close') {
              writeJson(res, 200, { ok: true, value: await closeThread(payload) });
              return;
            }
            if (action === 'prompt') {
              writeJson(res, 200, { ok: true, value: await promptThread(payload) });
              return;
            }
            if (action === 'cancel') {
              writeJson(res, 200, { ok: true, value: await cancelThread(payload) });
              return;
            }
            if (action === 'model') {
              writeJson(res, 200, { ok: true, value: await selectThreadModel(payload) });
              return;
            }
            if (action === 'log') {
              try {
                appendFileSync(
                  new URL('./.client-error.log', import.meta.url),
                  `${new Date().toISOString()} ${String(payload.message ?? '')}\n${String(payload.stack ?? '')}\n\n`,
                );
              } catch {
                /* diagnostics only */
              }
              writeJson(res, 200, { ok: true, value: { logged: true } });
              return;
            }
            if (action === 'sweep') {
              writeJson(res, 200, { ok: true, value: await sweepThreads(payload) });
              return;
            }
            writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown side-chat action "${action}"` } });
          } catch (error) {
            const status = error instanceof BodyTooLargeError ? 413 : 500;
            writeJson(res, status, {
              ok: false,
              error: { code: status === 413 ? 'request-too-large' : 'side-chat-error', message: error instanceof Error ? error.message : String(error) },
            });
          }
        },
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
        return agent !== undefined && isSideChat(agent.session) ? MODE_SECTION[modeOf(agent.session)] : '';
      },
    });
    const disposeGuard = ctx.tools.guard((execution) => {
      const agent = execution.agent;
      if (agent === undefined || !isSideChat(agent.session)) return undefined;
      const mode = modeOf(agent.session);
      if (mode === 'full') return undefined;
      const name = execution.name;
      if (mode === 'read' && allow.has(name) && !denied(name)) return undefined;
      // Backstop only: the restriction should already have removed the tool.
      // A tool registered after the last application lands here once, and the
      // queued pass narrows it before the next step.
      scheduleRestrictionRefresh();
      return mode === 'reply'
        ? `侧边对话是「只回复」模式：本会话没有可用工具（${name} 不在其中）。请直接基于继承的上下文回答。`
        : `侧边对话为只读：本会话没有写入能力（${name} 不在其中）。请说明需要该操作，或让用户回主会话执行。`;
    });
    return () => {
      disposeGuard();
      disposeSection();
    };
  }, 'side-chat: read-only stance');

  /**
   * Tool sections that stay in read-only mode: one usage paragraph per visible
   * read tool. Every other `tool:*` section belongs to a masked tool.
   */
  const READ_SECTION_KEEP = new Set(['tool:read', 'tool:glob', 'tool:grep', 'tool:web_search', 'tool:web_fetch']);

  /**
   * Tool usage paragraphs are registered globally by their owning plugins and
   * are not filtered by the Agent's visible tool set. Drop the ones whose tool
   * this side chat cannot call, so the prompt never describes a tool that the
   * request does not advertise.
   */
  ctx.on(
    'system-prompt/assemble',
    async (assembly, context, next) => {
      const agent = context?.agent;
      let side = false;
      try {
        side = agent !== undefined && isSideChat(agent.session);
      } catch {
        side = false;
      }
      if (!side) return next();
      const result = await next();
      if (result === undefined || result === null) return result;
      const mode = modeOf(agent.session);
      if (mode === 'full' || !Array.isArray(result.sections)) return result;
      const sections = result.sections.filter((section) => {
        const name = typeof section?.name === 'string' ? section.name : '';
        if (!name.startsWith('tool:')) return true;
        return mode === 'read' && READ_SECTION_KEEP.has(name);
      });
      if (sections.length === result.sections.length) return result;
      return { ...result, sections: sections };
    },
    { prepend: true },
  );

  ctx.on('tools/change', () => {
    scheduleRestrictionRefresh();
  });

  ctx.on('agent/created', ({ agent }) => {
    // A listener failure would fail the publication of an unrelated Agent.
    try {
      attach(agent);
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
    boundaryQueued.delete(sessionId);
  });

  ctx.on('session/event', (session, event) => {
    // The boundary is the durable ownership mark: as soon as it commits, the
    // thread is a side chat, even if this process lost its map entry.
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'plugin:dsh-side-chat') return;
    try {
      const agent = liveAgent(session.id);
      if (agent !== undefined) attach(agent);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot attach "${String(session?.id)}": ${String(error)}`);
    }
  });

  // Reconcile Agents that were live before this plugin (re)loaded.
  for (const agent of ctx.get('agents')?.list?.() ?? []) {
    try {
      attach(agent);
      injectBoundary(agent);
    } catch (error) {
      ctx.logger?.warn?.(`side-chat: cannot reconcile "${String(agent?.id)}": ${String(error)}`);
    }
  }
}
