// spec: 031/032 — log → structured diagnostics (signatures first, generic extractors second)
import { tailLines } from '../shared/truncate.js';
import { type Diagnostic, loadSignatures, matchSignatures, type Signature } from './signatures.js';

export interface ParseResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  platformGuess: 'ios' | 'android' | 'cocoapods' | 'metro' | 'unknown';
  unmatchedTail?: string;
}

const MAX_DIAGNOSTICS = 10;
const MESSAGE_MAX = 300;

interface GenericExtractor {
  regex: RegExp;
}

// clang/swift, kotlin (old + new style), javac, generic xcodebuild
const GENERIC_EXTRACTORS: GenericExtractor[] = [
  {
    regex:
      /^(?<file>[^\s:]+\.(?:m|mm|h|hpp|c|cc|cpp|swift)):(?<line>\d+):(?:\d+:)?\s*(?:fatal\s+)?error:\s*(?<msg>.+)$/,
  },
  { regex: /^e:\s*(?:file:\/\/)?(?<file>[^\s:]+\.kts?):(?<line>\d+)(?::\d+)?\s+(?<msg>.+)$/ },
  { regex: /^e:\s*(?<file>[^\s(]+\.kts?):?\s*\((?<line>\d+),\s*\d+\):\s*(?<msg>.+)$/ },
  { regex: /^(?<file>[^\s:]+\.java):(?<line>\d+):\s*error:\s*(?<msg>.+)$/ },
];

export function guessPlatform(log: string): ParseResult['platformGuess'] {
  if (/(?:pod install|CocoaPods|Podfile)/i.test(log) && !/xcodebuild/i.test(log))
    return 'cocoapods';
  if (/(?:> Task :|FAILURE: Build failed|gradlew|org\.gradle)/.test(log)) return 'android';
  if (
    /(?:xcodebuild|\.xcworkspace|CompileC|CompileSwift|PhaseScriptExecution|clang: error|^ld: |\*\* BUILD (?:FAILED|SUCCEEDED) \*\*|xcrun: error)/m.test(
      log,
    )
  ) {
    return 'ios';
  }
  if (
    /(?:Metro|error: bundling failed|UnableToResolveError|Unable to resolve module|EADDRINUSE)/.test(
      log,
    )
  ) {
    return 'metro';
  }
  return 'unknown';
}

export function parseBuildLog(log: string, signatures?: Signature[]): ParseResult {
  const resolved = signatures ?? loadSignatures();
  const diagnostics = matchSignatures(log, resolved);
  const matchedSomething = diagnostics.length > 0;

  const lines = log.split(/\r?\n/);
  let errorCount = 0;
  let warningCount = 0;
  const seenGeneric = new Set<string>();

  for (const line of lines) {
    if (/(?:^|[^\w])error[:\s]/i.test(line)) errorCount++;
    else if (/(?:^|[^\w])warning[:\s]/i.test(line)) warningCount++;

    if (diagnostics.length >= MAX_DIAGNOSTICS) continue;
    for (const extractor of GENERIC_EXTRACTORS) {
      const match = extractor.regex.exec(line);
      if (!match?.groups) continue;
      const key = `${match.groups.file}:${match.groups.line}`;
      if (seenGeneric.has(key)) break;
      seenGeneric.add(key);
      diagnostics.push({
        errorType: 'unknown',
        file: match.groups.file,
        line: match.groups.line ? Number.parseInt(match.groups.line, 10) : undefined,
        message: (match.groups.msg ?? '').slice(0, MESSAGE_MAX),
      });
      break;
    }
  }

  const result: ParseResult = {
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    errorCount,
    warningCount,
    platformGuess: guessPlatform(log),
  };
  if (errorCount > 0 && !matchedSomething && result.diagnostics.length === 0) {
    result.unmatchedTail = tailLines(log, 40);
  }
  return result;
}
