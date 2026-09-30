/**
 * Phase 5 · palette query primitives (desktop/src/lib/paletteQuery.ts).
 *
 * The registry itself pulls stores/icons and is covered by the e2e pass; the
 * ALGORITHMS (prefix parsing, fuzzy scoring, group gating, quick-ask
 * threshold, relative time) are pure and prove out here — including the
 * negative branches, per house rule: a gate that cannot fail is decoration.
 */
import { describe, expect, test } from "bun:test";

import {
  QUICK_ASK_MIN_CHARS,
  groupAllowed,
  modLabel,
  paletteFilter,
  parsePaletteQuery,
  relativeTime,
} from "../../desktop/src/lib/paletteQuery.ts";

describe("Phase 5 · prefix filters", () => {
  test("each prefix maps to its mode and is stripped from the search text", () => {
    expect(parsePaletteQuery("/new")).toEqual({ mode: "commands", rest: "new" });
    expect(parsePaletteQuery("@coder")).toEqual({ mode: "agents", rest: "coder" });
    expect(parsePaletteQuery("?css centers")).toEqual({ mode: "search", rest: "css centers" });
    expect(parsePaletteQuery(">reset")).toEqual({ mode: "dev", rest: "reset" });
    expect(parsePaletteQuery("new chat")).toEqual({ mode: "all", rest: "new chat" });
  });

  test("a lone prefix is an empty rest (show the whole filtered group)", () => {
    expect(parsePaletteQuery("/")).toEqual({ mode: "commands", rest: "" });
    expect(parsePaletteQuery("@")).toEqual({ mode: "agents", rest: "" });
  });

  test("only a LEADING prefix counts — mid-query characters are literal", () => {
    expect(parsePaletteQuery("3/4 cup").mode).toBe("all");
    expect(parsePaletteQuery("a@b.com").mode).toBe("all");
  });

  test("group gating: each mode admits exactly its groups", () => {
    const groups = ["commands", "chats", "agents", "workspaces", "settings"] as const;
    // all → every group
    for (const g of groups) expect(groupAllowed("all", g, true)).toBe(true);
    // '/' → commands only
    expect(groupAllowed("commands", "commands", true)).toBe(true);
    expect(groupAllowed("commands", "chats", true)).toBe(false);
    // '@' → agents only
    expect(groupAllowed("agents", "agents", true)).toBe(true);
    expect(groupAllowed("agents", "settings", true)).toBe(false);
    // '?' → the registry is replaced by the web-search stub
    for (const g of groups) expect(groupAllowed("search", g, true)).toBe(false);
    // '>' → dev commands only, and NEVER in production
    expect(groupAllowed("dev", "settings", true)).toBe(true);
    expect(groupAllowed("dev", "settings", false)).toBe(false);
  });
});

describe("Phase 5 · fuzzy filter (cmdk custom filter)", () => {
  test("empty query matches everything equally (order = registry order)", () => {
    expect(paletteFilter("New chat", "")).toBe(1);
    expect(paletteFilter("Anything", "/")).toBe(1); // lone prefix
  });

  test("substring hits score the maximum", () => {
    expect(paletteFilter("New chat", "new")).toBe(1);
    expect(paletteFilter("New chat", "/new")).toBe(1); // prefix is invisible to scoring
    expect(paletteFilter("New chat", "@chat")).toBe(1);
  });

  test("keywords participate in matching", () => {
    expect(paletteFilter("Cycle Theme", "thme", ["appearance", "color"])).toBeGreaterThan(0);
    expect(paletteFilter("Show Budget", "spend", ["spend", "cost", "limits"])).toBe(1);
  });

  test("subsequence matches score between 0 and 1, contiguous ranks higher", () => {
    const scattered = paletteFilter("Toggle Sidebar", "tsbar"); // scattered letters
    const contiguous = paletteFilter("Toggle Sidebar", "toggl"); // near-substring
    expect(scattered).toBeGreaterThan(0);
    expect(scattered).toBeLessThan(1);
    expect(contiguous).toBeGreaterThan(scattered);
  });

  test("missing characters are rejected (AND semantics)", () => {
    expect(paletteFilter("New chat", "xyz")).toBe(0);
    expect(paletteFilter("New chat", "newxyz")).toBe(0);
    // out of order is NOT a match
    expect(paletteFilter("New chat", "tac")).toBe(0);
  });

  test("matching is case-insensitive on both sides", () => {
    expect(paletteFilter("nEW CHAT", "New")).toBe(1);
  });
});

describe("Phase 5 · quick-ask threshold", () => {
  test("three characters is the minimum askable query", () => {
    expect(QUICK_ASK_MIN_CHARS).toBe(3);
  });
});

describe("Phase 5 · relative time subtitles", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  test("buckets", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(relativeTime(now - 3 * 7 * 86_400_000, now)).toBe("3w ago");
  });
  test("months fall back to a locale date, never a negative", () => {
    expect(relativeTime(now - 400 * 86_400_000, now)).not.toContain("-");
    expect(relativeTime(now + 60_000, now)).toBe("just now"); // clock skew clamps
  });
});

describe("Phase 5 · platform shortcut labels", () => {
  test("macOS gets the glyph, everyone else gets the word", () => {
    expect(modLabel("macos")).toBe("⌘");
    expect(modLabel("windows")).toBe("Ctrl+");
    expect(modLabel("linux")).toBe("Ctrl+");
    expect(modLabel("web")).toBe("Ctrl+");
  });
});
