/** Small, allocation-light formatters used across list rows. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < 45_000) return 'now';
  if (delta < HOUR) return `${Math.max(1, Math.round(delta / MINUTE))}m`;
  if (delta < DAY) return `${Math.round(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.round(delta / DAY)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts: number, now = Date.now()): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const start = startOfToday.getTime();
  if (ts >= start) return 'Today';
  if (ts >= start - DAY) return 'Yesterday';
  if (ts >= start - 7 * DAY) return 'Previous 7 days';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function money(cents: number, currency = 'USD'): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: value < 10 && value % 1 !== 0 ? 2 : 0,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Run npm test" / "Write src/auth.ts" → short verb + target for list rows. */
export function splitActionTitle(title: string): { verb: string; rest: string } {
  const match = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(title.trim());
  if (!match) return { verb: '', rest: title };
  return { verb: match[1] ?? '', rest: match[2] ?? '' };
}

export function initials(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'XR';
  return trimmed.slice(0, 2).toUpperCase();
}

/** Group-hex fingerprint: "a1b2c3…" → "a1:b2:c3" pairs, 12 pairs shown. */
export function formatFingerprint(fp: string): string {
  const clean = fp.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const pairs: string[] = [];
  for (let i = 0; i < clean.length && pairs.length < 16; i += 2) {
    const pair = clean.slice(i, i + 2);
    if (pair.length === 2) pairs.push(pair);
  }
  return pairs.join(':');
}

export function uid(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}
