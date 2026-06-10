#!/usr/bin/env node
// Call a single tool on the built server over stdio and print the result as JSON.
// Usage: node scripts/mcp-call.mjs <tool> ['{"json":"args"}'] [--server-flags...]
// Example: node scripts/mcp-call.mjs doctor
//          node scripts/mcp-call.mjs list_devices '{"platform":"ios"}' --verbose
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const [tool, ...rest] = process.argv.slice(2);
if (!tool) {
  console.error('usage: mcp-call.mjs <tool> [json-args] [--server-flags...]');
  process.exit(2);
}
const args = rest[0]?.startsWith('{') ? JSON.parse(rest.shift()) : {};

const serverPath = fileURLToPath(new URL('../dist/index.mjs', import.meta.url));
const child = spawn(process.execPath, [serverPath, ...rest], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mcp-call', version: '0.0.0' },
  },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });

const timeout = setTimeout(() => {
  console.error('mcp-call: timed out after 120s');
  child.kill();
  process.exit(1);
}, 120_000);

createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === 2) {
    clearTimeout(timeout);
    console.log(JSON.stringify(message.result ?? message.error, null, 2));
    child.kill();
    process.exit(message.error || message.result?.isError ? 1 : 0);
  }
});
