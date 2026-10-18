/**
 * XR Phase 2.5 · §15#21 — Node engine metadata must name ONE floor, everywhere.
 *
 * REPRODUCTION: `package.json.engines` declared ONLY a Bun floor while the
 * Node requirements for the launcher/binary path were contradicted across
 * surfaces — `Node 18+` in bin/xr's header and docs/SCREEN-BRIEFS.md vs
 * `Node 20+` on the website downloads page (the maintained public statement)
 * and CI matrices (node 20 / 22). E.g. `ReferenceError` from newer APIs on
 * genuine Node-18 hosts was indistinguishable from a bug.
 *
 * Settlement (evidence-ledersichtig, no invented floor): the website
 * downloads page is a maintained statement (3 verbatim "Node.js 20+"), CI
 * starts at 20, and the compile binary/launcher (`bin/xr`) is ESM-plain and
 * runs on Node 20 today — the floor is 20+, and STALE 18+ text reconciled.
 *
 * These invariants pin the metadata + the reconciled copy so the conflict
 * cannot silently return.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

describe("§15#21 Node engine metadata — one floor, evidence-settled", () => {
  test("package.json engines declares the evidence-settled Node floor alongside Bun", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    expect(pkg.engines?.node).toBe(">=20");
    expect(pkg.engines?.bun).toBe(">=1.3.0"); // unchanged
  });

  test("bin/xr documents the SAME floor as the metadata", () => {
    const launcher = readFileSync(join(REPO, "bin", "xr"), "utf8");
    expect(launcher).toContain("Node 20+");
    expect(launcher).not.toContain("Node 18+");
  });

  test("docs/SCREEN-BRIEFS.md names the SAME floor (stale 18+ text reconciled)", () => {
    const briefs = readFileSync(join(REPO, "docs", "SCREEN-BRIEFS.md"), "utf8");
    expect(briefs).toContain("Node.js 20+");
    expect(briefs).not.toContain("Node.js 18+");
  });
});
