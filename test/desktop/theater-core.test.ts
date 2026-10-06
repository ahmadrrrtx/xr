/**
 * Phase 16 · Voice Theater primitives (desktop/src/lib/theaterCore.ts).
 *
 * Pure logic only — the window, the native menu and the shortcut live in
 * Rust unit tests (commands/theater.rs) and the Playwright pass. Negative
 * branches included, per house rule: a gate that cannot fail is decoration.
 */
import { describe, expect, test } from "bun:test";

import {
  ERROR_VISIBLE_MS,
  LOW_END_STAR_FACTOR,
  STAR_LAYERS,
  THEATER_IN,
  THEATER_OUT,
  activeWordIndex,
  approvalLine,
  isLowEnd,
  keyAction,
  showsMutedLook,
  splitWords,
  starCounts,
  theaterStateFor,
  visibleTurns,
  wordTimeline,
} from "../../desktop/src/lib/theaterCore";

const base = { active: true, approval: false, errorAt: null, now: 10_000 };

describe("theaterStateFor", () => {
  test("maps the voice loop onto the six stage states", () => {
    expect(theaterStateFor({ ...base, state: "idle" })).toBe("idle");
    expect(theaterStateFor({ ...base, state: "listening" })).toBe("listening");
    expect(theaterStateFor({ ...base, state: "interrupted" })).toBe("listening");
    for (const s of ["thinking", "planning", "working", "tool"]) {
      expect(theaterStateFor({ ...base, state: s })).toBe("thinking");
    }
    expect(theaterStateFor({ ...base, state: "speaking" })).toBe("speaking");
    expect(theaterStateFor({ ...base, state: "approval" })).toBe("approval");
    expect(theaterStateFor({ ...base, state: "error" })).toBe("error");
    expect(theaterStateFor({ ...base, state: "success" })).toBe("idle");
    expect(theaterStateFor({ ...base, state: "offline" })).toBe("idle");
  });

  test("a finished session is idle whatever its last state said", () => {
    expect(theaterStateFor({ ...base, state: "speaking", active: false })).toBe("idle");
  });

  test("garbage payloads land on idle, never throw", () => {
    expect(theaterStateFor({ ...base, state: 42 })).toBe("idle");
    expect(theaterStateFor({ ...base, state: "warp-drive" })).toBe("idle");
    expect(theaterStateFor({ ...base, state: undefined })).toBe("idle");
  });

  test("a pending approval wins over the loop state", () => {
    expect(theaterStateFor({ ...base, state: "speaking", approval: true })).toBe("approval");
  });

  test("an error is a 4 s flash, then the loop state shows again", () => {
    expect(theaterStateFor({ ...base, state: "listening", errorAt: 9_000 })).toBe("error");
    expect(theaterStateFor({ ...base, state: "listening", errorAt: 10_000 - ERROR_VISIBLE_MS })).toBe("listening");
    expect(theaterStateFor({ ...base, state: "listening", errorAt: 9_000, approval: true })).toBe("approval");
  });
});

describe("showsMutedLook", () => {
  test("dims only idle/listening — XR may still be speaking while the mic is muted", () => {
    expect(showsMutedLook("idle", true)).toBe(true);
    expect(showsMutedLook("listening", true)).toBe(true);
    expect(showsMutedLook("speaking", true)).toBe(false);
    expect(showsMutedLook("thinking", true)).toBe(false);
    expect(showsMutedLook("listening", false)).toBe(false);
  });
});

describe("karaoke sweep", () => {
  test("splitWords drops empties and collapses whitespace", () => {
    expect(splitWords("  Ready   when you\nare.  ")).toEqual(["Ready", "when", "you", "are."]);
    expect(splitWords("")).toEqual([]);
  });

  test("wordTimeline covers the whole duration, monotonic, one entry per word", () => {
    const timings = wordTimeline("Ready when you are.", 2_000);
    expect(timings).toHaveLength(4);
    expect(timings[0].start).toBe(0);
    expect(timings[3].end).toBeCloseTo(2_000, 6);
    for (let i = 1; i < timings.length; i++) {
      expect(timings[i].start).toBeCloseTo(timings[i - 1].end, 6);
      expect(timings[i].end).toBeGreaterThan(timings[i].start);
    }
  });

  test("punctuation earns a breath — the clause end lasts longer than a bare word of equal length", () => {
    const [bare, dotted] = wordTimeline("abc abc.", 1_000);
    expect(dotted.end - dotted.start).toBeGreaterThan(bare.end - bare.start);
  });

  test("empty text or a non-positive duration yields no timeline", () => {
    expect(wordTimeline("", 1_000)).toEqual([]);
    expect(wordTimeline("hi", 0)).toEqual([]);
    expect(wordTimeline("hi", Number.NaN)).toEqual([]);
  });

  test("activeWordIndex walks the words and parks on the done index", () => {
    const timings = wordTimeline("one two three", 3_000);
    expect(activeWordIndex(timings, -5)).toBe(0);
    expect(activeWordIndex(timings, 0)).toBe(0);
    expect(activeWordIndex(timings, timings[1].start + 1)).toBe(1);
    expect(activeWordIndex(timings, 2_999)).toBe(2);
    expect(activeWordIndex(timings, 3_000)).toBe(3);
    expect(activeWordIndex(timings, 99_999)).toBe(3);
    expect(activeWordIndex([], 100)).toBe(0);
  });
});

describe("star field sizing", () => {
  test("the reference window gets the brief's 150 / 60 / 20", () => {
    expect(starCounts(900, 700, false)).toEqual([150, 60, 20]);
  });

  test("count scales with area and never drops below a visible minimum", () => {
    const [a] = starCounts(1800, 1400, false);
    expect(a).toBe(600);
    expect(starCounts(10, 10, false)).toEqual([4, 4, 4]);
    expect(starCounts(-5, 100, false)).toEqual([4, 4, 4]);
  });

  test("low-end keeps ~30 % of the stars", () => {
    const full = starCounts(900, 700, false);
    const low = starCounts(900, 700, true);
    low.forEach((count, i) => expect(count).toBe(Math.round(full[i] * LOW_END_STAR_FACTOR)));
  });

  test("three layers, brightest is the sparse cyan one", () => {
    expect(STAR_LAYERS).toHaveLength(3);
    expect(STAR_LAYERS[2].color).toContain("0,229,255");
    expect(STAR_LAYERS[0].drift).toBeLessThan(STAR_LAYERS[2].drift);
  });

  test("isLowEnd: sub-1 DPR or a slow probe", () => {
    expect(isLowEnd(0.9, null)).toBe(true);
    expect(isLowEnd(2, null)).toBe(false);
    expect(isLowEnd(2, 16.7)).toBe(false);
    expect(isLowEnd(2, 30)).toBe(true);
  });
});

describe("transcript helpers", () => {
  const caps = [
    { id: 1, role: "you" as const, text: "Hey XR" },
    { id: 2, role: "xr" as const, text: "   " },
    { id: 3, role: "xr" as const, text: "Ready when you are." },
    { id: 4, role: "you" as const, text: "What time is it?" },
    { id: 5, role: "system" as const, text: "Didn't catch that." },
    { id: 6, role: "xr" as const, text: "It's noon." },
  ];

  test("visibleTurns keeps the last four non-empty lines, oldest first", () => {
    expect(visibleTurns(caps).map((c) => c.id)).toEqual([3, 4, 5, 6]);
    expect(visibleTurns(caps, 2).map((c) => c.id)).toEqual([5, 6]);
    expect(visibleTurns([])).toEqual([]);
  });

  test("approvalLine joins tool and reason, tolerates junk, truncates", () => {
    expect(approvalLine("shell", "rm -rf ./build")).toBe("shell · rm -rf ./build");
    expect(approvalLine("shell", undefined)).toBe("shell");
    expect(approvalLine(null, 12)).toBe("");
    expect(approvalLine("x", "y".repeat(200), 20)).toHaveLength(20);
    expect(approvalLine("x", "y".repeat(200), 20).endsWith("…")).toBe(true);
  });
});

describe("keyAction", () => {
  test("stage keys map, modifiers are left to the OS", () => {
    expect(keyAction({ key: " " })).toBe("toggle-listen");
    expect(keyAction({ key: "m" })).toBe("toggle-mute");
    expect(keyAction({ key: "F" })).toBe("fullscreen");
    expect(keyAction({ key: "Escape" })).toBe("escape");
    expect(keyAction({ key: "t" })).toBe("transcript");
    expect(keyAction({ key: "x" })).toBeNull();
    expect(keyAction({ key: " ", metaKey: true })).toBeNull();
    expect(keyAction({ key: "f", ctrlKey: true })).toBeNull();
  });

  test("a focused control keeps Space/M/F/T as native keys, Esc still works", () => {
    expect(keyAction({ key: " ", inControl: true })).toBeNull();
    expect(keyAction({ key: "m", inControl: true })).toBeNull();
    expect(keyAction({ key: "Escape", inControl: true })).toBe("escape");
  });
});

describe("event contract", () => {
  test("names are namespaced per direction", () => {
    Object.values(THEATER_IN).forEach((n) => expect(n.startsWith("voice:")).toBe(true));
    Object.values(THEATER_OUT).forEach((n) => expect(n.startsWith("theater:")).toBe(true));
    expect(new Set([...Object.values(THEATER_IN), ...Object.values(THEATER_OUT)]).size).toBe(
      Object.keys(THEATER_IN).length + Object.keys(THEATER_OUT).length
    );
  });
});
