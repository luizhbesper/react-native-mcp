---
title: Error codes
description: Every structured error the server can return, with remediation.
---

Failures the model can act on come back as tool results with `isError: true` and a payload
of `{ code, message, remediation, details? }` (see spec 000). Codes are stable API.

## Environment & gating

| Code | When | Typical fix |
| --- | --- | --- |
| `IOS_UNAVAILABLE` | iOS operation but the simctl probe failed at startup | Install Xcode + simulators; restart the server |
| `ANDROID_UNAVAILABLE` | Android operation without a working adb | Install the SDK / set `ANDROID_HOME`; restart the server |
| `PROJECT_NOT_FOUND` | No `react-native` dependency found from the project root | Run from the app directory or pass `--project-root` |

## Devices

| Code | When | Typical fix |
| --- | --- | --- |
| `DEVICE_NOT_FOUND` | Unknown device id | `list_devices` |
| `DEVICE_NOT_BOOTED` | Operation requires a running device | `boot_device` |
| `BOOT_TIMEOUT` | Device not usable within `timeoutSeconds` | Retry with a larger timeout |
| `EMULATOR_BINARY_MISSING` | Booting an AVD without the emulator installed | Install Android Emulator via SDK Manager |
| `ARTIFACT_NOT_FOUND` | `appPath` does not exist | Check `get_build_status` → `artifactPath` |
| `ARTIFACT_PLATFORM_MISMATCH` | `.apk` → iOS device or `.app` → Android | Match artifact to platform |
| `INSTALL_FAILED` | Installer rejected the artifact | Details carry the installer message |
| `APP_NOT_INSTALLED` | Launching an app that isn't installed | `install_app` first |
| `SCREENSHOT_FAILED` | Capture failed | Check the device is awake/booted |

## Runtime bridge

| Code | When | Typical fix |
| --- | --- | --- |
| `METRO_NOT_RUNNING` | No inspector on the Metro port | Start Metro; check `--metro-port` |
| `NO_TARGETS` | Metro up, no app runtime registered | Open the app on a device |
| `TARGET_AMBIGUOUS` | Multiple debuggable targets | Pass `targetId` from `list_runtime_targets` |
| `DEBUGGER_OCCUPIED` | RN DevTools holds the single Hermes debugger slot | Close DevTools, retry |
| `INVALID_REGEX` | Bad `filter` pattern in `read_console` | Fix the regex |
| `EVALUATE_TIMEOUT` | Promise didn't settle within `timeoutMs` | Raise `timeoutMs` or simplify |
| `EVALUATE_EXCEPTION` | The expression threw | Exception text/stack in details |

## Build

| Code | When | Typical fix |
| --- | --- | --- |
| `JOB_NOT_FOUND` | Unknown/expired job id (ids don't survive restarts) | `parse_build_log` on the log file |
| `PREBUILD_REQUIRED` | Expo project without native directories | `npx expo prebuild` |
| `WORKSPACE_NOT_FOUND` | No `.xcworkspace`/gradlew where expected | Check `projectRoot`; run `run_pod_install` |
| `BUILD_ALREADY_RUNNING` | Same platform+project already building | Poll or `cancel_build` (job id in details) |
| `POD_INSTALL_FAILED` | CocoaPods failed | Diagnostics in details |
| `LOG_NOT_FOUND` / `LOG_TOO_LARGE` / `INVALID_INPUT` | Bad `parse_build_log` input | Per the message |

## Catch-alls

`COMMAND_FAILED` (a toolchain call failed in an unanticipated way — stderr included) and
`INTERNAL_ERROR` (a bug in this server — please report it).
