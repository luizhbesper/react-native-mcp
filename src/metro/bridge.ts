// spec: 020/021 — session lifecycle: lazy connect, target selection, reconnect-on-stale
import { ToolError } from '../shared/errors.js';
import { log } from '../shared/logger.js';
import { CdpConnection } from './cdp-client.js';
import { type ConsoleLevel, ConsoleRingBuffer } from './console-buffer.js';
import { fetchRawPages, type RuntimeTarget, selectViableTargets } from './discovery.js';

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
}

interface ConsoleApiCalledParams {
  type?: string;
  args?: RemoteObject[];
  timestamp?: number;
}

interface LogEntryParams {
  entry?: { level?: string; text?: string; timestamp?: number };
}

interface ExceptionThrownParams {
  timestamp?: number;
  exceptionDetails?: {
    text?: string;
    exception?: RemoteObject;
    stackTrace?: {
      callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number }>;
    };
  };
}

export function stringifyRemoteObject(obj: RemoteObject): string {
  if ('value' in obj && obj.value !== undefined) {
    return typeof obj.value === 'string' ? obj.value : JSON.stringify(obj.value);
  }
  return obj.description ?? obj.type ?? 'undefined';
}

const LEVEL_MAP: Record<string, ConsoleLevel> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  verbose: 'debug',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  assert: 'error',
};

export class MetroBridge {
  readonly buffer = new ConsoleRingBuffer();
  private connection?: CdpConnection;
  private connectedTargetId?: string;
  private hasConnectedBefore = false;

  constructor(private readonly defaultPort: number) {}

  async listTargets(port = this.defaultPort): Promise<RuntimeTarget[]> {
    const pages = await fetchRawPages(port);
    if (pages === null) {
      throw new ToolError(
        'METRO_NOT_RUNNING',
        `No Metro dev server answering on http://localhost:${port}/json/list.`,
        'Start it with `npx expo start` or `npx react-native start`, then retry. Use --metro-port if it runs elsewhere.',
        { probedUrl: `http://localhost:${port}/json/list` },
      );
    }
    return selectViableTargets(pages);
  }

  get selectedTargetId(): string | undefined {
    return this.connectedTargetId;
  }

  invalidate(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  async ensureSession(targetId?: string): Promise<CdpConnection> {
    if (this.connection && !this.connection.closed) {
      if (!targetId || targetId === this.connectedTargetId) return this.connection;
      this.invalidate();
    }

    const targets = await this.listTargets();
    if (targets.length === 0) {
      throw new ToolError(
        'NO_TARGETS',
        'Metro is running but no debuggable app is connected.',
        'Open the app on a booted device/simulator so its runtime registers with Metro, then retry.',
      );
    }

    let target: RuntimeTarget | undefined;
    if (targetId) {
      target = targets.find((t) => t.id === targetId);
      if (!target) {
        throw new ToolError(
          'TARGET_AMBIGUOUS',
          `No runtime target with id ${targetId}.`,
          'Call list_runtime_targets and pass one of the listed ids.',
          { targets: targets.map(({ id, title, description }) => ({ id, title, description })) },
        );
      }
    } else if (this.connectedTargetId && targets.some((t) => t.id === this.connectedTargetId)) {
      target = targets.find((t) => t.id === this.connectedTargetId);
    } else if (targets.length === 1) {
      target = targets[0];
    } else {
      throw new ToolError(
        'TARGET_AMBIGUOUS',
        `${targets.length} debuggable targets found — pick one via targetId.`,
        'Call list_runtime_targets and pass the targetId of the app you want.',
        { targets: targets.map(({ id, title, description }) => ({ id, title, description })) },
      );
    }
    if (!target) {
      throw new ToolError(
        'NO_TARGETS',
        'No connectable runtime target.',
        'Open the app and retry.',
      );
    }

    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    this.connection = connection;
    this.connectedTargetId = target.id;

    connection.onEvent((method, params) => this.handleEvent(method, params));
    connection.onClose(() => {
      if (this.connection === connection) this.connection = undefined;
    });

    await connection.send('Runtime.enable').catch((err) => log('Runtime.enable failed:', err));
    await connection.send('Log.enable').catch(() => {
      // Log domain is optional on some Hermes versions
    });

    if (this.hasConnectedBefore) {
      this.buffer.pushMarker('[runtime reconnected]');
    }
    this.hasConnectedBefore = true;
    log(`connected to runtime target ${target.id} (${target.title})`);
    return connection;
  }

  private handleEvent(method: string, params: unknown): void {
    if (method === 'Runtime.consoleAPICalled') {
      const p = params as ConsoleApiCalledParams;
      const level = LEVEL_MAP[p.type ?? 'log'] ?? 'info';
      const text = (p.args ?? []).map(stringifyRemoteObject).join(' ');
      this.buffer.push(level, text, p.timestamp ?? Date.now());
      return;
    }
    if (method === 'Log.entryAdded') {
      const p = params as LogEntryParams;
      const level = LEVEL_MAP[p.entry?.level ?? 'info'] ?? 'info';
      this.buffer.push(level, p.entry?.text ?? '', p.entry?.timestamp ?? Date.now());
      return;
    }
    if (method === 'Runtime.exceptionThrown') {
      const p = params as ExceptionThrownParams;
      const details = p.exceptionDetails;
      const text = details?.exception
        ? stringifyRemoteObject(details.exception)
        : (details?.text ?? 'Uncaught exception');
      const frames = (details?.stackTrace?.callFrames ?? [])
        .slice(0, 3)
        .map(
          (f) => `  at ${f.functionName || '<anonymous>'} (${f.url ?? '?'}:${f.lineNumber ?? '?'})`,
        )
        .join('\n');
      this.buffer.push('error', frames ? `${text}\n${frames}` : text, p.timestamp ?? Date.now());
    }
  }
}
