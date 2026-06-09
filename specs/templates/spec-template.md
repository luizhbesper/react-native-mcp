# NNN — Title

**Status:** Draft | Approved | Implemented | Verified
**Pillar:** Foundation | Device control | Runtime bridge | Build diagnostics | Distribution

## Motivation

Why this exists, from the agent's point of view. What loop does it unlock?

## Tool contracts

For each tool:

### `tool_name`

- **Description (as shown to the model):** one or two sentences stating *when* to call it.
- **Gate:** capability required for registration (see spec 002).
- **Annotations:** `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- **Input schema:** field-by-field, with defaults.
- **Output (`structuredContent`):** field-by-field.
- **Text content:** the one-to-few-line human summary returned alongside.

## Behavior

Normal flow, step by step. Include sequence notes for stateful interactions.

## Edge cases & errors

Table of `{ code, when, remediation }` structured errors this feature can return.

## Acceptance criteria

- **AC-1** Given … When … Then …
- **AC-2** …

## Test plan

Which suites/fixtures cover the criteria; what is unit vs integration vs manual checklist.

## Out of scope

Explicit non-goals to keep review focused.
