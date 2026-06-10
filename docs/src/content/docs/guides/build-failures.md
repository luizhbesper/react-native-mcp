---
title: Debugging build failures
description: How the signature database turns native build logs into actionable diagnostics.
---

Native build logs are where coding agents stall: thousands of lines, the real error buried
mid-way, and the fix rarely stated. This server ships a curated **signature database** of
known React Native build failures (`signatures/*.yaml` in the repo) covering iOS/xcodebuild,
Gradle, CocoaPods and Metro.

## What you get

When a build finishes (or when you call `parse_build_log` on any existing log):

```json
{
  "status": "failed",
  "errorCount": 2,
  "diagnostics": [
    {
      "signatureId": "cocoapods-sandbox-not-in-sync",
      "errorType": "dependency",
      "message": "Sandbox not in sync with Podfile.lock",
      "probableCause": "CocoaPods install is out of date relative to Podfile.lock — typical after switching branches or upgrading React Native.",
      "suggestedFix": "Run pod install in the ios/ directory (tool run_pod_install)."
    }
  ],
  "logPath": "/tmp/react-native-dev-mcp/builds/a1b2c3d4.log"
}
```

- **At most 10 diagnostics**, ordered by where they appear in the log.
- When *no* signature matches a failure, you get `logTail` (the last 40 lines) plus generic
  compiler-error extraction (file/line from clang, Kotlin, javac), so there is always signal.
- `logPath` is the escape hatch — the full log stays on disk for grepping.

## Offline parsing

Builds that ran outside the server (a terminal, CI, Xcode) parse the same way:

```text
parse_build_log {logPath: "/path/to/ci-build.log"}
parse_build_log {logText: "<paste the failing section>"}
```

## When the database doesn't know your error

That's a contribution opportunity — adding a signature is **YAML + a log snippet, zero
TypeScript**. See [contributing signatures](/react-native-mcp/contributing/signatures/).
