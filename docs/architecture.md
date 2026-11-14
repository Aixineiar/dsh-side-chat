# Architecture

This document is for people changing the plugin. It describes how a side chat is created, how the
three modes are enforced, and which host contracts the implementation leans on.

The one-sentence version: **a side chat is an ordinary, seeded Session with its own live Agent, a
tool mask applied in that Agent's scope, and a durable boundary message that marks it as ours.**

---

## 1. Two halves

```
Host half (Node, runs inside the DSH process)          Client half (Web, window.__ModuleLoader__)
──────────────────────────────────────────────         ─────────────────────────────────────────
index.js      wiring: route, prompt section,            client.js   guide card, tab, status bar,
              tools.guard, thread open/close                        bridge to the host route
prompt.js     THE mode table: wording, denial
              text, synthetic-result text
seed.js       copy the parent log, close the open tail
tools.js      mask policy per mode
routes.js     POST /dsh-side-chat/api → actions,
              stable error codes
lifecycle.js  boundary injection, read quota,
              adoption after a reload
```

`index.js` owns no mode text. Every string a model can see about a mode is produced by
`prompt.js`.

---

## 2. Opening a thread

```
Client                       Host (index.js openThread)
  │  POST /open {sessionId, mode}
  ├──────────────────────────▶ │
  │                            │ 1. liveAgent(parentId)          — the main session must be running
  │                            │ 2. snapshotEvents() → lastSeq   — newest *committed* event
  │                            │ 3. buildSeed(events, lastSeq, mode)
  │                            │ 4. currentPresetOf(parent) → compose(presetId)
  │                            │ 5. agents.create({sessionId, seed, meta:{isSeeded}, setup})
  │                            │ 6. attach(agent)                — apply the tool mask
  │                            │ 7. injectBoundary(agent)        — queue the mode message
  │ ◀──────────────────────────┤ {childId, atSeq, mode, label}
```

Three details that matter:

- **The seed comes from committed events only.** The snapshot boundary is the main session's newest
  committed `seq`, not a client-side estimate — a turn in flight has committed steps that are
  already true, and uncommitted ones that are not.
- **The open tail is closed.** Providers reject a history whose last assistant message has a tool
  call without a result, so `seed.js` appends a synthetic `tool/result` for every unanswered call
  plus `step/end` / `turn/end`. The wording is mode-dependent: `read`/`reply` say "outcome unknown,
  do not retry"; `full` may say "retry if the call was read-only or idempotent".
- **The header is ordinary.** `origin: 'subagent'` would hide the thread from lists but also force
  the durable parent address, which breaks the native model picker and routes answers back into the
  main session. The plugin keeps a plain header (plus `isSeeded`), so while the thread lives it *is*
  a normal catalog row titled「侧边 · <main title>」; it disappears because closing the tab deletes it,
  not because a list filters it.

---

## 3. Mode enforcement: three layers

The mask is the authority; the guard is a backstop for what a mask cannot reach; the prompt is
downstream of both.

### 3.1 The mask (`tools.restrict`)

`tools.js → restrictionFor(mode, agent, tools)` computes, per thread:

| mode | filter | callable set |
|------|--------|--------------|
| `reply` | `{ deny: [every restrictable name] }` | `[]` |
| `read` | `{ allow: [restrictable ∩ READ_ALLOW] }` | the read-only allowlist |
| `full` | none (an existing mask is released) | unchanged |

`restrictableNames` is the **pre-restriction** name set from `tools.view(agent)`: `restrict()` masks
inherited tools only, so the Agent's own registrations are not in it and appear as "unmaskable".

The restriction is applied in `agent.ctx` (the Agent's scope), not globally: `restrict()` throws if
called without a scope.

### 3.2 The backstop (`tools.guard`)

One guard, registered by the plugin, evaluated for every tool call of every Agent:

1. not a side chat → allow;
2. `full` → allow;
3. the mode's mask cannot be read → deny with "the tool list is unreadable";
4. the name is unmaskable (registered inside the Agent's own scope) → deny, and log at error level
   once per (thread, tool);
5. the name is not in the closed list → deny, and re-apply the mask on a microtask;
6. the read quota for the current step is spent → deny;
7. otherwise allow and count the call.

A denial is a plain string; the host renders it as `Error: <reason>` in a tool result with
`isError: true`. The strings live in `prompt.js → DENIAL` and are single-line on purpose.

### 3.3 The prompt (`prompt.js` + two registrations)

- **Boundary message** — a user-role message injected once per thread through `agent.inject`, so it
  lands in the inbox and is claimed by the opening step *before* the waking user message. Its
  `source` carries `{ kind: 'plugin:dsh-side-chat', childId, mode }`.
- **System-prompt section** — `systemPrompt.section({ name: 'side-chat:policy', order: 1e6 })`. The
  high order is deliberate: it must be the last word, after the inherited general rules it settles.
- **No paragraph pruning** — a hosting package registers its `tool:*` section with a scope-aware text
  function (`text: ({ scope }) => ctx.tools.get(name, scope) === undefined ? '' : …`) and the renderer
  drops empty sections, so a tool the mask removed has no paragraph for that Agent already. This
  plugin therefore never listens to `system-prompt/assemble`: rewriting that waterfall would delete
  other plugins' contributions and could not make the prompt more correct.

---

## 4. Read quota

`full` has none; `reply` has no tools; `read` gets **one read call per model step**.

`execution` (the object a guard receives) has no step number, so the plugin derives the key from
committed events it already listens to:

```
turn/start  → key = `${turn}:0`
step/start  → key = `${turn}:${step}`
```

The counter is `{ key, count }` per session id; a call whose key matches and whose count is already
1 is denied. Because `step/start` is appended before the model request of that step, a call in step
*N* always sees key *N*, and a new step restores the quota. Parallel calls inside one step share the
entry, so the second one is refused.

---

## 5. Ownership, closing, sweeping

The boundary marker is the durable owner mark — not the title prefix (a user can rename a session to
anything).

- `isBoundaryEvent(event, childId)` reads `user/message` sources and inbox splices; a mark written by
  an older build has no `childId` and counts for the log it sits in.
- `ownsThread(childId)` accepts: a thread in this process's map, a live Agent whose session is
  classified as a side chat, or a session whose committed log carries our boundary.
- `closeThread` → `ownsThread` → dispose (keeping the handle if dispose fails, so a retry can
  finish) → `discardArtifact`. Every failure leaves with a stable code: `side-chat/not-owned` for a
  refused close, `side-chat/io` for a dispose or delete failure (the only one the client retries).
- `discardArtifact` resolves the path with `sessionPersistence.stat(id)` first (the contract member
  that reports the artifact this process stored), then the jsonl backend's `locate()`, then a full
  `list()`, and refuses to unlink unless `basename(dirname(path)) === childId`; then `rm` the file and
  try `rmdir` the directory.
- `sweepThreads` runs on page boot: seeded sessions with no live Agent that carry our boundary are
  deleted. Archived seeded threads from older builds are handled the same way.

A thread whose close failed is not forgotten: the client records it per main session, and the guide
card offers「重试关闭」for exactly those threads until the host reports them gone.

A thread that survives a plugin reload is *adopted*: the mask is re-applied and a teardown handle is
recorded, so closing the tab still disposes it instead of deleting a log out from under a live Agent.

---

## 6. Mode recovery

`modeOf(session)` prefers the in-process map; otherwise it recovers from the log:

1. the thread's **own** mark (`childId === session.id`) wins — it also carries `mode`;
2. a mark **without** `childId` speaks for the log only when it is the log's single mark; two of them
   are ambiguous and the read-only default is used instead of a guess;
3. older logs (no structured `mode`) fall back to matching the mode heading in the boundary text;
4. anything else → `DEFAULT_MODE` (`read`).

The result is remembered per log length, so a guess made before this thread's own boundary committed
cannot outlive that commit.

---

## 7. Client half

`client.js` registers, through the DSH client plugin API:

| registration | purpose |
|--------------|---------|
| `slots.inject('conversation.session.header.utilities', …)` | the header button |
| `slots.inject('sidebar.right.tab.guide.entry', …)` | the tool-panel card (title + live mode line) |
| `slots.inject('sidebar.right.pane.tab', …)` ×2 | the chat tab and the launcher tab |
| `sidebarRightTabs.register` ×2 | tab kinds `sidechat` and `sidechat-launcher` |
| `resources.register` | serves the tab body through the resource protocol |
| `sidebarRight.registerCloseHandler` | closing the tab calls `/close` |

It is a single file because the client loader resolves `require` only for platform-seeded modules and
already-registered factories; it cannot synchronously require a sibling `client*.js`, and those chunk
files are compiler output this project does not have.

The composer keeps a `ClientSessionReference` per side chat (the session controller's `retain`), so
sending, stopping and model selection go through the same code path as a normal session — except the
prompt itself is delivered through this plugin's route (`/prompt` → `agent.followup` / `agent.steer`)
instead of the generic session command, so it never touches the subagent runtime.

`retain` needs the session to be in the client catalog, and `open` answers over HTTP while the new row
arrives on the socket. `retainSideChat()` therefore reads the catalog first and, while the row is
missing, calls `sessions.refresh()` and retries with backoff (200…600 ms, six attempts); a failure that
is not the catalog gap is rethrown at once. A tab that still cannot be retained shows a sentence plus a
**Retry** button; the retry re-mounts the resource consumer, and the registry restarts the provider
when its last holder leaves and a new one arrives.

The bridge patches `remote.session.prompt/cancel/selectModel` for the threads this page created. Each
patch records an undo, and one `ctx.effect` owns the whole set, so unloading the plugin restores the
original methods and never clobbers a wrapper installed after ours.

---

## 8. Host contracts this relies on

| Contract | Used for |
|----------|----------|
| `tools.view(scope)` → `{ visible, registrations, knownNames, restrictableNames }` | maskable set, unmaskable detection |
| `tools.restrict({ allow, deny })` (Agent-scoped, returns disposer) | the mask |
| `tools.guard(fn)` → synchronous denial reason | backstop + quota |
| `systemPrompt.section({ name, order, text })` | the mode section |
| `section.text(context)` receives the assembling `agent` | deciding whether the section speaks at all |
| `agents.create({ sessionId, seed, meta, setup })` / `agents.get` / `agents.list` | thread creation, liveness |
| `session.snapshotEvents(from)` / `session.header` / `session.seq` | seeding, classification |
| `sessionPersistence.stat(id)` / `list()`, jsonl backend's `locate()` | artifact path for deletion |
| `sessionQuery.observeSession(id)` | ownership of a thread this process did not create |
| `agentPresets.presetForSession` / `resolve` / `mount` | keeping the main session's preset |
| `agentDefaultModel.currentSelection()` | the model a child inherits |
| `sessionTitle.rename` | the visible「侧边 · …」title |
| `workspaceRegistry.archivedSessionIds` / `unarchiveSession` | cleaning up threads older builds archived |
| `connection.requestRejection(req)` | route authentication |
| `llm.resolveCallConfig` | validating a model choice before recording it |

Client side: `sessions.retain/refresh/using/list`, `resources.register` (an async generator per
address), `sidebarRightTabs.register`, `sidebarRight.openResource/registerCloseHandler`,
`slots.register/inject`, `locale.register/bind`.

`dev/boot-sim.mjs` stubs every Host contract above, and `dev/client-logic.test.mjs` stubs the Client
ones through `dev/harness.mjs`. That is exactly why their assertions are about *this plugin's*
invariants (does the rendered list equal the applied mask? does a malformed prompt reach the log?) and
**not** about host behaviour. Host behaviour is cited in comments, not asserted.

---

## 9. Extending

**A new mode.** Add an entry to `MODES` in `prompt.js` (`boundary`, `section`, `synthetic`), add its id
to `MODE_IDS`, teach `tools.restrictionFor` what to mask, add the label to both locales, and add the id
to `MODES` in `client.js`. `dev/boot-sim.mjs` fails until the two lists and the default agree; its
per-mode loop picks the new mode up automatically.

**A new read-only tool.** Append it to `READ_ALLOW` in `index.js` and stop there: the mask decides what
the request carries, and the host renders the tool's own paragraph per scope.

**A new host refusal the model can see.** Add the string to `FEEDBACK_RULE` (and the short form to
`FEEDBACK_SECTION_RULE`) so one stop rule covers it, and add the phrase to the read-mode assertion in
`dev/boot-sim.mjs`.
