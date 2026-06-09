// spec: 031 — YAML signature database loader/matcher (the community-contribution surface)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

export const signatureSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]+$/, 'kebab-case ids only'),
  title: z.string(),
  platform: z.enum(['ios', 'android', 'cocoapods', 'metro']),
  match: z.array(z.string().max(400)).min(1),
  errorType: z.enum(['dependency', 'compile', 'link', 'codegen', 'config', 'environment', 'cache']),
  probableCause: z.string(),
  suggestedFix: z.string(),
  docs: z.array(z.string()).optional(),
  fixtures: z.array(z.string()).min(1, 'every signature must reference at least one fixture'),
});

export type SignatureEntry = z.infer<typeof signatureSchema>;

export interface Signature extends SignatureEntry {
  regexes: RegExp[];
}

export interface Diagnostic {
  signatureId?: string;
  errorType: string;
  file?: string;
  line?: number;
  message: string;
  probableCause?: string;
  suggestedFix?: string;
}

/** Walk up from this module to the package root (works from src/, dist/ and tests). */
export function findSignaturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, 'signatures');
    if (existsSync(join(candidate, 'ios.yaml'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('signatures/ directory not found relative to the package');
}

let cache: Signature[] | undefined;

export function loadSignatures(signaturesDir = findSignaturesDir()): Signature[] {
  if (cache) return cache;
  const signatures: Signature[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(signaturesDir).filter((f) => f.endsWith('.yaml'))) {
    const raw = parse(readFileSync(join(signaturesDir, file), 'utf8')) as unknown;
    const entries = z.array(signatureSchema).parse(raw);
    for (const entry of entries) {
      if (seen.has(entry.id)) throw new Error(`Duplicate signature id: ${entry.id}`);
      seen.add(entry.id);
      signatures.push({ ...entry, regexes: entry.match.map((m) => new RegExp(m)) });
    }
  }
  cache = signatures;
  return signatures;
}

/** Match a raw build log against the signature DB. Each signature reports at most once. */
export function matchSignatures(log: string, signatures = loadSignatures()): Diagnostic[] {
  const lines = log.split(/\r?\n/);
  const hits: Array<{ position: number; diagnostic: Diagnostic }> = [];
  for (const signature of signatures) {
    outer: for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      for (const regex of signature.regexes) {
        const match = regex.exec(line);
        if (!match) continue;
        const file = match.groups?.file;
        const lineNo = match.groups?.line ? Number.parseInt(match.groups.line, 10) : undefined;
        hits.push({
          position: i,
          diagnostic: {
            signatureId: signature.id,
            errorType: signature.errorType,
            file,
            line: lineNo,
            message: signature.title,
            probableCause: signature.probableCause,
            suggestedFix: signature.suggestedFix,
          },
        });
        break outer; // dedup: one diagnostic per signature per log
      }
    }
  }
  return hits.sort((a, b) => a.position - b.position).map((h) => h.diagnostic);
}
