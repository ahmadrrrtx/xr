import { describe, expect, test } from "bun:test";
import { parseAuditReport } from "../../scripts/audit-deps-filter.ts";
describe("RC-207 scanner output fails closed", () => {
  test("accepts explicit empty success and structured high findings", () => {
    expect(parseAuditReport({}, 0)).toEqual([]);
    expect(
      parseAuditReport(
        {
          zod: [
            {
              severity: "high",
              title: "fixture",
              vulnerable_versions: "<4.6.6",
            },
          ],
        },
        1,
      )[0].severity,
    ).toBe("high");
  });
  test("transport errors, missing severity, invalid envelopes and unknown levels are never zero findings", () => {
    for (const bad of [
      null,
      true,
      "error",
      { error: "registry failure" },
      { package: {} },
      { zod: [{ title: "no severity" }] },
      { zod: [{ severity: "future-severity" }] },
      [null],
    ])
      expect(() => parseAuditReport(bad)).toThrow();
    expect(() => parseAuditReport({}, 1)).toThrow();
    expect(() => parseAuditReport({}, 2)).toThrow();
  });
});
