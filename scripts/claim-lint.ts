#!/usr/bin/env bun
/**
 * XR — Claim linter (Phase 0 · T2)
 *
 * Enforces Constitution Article XIX.1 ("Documentation is source-accurate and
 * claim-governed. A claim linter fails CI on drift; no public claim without an
 * evidence link"), Article XXII.4 ("No release label — complete/certified/
 * enterprise/supreme — without evidence") and ADR-10 (Evidence test).
 *
 * Independent gates, each of which fails the build:
 *
 *   1. VERSION DRIFT      — every declared surface must match release.manifest.json.
 *   2. PROHIBITED CLAIMS  — fabricated certifications, scale and runtime claims.
 *   3. EVIDENCE + EXPIRY  — every manifest claim needs live, non-expired evidence.
 *   4. SUPERVISED TERMS   — "certified"/"enterprise"/"complete"… must be backed
 *                           by an evidenced claim, else they are marketing.
 *   5. CONSTITUTION       — every Article cited anywhere in the tree must exist
 *                           in docs/CONSTITUTION.md (Phase 5 · F-17).
 *   6. NUMERIC CLAIMS     — published numbers that have a single source in the
 *                           tree must carry it: every tree-ceiling figure equals
 *                           TREE_CEILING (stamped via `bun run size-gate
 *                           --stamp-docs`), the README test-count tuple equals
 *                           docs/release/TEST-BASELINE.json, and RELEASING.md
 *                           names every independent version surface
 *                           (fix-program Phase 1.3).
 *   7. DOC LINKS          — every relative link in the published docs resolves
 *                           in this tree; a deliberately pending target carries
 *                           an inline `xr:link-pending` reason (Phase 1.3).
 *   8. STATUS LABEL       — "Public beta" until docs/release/launch-gates.json is
 *                           all green; no stable-production wording meanwhile
 *                           (launch audit XR-LAUNCH-010, decision D2).
 *   9. CHANNEL CLAIMS     — the README install table maps to claimed channels;
 *                           with `--live`, a row marked live must pass
 *                           `channel:live` against the real registries.
 *
 * Gates 6–7 live in this scanner rather than as manifest claims: the manifest
 * stamps file *identities*, while these rules police prose in hand-written
 * docs — a direct scan is the honest mechanism (docs/audits/XR_FIX_TRACKER.md Phase 1.3
 * decision row). Gates 1–5 are unchanged.
 *
 *   bun run scripts/claim-lint.ts            # lint the repository
 *   bun run scripts/claim-lint.ts --json     # machine-readable report
 *   bun run scripts/claim-lint.ts --live     # + compare README channel claims with live registries (network)
 *
 * Fails closed: an unreadable surface or an unparseable manifest is a failure,
 * never a pass (Commandment 13).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, loadManifest, evaluateSurfaces, countSkills, type ReleaseManifest } from "./release-manifest.ts";
import { TREE_CEILING } from "./size-gate.ts";
import { compareTableWithLive, lintChannelTable, lintStatusLabel, parseInstallTable } from "./launch-claims.ts";

export interface Violation {
  gate: "version-drift" | "prohibited-claim" | "evidence" | "supervised-term" | "mechanical" | "constitution" | "numeric-claim" | "doc-link" | "status-label" | "channel-claim";
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
  // Phase 30 — roadmap language. A trust page that says "SOC 2 Type I is in
  // progress; Type II is not attempted" is doing exactly what Article XIX asks
  // for, and before Phase 30 there was no such page to write. These markers
  // admit the honest non-claim while leaving the prohibition above intact for the
  // sentence that matters: "XR is SOC 2 Type II certified".
  /\b(in progress|not attempted|not yet|roadmap|on the roadmap|planned for|target(ing|ed)?)\b/i,
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
  // Phase 30 — reporting that an action did NOT finish is the opposite of a
  // completion claim, and Commandment 2 requires exactly this sentence to exist
  // when a sign-in fails. Exempting it keeps the rule aimed at product claims.
  /\b(cannot|can not|could not|did not|didn't|unable to|failed to|never)\s+complete\b/i,
];

/**
 * Phase 30 — a path segment is an identifier, not a claim.
 *
 * `/auth/complete` is the URL a magic link lands on, and `onComplete` is a prop
 * name. Neither asserts anything about XR. Flagging them taught the linter to
 * fire on code rather than prose, which is the failure mode the note above warns
 * about, so the exemption is narrow: the term must be part of a slash-delimited
 * path or a camelCase identifier.
 */
const IDENTIFIER_PATTERNS = [
  /\/[\w-]*complete\b/i,
  /\b[a-z]+Complete[A-Z]\w*\b/,
  /\bonComplete\b/i,
];

function isActionCompletion(line: string, term: string): boolean {
  if (term.toLowerCase() !== "complete") return false;
  if (IDENTIFIER_PATTERNS.some((re) => re.test(line))) return true;
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


// ── Gate 5: the Constitution is not a ghost (Phase 5 · F-17) ─────────────────

/**
 * Until Phase 5, ~300 citations across src/, test/, scripts/, .github/ and
 * docs/adr/ referred to "Constitution Art. IV.4", "Article XII · Rule 4" and
 * the like — in code comments, in CI job descriptions, and in gate failure
 * messages users actually read — while no constitutional text existed anywhere
 * in the repository. A project whose brand is verifiability was citing a law
 * that could not be read (audit finding F-17).
 *
 * `docs/CONSTITUTION.md` now exists (reconstructed from those citations), and
 * this gate is what stops it becoming a ghost again: cite an Article that the
 * document does not define, and CI fails. That makes the citation a checkable
 * reference rather than a rhetorical flourish.
 *
 * The gate is deliberately ARTICLE-level, not clause-level. Clause numbers
 * (IV.4, XII · Rule 4) are cited far more precisely than the reconstruction can
 * currently vouch for, and failing the build over a clause this document does
 * not yet spell out would be enforcing a precision XR does not honestly have.
 * Article-level is the strongest claim the evidence supports today.
 */
const ROMAN = "(?:XXX|XXIX|XXVIII|XXVII|XXVI|XXV|XXIV|XXIII|XXII|XXI|XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)";
const CITATION_RE = new RegExp(`(?:Article|Art\\.)\\s+(${ROMAN})(?![A-Z])`, "g");
const CONSTITUTION_PATH = "docs/CONSTITUTION.md";
/** Directories whose citations are historical record, not live law. */
const CONSTITUTION_SCAN_ROOTS = ["src", "test", "scripts", ".github"] as const;

function collectCitableFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) collectCitableFiles(full, out);
    else if (/\.(ts|tsx|md|json|ya?ml|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

export function lintConstitution(root: string = ROOT): Violation[] {
  const violations: Violation[] = [];
  const constitutionFile = join(root, CONSTITUTION_PATH);

  if (!existsSync(constitutionFile)) {
    return [{
      gate: "constitution",
      file: CONSTITUTION_PATH,
      line: 0,
      text: "",
      reason:
        "The Constitution is cited as binding law throughout the tree but the canonical text does not exist. " +
        "Publish docs/CONSTITUTION.md or strip the citations (Phase 5 · F-17).",
    }];
  }

  const text = readFileSync(constitutionFile, "utf8");
  // An Article is DEFINED when it appears as a heading: "## Article XII — …"
  const defined = new Set<string>();
  for (const m of text.matchAll(new RegExp(`^#{1,3}\\s+Article\\s+(${ROMAN})(?![A-Z])`, "gm"))) {
    defined.add(m[1]!);
  }
  // Articles the document explicitly records as unattested are "known absent",
  // which is an honest answer — but nothing may CITE them.
  const unattested = new Set<string>();
  const unattestedSection = /No citation exists[^.]*?\*\*Articles? ([^*]+)\*\*/.exec(text);
  if (unattestedSection) {
    for (const m of unattestedSection[1]!.matchAll(new RegExp(ROMAN, "g"))) unattested.add(m[0]);
  }

  for (const scanRoot of CONSTITUTION_SCAN_ROOTS) {
    for (const file of collectCitableFiles(join(root, scanRoot))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        CITATION_RE.lastIndex = 0;
        for (const m of line.matchAll(CITATION_RE)) {
          const article = m[1]!;
          if (defined.has(article)) continue;
          violations.push({
            gate: "constitution",
            file: rel,
            line: i + 1,
            text: line.trim().slice(0, 160),
            reason: unattested.has(article)
              ? `Cites Article ${article}, which ${CONSTITUTION_PATH} records as UNATTESTED (no surviving text). Remove the citation or reconstruct the Article.`
              : `Cites Article ${article}, which is not defined in ${CONSTITUTION_PATH} (Art. XIX.1 — no claim without a source).`,
          });
        }
      });
    }
  }
  return violations;
}

/* ── Phase 1.3 · docs integrity: numeric claims + relative links ──────────
 * The numbers and links below are the ones real readers hit on the published
 * pages — the README gates table, the canonical limitations register and the
 * frozen release excerpts. Each has a single source of truth in this tree
 * (`TREE_CEILING` in scripts/size-gate.ts, the measured
 * `docs/release/TEST-BASELINE.json`, the filesystem itself) and these gates
 * fail when the prose drifts from that source. Fenced code is skipped;
 * history lines carry `<!-- xr:numeric-history -->` and are exempt from the
 * prose ceiling scan (never from the marker-value check); a deliberately
 * pending link carries `<!-- xr:link-pending: reason -->`.
 */

export interface TestBaseline {
  pass: number;
  skip: number;
  fail: number;
  files: number;
  bunVersion: string;
  lane: string;
  commit: string;
  measuredAt: string;
}

export const TEST_BASELINE_PATH = "docs/release/TEST-BASELINE.json";

/** Docs scanned by the numeric + link gates (README, canonical register, frozen excerpts). */
function docsIntegritySurfaces(root: string): string[] {
  const out: string[] = [];
  for (const rel of ["README.md", "docs/security/KNOWN_LIMITATIONS.md"]) {
    const abs = join(root, rel);
    if (existsSync(abs)) out.push(abs);
  }
  const relDir = join(root, "docs/release");
  if (existsSync(relDir)) out.push(...collectFiles(relDir, "**/*.md"));
  return out;
}

/** Blank fenced code blocks (``` or ~~~ runs), preserving line numbering. */
export function stripFences(text: string): string {
  return text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1[^\n]*(?:\n|$)/g, (m) => m.replace(/[^\n]/g, " "));
}

const TREE_CEILING_MARKER = /<!-- XR:TREE-CEILING -->([^<]*)<!-- \/XR:TREE-CEILING -->/g;
const HISTORY_EXEMPT = /<!-- xr:numeric-history -->/;
const LINK_PENDING = /<!-- xr:link-pending:.*-->/;
const HYPHEN_LOC = /(\d{1,3}(?:,\d{3})+)-LOC/g;

function formattedCeiling(): string {
  return TREE_CEILING.toLocaleString("en-US");
}

/**
 * Scan one doc's text for numeric-claim violations. Exported so
 * test/release/numeric-claims.test.ts can bite the same scanner in-memory.
 */
export function scanNumericClaims(
  text: string,
  file: string,
  baseline: TestBaseline | null,
): Violation[] {
  const out: Violation[] = [];
  const comma = formattedCeiling();
  const k = `${Math.round(TREE_CEILING / 1000)}K`;
  const rel = relative(ROOT, file);
  // Marker values must equal TREE_CEILING even on history-exempt lines.
  for (const m of text.matchAll(TREE_CEILING_MARKER)) {
    if (m[1] !== comma) {
      out.push({
        gate: "numeric-claim",
        file: rel,
        line: text.slice(0, m.index).split("\n").length,
        text: `<!-- XR:TREE-CEILING -->${m[1]}<!-- /XR:TREE-CEILING -->`,
        reason: `stamped ceiling is ${m[1]}, but TREE_CEILING in scripts/size-gate.ts is ${comma} LOC — run \`bun run size-gate --stamp-docs\``,
      });
    }
  }
  // Prose ceiling claims: a hyphenated "N-LOC" figure and any bare re-mention
  // of the formatted ceiling must equal the single source. The bare-value rule
  // is intentionally scoped to the exact formatted value (and its K-form), so
  // legitimate measurements ("23,376 LOC extracted") and unrelated counts are
  // never flagged. History lines are exempt from the prose scan.
  const lines = stripFences(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (HISTORY_EXEMPT.test(line)) continue;
    line = line.replace(TREE_CEILING_MARKER, ""); // marker contents checked above
    for (const m of line.matchAll(HYPHEN_LOC)) {
      if (m[1] !== comma) {
        out.push({
          gate: "numeric-claim",
          file: rel,
          line: i + 1,
          text: m[0],
          reason: `ceiling claim ${m[1]}-LOC does not match TREE_CEILING (${comma} LOC) in scripts/size-gate.ts`,
        });
      }
    }
    if (line.includes(comma)) {
      out.push({
        gate: "numeric-claim",
        file: rel,
        line: i + 1,
        text: comma,
        reason: `bare ${comma} outside an XR:TREE-CEILING marker — use the marker so the stamp keeps it truthful`,
      });
    }
    if (new RegExp(`\\b${k}\\b`).test(line)) {
      out.push({
        gate: "numeric-claim",
        file: rel,
        line: i + 1,
        text: k,
        reason: `bare ${k} outside an XR:TREE-CEILING marker — use the marker`,
      });
    }
  }
  // README test-count tuple must equal the measured baseline (fail closed).
  if (rel === "README.md") {
    const tuple = text.match(/([\d,]+) pass \/ (\d+) skip \/ (\d+) fail across ([\d,]+) files/);
    if (!tuple) {
      out.push({
        gate: "numeric-claim",
        file: rel,
        line: 0,
        text: "(test-count tuple)",
        reason: `README gates table must state the measured test tuple ('N pass / S skip / 0 fail across F files') from ${TEST_BASELINE_PATH}`,
      });
    } else if (!baseline) {
      out.push({
        gate: "numeric-claim",
        file: rel,
        line: 0,
        text: tuple[0],
        reason: `cannot verify the tuple: ${TEST_BASELINE_PATH} is missing or unparseable — re-measure (bun test), then update both`,
      });
    } else {
      const mism: string[] = [];
      if (parseInt(tuple[1].replace(/,/g, ""), 10) !== baseline.pass) mism.push(`pass ${tuple[1]} != ${baseline.pass}`);
      if (parseInt(tuple[2], 10) !== baseline.skip) mism.push(`skip ${tuple[2]} != ${baseline.skip}`);
      if (parseInt(tuple[3], 10) !== baseline.fail) mism.push(`fail ${tuple[3]} != ${baseline.fail}`);
      if (parseInt(tuple[4].replace(/,/g, ""), 10) !== baseline.files) mism.push(`files ${tuple[4]} != ${baseline.files}`);
      if (mism.length) {
        out.push({
          gate: "numeric-claim",
          file: rel,
          line: text.slice(0, tuple.index).split("\n").length,
          text: tuple[0],
          reason: `README tuple drifted from ${TEST_BASELINE_PATH}: ${mism.join(" · ")} — re-measure (bun test) and update both, per the RELEASING.md refresh step`,
        });
      }
    }
  }
  // RELEASING.md must name every independent version surface. This is a
  // completeness check: values are deliberately unconstrained because the
  // surfaces are independent by evidence — the release can never stamp them.
  if (rel === "docs/release/RELEASING.md") {
    for (const surface of ["cloud/package.json", "mobile/package.json", "desktop/src-tauri/Cargo.toml", "extensions/vscode/package.json"]) {
      if (!text.includes(surface)) {
        out.push({
          gate: "numeric-claim",
          file: rel,
          line: 0,
          text: surface,
          reason: "RELEASING.md must name this independent version surface so a release can never stamp it by accident (Phase 1.3 classification)",
        });
      }
    }
  }
  return out;
}

/**
 * Scan one doc for relative markdown links whose target does not resolve on
 * disk. External, anchor-only and mailto targets are skipped; a line-level
 * `xr:link-pending` marker suppresses that line's links. Exported for tests.
 */
export function scanDocLinks(text: string, file: string): Violation[] {
  const out: Violation[] = [];
  const rel = relative(ROOT, file);
  const lines = stripFences(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (LINK_PENDING.test(line)) continue;
    for (const m of line.matchAll(/\]\(([^)]+)\)/g)) {
      let target = m[1].trim().split(/\s+/)[0]; // drop optional "title"
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      target = target.replace(/%20/g, " ").split("#")[0].split("?")[0];
      if (!target) continue;
      if (!existsSync(join(file, "..", target))) {
        out.push({
          gate: "doc-link",
          file: rel,
          line: i + 1,
          text: `](${m[1]})`,
          reason: `relative link target '${target}' does not exist in this tree (mark deliberately pending targets with <!-- xr:link-pending: reason -->)`,
        });
      }
    }
  }
  return out;
}

/** Gates 6 + 7 over every docs surface. Fails closed on an unreadable baseline. */
export function lintDocsIntegrity(root: string = ROOT): Violation[] {
  let baseline: TestBaseline | null = null;
  try {
    baseline = JSON.parse(readFileSync(join(root, TEST_BASELINE_PATH), "utf8")) as TestBaseline;
  } catch {
    baseline = null; // README tuple rule then fails closed with the pointer.
  }
  const out: Violation[] = [];
  for (const abs of docsIntegritySurfaces(root)) {
    const text = readFileSync(abs, "utf8");
    out.push(...scanNumericClaims(text, abs, baseline));
    out.push(...scanDocLinks(text, abs));
  }
  return out;
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

  const violations: Violation[] = [
    ...lintRepository(manifest),
    ...lintConstitution(),
    ...lintDocsIntegrity(),
    ...lintStatusLabel(manifest, ROOT),
    ...lintChannelTable(manifest, ROOT),
  ];
  const notes: string[] = [];
  if (process.argv.includes("--live")) {
    // Gate 9, live half: what the README promises vs what the registries serve.
    const { runLiveChecks } = await import("./channel-live-check.ts");
    const results = await runLiveChecks(manifest, { ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN });
    const rows = parseInstallTable(readFileSync(join(ROOT, "README.md"), "utf8"));
    const cmp = compareTableWithLive(rows, results);
    violations.push(...cmp.violations);
    notes.push(...cmp.stalePending);
  }
  for (const n of notes) console.error(`[claim-lint] note: ${n}`);

  if (json) {
    console.log(JSON.stringify({ ok: violations.length === 0, count: violations.length, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    console.log(`[claim-lint] ✓ no unsupported claims · ${manifest.claims.length} evidenced claims · every cited Article exists in ${CONSTITUTION_PATH} · published numbers and doc links single-sourced · v${manifest.identity.version}`);
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
