/**
 * Local boot simulation for the side-chat client entry: loads client.js under a
 * stubbed ModuleLoader + Cordis-like context and reports the first throw from
 * `apply`. Diagnostic only.
 */

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

const ctx = {
  effect: (cb) => {
    const disposer = cb();
    disposers.push(disposer);
    return () => undefined;
  },
  inject: (_services, cb) => cb(makeScope(ctx)),
  get: () => undefined,
  on: () => () => undefined,
  logger: { warn: console.warn, info: console.log },
  locale: {
    register: () => () => undefined,
    bind: () => (key) => key,
  },
  slots: makeSlot(),
  sessions: {
    list: { getSnapshot: () => ({ ids: [], byId: {} }) },
    using: async () => undefined,
    retain: () => ({ release: () => undefined, prompt: async () => ({ ok: true }) }),
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

const url = new URL('./client.js', import.meta.url).href;
await import(url);

const record = loaded[0];
if (record === undefined) {
  console.log('NO MODULE RECORDED');
  process.exit(1);
}

const exports_ = record.factory((spec) => {
  if (spec === 'react') {
    const React = {
      createElement: (type, props, ...children) => ({ type, props, children }),
      Fragment: 'Fragment',
      Component: class {},
      useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
      useEffect: () => undefined,
      useLayoutEffect: () => undefined,
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

console.log('exports:', Object.keys(exports_));
try {
  exports_.apply(ctx);
  console.log('APPLY OK');
} catch (error) {
  console.error('APPLY THREW:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
