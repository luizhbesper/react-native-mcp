// spec: 001 — environment detection; every probe is timeboxed and failure-tolerant
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExecFn } from '../shared/exec.js';
import type {
  AndroidCapability,
  Capabilities,
  IosCapability,
  Problem,
  ProjectInfo,
} from './capabilities.js';

export interface DetectDeps {
  exec: ExecFn;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

const PROBE_TIMEOUT_MS = 3_000;

async function probe(
  deps: DetectDeps,
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await deps.exec(cmd, args, { timeoutMs: PROBE_TIMEOUT_MS });
    return {
      ok: result.exitCode === 0 && !result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch {
    return { ok: false, stdout: '', stderr: '' };
  }
}

async function detectIos(deps: DetectDeps, problems: Problem[]): Promise<IosCapability> {
  // AC-2: never probe xcrun off-macOS
  if (deps.platform !== 'darwin') {
    return { available: false, simctl: false };
  }
  const [simctl, xcodebuild, pod] = await Promise.all([
    probe(deps, 'xcrun', ['simctl', 'help']),
    probe(deps, 'xcodebuild', ['-version']),
    probe(deps, 'pod', ['--version']),
  ]);
  const xcodeVersion = xcodebuild.ok ? /Xcode\s+([\d.]+)/.exec(xcodebuild.stdout)?.[1] : undefined;
  if (!simctl.ok) {
    problems.push({
      code: 'XCODE_TOOLS_NOT_FOUND',
      fix: 'Install Xcode (with iOS simulators) from the App Store, then run `xcode-select --install`.',
    });
  } else if (!xcodebuild.ok) {
    problems.push({
      code: 'XCODEBUILD_NOT_FOUND',
      fix: 'Full Xcode is required for iOS builds. Install it and run `sudo xcode-select -s /Applications/Xcode.app`.',
    });
  }
  if (simctl.ok && !pod.ok) {
    problems.push({
      code: 'COCOAPODS_NOT_FOUND',
      fix: 'Install CocoaPods (`brew install cocoapods` or `gem install cocoapods`) for iOS dependency installs.',
    });
  }
  return {
    available: simctl.ok,
    simctl: simctl.ok,
    xcodeVersion,
    cocoapods: pod.ok ? pod.stdout.trim() : undefined,
  };
}

function sdkRoot(env: NodeJS.ProcessEnv): string | undefined {
  return env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? undefined;
}

async function detectAndroid(deps: DetectDeps, problems: Problem[]): Promise<AndroidCapability> {
  const exeSuffix = deps.platform === 'win32' ? '.exe' : '';
  const root = sdkRoot(deps.env);

  const candidates = ['adb'];
  if (root) candidates.unshift(join(root, 'platform-tools', `adb${exeSuffix}`));

  let adbPath: string | undefined;
  let adbVersion: string | undefined;
  for (const candidate of candidates) {
    const result = await probe(deps, candidate, ['version']);
    if (result.ok) {
      adbPath = candidate;
      adbVersion = /Android Debug Bridge version ([\d.]+)/.exec(result.stdout)?.[1];
      break;
    }
  }

  if (!adbPath) {
    problems.push({
      code: 'ANDROID_SDK_NOT_FOUND',
      fix: 'Install Android Studio (or command-line tools) and set ANDROID_HOME, or add adb to PATH.',
    });
    return { available: false };
  }

  let emulatorPath: string | undefined;
  const emulatorCandidates = root
    ? [join(root, 'emulator', `emulator${exeSuffix}`), 'emulator']
    : ['emulator'];
  for (const candidate of emulatorCandidates) {
    const result = await probe(deps, candidate, ['-version']);
    if (result.ok) {
      emulatorPath = candidate;
      break;
    }
  }

  const java = await probe(deps, 'java', ['-version']);
  // java -version writes to stderr
  const javaVersion = java.ok
    ? /version "([^"]+)"/.exec(java.stderr || java.stdout)?.[1]
    : undefined;
  if (!java.ok) {
    problems.push({
      code: 'JAVA_NOT_FOUND',
      fix: 'Install JDK 17+ (required by Gradle). Android Studio bundles one — or `brew install --cask zulu@17`.',
    });
  }

  return { available: true, adbVersion, adbPath, emulatorPath, javaVersion };
}

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function installedVersion(projectRoot: string, pkg: string): string | undefined {
  const manifest = readPackageJson(join(projectRoot, 'node_modules', pkg));
  return typeof manifest?.version === 'string' ? manifest.version : undefined;
}

export function detectProject(startDir: string): ProjectInfo {
  let dir = startDir;
  for (let depth = 0; depth < 10; depth++) {
    const pkg = readPackageJson(dir);
    if (pkg) {
      const deps = {
        ...(pkg.dependencies as Record<string, string> | undefined),
        ...(pkg.devDependencies as Record<string, string> | undefined),
      };
      if (deps['react-native']) {
        const isExpo = Boolean(deps.expo);
        const rnVersion = installedVersion(dir, 'react-native') ?? deps['react-native'];
        const expoVersion = installedVersion(dir, 'expo') ?? deps.expo;
        return {
          found: true,
          root: dir,
          kind: isExpo ? 'expo' : 'bare',
          rnVersion,
          expoSdk: expoVersion ? expoVersion.replace(/[^\d.].*$/, '').split('.')[0] : undefined,
        };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { found: false };
}

export async function detectCapabilities(
  deps: DetectDeps,
  projectRoot: string,
): Promise<Capabilities> {
  const problems: Problem[] = [];
  const [ios, android] = await Promise.all([
    detectIos(deps, problems),
    detectAndroid(deps, problems),
  ]);
  const project = detectProject(projectRoot);
  if (!project.found) {
    problems.push({
      code: 'PROJECT_NOT_FOUND',
      fix: 'No react-native dependency found here. Run from your app directory or pass --project-root.',
    });
  }
  return {
    host: { os: deps.platform, arch: process.arch, node: process.versions.node },
    ios,
    android,
    project,
    problems,
  };
}
