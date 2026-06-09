// shared dependency context handed to every tool handler
import type { JobStore } from '../build/jobs.js';
import type { Config } from '../config.js';
import type { DeviceManager } from '../devices/facade.js';
import type { Capabilities } from '../env/capabilities.js';
import type { DetectDeps } from '../env/detect.js';
import type { MetroBridge } from '../metro/bridge.js';
import type { ExecFn } from '../shared/exec.js';

export interface ToolContext {
  config: Config;
  exec: ExecFn;
  /** Capabilities snapshot taken at startup (drives Tier 1 gating). */
  capabilities: Capabilities;
  /** Deps for fresh re-detection (doctor). */
  detectDeps: DetectDeps;
  devices: DeviceManager;
  metro: MetroBridge;
  jobs: JobStore;
}
