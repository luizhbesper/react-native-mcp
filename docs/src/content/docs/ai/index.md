---
title: For AI agents
description: Machine-readable docs, tool-selection guidance and prompt patterns for agents using this server.
---

This site ships [llms.txt](https://llmstxt.org/) indexes — point an agent at:

- `/react-native-mcp/llms.txt` — index of all pages
- `/react-native-mcp/llms-full.txt` — full documentation in one file
- `/react-native-mcp/llms-small.txt` — abridged version for small contexts

## Tool-selection guidance

Rules of thumb that make agents effective with this server:

1. **Run `doctor` first** when anything fails or before the first device/build operation.
   It is read-only, fast, and its `problems[]` contain exact fixes.
2. **JS change → `reload_app`. Native change → `run_build`.** Rebuilding for a JS-only
   edit wastes minutes; reloading after a native edit silently runs stale native code.
3. **Never poll `get_build_status` in a tight loop** — pass `waitSeconds: 60` and let the
   server long-poll for you (~1 call/minute).
4. **Use cursors on `read_console`.** Store `nextCursor` and pass it on the next read to
   get only new entries. Filter with `level: "error"` when hunting crashes.
5. **Prefer read-only `evaluate_js` expressions** when verifying (it can mutate app
   state). Multi-statement code must be wrapped in an IIFE.
6. **On `isError` results, read `remediation`** — it states the next action (often another
   tool of this server, e.g. `run_pod_install`).

## Prompt patterns that work

```text
"Boot an iPhone simulator, build and install the app, then watch the console
 for errors while you verify the login flow via deep link myapp://login."

"The Android build is failing. Run it through run_build, read the diagnostics,
 apply the suggested fix, and rebuild until green."

"Use evaluate_js to dump the Redux state slice 'cart' before and after
 triggering checkout, and tell me what changed."
```

## For agents working on an app repo

Add a note like this to the app's `AGENTS.md`/`CLAUDE.md` so agents discover the loop:

```markdown
## Device & build tooling
This project uses the rn-dev MCP server (react-native-dev-mcp).
- Verify changes on-device: boot_device → install_app → read_console → take_screenshot.
- For build failures, trust get_build_status diagnostics before reading raw logs.
- Metro must be running (`npx expo start`) for read_console / evaluate_js / reload_app.
```
