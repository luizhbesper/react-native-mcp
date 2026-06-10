# AGENTS.md

Guidance for AI agents working on this repository (react-native-dev-mcp — an MCP server
for React Native development).

## Commands

```bash
pnpm install              # setup (pnpm 10+, Node 22+)
pnpm test                 # vitest unit suites — must pass before any commit
pnpm lint                 # biome (format + lint); pnpm lint:fix to autofix
pnpm typecheck            # tsc --noEmit
pnpm build                # tsdown → dist/index.mjs
node scripts/mcp-call.mjs <tool> '<json>'   # call any tool against the built server
```

## Architecture in 30 seconds

- `src/tools/registry.ts` — `defineTool()`; every tool is defined with zod in/out schemas,
  annotations, a spec id, and an optional capability gate. Start here.
- `src/env/` — startup capability detection; drives which tools get registered (spec 002).
- `src/devices/` — `facade.ts` routes unified device ids to `backends/simctl.ts` (iOS) or
  `backends/adb.ts` (Android).
- `src/metro/` — CDP bridge to the app's Hermes runtime via Metro's `/json/list`:
  console ring buffer, `evaluate_js` (promise polling workaround — Hermes lacks
  `awaitPromise`), reload.
- `src/build/` — background build jobs + the YAML signature DB (`signatures/*.yaml`) that
  parses native build logs into diagnostics.

## Hard rules

1. **Spec-first.** Tool contracts live in `specs/NNN-*.md`. Changing tool behavior means
   changing the spec in the same PR. Acceptance criteria map 1:1 to vitest case names.
2. **stdout is the MCP transport.** Never `console.log` in `src/` — use
   `src/shared/logger.ts` (stderr, gated by `--verbose`).
3. **No shell strings from inputs.** All toolchain calls go through `src/shared/exec.ts`
   with argv arrays. For `adb shell`, quote with `shellQuote()`.
4. **Tests must not require Xcode or the Android SDK.** Mock through the exec seam with
   fixtures in `test/fixtures/`. Real-device suites live in `test/integration/` behind
   `RUN_SIMULATOR_TESTS`/`RUN_ANDROID_TESTS` env vars.
5. **Token budgets are part of every contract** (spec 000): short text summary +
   `structuredContent`; lists capped; raw logs go to disk, return the path.
6. **Error envelope:** failures the model can act on are `isError: true` results with
   `{code, message, remediation}` — codes are registered in `src/shared/errors.ts`.

## Adding a build error signature

YAML entry in `signatures/{ios,android,cocoapods,metro}.yaml` + a real log excerpt in
`test/fixtures/build-logs/<platform>/<id>.log`. The test suite is generated from the YAML:
your fixture must match, and the regex must not match any log in
`test/fixtures/build-logs/clean/`.

## Releasing

Changesets (`pnpm changeset`). Merging the release PR publishes to npm via OIDC and to the
MCP Registry (`server.json`). Don't bump versions by hand.
