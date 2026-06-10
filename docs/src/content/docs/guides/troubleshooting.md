---
title: Troubleshooting
description: The errors you will actually hit, and what they mean.
---

Every failure this server returns carries a stable `code` and a `remediation`. The ones
worth knowing:

## `DEBUGGER_OCCUPIED`

Hermes accepts **one** debugger connection at a time. If React Native DevTools is attached
(you pressed `j` in the Metro terminal, or opened the Dev Menu debugger), the runtime tools
can't connect — and vice versa: while this server is attached, DevTools can't be.

**Fix:** close the React Native DevTools tab/window and retry. The server connects lazily
(only when a runtime tool is first used) and reconnects automatically after reloads.

## `METRO_NOT_RUNNING`

Nothing answered on `http://localhost:8081/json/list`.

- Start Metro: `npx expo start` or `npx react-native start`.
- Custom port? Pass `--metro-port <port>` in the server args (Expo with multiple apps
  often lands on 8082+).

## `NO_TARGETS` / `TARGET_AMBIGUOUS`

Metro is up but either no app runtime is registered (open the app on a booted device) or
several are (two simulators, or an old reload left a stale page). For the latter, call
`list_runtime_targets` and pass `targetId` to the runtime tools.

## `PREBUILD_REQUIRED`

Your Expo project has no `ios/`/`android/` directories — there is nothing for `run_build`
to build locally. Run `npx expo prebuild` (or use EAS Build and install the produced
artifact with `install_app`).

## `BOOT_TIMEOUT`

Cold Android emulators on busy machines regularly exceed the default 120s. Retry with
`timeoutSeconds: 300`.

## iOS tools missing entirely

On Windows/Linux that's by design — they are never registered. On macOS, run `doctor`:
the usual cause is Xcode CLT without full Xcode (`xcrun: error: SDK "iphonesimulator"
cannot be located` → `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`).
If you install a toolchain while the server is running, restart it to register the new
tool family (doctor will tell you).

## Logs only start "now"

Console buffering begins when the runtime bridge first connects (lazily, on the first
runtime tool call). Start the server with `--eager-metro` to buffer from launch.
