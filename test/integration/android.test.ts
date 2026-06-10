// specs 011/012/013 integration ACs — real adb/emulator, gated behind RUN_ANDROID_TESTS=1
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceManager } from '../../src/devices/facade.js';
import { detectCapabilities } from '../../src/env/detect.js';
import { nodeExec } from '../../src/shared/exec.js';

const enabled = process.env.RUN_ANDROID_TESTS === '1';

describe.runIf(enabled)('real Android emulator (CI integration)', () => {
  it('list → open_url → screenshot on the running emulator', { timeout: 300_000 }, async () => {
    const caps = await detectCapabilities(
      { exec: nodeExec, platform: process.platform, env: process.env },
      process.cwd(),
    );
    expect(caps.android.available).toBe(true);
    const devices = new DeviceManager(nodeExec, caps, true);

    const list = await devices.list({ platform: 'android', state: 'booted' });
    expect(list.devices.length, 'emulator-runner should provide a booted device').toBeGreaterThan(
      0,
    );
    const serial = list.devices[0]?.id as string;

    await devices.android().openUrl(serial, 'https://example.com');

    const path = join(tmpdir(), `rn-mcp-integration-${Date.now()}.png`);
    await devices.android().screenshot(serial, path);
    const png = readFileSync(path);
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
