# 030 — Build runner & jobs

**Status:** Approved
**Pillar:** Build diagnostics

## Motivation

Native builds take 2–15 minutes; MCP clients enforce per-call timeouts. A synchronous tool
that dies at minute 4 loses the build entirely. Builds therefore run as background jobs: the
tool returns a `jobId` in under 2 seconds and the agent polls with a bounded long-poll.

## Job model

- In-memory job store: `{ id, status: running|succeeded|failed|cancelled, command, logPath,
  startedAt, finishedAt?, exitCode? }`.
- The build process is spawned detached-from-call (not from server), stdout+stderr streamed
  to `os.tmpdir()/react-native-dev-mcp/builds/<jobId>.log`.
- The log file is the source of truth: if the server restarts, `parse_build_log` (spec 032)
  recovers diagnostics from disk.
- On terminal status, the log is run through the signature matcher (spec 031) once and the
  diagnostics cached on the job.

## Command resolution

| platform | project kind | command |
| --- | --- | --- |
| android | any | `./gradlew assembleDebug` (or `:app:assemble<Variant>`) in `<root>/android` |
| ios | any | `xcodebuild -workspace <ws> -scheme <scheme> -configuration Debug -sdk iphonesimulator -derivedDataPath <dd> build` in `<root>/ios` |

Workspace/scheme auto-detected (first `.xcworkspace`, scheme defaulting to its base name);
overridable via input. Expo projects without `ios`/`android` dirs get a structured
`PREBUILD_REQUIRED` error pointing at `npx expo prebuild`.

## Tool contracts

### `run_build`

- **Description:** "Start a native build (xcodebuild / Gradle) in the background and return a
  job id immediately. Poll with get_build_status. Use after native-layer changes; for pure JS
  changes prefer reload_app."
- **Gate:** platform-dependent (spec 002): `platform: "ios"` only offered on darwin.
- **Input:** `{ platform: "ios"|"android", projectRoot?, scheme?, variant? /* android, default "debug" */, clean?: boolean }`
- **Output:** `{ jobId, status: "running", logPath, command }`

### `get_build_status`

- **Annotations:** `readOnlyHint: true`.
- **Input:** `{ jobId, waitSeconds?: number /* 0–60, default 25 */ }` — long-polls until
  terminal status or the wait elapses.
- **Output (running):** `{ status: "running", elapsedMs, logPath, logSizeBytes }`
- **Output (terminal):**
  ```jsonc
  {
    "status": "succeeded" | "failed" | "cancelled",
    "durationMs": 184000,
    "exitCode": 65,
    "errorCount": 2, "warningCount": 14,
    "diagnostics": [ /* ≤10, spec 031 Diagnostic shape */ ],
    "artifactPath": "/…/app-debug.apk",   // on success, when found
    "logPath": "/tmp/…/job.log",
    "logTail": "last 40 lines"             // ONLY when zero signatures matched a failure
  }
  ```

### `cancel_build`

- **Input:** `{ jobId }` → kills the process tree → `{ status: "cancelled" }`.

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `JOB_NOT_FOUND` | unknown/expired jobId | `run_build` again; logs may persist on disk |
| `PREBUILD_REQUIRED` | Expo project without native dirs | run `npx expo prebuild` |
| `WORKSPACE_NOT_FOUND` | no `.xcworkspace`/`build.gradle` | check projectRoot |
| `BUILD_ALREADY_RUNNING` | same platform+root already building | poll or cancel the existing jobId (in details) |

## Acceptance criteria

- **AC-1** Given a fake builder script, When `run_build`, Then the call returns `jobId` in <2s
  while the build continues.
- **AC-2** Given a running job, When `get_build_status {waitSeconds: 1}`, Then it returns
  `running` after ~1s, and when the job finishes a later poll returns terminal status with
  diagnostics.
- **AC-3** Given a failing build whose log matches a signature, Then `diagnostics` is
  populated and `logTail` is absent.
- **AC-4** Given a failing build with no matching signature, Then `logTail` carries the last
  40 lines.
- **AC-5** Given `cancel_build`, Then the process tree is dead (children included) and status
  is `cancelled`.
- **AC-6** Given an artifact produced under the expected output dir, Then `artifactPath`
  points to it (apk: `android/app/build/outputs/apk/**`; iOS: derivedData `Build/Products`).

## Test plan

Unit/integration with scripted shell builders (sleep + exit codes + canned logs) — no real
toolchains on PR CI. Nightly runs one real `gradlew assembleDebug` (and `xcodebuild` on
macOS) against a cached RN template app.

## Out of scope

`pod install` (separate tool, spec 031 fixtures cover its errors; tool contract:
`run_pod_install { projectRoot? }` runs synchronously ≤ 5 min with the same diagnostic
shape). EAS/cloud builds; build caching strategies; physical-device deploys.
