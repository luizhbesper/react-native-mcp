// spec: 000 — every tool returns short text content + structuredContent; errors use the envelope
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from './errors.js';

type Structured = Record<string, unknown>;

export function ok(
  text: string,
  structured: Structured,
  extraContent?: CallToolResult['content'],
): CallToolResult {
  return {
    content: [{ type: 'text', text }, ...(extraContent ?? [])],
    structuredContent: structured,
  };
}

export function fail(error: ToolError): CallToolResult {
  const lines = [`${error.code}: ${error.message}`, `Fix: ${error.remediation}`];
  return {
    isError: true,
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: {
      code: error.code,
      message: error.message,
      remediation: error.remediation,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}

export function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ToolError(
    'INTERNAL_ERROR',
    message,
    'This is likely a bug in react-native-dev-mcp — please report it with the message above.',
  );
}
