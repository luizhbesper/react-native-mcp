// spec: 020 — Metro inspector discovery over /json/list
export interface RawCdpPage {
  id: string;
  title?: string;
  description?: string;
  webSocketDebuggerUrl?: string;
  appId?: string;
  reactNative?: {
    logicalDeviceId?: string;
    capabilities?: { nativePageReloads?: boolean };
  };
}

export interface RuntimeTarget {
  id: string;
  title: string;
  description: string;
  webSocketDebuggerUrl: string;
  modern: boolean;
}

/** Returns null when no Metro inspector answers on the port. */
export async function fetchRawPages(port: number, timeoutMs = 1_500): Promise<RawCdpPage[] | null> {
  try {
    const response = await fetch(`http://localhost:${port}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as RawCdpPage[]) : null;
  } catch {
    return null;
  }
}

/**
 * Map raw CDP pages to connectable targets. Modern (Fusebox, RN 0.76+) targets advertise
 * `nativePageReloads`; when any exist, stale/legacy pages are filtered out.
 */
export function selectViableTargets(pages: RawCdpPage[]): RuntimeTarget[] {
  const connectable = pages.filter((p) => typeof p.webSocketDebuggerUrl === 'string');
  const targets = connectable.map((p) => ({
    id: p.id,
    title: p.title ?? 'unknown',
    description: p.description ?? p.appId ?? '',
    webSocketDebuggerUrl: p.webSocketDebuggerUrl as string,
    modern: p.reactNative?.capabilities?.nativePageReloads === true,
  }));
  const modern = targets.filter((t) => t.modern);
  return modern.length > 0 ? modern : targets;
}
