# 000 — Conventions

**Status:** Approved
**Pillar:** Foundation

Global rules every tool in this server follows. Other specs inherit these by default and only
state deviations.

## Tool naming

- `snake_case`, verb-first: `boot_device`, `read_console`, `run_build`.
- No platform prefixes on unified tools — the agent must not need to know whether it is
  talking to `simctl` or `adb`.
- Names are stable API. Renames require a deprecation cycle (old name kept one minor release
  with a deprecation note in the description).

## Descriptions

Tool descriptions state **when to call the tool**, not just what it does, and mention key
constraints inline (e.g. "requires Metro running"). Descriptions are part of the model's
context on every turn: keep them under ~3 sentences.

## Schemas & annotations

- Every tool defines a zod `inputSchema` (all fields `.describe()`d) and an `outputSchema`.
- Every tool sets annotations: `readOnlyHint` for pure queries; `destructiveHint` for
  irreversible operations; `idempotentHint` where repeat calls are safe; `openWorldHint: false`
  everywhere (this server talks only to local toolchains).

## Response shape

Every tool returns **both**:

1. `content` — a short human-readable text summary (1–5 lines). Never a raw log dump.
2. `structuredContent` — an object conforming to the tool's `outputSchema`.

### Token budgets

- `content` text: ≤ 600 characters unless the spec says otherwise.
- Lists are capped and say so: `{ items, totalCount, shown }` with a hint on how to get more.
- Large artifacts (logs, screenshots) go to disk; tools return the **path** plus a structured
  summary. The agent's own file tools are the escape hatch for raw data.

## Errors

Failures the model can act on are returned as tool results with `isError: true` — never as
protocol-level errors — so the model can read and self-correct. The payload is:

```jsonc
{
  "code": "METRO_NOT_RUNNING",        // stable, SCREAMING_SNAKE error code
  "message": "No Metro dev server found on port 8081.",
  "remediation": "Start it with `npx expo start` or `npx react-native start`, then retry.",
  "details": { }                       // optional, code-specific context
}
```

Error codes are registered in `src/shared/errors.ts` and documented in the spec that owns them.
Unexpected failures (bugs, unparsable toolchain output) include the underlying message but
must never leak environment secrets.

## Logging

`stdout` belongs to the MCP stdio transport. All server logging goes to `stderr`, off by
default, enabled with `--verbose`.

## Source ↔ spec traceability

Each `*/tools.ts` file carries a `// spec: NNN` header. Each acceptance criterion maps to a
vitest case named `ACn: <description>`.
