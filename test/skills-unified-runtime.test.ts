/** XR 2.1A — Unified Skill Runtime tests. */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedSkillRuntime } from "../src/skills/runtime.ts";
import { SkillService } from "../src/services/skill-service.ts";

test("UnifiedSkillRuntime loads manifest, legacy, research, and role skill records", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-unified-skills-"));
  const runtime = new UnifiedSkillRuntime();
  const records = runtime.list();
  expect(records.length).toBeGreaterThanOrEqual(60);
  expect(records.some((record) => record.kind === "xr-manifest")).toBe(true);
  expect(records.some((record) => record.kind === "legacy-markdown")).toBe(true);
  expect(records.some((record) => record.kind === "research-pack")).toBe(true);
  expect(records.some((record) => record.kind === "role-pack")).toBe(true);
});

test("UnifiedSkillRuntime resolves relevant skills for a task", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-unified-resolve-"));
  const runtime = new UnifiedSkillRuntime();
  const result = runtime.resolve("fix a slow React state rendering performance bug", 4);
  expect(result.selected.length).toBeGreaterThan(0);
  expect(result.selected.map((record) => record.manifest.id)).toContain("react_expert");
});

test("SkillService exposes Phase A runtime health and inspector", () => {
  process.env.XR_HOME = mkdtempSync(join(tmpdir(), "xr-unified-service-"));
  const service = new SkillService();
  const health = service.runtimeHealth();
  expect(health.total).toBeGreaterThanOrEqual(60);
  const skill = service.inspectUnified("react_expert");
  expect(skill?.manifest.name).toBe("React Expert");
  expect(service.dependencyReport("react_expert").ok).toBe(true);
  expect(service.permissionReport("react_expert")?.skillId).toBe("react_expert");
});
