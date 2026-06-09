# 002 — Capability gating

**Status:** Approved
**Pillar:** Foundation

## Motivation

The tool list is part of the model's context on every turn. Registering `boot_device` for iOS
on a Windows host wastes tokens and invites guaranteed-failure calls. Conversely, hiding tools
because of *transient* state (Metro not running yet) would require `tools/list_changed`
churn that MCP clients handle inconsistently. We gate in two tiers.

## Design

### Tier 1 — static gating (registration time)

Facts that cannot change mid-session decide whether a tool is registered at all:

| Condition | Effect |
| --- | --- |
| host is not darwin | iOS-only tools never registered (`run_pod_install`); `run_build` rejects `platform: "ios"` |
| no iOS **and** no Android toolchain | device tools not registered; `doctor` explains why |
| at least one of iOS/Android present | unified device tools registered; per-call platform check is Tier 2 |

Metro/runtime tools and `parse_build_log` are always registered — they depend only on Node.
`doctor` is always registered. The server never emits `tools/list_changed` in v0: the
registration set is fixed at startup.

### Tier 2 — dynamic checks (call time)

Anything that can change mid-session is checked per call and reported as a structured error
(spec 000 envelope) the model can act on:

| code | when | remediation |
| --- | --- | --- |
| `IOS_UNAVAILABLE` | iOS device op on a host whose simctl probe failed | install Xcode + simulators, rerun `doctor` |
| `ANDROID_UNAVAILABLE` | Android device op without adb | install Android SDK / set ANDROID_HOME |
| `METRO_NOT_RUNNING` | runtime tool with no inspector on the port | start Metro (`npx expo start` / `npx react-native start`) |
| `DEVICE_NOT_FOUND` | `deviceId` does not match any known device | call `list_devices` |
| `DEVICE_NOT_BOOTED` | op requires a booted device | call `boot_device` first |

### Restart note

If the user installs a toolchain mid-session, `doctor` detects it (dynamic re-probe on each
`doctor` call) and its text output tells the agent that newly available tool families require
an MCP server restart to register.

## Acceptance criteria

- **AC-1** Given a linux/win32 host, When the server starts, Then `tools/list` contains no
  `run_pod_install` and `run_build` schema only offers `platform: "android"`.
- **AC-2** Given a darwin host with both toolchains, When the server starts, Then all 20 tools
  are listed.
- **AC-3** Given no Android SDK and no Xcode, When the server starts, Then device tools are
  absent and `doctor` lists both problems.
- **AC-4** Given Metro not running, When `read_console` is called, Then the result is
  `isError: true` with code `METRO_NOT_RUNNING` and an actionable remediation.
- **AC-5** Given the registration set at startup, When environment changes mid-session, Then
  no `tools/list_changed` notification is ever emitted.

## Test plan

Unit: capability matrix → expected registration set, table-driven for
{darwin, linux, win32} × {ios, android} availability. Integration: CI jobs on ubuntu and
windows assert `tools/list` via an in-process MCP client.

## Out of scope

Hot re-registration (`tools/list_changed`) — revisit post-v0 if client support matures.
