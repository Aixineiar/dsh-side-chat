# Contributing

Thanks for taking a look. This is a small plugin with a few hard rules; they exist because breaking
them breaks the plugin's only real promise — that the mode you picked is the mode you get.

## Before you start

- **Node ≥ 20**, no build step, no test runner, no dependencies. Everything runs on Node built-ins.
- DSH **0.2.2-rc.3** is the host the code is written against. If you change a host contract call,
  check it against the installed host sources first (`node_modules/@deepseek-ai/dsh-*`).
- To run the plugin for real you need a DSH profile that mounts it; see
  [README › 安装](README.md#安装).

## The test

```bash
npm test                       # = node dev/boot-sim.mjs && node --test dev/
node dev/boot-sim.mjs --export out.json
node --test dev/               # Client interaction rules (dev/client-logic.test.mjs)
```

`dev/boot-sim.mjs` loads both halves under stubs (no DSH, no network, no browser) and asserts 197
facts about them. Two rules:

1. **Never weaken an assertion to make a change pass.** If an assertion fails, either the code is
   wrong or the assertion encodes an assumption that has genuinely changed — in the second case
   update it *and* say so in the pull request.
2. **New behaviour needs a new assertion.** Behaviour that only exists in prose (a sentence in a
   prompt) still deserves one: assert on the rendered text.

`--export` writes the rendered per-mode text, closed lists, kept paragraphs and seeds to a JSON file.
Diff two exports to see exactly what a prompt change did.

## Rules that are easy to break

- **One source for mode semantics.** Tool lists, denial text, system-prompt sections, retained
  `tool:*` paragraphs and synthetic tool results all come from the `MODES` table in `prompt.js`.
  Do not hand-write a mode's wording anywhere else — not in `index.js`, not in a test fixture.
- **Constraints live in code.** "Only reply" is `tools.restrict` + `tools.guard`, not a sentence;
  "one read per step" is a counter in the guard, not a request in the prompt. A prompt sentence is
  never a substitute for enforcement.
- **The prompt may only promise what the harness can deliver.** If a code path cannot produce a
  refusal, do not tell the model it will receive one.
- **Deletion is ownership-checked.** Anything that disposes a thread or unlinks a file must first
  prove the session is a thread this plugin created, and must respect the
  `basename(dirname(path)) === sessionId` shape check.
- **Style**: 2 spaces, single quotes, semicolons, `/** … */` JSDoc, `ctx.logger?.warn?.()` for
  diagnostics, Chinese for model-facing prompt text (the UI ships zh + en).

## Pull requests

- One topic per pull request; keep unrelated formatting out of it.
- Describe the user-visible change, and which mode it affects (or "all").
- Paste the `npm test` summary line (`ok=N FAIL=0 APPLY OK`).
- If you touched prompt text, include the `--export` diff for the affected modes.
- If you touched anything about tool masking or quotas, say what other modes it could affect.

## Repository housekeeping

The package metadata points at the published repository (`Aixineiar/dsh-side-chat`); if the project
moves, update `repository` / `homepage` / `bugs` in `package.json` in the same commit as the move.
`LICENSE` names "dsh-side-chat contributors" — change it if you want a specific holder.

## Commit messages

Conventional-ish, imperative, scoped by area:

```
feat(mode): strip tool paragraphs the mask already removed
fix(close): verify ownership before deleting the artifact
docs(readme): document the per-step read quota
test(boot-sim): assert the denial shape the host renders
```

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
