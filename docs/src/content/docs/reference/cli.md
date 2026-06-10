---
title: CLI flags & environment
description: Server flags and environment variables.
---

```text
react-native-dev-mcp [options]
```

| Flag | Default | Purpose |
| --- | --- | --- |
| `--project-root <path>` | cwd | React Native project the server operates on |
| `--metro-port <port>` | `8081` | Where to find Metro's inspector (`/json/list`) |
| `--eager-metro` | off | Connect to the runtime at startup so console logs buffer immediately (default is lazy — first runtime tool call) |
| `--verbose` | off | Diagnostic logging to stderr |
| `--version` / `--help` | — | Print and exit |

## Environment variables

| Variable | Effect |
| --- | --- |
| `RN_MCP_HEADLESS=1` | Don't open simulator windows (set automatically when `CI=true`) |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Where to find `adb` and `emulator` when not on PATH |

## Calling tools without an agent

A checkout ships a tiny JSON-RPC helper, useful for debugging:

```bash
pnpm build
node scripts/mcp-call.mjs doctor
node scripts/mcp-call.mjs list_devices '{"platform":"ios"}'
node scripts/mcp-call.mjs parse_build_log '{"logPath":"/tmp/build.log"}' --verbose
```
