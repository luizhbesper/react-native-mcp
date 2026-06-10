---
title: Contributing build signatures
description: Turn the build failure you just fixed into a diagnostic for everyone — YAML plus a log snippet, no TypeScript.
---

The signature database is this project's collective memory of React Native build failures.
Every signature you add means an agent somewhere skips the hour you just lost.

## The contract

A signature is an entry in `signatures/{ios,android,cocoapods,metro}.yaml`:

```yaml
- id: android-my-new-failure          # kebab-case, platform-prefixed, unique
  title: Short human title
  platform: android                   # ios | android | cocoapods | metro
  match:
    - 'a JS regex tested against each log line'
  errorType: dependency               # dependency | compile | link | codegen | config | environment | cache
  probableCause: >-
    Why this happens, in one or two sentences.
  suggestedFix: >-
    What fixes it. Mention server tools when relevant (e.g. run_pod_install).
  fixtures:
    - android/my-new-failure.log      # REQUIRED — at least one
```

Plus the matching evidence: a real log excerpt (10–30 lines around the error) at
`test/fixtures/build-logs/android/my-new-failure.log`.

## What CI enforces

The test suite is **generated from the YAML**, so your PR is verified automatically:

1. Your fixture must match your signature.
2. Your regex must **not** match any log in the clean corpus
   (`test/fixtures/build-logs/clean/` — successful builds).
3. Ids are unique; patterns are bounded (≤400 chars); cause and fix are non-trivial.

Run it locally with `pnpm test`.

## Tips for good signatures

- Capture `file`/`line` with named groups when the error line carries them:
  `'(?<file>[^\s:]+):(?<line>\d+): error: …'`.
- Match the **stable** part of the message; version numbers and paths change — prefer
  `[\d.]+` and `\S+` over literals.
- `suggestedFix` should be executable advice, not "investigate the error".

Can't open a PR? Use the
[signature issue form](https://github.com/luizesper/react-native-mcp/issues/new?template=signature.yml)
and a maintainer will convert it.
