/**
 * Local boot simulation for both halves of the side-chat bundle.
 *
 * The Client half loads under a stubbed ModuleLoader + Cordis-like context and
 * reports the first throw from `apply`. The Host half loads under a stubbed
 * context that records the tool mask, the injected boundary, the assembled
 * sections, and the seed, then asserts the three modes agree with themselves:
 * the closed list a prompt renders is the list the mask leaves callable, the
 * retained `tool:*` sections cover exactly the callable tools, the Agent's tool
 * view holds nothing a mask cannot reach, and the seed keeps every envelope
 * field of the source events. Diagnostic only: no Host package is imported.
 */

import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const loaded = [];
const disposers = [];

globalThis.window = {
  __ModuleLoader__: {
    load(record) {
      loaded.push(record);
    },
  },
  sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  setTimeout: (fn) => 0,
  clearTimeout: () => undefined,
};
globalThis.sessionStorage = window.sessionStorage;
globalThis.localStorage = window.localStorage;
globalThis.performance = globalThis.performance ?? { timeOrigin: Date.now() };
globalThis.document = {
  baseURI: 'http://127.0.0.1:60005/',
  head: { appendChild: () => undefined },
  body: { appendChild: () => undefined },
  createElement: () => ({ dataset: {}, style: {}, textContent: '', remove: () => undefined }),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
globalThis.fetch = async () => ({ ok: false, status: 501, json: async () => undefined });

function makeSlot() {
  return {
    inject: (_name, cb) => cb(),
    register: () => () => undefined,
  };
}

function makeScope(ctx) {
  return {
    ...ctx,
    effect: (cb) => {
      const disposer = cb();
      disposers.push(disposer);
      return () => undefined;
    },
  };
}

const clientCtx = {
  effect: (cb) => {
    const disposer = cb();
    disposers.push(disposer);
    return () => undefined;
  },
  inject: (_services, cb) => cb(makeScope(clientCtx)),
  get: () => undefined,
  on: () => () => undefined,
  logger: { warn: () => undefined, info: () => undefined },
  locale: {
    register: () => () => undefined,
    bind: () => (key) => key,
  },
  slots: makeSlot(),
  sessions: {
    list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => undefined },
    using: async () => undefined,
    retain: () => ({ release: () => undefined }),
    scope: () => ({ get: () => undefined }),
  },
  workspaces: { archiveSession: async () => undefined },
  sidebarRight: {
    openResource: () => undefined,
    registerCloseHandler: () => () => undefined,
  },
  sidebarRightTabs: { register: () => () => undefined },
  resources: { register: () => () => undefined },
  remote: {},
};

const clientUrl = new URL('../client.js', import.meta.url).href;
await import(clientUrl);

const record = loaded[0];
if (record === undefined) {
  console.log('NO MODULE RECORDED');
  process.exit(1);
}

const clientExports = record.factory((spec) => {
  if (spec === 'react') {
    const React = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      Fragment: 'Fragment',
      Component: class {},
      useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
      useEffect: () => undefined,
      useLayoutEffect: () => undefined,
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useRef: () => ({ current: null }),
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
    };
    return React;
  }
  if (spec === 'react-dom') return { createPortal: (node) => node };
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { Menu: () => null, Button: 'button', IconChevronDownOutlineRegular: () => null };
  throw new Error(`unstubbed require: ${spec}`);
});

console.log('client exports:', Object.keys(clientExports));
let failed = false;
try {
  clientExports.apply(clientCtx);
  console.log('client APPLY OK');
} catch (error) {
  console.error('CLIENT APPLY THREW:', error && error.stack ? error.stack : error);
  failed = true;
}

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

/** Host `tool:*` paragraphs this fixture environment registers (assembly input). */
const SECTION_NAMES = [
  'tool:read',
  'tool:write',
  'tool:apply_patch',
  'tool:edit',
  'tool:glob',
  'tool:grep',
  'tool:web_search',
  'tool:web_fetch',
  'tool:session-query',
];

/**
 * The `tool:*` section names the hosting packages really register, read from
 * the installed host (0.2.2-rc.1): `dsh-tool-fs/lib/index.js:249` (`tool:read`,
 * plus `tool:write`/`tool:apply`/`tool:edit`), `dsh-tool-fs-search` (`tool:glob`,
 * `tool:grep`), `dsh-tool-web` (`:284` `tool:web_search`, `:762`
 * `tool:web_fetch`), `dsh-tool-session-query` (`tool:session-query`), and the
 * shell/job/goal scheduling packages for the write-side paragraphs.
 */
const HOST_SECTION_NAMES = [
  'tool:apply',
  'tool:bash',
  'tool:edit',
  'tool:glob',
  'tool:goal',
  'tool:grep',
  'tool:jobs',
  'tool:pty',
  'tool:pwsh',
  'tool:ralph',
  'tool:read',
  'tool:schedule',
  'tool:session-query',
  'tool:web_fetch',
  'tool:web_search',
  'tool:write',
];

/**
 * The paragraph that documents each tool, per the hosting packages — kept here
 * as an independent oracle so the assertion fails when the bundle's own table
 * drifts, instead of agreeing with it. `lsp` is absent on both sides: this host
 * registers no `lsp` tool and no `tool:lsp` paragraph.
 */
const HOST_SECTION_OF = {
  read: 'tool:read',
  read_image: 'tool:read',
  glob: 'tool:glob',
  grep: 'tool:grep',
  web_search: 'tool:web_search',
  web_fetch: 'tool:web_fetch',
  session_search: 'tool:session-query',
  session_trace: 'tool:session-query',
  session_event_read: 'tool:session-query',
  session_event_search: 'tool:session-query',
  session_event_trace: 'tool:session-query',
};

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
    logs: { warn: [], error: [] },
  };
  const agentsById = new Map();
  const childTools = makeTools(TOOL_NAMES, options.ownTools ?? []);
  const parentTools = makeTools(TOOL_NAMES, []);
  const persistence = {
    locateCalls: [],
    locate(meta) {
      persistence.locateCalls.push(meta);
      return { path: join(tmpdir(), 'dsh-side-chat-sim', String(meta.id), 'log.jsonl') };
    },
    list: async () => [],
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
        },
        steer(input) {
          state.steered = input;
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
    sessionController: {
      async composeAgent(presetId) {
        return { agentPreset: presetId ?? 'default-preset', setup: () => undefined };
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
  hostExports.apply(ctx, {});
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

  // The retained paragraphs: exactly one per callable tool that has one.
  const kept = new Set();
  const assembly = { sections: SECTION_NAMES.map((sectionName) => ({ name: sectionName, text: 'x' })) };
  const listener = state.listeners['system-prompt/assemble']?.[0];
  if (listener !== undefined) {
    const result = await listener(assembly, { agent: state.child }, async () => assembly);
    if (result !== undefined && Array.isArray(result.sections)) for (const row of result.sections) kept.add(row.name);
  }
  if (mode === 'reply') {
    check(kept.size === 0, `reply: no tool paragraph is kept (${[...kept].join(', ') || 'none'})`);
  } else if (mode === 'read') {
    const expected = new Set();
    for (const name of allowed ?? []) if (HOST_SECTION_OF[name] !== undefined) expected.add(HOST_SECTION_OF[name]);
    for (const name of expected) check(kept.has(name), `read: a callable tool keeps its paragraph (${name})`);
    for (const name of kept) {
      const documented = Object.keys(HOST_SECTION_OF).filter((tool) => HOST_SECTION_OF[tool] === name);
      check(documented.some((tool) => (allowed ?? []).includes(tool)), `read: a masked tool has no paragraph (${name})`);
    }
  }

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
    sectionsKept: [...kept],
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
check(foreignRun.persistence.locateCalls.length === 0, 'close: a refused close touches no artifact');

const ownedRun = await openMode(hostExports, 'read');
const ownedId = ownedRun.open.envelope.value.childId;
const ownedClose = await callRoute(ownedRun, 'close', { childId: ownedId });
check(
  ownedClose.envelope?.ok === true && ownedClose.envelope.value.closed === true,
  `close: an owned thread closes (${JSON.stringify(ownedClose.envelope)})`,
);
check(
  ownedRun.persistence.locateCalls.some((meta) => meta.id === ownedId),
  'close: the owned artifact is located for deletion',
);

// A dispose that fails keeps its handle and leaves the log alone.
const retryRun = await openMode(hostExports, 'read', { disposeFails: 1 });
const retryId = retryRun.open.envelope.value.childId;
const firstClose = await callRoute(retryRun, 'close', { childId: retryId });
check(
  firstClose.envelope?.ok === false && String(firstClose.envelope?.error?.message ?? '').includes('释放会话失败'),
  `close: a failed dispose is reported (${JSON.stringify(firstClose.envelope)})`,
);
check(retryRun.persistence.locateCalls.length === 0, 'close: a failed dispose leaves the artifact alone');
const secondClose = await callRoute(retryRun, 'close', { childId: retryId });
check(
  secondClose.envelope?.ok === true && secondClose.envelope.value.closed === true,
  `close: the retry still has a teardown handle (${JSON.stringify(secondClose.envelope)})`,
);
dump.close = { foreign: foreign.envelope, owned: ownedClose.envelope, first: firstClose.envelope, second: secondClose.envelope };

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

// The bundle's tool -> paragraph table is compared with the host's real section
// names, not with a local copy, so a rename in the hosting packages or a typo
// here fails instead of agreeing with itself.
for (const entry of Object.entries(promptTable.TOOL_SECTION_OF)) {
  const tool = entry[0];
  const sectionName = entry[1];
  check(HOST_SECTION_NAMES.includes(sectionName), `${tool}: the mapped paragraph "${sectionName}" is a real host section`);
  check(
    HOST_SECTION_OF[tool] === sectionName,
    `${tool}: the mapping matches the host (${String(HOST_SECTION_OF[tool])} vs ${sectionName})`,
  );
}
check(
  promptTable.TOOL_SECTION_OF.lsp === undefined && HOST_SECTION_OF.lsp === undefined,
  'read: "lsp" has no host section on either side, so skipping it is intentional',
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
