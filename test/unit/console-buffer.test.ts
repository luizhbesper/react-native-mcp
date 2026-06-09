// spec: 021 — ACs map 1:1
import { describe, expect, it } from 'vitest';
import { ConsoleRingBuffer } from '../../src/metro/console-buffer.js';

describe('console ring buffer (spec 021)', () => {
  it('AC1: no cursor returns the most recent page', () => {
    const buffer = new ConsoleRingBuffer();
    for (let i = 1; i <= 60; i++) buffer.push('info', `msg ${i}`);
    const result = buffer.read({ limit: 50 });
    expect(result.entries).toHaveLength(50);
    expect(result.entries[0]?.text).toBe('msg 11');
    expect(result.entries.at(-1)?.text).toBe('msg 60');
    expect(result.nextCursor).toBe(60);
  });

  it('AC2: cursor reads only newer entries, oldest first', () => {
    const buffer = new ConsoleRingBuffer();
    for (let i = 1; i <= 10; i++) buffer.push('info', `msg ${i}`);
    const result = buffer.read({ cursor: 7 });
    expect(result.entries.map((e) => e.text)).toEqual(['msg 8', 'msg 9', 'msg 10']);
    expect(result.dropped).toBe(0);
  });

  it('AC3: overflow reports dropped count for stale cursors', () => {
    const buffer = new ConsoleRingBuffer(100);
    for (let i = 1; i <= 160; i++) buffer.push('info', `msg ${i}`);
    const result = buffer.read({ cursor: 10 });
    // entries 1..60 evicted; cursor 10 missed 11..60 = 50
    expect(result.dropped).toBe(50);
    expect(result.entries[0]?.text).toBe('msg 61');
  });

  it('AC4: consecutive identical entries collapse with repeat', () => {
    const buffer = new ConsoleRingBuffer();
    for (let i = 0; i < 30; i++) buffer.push('warn', 'same warning');
    buffer.push('warn', 'different');
    const result = buffer.read({});
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ text: 'same warning', repeat: 30 });
  });

  it('AC5: entries are truncated at 500 chars', () => {
    const buffer = new ConsoleRingBuffer();
    buffer.push('info', 'x'.repeat(10_000));
    const entry = buffer.read({}).entries[0];
    expect(entry?.text.length).toBeLessThan(520);
    expect(entry?.text).toContain('…[+');
  });

  it('AC6: level filter excludes lower severities without breaking seq', () => {
    const buffer = new ConsoleRingBuffer();
    buffer.push('debug', 'd');
    buffer.push('info', 'i');
    buffer.push('warn', 'w');
    buffer.push('error', 'e');
    const result = buffer.read({ level: 'warn' });
    expect(result.entries.map((e) => e.text)).toEqual(['w', 'e']);
    expect(result.entries.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('regex filter applies to text', () => {
    const buffer = new ConsoleRingBuffer();
    buffer.push('info', 'fetching /api/users');
    buffer.push('info', 'render complete');
    const result = buffer.read({ filter: /api/i });
    expect(result.entries).toHaveLength(1);
  });

  it('markers bypass dedup', () => {
    const buffer = new ConsoleRingBuffer();
    buffer.pushMarker('[runtime reconnected]');
    buffer.pushMarker('[runtime reconnected]');
    expect(buffer.read({}).entries).toHaveLength(2);
  });
});
