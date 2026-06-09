// spec: 020-023 — runtime bridge tools
import { z } from 'zod';
import { ToolError } from '../shared/errors.js';
import { ok } from '../shared/result.js';
import { defineTool } from '../tools/registry.js';
import type { ConsoleLevel } from './console-buffer.js';
import { evaluateExpression } from './evaluate.js';

export const listRuntimeTargetsTool = defineTool({
  name: 'list_runtime_targets',
  title: 'List runtime targets',
  description:
    'List debuggable React Native runtimes exposed by Metro. Call when a runtime tool reports TARGET_AMBIGUOUS or to check what is connectable. Requires Metro running.',
  spec: '020',
  annotations: { readOnlyHint: true },
  inputSchema: {
    port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('Metro port (default: server --metro-port)'),
  },
  outputSchema: {
    targets: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        selected: z.boolean(),
      }),
    ),
    metroPort: z.number(),
  },
  handler: async (args, ctx) => {
    const port = args.port ?? ctx.config.metroPort;
    const targets = await ctx.metro.listTargets(port);
    const selected = ctx.metro.selectedTargetId;
    const structured = {
      targets: targets.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        selected: t.id === selected,
      })),
      metroPort: port,
    };
    const text =
      targets.length === 0
        ? 'Metro is running but no app runtime is connected — open the app on a device.'
        : `${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.map((t) => `${t.title} (${t.id})`).join(', ')}`;
    return ok(text, structured);
  },
});

export const readConsoleTool = defineTool({
  name: 'read_console',
  title: 'Read console logs',
  description:
    'Read console logs from the running React Native app (buffered since the runtime bridge connected). Cursor-based: pass the previous nextCursor to read only new entries. Requires Metro running.',
  spec: '021',
  annotations: { readOnlyHint: true },
  inputSchema: {
    cursor: z
      .number()
      .int()
      .optional()
      .describe('Read entries after this cursor (from a previous nextCursor)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max entries to return (default 50)'),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional().describe('Minimum severity'),
    filter: z.string().optional().describe('Case-insensitive regex applied to entry text'),
    targetId: z.string().optional().describe('Runtime target id (from list_runtime_targets)'),
  },
  outputSchema: {
    entries: z.array(
      z.object({
        seq: z.number(),
        ts: z.number(),
        level: z.enum(['debug', 'info', 'warn', 'error']),
        text: z.string(),
        repeat: z.number().optional(),
      }),
    ),
    nextCursor: z.number(),
    dropped: z.number().describe('Entries lost to ring-buffer overflow since the cursor'),
    bufferedSince: z.number(),
  },
  handler: async (args, ctx) => {
    let filter: RegExp | undefined;
    if (args.filter !== undefined) {
      try {
        filter = new RegExp(args.filter, 'i');
      } catch (err) {
        throw new ToolError(
          'INVALID_REGEX',
          `Invalid filter regex: ${(err as Error).message}`,
          'Fix the regex pattern and retry.',
        );
      }
    }
    await ctx.metro.ensureSession(args.targetId);
    const result = ctx.metro.buffer.read({
      cursor: args.cursor,
      limit: args.limit,
      level: args.level as ConsoleLevel | undefined,
      filter,
    });
    const errors = result.entries.filter((e) => e.level === 'error');
    const lines = [
      `${result.entries.length} entr${result.entries.length === 1 ? 'y' : 'ies'}${errors.length ? ` (${errors.length} error${errors.length === 1 ? '' : 's'})` : ''} · cursor ${result.nextCursor}${result.dropped ? ` · ${result.dropped} dropped (buffer overflow)` : ''}`,
      ...result.entries
        .slice(-10)
        .map((e) => `[${e.level}] ${e.text}${e.repeat ? ` ×${e.repeat}` : ''}`),
    ];
    return ok(lines.join('\n'), { ...result, bufferedSince: ctx.metro.buffer.bufferedSince });
  },
});

export const evaluateJsTool = defineTool({
  name: 'evaluate_js',
  title: 'Evaluate JavaScript in the app',
  description:
    'Execute a JavaScript expression inside the running React Native app and return the result. Use to inspect state (Redux/Zustand stores, globals) or trigger behavior. Promises are awaited via polling (Hermes limitation), up to timeoutMs. This can mutate app state — prefer read-only expressions when verifying. Requires Metro running.',
  spec: '022',
  inputSchema: {
    expression: z.string().describe('A JS expression (wrap multi-statement code in an IIFE)'),
    awaitPromise: z
      .boolean()
      .optional()
      .describe('Await a returned Promise via polling (default true)'),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(30_000)
      .optional()
      .describe('Promise wait budget (default 5000)'),
    targetId: z.string().optional().describe('Runtime target id (from list_runtime_targets)'),
  },
  outputSchema: {
    resultType: z.string(),
    result: z.unknown().optional(),
    preview: z
      .string()
      .optional()
      .describe('String preview when the value is not fully serializable'),
    truncated: z.boolean().optional(),
    exception: z.object({ text: z.string(), stack: z.string().optional() }).optional(),
  },
  handler: async (args, ctx) => {
    const connection = await ctx.metro.ensureSession(args.targetId);
    const outcome = await evaluateExpression(connection, args.expression, {
      awaitPromise: args.awaitPromise,
      timeoutMs: args.timeoutMs,
    });
    if (outcome.status === 'timeout') {
      throw new ToolError(
        'EVALUATE_TIMEOUT',
        `The promise did not settle within ${args.timeoutMs ?? 5000}ms.`,
        'Raise timeoutMs, or restructure the expression to resolve faster.',
      );
    }
    if (outcome.status === 'exception') {
      throw new ToolError(
        'EVALUATE_EXCEPTION',
        outcome.exception?.text ?? 'Expression threw.',
        'Fix the expression and retry. Remember it must be an expression — wrap statements in an IIFE.',
        { exception: outcome.exception },
      );
    }
    const display = outcome.preview ?? JSON.stringify(outcome.result);
    return ok(
      `(${outcome.resultType}) ${display ?? 'undefined'}${outcome.truncated ? ' [truncated]' : ''}`,
      {
        resultType: outcome.resultType ?? 'undefined',
        result: outcome.result,
        preview: outcome.preview,
        truncated: outcome.truncated,
      },
    );
  },
});

export const reloadAppTool = defineTool({
  name: 'reload_app',
  title: 'Reload app',
  description:
    "Trigger a full JS reload of the running React Native app (same as pressing 'r' in the Metro terminal). Requires Metro running.",
  spec: '023',
  annotations: { idempotentHint: true },
  inputSchema: {
    targetId: z.string().optional().describe('Runtime target id (from list_runtime_targets)'),
  },
  outputSchema: { reloaded: z.boolean() },
  handler: async (args, ctx) => {
    let reloaded = false;
    try {
      const connection = await ctx.metro.ensureSession(args.targetId);
      await connection.send('Page.reload');
      reloaded = true;
    } catch {
      // fall through to the HTTP broadcast endpoint
    }
    if (!reloaded) {
      const url = `http://localhost:${ctx.config.metroPort}/reload`;
      try {
        const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(2_000) });
        reloaded = response.ok;
      } catch {
        reloaded = false;
      }
    }
    if (!reloaded) {
      throw new ToolError(
        'METRO_NOT_RUNNING',
        'Could not reach the app to reload (CDP and HTTP /reload both failed).',
        'Check Metro is running and the app is open, then retry.',
      );
    }
    ctx.metro.invalidate(); // session is stale after a reload; next call reconnects
    return ok('Reload triggered', { reloaded: true });
  },
});

export const metroTools = [listRuntimeTargetsTool, readConsoleTool, evaluateJsTool, reloadAppTool];
