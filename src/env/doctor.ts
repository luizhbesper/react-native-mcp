// spec: 001 — the agent's self-diagnosis entrypoint; re-probes fresh on every call
import { z } from 'zod';
import { fetchRawPages, selectViableTargets } from '../metro/discovery.js';
import { defineTool } from '../tools/registry.js';
import { hasAnyDevicePlatform } from './capabilities.js';
import { detectCapabilities } from './detect.js';

const mark = (good: boolean, warn = false) => (good ? '✅' : warn ? '⚠️' : '❌');

export const doctorTool = defineTool({
  name: 'doctor',
  title: 'Environment doctor',
  description:
    'Check the health of the React Native development environment: detected OS, iOS/Android toolchains, Metro status and project info. Call this first when something is failing or before device/build operations.',
  spec: '001',
  annotations: { readOnlyHint: true },
  inputSchema: {
    projectRoot: z
      .string()
      .optional()
      .describe('Project root to inspect (default: server --project-root)'),
  },
  outputSchema: {
    host: z.object({ os: z.string(), arch: z.string(), node: z.string() }),
    ios: z.object({
      available: z.boolean(),
      simctl: z.boolean(),
      xcodeVersion: z.string().optional(),
      cocoapods: z.string().optional(),
    }),
    android: z.object({
      available: z.boolean(),
      adbVersion: z.string().optional(),
      emulator: z.boolean(),
      javaVersion: z.string().optional(),
    }),
    metro: z.object({ running: z.boolean(), port: z.number(), targets: z.number() }),
    project: z.object({
      found: z.boolean(),
      root: z.string().optional(),
      kind: z.enum(['expo', 'bare']).optional(),
      rnVersion: z.string().optional(),
      expoSdk: z.string().optional(),
    }),
    problems: z.array(z.object({ code: z.string(), fix: z.string() })),
    restartRequired: z.boolean(),
  },
  handler: async (args, ctx) => {
    const fresh = await detectCapabilities(
      ctx.detectDeps,
      args.projectRoot ?? ctx.config.projectRoot,
    );
    const pages = await fetchRawPages(ctx.config.metroPort);
    const targets = pages ? selectViableTargets(pages) : [];

    // toolchains that appeared after startup require a server restart to register their tools
    const restartRequired =
      (!ctx.capabilities.ios.available && fresh.ios.available) ||
      (!ctx.capabilities.android.available && fresh.android.available);

    const structured = {
      host: fresh.host,
      ios: {
        available: fresh.ios.available,
        simctl: fresh.ios.simctl,
        xcodeVersion: fresh.ios.xcodeVersion,
        cocoapods: fresh.ios.cocoapods,
      },
      android: {
        available: fresh.android.available,
        adbVersion: fresh.android.adbVersion,
        emulator: Boolean(fresh.android.emulatorPath),
        javaVersion: fresh.android.javaVersion,
      },
      metro: { running: pages !== null, port: ctx.config.metroPort, targets: targets.length },
      project: fresh.project,
      problems: fresh.problems,
      restartRequired,
    };

    const lines = [
      `${mark(true)} Host: ${fresh.host.os}/${fresh.host.arch}, Node ${fresh.host.node}`,
      fresh.host.os === 'darwin'
        ? `${mark(fresh.ios.available)} iOS: ${fresh.ios.available ? `Xcode ${fresh.ios.xcodeVersion ?? '?'}, CocoaPods ${fresh.ios.cocoapods ?? 'missing'}` : 'toolchain not found'}`
        : `➖ iOS: not available on ${fresh.host.os}`,
      `${mark(fresh.android.available)} Android: ${fresh.android.available ? `adb ${fresh.android.adbVersion ?? '?'}, emulator ${fresh.android.emulatorPath ? 'yes' : 'no'}, Java ${fresh.android.javaVersion ?? 'missing'}` : 'SDK not found'}`,
      `${mark(pages !== null, true)} Metro: ${pages !== null ? `running on :${ctx.config.metroPort} (${targets.length} debuggable target${targets.length === 1 ? '' : 's'})` : `not running on :${ctx.config.metroPort}`}`,
      `${mark(fresh.project.found, true)} Project: ${fresh.project.found ? `${fresh.project.kind} · RN ${fresh.project.rnVersion}${fresh.project.expoSdk ? ` · Expo SDK ${fresh.project.expoSdk}` : ''}` : 'no React Native project found'}`,
    ];
    if (fresh.problems.length > 0) {
      lines.push('', 'Problems:');
      for (const p of fresh.problems) lines.push(`  • ${p.code}: ${p.fix}`);
    }
    if (restartRequired) {
      lines.push(
        '',
        '⚠️ New toolchains detected since startup — restart the MCP server to register their tools.',
      );
    }
    if (!hasAnyDevicePlatform(fresh)) {
      lines.push('', 'No device platform available: device tools are not registered on this host.');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured,
    };
  },
});
