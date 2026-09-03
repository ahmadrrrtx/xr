import { describe, expect, test } from "bun:test";
import { looksStale } from "../../scripts/consumer-smoke.ts";

describe("Phase 3 — consumer smoke identity checks", () => {
  test("looksStale flags the 3.x published identity, not the 1.x line", () => {
    expect(looksStale("3.1.5")).toBe(true);
    expect(looksStale("XR 3.0")).toBe(true);
    expect(looksStale("Unified AI Operating System")).toBe(true);
    expect(looksStale("1.0.0 (Truth)")).toBe(false);
    expect(looksStale("1.0.0-beta.1")).toBe(false);
  });
});
