// spec: 000 — stdout belongs to the MCP transport; logging is stderr-only, opt-in
let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function log(...args: unknown[]): void {
  if (verbose) console.error('[react-native-dev-mcp]', ...args);
}

export function logError(...args: unknown[]): void {
  console.error('[react-native-dev-mcp]', ...args);
}
