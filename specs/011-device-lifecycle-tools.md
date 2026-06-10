# 011 — Device lifecycle tools

**Status:** Implemented
**Pillar:** Device control

## Motivation

"Put the app up on a controllable device" starts with finding and booting one. These tools
are the agent's hands on the device lab.

## Tool contracts

### `list_devices`

- **Description:** "List iOS simulators and Android emulators/devices in a unified format.
  By default shows booted devices plus the newest-OS variant per device family; pass
  `filter: 'all'` for everything."
- **Gate:** ios ∨ android. **Annotations:** `readOnlyHint: true`.
- **Input:** `{ platform?: "ios"|"android", state?: "booted"|"shutdown", filter?: "default"|"all" }`
- **Output:** `{ devices: Device[], totalCount: number, shown: number }` — hard cap 30 entries
  in `default` mode; collapse rule: among `shutdown` simulators with the same name, keep only
  the highest `osVersion`.
- **Text:** `"2 booted: iPhone 16 Pro (iOS 18.4), Pixel 8 (API 35) · 11 more available (filter:'all' to list)"`.

### `boot_device`

- **Description:** "Boot a simulator/emulator by id. No-op if already booted. For Android
  AVDs use the `avd:<name>` id from list_devices."
- **Gate:** ios ∨ android. **Annotations:** `idempotentHint: true`.
- **Input:** `{ deviceId: string, timeoutSeconds?: number /* default 120 */ }`
- **Output:** `{ device: Device }` — returns only after the device is usable: simctl
  `bootstatus` for iOS; `sys.boot_completed=1` polled via adb for Android.
- **Text:** `"Booted Pixel 8 (emulator-5554) in 38s"`.

### `shutdown_device`

- **Description:** "Shut down a running simulator/emulator."
- **Gate:** ios ∨ android. **Annotations:** `idempotentHint: true`.
- **Input:** `{ deviceId: string }`
- **Output:** `{ deviceId: string, state: "shutdown" }`

## Behavior notes

- Booting a cold AVD spawns `emulator -avd <name>` detached (survives nothing — it is the
  user's emulator now), then polls `adb devices` to find the new serial, then waits for
  `sys.boot_completed`. The result `Device.id` is the **adb serial**, not the `avd:` id.
- iOS boot uses `simctl boot` + `simctl bootstatus -b` and opens Simulator.app only when
  `RN_MCP_HEADLESS` is not set (visible simulator is what humans expect locally; CI sets it).

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `DEVICE_NOT_FOUND` | unknown id | call `list_devices` |
| `BOOT_TIMEOUT` | not usable within timeout | retry with bigger `timeoutSeconds`; check `doctor` |
| `EMULATOR_BINARY_MISSING` | `avd:` boot without emulator binary | install Android Emulator via SDK manager |

## Acceptance criteria

- **AC-1** Given a shutdown simulator UDID, When `boot_device`, Then backend calls
  `simctl boot` + `bootstatus` and result state is `booted`.
- **AC-2** Given an already-booted device, When `boot_device`, Then success with no boot call
  (idempotent).
- **AC-3** Given `avd:Pixel_8`, When `boot_device`, Then the emulator is spawned and the
  returned id is the discovered adb serial.
- **AC-4** Given a boot that never completes, When timeout elapses, Then `BOOT_TIMEOUT` is
  returned and the poller is cancelled.
- **AC-5 (integration, macOS CI)** Given a real runner, When list→boot→shutdown runs against
  a real simulator, Then all three succeed.

## Test plan

Unit with scripted exec replays (boot sequences as ordered fixtures). macOS CI job runs AC-5
against a real simulator on every PR.

## Out of scope

Creating/deleting simulators and AVDs; `erase`/factory reset (roadmap, destructive).
