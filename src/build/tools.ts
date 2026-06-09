// spec: 030/032 — build tools (background jobs + offline parsing)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Capabilities } from '../env/capabilities.js';
import { ToolError } from '../shared/errors.js';
import { ok } from '../shared/result.js';
import { formatDuration } from '../shared/truncate.js';
import { type AnyToolDef, defineTool } from '../tools/registry.js';
import { type ParseResult, parseBuildLog } from './parser.js';
import { findArtifact, startBuild } from './runner.js';

const diagnosticSchema = z.object({
  signatureId: z.string().optional(),
  errorType: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
  probableCause: z.string().optional(),
  suggestedFix: z.string().optional(),
});

const parseCache = new Map<string, ParseResult>();

function parsedLog(jobId: string, logPath: string): ParseResult {
  const cached = parseCache.get(jobId);
  if (cached) return cached;
  const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const result = parseBuildLog(content);
  parseCache.set(jobId, result);
  return result;
}

function diagnosticsText(parsed: ParseResult): string[] {
  return parsed.diagnostics.slice(0, 5).map((d) => {
    const location = d.file ? ` [${d.file}${d.line ? `:${d.line}` : ''}]` : '';
    const fix = d.suggestedFix ? ` → ${d.suggestedFix}` : '';
    return `• ${d.message}${location}${fix}`;
  });
}

export function createBuildTools(caps: Capabilities): AnyToolDef[] {
  const darwin = caps.host.os === 'darwin';
  const platformValues = darwin ? (['ios', 'android'] as const) : (['android'] as const);
  const platformSchema = z.enum(platformValues as unknown as [string, ...string[]]);

  const runBuildTool = defineTool({
    name: 'run_build',
    title: 'Run native build',
    description: `Start a native build (${darwin ? 'xcodebuild or Gradle' : 'Gradle'}) in the background and return a job id immediately. Poll with get_build_status. Use after native-layer changes; for pure JS changes prefer reload_app.`,
    spec: '030',
    inputSchema: {
      platform: platformSchema.describe('Which native platform to build'),
      projectRoot: z.string().optional().describe('Project root (default: server --project-root)'),
      scheme: z
        .string()
        .optional()
        .describe('iOS scheme (default: auto-detected from the workspace)'),
      variant: z.string().optional().describe('Android variant (default "debug")'),
      clean: z.boolean().optional().describe('Clean before building'),
    },
    outputSchema: {
      jobId: z.string(),
      status: z.literal('running'),
      logPath: z.string(),
      command: z.string(),
    },
    handler: async (args, ctx) => {
      const job = startBuild(ctx.jobs, {
        platform: args.platform as 'ios' | 'android',
        projectRoot: args.projectRoot ?? ctx.config.projectRoot,
        scheme: args.scheme,
        variant: args.variant,
        clean: args.clean,
      });
      return ok(
        `Build started (job ${job.id}). Poll with get_build_status — typical native builds take 2-15 minutes.`,
        { jobId: job.id, status: 'running', logPath: job.logPath, command: job.command },
      );
    },
  });

  const getBuildStatusTool = defineTool({
    name: 'get_build_status',
    title: 'Get build status',
    description:
      'Check a build job started by run_build. Long-polls up to waitSeconds (default 25) so you can wait efficiently; on completion returns structured diagnostics with probable causes and suggested fixes.',
    spec: '030',
    annotations: { readOnlyHint: true },
    inputSchema: {
      jobId: z.string(),
      waitSeconds: z
        .number()
        .int()
        .min(0)
        .max(60)
        .optional()
        .describe('Long-poll budget (default 25)'),
    },
    outputSchema: {
      status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
      elapsedMs: z.number(),
      exitCode: z.number().optional(),
      errorCount: z.number().optional(),
      warningCount: z.number().optional(),
      diagnostics: z.array(diagnosticSchema).optional(),
      artifactPath: z.string().optional(),
      logPath: z.string(),
      logSizeBytes: z.number().optional(),
      logTail: z
        .string()
        .optional()
        .describe('Last lines of the log — only when no signature matched a failure'),
    },
    handler: async (args, ctx) => {
      let job = ctx.jobs.get(args.jobId);
      if (!job) {
        throw new ToolError(
          'JOB_NOT_FOUND',
          `No build job ${args.jobId}.`,
          'Job ids do not survive server restarts — use parse_build_log on the log file, or run_build again.',
        );
      }
      job = (await ctx.jobs.waitForTerminal(args.jobId, (args.waitSeconds ?? 25) * 1000)) ?? job;

      if (job.status === 'running') {
        const logSizeBytes = existsSync(job.logPath) ? statSync(job.logPath).size : 0;
        return ok(
          `Still building (${formatDuration(Date.now() - job.startedAt)} elapsed). Poll again with get_build_status.`,
          {
            status: 'running',
            elapsedMs: Date.now() - job.startedAt,
            logPath: job.logPath,
            logSizeBytes,
          },
        );
      }

      const parsed = parsedLog(job.id, job.logPath);
      const durationMs = (job.finishedAt ?? Date.now()) - job.startedAt;
      const artifactPath = job.status === 'succeeded' ? findArtifact(job) : undefined;
      const structured = {
        status: job.status,
        elapsedMs: durationMs,
        exitCode: job.exitCode,
        errorCount: parsed.errorCount,
        warningCount: parsed.warningCount,
        diagnostics: parsed.diagnostics,
        artifactPath,
        logPath: job.logPath,
        logTail: job.status === 'failed' ? parsed.unmatchedTail : undefined,
      };
      const lines =
        job.status === 'succeeded'
          ? [
              `✅ Build succeeded in ${formatDuration(durationMs)}${artifactPath ? ` · artifact: ${artifactPath}` : ''}`,
            ]
          : job.status === 'cancelled'
            ? [`Build cancelled after ${formatDuration(durationMs)}`]
            : [
                `❌ Build failed in ${formatDuration(durationMs)} (${parsed.errorCount} errors)`,
                ...diagnosticsText(parsed),
                ...(parsed.diagnostics.length === 0
                  ? [`No known signature matched — see logTail or read ${job.logPath}`]
                  : []),
              ];
      return ok(lines.join('\n'), structured);
    },
  });

  const cancelBuildTool = defineTool({
    name: 'cancel_build',
    title: 'Cancel build',
    description: 'Cancel a running build job (kills the whole process tree).',
    spec: '030',
    inputSchema: { jobId: z.string() },
    outputSchema: { status: z.enum(['succeeded', 'failed', 'cancelled']) },
    handler: async (args, ctx) => {
      const job = ctx.jobs.cancel(args.jobId);
      if (!job) {
        throw new ToolError(
          'JOB_NOT_FOUND',
          `No build job ${args.jobId}.`,
          'Check the jobId from run_build.',
        );
      }
      return ok(`Job ${job.id} is ${job.status}`, { status: job.status });
    },
  });

  const podInstallTool = defineTool({
    name: 'run_pod_install',
    title: 'Run pod install',
    description:
      'Run CocoaPods install for the iOS project (uses bundler when a Gemfile exists). Call when a build fails with sandbox/Podfile.lock errors or after adding native dependencies.',
    spec: '030',
    gate: (c) => c.host.os === 'darwin' && c.ios.available,
    inputSchema: {
      projectRoot: z.string().optional().describe('Project root (default: server --project-root)'),
    },
    outputSchema: {
      succeeded: z.boolean(),
      diagnostics: z.array(diagnosticSchema).optional(),
    },
    handler: async (args, ctx) => {
      const root = args.projectRoot ?? ctx.config.projectRoot;
      const iosDir = join(root, 'ios');
      if (!existsSync(join(iosDir, 'Podfile'))) {
        throw new ToolError(
          'WORKSPACE_NOT_FOUND',
          `No Podfile in ${iosDir}.`,
          'Check projectRoot; for Expo projects run `npx expo prebuild` first.',
        );
      }
      const useBundler = existsSync(join(root, 'Gemfile'));
      const [cmd, cmdArgs] = useBundler
        ? ['bundle', ['exec', 'pod', 'install']]
        : ['pod', ['install']];
      const result = await ctx.exec(cmd, cmdArgs, { cwd: iosDir, timeoutMs: 300_000 });
      if (result.exitCode === 0) {
        return ok('pod install succeeded', { succeeded: true });
      }
      const parsed = parseBuildLog(`${result.stdout}\n${result.stderr}`);
      throw new ToolError(
        'POD_INSTALL_FAILED',
        `pod install failed (exit ${result.exitCode}).`,
        parsed.diagnostics[0]?.suggestedFix ??
          'Read the diagnostics in details; run with --verbose for the full log.',
        { diagnostics: parsed.diagnostics, tail: parsed.unmatchedTail },
      );
    },
  });

  return [runBuildTool, getBuildStatusTool, cancelBuildTool, podInstallTool];
}

export const parseBuildLogTool = defineTool({
  name: 'parse_build_log',
  title: 'Parse a build log',
  description:
    'Parse a native build log (xcodebuild, Gradle, CocoaPods, Metro) into structured diagnostics with probable causes and suggested fixes. Use on logs from terminals, CI, or a logPath from get_build_status.',
  spec: '032',
  annotations: { readOnlyHint: true },
  inputSchema: {
    logPath: z.string().optional().describe('Path to a log file on disk (max 20MB)'),
    logText: z
      .string()
      .optional()
      .describe('Raw log text (max 256KB) — provide exactly one of logPath/logText'),
  },
  outputSchema: {
    diagnostics: z.array(
      z.object({
        signatureId: z.string().optional(),
        errorType: z.string(),
        file: z.string().optional(),
        line: z.number().optional(),
        message: z.string(),
        probableCause: z.string().optional(),
        suggestedFix: z.string().optional(),
      }),
    ),
    errorCount: z.number(),
    warningCount: z.number(),
    platformGuess: z.enum(['ios', 'android', 'cocoapods', 'metro', 'unknown']),
    unmatchedTail: z.string().optional(),
  },
  handler: async (args) => {
    if (Boolean(args.logPath) === Boolean(args.logText)) {
      throw new ToolError(
        'INVALID_INPUT',
        'Provide exactly one of logPath or logText.',
        'Pass the log file path, or paste the log text — not both.',
      );
    }
    let content: string;
    if (args.logPath) {
      if (!existsSync(args.logPath)) {
        throw new ToolError('LOG_NOT_FOUND', `No file at ${args.logPath}.`, 'Check the path.');
      }
      if (statSync(args.logPath).size > 20 * 1024 * 1024) {
        throw new ToolError(
          'LOG_TOO_LARGE',
          'Log file exceeds 20MB.',
          'Trim the log to the failing section.',
        );
      }
      content = readFileSync(args.logPath, 'utf8');
    } else {
      if ((args.logText as string).length > 256 * 1024) {
        throw new ToolError(
          'LOG_TOO_LARGE',
          'Inline log text exceeds 256KB.',
          'Write it to a file and pass logPath instead.',
        );
      }
      content = args.logText as string;
    }
    const parsed = parseBuildLog(content);
    const lines = [
      `${parsed.errorCount} errors, ${parsed.warningCount} warnings (${parsed.platformGuess} log)`,
      ...diagnosticsText(parsed),
    ];
    return ok(lines.join('\n'), { ...parsed });
  },
});
