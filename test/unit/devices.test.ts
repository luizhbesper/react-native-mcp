// specs: 010/011/012 — parsers, collapsing, routing, shell safety
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdbBackend, parseAdbDevicesL } from '../../src/devices/backends/adb.js';
import { parseSimctlList, SimctlBackend } from '../../src/devices/backends/simctl.js';
import { collapseDevices } from '../../src/devices/facade.js';
import { routeDeviceId } from '../../src/devices/types.js';
import { shellQuote } from '../../src/shared/exec.js';
import { failResult, fakeExec, okResult } from '../helpers/fake-exec.js';

const fixture = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', ...parts), 'utf8');

describe('simctl parsing (spec 010)', () => {
  it('AC1: maps a real simctl list to the unified schema', () => {
    const devices = parseSimctlList(fixture('simctl', 'list-devices.json'));
    expect(devices.length).toBeGreaterThan(0);
    for (const device of devices) {
      expect(device.platform).toBe('ios');
      expect(device.kind).toBe('simulator');
      expect(device.id).toMatch(/^[0-9A-F-]{36}$/i);
      expect(['booted', 'shutdown', 'unknown']).toContain(device.state);
      expect(device.osVersion).toMatch(/^\d+(\.\d+)*$/);
    }
  });

  it('AC5: tolerates unknown runtimes and excludes unavailable devices', () => {
    const devices = parseSimctlList(fixture('simctl', 'multi-runtime.json'));
    // 8 entries minus 1 unavailable
    expect(devices).toHaveLength(7);
    expect(devices.find((d) => d.name === 'iPhone SE (3rd generation)')).toBeUndefined();
    const booted = devices.filter((d) => d.state === 'booted');
    expect(booted).toEqual([
      expect.objectContaining({ name: 'iPhone 16 Pro', osVersion: '18.4', state: 'booted' }),
    ]);
    // watchOS runtime parsed too (tolerant)
    expect(devices.find((d) => d.osVersion === '11.0')).toBeDefined();
  });
});

describe('device collapsing (spec 011)', () => {
  it('keeps booted devices plus newest OS per family', () => {
    const devices = parseSimctlList(fixture('simctl', 'multi-runtime.json'));
    const collapsed = collapseDevices(devices);
    const iphone16 = collapsed.filter((d) => d.name === 'iPhone 16');
    expect(iphone16).toHaveLength(1);
    expect(iphone16[0]?.osVersion).toBe('18.4'); // 17.5 and 18.0 collapsed away
    expect(collapsed.filter((d) => d.state === 'booted')).toHaveLength(1);
  });
});

describe('adb parsing (spec 010)', () => {
  it('AC2: parses devices -l with emulator/physical kinds', () => {
    const raw = parseAdbDevicesL(fixture('adb', 'devices-l.txt'));
    expect(raw).toEqual([
      { serial: 'emulator-5554', status: 'device', model: 'sdk gphone64 arm64' },
      { serial: 'R5CT20ABCDE', status: 'device', model: 'SM S918B' },
      { serial: 'emulator-5556', status: 'offline', model: undefined },
      { serial: '0A081JEC212345', status: 'unauthorized', model: undefined },
    ]);
  });

  it('AC3: lists cold AVDs without duplicating running ones', async () => {
    const exec = fakeExec([
      { match: /adb devices -l/, result: okResult(fixture('adb', 'devices-l.txt')) },
      {
        match: /-s emulator-5554 shell getprop ro\.build\.version\.release/,
        result: okResult('15\n'),
      },
      {
        match: /-s emulator-5554 shell getprop ro\.boot\.qemu\.avd_name/,
        result: okResult('Pixel_8\n'),
      },
      {
        match: /-s R5CT20ABCDE shell getprop ro\.build\.version\.release/,
        result: okResult('14\n'),
      },
      { match: /emulator -list-avds/, result: okResult('Pixel_8\nPixel_Tablet\n') },
    ]);
    const backend = new AdbBackend(exec, 'adb', 'emulator', true);
    const devices = await backend.list();
    expect(devices).toEqual([
      expect.objectContaining({
        id: 'emulator-5554',
        name: 'Pixel 8',
        kind: 'emulator',
        state: 'booted',
        osVersion: '15',
      }),
      expect.objectContaining({
        id: 'R5CT20ABCDE',
        name: 'SM S918B',
        kind: 'physical',
        state: 'booted',
      }),
      expect.objectContaining({ id: 'avd:Pixel_Tablet', kind: 'emulator', state: 'shutdown' }),
    ]);
  });
});

describe('device id routing (spec 010 AC4)', () => {
  it('routes UDIDs to ios and everything else to android', () => {
    expect(routeDeviceId('110F2EAF-1793-4FF5-94BD-8E35094AE96D')).toBe('ios');
    expect(routeDeviceId('emulator-5554')).toBe('android');
    expect(routeDeviceId('avd:Pixel_8')).toBe('android');
    expect(routeDeviceId('R5CT20ABCDE')).toBe('android');
  });
});

describe('shell safety (spec 012 AC3)', () => {
  it('open_url single-quotes hostile URLs for adb shell', async () => {
    const exec = fakeExec([{ match: /shell am start/, result: okResult('Starting: Intent') }]);
    const backend = new AdbBackend(exec, 'adb', undefined, true);
    const hostile = "myapp://x'; rm -rf /tmp/pwned'";
    await backend.openUrl('emulator-5554', hostile);
    const call = exec.calls.at(-1);
    expect(call?.args).toContain(shellQuote(hostile));
    // the raw unquoted payload must never appear as its own argv element
    expect(call?.args).not.toContain(hostile);
  });

  it('shellQuote escapes embedded single quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe('simctl behaviors (specs 011/012)', () => {
  it('boot tolerates already-booted (idempotent)', async () => {
    const exec = fakeExec([
      { match: /simctl bootstatus/, result: okResult('Device already booted') },
      {
        match: /simctl boot /,
        result: failResult('Unable to boot device in current state: Booted', 149),
      },
      { match: /^open -a Simulator/, result: okResult() },
    ]);
    const backend = new SimctlBackend(exec, true);
    await expect(backend.boot('AAAAAAAA-0000-4000-8000-000000000001', 30)).resolves.toBeUndefined();
  });

  it('terminate of a non-running app returns false (spec 012 AC4)', async () => {
    const exec = fakeExec([
      { match: /simctl terminate/, result: failResult('found nothing to terminate') },
    ]);
    const backend = new SimctlBackend(exec, true);
    await expect(backend.terminate('UDID', 'com.example')).resolves.toBe(false);
  });

  it('BOOT_TIMEOUT when bootstatus exceeds the budget (spec 011 AC4)', async () => {
    const exec = fakeExec([
      {
        match: /simctl bootstatus/,
        result: { stdout: '', stderr: '', exitCode: 1, timedOut: true },
      },
      { match: /simctl boot /, result: okResult() },
    ]);
    const backend = new SimctlBackend(exec, true);
    await expect(backend.boot('UDID', 1)).rejects.toMatchObject({ code: 'BOOT_TIMEOUT' });
  });
});
