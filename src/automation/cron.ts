/**
 * XR — cron scheduler with natural-language parsing.
 * "Run the security audit every Monday at 9am" → a schedule, no cron syntax.
 * The due-check engine is pure & deterministic (testable without timers).
 * Scheduled tasks still run through the full agent (budget + approval + audit).
 */

export interface Schedule {
  id: string;
  task: string;
  /** "daily" | "weekly" | "hourly" | "interval". */
  kind: "daily" | "weekly" | "hourly" | "interval";
  /** hour 0-23 (daily/weekly). */
  hour?: number;
  minute?: number;
  /** 0=Sun..6=Sat (weekly). */
  weekday?: number;
  /** minutes (interval). */
  everyMinutes?: number;
  enabled: boolean;
  lastRun?: number;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Parse a natural-language schedule like "every monday at 9am: run audit". */
export function parseSchedule(text: string, id: string): Schedule | null {
  const lower = text.toLowerCase();
  // Split off the task after a colon, or after the schedule clause.
  let task = text;
  const colon = text.indexOf(":");
  if (colon !== -1) task = text.slice(colon + 1).trim();

  const time = parseTime(lower);

  // interval: "every 30 minutes" / "every 2 hours"
  const interval = lower.match(/every\s+(\d+)\s*(min(?:ute)?s?|hours?)/);
  if (interval) {
    const n = Number(interval[1]);
    const mins = /hour/.test(interval[2]) ? n * 60 : n;
    return base(id, task, { kind: "interval", everyMinutes: mins });
  }

  // weekly: "every monday"
  for (let d = 0; d < DAYS.length; d++) {
    if (lower.includes(DAYS[d]) || lower.includes(DAYS[d].slice(0, 3))) {
      return base(id, task, { kind: "weekly", weekday: d, hour: time.hour, minute: time.minute });
    }
  }

  // daily: "every day" / "daily" / a bare time
  if (/\b(daily|every day|each day)\b/.test(lower) || time.explicit) {
    return base(id, task, { kind: "daily", hour: time.hour, minute: time.minute });
  }

  // hourly
  if (/\bhourly|every hour\b/.test(lower)) {
    return base(id, task, { kind: "hourly", minute: time.minute });
  }

  return null;
}

function base(id: string, task: string, partial: Partial<Schedule>): Schedule {
  return { id, task, enabled: true, kind: "daily", hour: 9, minute: 0, ...partial } as Schedule;
}

function parseTime(s: string): { hour: number; minute: number; explicit: boolean } {
  // "9am", "9:30pm", "14:00"
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return { hour: 9, minute: 0, explicit: false };
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  // Only treat as explicit if it looked like a time (had am/pm or a colon).
  const explicit = Boolean(ap || m[2]);
  return { hour: hour % 24, minute: minute % 60, explicit };
}

/** Is a schedule due at the given Date? Deterministic — used by the loop & tests. */
export function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false;
  const nowMs = now.getTime();

  if (s.kind === "interval") {
    if (!s.lastRun) return true;
    return nowMs - s.lastRun >= (s.everyMinutes ?? 60) * 60_000;
  }
  if (s.kind === "hourly") {
    if (now.getMinutes() !== (s.minute ?? 0)) return false;
    return !ranThisMinute(s, now);
  }
  // daily / weekly: match hour+minute (+weekday), once per occurrence.
  if (now.getHours() !== (s.hour ?? 0) || now.getMinutes() !== (s.minute ?? 0)) return false;
  if (s.kind === "weekly" && now.getDay() !== (s.weekday ?? 0)) return false;
  return !ranThisMinute(s, now);
}

function ranThisMinute(s: Schedule, now: Date): boolean {
  if (!s.lastRun) return false;
  return Math.floor(s.lastRun / 60_000) === Math.floor(now.getTime() / 60_000);
}

export function describe(s: Schedule): string {
  const t = `${String(s.hour ?? 0).padStart(2, "0")}:${String(s.minute ?? 0).padStart(2, "0")}`;
  switch (s.kind) {
    case "interval":
      return `every ${s.everyMinutes}m`;
    case "hourly":
      return `hourly at :${String(s.minute ?? 0).padStart(2, "0")}`;
    case "weekly":
      return `every ${DAYS[s.weekday ?? 0]} at ${t}`;
    default:
      return `daily at ${t}`;
  }
}
