#!/usr/bin/env bun
/**
 * XR — Claim linter (Phase 0 · T2)
 *
 * Enforces Constitution Article XIX.1 ("Documentation is source-accurate and
 * claim-governed. A claim linter fails CI on drift; no public claim without an
 * evidence link"), Article XXII.4 ("No release label — complete/certified/
 * enterprise/supreme — without evidence") and ADR-10 (Evidence test).
 *
 * Four independent gates, each of which fails the build:
 *
 *   1. VERSION DRIFT      — every declared surface must match release.manifest.json.
 *   2. PROHIBITED CLAIMS  — fabricated certifications, scale and runtime claims.
 *   3. EVIDENCE + EXPIRY  — every manifest claim needs live, non-expired evidence.
 *   4. SUPERVISED TERMS   — "certified"/"enterprise"/"complete"… must be backed
 *                           by an evidenced claim, else they are marketing.
 *
 *   bun run scripts/claim-lint.ts            # lint the repository
 *   bun run scripts/claim-lint.ts --json     # machine-readable report
 *
 * Fails closed: an unreadable surface or an unparseable manifest is a failure,
 * never a pass (Commandment 13).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, loadManifest, evaluateSurfaces, countSkills, type ReleaseManifest } from "./release-manifest.ts";

export interface Violation {
  gate: "version-drift" | "prohibited-claim" | "evidence" | "supervised-term" | "mechanical";
  file: string;
  line: number;
  text: string;
  reason: string;
}

/** Lines that are allowed to mention a prohibited pattern: the governance machinery itself. */
const GOVERNANCE_EXEMPT_FILES = new Set([
  "release.manifest.json",
  "scripts/claim-lint.ts",
  "scripts/release-manifest.ts",
]);

/**
 * A line may reference a prohibited term when it is explicitly disclaiming it.
 * This is what allows an honest "XR is NOT SOC 2 certified" statement to live on
 * a public page while "SOC 2 Type II" as a feature bullet fails the build.
 */
const DISCLAIMER_MARKERS = [
  /\bnot\b[^.]{0,40}\b(certified|compliant|audited)\b/i,
  /\bno\b[^.]{0,30}\b(soc\s*2|iso\s*27001|hipaa|certification|audit)\b/i,
  /\bdoes not\b/i,
  /\bnever claimed\b/i,
  /\bwithout\b[^.]{0,30}\bcertification\b/i,
  /xr-claim-lint-allow/i,
];

function isDisclaimer(line: string): boolean {
  return DISCLAIMER_MARKERS.some((re) => re.test(line));
}

/**
 * Article XXII.4 governs *release labels* ("complete/certified/enterprise/supreme"),
 * not ordinary English. Reporting that a finished action finished — "bootstrap
 * complete", "migration complete" — is a verified effect, which is exactly what
 * Commandment 2 asks software to report. Flagging it would train contributors to
 * ignore the linter, which is how claim governance dies.
 *
 * The exemption is deliberately narrow: a completion verb immediately preceding
 * the term, or a progress line. Anything describing XR *itself* as complete
 * remains a violation.
 */
const ACTION_COMPLETION = [
  /\b(bootstrap|install(ation)?|setup|migration|download|upload|sync|scan|build|run|task|backup|restore|import|export|update|upgrade)\s+(is\s+)?complete\b/i,
  /\bcomplete[ds]?\s+in\s+\d/i,
  /\bmarked\s+complete\b/i,
];

function isActionCompletion(line: string, term: string): boolean {
  if (term.toLowerCase() !== "complete") return false;
  return ACTION_COMPLETION.some((re) => re.test(line));
}

/** Recursively collect files matching a simple glob-ish surface spec. */
function collectFiles(root: string, surface: string): string[] {
  const globIndex = surface.indexOf("**");
  if (globIndex === -1) {
    const abs = join(root, surface);
    return existsSync(abs) && statSync(abs).isFile() ? [abs] : [];
  }
  const baseDir = join(root, surface.slice(0, globIndex));
  const extMatch = surface.match(/\{([^}]+)\}$/);
  const exts = extMatch
    ? extMatch[1]!.split(",").map((e) => `.${e.trim().replace(/^\./, "")}`)
    : [surface.slice(surface.lastIndexOf("."))];

  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === "dist") continue;
      const abs = join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (exts.some((ext) => abs.endsWith(ext))) out.push(abs);
    }
  };
  walk(baseDir);
  return out;
}

export function lintRepository(manifest: ReleaseManifest, root: string = ROOT): Violation[] {
  const violations: Violation[] = [];

  // ── Gate 1: version drift across every declared surface ───────────────────
  for (const surface of evaluateSurfaces(manifest, root)) {
    if (!surface.inSync) {
      violations.push({
        gate: "version-drift",
        file: surface.path,
        line: 0,
        text: surface.detail,
        reason: `Surface is not stamped from release.manifest.json (v${manifest.identity.version}). Run: bun run release:stamp`,
      });
    }
  }

  // ── Gate 3: evidence + expiry on every declared claim ─────────────────────
  const now = Date.now();
  for (const claim of manifest.claims) {
    if (!claim.evidence || claim.evidence.trim().length < 8) {
      violations.push({
        gate: "evidence",
        file: "release.manifest.json",
        line: 0,
        text: claim.text,
        reason: `Claim "${claim.id}" has no meaningful evidence link (Article XIX.1 / ADR-10).`,
      });
    }
    const expiry = Date.parse(claim.expires);
    if (Number.isNaN(expiry)) {
      violations.push({
        gate: "evidence",
        file: "release.manifest.json",
        line: 0,
        text: claim.text,
        reason: `Claim "${claim.id}" has an invalid expiry date.`,
      });
    } else if (expiry < now) {
      violations.push({
        gate: "evidence",
        file: "release.manifest.json",
        line: 0,
        text: claim.text,
        reason: `Claim "${claim.id}" expired on ${claim.expires} — re-evidence it or remove it (Article XXII.4).`,
      });
    }

    // Mechanical claims must match reality, not merely cite it.
    if (claim.mechanical?.kind === "skill-count") {
      const actual = countSkills(root);
      if (actual !== claim.mechanical.value) {
        violations.push({
          gate: "mechanical",
          file: "release.manifest.json",
          line: 0,
          text: claim.text,
          reason: `Claim "${claim.id}" asserts ${claim.mechanical.value} skills but skills/ contains ${actual}.`,
        });
      }
    }
  }

  // ── Gates 2 + 4: scan public surfaces ─────────────────────────────────────
  const prohibited = manifest.prohibitedClaims.map((p) => ({ re: new RegExp(p.pattern, "i"), reason: p.reason }));
  const supervised = manifest.supervisedTerms.map((t) => ({
    term: t,
    re: new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i"),
  }));
  const evidencedText = manifest.claims.map((c) => c.text.toLowerCase());

  for (const surface of manifest.scannedSurfaces) {
    for (const abs of collectFiles(root, surface)) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      if (GOVERNANCE_EXEMPT_FILES.has(rel)) continue;

      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch (err) {
        violations.push({
          gate: "prohibited-claim",
          file: rel,
          line: 0,
          text: "",
          reason: `Unreadable declared surface (fail closed): ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.trim() || isDisclaimer(line)) continue;

        for (const p of prohibited) {
          if (p.re.test(line)) {
            violations.push({
              gate: "prohibited-claim",
              file: rel,
              line: i + 1,
              text: line.trim().slice(0, 160),
              reason: p.reason,
            });
          }
        }

        for (const s of supervised) {
          if (!s.re.test(line)) continue;
          if (isActionCompletion(line, s.term)) continue;
          const lower = line.toLowerCase();
          const backed = evidencedText.some((claimText) => {
            const words = claimText.split(/\W+/).filter((w) => w.length > 4).slice(0, 4);
            return words.length > 0 && words.every((w) => lower.includes(w));
          });
          if (!backed) {
            violations.push({
              gate: "supervised-term",
              file: rel,
              line: i + 1,
              text: line.trim().slice(0, 160),
              reason: `Supervised term "${s.term}" needs an evidenced claim in release.manifest.json (Article XXII.4). Rephrase or add evidence.`,
            });
          }
        }
      }
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  let manifest: ReleaseManifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.error("[claim-lint] manifest error (fail closed):", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const violations = lintRepository(manifest);

  if (json) {
    console.log(JSON.stringify({ ok: violations.length === 0, count: violations.length, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    console.log(`[claim-lint] ✓ no unsupported claims · ${manifest.claims.length} evidenced claims · v${manifest.identity.version}`);
    return;
  }

  const byGate = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!byGate.has(v.gate)) byGate.set(v.gate, []);
    byGate.get(v.gate)!.push(v);
  }
  console.error(`[claim-lint] ✗ ${violations.length} violation(s)\n`);
  for (const [gate, list] of byGate) {
    console.error(`── ${gate} (${list.length}) ${"─".repeat(Math.max(0, 50 - gate.length))}`);
    for (const v of list) {
      console.error(`  ${v.file}${v.line ? `:${v.line}` : ""}`);
      if (v.text) console.error(`    > ${v.text}`);
      console.error(`    ${v.reason}\n`);
    }
  }
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[claim-lint] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
