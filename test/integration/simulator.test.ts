// specs 011/012/013 integration ACs — real simctl, gated behind RUN_SIMULATOR_TESTS=1
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceManager } from '../../src/devices/facade.js';
import { detectCapabilities } from '../../src/env/detect.js';
import { nodeExec } from '../../src/shared/exec.js';

const enabled = process.env.RUN_SIMULATOR_TESTS === '1' && process.platform === 'darwin';

describe.runIf(enabled)('real iOS simulator (CI integration)', () => {
  it('list → boot → open_url → screenshot → shutdown', { timeout: 600_000 }, async () => {
    // first contact with CoreSimulator on a cold CI runner can take >30s — warm it up
    // before detection so the regular probe timeout reflects steady-state behavior
    await nodeExec('xcrun', ['simctl', 'list', 'devices'], { timeoutMs: 120_000 });

    const caps = await detectCapabilities(
      { exec: nodeExec, platform: process.platform, env: process.env },
      process.cwd(),
    );
    expect(caps.ios.available).toBe(true);
    const devices = new DeviceManager(nodeExec, caps, true);

    const list = await devices.list({ platform: 'ios', filter: 'all' });
    expect(list.totalCount).toBeGreaterThan(0);

    const target =
      list.devices.find((d) => d.state === 'booted') ??
      list.devices.find((d) => d.name.includes('iPhone') && d.state === 'shutdown');
    expect(target, 'no usable iPhone simulator on this runner').toBeDefined();
    const udid = (target as { id: string }).id;

    await devices.ios().boot(udid, 480);

    await devices.ios().openUrl(udid, 'https://example.com');

    const path = join(tmpdir(), `rn-mcp-integration-${Date.now()}.png`);
    await devices.ios().screenshot(udid, path);
    const png = readFileSync(path);
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic

    if (target?.state !== 'booted') {
      await devices.ios().shutdown(udid);
    }
  });
});
