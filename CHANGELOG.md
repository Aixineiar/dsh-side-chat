# Changelog

All notable changes to this plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Renamed the package from `@local/dsh-side-chat` to **`dsh-plugin-side-chat`**, so it can be
  installed by name (`pnpm add dsh-plugin-side-chat`, or the same name in the plugin manager) and
  resolved as a profile bundle.
- Dropped `"private": true`, added `engines.dsh` (`^0.2.2-rc.1`) so an incompatible host refuses the
  install before writing anything, and `prepublishOnly` now runs the boot simulation.
- README install section: install by name first, GitHub and local directory as alternatives.

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

- Read quota is per model step, not per answer; the mode text states exactly that.
- The client half is a single file: the DSH client loader cannot synchronously require sibling
  `client*.js` outputs, and this project has no build step.
