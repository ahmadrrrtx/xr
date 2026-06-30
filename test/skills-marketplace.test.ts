/** XR Stage 13 — Skills Marketplace tests. */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillMarketplace } from "../src/skills/marketplace.ts";
import { SkillSDK } from "../src/skills/sdk.ts";

test("marketplace discovers bundled professional skills", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-skills-home-"));
  const marketplace = new SkillMarketplace();
  const catalog = marketplace.catalog();
  expect(catalog.length).toBeGreaterThanOrEqual(50);
  expect(catalog.some((s) => s.manifest.id === "react_expert")).toBe(true);
  expect(catalog.some((s) => s.manifest.id === "incident_response")).toBe(true);
  expect(catalog.every((s) => s.manifest.permissions.every((p) => p.reason.length > 0))).toBe(true);
});

test("semantic-ish marketplace search ranks relevant skill", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-skills-search-"));
  const marketplace = new SkillMarketplace();
  const results = marketplace.search({ query: "optimize a slow React component state rendering bug", limit: 5 });
  expect(results.map((r) => r.manifest.id)).toContain("react_expert");
});

test("SDK creates, validates, packages, imports, disables and enables a skill", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-skills-sdk-"));
  const marketplace = new SkillMarketplace();
  const sdk = new SkillSDK(marketplace);
  const dir = sdk.create({ name: "Contract Reviewer", category: "business", publisher: "test", dir: join(process.env.XR_HOME!, "contract-reviewer") });
  const validation = sdk.validate(dir);
  expect(validation.ok).toBe(true);
  const pkg = sdk.package(dir);
  const imported = marketplace.importPackage(pkg);
  expect(imported.id).toBe("contract-reviewer");
  expect(marketplace.disable("contract-reviewer")).toBe(true);
  expect(marketplace.get("contract-reviewer")?.enabled).toBe(false);
  expect(marketplace.enable("contract-reviewer")).toBe(true);
  expect(marketplace.get("contract-reviewer")?.enabled).toBe(true);
});

test("runtime builds progressive skill context", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-skills-runtime-"));
  const marketplace = new SkillMarketplace();
  const ctx = marketplace.executionContext("prepare incident response containment and executive update", 3);
  expect(ctx.skills.length).toBeGreaterThan(0);
  expect(ctx.prompt).toContain("XR Skills Marketplace Runtime");
  expect(ctx.prompt).toContain("incident_response");
});
