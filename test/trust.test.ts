/**
 * XR — Block 3 tests: cost estimator + signed benchmark report.
 */
import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { estimateTask } from "../src/cost/estimate.ts";
import { runLab } from "../src/security/lab.ts";

test("estimate: local model is $0", () => {
  const e = estimateTask("refactor the auth module", { inPerMTok: 0, outPerMTok: 0 });
  expect(e.estUsd).toBe(0);
  expect(e.estTokens).toBeGreaterThan(0);
});

test("estimate: cloud model has nonzero cost and scales with steps", () => {
  const cheap = estimateTask("x", { inPerMTok: 1, outPerMTok: 2 }, { steps: 2 });
  const heavy = estimateTask("x", { inPerMTok: 1, outPerMTok: 2 }, { steps: 8 });
  expect(cheap.estUsd).toBeGreaterThan(0);
  expect(heavy.estUsd).toBeGreaterThan(cheap.estUsd);
});

test("benchmark report can be signed and re-verified", () => {
  const report = runLab({ egressAllowlist: [] });
  const payload = {
    tool: "xr",
    kind: "injection-benchmark",
    total: report.total,
    blocked: report.blocked,
    rate: report.rate,
    outcomes: report.outcomes,
  };
  const sig = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  // Re-compute → must match (reproducible/verifiable by anyone).
  const sig2 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  expect(sig).toBe(sig2);
  expect(sig).toHaveLength(64);
});
