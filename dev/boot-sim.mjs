/**
 * Local boot simulation for both halves of the side-chat bundle.
 *
 * The Client half boots under `dev/harness.mjs` (browser stubs plus a scripted
 * route) and reports the first throw from `apply`. The Host half loads under a
 * stubbed context that records the tool mask, the injected boundary, the
 * system-prompt section, the seed, and the route answers, then asserts:
 * the closed list a prompt renders is the list the mask leaves callable, no
 * visible tool escapes the mask, the seed keeps every envelope field of the
 * source events, a malformed prompt never reaches the log, and every refusal
 * leaves the route with a stable code. Diagnostic only: no Host package is
 * imported.
 */

import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { bootClient } from './harness.mjs';

/** Boot the Client half once: a throwing entry fails the whole web boot. */
const client = await bootClient();
console.log('client exports:', Object.keys(client.exports));
console.log(
  `client captured: resources=${client.captured.resources.length} tab-types=${client.captured.tabs.length} style-tags=${client.captured.styles.length}`,
);

/* ------------------------------------------------------------------ *
 * Host half
 * ------------------------------------------------------------------ */

const ROUTE = '/dsh-side-chat/api';

/** A shipped deployment's tool surface: read-side tools plus write-side tools. */
const TOOL_NAMES = [
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
  'write',
  'edit',
  'apply_patch',
  'pwsh',
  'subagent',
  'workflow',
  'todo_write',
  'ask_user_question',
  'skill',
];

/*
 * Tool paragraphs are not part of this half's contract any more: the hosting
 * packages render each `tool:*` section against the viewing scope's tool view,
 * so a masked tool's paragraph is already empty. The simulation asserts that no
 * `system-prompt/assemble` listener is registered at all, instead of comparing
 * a local section table with the host's names.
 */

/** A main Session whose newest turn still holds an unanswered tool call. */
function danglingEvents() {
  return [
    { type: 'session/start', seq: 0, time: 1, data: {}, surfaceOp: 'append' },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 0 }, surfaceOp: 'append' },
    { type: 'step/start', seq: 2, time: 3, data: { turn: 0, step: 0 }, surfaceOp: 'append' },
    {
      type: 'assistant/message',
      seq: 3,
      time: 4,
      data: {
        turn: 0,
        step: 0,
        message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'pwsh' }] },
      },
      surfaceOp: 'append',
    },
    { type: 'tool/call', seq: 4, time: 5, data: { turn: 0, step: 0, callId: 'call-1' }, surfaceOp: 'append' },
  ];
}

const CLOSED_PREFIX = '本会话可用工具（封闭名单）：';

/** One committed Session: an id, a header, and an append-only log. */
function makeSession(id, header, events) {
  return {
    id: id,
    header: header,
    seq: events.length === 0 ? 0 : events[events.length - 1].seq + 1,
    snapshotEvents(from = 0) {
      return events.filter((event) => event.seq >= from);
    },
  };
}

/** A tool registry shaped like `dsh-tools`: own registrations are visible only. */
function makeTools(globalNames, ownNames) {
  const restrictCalls = [];
  return {
    restrictCalls: restrictCalls,
    view() {
      const visible = new Map();
      for (const name of globalNames) visible.set(name, { name: name });
      for (const name of ownNames) visible.set(name, { name: name });
      return {
        visible: visible,
        registrations: new Map(),
        knownNames: new Set(visible.keys()),
        restrictableNames: new Set(globalNames),
      };
    },
    definitions() {
      return [...globalNames, ...ownNames].map((name) => ({ name: name }));
    },
    restrict(filter) {
      restrictCalls.push(filter);
      return () => undefined;
    },
  };
}

/** Source events of the main Session, envelope fields included. */
function parentEvents() {
  return [
    { type: 'session/start', seq: 0, time: 1, data: {}, surfaceOp: 'append', originSeq: 0 },
    { type: 'turn/start', seq: 1, time: 2, data: { turn: 0 }, surfaceOp: 'append' },
    {
      type: 'user/message',
      seq: 2,
      time: 3,
      data: { id: 'main-1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
  ];
}

/**
 * Build one Host context, apply the plugin, open one side chat.
 * @param mode - the side chat's mode.
 * @param options - fixture switches (`ownTools`, `sessionPreset`).
 * @returns the recorded state of the run.
 */
async function openMode(hostExports, mode, options = {}) {
  const state = {
    injected: [],
    sections: [],
    guards: [],
    listeners: {},
    route: undefined,
    seeds: [],
    disposed: 0,
    follows: [],
    steers: [],
    logs: { warn: [], error: [] },
  };
  const agentsById = new Map();
  const childTools = makeTools(TOOL_NAMES, options.ownTools ?? []);
  const parentTools = makeTools(TOOL_NAMES, []);
  const persistence = {
    /** Ids passed to `stat()`: the contract member the close path must prefer. */
    statCalls: [],
    /** Metadata passed to the backend-only `locate()` helper. */
    locateCalls: [],
    /** How often the close path fell back to a full listing. */
    listCalls: 0,
    async stat(id) {
      persistence.statCalls.push(id);
      return {
        header: { id: id },
        location: { kind: 'jsonl', path: join(tmpdir(), 'dsh-side-chat-sim', String(id), 'log.jsonl') },
      };
    },
    locate(meta) {
      persistence.locateCalls.push(meta);
      return { path: join(tmpdir(), 'dsh-side-chat-sim', String(meta.id), 'log.jsonl') };
    },
    async list() {
      persistence.listCalls += 1;
      return [];
    },
  };
  const agents = {
    get(id) {
      return agentsById.get(id);
    },
    list() {
      return [...agentsById.values()];
    },
    async create(createOptions) {
      const childId = createOptions.sessionId;
      const childSession = makeSession(childId, { id: childId, ...createOptions.meta }, []);
      let disposeFailures = options.disposeFails ?? 0;
      const disposeOnce = async () => {
        if (disposeFailures > 0) {
          disposeFailures -= 1;
          throw new Error('simulated dispose failure');
        }
        state.disposed += 1;
        agentsById.delete(childId);
      };
      const child = {
        id: childId,
        session: childSession,
        options: createOptions.agentOptions ?? {},
        ctx: { tools: childTools },
        inject(input) {
          state.injected.push(input);
        },
        followup(input) {
          state.followed = input;
          state.follows.push(input);
        },
        steer(input) {
          state.steered = input;
          state.steers.push(input);
        },
        cancel() {},
        model: { select(selection) { state.selected = selection; } },
        dispose: disposeOnce,
      };
      agentsById.set(childId, child);
      state.seeds.push(createOptions.seed);
      state.child = child;
      return { agent: child, dispose: disposeOnce };
    },
  };
  const parentSession = makeSession(
    'session-main',
    { id: 'session-main', cwd: 'D:\\work', agentPreset: 'header-preset' },
    typeof options.events === 'function' ? options.events() : parentEvents(),
  );
  state.sourceEvents = parentSession.snapshotEvents();
  const parent = {
    id: 'session-main',
    session: parentSession,
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    ctx: { tools: parentTools },
  };
  agentsById.set('session-main', parent);

  // A plugin reload leaves the thread live but the map empty: the fixture seeds
  // that state before `apply` runs.
  if (options.adopted === true) {
    const adoptedId = 'session-adopted';
    // Default: one old-format mark (`{kind}` only) with no mode recorded, which
    // is what a log written by the previous build looks like. `adoptedMarks`
    // replaces it so the recovery rules can be exercised directly.
    const marks = options.adoptedMarks ?? [{ text: 'reloaded boundary' }];
    const adoptedEvents = marks.map((mark, index) => ({
      type: 'user/message',
      seq: index,
      time: index + 1,
      data: {
        id: `boundary-${index}`,
        role: 'user',
        content: [{ type: 'text', text: mark.text }],
        source: {
          kind: 'plugin:dsh-side-chat',
          ...(mark.childId === undefined ? {} : { childId: mark.childId }),
          ...(mark.mode === undefined ? {} : { mode: mark.mode }),
        },
      },
      surfaceOp: 'append',
    }));
    const adoptedTools = makeTools(TOOL_NAMES, []);
    const adoptedAgent = {
      id: adoptedId,
      session: makeSession(adoptedId, { id: adoptedId, isSeeded: true, cwd: 'D:\\work' }, adoptedEvents),
      ctx: { tools: adoptedTools },
      cancel() {},
      async dispose() {
        state.disposed += 1;
        agentsById.delete(adoptedId);
      },
    };
    agentsById.set(adoptedId, adoptedAgent);
    state.adopted = { id: adoptedId, tools: adoptedTools, agent: adoptedAgent };
  }

  // A side chat opened from another side chat inherits its parent's boundary:
  // that mark names the parent thread, so it must not suppress this one's own.
  if (options.nested === true) {
    const nestedId = 'session-nested';
    const inheritedBoundary = {
      type: 'user/message',
      seq: 0,
      time: 1,
      data: {
        id: 'parent-boundary',
        role: 'user',
        content: [{ type: 'text', text: '父线程的边界' }],
        source: { kind: 'plugin:dsh-side-chat', childId: 'session-parent-side', mode: 'full' },
      },
      surfaceOp: 'append',
    };
    const nestedTools = makeTools(TOOL_NAMES, []);
    const nestedAgent = {
      id: nestedId,
      session: makeSession(nestedId, { id: nestedId, isSeeded: true, cwd: 'D:\\work' }, [inheritedBoundary]),
      ctx: { tools: nestedTools },
      inject(input) {
        state.injected.push(input);
      },
      cancel() {},
      async dispose() {
        state.disposed += 1;
        agentsById.delete(nestedId);
      },
    };
    agentsById.set(nestedId, nestedAgent);
    state.nested = { id: nestedId, tools: nestedTools, agent: nestedAgent };
  }

  const services = {
    agents: agents,
    // The controller's own composition helpers are *not* part of the
    // `sessionController` service in the shipped host; the fixture still offers
    // them (recording) so a regression that calls them again fails here.
    sessionController: {
      composeCalls: 0,
      presetCalls: 0,
      async composeAgent(presetId) {
        services.sessionController.composeCalls += 1;
        return { agentPreset: presetId ?? 'default-preset', setup: () => undefined };
      },
      presetForSession() {
        services.sessionController.presetCalls += 1;
        return 'controller-preset';
      },
    },
    agentPresets: {
      presetForSession: () => options.sessionPreset ?? null,
      resolve: async (id) => ({ id: id ?? 'default-preset' }),
      mount: async () => undefined,
    },
    sessionPersistence: persistence,
    sessionQuery: { observeSession: async () => ({ events: [] }) },
    workspaceRegistry: { archivedSessionIds: [] },
    connection: { requestRejection: () => undefined },
    llm: { resolveCallConfig: async () => ({}) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    sessionTitle: { rename: async () => undefined },
  };
  const ctx = {
    effect(fn) {
      const disposer = fn();
      return () => {
        if (typeof disposer === 'function') disposer();
      };
    },
    on(name, fn) {
      (state.listeners[name] ??= []).push(fn);
      return () => undefined;
    },
    get(name) {
      return services[name];
    },
    logger: {
      warn(message) {
        state.logs.warn.push(String(message));
      },
      error(message) {
        state.logs.error.push(String(message));
      },
      info() {},
    },
    tools: {
      guard(fn) {
        state.guards.push(fn);
        return () => undefined;
      },
    },
    systemPrompt: {
      section(definition) {
        state.sections.push(definition);
        return () => undefined;
      },
    },
    webServer: {
      register(registration) {
        state.route = registration.handler;
        return () => undefined;
      },
    },
  };
  hostExports.apply(ctx, options.config ?? {});
  state.ctx = ctx;
  state.childTools = childTools;
  state.parent = parent;
  state.persistence = persistence;

  const envelope = await callRoute(state, 'open', { sessionId: 'session-main', mode: mode });
  state.open = envelope;
  return state;
}

/** Invoke the registered route handler with one JSON body. */
async function callRoute(state, action, payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
  req.method = 'POST';
  req.url = `${ROUTE}/${action}`;
  let status;
  let body;
  const res = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(text) {
      body = text;
    },
  };
  await state.route(req, res);
  return { status: status, envelope: body === undefined ? undefined : JSON.parse(body) };
}

/** The closed list one prompt text renders, or undefined when it renders none. */
function closedList(text) {
  const index = text.indexOf(CLOSED_PREFIX);
  if (index < 0) return undefined;
  const rest = text.slice(index + CLOSED_PREFIX.length);
  const end = rest.search(/[。\n]/);
  const value = (end < 0 ? rest : rest.slice(0, end)).trim();
  return value === '无' ? [] : value.split('、').sort();
}

/** The names one applied mask leaves callable; undefined when nothing was masked. */
function allowedByMask(restrictCalls) {
  const filter = restrictCalls[restrictCalls.length - 1];
  if (filter === undefined) return undefined;
  return filter.allow === undefined ? [] : [...filter.allow].sort();
}

const promptUrl = new URL('../prompt.js', import.meta.url).href;
const promptTable = await import(promptUrl);
const hostUrl = new URL('../index.js', import.meta.url).href;
const hostExports = await import(hostUrl);
console.log('host exports:', Object.keys(hostExports));
console.log('prompt exports:', Object.keys(promptTable));

const checks = [];
function check(ok, message) {
  checks.push({ ok: ok === true, message: message });
}

/** Set by any failure that is not an assertion, so the process exits non-zero. */
let failed = false;

const exportsArg = process.argv.indexOf('--export');
const exportPath = exportsArg >= 0 ? process.argv[exportsArg + 1] : undefined;
const dump = {};

for (const mode of ['reply', 'read', 'full']) {
  const state = await openMode(hostExports, mode);
  const boundary = state.injected[0]?.content?.[0]?.text ?? '';
  const sectionDefinition = state.sections.find((definition) => definition.name === 'side-chat:policy');
  const sectionText = sectionDefinition === undefined ? '' : sectionDefinition.text({ agent: state.child });
  const allowed = allowedByMask(state.childTools.restrictCalls);
  const rendered = closedList(boundary);
  const renderedSection = closedList(sectionText);

  check(state.open?.envelope?.ok === true, `${mode}: /open answers ok`);
  check(boundary !== '', `${mode}: a boundary is injected`);
  check(sectionText !== '', `${mode}: the policy section renders text`);

  if (mode === 'full') {
    check(rendered === undefined, `${mode}: no closed list is rendered`);
    check(renderedSection === undefined, `${mode}: the system section renders no closed list`);
    check(allowed === undefined, `${mode}: no tool mask is applied`);
    check(sectionText.includes('能力与主会话一致'), `${mode}: the section states the inherited capability`);
  } else {
    check(rendered !== undefined, `${mode}: the boundary renders a closed list`);
    check(renderedSection !== undefined, `${mode}: the system section renders a closed list`);
    check(
      JSON.stringify(rendered) === JSON.stringify(allowed ?? []),
      `${mode}: the rendered closed list equals the applied mask (${JSON.stringify(rendered)} vs ${JSON.stringify(allowed ?? [])})`,
    );
    check(
      JSON.stringify(renderedSection) === JSON.stringify(rendered),
      `${mode}: the system section agrees with the boundary (${JSON.stringify(renderedSection)} vs ${JSON.stringify(rendered)})`,
    );
  }

  // The prompt is not rewritten from this plugin: the hosting packages already
  // render each `tool:*` section against the viewing scope's tool view, and the
  // controller's own composition helpers are not part of its service.
  check(
    (state.listeners['system-prompt/assemble'] ?? []).length === 0,
    `${mode}: no system-prompt/assemble listener is registered`,
  );
  check(state.ctx.get('sessionController').composeCalls === 0, `${mode}: the controller's composeAgent is not used`);
  check(state.ctx.get('sessionController').presetCalls === 0, `${mode}: the controller's presetForSession is not used`);

  // No visible tool may escape the mask.
  const view = state.childTools.view();
  const escapable = [...view.visible.keys()].filter((name) => !view.restrictableNames.has(name));
  check(escapable.length === 0, `${mode}: every visible tool is maskable (${escapable.join(', ') || 'none left'})`);

  // The seed keeps every envelope field of every source event it copied.
  const seed = state.seeds[0] ?? [];
  (state.sourceEvents ?? parentEvents()).forEach((event, index) => {
    const seedEvent = seed[index] ?? {};
    for (const key of Object.keys(event)) {
      check(Object.keys(seedEvent).includes(key), `${mode}: the seed keeps the envelope field "${key}" of event ${index}`);
    }
  });

  // The boundary mark names its own thread and records the mode (D7-#6).
  const mark = state.injected[0]?.source ?? {};
  check(mark.childId === state.child.id, `${mode}: the boundary mark names its own thread`);
  check(mark.mode === mode, `${mode}: the boundary mark records the mode (${String(mark.mode)})`);

  // The modification rules ride the same generator (D3-#8).
  if (mode === 'full') {
    check(boundary.includes('在本侧边会话执行，还是回主会话执行'), 'full: the boundary asks where the plan runs');
    check(boundary.includes('修改建议 · 待主会话执行'), 'full: the boundary carries the suggestion block');
  } else {
    check(boundary.includes('本会话不执行修改任务'), `${mode}: the boundary refuses the modification`);
    check(boundary.includes('修改建议 · 待主会话执行'), `${mode}: the boundary carries the suggestion block`);
  }

  // The shared head is split per mode: tool limits never reach `full` (D3-#2).
  const toolLimit = '不要为确认身份、模式或运行状态调用工具';
  const rereadLimit = '不要为补证据重读已知内容';
  if (mode === 'full') {
    check(!boundary.includes(toolLimit) && !sectionText.includes(toolLimit), 'full: no tool-identity prohibition');
    check(!boundary.includes(rereadLimit) && !sectionText.includes(rereadLimit), 'full: no re-read prohibition');
    check(!boundary.includes('不要为查进度调用工具') && !sectionText.includes('不要为查进度调用工具'), 'full: no progress prohibition');
  } else {
    check(boundary.includes(toolLimit), `${mode}: the tool limits stay in the boundary`);
    check(!sectionText.includes('能力与主会话一致'), `${mode}: the section claims no inherited capability`);
  }

  // The read threshold is one sentence, and the banned quote is gone (D3-#3).
  const threshold = '只有继承历史里确实没有、且缺失会改变结论时';
  if (mode === 'read') {
    check(boundary.includes(threshold) && sectionText.includes(threshold), 'read: both texts share one threshold sentence');
    check(!boundary.includes('可以写') && !sectionText.includes('可以写'), 'read: the banned quote is gone');
  }
  if (mode === 'reply') {
    check(!boundary.includes('不存在被拒绝或重试') && !sectionText.includes('不存在被拒绝或重试'), 'reply: no denied/retry claim');
    check(
      boundary.includes('没有工具通道') &&
        boundary.includes('不会有结果、错误或拒绝说明回到你这里') &&
        boundary.includes('在回答里说明你需要它做什么'),
      'reply: the empty channel, the missing feedback and the alternative are all stated',
    );
  }

  // The system section keeps the four facts (D3-#6).
  for (const fact of ['参考上下文', '快照', '只留在这个侧栏', '冲突时以本节为准']) {
    check(sectionText.includes(fact), `${mode}: the section states "${fact}"`);
  }

  dump[mode] = {
    closedList: rendered,
    maskAllowed: allowed,
    boundary: boundary,
    section: sectionText,
  };
}

// An Agent-scope registration cannot be masked: it is reported, refused by the
// guard, and never named in a prompt.
const shadowed = await openMode(hostExports, 'reply', { ownTools: ['dummy_agent_tool'] });
const shadowName = 'dummy_agent_tool';
const shadowBoundary = shadowed.injected[0]?.content?.[0]?.text ?? '';
const shadowGuard = shadowed.guards[0];
const shadowVerdict = shadowGuard === undefined ? undefined : shadowGuard({ agent: shadowed.child, name: shadowName });
check(shadowVerdict !== undefined, 'agent-scope: the guard refuses an unmaskable tool');
check(!shadowBoundary.includes(shadowName), 'agent-scope: the boundary omits the unmaskable tool');
check(
  shadowed.logs.error.some((line) => line.includes(shadowName)),
  'agent-scope: the unmaskable tool is reported at error level',
);
dump.agentScope = { guard: shadowVerdict ?? null, reported: shadowed.logs.error };

// The preset comes from the projection, not from the frozen creation header.
const projected = await openMode(hostExports, 'read', { sessionPreset: 'projected-preset' });
check(
  projected.child.session.header.agentPreset === 'projected-preset',
  `preset: the projection wins over the header (got "${String(projected.child.session.header.agentPreset)}")`,
);
const unselected = await openMode(hostExports, 'read', { sessionPreset: null });
check(
  unselected.child.session.header.agentPreset === 'default-preset',
  `preset: a null projection is passed on as undefined (got "${String(unselected.child.session.header.agentPreset)}")`,
);
dump.preset = {
  projected: projected.child.session.header.agentPreset ?? null,
  unselected: unselected.child.session.header.agentPreset ?? null,
};

// Ownership: a control action may only touch a thread this plugin owns.
const foreignRun = await openMode(hostExports, 'read');
const foreign = await callRoute(foreignRun, 'close', { childId: 'session-main' });
check(
  foreign.envelope?.ok === true && foreign.envelope.value.closed === false,
  `close: a foreign Session is refused (${JSON.stringify(foreign.envelope)})`,
);
check(
  foreign.envelope?.value?.reason === 'side-chat/not-owned',
  `close: the refusal carries a stable code (${String(foreign.envelope?.value?.reason)})`,
);
check(foreignRun.persistence.statCalls.length === 0, 'close: a refused close touches no artifact');

const ownedRun = await openMode(hostExports, 'read');
const ownedId = ownedRun.open.envelope.value.childId;
const ownedClose = await callRoute(ownedRun, 'close', { childId: ownedId });
check(
  ownedClose.envelope?.ok === true && ownedClose.envelope.value.closed === true,
  `close: an owned thread closes (${JSON.stringify(ownedClose.envelope)})`,
);
check(ownedRun.persistence.statCalls.includes(ownedId), 'close: the artifact is resolved through stat()');
check(ownedRun.persistence.listCalls === 0, 'close: a close never falls back to a full listing');

// A dispose that fails keeps its handle and leaves the log alone.
const retryRun = await openMode(hostExports, 'read', { disposeFails: 1 });
const retryId = retryRun.open.envelope.value.childId;
const firstClose = await callRoute(retryRun, 'close', { childId: retryId });
check(
  firstClose.envelope?.ok === false && firstClose.envelope?.error?.code === 'side-chat/io',
  `close: a failed dispose is reported as retryable io (${JSON.stringify(firstClose.envelope)})`,
);
check(retryRun.persistence.statCalls.length === 0, 'close: a failed dispose leaves the artifact alone');
const secondClose = await callRoute(retryRun, 'close', { childId: retryId });
check(
  secondClose.envelope?.ok === true && secondClose.envelope.value.closed === true,
  `close: the retry still has a teardown handle (${JSON.stringify(secondClose.envelope)})`,
);
dump.close = { foreign: foreign.envelope, owned: ownedClose.envelope, first: firstClose.envelope, second: secondClose.envelope };

// A malformed control request answers with a 4xx and its own code, so the Client
// can tell "do not retry" from "retry later".
const badRequest = await callRoute(ownedRun, 'close', {});
check(
  badRequest.status === 400 && badRequest.envelope?.error?.code === 'side-chat/bad-request',
  `route: a missing id answers 400 (${badRequest.status} ${JSON.stringify(badRequest.envelope)})`,
);
const unknownAction = await callRoute(ownedRun, 'nope', {});
check(
  unknownAction.status === 404 && unknownAction.envelope?.error?.code === 'side-chat/not-found',
  `route: an unknown action answers 404 (${unknownAction.status})`,
);
dump.route = { badRequest: badRequest.envelope, unknownAction: unknownAction.envelope };

// A thread that survived a plugin reload is adopted with a teardown handle.
const adoptedRun = await openMode(hostExports, 'read', { adopted: true });
check(adoptedRun.adopted.tools.restrictCalls.length > 0, 'adopt: the adopted thread is masked again');
check(
  adoptedRun.logs.warn.some((line) => line.includes('adopted')),
  'adopt: the adoption is reported on the log',
);
const adoptedClose = await callRoute(adoptedRun, 'close', { childId: adoptedRun.adopted.id });
check(
  adoptedClose.envelope?.ok === true && adoptedClose.envelope.value.closed === true,
  `adopt: the adopted thread closes (${JSON.stringify(adoptedClose.envelope)})`,
);
check(adoptedRun.disposed === 1, `adopt: closing disposes the Agent (${adoptedRun.disposed})`);
dump.adopt = { closed: adoptedClose.envelope, disposed: adoptedRun.disposed };

// Mode recovery from an old-format log (a mark without `childId`): one such mark
// still speaks for the log, two of them name two candidate owners and must not
// be guessed — the read-only default is the safe answer.
const oldMarkFull = await openMode(hostExports, 'read', {
  adopted: true,
  adoptedMarks: [{ text: '模式：完全继承。\n\n边界之前的继承历史是参考上下文。' }],
});
check(
  oldMarkFull.adopted.tools.restrictCalls.length === 0,
  `recovered: a single old-format mark is honoured (full leaves the mask alone, ${oldMarkFull.adopted.tools.restrictCalls.length})`,
);
check(
  oldMarkFull.logs.warn.some((line) => line.includes('adopted')),
  'recovered: the old-format thread is still adopted',
);

const ambiguousMarks = await openMode(hostExports, 'read', {
  adopted: true,
  adoptedMarks: [{ text: '模式：完全继承。' }, { text: '模式：只回复。' }],
});
const ambiguousMask = allowedByMask(ambiguousMarks.adopted.tools.restrictCalls) ?? [];
check(
  ambiguousMarks.adopted.tools.restrictCalls.length > 0 && ambiguousMask.length > 0,
  `recovered: two unattributed marks are ambiguous and fall back to the read-only default (${JSON.stringify(ambiguousMask)})`,
);
dump.recovered = {
  singleOldMarkRestricts: oldMarkFull.adopted.tools.restrictCalls.length,
  ambiguousMask: ambiguousMask,
};

// A nested side chat gets its own boundary even though its log carries the
// parent thread's mark.
const nestedRun = await openMode(hostExports, 'read', { nested: true });
const nestedMarks = nestedRun.injected.filter((mark) => mark.source?.childId === nestedRun.nested.id);
check(nestedMarks.length === 1, `nested: an inherited mark does not suppress this thread's own (${nestedMarks.length})`);
check(
  nestedRun.injected.some((mark) => mark.source?.childId === 'session-parent-side') === false,
  'nested: no second mark is written for the parent thread',
);
dump.nested = { ownMarks: nestedMarks.length };

// The read quota is enforced by the guard, per step, not by the prompt.
const quotaRun = await openMode(hostExports, 'read');
const quotaGuard = quotaRun.guards[0];
const quotaChild = quotaRun.child;
const firstRead = quotaGuard({ agent: quotaChild, name: 'read' });
const secondRead = quotaGuard({ agent: quotaChild, name: 'read' });
const writeAttempt = quotaGuard({ agent: quotaChild, name: 'write' });
check(firstRead === undefined, 'quota: the first read call of a step is allowed');
check(
  typeof secondRead === 'string' && secondRead.includes('只读配额已用完'),
  `quota: a second read call in the same step is refused (${String(secondRead)})`,
);
check(
  typeof writeAttempt === 'string' && writeAttempt.includes('不在本会话的只读名单里'),
  `quota: a write tool is refused by the closed list (${String(writeAttempt)})`,
);
// The host renders a guard reason as a single text block: `Error: <reason>`
// with `isError` (`dsh-tools/lib/pipeline.js:404-418`). A reason that already
// carried a prefix, or held a newline, would break that shape.
for (const pair of [['quota', secondRead], ['closed list', writeAttempt]]) {
  const label = pair[0];
  const text = typeof pair[1] === 'string' ? pair[1] : '';
  check(text.startsWith('拒绝说明：'), `${label}: the guard returns the documented denial sentence`);
  check(!text.startsWith('Error:') && !text.includes('\n'), `${label}: the reason carries no prefix and no newline of its own`);
  check((`Error: ${text}`.match(/Error: /g) ?? []).length === 1, `${label}: the host render keeps exactly one "Error:" prefix`);
}
for (const listener of quotaRun.listeners['session/event'] ?? []) {
  listener(quotaChild.session, { type: 'step/start', seq: 5, time: 6, data: { turn: 0, step: 1 } });
}
const nextStepRead = quotaGuard({ agent: quotaChild, name: 'read' });
check(nextStepRead === undefined, `quota: a new step restores the quota (${String(nextStepRead)})`);
dump.quota = { second: secondRead, write: writeAttempt, nextStep: nextStepRead ?? null };

// The synthetic result closing an unanswered call is mode-scoped: only `full`
// offers the retry guidance (D3-#5).
for (const mode of ['reply', 'read', 'full']) {
  const danglingRun = await openMode(hostExports, mode, { events: danglingEvents });
  const closer = (danglingRun.seeds[0] ?? []).find((event) => event.type === 'tool/result');
  const text = closer?.data?.message?.content?.[0]?.text ?? '';
  check(text !== '', `${mode}: an unanswered tool call is closed by a synthetic result`);
  if (mode === 'full') {
    check(text.includes('只有当操作是只读或幂等时才重试'), 'full: the retry guidance is kept');
  } else {
    check(!text.includes('只有当操作是只读或幂等时才重试'), `${mode}: no retry permission leaks into the log`);
    check(text.includes('按「结果未知」处理'), `${mode}: the synthetic result stays neutral`);
  }
  dump[`synthetic-${mode}`] = text;
}

// The rendered text must agree with the harness, not only with itself: a reply
// thread must not promise a denial no code path can deliver, the quota must be
// described as per step, the closed list must be declared a snapshot, and every
// mode must forbid writing a call into the answer body.
const FORM_PROHIBITION = '不要把调用、参数或调用标记写进回答正文';
for (const mode of ['reply', 'read', 'full']) {
  check(dump[mode].boundary.includes(FORM_PROHIBITION), `${mode}: the boundary forbids a call written as prose`);
  check(dump[mode].section.includes(FORM_PROHIBITION), `${mode}: the section forbids a call written as prose`);
}
check(!dump.reply.boundary.includes('你会收到一条拒绝说明'), 'reply: the boundary promises no denial');
check(!dump.reply.section.includes('你会收到一条拒绝说明'), 'reply: the section promises no denial');
check(dump.reply.boundary.includes('没有工具通道'), 'reply: the empty channel is stated as a fact');
check(!dump.read.boundary.includes('一次就是上限'), 'read: the quota is not overstated as a single cap');
check(
  dump.read.boundary.includes('每一步') && dump.read.section.includes('每一步'),
  'read: both surfaces name the step as the quota unit',
);
check(
  dump.reply.boundary.includes('名单是打开这一刻的快照') &&
    dump.read.boundary.includes('名单是打开这一刻的快照') &&
    dump.read.section.includes('名单是打开这一刻的快照'),
  'reply/read: the closed list itself is declared a snapshot',
);
check(!dump.read.boundary.includes('不要点名'), 'read: the prompt no longer forbids naming a tool');
check(dump.read.boundary.includes('已移除'), 'read: a tool-removal record is accounted for');
check(
  ['unknown tool', 'timed out', '[sandbox:', '重复同一个调用'].every((needle) => dump.read.boundary.includes(needle)),
  'read: the four host refusals share one stop rule',
);

// A malformed content block never reaches the log: the generic Session command
// validates its prompt with a schema, and this route must not be the hole.
const promptRun = await openMode(hostExports, 'read');
const promptId = promptRun.open.envelope.value.childId;
const validPrompt = await callRoute(promptRun, 'prompt', {
  childId: promptId,
  content: [{ type: 'text', text: 'hello' }],
});
check(
  validPrompt.envelope?.ok === true && promptRun.follows.length === 1,
  `prompt: a text block is accepted (${JSON.stringify(validPrompt.envelope)})`,
);
check(promptRun.follows[0]?.content?.[0]?.text === 'hello', 'prompt: the admitted block keeps its text');

const wireImage = await callRoute(promptRun, 'prompt', {
  childId: promptId,
  content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }],
});
check(
  wireImage.status === 400 && wireImage.envelope?.error?.code === 'side-chat/bad-request' && promptRun.follows.length === 1,
  `prompt: an unadmitted attachment is refused and never queued (${wireImage.status} ${JSON.stringify(wireImage.envelope)})`,
);

const mixedPrompt = await callRoute(promptRun, 'prompt', {
  childId: promptId,
  content: [{ type: 'text', text: 'keep me' }, { foo: 1 }, { type: 'text', text: 7 }],
});
check(
  mixedPrompt.envelope?.ok === true && mixedPrompt.envelope.value.dropped === 2 && promptRun.follows.length === 2,
  `prompt: only the valid blocks are queued, the rest counted (${JSON.stringify(mixedPrompt.envelope)})`,
);
check(promptRun.follows[1]?.content?.length === 1, 'prompt: a dropped block is not persisted');

const unknownThread = await callRoute(promptRun, 'prompt', { childId: 'session-nope', content: [{ type: 'text', text: 'x' }] });
check(
  unknownThread.status === 409 && unknownThread.envelope?.error?.code === 'side-chat/agent-gone',
  `prompt: an ended thread answers 409 (${unknownThread.status})`,
);
dump.prompt = { valid: validPrompt.envelope, image: wireImage.envelope, mixed: mixedPrompt.envelope };

// A malformed deployment config refuses activation instead of silently running
// with the default allowlist.
async function configRefusal(config) {
  try {
    await openMode(hostExports, 'read', { config: config });
    return undefined;
  } catch (error) {
    return error;
  }
}
const allowString = await configRefusal({ allow: 'read' });
check(
  allowString instanceof TypeError && String(allowString.message).includes('allow'),
  `config: a string allowlist refuses activation (${allowString === undefined ? 'accepted' : allowString.message})`,
);
const denyNumber = await configRefusal({ deny: [1] });
check(
  denyNumber instanceof TypeError && String(denyNumber.message).includes('deny'),
  `config: a non-string deny entry refuses activation (${denyNumber === undefined ? 'accepted' : denyNumber.message})`,
);
check(
  (await configRefusal({ allow: ['read'], deny: ['web_search'] })) === undefined,
  'config: a well-formed declaration still applies',
);

// The mode set exists once per half because the Client loader cannot import the
// Host's module; this cross-check fails as soon as the two drift apart.
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const modesMatch = /const MODES = \[([^\]]*)\]/.exec(clientSource);
const clientModes =
  modesMatch === null
    ? []
    : modesMatch[1]
        .split(',')
        .map((value) => value.trim().replace(/^'/, '').replace(/'$/, ''))
        .filter((value) => value !== '');
check(
  JSON.stringify(clientModes) === JSON.stringify([...promptTable.MODE_IDS]),
  `modes: the Client list equals the Host's (${JSON.stringify(clientModes)} vs ${JSON.stringify([...promptTable.MODE_IDS])})`,
);
const defaultMatch = /MODES\.indexOf\(value\) >= 0 \? value : '([^']+)'/.exec(clientSource);
check(
  defaultMatch !== null && defaultMatch[1] === promptTable.DEFAULT_MODE,
  `modes: the Client default equals the Host's (${defaultMatch === null ? 'missing' : defaultMatch[1]} vs ${promptTable.DEFAULT_MODE})`,
);

if (exportPath !== undefined) {
  try {
    await writeFile(exportPath, JSON.stringify(dump, null, 2), 'utf8');
    console.log('exported:', exportPath);
  } catch (error) {
    console.error('EXPORT FAILED:', error && error.message ? error.message : error);
    failed = true;
  }
}

for (const result of checks) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.message}`);
}
const failedChecks = checks.filter((result) => result.ok !== true);
if (failedChecks.length > 0) {
  console.error(`${failedChecks.length} assertion(s) failed`);
  failed = true;
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log('APPLY OK');
}
