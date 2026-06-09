// spec: 010-013 — Android backend over adb + emulator
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ToolError } from '../../shared/errors.js';
import { type ExecFn, shellQuote, spawnDetached } from '../../shared/exec.js';
import type { Device } from '../types.js';

export const AVD_ID_PREFIX = 'avd:';

interface RunningDevice {
  serial: string;
  status: string;
  model?: string;
}

export function parseAdbDevicesL(stdout: string): RunningDevice[] {
  const devices: RunningDevice[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\S+)\s+(device|offline|unauthorized|emulator)\b(.*)$/.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;
    const model = /model:(\S+)/.exec(match[3] ?? '')?.[1];
    devices.push({ serial: match[1], status: match[2], model: model?.replaceAll('_', ' ') });
  }
  return devices;
}

export class AdbBackend {
  constructor(
    private readonly exec: ExecFn,
    private readonly adbPath: string,
    private readonly emulatorPath: string | undefined,
    private readonly headless: boolean,
  ) {}

  private adb(args: string[], opts?: { timeoutMs?: number }) {
    return this.exec(this.adbPath, args, opts);
  }

  private shell(serial: string, args: string[], opts?: { timeoutMs?: number }) {
    return this.adb(['-s', serial, 'shell', ...args], opts);
  }

  private async getprop(serial: string, prop: string): Promise<string> {
    const result = await this.shell(serial, ['getprop', prop]);
    return result.exitCode === 0 ? result.stdout.trim() : '';
  }

  private async listRunning(): Promise<{ devices: Device[]; avdNames: Set<string> }> {
    const result = await this.adb(['devices', '-l']);
    if (result.exitCode !== 0) {
      throw new ToolError(
        'ANDROID_UNAVAILABLE',
        `adb devices failed: ${result.stderr.trim()}`,
        'Run the doctor tool to check the Android SDK.',
      );
    }
    const avdNames = new Set<string>();
    const devices: Device[] = [];
    for (const raw of parseAdbDevicesL(result.stdout)) {
      if (raw.status !== 'device') continue;
      const isEmulator = raw.serial.startsWith('emulator-');
      const [release, avdName] = await Promise.all([
        this.getprop(raw.serial, 'ro.build.version.release'),
        isEmulator ? this.getprop(raw.serial, 'ro.boot.qemu.avd_name') : Promise.resolve(''),
      ]);
      if (avdName) avdNames.add(avdName);
      devices.push({
        id: raw.serial,
        name: avdName ? avdName.replaceAll('_', ' ') : (raw.model ?? raw.serial),
        platform: 'android',
        kind: isEmulator ? 'emulator' : 'physical',
        state: 'booted',
        osVersion: release,
      });
    }
    return { devices, avdNames };
  }

  private async listAvds(): Promise<string[]> {
    if (!this.emulatorPath) return [];
    const result = await this.exec(this.emulatorPath, ['-list-avds']);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('INFO') && !l.includes('|'));
  }

  async list(): Promise<Device[]> {
    const { devices, avdNames } = await this.listRunning();
    const avds = await this.listAvds();
    for (const avd of avds) {
      if (avdNames.has(avd)) continue;
      devices.push({
        id: `${AVD_ID_PREFIX}${avd}`,
        name: avd.replaceAll('_', ' '),
        platform: 'android',
        kind: 'emulator',
        state: 'shutdown',
        osVersion: '',
      });
    }
    return devices;
  }

  async boot(deviceId: string, timeoutSeconds: number): Promise<Device> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    if (!deviceId.startsWith(AVD_ID_PREFIX)) {
      // a serial: idempotent if already running, otherwise it isn't bootable by serial
      const { devices } = await this.listRunning();
      const existing = devices.find((d) => d.id === deviceId);
      if (existing) return existing;
      throw new ToolError(
        'DEVICE_NOT_FOUND',
        `No running Android device with serial ${deviceId}.`,
        'Use the avd:<name> id from list_devices to boot a cold emulator.',
      );
    }

    const avdName = deviceId.slice(AVD_ID_PREFIX.length);
    if (!this.emulatorPath) {
      throw new ToolError(
        'EMULATOR_BINARY_MISSING',
        'The Android emulator binary was not found.',
        'Install the Android Emulator via SDK Manager, or set ANDROID_HOME.',
      );
    }
    const avds = await this.listAvds();
    if (!avds.includes(avdName)) {
      throw new ToolError(
        'DEVICE_NOT_FOUND',
        `No AVD named ${avdName}.`,
        'Call list_devices for valid avd:<name> ids.',
      );
    }

    const before = new Set((await this.adb(['devices'])).stdout.match(/^emulator-\d+/gm) ?? []);
    const args = [
      '-avd',
      avdName,
      ...(this.headless ? ['-no-window', '-no-audio', '-no-boot-anim'] : []),
    ];
    const child = spawnDetached(this.emulatorPath, args);
    child.unref();

    // find the new serial, then wait for full boot
    let serial: string | undefined;
    while (Date.now() < deadline) {
      await delay(2000);
      const now = (await this.adb(['devices'])).stdout.match(/^emulator-\d+/gm) ?? [];
      serial = now.find((s) => !before.has(s));
      if (serial) break;
      if (child.exitCode !== null && child.exitCode !== 0) {
        throw new ToolError(
          'COMMAND_FAILED',
          `Emulator exited with code ${child.exitCode}.`,
          'Run the emulator manually to see the error, or try another AVD.',
        );
      }
    }
    if (!serial) {
      throw new ToolError(
        'BOOT_TIMEOUT',
        `Emulator for ${avdName} did not appear on adb within ${timeoutSeconds}s.`,
        'Retry with a larger timeoutSeconds.',
      );
    }

    while (Date.now() < deadline) {
      const completed = await this.getprop(serial, 'sys.boot_completed');
      if (completed === '1') {
        const release = await this.getprop(serial, 'ro.build.version.release');
        return {
          id: serial,
          name: avdName.replaceAll('_', ' '),
          platform: 'android',
          kind: 'emulator',
          state: 'booted',
          osVersion: release,
        };
      }
      await delay(2000);
    }
    throw new ToolError(
      'BOOT_TIMEOUT',
      `Emulator ${serial} did not finish booting within ${timeoutSeconds}s.`,
      'Retry with a larger timeoutSeconds.',
    );
  }

  async shutdown(serial: string): Promise<void> {
    if (serial.startsWith(AVD_ID_PREFIX)) return; // already shut down
    const result = await this.adb(['-s', serial, 'emu', 'kill']);
    if (result.exitCode !== 0) {
      // physical devices can't be shut down; treat unknown serials as not found
      const list = await this.adb(['devices']);
      if (!list.stdout.includes(serial)) {
        throw new ToolError(
          'DEVICE_NOT_FOUND',
          `No device with serial ${serial}.`,
          'Call list_devices.',
        );
      }
      throw new ToolError(
        'COMMAND_FAILED',
        `Could not stop ${serial}: ${result.stderr.trim()}`,
        'Physical devices cannot be shut down via adb.',
      );
    }
  }

  /** Locate aapt/aapt2 under $SDK/build-tools/<newest>/ to read the apk package name. */
  private findAapt(): string | undefined {
    const sdk = dirname(dirname(this.adbPath)); // <sdk>/platform-tools/adb
    const buildTools = join(sdk, 'build-tools');
    if (!existsSync(buildTools)) return undefined;
    const versions = readdirSync(buildTools).sort().reverse();
    const suffix = process.platform === 'win32' ? '.exe' : '';
    for (const v of versions) {
      for (const tool of [`aapt2${suffix}`, `aapt${suffix}`]) {
        const candidate = join(buildTools, v, tool);
        if (existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }

  async readPackageName(apkPath: string): Promise<string> {
    const aapt = this.findAapt();
    if (!aapt) return '';
    const isAapt2 = aapt.includes('aapt2');
    const result = isAapt2
      ? await this.exec(aapt, ['dump', 'packagename', apkPath])
      : await this.exec(aapt, ['dump', 'badging', apkPath]);
    if (result.exitCode !== 0) return '';
    if (isAapt2) return result.stdout.trim();
    return /package: name='([^']+)'/.exec(result.stdout)?.[1] ?? '';
  }

  async install(serial: string, apkPath: string): Promise<string> {
    if (!existsSync(apkPath)) {
      throw new ToolError(
        'ARTIFACT_NOT_FOUND',
        `No file at ${apkPath}.`,
        'Pass the path to a built .apk (see get_build_status artifactPath).',
      );
    }
    const result = await this.adb(['-s', serial, 'install', '-r', apkPath], { timeoutMs: 180_000 });
    if (result.exitCode !== 0 || /Failure \[/.test(result.stdout + result.stderr)) {
      const failure = /Failure \[([^\]]+)\]/.exec(result.stdout + result.stderr)?.[1];
      throw new ToolError(
        'INSTALL_FAILED',
        `adb install failed${failure ? `: ${failure}` : ''}.`,
        failure === 'INSTALL_FAILED_UPDATE_INCOMPATIBLE'
          ? 'Uninstall the existing app first (uninstall_app), then retry.'
          : 'Check the apk targets this device ABI and the device is booted.',
        { failure },
      );
    }
    return this.readPackageName(apkPath);
  }

  async uninstall(serial: string, appId: string): Promise<void> {
    const result = await this.adb(['-s', serial, 'uninstall', appId]);
    if (result.exitCode !== 0 || /Failure/.test(result.stdout)) {
      throw new ToolError(
        'COMMAND_FAILED',
        `adb uninstall failed: ${(result.stdout + result.stderr).trim()}`,
        'Check the package name (it may not be installed).',
      );
    }
  }

  async launch(serial: string, appId: string): Promise<void> {
    const result = await this.shell(serial, [
      'monkey',
      '-p',
      appId,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
    if (result.exitCode !== 0 || /No activities found/.test(result.stdout + result.stderr)) {
      throw new ToolError(
        'APP_NOT_INSTALLED',
        `${appId} could not be launched on ${serial}.`,
        'Call install_app first, or check the package name.',
      );
    }
  }

  async terminate(serial: string, appId: string): Promise<boolean> {
    const pid = await this.shell(serial, ['pidof', appId]);
    const wasRunning = pid.stdout.trim().length > 0;
    if (wasRunning) {
      await this.shell(serial, ['am', 'force-stop', appId]);
    }
    return wasRunning;
  }

  async openUrl(serial: string, url: string): Promise<void> {
    const result = await this.shell(serial, [
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      shellQuote(url),
    ]);
    if (result.exitCode !== 0 || /Error:/.test(result.stdout + result.stderr)) {
      throw new ToolError(
        'COMMAND_FAILED',
        `am start failed: ${(result.stdout + result.stderr).trim()}`,
        'Check the URL scheme is handled by an installed app.',
      );
    }
  }

  async screenshot(serial: string, outPath: string): Promise<void> {
    const remote = '/data/local/tmp/rn-mcp-screenshot.png';
    const cap = await this.shell(serial, ['screencap', '-p', remote]);
    if (cap.exitCode !== 0) {
      throw new ToolError(
        'SCREENSHOT_FAILED',
        `screencap failed: ${cap.stderr.trim()}`,
        'Check the device is booted and unlocked.',
      );
    }
    const pull = await this.adb(['-s', serial, 'pull', remote, outPath]);
    await this.shell(serial, ['rm', '-f', remote]);
    if (pull.exitCode !== 0) {
      throw new ToolError(
        'SCREENSHOT_FAILED',
        `adb pull failed: ${pull.stderr.trim()}`,
        'Retry; check disk space.',
      );
    }
  }

  async setStatusBarDemo(serial: string, enabled: boolean, time: string): Promise<void> {
    if (enabled) {
      await this.shell(serial, ['settings', 'put', 'global', 'sysui_demo_allowed', '1']);
      const hhmm = time.replace(':', '').padStart(4, '0');
      const broadcasts: string[][] = [
        ['-e', 'command', 'enter'],
        ['-e', 'command', 'clock', '-e', 'hhmm', hhmm],
        ['-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false'],
        ['-e', 'command', 'network', '-e', 'wifi', 'show', '-e', 'level', '4'],
        ['-e', 'command', 'notifications', '-e', 'visible', 'false'],
      ];
      for (const extra of broadcasts) {
        await this.shell(serial, ['am', 'broadcast', '-a', 'com.android.systemui.demo', ...extra]);
      }
    } else {
      await this.shell(serial, [
        'am',
        'broadcast',
        '-a',
        'com.android.systemui.demo',
        '-e',
        'command',
        'exit',
      ]);
    }
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
