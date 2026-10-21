/**
 * Launch-audit L-002/L-003/L-004 regression: every Rust triple the desktop
 * bundling matrix ships must have a REAL bun compile target (cross-compile
 * that produces a genuine target-arch binary), and the bundling workflow must
 * ship legs for every launch-committed OS/arch — Windows ARM and Intel mac
 * included. Written when compile-sidecar.ts gained its --target mapping;
 * would have caught both missing-leg findings and the rename-only hazard the
 * workflow comment already warned about.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRIPLE_TO_BUN_TARGET, resolveCompile, tripleExt } from "../../scripts/compile-sidecar.ts";

const ROOT = join(import.meta.dir, "..", "..");

const LAUNCH_TRIPLES = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
];

describe("sidecar compile matrix (L-002/L-003)", () => {
  test("every launch triple has a real bun compile target (no rename-only cross)", () => {
    for (const triple of LAUNCH_TRIPLES) {
      const bunTarget = TRIPLE_TO_BUN_TARGET[triple];
      expect(bunTarget, `missing bun target for ${triple}`).toBeTruthy();
      expect(bunTarget).toMatch(/^bun-(linux|darwin|windows)-(x64|arm64)$/);
    }
    expect(TRIPLE_TO_BUN_TARGET["aarch64-pc-windows-msvc"]).toBe("bun-windows-arm64");
  });

  test("resolveCompile flags cross builds and windows .exe follows the TARGET", () => {
    const cross = resolveCompile("darwin-arm64", "x86_64-apple-darwin");
    expect(cross.cross).toBe(true);
    expect(cross.bunTarget).toBe("bun-darwin-x64");
    expect(cross.ext).toBe("");
    const win = resolveCompile("linux-x64", "aarch64-pc-windows-msvc");
    expect(win.ext).toBe(".exe");
    expect(win.cross).toBe(true);
    expect(tripleExt("x86_64-unknown-linux-gnu")).toBe("");
  });

  test("unknown host fails loudly instead of producing a mislabeled binary", () => {
    expect(() => resolveCompile("freebsd-x64")).toThrow(/unsupported host/);
  });

  test("desktop-app.yml ships a bundle leg for every launch triple", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/desktop-app.yml"), "utf8");
    for (const triple of LAUNCH_TRIPLES) {
      expect(wf, `desktop-app.yml has no bundle leg for ${triple}`).toContain(triple);
    }
    // Windows ARM must build on a native ARM runner (sidecar must RUN on-target).
    expect(wf).toMatch(/windows-11-(arm|vs2026-arm)/);
  });

  test("smoke-sidecar.sh skips cross-target honestly instead of faking a run", () => {
    const sh = readFileSync(join(ROOT, "scripts/smoke-sidecar.sh"), "utf8");
    expect(sh).toContain("SKIPPED (cross-target)");
  });
});
