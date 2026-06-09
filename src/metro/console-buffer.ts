// spec: 021 — ring buffer for console events with cursors, dedup and token budgets
import { truncateText } from '../shared/truncate.js';

export type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ConsoleEntry {
  seq: number;
  ts: number;
  level: ConsoleLevel;
  text: string;
  repeat?: number;
}

export interface ReadOptions {
  cursor?: number;
  limit?: number;
  level?: ConsoleLevel;
  filter?: RegExp;
}

export interface ReadResult {
  entries: ConsoleEntry[];
  nextCursor: number;
  dropped: number;
}

const LEVEL_ORDER: Record<ConsoleLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_ENTRY_CHARS = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ConsoleRingBuffer {
  private entries: ConsoleEntry[] = [];
  private nextSeq = 1;
  readonly bufferedSince = Date.now();

  constructor(private readonly capacity = 5_000) {}

  push(level: ConsoleLevel, text: string, ts = Date.now()): void {
    const truncated = truncateText(text, MAX_ENTRY_CHARS);
    const last = this.entries.at(-1);
    if (last && last.level === level && last.text === truncated) {
      last.repeat = (last.repeat ?? 1) + 1;
      return;
    }
    this.entries.push({ seq: this.nextSeq++, ts, level, text: truncated });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  pushMarker(text: string): void {
    // markers bypass dedup so reconnect boundaries always show
    this.entries.push({ seq: this.nextSeq++, ts: Date.now(), level: 'info', text });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  get lastSeq(): number {
    return this.nextSeq - 1;
  }

  read(options: ReadOptions = {}): ReadResult {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const minLevel = options.level ? LEVEL_ORDER[options.level] : 0;

    const oldestSeq = this.entries[0]?.seq ?? this.nextSeq;
    let dropped = 0;
    let pool: ConsoleEntry[];
    if (options.cursor !== undefined) {
      if (options.cursor < oldestSeq - 1) dropped = oldestSeq - 1 - options.cursor;
      const cursor = options.cursor;
      pool = this.entries.filter((e) => e.seq > cursor);
    } else {
      pool = this.entries;
    }

    const matches = pool.filter(
      (e) => LEVEL_ORDER[e.level] >= minLevel && (!options.filter || options.filter.test(e.text)),
    );
    // no cursor → the most recent page ("what just happened"); cursor → oldest-first continuation
    const page = options.cursor === undefined ? matches.slice(-limit) : matches.slice(0, limit);
    const nextCursor = page.at(-1)?.seq ?? options.cursor ?? this.lastSeq;
    return { entries: page, nextCursor, dropped };
  }
}
