window.__ModuleLoader__.load({
  id: '@aixineiar/dsh-side-chat',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    /** The loader-provided require, kept so a module can be resolved on first use. */
    const loadModule = require;
    /** Cached shared UI kit (`Menu`, `Button`, icons). */
    let primitivesCache;
    /**
     * The shared-kit exports this plugin renders with.
     * @type {ReadonlyArray<string>}
     */
    const PRIMITIVE_EXPORTS = ['Menu', 'Button', 'IconChevronDownOutlineRegular'];

    /**
     * Whether one kit export can be rendered as a component type: a function
     * (function component or class), or an object carrying React's `$$typeof`
     * marker (`memo` / `forwardRef` wrappers).
     * @param value - one export of the shared kit.
     * @returns whether the value is a component type.
     */
    function isComponentType(value) {
      if (typeof value === 'function') return true;
      return typeof value === 'object' && value !== null && typeof value.$$typeof === 'symbol';
    }

    /**
     * Resolve the shared UI kit the shipped sidebar cards use. Resolution is
     * lazy on purpose: a missing module must degrade to the local menu, never
     * fail the client entry (one failed entry aborts the whole web boot).
     *
     * The kit is accepted only when every export this plugin uses is present as
     * a component: a half-changed kit would otherwise mix a host `Menu` with a
     * local chevron, and a changed prop signature would throw during render and
     * blank the slot entry.
     * @returns the module namespace, or null when it is unavailable or unusable.
     */
    function primitivesModule() {
      if (primitivesCache !== undefined) return primitivesCache;
      let kit;
      try {
        kit = loadModule('@deepseek-ai/dsh-client-ui-primitives');
      } catch (error) {
        console.warn('side-chat: shared UI kit unavailable', error);
        kit = undefined;
      }
      const usable =
        kit !== undefined && kit !== null && PRIMITIVE_EXPORTS.every((name) => isComponentType(kit[name]));
      if (!usable && kit !== undefined && kit !== null) {
        console.warn('side-chat: shared UI kit has an unexpected shape; using the local menu');
      }
      primitivesCache = usable ? kit : null;
      return primitivesCache;
    }
    const h = React.createElement;
    const { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'sideChat';
    /** Resource protocol that carries one side chat. */
    const PROTOCOL = 'sidechat';
    /** Resource address prefix for one side-chat Session. */
    const SCHEME = 'dsh-resource://sidechat/session/';
    /** Stable implementation identity of the conversation tab body. */
    const CHAT_ID = '@aixineiar/dsh-side-chat/chat';
    /** Stable implementation identity of the launcher page body. */
    const LAUNCHER_ID = '@aixineiar/dsh-side-chat/launcher';
    /** Tab kind of the conversation body. */
    const CHAT_KIND = 'sidechat';
    /** Tab kind of the launcher page. */
    const LAUNCHER_KIND = 'sidechat-launcher';
    /** Page-document key holding this page lifetime's token. */
    const BOOT_KEY = 'dsh.side-chat.boot';
    /** Per-Session key proving a side chat was opened in this page lifetime. */
    const LIVE_PREFIX = 'dsh.side-chat.live.';
    /**
     * Session-reference source label. `SessionReferenceSourceMap` is a
     * declaration-merged interface: a consumer contributes its own key so its
     * retentions stay attributable in `retainedBy`. Declared as data here
     * because this half ships no type declarations.
     */
    const SOURCE = 'sideChat';
    /** Page-document key holding the remembered mode. */
    const MODE_KEY = 'dsh.side-chat.mode';
    /**
     * The three supported modes, in menu order. The Host half reads the same set
     * from `prompt.js`; this copy exists because the Client loader cannot import
     * another module, and `dev/boot-sim.mjs` fails when the two drift apart.
     */
    const MODES = ['reply', 'read', 'full'];

    const zh = {
      'tab.title': '侧边对话',
      'tab.sideTitle': '侧边 · {title}',
      'tab.loading': '正在加载侧边对话…',
      'tab.failed': '侧边对话加载失败',
      'tab.unparsable': '无法解析侧边对话地址',
      'tab.crashed': '侧边对话渲染失败',
      'tab.noProvider': '侧边对话缺少 SessionProvider',
      'guide.title': '侧边对话',
      'guide.description': '继承当前会话上下文 · 只回复 / 只读 / 完全继承',
      'guide.status': '当前状态：{mode}',
      'guide.blank': '主会话还没有可继承的内容：先发一条消息，再打开侧边对话',
      'guide.closeIssues': '{count} 条侧边对话未能关闭',
      'guide.retryClose': '重试关闭',
      'guide.retryingClose': '正在重试…',
      'mode.label': '侧边对话模式',
      'mode.reply': '只回复',
      'mode.read': '只读',
      'mode.full': '完全继承',
      'mode.switchHint': '切换模式会新开一条侧边对话，并关闭当前这条',
      'button.label': '侧边对话',
      'button.tooltip': '在右侧栏打开侧边对话（继承本会话上下文，默认只读）',
      'launcher.opening': '正在打开侧边对话…',
      'status.snapshot': '上下文截至 {time}',
      'status.running': '主会话仍在运行',
      'status.sync': '以最新快照新开',
      'status.syncHint': '用主会话的最新快照新开一条，并关闭当前侧边对话',
      'status.syncing': '同步中…',
      'status.latest': '已是最新',
      'status.empty': '主会话还没有可继承的内容',
      'status.failed': '同步失败',
      'action.retry': '重试',
      'error.failed': '侧边对话打开失败',
      'error.pending': '侧边会话尚未同步，请重试',
      'error.badRequest': '请求参数有误，无法继续',
      'error.notOwned': '这条侧边对话不属于本插件',
      'error.agentGone': '这条侧边对话已结束',
      'error.noContext': '主会话还没有可继承的内容',
      'error.io': '文件操作失败，可稍后重试',
      'error.offline': '无法连接宿主，请稍后重试',
      'error.unknown': '操作失败',
    };
    const en = {
      'tab.title': 'Side chat',
      'tab.sideTitle': 'Side · {title}',
      'tab.loading': 'Loading the side chat…',
      'tab.failed': 'The side chat could not be loaded',
      'tab.unparsable': 'The side-chat address could not be parsed',
      'tab.crashed': 'The side chat failed to render',
      'tab.noProvider': 'The side chat is missing its SessionProvider',
      'guide.title': 'New side chat',
      'guide.description': 'Inherits this conversation · reply only / read-only / full',
      'guide.status': 'Current mode: {mode}',
      'guide.blank': 'The main conversation has nothing to inherit yet: send a message first',
      'guide.closeIssues': '{count} side chat(s) could not be closed',
      'guide.retryClose': 'Retry closing',
      'guide.retryingClose': 'Retrying…',
      'mode.label': 'Side-chat mode',
      'mode.reply': 'Reply only',
      'mode.read': 'Read-only',
      'mode.full': 'Fully inherited',
      'mode.switchHint': 'Switching the mode opens a new side chat and closes this one',
      'button.label': 'Side chat',
      'button.tooltip': 'Open a side chat in the right sidebar (inherits this conversation, read-only)',
      'launcher.opening': 'Opening the side chat…',
      'status.snapshot': 'Context as of {time}',
      'status.running': 'Main conversation running',
      'status.sync': 'Open a fresh snapshot',
      'status.syncHint': 'Opens a new side chat from the latest snapshot and closes this one',
      'status.syncing': 'Opening…',
      'status.latest': 'Already latest',
      'status.empty': 'The main conversation has nothing to inherit yet',
      'status.failed': 'Sync failed',
      'action.retry': 'Retry',
      'error.failed': 'Could not open the side chat',
      'error.pending': 'The side chat is not synced yet — please retry',
      'error.badRequest': 'The request was rejected as malformed',
      'error.notOwned': 'This side chat does not belong to this plugin',
      'error.agentGone': 'This side chat has already ended',
      'error.noContext': 'The main conversation has nothing to inherit yet',
      'error.io': 'A file operation failed; retrying later may work',
      'error.offline': 'The host is unreachable; retrying later may work',
      'error.unknown': 'The action failed',
    };

    /**
     * Every rule this plugin adds, one selector per line and grouped by surface:
     * base layout, status bar, header button, tab body and launcher, guide card,
     * and the local menu fallback. Rules are emitted as written — no minifier —
     * so the formatting here is the formatting the page gets.
     */
    const CSS = [
      /* --- base layout --- */
      '.dsh-side-chat-root { width: 100%; min-width: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }',
      '.dsh-side-chat-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }',
      '.dsh-side-chat-body > * { min-height: 0; }',
      '.dsh-side-chat-stack { margin: 0; font-size: 10px; line-height: 14px; white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto; color: var(--dsw-alias-label-secondary); }',
      '.dsh-side-chat-failure { color: var(--dsw-alias-state-error-primary) !important; }',
      /* --- status bar --- */
      '.dsh-side-chat-status { flex: none; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; }',
      '.dsh-side-chat-status-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }',
      '.dsh-side-chat-status-spacer { flex: 1; }',
      '.dsh-side-chat-link { border: 0; background: 0 0; padding: 1px 5px; border-radius: 4px; color: var(--dsw-alias-brand-primary); font: inherit; cursor: pointer; }',
      '.dsh-side-chat-link:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-side-chat-link:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }',
      /* --- header button --- */
      '.dsh-side-chat-button { border: 0; background: 0 0; padding: 6px; border-radius: 6px; color: var(--dsw-alias-label-secondary); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }',
      '.dsh-side-chat-button:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }',
      '.dsh-side-chat-button:disabled { opacity: .5; cursor: default; }',
      '.dsh-side-chat-button[data-failed="true"] { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-side-chat-tip-bubble { display: inline-flex; align-items: safe center; gap: 8px; position: fixed; z-index: 1100; width: max-content; box-sizing: border-box; max-width: min(50vw, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; padding: 3px 7px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-tooltip-bg); color: var(--dsw-static-neutral-bluish-00); font-size: 13px; line-height: 20px; white-space: pre-line; overflow-wrap: break-word; pointer-events: none; animation: dsh-side-chat-tip-in .15s var(--ds-ease-in-out); }',
      '@keyframes dsh-side-chat-tip-in { from { opacity: 0 } to { opacity: 1 } }',
      '@media (prefers-reduced-motion: reduce) { .dsh-side-chat-tip-bubble { animation: none; } }',
      /* --- tab body and launcher page --- */
      '.dsh-side-chat-launcher { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; height: 100%; padding: 22px 18px; overflow: auto; color: var(--dsw-alias-label-primary); }',
      '.dsh-side-chat-launcher h3 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }',
      '.dsh-side-chat-launcher p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }',
      '.dsh-side-chat-launcher button[data-primary="true"] { align-self: flex-start; margin-top: 2px; border: 0; border-radius: 8px; padding: 6px 14px; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 12px; line-height: 18px; cursor: pointer; }',
      '.dsh-side-chat-launcher button[data-primary="true"]:disabled { opacity: .5; cursor: default; }',
      /* --- guide card --- */
      '.dsh-side-chat-guide { box-sizing: border-box; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsl-guide-entry-radius, var(--dsw-radius-xl)); background: var(--dsw-alias-bg-layer-1); align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 14px 20px; display: flex; position: relative; overflow: hidden; }',
      '@media (hover: hover) { .dsh-side-chat-guide:hover { background: var(--dsw-alias-interactive-bg-hover); } }',
      '.dsh-side-chat-guide-main { border: 0; background: 0 0; border-radius: 0; width: 100%; height: 100%; position: absolute; inset: 0; padding: 0; cursor: pointer; }',
      '.dsh-side-chat-guide-main:focus-visible { outline-offset: -2px; }',
      '.dsh-side-chat-guide-main:disabled { cursor: default; }',
      '.dsh-side-chat-guide-icon { width: 26px; height: 26px; color: var(--dsw-alias-label-secondary); pointer-events: none; flex: none; justify-content: center; align-items: center; display: flex; position: relative; }',
      '.dsh-side-chat-guide-text { pointer-events: none; flex-direction: column; flex: 1; gap: 3px; min-width: 0; display: flex; position: relative; }',
      '.dsh-side-chat-guide-title-row { align-items: center; gap: 4px; min-width: 0; display: flex; }',
      '.dsh-side-chat-guide-title { color: var(--dsw-alias-label-primary); white-space: nowrap; text-overflow: ellipsis; font-size: 14px; line-height: 1.4; overflow: hidden; }',
      '.dsh-side-chat-guide-desc { color: var(--dsw-alias-label-tertiary); white-space: nowrap; text-overflow: ellipsis; font-size: 11px; line-height: 1.4; overflow: hidden; }',
      '.dsh-side-chat-guide-menu { pointer-events: auto; flex: none; display: flex; position: relative; }',
      '.dsh-side-chat-guide-trigger { border: 0; background: 0 0; border-radius: 4px; flex: none; width: 20px; height: 20px; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--dsw-alias-label-tertiary); }',
      '.dsh-side-chat-guide-trigger:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }',
      '.dsh-side-chat-guide-trigger svg { width: 14px; height: 14px; }',
      '.dsh-side-chat-retry { pointer-events: auto; border: 0; background: 0 0; padding: 0 4px; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 11px; line-height: inherit; cursor: pointer; text-decoration: underline; }',
      '.dsh-side-chat-retry:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; text-decoration: none; }',
      /* --- local menu fallback --- */
      '.dsh-side-chat-menu { position: fixed; z-index: 1100; min-width: 190px; box-sizing: border-box; padding: 4px; border-radius: 10px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); box-shadow: 0 8px 24px rgba(0, 0, 0, .24); display: flex; flex-direction: column; gap: 2px; }',
      '.dsh-side-chat-menu-item { border: 0; background: 0 0; text-align: left; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; cursor: pointer; }',
      '.dsh-side-chat-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dsh-side-chat-menu-item[data-selected="true"] { color: var(--dsw-alias-brand-primary); }',
      '.dsh-side-chat-menu-check { width: 14px; height: 14px; flex: none; display: inline-flex; align-items: center; justify-content: center; }',
      '.dsh-side-chat-menu-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }',
      '.dsh-side-chat-menu-hint { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }',
    ].join('\n');

    /** Read one page-document value without throwing in restricted contexts. */
    function readStorage(area, key) {
      try {
        return window[area].getItem(key);
      } catch (error) {
        return null;
      }
    }
    function writeStorage(area, key, value) {
      try {
        window[area].setItem(key, value);
      } catch (error) {
        /* storage may be unavailable; the tab simply restores after a reload */
      }
    }
    function removeStorage(area, key) {
      try {
        window[area].removeItem(key);
      } catch (error) {
        /* nothing to clean up */
      }
    }

    /** Normalize one stored mode. */
    function normalizeMode(value) {
      return MODES.indexOf(value) >= 0 ? value : 'read';
    }

    /** The mode remembered from the last choice. */
    function storedMode() {
      return normalizeMode(readStorage('localStorage', MODE_KEY));
    }

    /** Remember one chosen mode for the next open. */
    function rememberMode(mode) {
      writeStorage('localStorage', MODE_KEY, normalizeMode(mode));
    }

    /**
     * The Host's HTTP base. The page's own base keeps a reverse-proxy directory
     * prefix, and the desktop shell forwards non-static `dsh-app://app/...`
     * paths to the Host same-origin, so a relative route works in both
     * deployments.
     */
    function hostHttpBase() {
      const base = typeof document !== 'undefined' ? document.baseURI : undefined;
      if (typeof base === 'string' && base !== '') return base;
      const transport = globalThis.__DSH_TRANSPORT__;
      return transport !== undefined && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : '';
    }

    /**
     * One control-route failure with the Host's stable code. The wording the
     * user sees is chosen here, from the dictionaries, not by the Host.
     */
    class HostError extends Error {
      constructor(code, detail) {
        super(detail === undefined || detail === '' ? code : detail);
        this.name = 'HostError';
        this.code = code;
      }
    }

    /** Host failure code -> dictionary key holding the user's sentence. */
    const ERROR_KEYS = {
      'side-chat/bad-request': 'error.badRequest',
      'side-chat/not-owned': 'error.notOwned',
      'side-chat/agent-gone': 'error.agentGone',
      'side-chat/no-context': 'error.noContext',
      'side-chat/io': 'error.io',
      'side-chat/offline': 'error.offline',
      'side-chat/retain-pending': 'error.pending',
    };

    /**
     * The sentence one failure becomes. A code the dictionaries know wins; a
     * bare transport failure is reported as such; anything else falls back to
     * the caller's own key. The Host's raw message never reaches the page.
     * @param error - anything thrown by {@link callHost} or a local step.
     * @param fallbackKey - dictionary key used when the code is unrecognized.
     * @returns the localized sentence.
     */
    function errorText(error, fallbackKey) {
      const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
      const key = ERROR_KEYS[code];
      return t(key === undefined ? fallbackKey : key);
    }

    /**
     * Call one Host control action on the side-chat route.
     * @param action - route suffix.
     * @param payload - JSON body.
     * @returns the action's value.
     * @throws {HostError} carrying the Host's stable code.
     */
    async function callHost(action, payload) {
      const base = hostHttpBase();
      const url = new URL('dsh-side-chat/api/' + action, base === '' ? 'http://dsh.invalid' : base);
      let response;
      try {
        response = await fetch(url.href, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new HostError('side-chat/offline', message(error));
      }
      let envelope;
      try {
        envelope = await response.json();
      } catch (error) {
        envelope = undefined;
      }
      if (envelope === undefined || envelope.ok !== true) {
        const code =
          envelope !== undefined && envelope.error !== undefined && typeof envelope.error.code === 'string'
            ? envelope.error.code
            : 'side-chat/transport';
        const detail =
          envelope !== undefined && envelope.error !== undefined && typeof envelope.error.message === 'string'
            ? envelope.error.message
            : 'HTTP ' + response.status;
        throw new HostError(code, detail);
      }
      return envelope.value;
    }

    /** Compose one side-chat resource address. */
    function sideChatAddress(childId, parentId, atSeq, at, mode, label) {
      const query = new URLSearchParams({ parent: parentId });
      if (atSeq !== undefined) query.set('at', String(atSeq));
      if (at !== undefined) query.set('t', String(at));
      if (mode !== undefined) query.set('m', mode);
      if (typeof label === 'string' && label !== '') query.set('n', label);
      return SCHEME + encodeURIComponent(childId) + '?' + query.toString();
    }

    /** Parse one side-chat resource address, or undefined for anything else. */
    function parseSideChatAddress(value) {
      if (typeof value !== 'string') return undefined;
      let url;
      try {
        url = new URL(value);
      } catch (error) {
        return undefined;
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'session') return undefined;
      const parentId = url.searchParams.get('parent');
      if (parentId === null || parentId === '') return undefined;
      let childId;
      try {
        childId = decodeURIComponent(parts[1]);
      } catch (error) {
        return undefined;
      }
      if (childId === '') return undefined;
      const rawAt = url.searchParams.get('at');
      const atSeq = rawAt === null ? undefined : Number(rawAt);
      const rawTime = url.searchParams.get('t');
      const at = rawTime === null ? undefined : Number(rawTime);
      const rawMode = url.searchParams.get('m');
      const rawLabel = url.searchParams.get('n');
      return {
        childId: childId,
        parentId: parentId,
        atSeq: Number.isSafeInteger(atSeq) ? atSeq : undefined,
        at: Number.isFinite(at) ? at : undefined,
        mode: rawMode === null ? undefined : normalizeMode(rawMode),
        label: rawLabel === null ? '' : rawLabel,
      };
    }

    /** One human-readable message for a thrown value. */
    function message(error) {
      if (error instanceof Error) return error.message;
      return typeof error === 'string' ? error : String(error);
    }

    /** Resolve once the signal aborts. */
    function abortable(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }

    /**
     * The chat bubble with a side panel, drawn in the control's own color. The
     * guide card passes its own `size` and `className`, so the sidebar entry and
     * the header button carry the same glyph.
     */
    function SideChatGlyph(props) {
      const options = props === undefined || props === null ? {} : props;
      const size = typeof options.size === 'number' ? options.size : 16;
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          className: options.className,
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', {
          d: 'M2.4 3.4c0-.9.7-1.6 1.6-1.6h6.1c.9 0 1.6.7 1.6 1.6v6.1c0 .9-.7 1.6-1.6 1.6H6.2L3.5 14v-2.9c-.7-.2-1.1-.8-1.1-1.6V3.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M13.4 4.6v6.2c0 .9-.7 1.6-1.6 1.6H9.4',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      );
    }

    const inject = ['sessions', 'slots', 'locale', 'sidebarRight'];

    /**
     * Client entry. A throw here fails the whole web boot ("1 entry did not
     * activate"), so the real body runs inside a guard that reports the failure
     * to the Host instead of taking the application down.
     */
    function apply(ctx) {
      try {
        applyEntry(ctx);
      } catch (error) {
        console.error('side-chat: client entry failed', error);
        void callHost('log', {
          message: 'client entry failed: ' + message(error),
          stack: String((error && error.stack) || ''),
        }).catch(() => undefined);
      }
    }

    function applyEntry(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh: zh, en: en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }),
        'side-chat: dictionaries',
      );
      const t = ctx.locale.bind(NS);

      /** Whether the Session-command bridge is installed in this page. */
      let bridged = false;

      const originToken = String(
        Math.round((typeof performance !== 'undefined' && performance.timeOrigin) || Date.now()),
      );
      let bootToken = readStorage('sessionStorage', BOOT_KEY);
      if (bootToken !== originToken) {
        bootToken = originToken;
        writeStorage('sessionStorage', BOOT_KEY, originToken);
      }

      // A page lifetime owns its side chats: everything left from a crash, a
      // reload, or an older build that parked threads in the archive goes now.
      void callHost('sweep', { stale: true }).catch((error) => {
        console.warn('side-chat: sweep failed', error);
      });

      /** main Session id -> (child Session id -> resource address) */
      const openByMain = new Map();

      /**
       * Close failures per main Session: child id -> the Host's failure code.
       * One entry per thread the Host refused to close, so the guide card can
       * offer a retry for exactly those threads instead of a text nobody can act
       * on.
       */
      const closeIssues = new Map();
      const closeIssueListeners = new Set();
      /** Shared empty list, so a parent without failures keeps one identity. */
      const NO_CLOSE_ISSUES = Object.freeze([]);

      /** @returns `[{ childId, code }]` of one parent's failed closes. */
      function snapshotCloseIssues(parentId) {
        const group = closeIssues.get(parentId);
        if (group === undefined) return NO_CLOSE_ISSUES;
        return [...group.entries()].map(([childId, code]) => ({ childId: childId, code: code }));
      }

      function notifyCloseIssues() {
        for (const listener of closeIssueListeners) listener();
      }

      function noteCloseIssue(parentId, childId, code) {
        if (parentId === undefined || parentId === '') return;
        let group = closeIssues.get(parentId);
        if (group === undefined) {
          group = new Map();
          closeIssues.set(parentId, group);
        }
        group.set(childId, code);
        notifyCloseIssues();
      }

      function resolveCloseIssue(parentId, childId) {
        const group = closeIssues.get(parentId);
        if (group === undefined) return;
        if (!group.delete(childId)) return;
        if (group.size === 0) closeIssues.delete(parentId);
        notifyCloseIssues();
      }

      /**
       * Live close failures of one parent Session.
       * @param parentId - the main Session.
       * @returns `[{ childId, code }]`.
       */
      function useCloseIssues(parentId) {
        const state = useState(() => snapshotCloseIssues(parentId));
        const issues = state[0];
        const setIssues = state[1];
        useEffect(() => {
          const listener = () => setIssues(snapshotCloseIssues(parentId));
          closeIssueListeners.add(listener);
          listener();
          return () => closeIssueListeners.delete(listener);
        }, [parentId]);
        return issues;
      }

      /** One Session-list source per main Session, shared across renders. */
      const blankSources = new Map();

      /**
       * Reactive "has committed nothing" state of one main Session. A card that
       * cannot inherit anything says so instead of failing after the click.
       * @param sessionId - the main Session.
       * @returns whether it has no committed event to inherit.
       */
      function useBlankSession(sessionId) {
        let source = blankSources.get(sessionId);
        if (source === undefined) {
          source = {
            subscribe: (listener) => ctx.sessions.list.subscribe(listener),
            getSnapshot: () => ctx.sessions.list.getSnapshot().byId[sessionId]?.blank === true,
          };
          blankSources.set(sessionId, source);
        }
        return useSyncExternalStore(source.subscribe, source.getSnapshot);
      }

      /** Side chats created in this page lifetime (the bridge's routing table). */
      const children = new Set();

      /**
       * Undo closures for every installed Session-command patch. Installation is
       * lazy (the remote namespace may not exist when the entry activates), so
       * the teardown is registered once here and each patch appends its own undo.
       */
      const bridgeRestores = [];

      ctx.effect(
        () => () => {
          for (const restore of bridgeRestores.splice(0)) restore();
          bridged = false;
        },
        'side-chat: session-command bridge',
      );

      /**
       * Divert the Session commands a side chat cannot use. The Host keeps the
       * thread out of the subagent runtime on purpose, so its prompts must never
       * travel through subagent delivery: that path reports the answer back to
       * the main Session, which a side chat must never do.
       *
       * The patch owns its lifecycle: every wrapped method pushes an undo, and
       * the undo only runs while the patched slot is still this plugin's wrapper,
       * so a later patch by someone else is never clobbered.
       */

      function bridgeSessionCommands() {
        if (bridged) return;
        try {
          const remote = ctx.remote !== undefined ? ctx.remote : ctx.get('remote');
          const namespace = remote === undefined || remote === null ? undefined : remote.session;
          if (namespace === undefined || namespace === null) return;
          const fail = (error) => ({
            ok: false,
            error: { code: 'side-chat/bridge-failed', message: message(error), details: {} },
          });
          const settle = (value) => ({ ok: true, value: value === undefined ? {} : value });
          /** `prompt` answers the reference implementation's shape, `messageId` key included. */
          const promptValue = (value) => ({ accepted: true, messageId: value === undefined ? undefined : value.messageId });
          const forward = (name, invoke) => {
            const original = namespace[name];
            if (typeof original !== 'function') return;
            const wrapper = function (request, signal) {
              if (request === undefined || request === null || !children.has(request.sessionId)) {
                return original.call(this, request, signal);
              }
              return invoke(request, signal).then(settle, fail);
            };
            namespace[name] = wrapper;
            bridgeRestores.push(() => {
              if (namespace[name] === wrapper) namespace[name] = original;
            });
          };
          forward('prompt', (request) =>
            callHost('prompt', {
              childId: request.sessionId,
              requestId: request.requestId,
              mode: request.mode,
              content: request.content,
              clientTimeZone: request.clientTimeZone,
            }).then(promptValue),
          );
          forward('cancel', (request) => callHost('cancel', { childId: request.sessionId }).then(() => ({ accepted: true })));
          forward('selectModel', (request) =>
            callHost('model', {
              childId: request.sessionId,
              provider: request.provider,
              model: request.model,
              reasoningEffort: request.reasoningEffort,
            }),
          );
          bridged = true;
        } catch (error) {
          console.warn('side-chat: cannot bridge Session commands', error);
        }
      }

      const liveKey = (childId) => LIVE_PREFIX + childId;
      const writeLive = (childId) => writeStorage('sessionStorage', liveKey(childId), bootToken);
      const clearLive = (childId) => removeStorage('sessionStorage', liveKey(childId));
      const isLiveHere = (childId) => readStorage('sessionStorage', liveKey(childId)) === bootToken;

      function remember(parentId, childId, address) {
        let group = openByMain.get(parentId);
        if (group === undefined) {
          group = new Map();
          openByMain.set(parentId, group);
        }
        group.set(childId, address);
      }

      function forget(parentId, childId) {
        const group = openByMain.get(parentId);
        if (group === undefined) return;
        group.delete(childId);
        if (group.size === 0) {
          openByMain.delete(parentId);
          // No side chat of this main Session is open any more: drop the cached
          // list source too, so a long page keeps no subscription per main
          // Session it ever touched.
          blankSources.delete(parentId);
        }
      }

      function findOpen(parentId) {
        const group = openByMain.get(parentId);
        if (group === undefined) return undefined;
        const list = ctx.sessions.list.getSnapshot();
        const entries = [...group.entries()];
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const childId = entries[index][0];
          const summary = list.byId[childId];
          if (summary !== undefined && summary.removed !== true) return { childId: childId, address: entries[index][1] };
        }
        return undefined;
      }

      /**
       * Close one side chat: the Host disposes the thread, so nothing is
       * archived and nothing survives in any Workspace list. A retryable failure
       * (I/O or transport) is retried here; a refusal is not, because no amount
       * of retrying turns a foreign Session into this plugin's thread. A retryable
       * failure that outlives the retries is recorded per thread and offered back
       * on the guide card, so a transient lock never leaves a thread nobody can
       * reach.
       * @param childId - the side-chat Session.
       * @param parentId - its main Session, when known.
       * @returns whether the thread is gone.
       */
      async function closeSide(childId, parentId) {
        children.delete(childId);
        for (let attempt = 0; ; attempt += 1) {
          try {
            const result = await callHost('close', { childId: childId });
            if (result !== undefined && result.closed === false) {
              // The Host refused: not a thread this plugin owns.
              console.warn('side-chat: the Host refused to close ' + childId + ' (' + String(result.reason) + ')');
              resolveCloseIssue(parentId, childId);
              return false;
            }
            resolveCloseIssue(parentId, childId);
            return true;
          } catch (error) {
            const code =
              error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'side-chat/io';
            const retryable = code === 'side-chat/io' || code === 'side-chat/offline';
            if (!retryable) {
              console.warn('side-chat: cannot close ' + childId, error);
              resolveCloseIssue(parentId, childId);
              return false;
            }
            if (attempt >= 2) {
              console.warn('side-chat: cannot close ' + childId, error);
              noteCloseIssue(parentId, childId, code);
              return false;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
          }
        }
      }

      /**
       * Retry every failed close of one main Session. The Host deliberately keeps
       * the map entry and the log when a dispose fails, so a lock that has since
       * been released finishes the job.
       * @param parentId - the main Session.
       */
      async function retryCloseIssues(parentId) {
        for (const issue of snapshotCloseIssues(parentId)) await closeSide(issue.childId, parentId);
      }

      /** Backoff between catalog refreshes while a new Session is not listed yet. */
      const CATALOG_BACKOFF_MS = [200, 300, 400, 500, 600];

      /**
       * Resolve after one delay, or as soon as the tab is cancelled.
       * @param ms - delay in milliseconds.
       * @param signal - the tab's cancellation, when it has one.
       * @returns completion.
       */
      function delay(ms, signal) {
        if (signal === undefined || signal === null) return new Promise((resolve) => window.setTimeout(resolve, ms));
        if (signal.aborted) return Promise.resolve();
        return new Promise((resolve) => {
          const timer = window.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          const onAbort = () => {
            window.clearTimeout(timer);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }

      /** Whether the Client catalog already lists one Session. */
      function catalogued(childId) {
        return ctx.sessions.list.getSnapshot().byId[childId] !== undefined;
      }

      /**
       * Retain one side-chat Session, waiting out the catalog race. `open`
       * answers over HTTP while the catalog row arrives over the socket, so the
       * first `retain` can legitimately see "unknown session": refresh the
       * catalog and retry with backoff. Any other failure is rethrown at once,
       * because refreshing cannot fix it.
       * @param childId - the side-chat Session.
       * @param signal - the tab's cancellation.
       * @returns the retained Session reference.
       */
      async function retainSideChat(childId, signal) {
        let lastError;
        for (let attempt = 0; attempt <= CATALOG_BACKOFF_MS.length; attempt += 1) {
          if (signal !== undefined && signal !== null && signal.aborted) {
            throw new HostError('side-chat/offline', 'the tab was closed');
          }
          if (!catalogued(childId)) {
            try {
              await ctx.sessions.refresh();
            } catch (error) {
              console.warn('side-chat: catalog refresh failed', error);
            }
            if (attempt < CATALOG_BACKOFF_MS.length) await delay(CATALOG_BACKOFF_MS[attempt], signal);
          }
          try {
            return ctx.sessions.retain(childId, { source: SOURCE, signal: signal });
          } catch (error) {
            lastError = error;
            // A failure that is not the catalog gap will not heal by waiting.
            if (catalogued(childId)) throw error;
          }
        }
        throw new HostError('side-chat/retain-pending', message(lastError));
      }

      /**
       * The newest committed event seq of a Session, with the reason a read
       * failed. `seq === undefined` means "could not read it"; `-1` means "read
       * it, and the Session has committed nothing".
       * @param sessionId - Session to read.
       * @returns `{ seq, reason }`.
       */
      async function latestSeq(sessionId) {
        const remote = ctx.get('remote.session') ?? (ctx.get('remote') || {}).session;
        let reason = '';
        if (remote !== undefined && typeof remote.state === 'function') {
          try {
            const result = await remote.state({ sessionId: sessionId });
            if (result !== undefined && result.ok === true && Number.isSafeInteger(result.value && result.value.cursor)) {
              return { seq: result.value.cursor, reason: '' };
            }
            reason = 'session/state 没有返回游标';
          } catch (error) {
            reason = 'session/state 读取失败：' + message(error);
          }
        } else {
          reason = 'session/state 不可用';
        }
        try {
          const seq = await ctx.sessions.using(sessionId, { source: SOURCE }, async (reference) => {
            await reference.ready;
            const entries = reference.binding.eventSource.getSnapshot().entries;
            const last = entries[entries.length - 1];
            const lastSeq = last && last.event ? last.event.seq : undefined;
            return Number.isSafeInteger(lastSeq) ? lastSeq : -1;
          });
          return { seq: seq, reason: '' };
        } catch (error) {
          return { seq: undefined, reason: reason === '' ? '会话事件读取失败：' + message(error) : reason };
        }
      }

      /**
       * Ask the Host for one side chat: a continuable Session seeded from the
       * main Session's newest committed event, then return the resource address
       * that opens it.
       * @param parentId - main Session to inherit.
       * @param knownSeq - already known boundary, when the caller has one.
       * @param mode - `reply`, `read`, or `full`; defaults to the remembered one.
       */
      async function createSideChat(parentId, knownSeq, mode) {
        // The remote namespace may not exist yet when the entry activates, so the
        // bridge is retried on the first real use.
        bridgeSessionCommands();
        // The Host decides the boundary from its own newest committed seq, so the
        // request carries no `atSeq`: the probe below only feeds the tab address,
        // and the answer's own `atSeq` stays authoritative.
        const probed = Number.isSafeInteger(knownSeq) ? knownSeq : (await latestSeq(parentId)).seq;
        const chosen = normalizeMode(mode === undefined ? storedMode() : mode);
        let created;
        try {
          created = await callHost('open', { sessionId: parentId, mode: chosen });
        } catch (error) {
          throw error instanceof HostError ? error : new HostError('side-chat/io', message(error));
        }
        if (created === undefined || typeof created.childId !== 'string') {
          throw new HostError('side-chat/io', 'the Host answered open without a child id');
        }
        const childId = created.childId;
        const childAtSeq = Number.isSafeInteger(created.atSeq)
          ? created.atSeq
          : Number.isSafeInteger(probed) && probed >= 0
            ? probed
            : undefined;
        const childMode = normalizeMode(created.mode === undefined ? chosen : created.mode);
        const label = typeof created.label === 'string' ? created.label : '';
        const address = sideChatAddress(childId, parentId, childAtSeq, Date.now(), childMode, label);
        children.add(childId);
        remember(parentId, childId, address);
        writeLive(childId);
        return { childId: childId, address: address, atSeq: childAtSeq, mode: childMode, label: label };
      }

      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = '@aixineiar/dsh-side-chat';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'side-chat: styles');

      const openResource = (address) => ctx.sidebarRight.openResource(address, { kind: CHAT_KIND });

      ctx.effect(
        () =>
          ctx.sidebarRight.registerCloseHandler(CHAT_KIND, (sessionId, tab) => {
            const parsed = parseSideChatAddress(tab && tab.contentId);
            if (parsed === undefined) return;
            forget(parsed.parentId, parsed.childId);
            clearLive(parsed.childId);
            void closeSide(parsed.childId, parsed.parentId);
          }),
        'side-chat: close cleanup',
      );

      function SideChatButton(props) {
        const sessionId = props.sessionId;
        const busyState = useState(false);
        const busy = busyState[0];
        const setBusy = busyState[1];
        const failureState = useState('');
        const failure = failureState[0];
        const setFailure = failureState[1];
        const buttonRef = useRef(null);
        const bubbleRef = useRef(null);
        /** Synchronous guard: two clicks in one tick both read `busy === false`. */
        const busyRef = useRef(false);
        const timerRef = useRef(0);
        const tipState = useState(false);
        const tipOpen = tipState[0];
        const setTipOpen = tipState[1];
        const tipIdState = useState(() => 'dsh-side-chat-tip-' + Math.random().toString(36).slice(2));
        const tipId = tipIdState[0];
        const label = failure === '' ? t('button.tooltip') : failure;
        const clearTipTimer = () => {
          if (timerRef.current !== 0) {
            window.clearTimeout(timerRef.current);
            timerRef.current = 0;
          }
        };
        const closeTip = () => {
          clearTipTimer();
          setTipOpen(false);
        };
        const scheduleTip = () => {
          clearTipTimer();
          timerRef.current = window.setTimeout(() => {
            timerRef.current = 0;
            setTipOpen(true);
          }, 500);
        };
        useEffect(() => () => clearTipTimer(), []);
        useEffect(() => {
          if (!tipOpen) return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape' || event.key === 'Tab') closeTip();
          };
          document.addEventListener('keydown', onKey, true);
          return () => document.removeEventListener('keydown', onKey, true);
        }, [tipOpen]);
        useLayoutEffect(() => {
          if (!tipOpen) return;
          const bubble = bubbleRef.current;
          const trigger = buttonRef.current;
          if (bubble === null || trigger === null) return;
          const triggerRect = trigger.getBoundingClientRect();
          const bubbleRect = bubble.getBoundingClientRect();
          let left = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2;
          left = Math.max(8, Math.min(left, window.innerWidth - bubbleRect.width - 8));
          let top = triggerRect.bottom + 6;
          if (top + bubbleRect.height > window.innerHeight - 8) {
            top = Math.max(8, triggerRect.top - bubbleRect.height - 6);
          }
          bubble.style.left = Math.round(left) + 'px';
          bubble.style.top = Math.round(top) + 'px';
          bubble.style.visibility = 'visible';
        }, [tipOpen, label]);
        const start = () => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setFailure('');
          void (async () => {
            try {
              const existing = findOpen(sessionId);
              if (existing !== undefined) {
                openResource(existing.address);
                return;
              }
              const created = await createSideChat(sessionId);
              openResource(created.address);
            } catch (error) {
              console.warn('side-chat: open failed', error);
              setFailure(errorText(error, 'error.failed'));
              window.setTimeout(() => setFailure(''), 5000);
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          })();
        };
        return h(
          React.Fragment,
          null,
          h(
            'button',
            {
              ref: buttonRef,
              type: 'button',
              className: 'dsh-side-chat-button',
              'data-side-chat-button': '',
              'data-failed': failure === '' ? undefined : 'true',
              'aria-label': t('button.label'),
              'aria-describedby': tipOpen ? tipId : undefined,
              disabled: busy,
              onPointerEnter: (event) => {
                if (event.pointerType === 'mouse') scheduleTip();
              },
              onPointerLeave: closeTip,
              onPointerDown: closeTip,
              onFocus: scheduleTip,
              onBlur: closeTip,
              onClick: start,
            },
            h(SideChatGlyph),
          ),
          tipOpen
            ? ReactDOM.createPortal(
                h(
                  'span',
                  {
                    ref: bubbleRef,
                    role: 'tooltip',
                    id: tipId,
                    className: 'dsh-side-chat-tip-bubble',
                    style: { visibility: 'hidden' },
                  },
                  label,
                ),
                document.body,
              )
            : null,
        );
      }

      function SideChatStatus(props) {
        const parsed = props.parsed;
        const tab = props.tab;
        const useSessions = props.useSessions;
        const running = useSessions((state) => {
          const summary = state.byId[parsed.parentId];
          return summary !== undefined && summary.running === true;
        });
        const phaseState = useState('idle');
        const phase = phaseState[0];
        const setPhase = phaseState[1];
        const failureState = useState('');
        const failure = failureState[0];
        const setFailure = failureState[1];
        const when = parsed.at === undefined ? '' : new Date(parsed.at).toLocaleString();
        const sync = () => {
          if (phase === 'busy') return;
          setPhase('busy');
          setFailure('');
          void (async () => {
            try {
              const probed = await latestSeq(parsed.parentId);
              if (probed.seq === undefined) {
                // "Could not read it" is not "nothing changed": say which one it was.
                setFailure(probed.reason);
                setPhase('failed');
                window.setTimeout(() => setPhase('idle'), 4000);
                return;
              }
              if (probed.seq < 0) {
                setPhase('empty');
                window.setTimeout(() => setPhase('idle'), 3000);
                return;
              }
              if (probed.seq <= (parsed.atSeq === undefined ? -1 : parsed.atSeq)) {
                setPhase('latest');
                window.setTimeout(() => setPhase('idle'), 2000);
                return;
              }
              // Keep this thread's mode: the remembered mode belongs to the card,
              // not to a conversation the user already opened.
              const created = await createSideChat(parsed.parentId, probed.seq, parsed.mode);
              const actions = tab && tab.actions;
              if (actions !== undefined && typeof actions.openResource === 'function') {
                actions.openResource(created.address, { kind: CHAT_KIND, replaceTab: true });
              } else {
                openResource(created.address);
              }
              setPhase('idle');
            } catch (error) {
              console.warn('side-chat: sync failed', error);
              setFailure(errorText(error, 'error.io'));
              setPhase('failed');
              window.setTimeout(() => setPhase('idle'), 3000);
            }
          })();
        };
        return h(
          'div',
          { className: 'dsh-side-chat-status' },
          h('span', { className: 'dsh-side-chat-status-label' }, t('status.snapshot', { time: when })),
          running ? h('span', {}, '· ' + t('status.running')) : null,
          h('span', { className: 'dsh-side-chat-status-spacer' }),
          phase === 'latest' ? h('span', {}, t('status.latest')) : null,
          phase === 'empty' ? h('span', {}, t('status.empty')) : null,
          phase === 'failed'
            ? h('span', { className: 'dsh-side-chat-failure' }, t('status.failed') + (failure === '' ? '' : '：' + failure))
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-side-chat-link',
              title: t('status.syncHint'),
              disabled: phase === 'busy',
              onClick: sync,
            },
            phase === 'busy' ? t('status.syncing') : t('status.sync'),
          ),
        );
      }

      /**
       * The shared Conversation content, rendered inside the SessionProvider so
       * its session-scoped hooks bind to the side-chat Session. This is the same
       * factory the main conversation and the sidebar subagent chat use.
       */
      function SideChatConversation(props) {
        const renderFactorySlot = props.renderFactorySlot;
        if (typeof renderFactorySlot !== 'function') return null;
        return renderFactorySlot(
          'conversation.content',
          { variant: 'embedded', phase: 'active', hero: false },
          { slots: { views: FixedChatView } },
        );
      }

      /** Fix the embedded occurrence to the Chat view, as the sidebar chat does. */
      function FixedChatView(viewProps) {
        return viewProps.renderSlot('conversation.session', { view: 'chat' });
      }

      /** Keeps one sidebar tab from blanking the whole pane when its body throws. */
      class SideChatBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { error: null };
        }
        static getDerivedStateFromError(error) {
          return { error: error };
        }
        componentDidCatch(error, info) {
          console.error('side-chat: tab body crashed', error, info);
        }
        render() {
          const error = this.state.error;
          if (error === null) return this.props.children;
          return h(
            'div',
            { className: 'dsh-side-chat-launcher' },
            h('h3', {}, t('tab.crashed')),
            h('pre', { className: 'dsh-side-chat-stack' }, String((error && (error.stack || error.message)) || error)),
          );
        }
      }

      function SideChatTab(props) {
        return h(SideChatBoundary, null, h(SideChatTabBody, props));
      }

      /**
       * The resource-consuming half of the tab. It is mounted under a `key`, so
       * the retry button can unmount and remount it: the resource registry
       * restarts a provider coroutine when its last consumer leaves and a new one
       * arrives, which is the retry hook it exposes.
       */
      function SideChatResourceView(props) {
        const resource = props.useResource(props.contentId);
        const value = resource.value;
        if (value !== undefined) {
          if (typeof props.SessionProvider !== 'function') {
            return h(
              'div',
              { className: 'dsh-side-chat-launcher' },
              h('h3', {}, t('tab.noProvider')),
              h(
                'pre',
                { className: 'dsh-side-chat-stack' },
                'slot 渲染器没有注入 SessionProvider：注册时必须声明一个非 root 子槽。',
              ),
            );
          }
          return h(
            props.SessionProvider,
            { session: value.reference },
            h(SideChatConversation, { renderFactorySlot: props.renderFactorySlot }),
          );
        }
        if (resource.status === 'failed') {
          return h(
            'div',
            { className: 'dsh-side-chat-launcher' },
            h('h3', {}, t('tab.failed')),
            h('p', {}, errorText(resource.failure, 'tab.failed')),
            h(
              'button',
              { type: 'button', className: 'dsh-side-chat-link', onClick: props.onRetry },
              t('action.retry'),
            ),
          );
        }
        return h('div', { className: 'dsh-side-chat-launcher' }, h('p', {}, t('tab.loading')));
      }

      function SideChatTabBody(props) {
        const useTabInfo = props.useTabInfo;
        const info = useTabInfo();
        const contentId = info.tab && info.tab.contentId;
        const parsed = parseSideChatAddress(contentId);
        const actions = info.tab && info.tab.actions;
        const attemptState = useState(0);
        const attempt = attemptState[0];
        const setAttempt = attemptState[1];
        const childId = parsed === undefined ? '' : parsed.childId;

        useEffect(() => {
          if (parsed === undefined) return;
          if (isLiveHere(parsed.childId)) return;
          // Restored from a previous page lifetime: side chats never survive it.
          clearLive(parsed.childId);
          forget(parsed.parentId, parsed.childId);
          void closeSide(parsed.childId, parsed.parentId);
          if (actions !== undefined && typeof actions.close === 'function') actions.close();
        }, [childId]);

        return h(
          'div',
          { className: 'dsh-side-chat-root', 'data-side-chat': '' },
          parsed === undefined
            ? h(
                'div',
                { className: 'dsh-side-chat-status' },
                h('span', { className: 'dsh-side-chat-status-label' }, t('tab.unparsable')),
              )
            : h(SideChatStatus, {
                parsed: parsed,
                tab: info.tab,
                useSessions: props.useSessions,
              }),
          h(
            'div',
            { className: 'dsh-side-chat-body' },
            parsed === undefined
              ? h('div', { className: 'dsh-side-chat-launcher' }, h('pre', { className: 'dsh-side-chat-stack' }, String(contentId)))
              : h(SideChatResourceView, {
                  key: childId + ':' + String(attempt),
                  useResource: props.useResource,
                  contentId: contentId,
                  SessionProvider: props.SessionProvider,
                  renderFactorySlot: props.renderFactorySlot,
                  onRetry: () => setAttempt((value) => value + 1),
                }),
          ),
        );
      }

      /**
       * The guide entry's page. It is never shown as a page: clicking the card
       * forks the side chat immediately and replaces this tab with it.
       */
      function SideChatLauncher(props) {
        const sessionId = props.sessionId;
        const info = props.useTabInfo();
        const failureState = useState('');
        const failure = failureState[0];
        const setFailure = failureState[1];
        const startedRef = useRef(false);
        useEffect(() => {
          if (startedRef.current) return;
          startedRef.current = true;
          void (async () => {
            try {
              const created = await createSideChat(sessionId);
              const actions = info.tab && info.tab.actions;
              if (actions !== undefined && typeof actions.openResource === 'function') {
                actions.openResource(created.address, { kind: CHAT_KIND, replaceTab: true });
              } else {
                openResource(created.address);
              }
            } catch (error) {
              console.warn('side-chat: launcher failed', error);
              setFailure(errorText(error, 'error.failed'));
            }
          })();
        }, []);
        return h(
          'div',
          { className: 'dsh-side-chat-launcher' },
          h('p', {}, failure === '' ? t('launcher.opening') : failure),
        );
      }

      /** Chevron drawn when the shared UI kit is unavailable. */
      function LocalChevron() {
        return h(
          'svg',
          { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true, focusable: 'false' },
          h('path', {
            d: 'M4 6.5 8 10.5 12 6.5',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        );
      }

      /**
       * Fallback for the shared `Menu`: the same rows and the same dismiss
       * rules (outside pointer, Escape), drawn with this plugin's own CSS. It
       * exists so a missing UI kit cannot throw during render.
       */
      function LocalMenu(props) {
        const open = props.open === true;
        const items = Array.isArray(props.items) ? props.items : [];
        const wrapRef = useRef(null);
        const posState = useState(null);
        const pos = posState[0];
        const setPos = posState[1];
        useEffect(() => {
          if (!open) {
            setPos(null);
            return undefined;
          }
          const place = () => {
            const node = wrapRef.current;
            if (node === null) return;
            const rect = node.getBoundingClientRect();
            const width = 190;
            const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
            const top = Math.min(rect.bottom + 4, window.innerHeight - 24);
            setPos({ left: Math.round(left), top: Math.round(top) });
          };
          place();
          const onPointer = (event) => {
            const node = wrapRef.current;
            if (node !== null && event.target instanceof Node && node.contains(event.target)) return;
            props.onClose();
          };
          const onKey = (event) => {
            if (event.key === 'Escape') props.onClose();
          };
          document.addEventListener('pointerdown', onPointer, true);
          document.addEventListener('keydown', onKey, true);
          window.addEventListener('resize', place);
          return () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', place);
          };
        }, [open]);
        return h(
          'span',
          { className: 'dsh-side-chat-guide-menu', ref: wrapRef },
          props.anchor,
          open
            ? h(
                'div',
                {
                  className: 'dsh-side-chat-menu',
                  role: 'menu',
                  style: pos === null ? { visibility: 'hidden' } : { left: pos.left + 'px', top: pos.top + 'px' },
                },
                items.map((item) =>
                  h(
                    'button',
                    {
                      key: item.id,
                      type: 'button',
                      role: 'menuitemradio',
                      'aria-checked': item.id === props.selectedId,
                      'data-selected': item.id === props.selectedId ? 'true' : undefined,
                      className: 'dsh-side-chat-menu-item',
                      onClick: () => props.onSelect(item.id),
                    },
                    h(
                      'span',
                      { className: 'dsh-side-chat-menu-check' },
                      item.id === props.selectedId
                        ? h(
                            'svg',
                            { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true },
                            h('path', {
                              d: 'M3.5 8.5 6.5 11.5 12.5 4.5',
                              stroke: 'currentColor',
                              strokeWidth: 1.6,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                            }),
                          )
                        : null,
                    ),
                    h('span', { className: 'dsh-side-chat-menu-text' }, item.label),
                  ),
                ),
              )
            : null,
        );
      }

      /**
       * The right-sidebar guide card: the card itself starts a side chat with the
       * remembered mode, and the chevron beside its title opens the mode menu —
       * the same split-button shape the terminal card uses.
       *
       * The card also owns the only recovery entry for a close that failed: the
       * Host keeps such a thread alive on purpose, so a retry has to be reachable
       * from somewhere the user returns to.
       */
      function SideChatGuide(props) {
        const sessionId = props.sessionId;
        const label = props.t === undefined ? t : props.t;
        const info = props.useTabInfo();
        // Shared UI kit; anything missing degrades to the local menu below.
        const kit = primitivesModule() ?? null;
        const Menu = kit !== null ? kit.Menu : LocalMenu;
        const AnchorButton = kit !== null ? kit.Button : 'button';
        const Chevron = kit !== null ? kit.IconChevronDownOutlineRegular : LocalChevron;
        const closeIssues = useCloseIssues(sessionId);
        const blank = useBlankSession(sessionId);
        const modeState = useState(() => storedMode());
        const mode = modeState[0];
        const setMode = modeState[1];
        const openState = useState(false);
        const open = openState[0];
        const setOpen = openState[1];
        const busyState = useState(false);
        const busy = busyState[0];
        const setBusy = busyState[1];
        const busyRef = useRef(false);
        const retryingState = useState(false);
        const retrying = retryingState[0];
        const setRetrying = retryingState[1];
        const failureState = useState('');
        const failure = failureState[0];
        const setFailure = failureState[1];
        const issuesText = closeIssues.length === 0 ? '' : label('guide.closeIssues', { count: closeIssues.length });
        const statusText =
          failure !== ''
            ? failure
            : blank
              ? label('guide.blank')
              : issuesText !== ''
                ? issuesText
                : label('guide.status', { mode: label('mode.' + mode) });
        const note = open ? label('mode.switchHint') : statusText;

        const start = (chosen) => {
          if (busyRef.current || blank) return;
          busyRef.current = true;
          setOpen(false);
          rememberMode(chosen);
          setMode(normalizeMode(chosen));
          setBusy(true);
          setFailure('');
          void (async () => {
            try {
              const created = await createSideChat(sessionId, undefined, chosen);
              const actions = info.tab && info.tab.actions;
              if (actions !== undefined && typeof actions.openResource === 'function') {
                actions.openResource(created.address, { kind: CHAT_KIND, replaceTab: true });
              } else {
                openResource(created.address);
              }
            } catch (error) {
              console.warn('side-chat: guide start failed', error);
              setFailure(errorText(error, 'error.failed'));
              window.setTimeout(() => setFailure(''), 6000);
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
          })();
        };

        const retryClose = () => {
          if (retrying) return;
          setRetrying(true);
          void (async () => {
            try {
              await retryCloseIssues(sessionId);
            } catch (error) {
              console.warn('side-chat: close retry failed', error);
            } finally {
              setRetrying(false);
            }
          })();
        };

        return h(
          'div',
          {
            className: 'dsh-side-chat-guide',
            'data-sidebar-right-guide-entry': props.kind,
          },
          h('button', {
            type: 'button',
            className: 'dsh-side-chat-guide-main',
            'aria-label': note === '' ? String(props.title) : note,
            disabled: busy || blank,
            onClick: () => start(mode),
          }),
          h(
            'span',
            { className: 'dsh-side-chat-guide-icon', 'aria-hidden': 'true' },
            h(SideChatGlyph),
          ),
          h(
            'span',
            { className: 'dsh-side-chat-guide-text' },
            h(
              'span',
              { className: 'dsh-side-chat-guide-title-row' },
              h('span', { className: 'dsh-side-chat-guide-title', 'aria-hidden': 'true' }, props.title),
              h(
                'span',
                { className: 'dsh-side-chat-guide-menu' },
                h(Menu, {
                  open: open,
                  portal: true,
                  autoFocus: true,
                  align: 'end',
                  items: MODES.map((candidate) => ({ id: candidate, label: label('mode.' + candidate) })),
                  selectedId: mode,
                  onClose: () => setOpen(false),
                  onSelect: (id) => {
                    setOpen(false);
                    start(id);
                  },
                  anchor: h(
                    AnchorButton,
                    {
                      ...(AnchorButton === 'button' ? {} : { variant: 'ghost' }),
                      className: 'dsh-side-chat-guide-trigger',
                      'aria-label': label('mode.label'),
                      'aria-haspopup': 'menu',
                      'aria-expanded': open,
                      disabled: busy || blank,
                      onClick: () => setOpen((value) => !value),
                    },
                    h(Chevron, {}),
                  ),
                }),
              ),
            ),
            h(
              'span',
              { className: 'dsh-side-chat-guide-desc', 'aria-hidden': 'true' },
              note === '' ? label('guide.status', { mode: label('mode.' + mode) }) : note,
            ),
            closeIssues.length === 0
              ? null
              : h(
                  'span',
                  { className: 'dsh-side-chat-guide-desc' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-side-chat-retry',
                      disabled: retrying,
                      onClick: retryClose,
                    },
                    retrying ? label('guide.retryingClose') : label('guide.retryClose'),
                  ),
                ),
          ),
        );
      }

      /**
       * A guide card is decorative next to the conversation: its failure must
       * stay inside the sidebar, never blank the application.
       */
      class SideChatGuideBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { error: null };
        }
        static getDerivedStateFromError(error) {
          return { error: error };
        }
        componentDidCatch(error, info) {
          console.error('side-chat: guide card crashed', error, info);
        }
        render() {
          if (this.state.error === null) return this.props.children;
          // An empty div would drop the entry without a trace. Keep the card's
          // shape so the user can see that this entry exists and failed.
          return h(
            'div',
            { className: 'dsh-side-chat-guide', role: 'presentation' },
            h('span', { className: 'dsh-side-chat-guide-icon', 'aria-hidden': 'true' }, h(SideChatGlyph)),
            h(
              'span',
              { className: 'dsh-side-chat-guide-text' },
              h('span', { className: 'dsh-side-chat-guide-title' }, t('guide.title')),
              h('span', { className: 'dsh-side-chat-guide-desc' }, t('error.unknown')),
            ),
          );
        }
      }

      function SideChatGuideEntry(props) {
        return h(SideChatGuideBoundary, null, h(SideChatGuide, props));
      }


      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'side-chat',
            order: 90,
            locale: NS,
          },
          SideChatButton,
        ),
      );

      ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
        scope.effect(
          () =>
            scope.resources.register({
              protocol: PROTOCOL,
              async *open(address, options) {
                const parsed = parseSideChatAddress(address);
                if (parsed === undefined) {
                  yield {
                    ok: false,
                    error: { code: 'side-chat/bad-address', message: 'invalid side-chat address', details: { address: String(address) } },
                  };
                  return;
                }
                const signal = options.signal;
                if (signal.aborted) return;
                let reference;
                try {
                  // Retained by ID, not by subagent address: an addressed Session
                  // loses the native model picker, and its prompts would route
                  // through subagent delivery, which reports back to the parent.
                  // The bridge above answers the commands this Session refuses;
                  // `ClientSessionReference` itself carries only `binding`, so the
                  // send always arrives through `remote.session.prompt`.
                  reference = await retainSideChat(parsed.childId, signal);
                } catch (error) {
                  yield {
                    ok: false,
                    error: {
                      code:
                        error !== null && typeof error === 'object' && typeof error.code === 'string'
                          ? error.code
                          : 'side-chat/retain-pending',
                      message: message(error),
                      details: { sessionId: parsed.childId },
                    },
                  };
                  return;
                }
                try {
                  yield { ok: true, value: { reference: reference, address: parsed } };
                  await abortable(signal);
                } finally {
                  reference.release();
                }
              },
            }),
          'side-chat: resource protocol',
        );

        scope.effect(
          () =>
            scope.sidebarRightTabs.register({
              id: CHAT_ID,
              kind: CHAT_KIND,
              patterns: [SCHEME + '**'],
              priority: 'extension',
              canOpen: (address) => parseSideChatAddress(address) !== undefined,
              title: (address) => {
                const parsed = parseSideChatAddress(address);
                if (parsed !== undefined && parsed.label !== '') return t('tab.sideTitle', { title: parsed.label });
                return t('tab.title');
              },
            }),
          'side-chat: conversation tab type',
        );

        scope.effect(
          () =>
            scope.sidebarRightTabs.register({
              id: LAUNCHER_ID,
              kind: LAUNCHER_KIND,
              title: () => t('guide.title'),
              guide: [
                {
                  id: 'side-chat-launcher',
                  // Right after the browser card (30); session inspector sits at 60.
                  order: 31,
                  icon: SideChatGlyph,
                  title: () => t('guide.title'),
                  description: () => t('guide.description'),
                },
              ],
            }),
          'side-chat: launcher tab type',
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: CHAT_ID,
              locale: NS,
              // The renderer injects SessionProvider (and renderSlot) only when an
              // entry declares a non-root child slot. Every SlotMap session slot is
              // already declared by a shipped entry, so declare one fresh local key:
              // nothing renders it, and SessionProvider is what the body needs to
              // bind the shared Conversation factory to the side-chat Session.
              children: {
                'side-chat.conversation': { kind: 'single', scope: 'session' },
              },
            },
            SideChatTab,
          ),
        );

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: LAUNCHER_ID,
              locale: NS,
            },
            SideChatLauncher,
          ),
        );
      });

      // The guide card is decorative next to the entry's real work: a failure
      // here must not take the sidebar's conversation body down with it.
      try {
        ctx.slots.inject('sidebar.right.tab.guide.entry', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.guide.entry',
              key: LAUNCHER_ID,
              locale: NS,
              inject: (sessionId) => ({ sessionId: sessionId }),
            },
            SideChatGuideEntry,
          ),
        );
      } catch (error) {
        console.warn('side-chat: cannot register the guide card', error);
      }
    }

    return { inject: inject, apply: apply };
  },
});
