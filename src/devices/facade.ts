// spec: 010/011 — platform-agnostic device façade; routes ids to the right backend
import type { Capabilities } from '../env/capabilities.js';
import { ToolError } from '../shared/errors.js';
import type { ExecFn } from '../shared/exec.js';
import { log } from '../shared/logger.js';
import { AdbBackend, AVD_ID_PREFIX } from './backends/adb.js';
import { SimctlBackend } from './backends/simctl.js';
import { type Device, routeDeviceId } from './types.js';

export interface ListOptions {
  platform?: 'ios' | 'android';
  state?: 'booted' | 'shutdown';
  filter?: 'default' | 'all';
}

export interface ListResult {
  devices: Device[];
  totalCount: number;
  shown: number;
}

const MAX_SHOWN = 30;

function compareOsVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Default view: every booted device + the newest-OS variant per (platform, name) family. */
export function collapseDevices(devices: Device[]): Device[] {
  const booted = devices.filter((d) => d.state === 'booted');
  const rest = devices.filter((d) => d.state !== 'booted');
  const newestByFamily = new Map<string, Device>();
  for (const device of rest) {
    const key = `${device.platform}:${device.name}`;
    const current = newestByFamily.get(key);
    if (!current || compareOsVersions(device.osVersion, current.osVersion) > 0) {
      newestByFamily.set(key, device);
    }
  }
  return [...booted, ...newestByFamily.values()];
}

export class DeviceManager {
  private readonly simctl?: SimctlBackend;
  private readonly adb?: AdbBackend;

  constructor(exec: ExecFn, capabilities: Capabilities, headless: boolean) {
    if (capabilities.ios.available) {
      this.simctl = new SimctlBackend(exec, headless);
    }
    if (capabilities.android.available && capabilities.android.adbPath) {
      this.adb = new AdbBackend(
        exec,
        capabilities.android.adbPath,
        capabilities.android.emulatorPath,
        headless,
      );
    }
  }

  ios(): SimctlBackend {
    if (!this.simctl) {
      throw new ToolError(
        'IOS_UNAVAILABLE',
        'The iOS toolchain is not available on this host.',
        'Install Xcode with simulators, then restart the MCP server (check with doctor).',
      );
    }
    return this.simctl;
  }

  android(): AdbBackend {
    if (!this.adb) {
      throw new ToolError(
        'ANDROID_UNAVAILABLE',
        'The Android SDK is not available on this host.',
        'Install Android Studio / platform-tools and set ANDROID_HOME, then restart the MCP server.',
      );
    }
    return this.adb;
  }

  routeOf(deviceId: string): 'ios' | 'android' {
    return routeDeviceId(deviceId);
  }

  async listAll(): Promise<Device[]> {
    const results = await Promise.allSettled([
      this.simctl ? this.simctl.list() : Promise.resolve([] as Device[]),
      this.adb ? this.adb.list() : Promise.resolve([] as Device[]),
    ]);
    const devices: Device[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') devices.push(...result.value);
      else log('device list backend failed:', result.reason);
    }
    return devices;
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    let devices = await this.listAll();
    if (options.platform) devices = devices.filter((d) => d.platform === options.platform);
    if (options.state) devices = devices.filter((d) => d.state === options.state);
    const totalCount = devices.length;
    if (options.filter !== 'all') devices = collapseDevices(devices);
    devices.sort((a, b) =>
      a.state === b.state
        ? a.platform === b.platform
          ? a.name.localeCompare(b.name)
          : a.platform.localeCompare(b.platform)
        : a.state === 'booted'
          ? -1
          : 1,
    );
    const shown = Math.min(devices.length, MAX_SHOWN);
    return { devices: devices.slice(0, shown), totalCount, shown };
  }

  async getDevice(deviceId: string): Promise<Device> {
    const devices = await this.listAll();
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      throw new ToolError(
        'DEVICE_NOT_FOUND',
        `No device with id ${deviceId}.`,
        'Call list_devices for valid ids.',
      );
    }
    return device;
  }

  async getBootedDevice(deviceId: string): Promise<Device> {
    const device = await this.getDevice(deviceId);
    if (device.state !== 'booted' || deviceId.startsWith(AVD_ID_PREFIX)) {
      throw new ToolError(
        'DEVICE_NOT_BOOTED',
        `${device.name} (${deviceId}) is not booted.`,
        'Call boot_device first.',
      );
    }
    return device;
  }
}
