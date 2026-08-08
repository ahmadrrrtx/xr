/**
 * Phase 4 · T8 — `node:vm` posture guard.
 *
 * `node:vm` is DEFENSE-IN-DEPTH only (it shares the host process and address
 * space). This guard fails if any CURRENT code or security doc describes it
 * as a security boundary. Negation-aware: lines carrying the disclaimer
 * ("NOT a security boundary", "defense-in-depth", "never a boundary") pass.
 *
 * Scope: src/**, docs/security/** (excluding the phase-4 audit-trail docs,
 * which deliberately QUOTE the old wording as historical evidence of what
 * was wrong) and SECURITY.md (the current security policy).
 * Historical phase reports — DELIVERABLE.md, README_SECURITY.md,
 * SECURITY_IMPLEMENTATION.md, MIGRATION.md, stage0/, PHASE-named — now live
 * under docs/historical/ and docs/migration/. They are archived records: the
 * current-doc set above is what governs claims.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

// README_SECURITY.md and SECURITY_IMPLEMENTATION.md were 2026-05 RCE-fix
// campaign records. They are archived under docs/historical/phase-deliverables/
// (launch cleanup) and, per this test's own doctrine, historical reports do
// not govern current claims — only the surfaces below do.
const SCOPES = [
  join(ROOT, "src"),
  join(ROOT, "docs", "security"),
  join(ROOT, "SECURITY.md"),
];

const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist"]);
// The phase-4 working docs quote the OLD (wrong) wording as audit evidence.
const EXCLUDE_PATHS = new Set([join(ROOT, "docs", "security", "phase4")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (EXCLUDE_PATHS.has(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|md)$/.test(entry)) out.push(p);
  }
  return out;
}

function filesInScope(): string[] {
  const out: string[] = [];
  for (const scope of SCOPES) {
    const st = statSync(scope);
    if (st.isDirectory()) walk(scope, out);
    else out.push(scope);
  }
  return out;
}

/** A line is a disclaimer (allowed) when it carries the corrected posture or
 *  explicitly frames the old wording as historical/past. */
const DISCLAIMER =
  /(NOT|not|never|no longer|isn'?t) (a |the )?(security )?(boundary|isolation)|defense-?in-?depth|(historical|historically|in the past|was documented|wrongly|incorrectly)/i;

/** Claims that node:vm / the VM realm IS a boundary — forbidden unless
 *  the disclaimer appears on the same line or the next two. */
const BOUNDARY_CLAIMS: Array<{ re: RegExp; why: string }> = [
  { re: /VM[- ]based isolation/i, why: "VM-based isolation framing" },
  { re: /VM (isolation|sandbox)[^\n]{0,80}(boundary|100% secure|secure)/i, why: "VM described as a boundary" },
  { re: /node:vm[^\n]{0,100}(boundary|isolation)/i, why: "node:vm named as boundary/isolation" },
  { re: /(primary|real|hard|main) security boundary[^\n]{0,40}VM/i, why: "VM as primary boundary" },
];

describe("Phase 4 · T8 — node:vm is never described as a security boundary", () => {
  test("no current source/doc describes node:vm or the VM realm as a boundary", () => {
    const offenders: string[] = [];
    for (const file of filesInScope()) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const context = [lines[i], lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
        if (DISCLAIMER.test(context)) continue; // corrected posture — allowed
        for (const { re, why } of BOUNDARY_CLAIMS) {
          if (re.test(lines[i])) {
            offenders.push(`${file}:${i + 1} — ${why}: ${lines[i].trim().slice(0, 90)}`);
            break;
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the canonical sandbox files carry the defense-in-depth disclaimer", () => {
    const sandbox = readFileSync(join(ROOT, "src/plugins/loader/sandbox.ts"), "utf8");
    expect(sandbox).toContain("DEFENSE-IN-DEPTH, NOT A SECURITY BOUNDARY");
    const worker = readFileSync(join(ROOT, "src/plugins/sandbox-worker.ts"), "utf8");
    expect(worker).toContain("node:vm` is NOT a security boundary");
  });
});
