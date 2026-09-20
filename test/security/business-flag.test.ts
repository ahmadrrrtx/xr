/**
 * SEC-05 — business routes are feature-flagged OFF by default.
 * The trusted daemon surface must match the documented product unless the
 * operator explicitly opts in with XR_BUSINESS_ROUTES=on.
 */
import { describe, expect, test } from "bun:test";
import { listBaseRoutes } from "../../src/daemon/routes/registry.ts";

const hasBusiness = () => listBaseRoutes().some((r) => r.pathLabel().includes("/business"));

describe("SEC-05 business routes flag", () => {
  test("OFF by default — no /api/business/* in the base surface", () => {
    delete process.env.XR_BUSINESS_ROUTES;
    expect(hasBusiness()).toBe(false);
  });

  test("XR_BUSINESS_ROUTES=on re-enables the residue explicitly", () => {
    process.env.XR_BUSINESS_ROUTES = "on";
    expect(hasBusiness()).toBe(true);
    delete process.env.XR_BUSINESS_ROUTES;
  });
});
