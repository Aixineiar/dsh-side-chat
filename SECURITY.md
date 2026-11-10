# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ |
| < 1.0   | ❌ |

Only the DSH host version named in the README (**0.2.2-rc.1**) has been verified. A different host
build may change the tool registry or session APIs this plugin relies on; treat it as unverified.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's *Report a vulnerability* (Security → Advisories)
on this repository, or contact the maintainer privately. Include:

- the mode you were in (`reply` / `read` / `full`) and whether the main session was running,
- what you expected the boundary to be and what actually happened,
- any relevant log lines (redact tokens, paths and conversation content first).

You will get an acknowledgement within a few days. Please give a reasonable window before public
disclosure.

## What counts as a security issue here

This plugin creates and destroys sessions and deletes files, so the interesting surface is:

- **A tool call escaping a masked mode.** `reply`/`read` are enforced with the host tool registry
  (`tools.restrict`) plus a `tools.guard` backstop. If a masked tool is still callable — or its
  schema still reaches the model — that is a security bug, not a cosmetic one.
- **A control action reaching a session the plugin does not own.** Every `close` must prove
  ownership (durable boundary marker + live agent + the artifact's path shape) before disposing or
  deleting anything. Any way to make the plugin delete another session's file is in scope.
- **Prompt-injected writes in `full` mode.** `full` is intentionally as capable as the main
  session; unsafe *content* is governed by the host sandbox and permission presets, not by this
  plugin. Report it here only if the plugin itself widens that capability.
- **Leaking one thread's content into another** — a nested side chat inheriting its parent's mode or
  context, or two threads sharing a quota entry, are correctness bugs with a security flavour.

## What is out of scope

- The host's own approval, sandbox, or permission behaviour (report those to the DSH project).
- The `[dsh-purge]`-style local patches some installations carry; they change approval semantics and
  are not part of this repository.
- Anything that requires an already-compromised local account or write access to the profile
  directory: at that point the plugin's files can be edited directly.
