<div align="center">

# dsh-side-chat

**A throwaway side conversation in the right sidebar: it inherits the current session's context, and never writes back into it.**

Three modes — *reply only* / *read-only* / *fully inherited* — enforced in code, not by asking the model politely.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-DSH%20Web-4c6ef5.svg)](#compatibility)
[![dsh](https://img.shields.io/badge/dsh-0.2.2--rc.1-1f9d55.svg)](#compatibility)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](#development)

</div>

![Side chat overview: main session on the left, inherited side chat on the right](docs/images/overview.png)

> Left: the main session. Right: a side chat seeded from its context. The「工具已更新 · 移除 37 个」line is the harness recording that the side chat's tool set really was cut down in *reply only* mode — not the prompt claiming it.

---

## Why

A main session is one continuous, persisted context that every later request carries. Some questions do not deserve to occupy it. A side chat is a **shadow branch** of the main session:

- **Inherited** — at open time the main session's committed log is copied (including the committed steps of a turn still running), so it knows what you were just talking about.
- **Isolated** — its own agent, its own model choice, its own history. Answers stay in the sidebar and never enter the main session.
- **Disposable** — close the tab and the agent is disposed, its log file and directory deleted. No archive, no "resume later".

## Three modes

![Mode menu: reply only / read-only / fully inherited](docs/images/modes.png)

*The mode menu: reply only / read-only / fully inherited. The last choice is remembered; the default is read-only.*

| | **Reply only** `reply` | **Read-only** `read` (default) | **Fully inherited** `full` |
|---|---|---|---|
| Tools | none | read-only allowlist (12 by default) | same as the main session |
| Tool schemas in the request | omitted | read-only tools only | all |
| Host `tool:*` usage paragraphs | stripped | only those for callable tools | all |
| Writes / commands / subagents | impossible | impossible | allowed (host permissions and sandbox apply) |
| Tool quota | n/a | 1 read call per step | none |
| On a modification request | prints a "modification suggestion to run in the main session" block | same, may use that step's one read to confirm the target | prints a plan, asks once "run here or in the main session?" |

**Reply only** — no tool channel at all: the host calls `tools.restrict({ deny: … })`, so the request carries no tool schemas, and text that imitates a call is just text (nothing parses it, nothing answers it). A backstop `tools.guard` refuses anything that slips through. Good for "one sentence, please", "what does this error mean", "which option is safer".

**Read-only** (default) — inherits the context plus `read`, `read_image`, `glob`, `grep`, `lsp`, the five `session_*` tools, `web_search`, `web_fetch`. **One read call per model step**, success or failure counts. System-prompt paragraphs for masked tools are stripped too, so the manual never advertises a tool the request does not carry.

**Fully inherited** — same capabilities as the main session, different stance: the inherited history is reference, not a task; answers stay in the sidebar; a modification request gets a plan first, then exactly one question — *run it here, or in the main session?* Choosing "main session" prints the same suggestion block and stops all writes.

![The side-chat entry card in the tool panel, its subtitle showing the current mode](docs/images/launcher.png)

*Entry point: the side-chat card in the tool panel — its subtitle is the mode in force.*

### Same sentence, three modes

> "Change `parseDate` in `src/utils.ts` to accept ISO strings."

- **reply** — answers "this side chat does not perform writes, nothing was changed", plus the suggestion block. It never opened the file (unless the inherited history contains it).
- **read** — same, but it may spend its one read of the step to look at `src/utils.ts` first. No writes.
- **full** — prints a plan and asks once; "run here" edits your workspace, "main session" prints the suggestion block and stops.

## Install

A **DSH plugin** (host + client halves), loaded by DSH through a profile bundle.

Requirements: DSH **0.2.2-rc.1**, Node ≥ 20, pnpm, and the main session **running** (open on the left) — the plugin seeds from its latest committed event.

**A. By name (recommended)**

Package name: **`dsh-plugin-side-chat`**. In the DSH sidebar's *Plugins* page, choose *Add plugin* and type that name — pnpm resolves it from the npm registry, and because the package declares `dsh.bundle`, it is appended to the profile's `dsh.profile.bundles` automatically.

```bash
# equivalent command line, inside the profile directory
cd <DSH_HOME>/profiles/<profile>          # Windows default: %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-plugin-side-chat
```

A command-line install still needs the bundle entry added by hand (after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`):

```json
{
  "dependencies": { "dsh-plugin-side-chat": "^1.0.0" },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dsh-plugin-side-chat"
  ] } }
}
```

> Before installing, the plugin manager reads the manifest once: an unmet `engines.dsh` (this package declares `^0.2.2-rc.1`) refuses the install instead of installing and rolling back.

**B. From GitHub** — works today, without waiting for a publish:

```bash
cd <DSH_HOME>/profiles/<profile>
pnpm add "github:Aixineiar/dsh-side-chat"
```

**C. Local directory** (development / editing the source):

```bash
git clone https://github.com/Aixineiar/dsh-side-chat.git dsh-side-chat
cd <DSH_HOME>/profiles/<profile>
pnpm add "link:/absolute/path/to/dsh-side-chat"
```

**D. Profile patch only** — mount without adding a dependency (the package must already resolve):

```yaml
- insert:
    - id: side-chat
      name: 'dsh-plugin-side-chat'
```

The bundle's own [`cordis.patch.yml`](cordis.patch.yml) already carries that row, so a manager install needs no YAML work.

**Restart DSH**, open a session that has messages, and look for the「侧边对话」card in the tool panel or the sidebar button in the conversation header. Uninstall with `pnpm remove` plus deleting the `bundles` entry.

## Usage

Two entry points (tool panel card, conversation header button). Inside the tab: the header shows「上下文截至 <time>」and a「以最新快照新开」action (opens a fresh snapshot and closes the current side chat); the composer has its own model picker that does not touch the global default; the stop button cancels the running turn.

**Closing the tab deletes the side chat** — agent disposed, log file and directory removed. A boot sweep cleans up leftovers from crashes.

## Development

No build step (ESM, no TypeScript, no bundler). `npm test` runs `dev/boot-sim.mjs`, a self-contained boot simulation with 197 assertions over both halves. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Compatibility

Validated on DSH **0.2.2-rc.1** only, against the host contracts `tools.view/restrict/guard`, `systemPrompt.section`, `agents.create`, `sessionPersistence.locate/list`, `sessionQuery.observeSession`, `agentPresets.presetForSession`.

Known limits: the read quota is per *step*, not per answer; the side chat does not follow the main session after opening; closing is irreversible; the client half is a single file because the DSH client loader cannot synchronously require sibling `client*.js` files.

## Security

Tool gating is implemented in the host tool registry (`restrict` + `guard`), so the model cannot reach a masked tool even if it ignores every instruction. Control actions go through `POST /dsh-side-chat/api`, are authenticated by the host connection layer, and a close verifies that the session is really a thread this plugin created before disposing or deleting anything. Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
