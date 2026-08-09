/**
 * XR Phase 5 · T1 — deterministic difficulty estimation (RouteLLM principle,
 * deterministic variant; docs/historical/phases/phase5-routing/03-RESEARCH-NOTES.md · R1).
 * Asserts EFFECTS: difficulty scores drive fidelity floors, signals explain
 * every estimate, and nothing here is a model call or opaque.
 */
import { describe, test, expect } from "bun:test";
import {
  estimateDifficulty,
  difficultyLabel,
  fidelityFloorFor,
} from "../../src/intelligence/difficulty.ts";

describe("Phase 5 · difficulty estimator", () => {
  test("trivial short chat task scores easy with an easy floor", () => {
    const d = estimateDifficulty({ modelClass: "chat", summary: "hello" });
    expect(d.score).toBeLessThan(0.3);
    expect(d.requiredFidelity).toBe(fidelityFloorFor(d.score));
    expect(d.requiredFidelity).toBeLessThanOrEqual(0.4);
    expect(difficultyLabel(d.score)).toBe("easy");
  });

  test("complex multi-part analysis task scores hard with a hard floor", () => {
    const d = estimateDifficulty({
      modelClass: "chat",
      summary:
        "Analyze the trade-offs between these three database architectures, then design a migration plan:\n" +
        "1. compare consistency models\n2. evaluate failure modes\n3. propose an optimized rollback strategy",
      require: { toolUse: true, structuredOutput: true },
      minContextTokens: 128_000,
    });
    expect(d.score).toBeGreaterThanOrEqual(0.8);
    expect(d.requiredFidelity).toBeGreaterThanOrEqual(0.85);
    expect(difficultyLabel(d.score)).toBe("frontier");
    // Explainability: the signals name WHY (structure, intent, context, caps)
    expect(d.signals.join(" ")).toMatch(/analysis\/design intent/);
    expect(d.signals.join(" ")).toMatch(/very large context/);
    expect(d.signals.join(" ")).toMatch(/structured\/multi-part/);
  });

  test("requirements-only estimate (no task text) is medium and marked as such", () => {
    const d = estimateDifficulty({ modelClass: "chat" });
    expect(d.requirementsOnly).toBe(true);
    expect(d.score).toBeGreaterThanOrEqual(0.4);
    expect(d.score).toBeLessThan(0.6);
    expect(d.signals.join(" ")).toMatch(/requirements-only/);
  });

  test("required capabilities raise difficulty monotonically", () => {
    const base = estimateDifficulty({ modelClass: "chat", summary: "do the thing" });
    const withReasoning = estimateDifficulty({
      modelClass: "chat",
      summary: "do the thing",
      require: { reasoning: true },
    });
    const withTools = estimateDifficulty({
      modelClass: "chat",
      summary: "do the thing",
      require: { toolUse: true },
    });
    expect(withReasoning.score).toBeGreaterThan(base.score);
    expect(withTools.score).toBeGreaterThan(base.score);
  });

  test("deterministic: same inputs → identical estimate", () => {
    const req = {
      modelClass: "chat" as const,
      summary: "Refactor the parser and verify edge cases with formal checks",
      require: { toolUse: true },
    };
    const a = estimateDifficulty(req);
    const b = estimateDifficulty(req);
    expect(a).toEqual(b);
  });

  test("custom floors override the default mapping", () => {
    const d = estimateDifficulty(
      { modelClass: "chat", summary: "hi" },
      { fidelityFloors: { easy: 0.1, standard: 0.2, hard: 0.3, frontier: 0.4 } },
    );
    expect(d.requiredFidelity).toBe(0.1);
  });

  test("score is bounded 0..1 even with every signal maxed", () => {
    const d = estimateDifficulty({
      modelClass: "reasoning",
      summary:
        "analyze design architect optimize compare evaluate prove verify exact debug multi-step plan " +
        "```{ code: 'yes' }```\n".repeat(400),
      require: { reasoning: true, toolUse: true, structuredOutput: true, vision: true },
      minContextTokens: 200_000,
    });
    expect(d.score).toBeLessThanOrEqual(1);
  });
});
