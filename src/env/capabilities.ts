// spec: 001/002 — the Capabilities object is the single source of truth for tool gating
export interface Problem {
  code: string;
  fix: string;
}

export interface IosCapability {
  available: boolean;
  simctl: boolean;
  xcodeVersion?: string;
  cocoapods?: string;
}

export interface AndroidCapability {
  available: boolean;
  adbVersion?: string;
  adbPath?: string;
  emulatorPath?: string;
  javaVersion?: string;
}

export interface ProjectInfo {
  found: boolean;
  root?: string;
  kind?: 'expo' | 'bare';
  rnVersion?: string;
  expoSdk?: string;
}

export interface Capabilities {
  host: { os: NodeJS.Platform; arch: string; node: string };
  ios: IosCapability;
  android: AndroidCapability;
  project: ProjectInfo;
  problems: Problem[];
}

export const hasAnyDevicePlatform = (caps: Capabilities): boolean =>
  caps.ios.available || caps.android.available;

export const hasIos = (caps: Capabilities): boolean => caps.ios.available;
export const hasAndroid = (caps: Capabilities): boolean => caps.android.available;
export const isDarwin = (caps: Capabilities): boolean => caps.host.os === 'darwin';
