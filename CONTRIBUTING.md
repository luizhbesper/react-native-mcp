# Contributing

Thanks for helping! This project is small on purpose — most contributions fall into one of
three buckets, from easiest to hardest.

## 1. Contribute a build error signature (no TypeScript needed)

The signature database (`signatures/*.yaml`) is what turns 4,000-line native build logs into
actionable diagnostics. If you hit a build failure this server didn't recognize:

1. Add an entry to the right YAML file (`ios`, `android`, `cocoapods`, `metro`):

   ```yaml
   - id: android-my-new-failure          # kebab-case, prefixed by platform
     title: Short human title
     platform: android
     match:
       - 'a regex matched against each log line'
     errorType: dependency | compile | link | codegen | config | environment | cache
     probableCause: Why this happens.
     suggestedFix: What fixes it (mention our tools when relevant, e.g. run_pod_install).
     fixtures:
       - android/my-new-failure.log
   ```

2. Add the real log excerpt (10–30 lines around the error, paths redacted if you like) at
   `test/fixtures/build-logs/android/my-new-failure.log`.
3. Run `pnpm test`. The signature suite is generated from the YAML: it asserts your fixture
   matches, and that your regex does **not** match any clean build log.

That's the whole contract. If you can't open a PR, use the
[signature issue form](https://github.com/luizhbesper/react-native-mcp/issues/new?template=signature.yml).

## 2. Fix a bug

- `pnpm install`, then `pnpm test` / `pnpm lint` / `pnpm typecheck` must pass.
- Tests live in `test/unit` and mock all toolchains through `src/shared/exec.ts` — recorded
  outputs go in `test/fixtures/`. No test may require Xcode or the Android SDK (CI runs on
  all three OSes; the real-device suites in `test/integration/` are env-gated).
- Add a changeset for user-facing fixes: `pnpm changeset`.

## 3. Add or change a tool (spec-driven)

This repo is spec-first: every tool's canonical contract lives in `specs/`.

1. Open a PR that adds/edits the spec (use `specs/templates/spec-template.md`) with status
   `Draft`. Discussion happens there.
2. Once merged as `Approved`, implement it: tool definitions go in the pillar's `tools.ts`
   via `defineTool()` (see `src/tools/registry.ts` — it enforces naming, annotations,
   gating and the error envelope from spec 000).
3. Acceptance criteria map 1:1 to named vitest cases (`AC1: …`).
4. Flip the spec status to `Implemented` in the same PR.

### Conventions worth knowing

- Tool names are stable API: `snake_case`, verb-first.
- `stdout` belongs to the MCP transport — log to stderr only (`src/shared/logger.ts`).
- Every toolchain invocation goes through the exec seam with argv arrays. Never build shell
  strings from tool inputs.
- Responses are token-budgeted: short text + `structuredContent`. Big artifacts go to disk
  and return a path. Read `specs/000-conventions.md` before adding any tool.

## Local development

```bash
pnpm install
pnpm dev                 # rebuild on change
pnpm test:watch
node scripts/mcp-call.mjs doctor          # call any tool against the built server
claude mcp add rn-dev-local -- node /abs/path/to/dist/index.mjs   # use it from Claude Code
```

## Releases

Maintainers merge the changesets release PR; CI publishes to npm (OIDC trusted publishing
with provenance) and to the MCP Registry. See `specs/041-release-publishing.md`.
