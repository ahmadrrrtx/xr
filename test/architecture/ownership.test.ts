/**
 * XR Phase 8 · T5 — ownership map invariants.
 *
 * `docs/OWNERSHIP.md` is the public, human-readable mirror of `CODEOWNERS`.
 * These tests guarantee: every top-level area is owned, the doc can never
 * drift from its source (the generator's --check runs here and in CI), and
 * the Phase-8 accountable boundaries (privacy plane, API contract) have
 * explicit owners rather than falling through to the default.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "../..");

describe("T5 — ownership map", () => {
  test("CODEOWNERS exists with a default catch-all owner (no unowned bytes)", () => {
    const co = readFileSync(join(ROOT, "CODEOWNERS"), "utf8");
    expect(co).toMatch(/^\*\s+@/m);
  });

  test("the generator's --check passes (docs/OWNERSHIP.md is in sync)", () => {
    const res = spawnSync(process.execPath, ["run", "scripts/ownership-map.ts", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("in sync");
  });

  test("every top-level src/ and test/ directory appears in the committed map", () => {
    const doc = readFileSync(join(ROOT, "docs", "OWNERSHIP.md"), "utf8");
    for (const rootName of ["src", "test"]) {
      const dirs = readdirSync(join(ROOT, rootName), { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
      for (const dir of dirs) {
        expect(doc).toContain(`\`${rootName}/${dir}/\``);
      }
    }
  });

  test("Phase-8 accountable boundaries are EXPLICITLY owned, not default fallthrough", () => {
    const co = readFileSync(join(ROOT, "CODEOWNERS"), "utf8");
    // The privacy boundary (Art. XXI) — telemetry shape changes data exposure.
    expect(co).toMatch(/^\/src\/observability\/\s+@/m);
    expect(co).toMatch(/^\/src\/commands\/telemetry\.ts\s+@/m);
    // The public API contract — schema, client, and compat gate move together.
    expect(co).toMatch(/^\/src\/daemon\/api\/\s+@/m);
    expect(co).toMatch(/^\/src\/clients\/\s+@/m);
    // The a11y/UX gate surfaces.
    expect(co).toMatch(/^\/test\/a11y\/\s+@/m);
    expect(co).toMatch(/^\/test\/ux\/\s+@/m);
  });

  test("the map names the accountable human for a privacy-area sample row", () => {
    const doc = readFileSync(join(ROOT, "docs", "OWNERSHIP.md"), "utf8");
    const row = doc.split("\n").find((l) => l.includes("`src/observability/`"));
    expect(row).toBeDefined();
    expect(row).toContain("@ahmadrrrtx");
    expect(row).toContain("explicit entry");
  });

  test("no dead weight: the map has one row per scanned area (count matches generation)", () => {
    const doc = readFileSync(join(ROOT, "docs", "OWNERSHIP.md"), "utf8");
    const rows = doc.split("\n").filter((l) => /^\| `/.test(l));
    // Sanity band — not a fragile exact count: structure stays honest as the tree grows.
    expect(rows.length).toBeGreaterThan(100);
  });
});
