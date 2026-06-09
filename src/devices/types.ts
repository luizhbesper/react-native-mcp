// spec: 010 — the unified device schema
import { z } from 'zod';

export interface Device {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  kind: 'simulator' | 'emulator' | 'physical';
  state: 'booted' | 'shutdown' | 'unknown';
  osVersion: string;
}

export const deviceSchema = z.object({
  id: z.string().describe('simctl UDID, adb serial, or avd:<name> for a cold Android AVD'),
  name: z.string(),
  platform: z.enum(['ios', 'android']),
  kind: z.enum(['simulator', 'emulator', 'physical']),
  state: z.enum(['booted', 'shutdown', 'unknown']),
  osVersion: z.string(),
});

const UDID_RE = /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/;

export type DeviceRoute = 'ios' | 'android';

export function routeDeviceId(id: string): DeviceRoute {
  if (UDID_RE.test(id)) return 'ios';
  return 'android';
}
