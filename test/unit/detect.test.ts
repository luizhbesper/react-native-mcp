// spec: 001 — ACs map 1:1 to cases below
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCapabilities, detectProject } from '../../src/env/detect.js';
import { fakeExec, okResult } from '../helpers/fake-exec.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'projects');

const darwinRules = [
  { match: /^xcrun simctl help/, result: okResult('usage: simctl') },
  { match: /^xcodebuild -version/, result: okResult('Xcode 16.4\nBuild version 16F313') },
  { match: /^pod --version/, result: okResult('1.16.2\n') },
  {
    match: /^adb version/,
    result: okResult('Android Debug Bridge version 1.0.41\nVersion 35.0.2'),
  },
  { match: /emulator -version/, result: okResult('Android emulator version 35.1.4') },
  {
    match: /^java -version/,
    result: {
      stdout: '',
      stderr: 'openjdk version "17.0.10" 2024-01-16',
      exitCode: 0,
      timedOut: false,
    },
  },
];

describe('environment detection (spec 001)', () => {
  it('AC1: darwin host with simctl reports ios available', async () => {
    const exec = fakeExec(darwinRules);
    const caps = await detectCapabilities(
      { exec, platform: 'darwin', env: {} },
      join(FIXTURES, 'bare-app'),
    );
    expect(caps.ios.available).toBe(true);
    expect(caps.ios.xcodeVersion).toBe('16.4');
    expect(caps.ios.cocoapods).toBe('1.16.2');
    expect(caps.android.available).toBe(true);
    expect(caps.android.javaVersion).toBe('17.0.10');
  });

  it('AC2: non-darwin host never probes xcrun', async () => {
    const exec = fakeExec(darwinRules);
    const caps = await detectCapabilities(
      { exec, platform: 'win32', env: {} },
      join(FIXTURES, 'bare-app'),
    );
    expect(caps.ios.available).toBe(false);
    expect(exec.calls.some((c) => c.cmd === 'xcrun' || c.cmd === 'xcodebuild')).toBe(false);
  });

  it('AC3: missing adb yields ANDROID_SDK_NOT_FOUND problem', async () => {
    const exec = fakeExec([{ match: /^java -version/, result: okResult() }]);
    const caps = await detectCapabilities(
      { exec, platform: 'linux', env: {} },
      join(FIXTURES, 'bare-app'),
    );
    expect(caps.android.available).toBe(false);
    expect(caps.problems.map((p) => p.code)).toContain('ANDROID_SDK_NOT_FOUND');
  });

  it('resolves adb from ANDROID_HOME when not on PATH', async () => {
    const sdk = '/opt/android-sdk';
    // path separators vary by host OS (join() is used in detect.ts) — match both
    const exec = fakeExec([
      {
        match: /android-sdk[\\/]platform-tools[\\/]adb version/,
        result: okResult('Android Debug Bridge version 1.0.41'),
      },
      { match: /android-sdk[\\/]emulator[\\/]emulator -version/, result: okResult('ok') },
      { match: /^java -version/, result: okResult() },
    ]);
    const caps = await detectCapabilities(
      { exec, platform: 'linux', env: { ANDROID_HOME: sdk } },
      join(FIXTURES, 'bare-app'),
    );
    expect(caps.android.available).toBe(true);
    expect(caps.android.adbPath).toBe(join(sdk, 'platform-tools', 'adb'));
    expect(caps.android.emulatorPath).toBe(join(sdk, 'emulator', 'emulator'));
  });

  it('AC4: detects an Expo project with versions', () => {
    const project = detectProject(join(FIXTURES, 'expo-app'));
    expect(project).toMatchObject({
      found: true,
      kind: 'expo',
      rnVersion: '0.85.1',
      expoSdk: '56',
    });
  });

  it('detects a bare project', () => {
    const project = detectProject(join(FIXTURES, 'bare-app'));
    expect(project).toMatchObject({ found: true, kind: 'bare', rnVersion: '0.80.2' });
  });

  it('reports PROJECT_NOT_FOUND for a non-RN directory', async () => {
    const exec = fakeExec(darwinRules);
    const caps = await detectCapabilities(
      { exec, platform: 'darwin', env: {} },
      join(FIXTURES, 'not-rn'),
    );
    expect(caps.project.found).toBe(false);
    expect(caps.problems.map((p) => p.code)).toContain('PROJECT_NOT_FOUND');
  });

  it('AC5: hanging probes are tolerated (timedOut result is a failed probe)', async () => {
    const exec = fakeExec([
      {
        match: /^xcrun simctl help/,
        result: { stdout: '', stderr: '', exitCode: 1, timedOut: true },
      },
    ]);
    const caps = await detectCapabilities(
      { exec, platform: 'darwin', env: {} },
      join(FIXTURES, 'bare-app'),
    );
    expect(caps.ios.available).toBe(false);
  });
});
