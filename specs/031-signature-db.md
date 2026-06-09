# 031 — Signature database

**Status:** Approved
**Pillar:** Build diagnostics

## Motivation

Native build logs are 4,000-line walls where agents stall. A curated database of known RN
failure signatures turns them into `{ errorType, file, line, probableCause, suggestedFix }`.
This is the community-contribution surface: adding a known failure must require **YAML + a
log fixture, zero TypeScript**.

## Format

Files: `signatures/{ios,android,cocoapods,metro}.yaml` at the repo/package root (shipped in
the npm package, parsed at runtime, zod-validated at load).

```yaml
- id: ios-sandbox-not-in-sync            # kebab, prefixed by domain, unique
  title: Sandbox not in sync with Podfile.lock
  platform: ios                          # ios | android | cocoapods | metro
  match:
    - 'The sandbox is not in sync with the Podfile\.lock'
  errorType: dependency                  # dependency | compile | link | codegen | config | environment | cache
  probableCause: >-
    CocoaPods install is out of date relative to Podfile.lock — typical after switching
    branches or upgrading React Native.
  suggestedFix: Run pod install in the ios/ directory (tool run_pod_install).
  docs:
    - https://example.com/optional-links
  fixtures:
    - cocoapods/sandbox-not-in-sync.log  # REQUIRED: ≥1 path under test/fixtures/build-logs/
```

### Matching semantics

- `match` entries are JS regexes (case-sensitive) applied per line over the raw log.
- Multiple `match` patterns = OR. First matching line wins for `file`/`line` extraction.
- `file`/`line` come from named groups `(?<file>…)` / `(?<line>\d+)` when present in the
  pattern; otherwise from a generic per-platform extractor (clang `path:line:col: error:`,
  Gradle `> Task :app:… FAILED` + `e: file:line`, etc.).
- Each signature reports at most once per log (dedup by id); diagnostics order = first
  match position in the log.

## Contribution contract (enforced by a generated test suite)

1. Every signature references ≥1 fixture; the suite asserts each fixture **matches** its
   signature.
2. No signature may match any log in the **negative corpus**
   (`test/fixtures/build-logs/clean/`) — successful builds must produce zero diagnostics.
3. Regex lint: patterns are line-anchored or bounded (guard against catastrophic
   backtracking); max length 400 chars.
4. `id` uniqueness across all files.

## Seed set (v0 ships ≥20)

iOS/CocoaPods: sandbox-not-in-sync, duplicate-symbols, header-not-found, provisioning/signing,
SPM resolution failure, pod-version-conflict, ruby/ffi arch mismatch, derived-data corruption,
xcode-version-too-old, simulator-arch-mismatch (arm64 exclusion).
Android/Gradle: daemon-start-failure, jdk-version-mismatch, sdk-location-missing,
aapt-resource-link-failed, duplicate-classes, heap-out-of-memory, ndk-missing,
kotlin-version-conflict, minSdk-conflict.
RN-specific: turbomodule-codegen-missing, new-arch-codegen-stale, metro-port-in-use,
hermes-dsym/strip issues.

## Acceptance criteria

- **AC-1** Given all shipped YAML files, When loaded, Then zod validation passes and ids are
  unique.
- **AC-2** Given each signature's fixtures, When matched, Then the signature fires with the
  expected `errorType` (generated test per signature).
- **AC-3** Given the clean corpus, When matched against every signature, Then zero hits.
- **AC-4** Given a log where one underlying error matches one signature on 3 lines, Then one
  diagnostic (dedup by id).
- **AC-5** Given a clang error line with path and line number, When no signature matches,
  Then the generic extractor still yields `{ file, line, message }` as an `unknown`-type
  diagnostic.

## Test plan

`test/unit/signatures.test.ts` generates one case per signature from the YAML itself, plus
negative-corpus and dedup cases.

## Out of scope

Auto-fix execution (the fix is a suggestion; the agent decides); telemetry of unmatched logs
(roadmap, opt-in).
