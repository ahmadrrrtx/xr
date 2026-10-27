#!/usr/bin/env bun
/**
 * XR-LAUNCH-011 / 022 — the support matrix is GENERATED from gate evidence.
 *
 *   bun run scripts/support-matrix.ts                 rewrite the generated block of
 *                                                     docs/release/SUPPORT_MATRIX.md
 *   bun run scripts/support-matrix.ts --check         fail if that block is stale
 *   bun run scripts/support-matrix.ts --require-complete
 *                                                     launch gate: every gating target
 *                                                     has ✅ (CI or LR) or an explicit
 *                                                     de-scope on all seven steps
 *   --evidence <dir>   journey evidence (default docs/release/evidence; CI passes
 *                      the downloaded journey-evidence-* artifacts)
 *   --out <file>       write the rendered block to a separate file instead
 *
 * Inputs: docs/release/support-targets.json (claimed targets + de-scopes) and
 * the JSON records written by scripts/journey/*-journey.ts. Nothing here is
 * typed by hand: a cell is ✅ only when a record for that target passed that
 * step, and it names the evidence class (CI = hosted runner run, LR = local
 * run on real hardware) and the commit.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JourneyEvidence, StepName } from "./journey/cli-journey.ts";

const ROOT = resolve(import.meta.dir, "..");
export const BEGIN = "<!-- BEGIN GENERATED: journey matrix (scripts/support-matrix.ts) — do not edit by hand -->";
export const END = "<!-- END GENERATED: journey matrix -->";

export interface Target { id: string; surface: string; label: string; gating?: boolean; note?: string; descopes?: Record<string, string> }
export interface Targets { steps: StepName[]; targets: Target[] }
export type Cell = { kind: "pass"; classes: string[]; commit: string } | { kind: "fail"; detail: string } | { kind: "descoped"; reason: string } | { kind: "none" };

/**
 * Directory entries in a FIXED order. `readdirSync` returns filesystem order
 * (hash order on ext4, name order on APFS, insertion order on NTFS), so an
 * unsorted walk renders the evidence column differently per platform and
 * `--check` fails on a matrix that is actually current. Sorting here makes the
 * generated block byte-identical on Linux, macOS and Windows.
 */
function entries(dir: string): string[] {
  return readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function loadEvidence(dir: string): JourneyEvidence[] {
  const out: JourneyEvidence[] = [];
  if (!existsSync(dir)) return out;
  for (const f of entries(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...loadEvidence(p));
    else if (f.endsWith(".json")) {
      try {
        const e = JSON.parse(readFileSync(p, "utf8")) as JourneyEvidence;
        if (e && e.schema === 1 && typeof e.target === "string" && Array.isArray(e.steps)) out.push(e);
      } catch {
        /* not an evidence record */
      }
    }
  }
  return out;
}

/** One cell: explicit de-scope wins; else any passing record; else a failure; else nothing. */
export function cellFor(t: Target, step: StepName, evidence: JourneyEvidence[]): Cell {
  const reason = t.descopes?.[step] ?? t.descopes?.["*"];
  if (reason) return { kind: "descoped", reason };
  const records = evidence.filter((e) => e.target === t.id);
  const passes = records.filter((e) => e.steps.some((s) => s.step === step && s.status === "pass"));
  if (passes.length) {
    const classes = [...new Set(passes.map((e) => e.evidenceClass))].sort();
    const newest = passes.slice().sort((a, b) => b.at.localeCompare(a.at))[0]!;
    return { kind: "pass", classes, commit: newest.commit.slice(0, 8) };
  }
  const recDescope = records.flatMap((e) => e.steps).find((s) => s.step === step && s.status === "descoped");
  if (recDescope) return { kind: "descoped", reason: recDescope.detail };
  const fail = records.flatMap((e) => e.steps).find((s) => s.step === step && (s.status === "fail" || s.status === "blocked"));
  if (fail) return { kind: "fail", detail: fail.detail };
  return { kind: "none" };
}

export function render(targets: Targets, evidence: JourneyEvidence[]): { markdown: string; incomplete: string[] } {
  const notes: string[] = [];
  const noteIndex = new Map<string, number>();
  const note = (text: string) => {
    if (!noteIndex.has(text)) { notes.push(text); noteIndex.set(text, notes.length); }
    return noteIndex.get(text)!;
  };
  const incomplete: string[] = [];
  const rows = targets.targets.map((t) => {
    const cells = targets.steps.map((step) => {
      const c = cellFor(t, step, evidence);
      if ((c.kind === "none" || c.kind === "fail") && t.gating !== false) incomplete.push(`${t.id}:${step}`);
      if (c.kind === "pass") return `✅ ${c.classes.join("+")}`;
      if (c.kind === "descoped") return `➖ [${note(c.reason)}]`;
      if (c.kind === "fail") return `❌ [${note(c.detail.slice(0, 200))}]`;
      return "⏳";
    });
    const commits = [...new Set(evidence.filter((e) => e.target === t.id).map((e) => `${e.evidenceClass} ${e.commit.slice(0, 8)}${e.dirty ? "+local changes" : ""}${e.runUrl ? ` ([run](${e.runUrl}))` : ""}`))].sort();
    return `| ${t.surface} | ${t.label}${t.gating === false ? " ¹" : ""} | ${cells.join(" | ")} | ${commits.join("<br>") || "—"} |`;
  });
  const md = [
    BEGIN,
    "",
    "## Launch journeys — generated from gate evidence",
    "",
    "One row per claimed target (ledger §2.1). ✅ = a journey record passed that step (**CI** = hosted-runner run, **LR** = local run on real hardware); ➖ = explicitly de-scoped (reason below); ⏳ = no evidence yet; ❌ = the latest evidence failed. ¹ = non-gating (reported only, decision D7).",
    "Regenerate with `bun run support-matrix` after copying journey evidence into `docs/release/evidence/`; CI checks this block is current (`--check`).",
    "",
    `| Surface | Target | ${targets.steps.map((s) => (s === "agent" ? "Core-agent smoke" : s[0]!.toUpperCase() + s.slice(1))).join(" | ")} | Evidence |`,
    `|---|---|${targets.steps.map(() => "---").join("|")}|---|`,
    ...rows,
    "",
    ...notes.map((n, i) => `[${i + 1}] ${n.replace(/\|/g, "/")}  `),
    "",
    `Launch gate (\`--require-complete\`): ${incomplete.length === 0 ? "**complete** — every gating cell is ✅ or ➖." : `**incomplete** — ${incomplete.length} gating cell(s) without evidence or failing.`}`,
    "",
    END,
  ].join("\n");
  return { markdown: md, incomplete };
}

export function splice(doc: string, block: string): string {
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a >= 0 && b > a) return doc.slice(0, a) + block + doc.slice(b + END.length);
  const h = doc.indexOf("\n## ");
  return h >= 0 ? `${doc.slice(0, h)}\n\n${block}\n${doc.slice(h)}` : `${doc}\n\n${block}\n`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const targets = JSON.parse(readFileSync(join(ROOT, "docs/release/support-targets.json"), "utf8")) as Targets;
  const evidence = loadEvidence(resolve(get("--evidence") ?? join(ROOT, "docs/release/evidence")));
  const { markdown, incomplete } = render(targets, evidence);
  const docPath = join(ROOT, "docs/release/SUPPORT_MATRIX.md");
  const out = get("--out");
  if (argv.includes("--check")) {
    const doc = readFileSync(docPath, "utf8");
    const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
    if (a < 0 || b < a || doc.slice(a, b + END.length) !== markdown) {
      console.error("[support-matrix] docs/release/SUPPORT_MATRIX.md is stale — run `bun run support-matrix` and commit the result.");
      process.exit(1);
    }
    console.log(`[support-matrix] current (${evidence.length} evidence record(s))`);
  } else if (out) {
    writeFileSync(out, markdown + "\n");
    console.log(`[support-matrix] wrote ${out} from ${evidence.length} evidence record(s)`);
  } else {
    writeFileSync(docPath, splice(readFileSync(docPath, "utf8"), markdown));
    console.log(`[support-matrix] updated docs/release/SUPPORT_MATRIX.md from ${evidence.length} evidence record(s)`);
  }
  if (argv.includes("--require-complete") && incomplete.length) {
    console.error(`[support-matrix] launch gate incomplete: ${incomplete.join(", ")}`);
    process.exit(1);
  }
}
