// spec: 002 — the full tool catalog for a given capability set
import { createBuildTools, parseBuildLogTool } from '../build/tools.js';
import { deviceTools } from '../devices/tools.js';
import type { Capabilities } from '../env/capabilities.js';
import { doctorTool } from '../env/doctor.js';
import { metroTools } from '../metro/tools.js';
import type { AnyToolDef } from './registry.js';

export function buildToolCatalog(caps: Capabilities): AnyToolDef[] {
  return [doctorTool, ...deviceTools, ...metroTools, ...createBuildTools(caps), parseBuildLogTool];
}
