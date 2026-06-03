/**
 * XR — Block 2 test: skills loader reads the pre-built library.
 */
import { test, expect } from "bun:test";
import { join } from "node:path";
import { loadSkills } from "../src/skills/loader.ts";

test("loads the pre-built skills library (>= 10 skills)", () => {
  const skills = loadSkills(join(import.meta.dir, "..", "skills"));
  expect(skills.length).toBeGreaterThanOrEqual(10);
  const ids = skills.map((s) => s.id);
  expect(ids).toContain("debug_error");
  expect(ids).toContain("security_audit");
  expect(ids).toContain("generate_readme");
});

test("each skill has tools parsed and a body", () => {
  const skills = loadSkills(join(import.meta.dir, "..", "skills"));
  const debug = skills.find((s) => s.id === "debug_error")!;
  expect(debug).toBeDefined();
  expect(debug.tools.length).toBeGreaterThan(0);
  expect(debug.body.length).toBeGreaterThan(10);
});

test("malformed skills dir returns empty, never throws", () => {
  expect(loadSkills("/nonexistent/path/xyz")).toEqual([]);
});
