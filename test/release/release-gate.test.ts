/**
 * XR Phase 9 · T2 (Part 13.2) — the release gate fails on drift and on
 * unsupported claims. These run the REAL gate CLIs (the same entrypoints CI
 * runs) against throwaway fixture trees via XR_ROOT, and assert exit codes —
 * effects, not mocks.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../../scripts/release-manifest.ts";

const SCRIPTS = resolve(import.meta.dir, "..", "..", "scripts");
const FIXTURE = mkdtempSync(join(tmpdir(), "xr-gate-fixture-"));

/** Minimal stamped tree: manifest + only the surfaces the fixture manifest declares. */
function writeFixture(overrides?: { driftVersion?: string; seedClaim?: string }): void {
  const manifest = JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8"));
  // keep the fixture minimal + fast: one stamped json surface + one scanned
  // docs surface. Gate logic is identical; scale is not what is under test.
  manifest.stampTargets = [
    { id: "package.json", path: "package.json", kind: "json-version" },
  ];
  // Mechanical claims are host-dependent (skills/ count); the fixture strips
  // them so the gate evaluated here is only the seeded behavior under test.
  manifest.claims = manifest.claims.filter((c: { mechanical?: unknown }) => !c.mechanical);
  // generated-channel targets require generated files; keep the fixture to
  // identity surfaces only so both gates run in milliseconds.
  manifest.scannedSurfaces = ["README.md", "package.json"];
  writeFileSync(join(FIXTURE, "release.manifest.json"), JSON.stringify(manifest, null, 2));

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  writeFileSync(
    join(FIXTURE, "package.json"),
    JSON.stringify({ ...pkg, version: overrides?.driftVersion ?? manifest.identity.version }, null, 2) + "\n",
  );

  writeFileSync(
    join(FIXTURE, "README.md"),
    [
      "# fixture",
      "",
      `version ${manifest.identity.version}`,
      "",
      overrides?.seedClaim ?? "plain text with no claims",
      "",
    ].join("\n"),
  );
}

function runGate(script: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("bun", ["run", join(SCRIPTS, script), ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, XR_ROOT: FIXTURE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("Phase 9 · release gate adversarial tests (real CLIs, fixture trees)", () => {
  beforeAll(() => writeFixture());
  afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

  test("clean fixture: release:check PASSES (exit 0)", () => {
    writeFixture();
    const r = runGate("release-manifest.ts", ["--check"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("in sync");
  });

  test("seeded version drift: release:check FAILS (exit 1)", () => {
    writeFixture({ driftVersion: "3.1.6" });
    const r = runGate("release-manifest.ts", ["--check"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("drift");
  });

  test("clean fixture: claim-lint PASSES", () => {
    writeFixture();
    const r = runGate("claim-lint.ts", []);
    expect(r.status).toBe(0);
  });

  test("seeded prohibited claim: claim-lint FAILS (exit 1)", () => {
    writeFixture({ seedClaim: "XR is SOC 2 Type II certified and enterprise-hardened." });
    const r = runGate("claim-lint.ts", []);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/prohibited|SOC/i);
  });

  test("stamped-channel servers stay in sync in the REAL tree (sanity)", () => {
    // Independent of fixtures: the real repo must be green right now.
    const r = spawnSync("bun", ["run", join(SCRIPTS, "release-manifest.ts"), "--check"], {
      encoding: "utf8",
      env: { ...process.env, XR_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(r.status ?? 1).toBe(0);
  });
});
