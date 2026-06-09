// spec: 000 — injectable exec seam; all toolchain calls go through here (argv arrays, no shell)
import { execFile, spawn } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type ExecFn = (
  cmd: string,
  args: readonly string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const nodeExec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args as string[],
      {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const killed = Boolean(error && 'killed' in error && error.killed);
        const code = error
          ? typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? ((error as unknown as { code: number }).code as number)
            : 1
          : 0;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: error ? code : 0,
          timedOut: killed,
        });
      },
    );
  });

/**
 * Spawn a long-running process detached into its own group so the whole tree
 * can be killed later. Used by the build runner and the Android emulator boot.
 */
export function spawnDetached(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const child = spawn(cmd, args as string[], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return child;
}

/** Kill a process and (on POSIX) its whole group. */
export function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      // taskkill walks the tree on Windows
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

/** Quote a string for safe interpolation inside `adb shell` (POSIX single-quoting). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
