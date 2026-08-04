/**
 * XR Phase 9 · T6 (Part 10/11) — the Public Beta is evidence-bound.
 *
 *   - metric: record → aggregate → gate, with honest provisional windows;
 *   - malformed history fails closed;
 *   - the Beta label is consistent across every stamped surface (manifest →
 *     distribution module → website → README block → installers);
 *   - the feedback loop exists (issue template + acceptance doc).
 */

import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { aggregate, readAttempts, parseAttempt, type BetaAttempt } from "../../scripts/beta-metric.ts";
import { loadManifest } from "../../scripts/release-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");
const manifest = loadManifest();

function attemptsFor(os: BetaAttempt["os"][], n: number, failEvery = 0): BetaAttempt[] {
  const out: BetaAttempt[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ts: new Date(2026, 7, i + 1).toISOString(),
      os: os[i % os.length]!,
      channel: "installer",
      version: "7.1.0",
      ok: failEvery === 0 || (i + 1) % failEvery !== 0,
    });
  }
  return out;
}

describe("Phase 9 · beta install-success metric", () => {
  test("aggregate computes overall + per-OS rates over the window", () => {
    const agg = aggregate(attemptsFor(["linux", "macos", "windows"], 30), 30);
    expect(agg.total).toBe(30);
    expect(agg.succeeded).toBe(30);
    expect(agg.rate).toBe(1);
    expect(agg.provisional).toBe(false);
    expect(agg.byOs.linux!.rate).toBe(1);
  });

  test("a full window below 99% fails; ≥99% passes; short window is provisional", () => {
    const failing = aggregate(attemptsFor(["linux"], 30, 10), 30); // 3 fails → 90%
    expect(failing.rate).toBeCloseTo(0.9, 3);
    expect(failing.provisional).toBe(false);
    expect(failing.rate).toBeLessThan(0.99);

    const short = aggregate(attemptsFor(["linux"], 12), 30);
    expect(short.provisional).toBe(true);
    expect(short.rate).toBe(1);
  });

  test("window slicing uses the most recent attempts", () => {
    const old = attemptsFor(["linux"], 20, 2); // old: 50% failures
    const recent = attemptsFor(["linux"], 30); // recent: all ok
    const agg = aggregate([...old, ...recent], 30);
    expect(agg.rate).toBe(1);
    expect(agg.total).toBe(30);
  });

  test("malformed history lines fail closed", () => {
    expect(() => parseAttempt('{"ts":"x","os":"beos","channel":"c","version":"1","ok":true}')).toThrow(/unknown os/);
    expect(() => parseAttempt('{"ts":"x","os":"linux","channel":"c","version":"1","ok":"yes"}')).toThrow(/boolean/);
    expect(() => parseAttempt("not json")).toThrow();
  });

  test("CLI record → report → gate round-trip (real script, real file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-beta-cli-"));
    try {
      const file = join(dir, "metrics.jsonl");
      const script = join(ROOT, "scripts", "beta-metric.ts");
      for (const [os, ok] of [["linux", 1], ["macos", 1], ["windows", 0]] as const) {
        const r = spawnSync("bun", ["run", script, "record", "--file", file, "--os", os, "--channel", "installer", "--version", "7.1.0", "--ok", String(ok)], { encoding: "utf8" });
        expect(r.status).toBe(0);
      }
      const attempts = readAttempts(file);
      expect(attempts.length).toBe(3);
      expect(attempts.filter((a) => a.ok).length).toBe(2);

      const report = spawnSync("bun", ["run", script, "report", "--file", file, "--window", "30"], { encoding: "utf8" });
      expect(report.status).toBe(0);
      expect(report.stdout).toContain("PROVISIONAL"); // honest: not a >99% claim yet

      const gate = spawnSync("bun", ["run", script, "gate", "--file", file, "--threshold", "0.99", "--window", "30"], { encoding: "utf8" });
      expect(gate.status).toBe(0); // provisional gate passes and SAYS provisional
      expect(gate.stdout).toContain("PROVISIONAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("full-window failing gate exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-beta-fail-"));
    try {
      const file = join(dir, "metrics.jsonl");
      const lines = attemptsFor(["linux", "macos", "windows"], 30, 3).map((a) => JSON.stringify(a)).join("\n") + "\n";
      writeFileSync(file, lines);
      const r = spawnSync("bun", ["run", join(ROOT, "scripts", "beta-metric.ts"), "gate", "--file", file, "--threshold", "0.99", "--window", "30"], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toContain("FAIL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 9 · beta label consistency (one manifest truth)", () => {
  test("manifest declares beta + label cannot overclaim", () => {
    expect(manifest.distribution!.stability).toBe("beta");
    expect(manifest.distribution!.stabilityLabel).toBe("Public Beta");
  });

  test("stamped distribution module carries the label to the website", () => {
    const dist = readFileSync(join(ROOT, "website", "src", "lib", "distribution.ts"), "utf8");
    expect(dist).toContain('"stability": "beta"');
    expect(dist).toContain('"stabilityLabel": "Public Beta"');
    expect(dist).toContain('"version": "7.1.0"');
  });

  test("README identity block carries the Beta stamp", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("**Public Beta.**");
    expect(readme).toContain("docs/release/SUPPORT_MATRIX.md");
  });

  test("installers announce the Beta banner", () => {
    const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
    expect(sh).toContain("Public Beta");
    const ps1 = readFileSync(join(ROOT, "install.ps1"), "utf8");
    expect(ps1).toContain("Public Beta");
  });

  test("feedback loop exists (template + acceptance doc)", () => {
    const tpl = readFileSync(join(ROOT, ".github", "ISSUE_TEMPLATE", "beta_feedback.yml"), "utf8");
    expect(tpl).toContain("feedback → acceptance loop");
    expect(tpl).toContain("docs/beta/FEEDBACK.md");
    expect(existsSync(join(ROOT, "docs", "beta", "FEEDBACK.md"))).toBe(true);
  });
});
