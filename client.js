window.__ModuleLoader__.load({
  id: '@local/dsh-side-chat',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    /** The loader-provided require, kept so a module can be resolved on first use. */
    const loadModule = require;
    /** Cached shared UI kit (`Menu`, `Button`, icons). */
    let primitivesCache;
    /**
     * Resolve the shared UI kit the shipped sidebar cards use. Resolution is
     * lazy on purpose: a missing module must degrade to the local menu, never
     * fail the client entry (one failed entry aborts the whole web boot).
     * @returns the module namespace, or null when it is unavailable.
     */
    function primitivesModule() {
      if (primitivesCache !== undefined) return primitivesCache;
      try {
        primitivesCache = loadModule('@deepseek-ai/dsh-client-ui-primitives');
      } catch (error) {
        console.warn('side-chat: shared UI kit unavailable', error);
        primitivesCache = null;
      }
      return primitivesCache;
    }
    const h = React.createElement;
    const { useEffect, useLayoutEffect, useRef, useState } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'sideChat';
    /** Resource protocol that carries one side chat. */
    const PROTOCOL = 'sidechat';
    /** Resource address prefix for one side-chat Session. */
    const SCHEME = 'dsh-resource://sidechat/session/';
    /** Stable implementation identity of the conversation tab body. */
    const CHAT_ID = '@local/dsh-side-chat/chat';
    /** Stable implementation identity of the launcher page body. */
    const LAUNCHER_ID = '@local/dsh-side-chat/launcher';
    /** Tab kind of the conversation body. */
    const CHAT_KIND = 'sidechat';
    /** Tab kind of the launcher page. */
    const LAUNCHER_KIND = 'sidechat-launcher';
    /** Page-document key holding this page lifetime's token. */
    const BOOT_KEY = 'dsh.side-chat.boot';
    /** Per-Session key proving a side chat was opened in this page lifetime. */
    const LIVE_PREFIX = 'dsh.side-chat.live.';
    /** Session reference source label for side-chat consumers. */
    const SOURCE = 'sideChat';
    /** Page-document key holding the remembered mode. */
    const MODE_KEY = 'dsh.side-chat.mode';
    /** The three supported modes, in menu order. */
    const MODES = ['reply', 'read', 'full'];

    const zh = {
      'tab.title': '侧边对话',
      'tab.sideTitle': '侧边 · {title}',
      'guide.title': '侧边对话',
      'guide.description': '继承当前会话上下文 · 只回复 / 只读 / 完全继承',
      'mode.label': '侧边对话模式',
      'mode.reply': '只回复',
      'mode.read': '只读',
      'mode.full': '完全继承',
      'mode.reply.hint': '拒绝所有工具，只能基于继承的上下文回答',
      'mode.read.hint': '只能读不能写',
      'mode.full.hint': '与主会话一致，没有任何额外限制',
      'button.label': '侧边对话',
      'button.tooltip': '在右侧栏打开侧边对话（继承本会话上下文，默认只读）',
      'launcher.title': '侧边对话',
      'launcher.body': '在右侧栏打开一个临时对话：它继承当前会话到打开瞬间的全部上下文，沿用当前的智能体预设，可以单独选择模型。',
      'launcher.readonly': '默认只读：只保留读取类工具，改文件、执行命令等写操作会被拒绝。',
      'launcher.temporary': '关闭这个页签就会连同会话一起消失，不会留下历史。',
      'launcher.action': '开始侧边对话',
      'launcher.opening': '正在打开侧边对话…',
      'status.snapshot': '上下文截至 {time}',
      'status.running': '主会话仍在运行',
      'status.sync': '同步最新',
      'status.syncing': '同步中…',
      'status.latest': '已是最新',
      'status.failed': '同步失败',
      'status.closeFailed': '关闭失败',
      'error.failed': '侧边对话打开失败',
    };
    const en = {
      'tab.title': 'Side chat',
      'tab.sideTitle': 'Side · {title}',
      'guide.title': 'New side chat',
      'guide.description': 'Inherits this conversation · reply only / read-only / full',
      'mode.label': 'Side-chat mode',
      'mode.reply': 'Reply only',
      'mode.read': 'Read-only',
      'mode.full': 'Fully inherited',
      'mode.reply.hint': 'No tools at all: answers from the inherited context',
      'mode.read.hint': 'May read, may not write',
      'mode.full.hint': 'Same capabilities as the main conversation, no extra limits',
      'button.label': 'Side chat',
      'button.tooltip': 'Open a side chat in the right sidebar (inherits this conversation, read-only)',
      'launcher.title': 'Side chat',
      'launcher.body': 'Opens a temporary conversation in the right sidebar. It inherits everything this conversation had committed when it opened, keeps the current agent preset, and can pick its own model.',
      'launcher.readonly': 'Read-only by default: only inspection tools stay available; file edits, commands and other writes are refused.',
      'launcher.temporary': 'Closing this tab removes the conversation with it; no history is kept.',
      'launcher.action': 'Start side chat',
      'launcher.opening': 'Opening the side chat…',
      'status.snapshot': 'Context as of {time}',
      'status.running': 'Main conversation running',
      'status.sync': 'Sync latest',
      'status.syncing': 'Syncing…',
      'status.latest': 'Already latest',
      'status.failed': 'Sync failed',
      'status.closeFailed': 'Close failed',
      'error.failed': 'Could not open the side chat',
    };

    const CSS = [
      '.dsh-side-chat-root{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);}',
      '.dsh-side-chat-status{flex:none;display:flex;align-items:center;gap:6px;min-width:0;padding:3px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;}',
      '.dsh-side-chat-status-label{min-width:0;overflow:hidden;text-overflow:ellipsis;}',
      '.dsh-side-chat-status-spacer{flex:1;}',
      '.dsh-side-chat-link{border:0;background:0 0;padding:1px 5px;border-radius:4px;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer;}',
      '.dsh-side-chat-link:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-side-chat-link:disabled{color:var(--dsw-alias-label-secondary);cursor:default;}',
      '.dsh-side-chat-body{flex:1;min-height:0;display:flex;flex-direction:column;}',
      '.dsh-side-chat-body>*{min-height:0;}',
      '.dsh-side-chat-button{border:0;background:0 0;padding:6px;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}',
      '.dsh-side-chat-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dsh-side-chat-button:disabled{opacity:.5;cursor:default;}',
      '.dsh-side-chat-button[data-failed="true"]{color:var(--dsw-alias-state-error-primary);}',
      '.dsh-side-chat-launcher{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;height:100%;padding:22px 18px;overflow:auto;color:var(--dsw-alias-label-primary);}',
      '.dsh-side-chat-launcher h3{margin:0;font-size:14px;line-height:20px;font-weight:600;}',
      '.dsh-side-chat-launcher p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
      '.dsh-side-chat-launcher button[data-primary="true"]{align-self:flex-start;margin-top:2px;border:0;border-radius:8px;padding:6px 14px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:12px;line-height:18px;cursor:pointer;}',
      '.dsh-side-chat-launcher button[data-primary="true"]:disabled{opacity:.5;cursor:default;}',
      '.dsh-side-chat-error{color:var(--dsw-alias-state-error-primary)!important;}',
      '.dsh-side-chat-failure{color:var(--dsw-alias-state-error-primary)!important;}',
      '.dsh-side-chat-tip-bubble{display:inline-flex;align-items:safe center;gap:8px;position:fixed;z-index:1100;width:max-content;box-sizing:border-box;max-width:min(50vw,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;animation:dsh-side-chat-tip-in .15s var(--ds-ease-in-out);}',
      '@keyframes dsh-side-chat-tip-in{from{opacity:0}to{opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.dsh-side-chat-tip-bubble{animation:none;}}',
      '.dsh-side-chat-stack{margin:0;font-size:10px;line-height:14px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;color:var(--dsw-alias-label-secondary);}',
      '.dsh-side-chat-guide{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsl-guide-entry-radius,var(--dsw-radius-xl));background:var(--dsw-alias-bg-layer-1);align-items:center;gap:14px;width:100%;min-height:56px;padding:14px 20px;display:flex;position:relative;overflow:hidden;}',
      '@media (hover:hover){.dsh-side-chat-guide:hover{background:var(--dsw-alias-interactive-bg-hover);}}',
      '.dsh-side-chat-guide-main{border:0;background:0 0;border-radius:0;width:100%;height:100%;position:absolute;inset:0;padding:0;cursor:pointer;}',
      '.dsh-side-chat-guide-main:focus-visible{outline-offset:-2px;}',
      '.dsh-side-chat-guide-main:disabled{cursor:default;}',
      '.dsh-side-chat-guide-icon{width:26px;height:26px;color:var(--dsw-alias-label-secondary);pointer-events:none;flex:none;justify-content:center;align-items:center;display:flex;position:relative;}',
      '.dsh-side-chat-guide-text{pointer-events:none;flex-direction:column;flex:1;gap:3px;min-width:0;display:flex;position:relative;}',
      '.dsh-side-chat-guide-title-row{align-items:center;gap:4px;min-width:0;display:flex;}',
      '.dsh-side-chat-guide-title{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:14px;line-height:1.4;overflow:hidden;}',
      '.dsh-side-chat-guide-desc{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:1.4;overflow:hidden;}',
      '.dsh-side-chat-guide-menu{pointer-events:auto;flex:none;display:flex;position:relative;}',
      '.dsh-side-chat-guide-trigger{border:0;background:0 0;border-radius:4px;flex:none;width:20px;height:20px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--dsw-alias-label-tertiary);}',
      '.dsh-side-chat-guide-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dsh-side-chat-guide-trigger svg{width:14px;height:14px;}',
      '.dsh-side-chat-menu{position:fixed;z-index:1100;min-width:190px;box-sizing:border-box;padding:4px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 24px rgba(0,0,0,.24);display:flex;flex-direction:column;gap:2px;}',
      '.dsh-side-chat-menu-item{border:0;background:0 0;text-align:left;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;cursor:pointer;}',
      '.dsh-side-chat-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsh-side-chat-menu-item[data-selected="true"]{color:var(--dsw-alias-brand-primary);}',
      '.dsh-side-chat-menu-check{width:14px;height:14px;flex:none;display:inline-flex;align-items:center;justify-content:center;}',
      '.dsh-side-chat-menu-text{display:flex;flex-direction:column;gap:1px;min-width:0;}',
      '.dsh-side-chat-menu-hint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);}',
    ].join('');

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
     * Call one Host control action on the side-chat route.
     * @param action - route suffix.
     * @param payload - JSON body.
     * @returns the action's value.
     */
    async function callHost(action, payload) {
      const base = hostHttpBase();
      const url = new URL('dsh-side-chat/api/' + action, base === '' ? 'http://dsh.invalid' : base);
      const response = await fetch(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let envelope;
      try {
        envelope = await response.json();
      } catch (error) {
        envelope = undefined;
      }
      if (envelope === undefined || envelope.ok !== true) {
        const detail =
          envelope !== undefined && envelope.error !== undefined && typeof envelope.error.message === 'string'
            ? envelope.error.message
            : 'HTTP ' + response.status;
        throw new Error(detail);
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

      /** Close failures per parent Session, surfaced on the guide card. */
      const closeIssues = new Map();
      const closeIssueListeners = new Set();

      function noteCloseIssue(parentId, text) {
        if (parentId === undefined || parentId === '') return;
        closeIssues.set(parentId, text);
        for (const listener of closeIssueListeners) listener();
      }

      function clearCloseIssue(parentId) {
        if (!closeIssues.delete(parentId)) return;
        for (const listener of closeIssueListeners) listener();
      }

      /** Live close-failure text for one parent Session. */
      function useCloseIssue(parentId) {
        const state = useState(() => closeIssues.get(parentId) || '');
        const text = state[0];
        const setText = state[1];
        useEffect(() => {
          const listener = () => setText(closeIssues.get(parentId) || '');
          closeIssueListeners.add(listener);
          listener();
          return () => closeIssueListeners.delete(listener);
        }, [parentId]);
        return text;
      }

      /** Side chats created in this page lifetime (the bridge's routing table). */
      const children = new Set();

      /**
       * Divert the Session commands a side chat cannot use. The Host keeps the
       * thread out of the subagent runtime on purpose, so its prompts must never
       * travel through subagent delivery: that path reports the answer back to
       * the main Session, which a side chat must never do.
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
          const forward = (name, invoke) => {
            const original = namespace[name];
            if (typeof original !== 'function') return;
            namespace[name] = function (request, signal) {
              if (request === undefined || request === null || !children.has(request.sessionId)) {
                return original.call(this, request, signal);
              }
              return invoke(request, signal).then(
                (value) => ({ ok: true, value: value === undefined ? {} : value }),
                fail,
              );
            };
          };
          forward('prompt', (request) =>
            callHost('prompt', {
              childId: request.sessionId,
              requestId: request.requestId,
              mode: request.mode,
              content: request.content,
              clientTimeZone: request.clientTimeZone,
            }).then((value) => ({ accepted: true, ...(value === undefined ? {} : { messageId: value.messageId }) })),
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

      /**
       * Give one retained side-chat handle the same bridge, so a send that reads
       * the handle directly (instead of the remote namespace) still lands in this
       * plugin's route.
       * @param handle - retained session reference.
       */
      function bridgeHandle(handle) {
        if (handle === undefined || handle === null || handle.__sideChatHandle === true) return;
        const fail = (error) => ({
          ok: false,
          error: { code: 'side-chat/bridge-failed', message: message(error), details: {} },
        });
        const prompt = handle.prompt;
        const cancel = handle.cancel;
        try {
          handle.prompt = function (content, mode, signal, requestId) {
            if (typeof this.sessionId !== 'string' || !children.has(this.sessionId)) {
              return prompt.call(this, content, mode, signal, requestId);
            }
            const childId = this.sessionId;
            return callHost('prompt', { childId: childId, requestId: requestId, mode: mode, content: content }).then(
              (value) => ({ ok: true, value: { accepted: true, messageId: value === undefined ? undefined : value.messageId } }),
              fail,
            );
          };
          handle.cancel = function (signal) {
            if (typeof this.sessionId !== 'string' || !children.has(this.sessionId)) return cancel.call(this, signal);
            return callHost('cancel', { childId: this.sessionId }).then(() => ({ ok: true, value: { accepted: true } }), fail);
          };
          handle.__sideChatHandle = true;
        } catch (error) {
          console.warn('side-chat: cannot bridge the retained handle', error);
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
        if (group.size === 0) openByMain.delete(parentId);
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
       * archived and nothing survives in any Workspace list. A failed close is
       * retried, then reported on the guide card instead of being swallowed.
       * @param childId - the side-chat Session.
       * @param parentId - its main Session, when known.
       */
      async function closeSide(childId, parentId) {
        children.delete(childId);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await callHost('close', { childId: childId });
            clearCloseIssue(parentId);
            return true;
          } catch (error) {
            if (attempt === 2) {
              console.warn('side-chat: cannot close ' + childId, error);
              noteCloseIssue(parentId, t('status.closeFailed') + '：' + message(error));
              return false;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
          }
        }
        return false;
      }

      /**
       * The newest committed event seq of a Session. The Host reports it as
       * `state.cursor` for a live Agent (session.seq - 1); the retained event
       * window is the fallback when the passive-state endpoint is unavailable.
       */
      async function latestSeq(sessionId) {
        const remote = ctx.get('remote.session') ?? (ctx.get('remote') || {}).session;
        if (remote !== undefined && typeof remote.state === 'function') {
          try {
            const result = await remote.state({ sessionId: sessionId });
            if (result !== undefined && result.ok === true && Number.isSafeInteger(result.value && result.value.cursor)) {
              return result.value.cursor;
            }
          } catch (error) {
            console.warn('side-chat: session.state unavailable', error);
          }
        }
        try {
          return await ctx.sessions.using(sessionId, { source: SOURCE }, async (reference) => {
            await reference.ready;
            const entries = reference.binding.eventSource.getSnapshot().entries;
            const last = entries[entries.length - 1];
            const seq = last && last.event ? last.event.seq : undefined;
            return Number.isSafeInteger(seq) ? seq : -1;
          });
        } catch (error) {
          return -1;
        }
      }

      /**
       * Ask the Host for one side chat: a hidden, continuable Session seeded from
       * the main Session's newest committed event, then return the resource
       * address that opens it.
       * @param parentId - main Session to inherit.
       * @param knownSeq - already known boundary, when the caller has one.
       * @param mode - `reply`, `read`, or `full`; defaults to the remembered one.
       */
      async function createSideChat(parentId, knownSeq, mode) {
        // The remote namespace may not exist yet when the entry activates, so the
        // bridge is retried on the first real use.
        bridgeSessionCommands();
        // The Host decides the boundary from its own newest committed seq; this
        // value is informational only. A failed passive read must not block the
        // open, because the Host still knows the true seq.
        const atSeq = Number.isSafeInteger(knownSeq) ? knownSeq : await latestSeq(parentId);
        const chosen = normalizeMode(mode === undefined ? storedMode() : mode);
        let created;
        try {
          created = await callHost('open', { sessionId: parentId, atSeq: atSeq, mode: chosen });
        } catch (error) {
          throw new Error(t('error.failed') + ': ' + message(error));
        }
        if (created === undefined || typeof created.childId !== 'string') throw new Error(t('error.failed'));
        const childId = created.childId;
        const childAtSeq = Number.isSafeInteger(created.atSeq) ? created.atSeq : atSeq;
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
        tag.dataset.plugin = '@local/dsh-side-chat';
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
              setFailure(message(error));
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
        const when = parsed.at === undefined ? '' : new Date(parsed.at).toLocaleString();
        const sync = () => {
          if (phase === 'busy') return;
          setPhase('busy');
          void (async () => {
            try {
              const next = await latestSeq(parsed.parentId);
              if (!Number.isSafeInteger(next) || next <= (parsed.atSeq === undefined ? -1 : parsed.atSeq)) {
                setPhase('latest');
                window.setTimeout(() => setPhase('idle'), 2000);
                return;
              }
              // Keep this thread's mode: the remembered mode belongs to the card,
              // not to a conversation the user already opened.
              const created = await createSideChat(parsed.parentId, next, parsed.mode);
              const actions = tab && tab.actions;
              if (actions !== undefined && typeof actions.openResource === 'function') {
                actions.openResource(created.address, { kind: CHAT_KIND, replaceTab: true });
              } else {
                openResource(created.address);
              }
              setPhase('idle');
            } catch (error) {
              console.warn('side-chat: sync failed', error);
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
          phase === 'failed' ? h('span', { className: 'dsh-side-chat-failure' }, t('status.failed')) : null,
          h(
            'button',
            { type: 'button', className: 'dsh-side-chat-link', disabled: phase === 'busy', onClick: sync },
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
            h('h3', {}, '侧边对话渲染失败'),
            h('pre', { className: 'dsh-side-chat-stack' }, String((error && (error.stack || error.message)) || error)),
          );
        }
      }

      function SideChatTab(props) {
        return h(SideChatBoundary, null, h(SideChatTabBody, props));
      }

      function SideChatTabBody(props) {
        const useResource = props.useResource;
        const useTabInfo = props.useTabInfo;
        const SessionProvider = props.SessionProvider;
        const info = useTabInfo();
        const contentId = info.tab && info.tab.contentId;
        const parsed = parseSideChatAddress(contentId);
        const resource = useResource(contentId);
        const actions = info.tab && info.tab.actions;

        useEffect(() => {
          if (parsed === undefined) return;
          if (isLiveHere(parsed.childId)) return;
          // Restored from a previous page lifetime: side chats never survive it.
          clearLive(parsed.childId);
          forget(parsed.parentId, parsed.childId);
          void closeSide(parsed.childId, parsed.parentId);
          if (actions !== undefined && typeof actions.close === 'function') actions.close();
        }, [parsed === undefined ? '' : parsed.childId]);

        const value = resource.value;
        const failureText =
          resource.status === 'failed'
            ? String((resource.failure && (resource.failure.message || resource.failure.code)) || resource.failure)
            : '';
        const contentNode =
          value !== undefined
            ? typeof SessionProvider === 'function'
              ? h(
                  SessionProvider,
                  { session: value.reference },
                  h(SideChatConversation, { renderFactorySlot: props.renderFactorySlot }),
                )
              : h(
                  'div',
                  { className: 'dsh-side-chat-launcher' },
                  h('h3', {}, '侧边对话缺少 SessionProvider'),
                  h(
                    'pre',
                    { className: 'dsh-side-chat-stack' },
                    'slot 渲染器没有注入 SessionProvider：注册时必须声明一个非 root 子槽。',
                  ),
                )
            : h(
                'div',
                { className: 'dsh-side-chat-launcher' },
                h('p', {}, '正在加载侧边对话…'),
                failureText === '' ? null : h('pre', { className: 'dsh-side-chat-stack' }, failureText),
                parsed === undefined ? h('pre', { className: 'dsh-side-chat-stack' }, String(contentId)) : null,
              );
        return h(
          'div',
          { className: 'dsh-side-chat-root', 'data-side-chat': '' },
          parsed === undefined
            ? h(
                'div',
                { className: 'dsh-side-chat-status' },
                h('span', { className: 'dsh-side-chat-status-label' }, '无法解析侧边对话地址'),
              )
            : h(SideChatStatus, {
                parsed: parsed,
                tab: info.tab,
                useSessions: props.useSessions,
              }),
          h('div', { className: 'dsh-side-chat-body' }, contentNode),
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
              setFailure(message(error));
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
       */
      function SideChatGuide(props) {
        const sessionId = props.sessionId;
        const label = props.t === undefined ? t : props.t;
        const info = props.useTabInfo();
        // Shared UI kit; anything missing degrades to the local menu below.
        const kit = primitivesModule() ?? null;
        const Menu = kit !== null && kit.Menu ? kit.Menu : LocalMenu;
        const AnchorButton = kit !== null && kit.Button ? kit.Button : 'button';
        const Chevron = kit !== null && kit.IconChevronDownOutlineRegular ? kit.IconChevronDownOutlineRegular : LocalChevron;
        const closeIssue = useCloseIssue(sessionId);
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
        const failureState = useState('');
        const failure = failureState[0];
        const setFailure = failureState[1];
        const note = failure !== '' ? failure : closeIssue;

        const start = (chosen) => {
          if (busyRef.current) return;
          busyRef.current = true;
          setOpen(false);
          rememberMode(chosen);
          setMode(normalizeMode(chosen));
          setBusy(true);
          setFailure('');
          clearCloseIssue(sessionId);
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
              setFailure(message(error));
              window.setTimeout(() => setFailure(''), 6000);
            } finally {
              busyRef.current = false;
              setBusy(false);
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
            disabled: busy,
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
                      onClick: () => setOpen((value) => !value),
                    },
                    h(Chevron, {}),
                  ),
                }),
              ),
            ),
            props.description === undefined
              ? null
              : h('span', { className: 'dsh-side-chat-guide-desc', 'aria-hidden': 'true' }, note === '' ? props.description : note),
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
          return h('div', { className: 'dsh-side-chat-guide', role: 'presentation' });
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
                    error: { code: 'side-chat/bad-address', message: 'side-chat: invalid resource address "' + address + '"', details: {} },
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
                  // The bridge above answers the commands this Session refuses.
                  reference = ctx.sessions.retain(parsed.childId, { source: SOURCE, signal: signal });
                  bridgeHandle(reference);
                } catch (error) {
                  yield {
                    ok: false,
                    error: { code: 'side-chat/retain-failed', message: message(error), details: { sessionId: parsed.childId } },
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
