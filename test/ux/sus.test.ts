/**
 * XR Phase 8 · T4 — SUS instrument correctness.
 *
 * The human study itself cannot be synthesized (honesty exception E-1), but
 * the INSTRUMENT must be mathematically exact: a wrong scoring formula would
 * quietly inflate or deflate the eventual human result. Vectors below use
 * canonical SUS math (Brooke 1996) and the Bangor/Sauro–Lewis adjective
 * bands; the aggregate gate encodes the Phase-8 honesty rule (n ≥ 5 AND
 * mean ≥ 80, otherwise "study pending — do not claim").
 */

import { describe, expect, test } from "bun:test";
import { SUS_ITEMS, SUS_TARGET, susScore, adjectiveRating, aggregate } from "../../scripts/sus.ts";

describe("T4 — SUS instrument", () => {
  test("there are exactly the 10 canonical items, alternating positive/negative wording", () => {
    expect(SUS_ITEMS.length).toBe(10);
    expect(SUS_ITEMS[0]).toContain("frequently"); // item 1 (positive)
    expect(SUS_ITEMS[1]).toContain("unnecessarily complex"); // item 2 (negative)
    expect(SUS_ITEMS[9]).toContain("a lot of things"); // item 10 (negative)
  });

  test("canonical scoring vectors (Brooke 1996)", () => {
    // Maximum usability pattern: agree with positives, disagree with negatives → 100.
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    // Worst pattern → 0.
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    // Neutral across the board → exactly 50 (odd: 5×2, even: 5×2 → 20×2.5).
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
    // Worked example: [4,2,5,1,4,2,5,1,4,2] → odd: 3+4+3+4+3=17, even: 3+4+3+4+3=17 → 34×2.5=85.
    expect(susScore([4, 2, 5, 1, 4, 2, 5, 1, 4, 2])).toBe(85);
  });

  test("the scorer refuses garbage instead of producing a fake score", () => {
    expect(() => susScore([5, 1])).toThrow(/exactly 10/);
    expect(() => susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 0])).toThrow(/1–5/);
    expect(() => susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 2.5])).toThrow(/integer/);
  });

  test("adjective bands match the published Sauro–Lewis curved grading", () => {
    expect(adjectiveRating(100)).toBe("best imaginable");
    expect(adjectiveRating(86)).toBe("excellent");
    expect(adjectiveRating(80)).toBe("good"); // 80 target sits mid-'good' under curved bands — documented in SUS.md
    expect(adjectiveRating(60)).toBe("ok");
    expect(adjectiveRating(30)).toBe("worst imaginable");
  });

  test("target constant is the Phase-8 commitment", () => {
    expect(SUS_TARGET).toBe(80);
  });

  test("aggregate honesty gate: n<5 is never claimable, even with perfect scores", () => {
    const perfect = { participant: "p", at: "t", responses: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], score: 100 };
    expect(aggregate([perfect, perfect, perfect, perfect]).claimable).toBe(false);
    expect(aggregate([perfect, perfect, perfect, perfect, perfect]).claimable).toBe(true);
    // n=5 but mean < target is also not claimable.
    const low = { participant: "p", at: "t", responses: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], score: 50 };
    expect(aggregate([low, low, low, low, low]).claimable).toBe(false);
    expect(aggregate([]).n).toBe(0);
    expect(aggregate([]).rating).toBe("no data");
  });
});
