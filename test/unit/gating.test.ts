// spec: 002 — registration set per capability matrix
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Capabilities } from '../../src/env/capabilities.js';
import { buildToolCatalog } from '../../src/tools/catalog.js';
import { visibleToolNames } from '../../src/tools/registry.js';

function makeCaps(input: { os: NodeJS.Platform; ios?: boolean; android?: boolean }): Capabilities {
  return {
    host: { os: input.os, arch: 'arm64', node: '22.0.0' },
    ios: { available: input.ios ?? false, simctl: input.ios ?? false },
    android: { available: input.android ?? false, adbPath: input.android ? '/usr/bin/adb' : undefined },
    project: { found: true, kind: 'bare', rnVersion: '0.85.0' },
    problems: [],
  };
}

const names = (caps: Capabilities) => visibleToolNames(buildToolCatalog(caps), caps);

describe('capability gating (spec 002)', () => {
  it('AC2: darwin with both toolchains registers all 20 tools', () => {
    const tools = names(makeCaps({ os: 'darwin', ios: true, android: true }));
    expect(tools).toHaveLength(20);
    expect(tools).toContain('run_pod_install');
    expect(tools).toContain('take_screenshot');
  });

  it('AC1: win32 host never registers iOS-only tools and run_build only offers android', () => {
    const caps = makeCaps({ os: 'win32', android: true });
    const tools = names(caps);
    expect(tools).not.toContain('run_pod_install');
    expect(tools).toContain('run_build');
    expect(tools).toContain('list_devices');

    const runBuild = buildToolCatalog(caps).find((t) => t.name === 'run_build');
    const platformSchema = runBuild?.inputSchema.platform as z.ZodEnum<Record<string, string>>;
    expect(platformSchema.options).toEqual(['android']);
  });

  it('run_build offers ios+android on darwin', () => {
    const caps = makeCaps({ os: 'darwin', ios: true, android: true });
    const runBuild = buildToolCatalog(caps).find((t) => t.name === 'run_build');
    const platformSchema = runBuild?.inputSchema.platform as z.ZodEnum<Record<string, string>>;
    expect(platformSchema.options).toEqual(['ios', 'android']);
  });

  it('AC3: no device platform → device tools absent, doctor/runtime/build remain', () => {
    const tools = names(makeCaps({ os: 'linux' }));
    expect(tools).toEqual([
      'doctor',
      'list_runtime_targets',
      'read_console',
      'evaluate_js',
      'reload_app',
      'run_build',
      'get_build_status',
      'cancel_build',
      'parse_build_log',
    ]);
  });

  it('every tool has a description that fits the context budget', () => {
    for (const tool of buildToolCatalog(makeCaps({ os: 'darwin', ios: true, android: true }))) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(400);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]+$/);
    }
  });
});
