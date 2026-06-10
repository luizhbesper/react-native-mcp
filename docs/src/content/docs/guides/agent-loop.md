---
title: The agent loop
description: How an AI agent uses the three pillars together — build, run, observe, verify.
---

The point of this server is closing the loop: *wrote the patch* → *saw it work on a device*.
A full session looks like this.

## 1. Orient — `doctor`

Always cheap, always available. Reports toolchains, Metro status, project kind
(Expo vs bare) and React Native version, plus actionable problems.

## 2. Get a device — `list_devices` → `boot_device`

```text
list_devices            → iPhone 16 Pro (booted) · avd:Pixel_8 (shutdown) · …
boot_device {deviceId: "avd:Pixel_8"}   → booted as emulator-5554 in 38s
```

Device ids are unified: simctl UDIDs, adb serials, and `avd:<name>` for cold Android AVDs
all work in every device tool.

## 3. Build & install — `run_build` → `get_build_status` → `install_app`

Builds run in the background; `run_build` returns a job id immediately:

```text
run_build {platform: "ios"}            → job a1b2c3d4
get_build_status {jobId: "a1b2c3d4"}   → running (2m10s elapsed)…
get_build_status {jobId: "a1b2c3d4"}   → ✅ succeeded · artifact: …/MyApp.app
install_app {deviceId, appPath}        → com.example.myapp
launch_app {deviceId, appId}           → running
```

On failure you get [structured diagnostics](/react-native-mcp/guides/build-failures/)
instead of a log dump. For pure JS changes skip the rebuild — `reload_app` is enough.

## 4. Observe — `read_console`

The runtime bridge buffers everything the app logs (plus uncaught errors). Reads are
incremental — pass the previous `nextCursor` to get only what's new:

```text
read_console {level: "error"}             → 2 errors · cursor 1287
read_console {cursor: 1287}               → only new entries since
read_console {filter: "api|network"}      → regex-filtered
```

## 5. Inspect & poke — `evaluate_js`

Execute any expression inside the live app:

```text
evaluate_js {expression: "globalThis.store.getState().auth"}
evaluate_js {expression: "Object.keys(require('react-native').NativeModules)"}
evaluate_js {expression: "fetch('http://localhost:3000/health').then(r => r.status)"}
```

Promises are awaited via polling (a Hermes CDP limitation), up to `timeoutMs`.

## 6. Verify — `reload_app` → `read_console` → `take_screenshot`

After editing code: reload, confirm the console is clean, and capture a screenshot
(use `set_status_bar_demo` first for deterministic images). The screenshot comes back as
an actual image the agent can look at.

## Deep links

`open_url` drives navigation from outside the app — custom schemes, universal links and
Expo's `exp://` URLs all work on both platforms.
