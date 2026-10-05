/*
 * Brain — display formatting (Phase 9). All mono-numeric, developer-tool
 * style: `1.2s`, `42ms`, `2:14.7`, `1.2k tok`, `$0.083`.
 */

/** Compact duration: `42ms`, `1.2s`, `2:14`, `1:02:03`. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m < 60) return `${m}:${String(sec).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Live clock with tenths while running: `2:14.7`. */
export function fmtClock(ms: number): string {
  const tenths = Math.floor((ms % 1000) / 100);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}.${tenths}`;
}

/** Token counts: `847`, `1.2k`, `3.4M`. */
export function fmtTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Cost: `$0.083`, `$1.24`, `$12.40` (3 decimals under a cent). */
export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return '$0.000';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** "2m ago" style, relative to `now`. */
export function fmtRelative(ts: number, now: number): string {
  const d = Math.max(0, now - ts);
  if (d < 15_000) return 'just now';
  if (d < 60_000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

/** Absolute HH:MM:SS local. */
export function fmtClockTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false });
}

/** Pick nice axis ticks for a duration: 0, 500ms, 1s, 5s, … */
export function timeTicks(totalMs: number): { at: number; label: string }[] {
  if (totalMs <= 0) return [{ at: 0, label: '0' }];
  const target = 6;
  const raw = totalMs / target;
  const steps = [
    1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000,
  ];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (s >= raw) {
      step = s;
      break;
    }
  }
  const ticks: { at: number; label: string }[] = [];
  for (let t = 0; t <= totalMs + step / 2; t += step) {
    ticks.push({ at: t, label: t === 0 ? '0' : fmtDuration(t) });
  }
  return ticks;
}
