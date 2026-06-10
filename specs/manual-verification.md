# Manual verification checklist

**Status:** Living document
**Purpose:** End-to-end verification against a real React Native app. Specs 020–023 (runtime
bridge) and 030 (real builds) require this checklist to pass before flipping to `Verified`.
Record date, RN version and results at the bottom.

Driver: either an MCP client (Claude Code) or the deterministic helper
`node scripts/mcp-call.mjs <tool> '<json>' [--server-flags]`.

## Phase 0 — Lab app

```bash
cd ~/Documents
npx @react-native-community/cli@latest init RnMcpLab
```

Add to the top of `RnMcpLab/App.tsx` (module scope):

```ts
globalThis.appState = { counter: 0 };
setInterval(() => {
  globalThis.appState.counter += 1;
  console.log('heartbeat', globalThis.appState.counter);
  if (globalThis.appState.counter % 10 === 0) console.warn('tenth heartbeat');
}, 2000);
```

Register the server (local build) against the lab app:

```bash
claude mcp add rn-lab -- node <repo>/dist/index.mjs --project-root ~/Documents/RnMcpLab
```

## Phase 1 — Environment (spec 001/002)

- [ ] `doctor` → iOS ✅, Android ✅, `project: bare · RN 0.8x`, Metro ⚠ not running
- [ ] `doctor` with a wrong `projectRoot` → `PROJECT_NOT_FOUND` in problems

## Phase 2 — Devices (specs 010–013)

- [ ] `list_devices` → unified list (simulators + AVDs), booted first, collapsed
- [ ] `boot_device` on a shutdown iPhone UDID → `booted`, Simulator.app opens
- [ ] `boot_device` again on the same id → instant no-op (idempotent)
- [ ] `set_status_bar_demo {enabled: true}` → clock shows 9:41
- [ ] `take_screenshot` → PNG path + image block; 9:41 visible
- [ ] `open_url {url: "https://example.com"}` → Safari opens

## Phase 3 — iOS build pipeline (spec 030)

- [ ] `run_pod_install` → succeeds (~2-5 min)
- [ ] `run_build {platform: "ios"}` → `jobId` returned in <2s
- [ ] `get_build_status {jobId, waitSeconds: 60}` repeatedly → `running` … → `succeeded`,
      `artifactPath` ends in `.app` (first build 5–10 min)
- [ ] `install_app {appPath: <artifactPath>}` → returns the bundle id
- [ ] Start Metro (`npm start` in the app), then `launch_app` → welcome screen renders

## Phase 4 — Runtime bridge (specs 020–023)

- [ ] `list_runtime_targets` → exactly 1 target
- [ ] `read_console` → heartbeat entries; repeated logs collapse with `repeat`
- [ ] `read_console {cursor: <prev nextCursor>}` → only new entries
- [ ] `read_console {level: "warn"}` → only the tenth-heartbeat warnings
- [ ] `evaluate_js {expression: "globalThis.appState"}` → `{counter: N}`
- [ ] `evaluate_js {expression: "Promise.resolve(globalThis.appState.counter)"}` → number
      (promise polling workaround)
- [ ] `evaluate_js {expression: "nope.nope"}` → `EVALUATE_EXCEPTION` with text
- [ ] `reload_app` → app reloads; next `read_console` works (session reconnects)
- [ ] Press `j` in Metro (open RN DevTools) → runtime tools return `DEBUGGER_OCCUPIED`;
      close DevTools → tools work again
- [ ] Stop Metro → `read_console` returns `METRO_NOT_RUNNING` with remediation

## Phase 5 — Build diagnostics (specs 030–032)

- [ ] `rm -rf ios/Pods` → `run_build ios` → `failed` with diagnostic
      `cocoapods-sandbox-not-in-sync` and fix pointing at `run_pod_install`
- [ ] Follow the fix (`run_pod_install` + rebuild) → green
- [ ] Add `#import <React/DoesNotExist.h>` to `AppDelegate` → rebuild → header-not-found
      diagnostic with file/line; revert
- [ ] `parse_build_log {logPath}` on an old failed log → same diagnostics offline
- [ ] `cancel_build` mid-build → `cancelled`, xcodebuild process gone

## Phase 6 — Android (specs 010–013, 030)

- [ ] `boot_device {deviceId: "avd:<name>", timeoutSeconds: 300}` → booted, re-listed under
      its `emulator-XXXX` serial
- [ ] `run_build {platform: "android"}` → succeeded (first build 5–15 min), `.apk` artifact
- [ ] `install_app` + `launch_app` + `take_screenshot` on the emulator
- [ ] `read_console` works with the app on Android (same Metro)

## Phase 7 — Agent autonomy (the real test)

Give Claude Code this single prompt and intervene only if it stalls:

> Using the rn-lab tools only: make sure a device is booted, build and install the app,
> start from a clean console, then verify the heartbeat counter increases over time using
> evaluate_js twice 5 seconds apart. Finish with a screenshot proving the app is running.

- [ ] The agent chains doctor → device → build → status → install → launch → evaluate →
      screenshot without manual help, and recovers from any structured error on its own.

## Results log

| Date | RN version | Platform | Phases passed | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
