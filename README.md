# react-native-dev-mcp

> MCP server that gives AI coding agents hands, eyes and a mechanic's ear for React Native development.

[![CI](https://github.com/luizhbesper/react-native-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/luizhbesper/react-native-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/react-native-dev-mcp)](https://www.npmjs.com/package/react-native-dev-mcp)
[![node](https://img.shields.io/node/v/react-native-dev-mcp)](package.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Coding agents are good at writing React Native code and bad at everything around it:
putting the app on a device, seeing what it logs, and understanding why the native build
exploded into 4,000 lines of Gradle. This server closes that loop with three pillars:

| Pillar | What the agent gets |
| --- | --- |
| 🤲 **Device control** | One uniform interface over `simctl` + `adb`: list/boot devices, install/launch apps, deep links, screenshots, demo status bar. The agent never needs to know which platform it's driving. |
| 👀 **Runtime bridge** | Connects to Metro's inspector (CDP/Hermes, RN 0.76+ "Fusebox"). Streams `console.*` and uncaught errors into a cursor-based buffer, and runs `evaluate_js` inside the live app — inspect Redux/Zustand state, trigger navigation, verify the fix actually worked. Zero app code changes. |
| 🔧 **Build diagnostics** | Runs `xcodebuild`/Gradle as background jobs and parses the log against a community-maintained [signature database](signatures/) of known RN failures, returning `{errorType, file, line, probableCause, suggestedFix}` instead of a log dump. Also parses any existing log offline. |

Works with **Expo and bare React Native CLI**, RN **0.76+** (tested on 0.80+).
The server is environment-aware: on Windows/Linux, iOS tools are never even registered, and
every failure returns a structured remediation the agent can act on. Start with the
`doctor` tool.

## Install

Requires Node 22+. The server runs on your machine over stdio.

### Claude Code

```bash
claude mcp add rn-dev -- npx -y react-native-dev-mcp
```

Or per-project, in `.mcp.json`:

```json
{
  "mcpServers": {
    "rn-dev": {
      "command": "npx",
      "args": ["-y", "react-native-dev-mcp"]
    }
  }
}
```

### Codex CLI

In `~/.codex/config.toml`:

```toml
[mcp_servers.rn-dev]
command = "npx"
args = ["-y", "react-native-dev-mcp"]
```

### Cursor / Claude Desktop / others

Any MCP client that speaks stdio works — point it at `npx -y react-native-dev-mcp`.
Useful flags: `--project-root <path>`, `--metro-port <port>`, `--eager-metro`, `--verbose`.

## Try asking your agent

Once installed, talk to your agent in plain language — it picks the right tools:

> *"Run my app on Android and figure out why it's broken at startup."*

> *"Boot an iPhone simulator, build and install the app, then screenshot the login screen."*

> *"The iOS build is failing. Diagnose it, apply the suggested fix and rebuild until it's green."*

> *"Watch the console while I tap through checkout and summarize any errors you see."*

> *"What's in the Redux store right now? Read the auth slice from the running app."*

> *"Open the deep link myapp://profile/42 and verify it lands on the right screen."*

## The loop

A typical agent session against a real app:

```text
doctor                       → toolchains ok, Metro running, project: expo · RN 0.85
list_devices                 → iPhone 16 Pro (booted)
run_build {platform: "ios"}  → job a1b2c3d4
get_build_status {jobId}     → ❌ failed · "Sandbox not in sync with Podfile.lock"
                               → fix: run pod install (tool run_pod_install)
run_pod_install              → ✅
run_build → get_build_status → ✅ artifact: .../MyApp.app
install_app + launch_app     → app running
read_console {level:"error"} → "TypeError: cannot read property 'id' of undefined"
evaluate_js {expression:
  "globalThis.store.getState().auth"} → { user: null, … }   ← found it
(agent edits code) → reload_app → read_console → clean ✅
take_screenshot              → 📸 verified visually
```

## Tools (20)

**Environment** · `doctor`
**Devices** · `list_devices` `boot_device` `shutdown_device` `install_app` `uninstall_app` `launch_app` `terminate_app` `open_url` `take_screenshot` `set_status_bar_demo`
**Runtime** · `list_runtime_targets` `read_console` `evaluate_js` `reload_app`
**Build** · `run_build` `get_build_status` `cancel_build` `run_pod_install` `parse_build_log`

Full reference with schemas and error codes: **[documentation site](https://luizhbesper.github.io/react-native-mcp)**.

## Good to know

- **One debugger at a time (Hermes limitation).** If React Native DevTools is attached, runtime
  tools return `DEBUGGER_OCCUPIED` with instructions. Close the DevTools tab and retry.
- **Builds never block.** `run_build` returns a job id in <2s; poll with `get_build_status`
  (it long-polls up to 60s per call). Logs persist on disk and can be re-parsed any time with
  `parse_build_log`.
- **Token-frugal by design.** Lists are collapsed and capped, console reads are cursor-based and
  deduped, build results carry at most 10 diagnostics plus a `logPath` escape hatch.

## Contributing

The easiest high-impact contribution is a **build error signature** — pure YAML plus a log
snippet, no TypeScript. See [CONTRIBUTING.md](CONTRIBUTING.md). Development is spec-driven:
every tool's contract lives in [`specs/`](specs/).

**Branches:** `dev` → pre-releases (`@next`). `main` → stable (`@latest`). PRs target `dev`; `dev` is merged into `main` to cut a release.

## License

[MIT](LICENSE) © Luiz Esper
