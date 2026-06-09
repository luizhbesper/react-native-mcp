# 021 — Console streaming

**Status:** Approved
**Pillar:** Runtime bridge

## Motivation

"It logs an error" is the most common debugging signal in RN development. The server buffers
console traffic from the live app so the agent reads it incrementally — like `tail -f` with a
cursor — without ever flooding the model context.

## Design

- Source events: `Runtime.consoleAPICalled` (console.log/warn/error/info/debug) and
  `Log.entryAdded`; uncaught errors via `Runtime.exceptionThrown` are folded in as
  `level: "error"` entries with the exception text and stack head.
- **Ring buffer** of 5,000 entries per session, monotonically increasing sequence numbers.
  Overwritten entries increment a `dropped` counter since the reader's cursor.
- Entries: `{ seq, ts, level, text, repeat? }`. Consecutive identical (level+text) entries
  collapse into one with `repeat: N`.
- Argument stringification: primitives inline; objects via `RemoteObject` preview, truncated
  at 500 chars per entry with a `…[+N chars]` suffix. We do not fetch full object graphs.

## Tool contracts

### `read_console`

- **Description:** "Read console logs from the running React Native app (buffered since the
  runtime bridge connected). Cursor-based: pass the previous `nextCursor` to read only new
  entries. Requires Metro running."
- **Gate:** always. **Annotations:** `readOnlyHint: true`.
- **Input:**
  - `cursor?: number` — read entries with `seq > cursor`; omit for the most recent page.
  - `limit?: number` — default 50, max 200.
  - `level?: "debug"|"info"|"warn"|"error"` — minimum severity filter.
  - `filter?: string` — case-insensitive regex applied to `text`.
  - `targetId?: string`
- **Output:** `{ entries, nextCursor, dropped, bufferedSince: ts }`
- **Text:** `"14 new entries (3 errors) · cursor 1287"` plus the last few error lines.

## Edge cases & errors

Inherits spec 020 codes. Additionally:

| code | when | remediation |
| --- | --- | --- |
| `INVALID_REGEX` | `filter` fails to compile | fix the pattern |

First call with no cursor returns the **latest** `limit` entries (not the oldest), because
"what just happened" is the common question.

## Acceptance criteria

- **AC-1** Given 60 buffered entries and `limit: 50` with no cursor, When read, Then the 50
  most recent entries return with `nextCursor` = last seq.
- **AC-2** Given a cursor, When read, Then only entries with `seq > cursor` return.
- **AC-3** Given 6,000 events pushed into a 5,000 ring, When read from an old cursor, Then
  `dropped > 0` reflects the overwritten count.
- **AC-4** Given the same warning logged 30× consecutively, When read, Then one entry with
  `repeat: 30`.
- **AC-5** Given a 10KB console.log payload, When read, Then its text is truncated at 500
  chars with the truncation suffix.
- **AC-6** Given `level: "error"`, When read, Then warn/info/debug entries are excluded but
  still advance seq numbering.

## Test plan

Pure unit tests on the ring buffer (no I/O); mock-CDP replay of a captured
`consoleAPICalled`/`exceptionThrown` session asserting end-to-end shapes and token budgets
(serialized `structuredContent` of a default read ≤ 8KB).

## Out of scope

Persisting logs across server restarts; native (adb logcat / os_log) logs — roadmap as
`read_device_logs`.
