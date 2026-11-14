/**
 * Boot harness for the Client half: every browser stub this plugin touches, the
 * captured registrations the tests drive, and a scriptable Host route.
 *
 * Both dev runners share it — `dev/boot-sim.mjs` (Host half + a smoke boot) and
 * `dev/client-logic.test.mjs` (Client interaction rules). Nothing here is
 * shipped: `files` in package.json keeps `dev/` out of the package.
 */

/** How many times client.js was imported; each boot gets its own module instance. */
let bootCounter = 0;

/** A fresh React stub; one instance per boot so hooks never share state. */
function reactStub() {
  return {
    createElement: (type, props, ...children) => ({ type: type, props: props === null || props === undefined ? {} : props, children: children }),
    Fragment: 'Fragment',
    Component: class {
      constructor(props) {
        this.props = props === null || props === undefined ? {} : props;
      }
    },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: () => ({ current: null }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
}

/**
 * Walk one stubbed React tree and return the first element whose props satisfy
 * `match`.
 * @param node - element or array returned by the stub `createElement`.
 * @param match - predicate over `props`.
 * @returns the matching element, or undefined.
 */
export function findElement(node, match) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (match(node)) return node;
  const children = Array.isArray(node.children) ? node.children : [];
  return findElement(children, match);
}

/**
 * Boot the Client half under stubs.
 * @param options - fixtures:
 *   `primitives` (the shared-kit module or null), `route` (async (action, payload) => envelope),
 *   `catalog` (() => ({ ids, byId })), `retain` (async (id, options) => reference).
 * @returns the captured registrations and the live context the plugin bound to.
 */
export async function bootClient(options = {}) {
  const captured = {
    /** `resources.register()` records. */
    resources: [],
    /** `sidebarRightTabs.register()` records. */
    tabs: [],
    /** `sidebarRight.registerCloseHandler()` records, by tab kind. */
    closeHandlers: new Map(),
    /** `slots.register()` records, by slot name. */
    slots: new Map(),
    /** `webServer`-free: the Client half only calls the route. */
    route: [],
    /** Every `openResource` call. */
    opened: [],
    /** Every style tag appended. */
    styles: [],
    /** Console noise the plugin produced. */
    warnings: [],
  };
  const loaded = [];
  const disposers = [];
  const route = typeof options.route === 'function' ? options.route : async () => ({ ok: true, value: {} });
  const primitives =
    options.primitives === undefined
      ? { Menu: () => null, Button: 'button', IconChevronDownOutlineRegular: () => null }
      : options.primitives;
  const catalog = typeof options.catalog === 'function' ? options.catalog : () => ({ ids: [], byId: {} });
  const retain =
    typeof options.retain === 'function' ? options.retain : () => ({ release: () => undefined });

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
    setTimeout: (fn, ms) => setTimeout(fn, ms === undefined ? 0 : ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };
  globalThis.sessionStorage = globalThis.window.sessionStorage;
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = {
    baseURI: 'http://127.0.0.1:60005/',
    head: {
      appendChild: (node) => {
        captured.styles.push(node);
      },
    },
    body: { appendChild: () => undefined },
    createElement: () => ({ dataset: {}, style: {}, textContent: '', remove: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  globalThis.fetch = async (url, init) => {
    const action = String(url).split('/dsh-side-chat/api/')[1] ?? '';
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    captured.route.push({ action: action, payload: payload });
    const envelope = await route(action, payload);
    return { ok: envelope !== undefined && envelope.ok === true, status: envelope?.status ?? 200, json: async () => envelope };
  };

  const slots = {
    inject: (_name, cb) => cb(),
    register: (definition, component) => {
      captured.slots.set(definition.name, { definition: definition, component: component });
      return () => undefined;
    },
  };
  const baseCtx = {
    effect: (cb) => {
      const disposer = cb();
      disposers.push(disposer);
      return () => undefined;
    },
    inject: (_services, cb) => cb(makeScope(baseCtx)),
    get: (name) => (name === 'remote' ? (options.remote ?? {}) : undefined),
    on: () => () => undefined,
    logger: { warn: (line) => captured.warnings.push(String(line)), info: () => undefined },
    locale: {
      register: () => () => undefined,
      bind: () => (key, params) => (params === undefined ? key : key + '(' + JSON.stringify(params) + ')'),
    },
    slots: slots,
    sessions: {
      list: { getSnapshot: () => catalog(), subscribe: () => () => undefined },
      refresh: typeof options.refresh === 'function' ? options.refresh : async () => undefined,
      using: async () => undefined,
      retain: retain,
      scope: () => ({ get: () => undefined }),
    },
    sidebarRight: {
      openResource: (address, openOptions) => captured.opened.push({ address: address, options: openOptions }),
      registerCloseHandler: (kind, handler) => {
        captured.closeHandlers.set(kind, handler);
        return () => undefined;
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        captured.tabs.push(definition);
        return () => undefined;
      },
    },
    resources: {
      register: (provider) => {
        captured.resources.push(provider);
        return () => undefined;
      },
    },
    remote: options.remote ?? {},
  };

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

  const clientUrl = new URL('../client.js', import.meta.url).href + '?boot=' + String((bootCounter += 1));
  await import(clientUrl);
  const record = loaded[0];
  if (record === undefined) throw new Error('client.js did not register a module record');
  const exports = record.factory((spec) => {
    if (spec === 'react') return reactStub();
    if (spec === 'react-dom') return { createPortal: (node) => node };
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      if (primitives === null) throw new Error('primitives unavailable');
      return primitives;
    }
    throw new Error('unstubbed require: ' + spec);
  });
  exports.apply(baseCtx);
  return { exports: exports, captured: captured, ctx: baseCtx, disposers: disposers };
}

/**
 * Let queued microtasks and timers run.
 * @param ms - wall-clock time to keep draining for (0 = one macrotask batch).
 * @returns completion after the drain.
 */
export async function settle(ms = 0) {
  const deadline = Date.now() + ms;
  do {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  } while (Date.now() < deadline);
}
