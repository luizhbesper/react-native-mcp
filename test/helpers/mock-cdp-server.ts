// In-process Metro inspector double: serves /json/list over HTTP and speaks CDP over ws.
// Runtime.evaluate is implemented with a real JS sandbox so the Hermes awaitPromise
// polling workaround (spec 022) can be exercised end-to-end.
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export interface MockTarget {
  id: string;
  title?: string;
  description?: string;
  modern?: boolean;
}

export class MockCdpServer {
  private http!: Server;
  private wss!: WebSocketServer;
  port = 0;
  targets: MockTarget[] = [{ id: 'page-1', title: 'MyApp (Hermes)', modern: true }];
  /** The fake app's globalThis, shared across evaluate calls. */
  readonly sandbox: Record<string, unknown> = {};
  private sockets = new Set<WebSocket>();
  connectionCount = 0;

  async start(): Promise<void> {
    this.http = createServer((req, res) => {
      if (req.url === '/json/list' || req.url === '/json') {
        const body = this.targets.map((t) => ({
          id: t.id,
          title: t.title ?? 'App',
          description: t.description ?? '',
          webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}/inspector?target=${t.id}`,
          ...(t.modern ? { reactNative: { capabilities: { nativePageReloads: true } } } : {}),
        }));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
        return;
      }
      if (req.url === '/reload' && req.method === 'POST') {
        res.end('OK');
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on('connection', (socket) => {
      this.connectionCount++;
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('message', (raw) => this.handle(socket, String(raw)));
    });
    await new Promise<void>((resolve) => {
      this.http.listen(0, '127.0.0.1', () => {
        const address = this.http.address();
        this.port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  }

  private handle(socket: WebSocket, raw: string): void {
    const message = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    const reply = (result: unknown) => socket.send(JSON.stringify({ id: message.id, result }));

    if (message.method === 'Runtime.evaluate') {
      const expression = String(message.params?.expression ?? '');
      try {
        // biome-ignore lint/security/noGlobalEval: the whole point of this mock is evaluating like a JS runtime
        const fn = new Function('globalThis', `return (${expression});`);
        const value = fn(this.sandbox);
        if (value === undefined) {
          reply({ result: { type: 'undefined' } });
        } else {
          try {
            reply({ result: { type: typeof value, value: JSON.parse(JSON.stringify(value)) } });
          } catch {
            reply({ result: { type: typeof value, description: String(value) } });
          }
        }
      } catch (err) {
        reply({
          result: { type: 'undefined' },
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: String(err) },
          },
        });
      }
      return;
    }
    if (message.method === 'Page.reload') {
      reply({});
      return;
    }
    // Runtime.enable, Log.enable, everything else: ack
    reply({});
  }

  /** Push a CDP event to every connected client. */
  emit(method: string, params: unknown): void {
    const payload = JSON.stringify({ method, params });
    for (const socket of this.sockets) socket.send(payload);
  }

  /** Server-side close of all debugger connections (simulates DevTools eviction). */
  dropConnections(): void {
    for (const socket of this.sockets) socket.close();
  }

  async stop(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }
}
