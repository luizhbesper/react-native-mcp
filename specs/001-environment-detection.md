# 001 — Environment detection

**Status:** Approved
**Pillar:** Foundation

## Motivation

Every other pillar depends on knowing what this machine can actually do. Detection runs once
at startup (cheap, parallel, ~100ms) and produces a `Capabilities` object that drives tool
registration (spec 002) and powers the `doctor` tool — the agent's self-diagnosis entrypoint.

## Detection matrix

| Capability | How detected | Notes |
| --- | --- | --- |
| `ios` | `process.platform === 'darwin'` AND `xcrun simctl help` exits 0 | Requires Xcode CLT |
| `ios.xcodeVersion` | `xcodebuild -version` | absent without full Xcode |
| `ios.cocoapods` | `pod --version` | needed by `run_pod_install` |
| `android` | `adb version` exits 0 (PATH or `$ANDROID_HOME/platform-tools/adb`) | |
| `android.emulator` | `emulator` binary next to adb or in `$ANDROID_HOME/emulator` | physical-only setups lack it |
| `android.javaVersion` | `java -version` | needed for Gradle builds |
| `metro` | dynamic — never cached (spec 020) | |
| `project` | walk up from `--project-root` (default cwd): `package.json` with `react-native` dep; `app.json`/`app.config.*` ⇒ Expo; `ios/`+`android/` dirs ⇒ bare/prebuild | |
| `project.rnVersion` | `react-native` resolved version from the project's lockfile/package | |

Binary lookups tolerate failure: a missing tool yields `available: false` plus the probe error
captured for `doctor`, never a crash.

## Tool contracts

### `doctor`

- **Description:** "Check the health of the React Native development environment: detected
  OS, iOS/Android toolchains, Metro status and project info. Call this first when something
  is failing or before device/build operations."
- **Gate:** always registered.
- **Annotations:** `readOnlyHint: true`.
- **Input:** `{ projectRoot?: string }` — defaults to the server's `--project-root`/cwd.
- **Output:**

```jsonc
{
  "host": { "os": "darwin" | "linux" | "win32", "arch": "arm64", "node": "26.0.0" },
  "ios": { "available": true, "xcodeVersion": "16.4", "simctl": true, "cocoapods": "1.16.2" },
  "android": { "available": true, "adbVersion": "1.0.41", "emulator": true, "java": "21" },
  "metro": { "running": true, "port": 8081, "targets": 1 },
  "project": {
    "found": true, "root": "/path", "kind": "expo" | "bare",
    "rnVersion": "0.85.1", "expoSdk": "56"
  },
  "problems": [ { "code": "ANDROID_SDK_NOT_FOUND", "fix": "Install Android Studio or set ANDROID_HOME." } ]
}
```

- **Text content:** one line per area, ✅/⚠️/❌ prefixed, plus problems with fixes.

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `PROJECT_NOT_FOUND` | no `react-native` dependency found walking up | pass `projectRoot` or run from the app directory |

`doctor` itself never returns `isError` for missing toolchains — missing pieces are *findings*
(`problems[]`), not failures.

## Acceptance criteria

- **AC-1** Given a darwin host with simctl, When detection runs, Then `ios.available` is true.
- **AC-2** Given a win32/linux host, When detection runs, Then `ios.available` is false without
  probing `xcrun` (no spawn attempted).
- **AC-3** Given `adb` missing from PATH and `ANDROID_HOME` unset, When detection runs, Then
  `android.available` is false and `problems[]` contains `ANDROID_SDK_NOT_FOUND`.
- **AC-4** Given an Expo project root, When detection runs, Then `project.kind === "expo"` and
  `rnVersion` is populated.
- **AC-5** Given probes that hang, When detection runs, Then each probe is killed after 3s and
  detection still completes.

## Test plan

Unit tests inject a fake exec layer (`src/shared/exec.ts` seam) replaying recorded probe
outputs per OS; fixture projects under `test/fixtures/projects/{expo,bare}`. CI runs the suite
on ubuntu, macos and windows.

## Out of scope

Watchman, Ruby/bundler, Node version managers. Physical-device toolchains (`devicectl`, USB).
