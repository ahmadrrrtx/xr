/**
 * XR Phase 2.5 · P1-16 — first-contributor onboarding / typecheck preflight.
 *
 * REPRODUCTION: on a fresh checkout, `bun install && bun run typecheck`
 * explodes with 12,191 `error TS` lines in desktop/ (TS7026/TS7006/TS2307 —
 * 'JSX element implicitly has type any', missing modules never imported).
 * cause: desktop/ has its own lockfile by design; the root install never
 * provides it. A contributor has no way to know from the noise.
 *
 * Requirement: fail EARLY with the exact actionable remediation, not with the
 * noise. Portable (Bun/Node ESM — no POSIX shell like `test -d`), honest
 * (checks the real prerequisite artifact), and inert (no auto-install, no
 * lockfile read/write, no directory create/remove). This phase makes
 * packaging/toolchains BETTER, not different: no workspace conversion and no
 * package.json changes beyond the single documented script + script deps.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { desktopDepsReady, REMEDIATION } from "../../scripts/typecheck-preflight.ts";

const REPO = join(import.meta.dir, "..", "..");

describe("typecheck preflight — remediation, not noise", () => {
  test("the canonical typecheck script runs the preflight BEFORE either tsc call", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    const script: string = pkg.scripts.typecheck;
    expect(script).toContain("bun run scripts/typecheck-preflight.ts &&");
    expect(script.indexOf("typecheck-preflight")).toBeLessThan(script.indexOf("tsc --noEmit"));
  });

  test("preflight is portable: a plain ESM .ts module with no POSIX-only fragments", () => {
    const full = readFileSync(join(REPO, "scripts", "typecheck-preflight.ts"), "utf8");
    const src = full.slice(full.indexOf("import ")); // implementation, not the doc narrative
    expect(src).not.toContain("test -d");
    expect(src).not.toContain("process.platform === \"win32\" ? "); // no platform branching needed
    expect(src).toMatch(/from "node:fs"/);
    expect(src).not.toMatch(/execSync|spawnSync/); // installs nothing, writes nothing
  });

  test("checks the REAL prerequisite (typescript/package.json), not merely any node_modules directory", () => {
    const root = mkdtempSync(join(tmpdir(), "p25-preflight-"));
    try {
      mkdirSync(join(root, "desktop", "node_modules"), { recursive: true });
      expect(desktopDepsReady(root)).toBe(false); // bare node_modules is NOT enough
      mkdirSync(join(root, "desktop", "node_modules", "typescript"), { recursive: true });
      writeFileSync(join(root, "desktop", "node_modules", "typescript", "package.json"), "{}");
      expect(desktopDepsReady(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the live repository checkout actually satisfies the preflight (dev machine sanity)", () => {
    expect(existsSync(join(REPO, "desktop", "node_modules", "typescript", "package.json"))).toBe(true);
    expect(desktopDepsReady(REPO)).toBe(true);
  });

  test("remediation names the exact command a contributor must run", () => {
    expect(REMEDIATION).toContain("cd desktop && bun install");
  });
});
