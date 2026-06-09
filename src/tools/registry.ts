// spec: 000/002 — defineTool() encodes naming, annotations, gating and error conventions
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { Capabilities } from '../env/capabilities.js';
import { fail, toToolError } from '../shared/result.js';
import type { ToolContext } from './context.js';

export interface ToolDef<TIn extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  /** States WHEN to call the tool, ≤3 sentences (spec 000). */
  description: string;
  /** Spec ID owning this contract, e.g. "011". */
  spec: string;
  /** Registration-time gate (spec 002 Tier 1). Absent = always registered. */
  gate?: (caps: Capabilities) => boolean;
  annotations?: ToolAnnotations;
  inputSchema: TIn;
  outputSchema?: z.ZodRawShape;
  handler: (args: z.infer<z.ZodObject<TIn>>, ctx: ToolContext) => Promise<CallToolResult>;
}

export type AnyToolDef = ToolDef<z.ZodRawShape>;

export function defineTool<TIn extends z.ZodRawShape>(def: ToolDef<TIn>): AnyToolDef {
  return def as unknown as AnyToolDef;
}

/** Names of tools that would be registered for the given capabilities (used by gating tests). */
export function visibleToolNames(defs: readonly AnyToolDef[], caps: Capabilities): string[] {
  return defs.filter((d) => !d.gate || d.gate(caps)).map((d) => d.name);
}

export function registerTools(
  server: McpServer,
  ctx: ToolContext,
  defs: readonly AnyToolDef[],
): void {
  for (const def of defs) {
    if (def.gate && !def.gate(ctx.capabilities)) continue;
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        annotations: { openWorldHint: false, ...def.annotations },
      },
      (async (args: Record<string, unknown>) => {
        try {
          return await def.handler(args as never, ctx);
        } catch (err) {
          return fail(toToolError(err));
        }
      }) as never,
    );
  }
}
