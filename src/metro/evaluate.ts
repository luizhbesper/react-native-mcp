// spec: 022 — Runtime.evaluate with the Hermes awaitPromise polling workaround (RN#46966)
import { randomUUID } from 'node:crypto';
import type { CdpConnection } from './cdp-client.js';

export interface EvaluateOutcome {
  status: 'ok' | 'exception' | 'timeout';
  resultType?: string;
  result?: unknown;
  preview?: string;
  truncated?: boolean;
  exception?: { text: string; stack?: string };
}

interface RemoteObject {
  type?: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  description?: string;
}

interface EvaluateResponse {
  result?: RemoteObject;
  exceptionDetails?: {
    text?: string;
    exception?: RemoteObject;
    stackTrace?: {
      callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number }>;
    };
  };
}

const MAX_RESULT_CHARS = 16 * 1024;

function buildOutcome(obj: RemoteObject | undefined): EvaluateOutcome {
  if (!obj) return { status: 'ok', resultType: 'undefined' };
  const resultType = obj.subtype ?? obj.type ?? 'undefined';
  if ('value' in obj) {
    const serialized = JSON.stringify(obj.value);
    if (serialized && serialized.length > MAX_RESULT_CHARS) {
      return {
        status: 'ok',
        resultType,
        preview: `${serialized.slice(0, MAX_RESULT_CHARS)}…`,
        truncated: true,
      };
    }
    return { status: 'ok', resultType, result: obj.value ?? null };
  }
  return { status: 'ok', resultType, preview: obj.description ?? obj.className ?? resultType };
}

function exceptionOutcome(
  details: NonNullable<EvaluateResponse['exceptionDetails']>,
): EvaluateOutcome {
  const text =
    details.exception?.description ??
    details.exception?.value?.toString?.() ??
    details.text ??
    'Evaluation threw';
  const stack = (details.stackTrace?.callFrames ?? [])
    .slice(0, 5)
    .map((f) => `  at ${f.functionName || '<anonymous>'} (${f.url ?? '?'}:${f.lineNumber ?? '?'})`)
    .join('\n');
  return { status: 'exception', exception: { text: String(text), stack: stack || undefined } };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function evaluateExpression(
  connection: CdpConnection,
  expression: string,
  options: { awaitPromise?: boolean; timeoutMs?: number } = {},
): Promise<EvaluateOutcome> {
  const awaitPromise = options.awaitPromise ?? true;
  const timeoutMs = options.timeoutMs ?? 5_000;

  if (!awaitPromise) {
    const response = (await connection.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as EvaluateResponse;
    if (response.exceptionDetails) return exceptionOutcome(response.exceptionDetails);
    return buildOutcome(response.result);
  }

  // Hermes lacks CDP awaitPromise: settle the promise into a unique global, then poll it.
  const key = `__rnmcp_${randomUUID().replaceAll('-', '')}`;
  const wrapped = `(function () {
    var __v = (${expression});
    if (__v && typeof __v.then === 'function') {
      globalThis[${JSON.stringify(key)}] = { status: 'pending' };
      __v.then(
        function (val) { globalThis[${JSON.stringify(key)}] = { status: 'fulfilled', value: val }; },
        function (err) { globalThis[${JSON.stringify(key)}] = { status: 'rejected', error: String((err && err.stack) || err) }; }
      );
      return { __rnmcpAsync: true };
    }
    return { __rnmcpAsync: false, value: __v };
  })()`;

  const response = (await connection.send('Runtime.evaluate', {
    expression: wrapped,
    returnByValue: true,
  })) as EvaluateResponse;

  if (response.exceptionDetails) return exceptionOutcome(response.exceptionDetails);

  const value = response.result?.value as { __rnmcpAsync?: boolean; value?: unknown } | undefined;
  if (!value || typeof value !== 'object' || !('__rnmcpAsync' in value)) {
    // wrapper result wasn't serializable — fall back to a by-reference preview of the raw expression
    const fallback = (await connection.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
    })) as EvaluateResponse;
    if (fallback.exceptionDetails) return exceptionOutcome(fallback.exceptionDetails);
    return buildOutcome(fallback.result);
  }

  if (!value.__rnmcpAsync) {
    return buildOutcome({ type: typeof value.value, value: value.value });
  }

  const cleanup = () =>
    connection
      .send('Runtime.evaluate', {
        expression: `delete globalThis[${JSON.stringify(key)}]`,
        returnByValue: true,
      })
      .catch(() => undefined);

  const deadline = Date.now() + timeoutMs;
  let interval = 50;
  while (Date.now() < deadline) {
    await delay(interval);
    interval = Math.min(interval * 2, 250);
    const poll = (await connection.send('Runtime.evaluate', {
      expression: `globalThis[${JSON.stringify(key)}]`,
      returnByValue: true,
    })) as EvaluateResponse;
    const state = poll.result?.value as
      | { status: 'pending' | 'fulfilled' | 'rejected'; value?: unknown; error?: string }
      | undefined;
    if (!state || state.status === 'pending') continue;
    await cleanup();
    if (state.status === 'rejected') {
      return { status: 'exception', exception: { text: state.error ?? 'Promise rejected' } };
    }
    return buildOutcome({ type: typeof state.value, value: state.value });
  }
  await cleanup();
  return { status: 'timeout' };
}
