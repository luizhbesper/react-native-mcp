// spec: 032 — generic extraction, platform guessing, tails
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guessPlatform, parseBuildLog } from '../../src/build/parser.js';

const fixture = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'build-logs', ...parts), 'utf8');

describe('build log parser (spec 032)', () => {
  it('spec 031 AC5: generic clang extractor catches unsignatured errors with file/line', () => {
    const log = [
      'CompileC Foo.o /Users/dev/app/ios/Foo.m normal arm64',
      "/Users/dev/app/ios/Foo.m:23:5: error: use of undeclared identifier 'bar'",
      '1 error generated.',
    ].join('\n');
    const result = parseBuildLog(log, []);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        errorType: 'unknown',
        file: '/Users/dev/app/ios/Foo.m',
        line: 23,
        message: "use of undeclared identifier 'bar'",
      }),
    ]);
  });

  it('AC1: known failures produce signature diagnostics ordered by position', () => {
    const log = `${fixture('cocoapods', 'sandbox-not-in-sync.log')}\n${fixture('ios', 'duplicate-symbols.log')}`;
    const result = parseBuildLog(log);
    const ids = result.diagnostics.map((d) => d.signatureId).filter(Boolean);
    expect(ids).toEqual(['cocoapods-sandbox-not-in-sync', 'ios-duplicate-symbols']);
  });

  it('AC3: clean logs produce zero errors and no tail', () => {
    const result = parseBuildLog(fixture('clean', 'android-success.log'));
    expect(result).toMatchObject({ diagnostics: [], errorCount: 0 });
    expect(result.unmatchedTail).toBeUndefined();
  });

  it('AC4: platform heuristics', () => {
    expect(guessPlatform(fixture('android', 'sdk-location-missing.log'))).toBe('android');
    expect(guessPlatform(fixture('ios', 'duplicate-symbols.log'))).toBe('ios');
    expect(guessPlatform(fixture('cocoapods', 'incompatible-versions.log'))).toBe('cocoapods');
    expect(guessPlatform(fixture('metro', 'unable-to-resolve.log'))).toBe('metro');
    expect(guessPlatform('hello world')).toBe('unknown');
  });

  it('unmatched failures expose a bounded tail', () => {
    const noise = Array.from({ length: 100 }, (_, i) => `compiling step ${i}`).join('\n');
    const log = `${noise}\nerror: something completely novel happened`;
    const result = parseBuildLog(log, []);
    expect(result.errorCount).toBe(1);
    expect(result.diagnostics).toEqual([]);
    expect(result.unmatchedTail?.split('\n').length).toBeLessThanOrEqual(40);
    expect(result.unmatchedTail).toContain('something completely novel');
  });

  it('counts errors and warnings', () => {
    const log = 'warning: minor thing\nerror: real thing\nnote: hi\nwarning: other thing';
    const result = parseBuildLog(log, []);
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(2);
  });
});
