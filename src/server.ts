import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import packageJson from '../package.json' with { type: 'json' };
import { buildToolCatalog } from './tools/catalog.js';
import type { ToolContext } from './tools/context.js';
import { registerTools, visibleToolNames } from './tools/registry.js';

export const SERVER_VERSION: string = packageJson.version;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({
    name: 'react-native-dev-mcp',
    version: SERVER_VERSION,
  });
  registerTools(server, ctx, buildToolCatalog(ctx.capabilities));
  return server;
}

export { buildToolCatalog, visibleToolNames };
