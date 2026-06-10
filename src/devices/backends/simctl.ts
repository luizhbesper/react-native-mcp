// spec: 010-013 — iOS simulator backend over `xcrun simctl` (machine formats only)
import { existsSync } from 'node:fs';
import { ToolError } from '../../shared/errors.js';
import type { ExecFn } from '../../shared/exec.js';
import type { Device } from '../types.js';

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

interface SimctlListOutput {
  devices: Record<string, SimctlDevice[]>;
}

const runtimeToOsVersion = (runtimeKey: string): string => {
  // "com.apple.CoreSimulator.SimRuntime.iOS-18-4" -> "18.4"
  const match = /SimRuntime\.[A-Za-z]+-([\d-]+)$/.exec(runtimeKey);
  return match?.[1] ? match[1].replaceAll('-', '.') : '';
};

const mapState = (state: string): Device['state'] => {
  if (state === 'Booted') return 'booted';
  if (state === 'Shutdown') return 'shutdown';
  return 'unknown';
};

export class SimctlBackend {
  constructor(
    private readonly exec: ExecFn,
    private readonly headless: boolean,
  ) {}

  private async simctl(args: string[], opts?: { timeoutMs?: number }) {
    return this.exec('xcrun', ['simctl', ...args], opts);
  }

  async list(): Promise<Device[]> {
    const result = await this.simctl(['list', 'devices', '--json']);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl list failed: ${result.stderr.trim()}`,
        'Run the doctor tool to check the iOS toolchain.',
      );
    }
    return parseSimctlList(result.stdout);
  }

  async boot(udid: string, timeoutSeconds: number): Promise<void> {
    const boot = await this.simctl(['boot', udid]);
    if (boot.exitCode !== 0 && !/current state: Booted/i.test(boot.stderr)) {
      if (/Invalid device|device not found/i.test(boot.stderr)) {
        throw new ToolError(
          'DEVICE_NOT_FOUND',
          `No simulator with UDID ${udid}.`,
          'Call list_devices for valid ids.',
        );
      }
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl boot failed: ${boot.stderr.trim()}`,
        'Check the simulator runtime is installed (Xcode > Settings > Components).',
      );
    }
    const status = await this.simctl(['bootstatus', udid, '-b'], {
      timeoutMs: timeoutSeconds * 1000,
    });
    if (status.timedOut) {
      throw new ToolError(
        'BOOT_TIMEOUT',
        `Simulator did not finish booting within ${timeoutSeconds}s.`,
        'Retry with a larger timeoutSeconds, or check the doctor tool.',
      );
    }
    if (!this.headless) {
      await this.exec('open', ['-a', 'Simulator']);
    }
  }

  async shutdown(udid: string): Promise<void> {
    const result = await this.simctl(['shutdown', udid]);
    if (result.exitCode !== 0 && !/current state: Shutdown/i.test(result.stderr)) {
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl shutdown failed: ${result.stderr.trim()}`,
        'Call list_devices to check the device state.',
      );
    }
  }

  async readBundleId(appPath: string): Promise<string> {
    const result = await this.exec('plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      `${appPath}/Info.plist`,
    ]);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'INSTALL_FAILED',
        `Could not read CFBundleIdentifier from ${appPath}/Info.plist.`,
        'Check the .app bundle is complete (built for simulator).',
      );
    }
    return result.stdout.trim();
  }

  async install(udid: string, appPath: string): Promise<string> {
    if (!existsSync(appPath)) {
      throw new ToolError(
        'ARTIFACT_NOT_FOUND',
        `No file at ${appPath}.`,
        'Pass the path to a built .app bundle (see get_build_status artifactPath).',
      );
    }
    const appId = await this.readBundleId(appPath);
    const result = await this.simctl(['install', udid, appPath], { timeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      throw new ToolError(
        'INSTALL_FAILED',
        `simctl install failed: ${result.stderr.trim()}`,
        'Confirm the device is booted and the app targets the simulator architecture.',
        { stderr: result.stderr.trim() },
      );
    }
    return appId;
  }

  async uninstall(udid: string, appId: string): Promise<void> {
    const result = await this.simctl(['uninstall', udid, appId]);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl uninstall failed: ${result.stderr.trim()}`,
        'Check the appId with launch_app or the build output.',
      );
    }
  }

  async launch(udid: string, appId: string): Promise<number | undefined> {
    const result = await this.simctl(['launch', udid, appId]);
    if (result.exitCode !== 0) {
      if (/not installed|unknown bundle/i.test(result.stderr)) {
        throw new ToolError(
          'APP_NOT_INSTALLED',
          `${appId} is not installed on this simulator.`,
          'Call install_app first.',
        );
      }
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl launch failed: ${result.stderr.trim()}`,
        'Check the device is booted (list_devices).',
      );
    }
    // stdout: "com.example.app: 12345"
    const pid = /:\s*(\d+)\s*$/.exec(result.stdout.trim())?.[1];
    return pid ? Number.parseInt(pid, 10) : undefined;
  }

  async terminate(udid: string, appId: string): Promise<boolean> {
    const result = await this.simctl(['terminate', udid, appId]);
    if (result.exitCode !== 0) {
      if (/found nothing to terminate|is not running/i.test(result.stderr)) return false;
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl terminate failed: ${result.stderr.trim()}`,
        'Check the appId and device state.',
      );
    }
    return true;
  }

  async openUrl(udid: string, url: string): Promise<void> {
    const result = await this.simctl(['openurl', udid, url]);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl openurl failed: ${result.stderr.trim()}`,
        'Check the device is booted and the URL scheme is registered.',
      );
    }
  }

  async screenshot(udid: string, outPath: string): Promise<void> {
    const result = await this.simctl(['io', udid, 'screenshot', outPath]);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'SCREENSHOT_FAILED',
        `simctl screenshot failed: ${result.stderr.trim()}`,
        'Check the device is booted (list_devices), then retry.',
      );
    }
  }

  async setStatusBarDemo(udid: string, enabled: boolean, time: string): Promise<void> {
    const args = enabled
      ? [
          'status_bar',
          udid,
          'override',
          '--time',
          time,
          '--batteryState',
          'charged',
          '--batteryLevel',
          '100',
          '--cellularBars',
          '4',
          '--operatorName',
          '',
        ]
      : ['status_bar', udid, 'clear'];
    const result = await this.simctl(args);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'COMMAND_FAILED',
        `simctl status_bar failed: ${result.stderr.trim()}`,
        'Check the device is booted.',
      );
    }
  }
}

export function parseSimctlList(json: string): Device[] {
  let parsed: SimctlListOutput;
  try {
    parsed = JSON.parse(json) as SimctlListOutput;
  } catch {
    throw new ToolError(
      'COMMAND_FAILED',
      'Could not parse simctl JSON output.',
      'Run the doctor tool to check the iOS toolchain.',
    );
  }
  const devices: Device[] = [];
  for (const [runtimeKey, list] of Object.entries(parsed.devices ?? {})) {
    if (!Array.isArray(list)) continue;
    // spec 010: watchOS/tvOS/visionOS targets are out of scope — iOS runtimes only
    if (!/SimRuntime\.iOS-/.test(runtimeKey)) continue;
    const osVersion = runtimeToOsVersion(runtimeKey);
    for (const d of list) {
      if (d.isAvailable === false) continue;
      devices.push({
        id: d.udid,
        name: d.name,
        platform: 'ios',
        kind: 'simulator',
        state: mapState(d.state),
        osVersion,
      });
    }
  }
  return devices;
}
