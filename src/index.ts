#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JobStore } from './build/jobs.js';
import { HELP_TEXT, parseCli } from './config.js';
import { DeviceManager } from './devices/facade.js';
import { detectCapabilities } from './env/detect.js';
import { MetroBridge } from './metro/bridge.js';
import { createServer, SERVER_VERSION } from './server.js';
import { nodeExec } from './shared/exec.js';
import { log, logError, setVerbose } from './shared/logger.js';
import type { ToolContext } from './tools/context.js';

async function main(): Promise<void> {
  const { config, showHelp, showVersion } = parseCli(process.argv.slice(2));
  if (showHelp) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (showVersion) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  setVerbose(config.verbose);
  const detectDeps = { exec: nodeExec, platform: process.platform, env: process.env };
  const capabilities = await detectCapabilities(detectDeps, config.projectRoot);
  log(
    'capabilities:',
    JSON.stringify({
      ios: capabilities.ios.available,
      android: capabilities.android.available,
      project: capabilities.project.kind,
    }),
  );

  const ctx: ToolContext = {
    config,
    exec: nodeExec,
    capabilities,
    detectDeps,
    devices: new DeviceManager(nodeExec, capabilities, config.headless),
    metro: new MetroBridge(config.metroPort),
    jobs: new JobStore(),
  };

  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  log(`react-native-dev-mcp ${SERVER_VERSION} connected over stdio`);

  if (config.eagerMetro) {
    ctx.metro.ensureSession().catch((err) => log('eager metro connect skipped:', err.message));
  }
}

main().catch((err) => {
  logError('fatal:', err);
  process.exit(1);
});
