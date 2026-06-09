# 032 — Offline log parsing

**Status:** Approved
**Pillar:** Build diagnostics

## Motivation

Builds often run outside this server — in a terminal, on CI, in Xcode. The same signature
engine must work on any log the agent can point at, and it doubles as the recovery path when
the server restarted mid-build (spec 030).

## Tool contracts

### `parse_build_log`

- **Description:** "Parse a native build log (xcodebuild, Gradle, CocoaPods, Metro) into
  structured diagnostics with probable causes and suggested fixes. Use on logs from
  terminals, CI, or a logPath from get_build_status."
- **Gate:** always. **Annotations:** `readOnlyHint: true`.
- **Input:** exactly one of:
  - `logPath: string` — file on disk (max 20MB), or
  - `logText: string` — pasted snippet (max 256KB).
- **Output:**
  ```jsonc
  {
    "diagnostics": [ {
      "signatureId": "ios-sandbox-not-in-sync",  // absent for generic extractor hits
      "errorType": "dependency",
      "file": "ios/Podfile.lock", "line": 12,     // when extractable
      "message": "≤300 chars",
      "probableCause": "…", "suggestedFix": "…"
    } ],                                           // ≤10, ordered by log position
    "errorCount": 2, "warningCount": 14,
    "platformGuess": "ios" | "android" | "cocoapods" | "metro" | "unknown",
    "unmatchedTail": "last 40 lines"               // only when errorCount>0 and no signature hit
  }
  ```

## Behavior

1. Detect platform by content heuristics (`xcodebuild`, `> Task :`, `pod install` markers) to
   prioritize signature files, but always run all signatures.
2. Run signature matcher (spec 031), then generic extractors for unmatched error lines.
3. Count raw `error:`/`warning:` style lines for `errorCount`/`warningCount`.

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `LOG_NOT_FOUND` | bad `logPath` | check the path |
| `LOG_TOO_LARGE` | >20MB file / >256KB text | pass the file path instead of text; or trim |
| `INVALID_INPUT` | both/neither of logPath & logText | provide exactly one |

## Acceptance criteria

- **AC-1** Given a fixture log with two known failures, When parsed via `logPath`, Then both
  diagnostics appear ordered by position.
- **AC-2** Given the same content via `logText`, Then identical output.
- **AC-3** Given a clean success log, Then `diagnostics: []`, `errorCount: 0`, no
  `unmatchedTail`.
- **AC-4** Given a Gradle log, Then `platformGuess: "android"`.
- **AC-5** Given both inputs supplied, Then `INVALID_INPUT`.

## Test plan

Shares fixtures with spec 031; adds heuristics and input-validation cases.

## Out of scope

Streaming parse of in-progress logs; multi-log correlation.
