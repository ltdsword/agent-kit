// D1 bills rows written. Timestamp-only refreshes are skipped until the stored value is this old,
// so a busy computer or session costs at most one write per row per interval.
export const TOUCH_INTERVAL_MS = 5 * 60_000;

/** ISO timestamp TOUCH_INTERVAL_MS before `iso`; returns `iso` unchanged if it does not parse. */
export function staleBefore(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time - TOUCH_INTERVAL_MS).toISOString();
}
