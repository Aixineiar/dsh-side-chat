# Changelog

All notable changes to this plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
