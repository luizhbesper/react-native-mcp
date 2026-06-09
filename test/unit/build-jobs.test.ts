// spec: 030 — job lifecycle with scripted fake builders (no real toolchains)
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/build/jobs.js';
import { parseBuildLog } from '../../src/build/parser.js';
import { resolveBuildCommand, startBuild } from '../../src/build/runner.js';

const isWindows = process.platform === 'win32';
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Create a fake RN project whose android/gradlew is a script we control. */
function fakeProject(gradlewBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'rn-mcp-test-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'android'), { recursive: true });
  if (isWindows) {
    writeFileSync(join(root, 'android', 'gradlew.bat'), `@echo off\r\n${gradlewBody}\r\n`);
  } else {
    const path = join(root, 'android', 'gradlew');
    writeFileSync(path, `#!/bin/sh\n${gradlewBody}\n`);
    chmodSync(path, 0o755);
  }
  return root;
}

const nodeLine = (code: string) => `node -e "${code}"`;

describe('command resolution (spec 030)', () => {
  it('PREBUILD_REQUIRED for Expo projects without native dirs', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-mcp-test-'));
    tempDirs.push(root);
    expect(() => resolveBuildCommand({ platform: 'android', projectRoot: root })).toThrowError(
      expect.objectContaining({ code: 'PREBUILD_REQUIRED' }),
    );
  });

  it('WORKSPACE_NOT_FOUND when android/ exists without gradlew', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-mcp-test-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'android'));
    expect(() => resolveBuildCommand({ platform: 'android', projectRoot: root })).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_NOT_FOUND' }),
    );
  });

  it('builds the gradle task from the variant', () => {
    const root = fakeProject('exit 0');
    const resolved = resolveBuildCommand({
      platform: 'android',
      projectRoot: root,
      variant: 'release',
      clean: true,
    });
    expect(resolved.args).toEqual(['clean', 'assembleRelease']);
  });

  it('detects the iOS workspace and derives the scheme', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-mcp-test-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'ios', 'MyApp.xcworkspace'), { recursive: true });
    const resolved = resolveBuildCommand({ platform: 'ios', projectRoot: root });
    expect(resolved.cmd).toBe('xcodebuild');
    expect(resolved.args).toEqual(
      expect.arrayContaining([
        '-workspace',
        'MyApp.xcworkspace',
        '-scheme',
        'MyApp',
        '-sdk',
        'iphonesimulator',
      ]),
    );
  });
});

describe('job lifecycle (spec 030)', () => {
  it('AC1/AC2: run returns immediately; long-poll observes the terminal state', async () => {
    const store = new JobStore();
    const root = fakeProject(`echo compiling\n${nodeLine('setTimeout(()=>{},300)')}\necho done`);
    const before = Date.now();
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    expect(Date.now() - before).toBeLessThan(2_000);
    expect(job.status).toBe('running');

    const polled = await store.waitForTerminal(job.id, 10_000);
    expect(polled?.status).toBe('succeeded');
    const log = readFileSync(job.logPath, 'utf8');
    expect(log).toContain('compiling');
    expect(log).toContain('done');
  });

  it('AC3: a failing build with a known signature yields diagnostics', async () => {
    const store = new JobStore();
    const root = fakeProject(
      'echo "FAILURE: Build failed with an exception."\necho "SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable."\nexit 1',
    );
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    const finished = await store.waitForTerminal(job.id, 10_000);
    expect(finished?.status).toBe('failed');
    const parsed = parseBuildLog(readFileSync(job.logPath, 'utf8'));
    expect(parsed.diagnostics.map((d) => d.signatureId)).toContain('android-sdk-location-missing');
    expect(parsed.unmatchedTail).toBeUndefined();
  });

  it('AC4: a failing build with no signature exposes the tail', async () => {
    const store = new JobStore();
    const root = fakeProject('echo "error: novel exotic failure"\nexit 1');
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    await store.waitForTerminal(job.id, 10_000);
    const parsed = parseBuildLog(readFileSync(job.logPath, 'utf8'));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.unmatchedTail).toContain('novel exotic failure');
  });

  it('AC5: cancel kills the build process tree', async () => {
    const store = new JobStore();
    const root = fakeProject(nodeLine('setTimeout(()=>{},30000)'));
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pid = job.child?.pid;
    expect(pid).toBeDefined();

    store.cancel(job.id);
    expect(store.get(job.id)?.status).toBe('cancelled');
    // give the signal a moment, then the group leader must be gone
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(pid as number, 0)).toThrow();
  });

  it('rejects concurrent builds for the same platform+root', async () => {
    const store = new JobStore();
    const root = fakeProject(nodeLine('setTimeout(()=>{},5000)'));
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    expect(() => startBuild(store, { platform: 'android', projectRoot: root })).toThrowError(
      expect.objectContaining({ code: 'BUILD_ALREADY_RUNNING' }),
    );
    store.cancel(job.id);
  });

  it('waitForTerminal with 0 budget returns the running job immediately', async () => {
    const store = new JobStore();
    const root = fakeProject(nodeLine('setTimeout(()=>{},2000)'));
    const job = startBuild(store, { platform: 'android', projectRoot: root });
    const polled = await store.waitForTerminal(job.id, 0);
    expect(polled?.status).toBe('running');
    store.cancel(job.id);
  });
});
