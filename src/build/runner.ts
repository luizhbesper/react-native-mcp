// spec: 030 — command resolution + detached spawn streaming to a log file
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError } from '../shared/errors.js';
import { spawnDetached } from '../shared/exec.js';
import type { BuildJob, JobStore } from './jobs.js';

export interface BuildRequest {
  platform: 'ios' | 'android';
  projectRoot: string;
  scheme?: string;
  variant?: string;
  clean?: boolean;
}

export interface ResolvedCommand {
  cmd: string;
  args: string[];
  cwd: string;
  derivedDataPath?: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function resolveBuildCommand(request: BuildRequest): ResolvedCommand {
  const { platform, projectRoot } = request;
  const nativeDir = join(projectRoot, platform);
  if (!existsSync(nativeDir)) {
    throw new ToolError(
      'PREBUILD_REQUIRED',
      `No ${platform}/ directory in ${projectRoot} — this Expo project has no generated native code.`,
      `Run \`npx expo prebuild --platform ${platform}\` first, or use EAS Build.`,
    );
  }

  if (platform === 'android') {
    const gradlew = join(nativeDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    if (!existsSync(gradlew)) {
      throw new ToolError(
        'WORKSPACE_NOT_FOUND',
        `No gradlew wrapper in ${nativeDir}.`,
        'Check projectRoot points at a React Native app.',
      );
    }
    const task = `assemble${capitalize(request.variant ?? 'debug')}`;
    const args = [...(request.clean ? ['clean'] : []), task];
    return { cmd: gradlew, args, cwd: nativeDir };
  }

  const entries = readdirSync(nativeDir);
  const workspace = entries.find((e) => e.endsWith('.xcworkspace'));
  const project = entries.find((e) => e.endsWith('.xcodeproj'));
  if (!workspace && !project) {
    throw new ToolError(
      'WORKSPACE_NOT_FOUND',
      `No .xcworkspace or .xcodeproj in ${nativeDir}.`,
      'Run pod install (run_pod_install) to generate the workspace, or check projectRoot.',
    );
  }
  const container = workspace ?? (project as string);
  const scheme = request.scheme ?? container.replace(/\.(xcworkspace|xcodeproj)$/, '');
  const derivedDataPath = join(nativeDir, 'build', 'rn-mcp-derived');
  const args = [
    workspace ? '-workspace' : '-project',
    container,
    '-scheme',
    scheme,
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-derivedDataPath',
    derivedDataPath,
    ...(request.clean ? ['clean'] : []),
    'build',
  ];
  return { cmd: 'xcodebuild', args, cwd: nativeDir, derivedDataPath };
}

export function startBuild(store: JobStore, request: BuildRequest): BuildJob {
  const running = store.findRunning(request.platform, request.projectRoot);
  if (running) {
    throw new ToolError(
      'BUILD_ALREADY_RUNNING',
      `A ${request.platform} build is already running for this project (job ${running.id}).`,
      'Poll it with get_build_status, or cancel_build first.',
      { jobId: running.id },
    );
  }

  const resolved = resolveBuildCommand(request);
  const logDir = join(tmpdir(), 'react-native-dev-mcp', 'builds');
  mkdirSync(logDir, { recursive: true });

  const job = store.create({
    platform: request.platform,
    projectRoot: request.projectRoot,
    command: `${resolved.cmd} ${resolved.args.join(' ')}`,
    logPath: '',
  });
  job.logPath = join(logDir, `${job.id}.log`);

  const logStream = createWriteStream(job.logPath);
  // Windows refuses to spawn .bat/.cmd without a shell (CVE-2024-27980) — route through cmd.exe
  const isBatch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(resolved.cmd);
  const child = isBatch
    ? spawnDetached('cmd.exe', ['/d', '/s', '/c', resolved.cmd, ...resolved.args], {
        cwd: resolved.cwd,
      })
    : spawnDetached(resolved.cmd, resolved.args, { cwd: resolved.cwd });
  job.child = child;
  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });
  // the job only turns terminal after the log stream flushed — pollers read the file right away
  child.on('error', (err) => {
    logStream.write(`\n[react-native-dev-mcp] spawn error: ${err.message}\n`);
    logStream.end(() => store.finish(job.id, 'failed', -1));
  });
  child.on('exit', (code) => {
    logStream.end(() => store.finish(job.id, code === 0 ? 'succeeded' : 'failed', code ?? -1));
  });
  return job;
}

/** Find the newest build artifact (.apk / .app) under the platform's output directory. */
export function findArtifact(job: BuildJob): string | undefined {
  const roots =
    job.platform === 'android'
      ? [join(job.projectRoot, 'android', 'app', 'build', 'outputs', 'apk')]
      : [join(job.projectRoot, 'ios', 'build', 'rn-mcp-derived', 'Build', 'Products')];
  const wanted = job.platform === 'android' ? '.apk' : '.app';
  let best: { path: string; mtime: number } | undefined;
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (entry.endsWith(wanted)) {
        if (!best || stat.mtimeMs > best.mtime) best = { path: full, mtime: stat.mtimeMs };
        continue; // .app is a directory — don't descend into it
      }
      if (stat.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return best?.path;
}
