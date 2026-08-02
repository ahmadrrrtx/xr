/**
 * XR Phase 8 · T2 — profile-gate parser + budget logic (hermetic; the live
 * gate itself runs in CI on every PR — see tests integration note in
 * docs/phase8/05-TEST-RESULTS.md).
 */

import { test, expect } from "bun:test";
import { summarizeProfile, gateViolations, CPU_BUDGETS, type ProfileSummary, type CpuProfile } from "../../scripts/profile-gate.ts";

test("summarizeProfile computes total CPU ms from timeDeltas + top self-time functions", () => {
  const profile: CpuProfile = {
    nodes: [
      { id: 1, callFrame: { functionName: "main", url: "file:///repo/src/index.ts" } },
      { id: 2, callFrame: { functionName: "parse", url: "file:///repo/src/config/config.ts" } },
      { id: 3, callFrame: { functionName: "", url: "" } },
    ],
    samples: [1, 2, 2, 2, 3],
    timeDeltas: [1000, 2000, 2000, 2000, 3000], // 10ms total
  };
  const s = summarizeProfile(profile, "version");
  expect(s.cpuMs).toBe(10);
  expect(s.samples).toBe(5);
  expect(s.top[0].fn).toBe("parse");
  expect(s.top[0].selfMs).toBe(6); // 3/5 of 10ms
  expect(s.top.some((t) => t.url === "src/index.ts")).toBe(true);
});

test("gateViolations flags absolute-budget breaches only", () => {
  const results: ProfileSummary[] = [
    { scenario: "version", cpuMs: CPU_BUDGETS.version + 0.1, samples: 10, top: [] },
    { scenario: "help", cpuMs: CPU_BUDGETS.help - 1, samples: 10, top: [] },
  ];
  const violations = gateViolations(results, CPU_BUDGETS);
  expect(violations.length).toBe(1);
  expect(violations[0]).toContain("version");
});

test("budgets cover the four startup-hot scenarios", () => {
  for (const id of ["version", "help", "workspace-list", "doctor"]) {
    expect(typeof CPU_BUDGETS[id]).toBe("number");
    expect(CPU_BUDGETS[id]).toBeGreaterThan(0);
  }
});
