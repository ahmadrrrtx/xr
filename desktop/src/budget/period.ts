/*
 * Budget periods without a date library. Everything is integer day math on
 * top of a local-time offset the webview supplies (`tzOffsetMin`, the value of
 * `new Date().getTimezoneOffset()`), so the Rust governor (no chrono) and the
 * browser fallback compute the same boundaries. Civil-date conversion is
 * Howard Hinnant's algorithm — mirrored in src-tauri/src/budget/governor.rs.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Days since 1970-01-01 for a proleptic Gregorian date. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** Inverse of daysFromCivil. */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719_468;
  const era = Math.floor(zz / 146_097);
  const doe = zz - era * 146_097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36_524) -
      Math.floor(doe / 146_096)) /
      365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

/** Local day index (days since epoch in the user's zone). */
export function localDayIndex(ts: number, tzOffsetMin: number): number {
  return Math.floor((ts - tzOffsetMin * 60_000) / DAY_MS);
}

/** Start of the local day that contains `ts`, as a UTC timestamp. */
export function localDayStart(ts: number, tzOffsetMin: number): number {
  return localDayIndex(ts, tzOffsetMin) * DAY_MS + tzOffsetMin * 60_000;
}

export function dayIndexToTs(day: number, tzOffsetMin: number): number {
  return day * DAY_MS + tzOffsetMin * 60_000;
}

export interface Period {
  start: number;
  /** First instant of the next period. */
  end: number;
  /** Whole days left including today. */
  daysUntilReset: number;
  /** Days elapsed including today (≥ 1). */
  daysElapsed: number;
  /** "2026-10-31": the last local day of the period. */
  resetDate: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * The budget period that contains `now`: from `monthStartDay` (1–28) at local
 * midnight to the same day next month. `resetAt` (a manual reset) moves the
 * start forward when it is later than the calendar start.
 */
export function periodFor(
  now: number,
  tzOffsetMin: number,
  monthStartDay: number,
  resetAt: number | null = null
): Period {
  const startDay = Math.min(28, Math.max(1, Math.floor(monthStartDay) || 1));
  const today = localDayIndex(now, tzOffsetMin);
  const { y, m, d } = civilFromDays(today);
  let sy = y;
  let sm = m;
  if (d < startDay) {
    sm -= 1;
    if (sm === 0) {
      sm = 12;
      sy -= 1;
    }
  }
  let ey = sy;
  let em = sm + 1;
  if (em === 13) {
    em = 1;
    ey += 1;
  }
  const startIdx = daysFromCivil(sy, sm, startDay);
  const endIdx = daysFromCivil(ey, em, startDay);
  let start = dayIndexToTs(startIdx, tzOffsetMin);
  if (resetAt !== null && resetAt > start && resetAt <= now) start = resetAt;
  const end = dayIndexToTs(endIdx, tzOffsetMin);
  const last = civilFromDays(endIdx - 1);
  const daysUntilReset = Math.max(1, endIdx - today);
  const daysElapsed = Math.max(
    1,
    today - localDayIndex(start, tzOffsetMin) + 1
  );
  return {
    start,
    end,
    daysUntilReset,
    daysElapsed,
    resetDate: isoDate(last.y, last.m, last.d),
  };
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Oct 31" from "2026-10-31". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d ?? 1}`;
}

/** "Oct 3" for a timestamp in the user's zone. */
export function shortDayLabel(ts: number, tzOffsetMin: number): string {
  const { m, d } = civilFromDays(localDayIndex(ts, tzOffsetMin));
  return `${MONTHS[m - 1]} ${d}`;
}
