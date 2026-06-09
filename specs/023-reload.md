# 023 — Reload

**Status:** Approved
**Pillar:** Runtime bridge

## Motivation

After editing JS, the loop is: reload → read console → verify. Fast Refresh usually handles
edits, but a full reload is the deterministic reset the agent can trigger explicitly.

## Tool contracts

### `reload_app`

- **Description:** "Trigger a full JS reload of the running React Native app (same as
  pressing 'r' in the Metro terminal). Requires Metro running."
- **Gate:** always. **Annotations:** `idempotentHint: true`.
- **Input:** `{ targetId?: string }`
- **Output:** `{ reloaded: true }`
- **Behavior:** primary path sends the CDP `Page.reload` to the selected target; fallback is
  Metro's HTTP reload endpoint (`POST /reload` on the Metro port), which broadcasts to
  connected clients. Success from either path counts.
- After reload the CDP session is marked stale (spec 020); the buffer records
  `[runtime reconnected]` on the next runtime call.

## Edge cases & errors

Inherits spec 020 codes (`METRO_NOT_RUNNING`, `NO_TARGETS`).

## Acceptance criteria

- **AC-1** Given a connected session, When `reload_app`, Then `Page.reload` is sent and the
  session is marked stale.
- **AC-2** Given a target that rejects `Page.reload`, When `reload_app`, Then the HTTP
  fallback fires and the tool still succeeds.
- **AC-3** Given a reload, When `read_console` is next called, Then the session reconnects
  (AC-4 of spec 020).

## Test plan

Mock-CDP scripts for both paths.

## Out of scope

Dev-menu actions (toggle element inspector, performance monitor) — roadmap tool
`open_dev_menu`.
