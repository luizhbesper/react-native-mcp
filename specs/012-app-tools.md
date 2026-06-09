# 012 — App management tools

**Status:** Approved
**Pillar:** Device control

## Motivation

Install, launch, deep-link: the verbs that turn a booted device into a running app the agent
can iterate against.

## Tool contracts

All gated ios ∨ android; all take `deviceId` and route via the façade (spec 010).

### `install_app`

- **Input:** `{ deviceId, appPath }` — `.app` bundle (iOS) or `.apk` (Android).
- **Output:** `{ appId: string }` — bundle id read from the artifact's `Info.plist`
  (`CFBundleIdentifier` via plutil/PlistBuddy) or apk manifest
  (`aapt dump badging` when available, else from `adb install` + heuristics).
- **Errors:** `ARTIFACT_NOT_FOUND`, `ARTIFACT_PLATFORM_MISMATCH` (apk → iOS device etc.),
  `INSTALL_FAILED` (with the underlying installer message, e.g.
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` surfaced in `details`).

### `uninstall_app`

- **Annotations:** `destructiveHint: true` (removes app data).
- **Input:** `{ deviceId, appId }` → **Output:** `{ appId, removed: true }`.

### `launch_app`

- **Input:** `{ deviceId, appId }` → **Output:** `{ pid?: number }` (simctl reports pid;
  adb `monkey`/`am start` does not — field optional).
- **Errors:** `APP_NOT_INSTALLED`.

### `terminate_app`

- **Annotations:** `idempotentHint: true`.
- **Input:** `{ deviceId, appId }` → **Output:** `{ terminated: boolean }` — terminating a
  non-running app succeeds with `terminated: false`.

### `open_url`

- **Description:** "Open a URL / deep link on the device (custom schemes, universal links,
  exp:// links). The primary way to drive navigation from outside the app."
- **Input:** `{ deviceId, url }` → **Output:** `{ opened: true }`.
- iOS: `simctl openurl`; Android: `adb shell am start -a android.intent.action.VIEW -d <url>`
  (URL shell-escaped — see security note).

## Security note

All backend invocations use argv arrays (`spawn` without shell). URLs and ids are never
string-interpolated into a shell. The Android `am start` runs through `adb shell` with the
URL single-quoted and quote-escaped; a unit test covers injection attempts.

## Acceptance criteria

- **AC-1** Given an `.app` fixture with Info.plist, When `install_app`, Then `appId` equals
  its CFBundleIdentifier and simctl receives `install <udid> <path>`.
- **AC-2** Given an `.apk` targeted at an iOS deviceId, When `install_app`, Then
  `ARTIFACT_PLATFORM_MISMATCH`.
- **AC-3** Given a deep link with shell metacharacters (`'; rm -rf'`), When `open_url` on
  Android, Then the exec layer receives it as a safely quoted argv element.
- **AC-4** Given `terminate_app` for a non-running app, When called, Then success with
  `terminated: false` (no error).
- **AC-5 (integration, macOS CI)** Given a real simulator, When `open_url` with
  `https://example.com`, Then Safari opens (exit 0).

## Test plan

Unit fixtures: minimal `.app` dir with Info.plist, recorded installer failure outputs.
Injection test asserts argv, not strings. macOS CI integration for AC-5.

## Out of scope

Pushing files/media to the device; granting permissions (roadmap); app data backup.
