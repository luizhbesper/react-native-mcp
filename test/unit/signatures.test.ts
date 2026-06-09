// spec: 031 — the contribution contract, generated from the YAML itself
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSignatures, matchSignatures } from '../../src/build/signatures.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'build-logs');
const signatures = loadSignatures();

describe('signature database (spec 031)', () => {
  it('AC1: all YAML files load, validate and have unique ids', () => {
    expect(signatures.length).toBeGreaterThanOrEqual(20);
    const ids = signatures.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // AC2: one generated case per signature × fixture
  for (const signature of signatures) {
    describe(signature.id, () => {
      for (const fixture of signature.fixtures) {
        it(`matches fixture ${fixture}`, () => {
          const path = join(FIXTURES, fixture);
          expect(existsSync(path), `missing fixture file ${fixture}`).toBe(true);
          const log = readFileSync(path, 'utf8');
          const hits = matchSignatures(log, signatures);
          expect(hits.map((h) => h.signatureId)).toContain(signature.id);
        });
      }
    });
  }

  it('AC3: the clean corpus produces zero signature hits', () => {
    const cleanDir = join(FIXTURES, 'clean');
    for (const file of readdirSync(cleanDir)) {
      const log = readFileSync(join(cleanDir, file), 'utf8');
      expect(matchSignatures(log, signatures), `clean log ${file} matched a signature`).toEqual([]);
    }
  });

  it('AC4: a signature reports at most once per log', () => {
    const line = 'error: The sandbox is not in sync with the Podfile.lock.';
    const log = [line, line, line].join('\n');
    const hits = matchSignatures(log, signatures);
    expect(hits.filter((h) => h.signatureId === 'cocoapods-sandbox-not-in-sync')).toHaveLength(1);
  });

  it('diagnostics carry cause and fix', () => {
    for (const signature of signatures) {
      expect(signature.probableCause.length).toBeGreaterThan(10);
      expect(signature.suggestedFix.length).toBeGreaterThan(10);
    }
  });
});
