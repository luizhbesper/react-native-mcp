// spec: 020 — minimal CDP client over WebSocket (single session, single debugger slot)
import WebSocket from 'ws';
import { ToolError } from '../shared/errors.js';
import { log } from '../shared/logger.js';

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: unknown;
}

export type CdpEventHandler = (method: string, params: unknown) => void;

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly eventHandlers: CdpEventHandler[] = [];
  private readonly closeHandlers: Array<() => void> = [];
  private isClosed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.handleMessage(String(data)));
    socket.on('close', () => this.handleClose());
    socket.on('error', (err) => {
      log('cdp socket error:', err.message);
      this.handleClose();
    });
  }

  static connect(url: string, timeoutMs = 5_000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
      const onError = (err: Error) => {
        reject(
          new ToolError(
            'DEBUGGER_OCCUPIED',
            `Could not attach to the runtime debugger (${err.message}). Hermes allows a single debugger connection.`,
            'Close React Native DevTools (the tab opened by pressing j in Metro) and retry.',
          ),
        );
      };
      socket.once('error', onError);
      socket.once('open', () => {
        socket.off('error', onError);
        resolve(new CdpConnection(socket));
      });
    });
  }

  private handleMessage(raw: string): void {
    let message: CdpResponse;
    try {
      message = JSON.parse(raw) as CdpResponse;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'CDP error'));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.eventHandlers) handler(message.method, message.params);
    }
  }

  private handleClose(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    for (const handler of this.closeHandlers) handler();
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(handler: CdpEventHandler): void {
    this.eventHandlers.push(handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  close(): void {
    this.socket.close();
    this.handleClose();
  }
}
