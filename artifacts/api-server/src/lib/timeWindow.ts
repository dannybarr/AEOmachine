/**
 * Shared UTC calendar-window helper.
 *
 * All windowed metrics (dashboard aggregates, company summaries, methodology,
 * research queries) must use the exact same window so they reconcile:
 * the window covers the last `days` UTC calendar days INCLUDING today
 * (partial), i.e. [nextUtcMidnight - days, nextUtcMidnight).
 */
export function utcWindowStart(days: number, now: Date = new Date()): Date {
  const endMs =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
    86_400_000;
  return new Date(endMs - days * 86_400_000);
}
