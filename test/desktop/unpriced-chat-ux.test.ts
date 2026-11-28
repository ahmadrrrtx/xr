import { describe, expect, test } from "bun:test";
import { copyFor } from "../../desktop/src/screens/Chat/components/TurnErrorCard.tsx";

describe("desktop unpriced chat error", () => {
  test("an unpriced provider refusal offers the correct next action, not a budget raise", () => {
    const copy = copyFor({
      kind: "model",
      code: "unpriced",
      message: "price unavailable: this model has no shipped rate; no request sent",
    });
    expect(copy.title).toBe("This model has no known price.");
    expect(copy.detail).toContain("Pick a priced model or declare a sourced rate");
    expect(copy.detail).toContain("providerEngine.providerCapabilities.<provider>.models.<model>.cost");
    expect(copy.detail).toContain("no request sent");
    expect(copy.detail).not.toMatch(/raise (the )?budget|budget limit/i);
  });

  test("ordinary model failures retain their existing retry copy", () => {
    const copy = copyFor({ kind: "model", message: "authentication failed", retryable: true });
    expect(copy.title).toBe("The model run failed.");
    expect(copy.detail).toBe("authentication failed");
  });
});
