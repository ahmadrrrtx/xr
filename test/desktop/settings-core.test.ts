/**
 * Phase 8 · settings primitives (desktop/src/lib/shortcuts.ts +
 * desktop/src/lib/notificationPolicy.ts).
 *
 * Pure logic only — persistence, keychain, recorder focus and OS
 * registration are covered by the Rust unit tests (commands/settings.rs)
 * and the Playwright pass. Includes the negative branches, per house rule:
 * a gate that cannot fail is decoration.
 */
import { describe, expect, test } from "bun:test";

import {
  SHORTCUTS,
  effectiveCombo,
  eventToCombo,
  findConflicts,
  formatChord,
  formatTauriChord,
  inAppHotkeys,
  shortcutById,
  toTauriChord,
} from "../../desktop/src/lib/shortcuts.ts";
import {
  canNotify,
  inQuietHours,
  notificationKindFor,
  shouldOsNotify,
  shouldSound,
  toastDurationMs,
} from "../../desktop/src/lib/notificationPolicy.ts";
import type { XRSettings } from "../../desktop/src/stores/settingsStore";

/* ── fixtures ──────────────────────────────────────────────────────── */

const noon = (h: number, m = 0): Date => new Date(2026, 9, 15, h, m, 0);

/** Minimal settings object exercising only the fields the policy reads. */
function settings(patch: {
  enabled?: boolean;
  events?: Record<string, boolean>;
  quiet?: { enabled: boolean; from: string; to: string };
  osEnabled?: boolean;
  sounds?: boolean;
  style?: XRSettings["notifications"]["style"];
  muted?: boolean;
}): XRSettings {
  return {
    notifications: {
      enabled: patch.enabled ?? true,
      events: patch.events ?? {},
      quietHours: patch.quiet ?? { enabled: false, from: "22:00", to: "07:00" },
      osEnabled: patch.osEnabled ?? true,
      sounds: patch.sounds ?? true,
      style: patch.style ?? "banner",
    },
    voice: { muted: patch.muted ?? false },
  } as unknown as XRSettings;
}

/* ── shortcuts ─────────────────────────────────────────────────────── */

describe("Phase 8 · shortcut registry", () => {
  test("harvests 11 shortcuts with unique ids (9 from Phases 1–7 + Control Room + Theater)", () => {
    expect(SHORTCUTS).toHaveLength(11);
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(11);
    expect(shortcutById("control-room")?.combo).toBe("alt+mod+r");
    expect(shortcutById("theater")?.combo).toBe("alt+mod+v");
  });

  test("exactly the four Rust-owned rows are global, each with an owner", () => {
    const globals = SHORTCUTS.filter((s) => s.scope === "global");
    expect(globals.map((s) => s.id).sort()).toEqual(["hud", "orb", "ptt", "theater"]);
    for (const g of globals) expect(g.global).toBeTruthy();
    for (const app of SHORTCUTS.filter((s) => s.scope !== "global")) {
      expect(app.global).toBeUndefined();
    }
  });

  test("shortcutById hits and misses", () => {
    expect(shortcutById("focus-composer")?.combo).toBe("mod+l");
    expect(shortcutById("nope")).toBeUndefined();
  });

  test("effectiveCombo: override wins, default fills, unknown is empty", () => {
    expect(effectiveCombo("palette", { palette: "mod+shift+p" })).toBe("mod+shift+p");
    expect(effectiveCombo("palette", {})).toBe("mod+k");
    expect(effectiveCombo("nope", {})).toBe("");
  });

  test("inAppHotkeys excludes globals and applies overrides", () => {
    const rows = inAppHotkeys({ palette: "mod+shift+p" });
    expect(rows.map((r) => r.id)).not.toContain("hud");
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.id === "palette")?.combo).toBe("mod+shift+p");
  });
});

describe("Phase 8 · chord formatting", () => {
  test("formatChord renders mac glyphs and windows names", () => {
    expect(formatChord("mod+shift+t", "macos")).toBe("⌘⇧T");
    expect(formatChord("mod+shift+t", "windows")).toBe("Ctrl+Shift+T");
    expect(formatChord("mod+,", "macos")).toBe("⌘,");
    expect(formatChord("mod+space", "macos")).toBe("⌘Space");
    expect(formatChord("alt+mod+o", "windows")).toBe("Ctrl+Alt+O");
  });

  test("toTauriChord emits Shortcut::from_str format per platform", () => {
    expect(toTauriChord("mod+shift+o", "macos")).toBe("Cmd+Shift+O");
    expect(toTauriChord("mod+shift+o", "windows")).toBe("Ctrl+Shift+O");
    expect(toTauriChord("mod+space", "macos")).toBe("Cmd+Space");
    expect(toTauriChord("mod+.", "linux")).toBe("Ctrl+.");
  });

  test("windows renders Ctrl first regardless of combo string order", () => {
    expect(formatChord("alt+mod+o", "windows")).toBe("Ctrl+Alt+O");
    expect(toTauriChord("alt+mod+o", "windows")).toBe("Ctrl+Alt+O");
    // mac glyph order follows the registry string (⌥⌘O per the spec).
    expect(formatChord("alt+mod+o", "macos")).toBe("⌥⌘O");
    expect(toTauriChord("alt+mod+o", "macos")).toBe("Alt+Cmd+O");
  });

  test("formatTauriChord renders what Rust reports back", () => {
    expect(formatTauriChord("Cmd+Space", "macos")).toBe("⌘Space");
    expect(formatTauriChord("CommandOrControl+Space", "windows")).toBe("Ctrl+Space");
  });
});

describe("Phase 8 · recorder capture", () => {
  const ev = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }>) => ({
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  });

  test("meta and ctrl both normalize to mod (mac / non-mac)", () => {
    expect(eventToCombo(ev("k", { meta: true }))).toBe("mod+k");
    expect(eventToCombo(ev("k", { ctrl: true }))).toBe("mod+k");
  });

  test("pure modifiers and bare keys are refused", () => {
    expect(eventToCombo(ev("Shift", { shift: true }))).toBeNull();
    expect(eventToCombo(ev("Meta", { meta: true }))).toBeNull();
    expect(eventToCombo(ev("a", {}))).toBeNull();
  });

  test("multi-char churn (F-row, arrows) is refused, space is kept", () => {
    expect(eventToCombo(ev("F5", { meta: true }))).toBeNull();
    expect(eventToCombo(ev("ArrowLeft", { meta: true }))).toBeNull();
    expect(eventToCombo(ev(" ", { meta: true }))).toBe("mod+space");
  });

  test("modifier order is canonical regardless of press order", () => {
    expect(eventToCombo(ev("x", { ctrl: true, shift: true, alt: true }))).toBe(
      "mod+alt+shift+x"
    );
  });
});

describe("Phase 8 · conflict detection", () => {
  test("a fresh default combo conflicts with nothing", () => {
    expect(findConflicts("mod+k", "palette", {})).toEqual([]);
  });

  test("an override that steals another row's combo is flagged", () => {
    const overrides = { sidebar: "mod+k" };
    const conflicts = findConflicts("mod+k", "palette", overrides);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ id: "sidebar", label: "Toggle sidebar" });
  });

  test("the recording row never conflicts with itself", () => {
    expect(findConflicts("mod+k", "palette", { palette: "mod+k" })).toEqual([]);
  });
});

/* ── notification policy ───────────────────────────────────────────── */

describe("Phase 8 · quiet hours window", () => {
  test("same-day window: inside true, boundaries start-inclusive/end-exclusive", () => {
    expect(inQuietHours("09:00", "17:00", noon(12))).toBe(true);
    expect(inQuietHours("09:00", "17:00", noon(9))).toBe(true);
    expect(inQuietHours("09:00", "17:00", noon(8, 59))).toBe(false);
    expect(inQuietHours("09:00", "17:00", noon(17))).toBe(false);
  });

  test("overnight window wraps midnight", () => {
    expect(inQuietHours("22:00", "07:00", noon(23, 30))).toBe(true);
    expect(inQuietHours("22:00", "07:00", noon(3))).toBe(true);
    expect(inQuietHours("22:00", "07:00", noon(12))).toBe(false);
    expect(inQuietHours("22:00", "07:00", noon(7))).toBe(false);
  });

  test("degenerate and malformed windows never trigger", () => {
    expect(inQuietHours("22:00", "22:00", noon(22))).toBe(false);
    expect(inQuietHours("nonsense", "07:00", noon(3))).toBe(false);
  });
});

describe("Phase 8 · canNotify gate order", () => {
  test("master toggle off blocks everything", () => {
    expect(canNotify("approval", settings({ enabled: false }))).toBe(false);
    expect(canNotify("errors", settings({ enabled: false }))).toBe(false);
  });

  test("per-event off blocks that kind only", () => {
    const s = settings({ events: { updates: false } });
    expect(canNotify("updates", s)).toBe(false);
    expect(canNotify("agentComplete", s)).toBe(true);
  });

  test("quiet hours suppress non-critical; approval and errors pierce", () => {
    const s = settings({ quiet: { enabled: true, from: "00:00", to: "23:59" } });
    expect(canNotify("agentComplete", s, noon(12))).toBe(false);
    expect(canNotify("updates", s, noon(12))).toBe(false);
    expect(canNotify("approval", s, noon(12))).toBe(true);
    expect(canNotify("errors", s, noon(12))).toBe(true);
  });
});

describe("Phase 8 · channels, lifetimes, sound", () => {
  test("feed types map onto policy kinds", () => {
    expect(notificationKindFor("approval-request")).toBe("approval");
    expect(notificationKindFor("approval-decided")).toBe("approval");
    expect(notificationKindFor("success")).toBe("agentComplete");
    expect(notificationKindFor("error")).toBe("errors");
    expect(notificationKindFor("warning")).toBe("budget");
    expect(notificationKindFor("info")).toBe("updates");
  });

  test("OS channel is gated behind osEnabled in addition to the policy", () => {
    expect(shouldOsNotify("approval", settings({ osEnabled: false }))).toBe(false);
    expect(shouldOsNotify("approval", settings({ osEnabled: true }))).toBe(true);
  });

  test("toast lifetimes: banner 4s, alert sticky, none suppressed", () => {
    expect(toastDurationMs("banner")).toBe(4000);
    expect(toastDurationMs("alert")).toBe(Number.POSITIVE_INFINITY);
    expect(toastDurationMs("none")).toBe(0);
  });

  test("chime needs sounds on, unmuted, and a kind that may notify", () => {
    expect(shouldSound("updates", settings({ sounds: false }))).toBe(false);
    expect(shouldSound("updates", settings({ muted: true }))).toBe(false);
    expect(shouldSound("updates", settings({ enabled: false }))).toBe(false);
    expect(shouldSound("updates", settings({}))).toBe(true);
  });
});
