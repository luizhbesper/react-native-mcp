# 020 — Metro discovery & CDP session

**Status:** Implemented
**Pillar:** Runtime bridge

## Motivation

The eyes of the agent. Metro's dev middleware exposes the Hermes runtime over the Chrome
DevTools Protocol — no code injection, no extra dependency in the app, works for Expo and
bare projects alike (both serve the same endpoints on the Metro port).

## Protocol facts (RN 0.76+ "Fusebox")

- `GET http://localhost:<port>/json/list` (alias `/json`) returns CDP targets:
  `{ id, title, description, webSocketDebuggerUrl, ... }`.
- CDP rides the `webSocketDebuggerUrl`. Hermes accepts **one debugger connection at a time**;
  attaching React Native DevTools evicts us and vice versa.
- Modern targets are preferred via title/description/capability markers; stale targets from
  previous reloads may linger in the list.
- `Runtime.evaluate` works; `awaitPromise` does not (facebook/react-native#46966) — see
  spec 022 for the workaround.

## Session lifecycle (internal, not a tool)

1. **Lazy connect:** the first runtime-tool call triggers discovery + WebSocket connect +
   `Runtime.enable`/`Log.enable`. The server never connects at startup (it must not steal the
   single debugger slot from a human who never uses runtime tools). `--eager-metro` opts into
   connecting at startup so console buffering starts immediately.
2. **Target selection:** exactly one viable target → auto-select. Multiple → tools return
   `TARGET_AMBIGUOUS` with the target list; the agent picks via `targetId` (or calls
   `list_runtime_targets`). Selection is cached for the session.
3. **Staleness:** socket close, `Runtime.executionContextDestroyed`, or target-id change
   after reload mark the session stale. The **next** runtime-tool call re-discovers and
   reconnects — no background reconnect loop (it would fight DevTools for the slot).
4. The console ring buffer (spec 021) survives reconnects; a synthetic
   `[runtime reconnected]` entry marks the boundary.

## Tool contracts

### `list_runtime_targets`

- **Description:** "List debuggable React Native runtimes exposed by Metro. Call when a
  runtime tool reports TARGET_AMBIGUOUS or to check what is connectable."
- **Gate:** always. **Annotations:** `readOnlyHint: true`.
- **Input:** `{ port?: number /* default: --metro-port, 8081 */ }`
- **Output:** `{ targets: [{ id, title, description, selected: boolean }], metroPort }`

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `METRO_NOT_RUNNING` | `/json/list` unreachable | start Metro; check `--metro-port` |
| `NO_TARGETS` | Metro up, list empty | open the app on a device so it registers |
| `TARGET_AMBIGUOUS` | >1 viable target, none selected | pass `targetId` from the included list |
| `DEBUGGER_OCCUPIED` | handshake rejected / evicted by DevTools | close React Native DevTools (the `j` key tab) and retry |

## Acceptance criteria

- **AC-1** Given no Metro on the port, When any runtime tool is called, Then
  `METRO_NOT_RUNNING` with the probed URL in details.
- **AC-2** Given a single-target `/json/list` fixture, When a runtime tool is called, Then the
  session auto-connects and the tool proceeds.
- **AC-3** Given two viable targets, When `read_console` is called without `targetId`, Then
  `TARGET_AMBIGUOUS` lists both.
- **AC-4** Given a connected session whose socket closes, When the next runtime tool runs,
  Then it reconnects transparently and the buffer gains a `[runtime reconnected]` marker.
- **AC-5** Given a server started without `--eager-metro`, When no runtime tool is ever
  called, Then no WebSocket connection is ever opened.

## Test plan

`test/helpers/mock-cdp-server.ts`: in-process HTTP + `ws` server replaying captured
`/json/list` payloads and CDP message scripts (connect, evict, destroy-context sequences).

## Out of scope

Multiplexing alongside an attached DevTools session; breakpoint debugging (Debugger domain);
network domain capture (roadmap).
