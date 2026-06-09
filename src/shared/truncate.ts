// spec: 000 — token-budget helpers
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}…[+${formatBytes(omitted)}]`;
}

export function tailLines(text: string, count: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} chars`;
  return `${(n / 1024).toFixed(1)}KB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec ? `${min}m${sec}s` : `${min}m`;
}
