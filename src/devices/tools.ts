// spec: 011/012/013 — unified device tools
import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { hasAnyDevicePlatform } from '../env/capabilities.js';
import { ToolError } from '../shared/errors.js';
import { ok } from '../shared/result.js';
import { defineTool } from '../tools/registry.js';
import { deviceSchema } from './types.js';

const deviceIdInput = z
  .string()
  .describe('Device id from list_devices (simctl UDID, adb serial, or avd:<name>)');

const MAX_INLINE_IMAGE_BYTES = 800 * 1024;
let screenshotSeq = 0;

export const listDevicesTool = defineTool({
  name: 'list_devices',
  title: 'List devices',
  description:
    'List iOS simulators and Android emulators/devices in a unified format. By default shows booted devices plus the newest-OS variant per device family; pass filter "all" for everything.',
  spec: '011',
  gate: hasAnyDevicePlatform,
  annotations: { readOnlyHint: true },
  inputSchema: {
    platform: z.enum(['ios', 'android']).optional().describe('Only list one platform'),
    state: z.enum(['booted', 'shutdown']).optional().describe('Only list devices in this state'),
    filter: z
      .enum(['default', 'all'])
      .optional()
      .describe('"all" disables the newest-OS-per-family collapsing'),
  },
  outputSchema: {
    devices: z.array(deviceSchema),
    totalCount: z.number(),
    shown: z.number(),
  },
  handler: async (args, ctx) => {
    const result = await ctx.devices.list(args);
    const booted = result.devices.filter((d) => d.state === 'booted');
    const summary =
      booted.length > 0
        ? `${booted.length} booted: ${booted.map((d) => `${d.name} (${d.platform} ${d.osVersion})`).join(', ')}`
        : 'No booted devices';
    const more =
      result.totalCount > result.shown
        ? ` · ${result.totalCount - result.shown} more available (filter:'all' to list)`
        : ` · ${Math.max(0, result.shown - booted.length)} more available`;
    return ok(`${summary}${more}`, { ...result });
  },
});

export const bootDeviceTool = defineTool({
  name: 'boot_device',
  title: 'Boot device',
  description:
    'Boot a simulator/emulator by id and wait until it is usable. No-op if already booted. For cold Android AVDs use the avd:<name> id from list_devices.',
  spec: '011',
  gate: hasAnyDevicePlatform,
  annotations: { idempotentHint: true },
  inputSchema: {
    deviceId: deviceIdInput,
    timeoutSeconds: z
      .number()
      .int()
      .min(10)
      .max(600)
      .optional()
      .describe('Max seconds to wait for boot (default 120)'),
  },
  outputSchema: { device: deviceSchema },
  handler: async (args, ctx) => {
    const timeout = args.timeoutSeconds ?? 120;
    const startedAt = Date.now();
    let device = await ctx.devices.getDevice(args.deviceId);
    if (device.state === 'booted') {
      return ok(`${device.name} is already booted`, { device });
    }
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().boot(args.deviceId, timeout);
      device = await ctx.devices.getDevice(args.deviceId);
    } else {
      device = await ctx.devices.android().boot(args.deviceId, timeout);
    }
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    return ok(`Booted ${device.name} (${device.id}) in ${seconds}s`, { device });
  },
});

export const shutdownDeviceTool = defineTool({
  name: 'shutdown_device',
  title: 'Shutdown device',
  description: 'Shut down a running simulator/emulator.',
  spec: '011',
  gate: hasAnyDevicePlatform,
  annotations: { idempotentHint: true },
  inputSchema: { deviceId: deviceIdInput },
  outputSchema: { deviceId: z.string(), state: z.literal('shutdown') },
  handler: async (args, ctx) => {
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().shutdown(args.deviceId);
    } else {
      await ctx.devices.android().shutdown(args.deviceId);
    }
    return ok(`Shut down ${args.deviceId}`, { deviceId: args.deviceId, state: 'shutdown' });
  },
});

export const installAppTool = defineTool({
  name: 'install_app',
  title: 'Install app',
  description:
    'Install a built app artifact on a booted device: a .app bundle (iOS simulator) or .apk (Android). Returns the app id for launch_app.',
  spec: '012',
  gate: hasAnyDevicePlatform,
  inputSchema: {
    deviceId: deviceIdInput,
    appPath: z.string().describe('Path to the .app bundle (iOS) or .apk (Android)'),
  },
  outputSchema: {
    appId: z.string().describe('Bundle id / package name (may be empty if undetectable)'),
  },
  handler: async (args, ctx) => {
    const route = ctx.devices.routeOf(args.deviceId);
    const lower = args.appPath.toLowerCase();
    if (route === 'ios' && lower.endsWith('.apk')) {
      throw new ToolError(
        'ARTIFACT_PLATFORM_MISMATCH',
        'An .apk cannot be installed on an iOS simulator.',
        'Pass an iOS .app bundle, or target an Android device.',
      );
    }
    if (route === 'android' && (lower.endsWith('.app') || lower.endsWith('.ipa'))) {
      throw new ToolError(
        'ARTIFACT_PLATFORM_MISMATCH',
        'An iOS bundle cannot be installed on an Android device.',
        'Pass an .apk, or target an iOS simulator.',
      );
    }
    await ctx.devices.getBootedDevice(args.deviceId);
    const appId =
      route === 'ios'
        ? await ctx.devices.ios().install(args.deviceId, args.appPath)
        : await ctx.devices.android().install(args.deviceId, args.appPath);
    return ok(`Installed ${appId || args.appPath} on ${args.deviceId}`, { appId });
  },
});

export const uninstallAppTool = defineTool({
  name: 'uninstall_app',
  title: 'Uninstall app',
  description: 'Uninstall an app from a device. Destructive: removes the app and its data.',
  spec: '012',
  gate: hasAnyDevicePlatform,
  annotations: { destructiveHint: true },
  inputSchema: {
    deviceId: deviceIdInput,
    appId: z.string().describe('Bundle id (iOS) or package name (Android)'),
  },
  outputSchema: { appId: z.string(), removed: z.boolean() },
  handler: async (args, ctx) => {
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().uninstall(args.deviceId, args.appId);
    } else {
      await ctx.devices.android().uninstall(args.deviceId, args.appId);
    }
    return ok(`Uninstalled ${args.appId}`, { appId: args.appId, removed: true });
  },
});

export const launchAppTool = defineTool({
  name: 'launch_app',
  title: 'Launch app',
  description: 'Launch an installed app on a booted device by bundle id / package name.',
  spec: '012',
  gate: hasAnyDevicePlatform,
  inputSchema: {
    deviceId: deviceIdInput,
    appId: z.string().describe('Bundle id (iOS) or package name (Android)'),
  },
  outputSchema: { pid: z.number().optional().describe('Process id (iOS only)') },
  handler: async (args, ctx) => {
    await ctx.devices.getBootedDevice(args.deviceId);
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      const pid = await ctx.devices.ios().launch(args.deviceId, args.appId);
      return ok(`Launched ${args.appId}${pid ? ` (pid ${pid})` : ''}`, pid ? { pid } : {});
    }
    await ctx.devices.android().launch(args.deviceId, args.appId);
    return ok(`Launched ${args.appId}`, {});
  },
});

export const terminateAppTool = defineTool({
  name: 'terminate_app',
  title: 'Terminate app',
  description: 'Stop a running app. Succeeds (terminated: false) if the app was not running.',
  spec: '012',
  gate: hasAnyDevicePlatform,
  annotations: { idempotentHint: true },
  inputSchema: {
    deviceId: deviceIdInput,
    appId: z.string().describe('Bundle id (iOS) or package name (Android)'),
  },
  outputSchema: { terminated: z.boolean() },
  handler: async (args, ctx) => {
    const terminated =
      ctx.devices.routeOf(args.deviceId) === 'ios'
        ? await ctx.devices.ios().terminate(args.deviceId, args.appId)
        : await ctx.devices.android().terminate(args.deviceId, args.appId);
    return ok(terminated ? `Terminated ${args.appId}` : `${args.appId} was not running`, {
      terminated,
    });
  },
});

export const openUrlTool = defineTool({
  name: 'open_url',
  title: 'Open URL / deep link',
  description:
    'Open a URL on the device: custom schemes (myapp://...), universal links, or exp:// links. The primary way to drive app navigation from outside the app.',
  spec: '012',
  gate: hasAnyDevicePlatform,
  inputSchema: {
    deviceId: deviceIdInput,
    url: z.string().describe('The URL or deep link to open'),
  },
  outputSchema: { opened: z.boolean() },
  handler: async (args, ctx) => {
    await ctx.devices.getBootedDevice(args.deviceId);
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().openUrl(args.deviceId, args.url);
    } else {
      await ctx.devices.android().openUrl(args.deviceId, args.url);
    }
    return ok(`Opened ${args.url}`, { opened: true });
  },
});

export const takeScreenshotTool = defineTool({
  name: 'take_screenshot',
  title: 'Take screenshot',
  description:
    'Capture a screenshot of a booted device. Returns the PNG path and (by default) the image itself for visual verification.',
  spec: '013',
  gate: hasAnyDevicePlatform,
  annotations: { readOnlyHint: true },
  inputSchema: {
    deviceId: deviceIdInput,
    returnImage: z
      .boolean()
      .optional()
      .describe('Include the image in the response (default true)'),
  },
  outputSchema: { path: z.string(), format: z.literal('png') },
  handler: async (args, ctx) => {
    await ctx.devices.getBootedDevice(args.deviceId);
    const dir = join(tmpdir(), 'react-native-dev-mcp', 'screenshots');
    await mkdir(dir, { recursive: true });
    screenshotSeq += 1;
    const safeId = args.deviceId.replaceAll(/[^\w.-]/g, '_');
    const path = join(dir, `${safeId}-${screenshotSeq}-${Date.now()}.png`);
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().screenshot(args.deviceId, path);
    } else {
      await ctx.devices.android().screenshot(args.deviceId, path);
    }
    const size = statSync(path).size;
    const wantImage = args.returnImage !== false && size <= MAX_INLINE_IMAGE_BYTES;
    const note =
      !wantImage && args.returnImage !== false
        ? ' (too large to inline — read it from the path)'
        : '';
    const extra = wantImage
      ? [
          {
            type: 'image' as const,
            data: readFileSync(path).toString('base64'),
            mimeType: 'image/png',
          },
        ]
      : undefined;
    return ok(`Screenshot saved to ${path}${note}`, { path, format: 'png' }, extra);
  },
});

export const setStatusBarDemoTool = defineTool({
  name: 'set_status_bar_demo',
  title: 'Status bar demo mode',
  description:
    'Set a clean, deterministic status bar (9:41, full battery, full signal) for stable screenshots — or restore the real one with enabled: false.',
  spec: '013',
  gate: hasAnyDevicePlatform,
  annotations: { idempotentHint: true },
  inputSchema: {
    deviceId: deviceIdInput,
    enabled: z.boolean().describe('true = demo mode, false = restore real status bar'),
    time: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/)
      .optional()
      .describe('Clock to display (default "9:41")'),
  },
  outputSchema: { applied: z.boolean() },
  handler: async (args, ctx) => {
    await ctx.devices.getBootedDevice(args.deviceId);
    const time = args.time ?? '9:41';
    if (ctx.devices.routeOf(args.deviceId) === 'ios') {
      await ctx.devices.ios().setStatusBarDemo(args.deviceId, args.enabled, time);
    } else {
      await ctx.devices.android().setStatusBarDemo(args.deviceId, args.enabled, time);
    }
    return ok(args.enabled ? `Status bar demo mode on (${time})` : 'Status bar restored', {
      applied: true,
    });
  },
});

export const deviceTools = [
  listDevicesTool,
  bootDeviceTool,
  shutdownDeviceTool,
  installAppTool,
  uninstallAppTool,
  launchAppTool,
  terminateAppTool,
  openUrlTool,
  takeScreenshotTool,
  setStatusBarDemoTool,
];
