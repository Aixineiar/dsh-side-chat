/**
 * Client-half interaction rules, run with `node --test dev/`.
 *
 * These are the assertions `dev/boot-sim.mjs` never had: the resource coroutine's
 * catalog race, the close refusal path, the mode menu's routing, the shared-kit
 * guard, and the Session-command bridge's teardown. They drive the *registered*
 * surfaces (the resource provider, the close handler, the guide card), so a
 * refactor inside client.js cannot make them agree with themselves.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bootClient, findElement, settle } from './harness.mjs';

/** One well-formed side-chat resource address. */
const ADDRESS = 'dsh-resource://sidechat/session/session-child?parent=session-main&at=7&t=1000&m=read&n=Main';

/** Collect the frames of one provider coroutine, then cancel it. */
async function collectFrames(provider, address) {
  const controller = new AbortController();
  const frames = [];
  for await (const frame of provider.open(address, { signal: controller.signal })) {
    frames.push(frame);
    controller.abort();
  }
  return frames;
}

/** The props the sidebar renderer would hand the guide entry. */
function guideProps(sessionId = 'session-main') {
  return {
    sessionId: sessionId,
    title: 'Side chat',
    kind: 'sidechat-launcher',
    t: (key, params) => (params === undefined ? key : key + '(' + JSON.stringify(params) + ')'),
    useTabInfo: () => ({ tab: undefined }),
    useSessions: (select) => select({ byId: {} }),
  };
}

/** Render the registered guide card into a stub element tree. */
function renderGuide(boot, props) {
  const registered = boot.captured.slots.get('sidebar.right.tab.guide.entry');
  assert.ok(registered !== undefined, 'the guide entry is registered');
  const outer = registered.component(props);
  const inner = Array.isArray(outer.children) ? outer.children[0] : outer.children;
  return inner.type(inner.props);
}

/** Click the guide card's main button (starts a side chat). */
function clickGuide(boot, props) {
  const tree = renderGuide(boot, props);
  const main = findElement(tree, (element) => element.props?.className === 'dsh-side-chat-guide-main');
  assert.ok(main !== undefined, 'the guide card renders its main button');
  main.props.onClick();
  return tree;
}

test('retain: the catalog race is waited out, not surfaced', async () => {
  const catalog = { ids: [], byId: {} };
  const order = [];
  let refreshCalls = 0;
  let retainCalls = 0;
  const boot = await bootClient({
    catalog: () => catalog,
    refresh: async () => {
      refreshCalls += 1;
      order.push('refresh');
      catalog.byId['session-child'] = { sessionId: 'session-child' };
      catalog.ids.push('session-child');
    },
    retain: (id) => {
      retainCalls += 1;
      order.push('retain');
      if (catalog.byId[id] === undefined) throw new Error('sessions.retain: unknown session ' + id);
      return { release: () => undefined };
    },
  });
  const frames = await collectFrames(boot.captured.resources[0], ADDRESS);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ok, true, 'the first open succeeds after the catalog refresh');
  assert.equal(refreshCalls, 1, 'the catalog is refreshed exactly once');
  assert.equal(retainCalls, 1, 'the Session is retained once the catalog knows it');
  assert.deepEqual(order, ['refresh', 'retain'], 'the refresh happens before the retain');
});

test('retain: an already-listed Session is retained without a refresh', async () => {
  let refreshCalls = 0;
  let retainCalls = 0;
  const boot = await bootClient({
    catalog: () => ({ ids: ['session-child'], byId: { 'session-child': { sessionId: 'session-child' } } }),
    refresh: async () => {
      refreshCalls += 1;
    },
    retain: () => {
      retainCalls += 1;
      return { release: () => undefined };
    },
  });
  const frames = await collectFrames(boot.captured.resources[0], ADDRESS);
  assert.equal(frames[0].ok, true);
  assert.equal(refreshCalls, 0, 'the happy path never pays for a refresh');
  assert.equal(retainCalls, 1);
});

test('retain: a thread that never arrives answers a readable code', async () => {
  let refreshCalls = 0;
  const boot = await bootClient({
    catalog: () => ({ ids: [], byId: {} }),
    refresh: async () => {
      refreshCalls += 1;
    },
    retain: (id) => {
      throw new Error('sessions.retain: unknown session ' + id);
    },
  });
  const frames = await collectFrames(boot.captured.resources[0], ADDRESS);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ok, false);
  assert.equal(frames[0].error.code, 'side-chat/retain-pending', 'the raw host error never leaves this layer');
  assert.equal(refreshCalls, 6, 'every attempt refreshes before it gives up');
});

test('resource: a malformed address is refused without touching the catalog', async () => {
  let retainCalls = 0;
  const boot = await bootClient({
    retain: () => {
      retainCalls += 1;
      return { release: () => undefined };
    },
  });
  const frames = await collectFrames(boot.captured.resources[0], 'dsh-resource://sidechat/session/x');
  assert.equal(frames[0].ok, false);
  assert.equal(frames[0].error.code, 'side-chat/bad-address');
  assert.equal(retainCalls, 0);
});

test('resource: the tab type parses addresses and titles them', async () => {
  const boot = await bootClient();
  const tab = boot.captured.tabs.find((candidate) => candidate.kind === 'sidechat');
  assert.ok(tab !== undefined, 'the conversation tab type is registered');
  assert.equal(tab.canOpen(ADDRESS), true);
  assert.equal(tab.canOpen('dsh-resource://sidechat/session/session-child'), false, 'a missing parent is rejected');
  assert.equal(tab.canOpen('dsh-resource://other/session/session-child?parent=x'), false);
  assert.equal(tab.canOpen('not-an-address'), false);
  assert.match(tab.title(ADDRESS), /Main/, 'the tab title carries the inherited label');
});

test('guide: clicking the card opens one side chat with the remembered mode', async () => {
  const calls = [];
  const boot = await bootClient({
    route: async (action, payload) => {
      calls.push({ action: action, payload: payload });
      if (action === 'open') return { ok: true, value: { childId: 'session-child', atSeq: 7, mode: payload.mode, label: 'Main' } };
      return { ok: true, value: {} };
    },
  });
  clickGuide(boot, guideProps());
  await settle(20);
  const open = calls.find((call) => call.action === 'open');
  assert.ok(open !== undefined, 'the card asks the Host to open a thread');
  assert.equal(open.payload.sessionId, 'session-main');
  assert.equal(open.payload.mode, 'read', 'the remembered mode defaults to read-only');
  assert.equal(boot.captured.opened.length, 1);
  assert.match(boot.captured.opened[0].address, /^dsh-resource:\/\/sidechat\/session\/session-child\?/);
});

test('guide: a refused close is closed out, not offered as a retry', async () => {
  const boot = await bootClient({
    route: async (action) => {
      if (action === 'close') return { ok: true, value: { closed: false, reason: 'side-chat/not-owned' } };
      return { ok: true, value: {} };
    },
  });
  const handler = boot.captured.closeHandlers.get('sidechat');
  assert.ok(typeof handler === 'function', 'the tab kind has a close handler');
  handler('session-child', { contentId: ADDRESS });
  await settle(20);
  const tree = renderGuide(boot, guideProps());
  const retry = findElement(tree, (element) => element.props?.className === 'dsh-side-chat-retry');
  assert.equal(retry, undefined, 'retrying cannot turn a foreign Session into ours');
});

test('guide: an unrecoverable io failure stays reachable', async () => {
  let closeCalls = 0;
  const boot = await bootClient({
    route: async (action) => {
      if (action !== 'close') return { ok: true, value: {} };
      closeCalls += 1;
      return { ok: false, error: { code: 'side-chat/io', message: 'locked' } };
    },
  });
  const handler = boot.captured.closeHandlers.get('sidechat');
  handler('session-child', { contentId: ADDRESS });
  await settle(2000);
  assert.equal(closeCalls, 3, 'the thread is retried three times before it is recorded');
  const tree = renderGuide(boot, guideProps());
  const retry = findElement(tree, (element) => element.props?.className === 'dsh-side-chat-retry');
  assert.ok(retry !== undefined, 'the failed close is reachable again');
  assert.match(String(retry.children), /guide\.retryClose/);
  const description = findElement(
    tree,
    (element) => element.props?.className === 'dsh-side-chat-guide-desc' && String(element.children).includes('guide.closeIssues'),
  );
  assert.ok(description !== undefined, 'the card counts the threads it could not close');
});

test('close: a retryable io failure is retried before it is recorded', async () => {
  let closeCalls = 0;
  const boot = await bootClient({
    route: async (action) => {
      if (action !== 'close') return { ok: true, value: {} };
      closeCalls += 1;
      if (closeCalls < 3) return { ok: false, error: { code: 'side-chat/io', message: 'locked' } };
      return { ok: true, value: { closed: true } };
    },
  });
  const handler = boot.captured.closeHandlers.get('sidechat');
  handler('session-child', { contentId: ADDRESS });
  await settle(2000);
  assert.equal(closeCalls, 3, 'two retries happen before the third attempt succeeds');
  const tree = renderGuide(boot, guideProps());
  const retry = findElement(tree, (element) => element.props?.className === 'dsh-side-chat-retry');
  assert.equal(retry, undefined, 'a successful retry leaves no entry behind');
});

test('kit: a half-changed shared kit falls back to the local menu', async () => {
  const valid = await bootClient({
    primitives: {
      Menu: function Menu() {
        return null;
      },
      Button: function Button() {
        return null;
      },
      IconChevronDownOutlineRegular: function Icon() {
        return null;
      },
    },
  });
  const validMenu = findElement(renderGuide(valid, guideProps()), (element) => element.props?.anchor !== undefined);
  assert.ok(validMenu !== undefined, 'the guide renders a menu');
  assert.equal(typeof validMenu.props.anchor.type, 'function', 'a complete kit is used as-is');

  const partial = await bootClient({
    primitives: {
      Menu: function Menu() {
        return null;
      },
      Button: 'button',
      IconChevronDownOutlineRegular: function Icon() {
        return null;
      },
    },
  });
  const partialMenu = findElement(renderGuide(partial, guideProps()), (element) => element.props?.anchor !== undefined);
  assert.ok(partialMenu !== undefined, 'the guide still renders a menu');
  assert.equal(partialMenu.props.anchor.type, 'button', 'an incomplete kit degrades as a whole');

  const wrapped = await bootClient({
    primitives: {
      Menu: function Menu() {
        return null;
      },
      Button: { $$typeof: Symbol.for('react.forward_ref'), render: () => null },
      IconChevronDownOutlineRegular: function Icon() {
        return null;
      },
    },
  });
  const wrappedMenu = findElement(renderGuide(wrapped, guideProps()), (element) => element.props?.anchor !== undefined);
  assert.ok(wrappedMenu !== undefined, 'the guide renders with a wrapped component');
  assert.equal(typeof wrappedMenu.props.anchor.type, 'object', 'a forwardRef component still counts as a component');
});

test('bridge: the Session-command patch is removed when the plugin unloads', async () => {
  const originalPrompt = function prompt() {
    return Promise.resolve({ ok: true, value: {} });
  };
  const remote = {
    session: {
      prompt: originalPrompt,
      cancel: function cancel() {
        return Promise.resolve({ ok: true, value: {} });
      },
      selectModel: function selectModel() {
        return Promise.resolve({ ok: true, value: {} });
      },
    },
  };
  const boot = await bootClient({
    remote: remote,
    route: async (action, payload) => {
      if (action === 'open') return { ok: true, value: { childId: 'session-child', atSeq: 7, mode: payload.mode, label: 'Main' } };
      return { ok: true, value: {} };
    },
  });
  clickGuide(boot, guideProps());
  await settle(20);
  assert.notEqual(remote.session.prompt, originalPrompt, 'the bridge installs on first use');
  const installed = remote.session.prompt;

  clickGuide(boot, guideProps());
  await settle(20);
  assert.equal(remote.session.prompt, installed, 'a second open does not stack another wrapper');

  for (const disposer of boot.disposers) if (typeof disposer === 'function') disposer();
  assert.equal(remote.session.prompt, originalPrompt, 'unloading restores the original method');
});
