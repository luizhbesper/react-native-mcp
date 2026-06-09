// spec: 030 — in-memory job store with bounded long-poll waiters

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { killTree } from '../shared/exec.js';

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BuildJob {
  id: string;
  platform: 'ios' | 'android';
  projectRoot: string;
  command: string;
  logPath: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  child?: ChildProcess;
}

export class JobStore {
  private readonly jobs = new Map<string, BuildJob>();
  private readonly waiters = new Map<string, Array<() => void>>();

  create(input: Omit<BuildJob, 'id' | 'status' | 'startedAt'>): BuildJob {
    const job: BuildJob = {
      ...input,
      id: randomUUID().slice(0, 8),
      status: 'running',
      startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): BuildJob | undefined {
    return this.jobs.get(id);
  }

  findRunning(platform: 'ios' | 'android', projectRoot: string): BuildJob | undefined {
    for (const job of this.jobs.values()) {
      if (
        job.status === 'running' &&
        job.platform === platform &&
        job.projectRoot === projectRoot
      ) {
        return job;
      }
    }
    return undefined;
  }

  finish(id: string, status: Exclude<JobStatus, 'running'>, exitCode?: number): void {
    const job = this.jobs.get(id);
    if (job?.status !== 'running') return;
    job.status = status;
    job.exitCode = exitCode;
    job.finishedAt = Date.now();
    job.child = undefined;
    for (const wake of this.waiters.get(id) ?? []) wake();
    this.waiters.delete(id);
  }

  cancel(id: string): BuildJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === 'running' && job.child?.pid) {
      killTree(job.child.pid);
      this.finish(id, 'cancelled');
    }
    return job;
  }

  /** Resolve when the job reaches a terminal status or after waitMs, whichever comes first. */
  async waitForTerminal(id: string, waitMs: number): Promise<BuildJob | undefined> {
    const job = this.jobs.get(id);
    if (job?.status !== 'running' || waitMs <= 0) return job;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, waitMs);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      const list = this.waiters.get(id) ?? [];
      list.push(done);
      this.waiters.set(id, list);
    });
    return this.jobs.get(id);
  }
}
