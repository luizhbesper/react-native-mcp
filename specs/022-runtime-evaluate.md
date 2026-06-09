# 022 — Runtime evaluate

**Status:** Approved
**Pillar:** Runtime bridge

## Motivation

`Runtime.evaluate` executes JS inside the live app: inspect Redux/Zustand state, read a
variable, trigger navigation. It turns "wrote the patch" into "verified the patch works" —
without touching app source.

## Hermes constraint & the await workaround

Hermes does not implement CDP `awaitPromise` (facebook/react-native#46966). When
`awaitPromise: true` (default) and the immediate result is a Promise, the server:

1. Wraps the expression: result is stored on a unique global
   (`globalThis.__rnmcp_<nonce> = { status, value | error }`) when the promise settles.
2. Polls that global with cheap `Runtime.evaluate` calls (50ms → 250ms backoff) until settled
   or `timeoutMs`.
3. Deletes the global afterwards (also on timeout).

Guarantee level: synchronous results are exact; promise results are best-effort within
`timeoutMs`. This is documented in the tool description so the model sets expectations.

## Tool contracts

### `evaluate_js`

- **Description:** "Execute a JavaScript expression inside the running React Native app and
  return the result. Use to inspect state (Redux/Zustand stores, globals) or trigger
  behavior. Promises are awaited via polling (Hermes limitation), up to timeoutMs. This can
  mutate app state — prefer read-only expressions when verifying."
- **Gate:** always. **Annotations:** none read-only (it can mutate); `openWorldHint: false`.
- **Input:**
  - `expression: string`
  - `awaitPromise?: boolean` — default true.
  - `timeoutMs?: number` — default 5000, max 30000.
  - `targetId?: string`
- **Output:**
  ```jsonc
  {
    "resultType": "string" | "number" | "boolean" | "object" | "undefined" | "function" | ...,
    "result": <JSON value>,         // returnByValue when serializable
    "preview": "Object {a: 1, …}",  // when not fully serializable
    "exception": { "text": "...", "stack": "..." } // present on throw
  }
  ```
  Serialized result is truncated at 16KB with a `truncated: true` flag — ask for narrower
  expressions instead of dumping whole stores.
- **Text:** the result preview or the exception text.

## Edge cases & errors

| code | when | remediation |
| --- | --- | --- |
| `EVALUATE_TIMEOUT` | promise didn't settle in `timeoutMs` | raise timeout or restructure expression |
| `EVALUATE_EXCEPTION` | expression threw (also surfaced in `exception`) | fix the expression; result `isError: true` so the model self-corrects |

Inherits spec 020 session errors.

## Acceptance criteria

- **AC-1** Given `1 + 1`, When evaluated, Then `{ result: 2, resultType: "number" }`.
- **AC-2** Given `Promise.resolve(42)` with `awaitPromise: true`, When evaluated against a
  mock that implements the global-polling protocol, Then `result: 42` and the temp global is
  deleted.
- **AC-3** Given a never-settling promise and `timeoutMs: 200`, When evaluated, Then
  `EVALUATE_TIMEOUT` and the temp global is deleted.
- **AC-4** Given a throwing expression, When evaluated, Then `isError: true` with
  `exception.text` populated.
- **AC-5** Given a 1MB object result, When evaluated, Then output is truncated at 16KB with
  `truncated: true`.

## Test plan

Mock-CDP server scripted for each AC, including the polling protocol (returns "pending" twice,
then settled).

## Out of scope

Debugger-domain stepping/breakpoints; persistent REPL context; source-mapped stack
symbolication (roadmap).
