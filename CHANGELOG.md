# Changelog

All notable changes to this plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-11-14

Modes can be switched in place, and the plugin has settings of its own.

### Added

- **In-place mode switch.** The mode chip on the tab's status bar opens the same three-mode menu,
  but a pick now switches *this* thread: same Agent, same log, same conversation — nothing is
  closed, forked or lost. The host applies the new tool mask first, then queues the switch through
  the plugin's own route (`/mode`), and the page re-addresses the tab so the address carries the
  mode the host is actually enforcing.
- **A switch is exactly two messages, in this order.** A one-line notice
  (`模式已切换：只读 → 完全继承。上一条模式的说明作废，以下一条为准。`, mark
  `plugin:dsh-side-chat/switch`) followed by the new mode's own explanation (the same generator the
  opening boundary uses, mark `plugin:dsh-side-chat`). One step claims both, so the later message is
  the authority. Picking the mode the thread already has queues nothing.
- **The plugin page has a form.** `plugins.bundle.config`, keyed by the package name, renders
  「显示右上角快捷按钮」(on by default) and 「新会话的默认模式」(follow the last manual pick by
  default). Both are page settings in `localStorage['dsh.side-chat.settings']`: no host round trip,
  no restart, and the header button registers and unregisters from the same change.
- The status bar's mode chip and the「以最新快照新开」action use the shared kit's `Button`
  (`size: 'sm'`, `variant: 'ghost'`) and, when the kit ships it, its `Tooltip` instead of the
  browser's native `title` hint. Their row is tightened with one metrics-only rule, so colour,
  radius, hover and focus still come from the shared component.

### Changed

- **Mode recovery takes the newest explanation.** A switched thread records its mode more than
  once; `recoveredMode` now scans the whole log and lets the last own mark win, and it counts only
  marks that actually record a mode — a boundary without one neither competes nor makes the answer
  ambiguous. Single-mark logs written by older builds behave exactly as before.
- The read quota is reset when the mode changes: the quota belongs to one step of one mode.
- "The mode is fixed when the thread is created" no longer holds for an open tab. The guide card
  still opens a new thread per pick and says so while its menu is open; the status chip switches
  the live one.

### Fixed

- **Re-addressing a tab no longer disposes its thread.** `replaceTab` closes the tab it replaces
  and runs the registered close handler inside that same call, so the first switch would have
  disposed the Agent and deleted the log of the very thread the new address points at. The switch
  now wraps the open in a re-addressing guard, and `dev/client-logic.test.mjs` reproduces the
  sidebar's close-on-replace so the regression cannot come back silently.
- A host that predates the `mode` action reports「宿主还是旧版本：重载插件或重启 DSH 后再切换」
  (`side-chat/not-found`) instead of the generic failure sentence, and a switch failure renders next
  to the mode chip instead of past the status bar's spacer.

### Notes

- Each switch permanently adds two visible user-role messages to the thread's context. That is the
  price of "the model must be told what changed"; the notice is one line on purpose.
- The in-flight step keeps the system section it was assembled with; the mask and the guard change
  immediately, and the new explanation lands on the next step.

## [1.1.0] — 2026-11-13

A code-review round: host-contract cleanup, the open-path race, and failure recovery.

### Fixed

- **Opening a side chat no longer fails with `sessions.retain: unknown session …`.** The `open`
  action answers over HTTP while the new row arrives on the socket, so the client catalog can lag;
  the resource coroutine now refreshes the catalog and retries with backoff, and a tab that still
  cannot be retained shows a readable sentence plus a **Retry** button instead of the raw host error.
- **A failed close is recoverable.** A dispose or delete failure keeps the thread (and its teardown
  handle) on purpose, and the guide card now offers「重试关闭」for exactly those threads. Refusals are
  no longer retried blindly: the route says which failure it was, and the client retries only I/O and
  transport failures.
- **The `prompt` action validates its content.** Only text parts and attachment references the host
  already promoted reach the session log; malformed blocks are dropped and counted, and an entirely
  invalid prompt answers 400 without committing an event (a malformed block used to make the thread
  unreadable on replay).
- **A malformed `allow`/`deny` refuses activation** instead of silently falling back to the default
  read-only list, which used to make "I narrowed the read-only scope" a no-op.
- **The Session-command patch owns its lifecycle.** Installing `remote.session.prompt/cancel/selectModel`
  now records an undo per method and removes it when the plugin unloads; a later wrapper by another
  plugin is never clobbered.
- `artifactPath()` prefers `sessionPersistence.stat(id)`, so closing a tab no longer enumerates every
  stored session when the backend's `locate()` is unavailable.
- The guide card's error boundary renders a minimal visible card instead of an empty div, and a
  half-changed shared UI kit degrades to the local menu as a whole instead of mixing components.

### Changed

- **The plugin no longer listens to `system-prompt/assemble`.** Every hosting package renders its
  `tool:*` section against the viewing scope's tool view, so a masked tool's paragraph is already
  empty; filtering there only deleted other plugins' contributions for no gain.
- Removed three fallbacks for members that do not exist on the host's rc.3 services
  (`sessionController.composeAgent`, `sessionController.presetForSession`,
  `sessionPersistence.locate` as a contract member). None of them could ever run, and the first one
  hid the fact that the preset mount path is done locally.
- **Compatibility statement rewritten against DSH 0.2.2-rc.3**, with the exact contract list the
  plugin uses instead of "checked item by item" against a version the plugin no longer ran on.
- **The docs no longer claim mode switching applies to an open conversation.** The mode is fixed when
  the thread is created; choosing another mode opens a new side chat and closes the current one, and
  the card says so while the menu is open.
- **"Stays out of every session list" corrected.** A live side chat is an ordinary catalog entry
  titled「侧边 · <main title>」— it is *removed*, not hidden, when its tab closes.
- The plugin description in `locale/zh.json` and `locale/en.json` names all three modes, including
  that `full` can write files and run commands.
- `dsh.client.inject` no longer lists `@deepseek-ai/dsh-client-ui-subagent`, which the client half
  never requires or uses.

### Added

- `dev/harness.mjs` and `dev/client-logic.test.mjs`: 10 interaction-level assertions driven through
  the *registered* surfaces (resource protocol, close handler, guide card, tab type, bridge), covering
  the catalog race, the retry entries, the request body, the kit guard and the patch teardown.
- A stable error-code table (`side-chat/bad-request` 400, `not-owned` 403, `agent-gone` 409,
  `no-context` 409, `io` 500, `body-too-large` 413) and a client-side dictionary that turns each code
  into the sentence a user reads.
- CSS grouped per surface, one rule per line, with consistent `property: value;` formatting.

### Removed

- `.host-load.log` and its `.gitignore` rule: the diagnostic channel it belonged to no longer exists.

## [1.0.0] — 2026-11-10

First public release. A throwaway side conversation in the right sidebar, seeded from the main
session's committed log and deleted when its tab closes.

### Added

- **Three modes**, all rendered from a single `MODES` table in `prompt.js`:
  - `reply` — every tool masked; the request carries no tool schema at all.
  - `read` — read-only allowlist (12 names by default), one read call per model step.
  - `full` — same capabilities as the main session; plan first, then a single
    "run here or in the main session?" question.
- Seed construction from the main session's committed prefix, including the committed steps of a
  turn still running, with synthetic results closing an unbalanced tool tail.
- Tool masking through the host registry (`tools.restrict`) plus a `tools.guard` backstop, and
  system-prompt paragraphs pruned with the same tool → paragraph map the mask uses.
- Mode boundary injected as a user-role message carrying the thread id and the mode, so a nested
  side chat cannot inherit its parent's mode and a plugin reload can recover the thread's mode.
- Control route `POST /dsh-side-chat/api` (`open` / `close` / `prompt` / `cancel` / `model` /
  `log` / `sweep`) with ownership checks before anything is disposed or deleted.
- Closing a tab disposes the agent and deletes the artifact; a boot sweep removes leftovers.
- Entry points: the tool-panel guide card (with a live mode label) and a conversation-header button.
- Sidebar status bar: snapshot time, "open a fresh snapshot", and a three-state sync indicator.
- `dev/boot-sim.mjs` — a self-contained boot simulation with 197 assertions over both halves.

### Notes

- Renamed from `@local/dsh-side-chat` to **`@aixineiar/dsh-side-chat`** (the unscoped names
  `dsh-side-chat` / `dsh-plugin-side-chat` were already taken on npm) and published under that name.
- Dropped `"private": true`, added `engines.dsh` (`^0.2.2-rc.1`) so an incompatible host refuses the
  install before writing anything, and `prepublishOnly` runs the boot simulation.
- Read quota is per model step, not per answer; the mode text states exactly that.
- The client half is a single file: the DSH client loader cannot synchronously require sibling
  `client*.js` outputs, and this project has no build step.
