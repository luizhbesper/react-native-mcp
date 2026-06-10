# 010 — Unified device schema

**Status:** Implemented
**Pillar:** Device control

## Motivation

The agent must operate devices without knowing whether it is talking to `simctl` or `adb`.
One schema, one ID space, one set of verbs. Backends translate.

## The `Device` object

```jsonc
{
  "id": "5C2A...-...",          // simctl UDID | adb serial (e.g. "emulator-5554") | avd:<name> for cold AVDs
  "name": "iPhone 16 Pro",      // human name (simctl name | AVD name | adb model)
  "platform": "ios" | "android",
  "kind": "simulator" | "emulator" | "physical",
  "state": "booted" | "shutdown" | "unknown",
  "osVersion": "18.4"            // iOS runtime | Android release version, "" when unknown
}
```

### ID space rules

- iOS: the simctl UDID, stable across boots.
- Android running: the adb serial (`emulator-5554`, physical serial).
- Android cold AVD (not running): synthetic id `avd:<avdName>`. `boot_device` accepts it,
  starts the emulator, and the device re-lists under its adb serial once online.
- The façade routes by inspecting the id: UDID pattern ⇒ simctl; `avd:` prefix or adb serial
  ⇒ adb. Ambiguity resolves by asking both backends for ownership.

### Sources

- iOS: `xcrun simctl list devices --json` (machine format only — never parse human output).
- Android running: `adb devices -l` + per-device `getprop` (release, model).
- Android cold: `emulator -list-avds`.
- Physical devices appear when present (adb USB; iOS physical is out of scope for v0).

## Acceptance criteria

- **AC-1** Given recorded `simctl list --json` output with 40+ simulators, When parsed, Then
  every device maps to the schema with correct `state` and `osVersion`.
- **AC-2** Given `adb devices -l` plus `getprop` fixtures, When parsed, Then emulators are
  `kind: "emulator"` and USB devices `kind: "physical"`.
- **AC-3** Given an AVD that is not running, When devices are listed, Then it appears as
  `{ id: "avd:Pixel_8", state: "shutdown" }`.
- **AC-4** Given a device id of each shape, When routed, Then the façade dispatches to the
  correct backend.
- **AC-5** Given simctl output containing unknown fields or runtimes, When parsed, Then
  parsing succeeds (tolerant parser, unknown fields ignored).

## Test plan

Pure-parser unit tests over fixtures in `test/fixtures/{simctl,adb}/`, including a fixture
captured from a machine with zero devices.

## Out of scope

iOS physical devices (`devicectl`) — roadmap. Wearables/TV targets.
