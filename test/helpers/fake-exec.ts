import type { ExecFn, ExecResult } from '../../src/shared/exec.js';

export interface FakeExecCall {
  cmd: string;
  args: readonly string[];
}

const okResult = (stdout = ''): ExecResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false });
const failResult = (stderr = '', exitCode = 1): ExecResult => ({ stdout: '', stderr, exitCode, timedOut: false });

export { failResult, okResult };

/**
 * Scripted exec double. Rules are matched first-to-last against "cmd arg0 arg1 …";
 * unmatched commands fail with exit 127 (like a missing binary).
 */
export function fakeExec(
  rules: Array<{ match: RegExp; result: ExecResult | (() => ExecResult) }>,
  calls: FakeExecCall[] = [],
): ExecFn & { calls: FakeExecCall[] } {
  const fn: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    const line = [cmd, ...args].join(' ');
    for (const rule of rules) {
      if (rule.match.test(line)) {
        return typeof rule.result === 'function' ? rule.result() : rule.result;
      }
    }
    return failResult(`command not found: ${cmd}`, 127);
  };
  return Object.assign(fn, { calls });
}
