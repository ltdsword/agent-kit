const MIN = 60_000;

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "just now", "4 min ago", "2 h ago", "yesterday 18:20", "25 Oct" */
export function ago(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'just now';
  if (diff < 60 * MIN) return `${Math.round(diff / MIN)} min ago`;
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `${Math.floor(diff / (60 * MIN))} h ago`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${hhmm(ts)}`;
  return dayLabel(ts, now);
}

/** "4 min", "2 h" — for compact meta rows. */
export function duration(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'now';
  if (diff < 60 * MIN) return `${Math.round(diff / MIN)}m`;
  return `${Math.floor(diff / (60 * MIN))}h`;
}

/** Staleness of live data: "just now", "12 s ago", "2 min ago". */
export function sinceShort(ts: number, now: number): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  return `${Math.round(s / 60)} min ago`;
}

export function dayLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
