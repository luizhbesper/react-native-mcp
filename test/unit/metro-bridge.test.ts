// specs: 020/022 — session lifecycle and evaluate against the mock CDP runtime
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetroBridge } from '../../src/metro/bridge.js';
import { evaluateExpression } from '../../src/metro/evaluate.js';
import { MockCdpServer } from '../helpers/mock-cdp-server.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('metro bridge lifecycle (spec 020)', () => {
  let server: MockCdpServer;

  beforeEach(async () => {
    server = new MockCdpServer();
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('AC1: METRO_NOT_RUNNING when nothing answers on the port', async () => {
    const bridge = new MetroBridge(1); // port 1 — nothing there
    await expect(bridge.listTargets()).rejects.toMatchObject({ code: 'METRO_NOT_RUNNING' });
  });

  it('AC2: single target auto-connects and the session is reused', async () => {
    const bridge = new MetroBridge(server.port);
    const first = await bridge.ensureSession();
    const second = await bridge.ensureSession();
    expect(second).toBe(first);
    expect(server.connectionCount).toBe(1);
  });

  it('AC3: two viable targets without targetId → TARGET_AMBIGUOUS listing both', async () => {
    server.targets = [
      { id: 'page-1', title: 'AppA', modern: true },
      { id: 'page-2', title: 'AppB', modern: true },
    ];
    const bridge = new MetroBridge(server.port);
    await expect(bridge.ensureSession()).rejects.toMatchObject({
      code: 'TARGET_AMBIGUOUS',
      details: { targets: [expect.objectContaining({ id: 'page-1' }), expect.objectContaining({ id: 'page-2' })] },
    });
    await expect(bridge.ensureSession('page-2')).resolves.toBeDefined();
  });

  it('legacy-only targets are still viable when no modern target exists', async () => {
    server.targets = [{ id: 'legacy-1', title: 'Old', modern: false }];
    const bridge = new MetroBridge(server.port);
    await expect(bridge.ensureSession()).resolves.toBeDefined();
  });

  it('modern targets win over stale legacy pages', async () => {
    server.targets = [
      { id: 'legacy-1', title: 'Old', modern: false },
      { id: 'modern-1', title: 'New', modern: true },
    ];
    const bridge = new MetroBridge(server.port);
    await bridge.ensureSession();
    expect(bridge.selectedTargetId).toBe('modern-1');
  });

  it('AC4: reconnects after eviction and marks the boundary in the buffer', async () => {
    const bridge = new MetroBridge(server.port);
    await bridge.ensureSession();
    server.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'before' }] });
    await delay(50);

    server.dropConnections(); // simulate DevTools stealing the slot / app reload
    await delay(50);

    await bridge.ensureSession();
    expect(server.connectionCount).toBe(2);
    const texts = bridge.buffer.read({}).entries.map((e) => e.text);
    expect(texts).toContain('before');
    expect(texts).toContain('[runtime reconnected]');
  });

  it('streams console events into the buffer with level mapping (spec 021)', async () => {
    const bridge = new MetroBridge(server.port);
    await bridge.ensureSession();
    server.emit('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ type: 'string', value: 'low memory' }, { type: 'number', value: 42 }],
    });
    server.emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        exception: { description: 'Error: boom' },
        stackTrace: { callFrames: [{ functionName: 'doThing', url: 'app://index.js', lineNumber: 10 }] },
      },
    });
    await delay(50);
    const entries = bridge.buffer.read({}).entries;
    expect(entries[0]).toMatchObject({ level: 'warn', text: 'low memory 42' });
    expect(entries[1]?.level).toBe('error');
    expect(entries[1]?.text).toContain('Error: boom');
    expect(entries[1]?.text).toContain('doThing');
  });
});

describe('evaluate_js (spec 022)', () => {
  let server: MockCdpServer;
  let bridge: MetroBridge;

  beforeEach(async () => {
    server = new MockCdpServer();
    await server.start();
    bridge = new MetroBridge(server.port);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('AC1: evaluates a sync expression', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, '1 + 1');
    expect(outcome).toMatchObject({ status: 'ok', result: 2, resultType: 'number' });
  });

  it('AC2: awaits a promise via the polling workaround and cleans up the global', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, 'Promise.resolve(42)', { timeoutMs: 2_000 });
    expect(outcome).toMatchObject({ status: 'ok', result: 42 });
    expect(Object.keys(server.sandbox).filter((k) => k.startsWith('__rnmcp_'))).toEqual([]);
  });

  it('AC3: never-settling promise times out and cleans up', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, 'new Promise(function () {})', {
      timeoutMs: 300,
    });
    expect(outcome.status).toBe('timeout');
    expect(Object.keys(server.sandbox).filter((k) => k.startsWith('__rnmcp_'))).toEqual([]);
  });

  it('AC4: a throwing expression surfaces the exception', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, 'JSON.parse("{")');
    expect(outcome.status).toBe('exception');
    expect(outcome.exception?.text).toContain('SyntaxError');
  });

  it('rejected promises surface as exceptions', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, 'Promise.reject(new Error("boom"))', {
      timeoutMs: 2_000,
    });
    expect(outcome.status).toBe('exception');
    expect(outcome.exception?.text).toContain('boom');
  });

  it('AC5: oversized results are truncated', async () => {
    const connection = await bridge.ensureSession();
    const outcome = await evaluateExpression(connection, '"y".repeat(40000)');
    expect(outcome.truncated).toBe(true);
    expect((outcome.preview ?? '').length).toBeLessThanOrEqual(16 * 1024 + 1);
  });
});
