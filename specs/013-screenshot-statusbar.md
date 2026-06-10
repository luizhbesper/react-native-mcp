# 013 — Screenshot & status bar

**Status:** Implemented
**Pillar:** Device control

## Motivation

Screenshots close the verification loop — the agent sees what it changed. Status-bar demo
mode makes screenshots deterministic (9:41, full battery), which matters for visual diffing
and store assets.

## Tool contracts

### `take_screenshot`

- **Gate:** ios ∨ android. **Annotations:** `readOnlyHint: true`.
- **Input:** `{ deviceId, returnImage?: boolean /* default true */ }`
- **Output:** `{ path: string, format: "png" }` + (when `returnImage`) an MCP image content
  block with the PNG.
- **Behavior:** iOS `simctl io <udid> screenshot <path>`; Android
  `adb exec-out screencap -p` streamed to file. Files land in
  `os.tmpdir()/react-native-dev-mcp/screenshots/<deviceId>-<seq>.png`.
- PNGs larger than 800KB are returned as path-only with a note (token protection);
  `returnImage: false` always suppresses the image block.

### `set_status_bar_demo`

- **Gate:** ios ∨ android. **Annotations:** `idempotentHint: true`.
- **Input:** `{ deviceId, enabled: boolean, time?: string /* default "9:41" */ }`
- **Output:** `{ applied: true }`
- **Behavior:**
  - iOS: `simctl status_bar <udid> override --time <t> --batteryState charged --batteryLevel 100 --cellularBars 4 --operatorName ""` / `clear`.
  - Android: demo mode via `adb shell settings put global sysui_demo_allowed 1` then
    `am broadcast -a com.android.systemui.demo` (clock/battery/network), `exit` to disable.

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `DEVICE_NOT_BOOTED` | device not running | `boot_device` first |
| `SCREENSHOT_FAILED` | backend exit ≠ 0 | retry; check device UI is awake |

## Acceptance criteria

- **AC-1** Given a booted device fixture, When `take_screenshot`, Then a PNG path is returned
  and the image block is present.
- **AC-2** Given `returnImage: false`, When `take_screenshot`, Then no image block is present.
- **AC-3** Given `set_status_bar_demo {enabled: true}` on iOS, Then simctl receives the full
  override argv including `--time 9:41`.
- **AC-4** Given `set_status_bar_demo {enabled: false}` on Android, Then the demo-mode `exit`
  broadcast is sent.
- **AC-5 (integration, macOS CI)** Real simulator: screenshot file exists and is a valid PNG
  (magic bytes).

## Test plan

Unit with exec replays asserting exact argv; integration on macOS CI.

## Out of scope

Video recording (`simctl io recordVideo` / `screenrecord`) — roadmap. Element-level
screenshots.
