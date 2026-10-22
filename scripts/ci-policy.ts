#!/usr/bin/env bun
/**
 * XR-LAUNCH-012 — CI policy, checked on every PR (ci.yml truth-gate).
 *
 *   1. every third-party action is pinned to a full commit SHA with the tag in
 *      a trailing comment (Dependabot moves the pins; .github/dependabot.yml)
 *   2. every setup-bun step reads `bun-version-file: .bun-version` (D4)
 *   3. every required check (.github/required-checks.json) is an aggregate
 *      gate job that runs on pull_request + push to main with no `paths:`
 *      filter, `if: always()`, and needs every other job of its workflow
 *      except the declared advisory jobs
 *   4. no continue-on-error in a required workflow, except: declared advisory
 *      jobs, declared non-gating matrix legs (a `matrix.` expression), and
 *      failure-only diagnostic steps
 *   5. non-gating workflows say so in their name ("(non-gating)")
 *   6. the flaky-test quarantine is valid and unexpired
 *   7. explicit runner images (no ubuntu-latest) and first-party actions/*
 *      at or above their first Node-24 major (XR-LAUNCH-032)
 *
 *   bun run ci:policy            exit 1 with one line per violation
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkQuarantine, loadQuarantine } from "./quarantine.ts";

const ROOT = resolve(import.meta.dir, "..");
/** Reusable workflows whose provenance verification requires a tag ref. */
export const TAG_PIN_ALLOWED = ["slsa-framework/slsa-github-generator/"];

interface RequiredChecks {
  required: Array<{ workflow: string; job: string; context: string }>;
  advisoryJobs: Array<{ workflow: string; job: string }>;
  nonGatingLegs: Array<{ workflow: string; job: string; leg: string }>;
  nonGating: Array<{ workflow: string }>;
}
type Step = { name?: string; uses?: string; if?: string; with?: Record<string, unknown>; "continue-on-error"?: unknown };
type Job = { name?: string; needs?: string | string[]; if?: string; steps?: Step[]; uses?: string; "continue-on-error"?: unknown };
type Workflow = { name?: string; on?: unknown; true?: unknown; jobs: Record<string, Job> };

/** Rule 1 on raw text (comments matter): returns violations for one file. */
export function checkPins(file: string, text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*([^\s#]+)\s*(#.*)?$/.exec(line);
    if (!m) return;
    const ref = m[1]!;
    if (ref.startsWith("./") || ref.startsWith("docker://")) return;
    if (TAG_PIN_ALLOWED.some((p) => ref.startsWith(p))) return;
    const at = ref.lastIndexOf("@");
    const sha = at > 0 ? ref.slice(at + 1) : "";
    if (!/^[0-9a-f]{40}$/.test(sha)) out.push(`${file}:${i + 1}: ${ref} is not pinned to a commit SHA`);
    else if (!m[2] || !/#\s*\S+/.test(m[2])) out.push(`${file}:${i + 1}: ${ref} has no "# <tag>" comment`);
  });
  return out;
}

/** First major of each first-party action whose default runtime is node24. */
export const NODE24_MIN_MAJOR: Record<string, number> = {
  "actions/checkout": 5, "actions/cache": 5, "actions/setup-node": 5,
  "actions/upload-artifact": 6, "actions/download-artifact": 7, "actions/github-script": 8,
};

/** Rule 7 on raw text: a floating runner image or a Node 20-era action major. */
export function checkRuntime(file: string, text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\s#.*$/, "");
    if (/^\s*#/.test(line)) return;
    if (/\bubuntu-latest\b/.test(code)) out.push(`${file}:${i + 1}: ubuntu-latest floats between images — name one (ubuntu-24.04)`);
    const m = /^\s*(?:-\s+)?uses:\s*([^\s#@]+)@\S+\s*(#.*)?$/.exec(line);
    if (!m) return;
    const action = m[1]!.split("/").slice(0, 2).join("/");
    const min = NODE24_MIN_MAJOR[action];
    if (min === undefined) return;
    const major = Number(/#\s*v(\d+)/.exec(m[2] ?? "")?.[1] ?? NaN);
    if (!(major >= min)) out.push(`${file}:${i + 1}: ${action} must be v${min}+ (first Node-24 major); the pin comment says ${JSON.stringify((m[2] ?? "").trim())}`);
  });
  return out;
}

const needsOf = (j: Job): string[] => (j.needs === undefined ? [] : Array.isArray(j.needs) ? j.needs : [j.needs]);
const triggers = (w: Workflow): Record<string, unknown> => {
  const on = (w as Record<string, unknown>).on ?? (w as Record<string, unknown>)["true"];
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((k) => [k, null]));
  return (on as Record<string, unknown>) ?? {};
};

export function checkWorkflows(workflows: Record<string, { parsed: Workflow; text: string }>, rc: RequiredChecks): string[] {
  const out: string[] = [];
  for (const [file, { parsed, text }] of Object.entries(workflows)) {
    out.push(...checkPins(file, text), ...checkRuntime(file, text));
    for (const [jid, job] of Object.entries(parsed.jobs ?? {})) {
      for (const st of job.steps ?? []) {
        if (st.uses?.startsWith("oven-sh/setup-bun@")) {
          if (st.with?.["bun-version-file"] !== ".bun-version" || st.with?.["bun-version"] !== undefined) out.push(`${file}: job ${jid}: setup-bun must use bun-version-file: .bun-version`);
        }
      }
    }
  }
  const requiredFiles = new Set(rc.required.map((r) => r.workflow));
  for (const r of rc.required) {
    const wf = workflows[r.workflow];
    if (!wf) { out.push(`required check ${r.context}: ${r.workflow} does not exist`); continue; }
    const w = wf.parsed;
    const on = triggers(w);
    for (const ev of ["pull_request", "push"]) {
      const t = on[ev] as Record<string, unknown> | null | undefined;
      if (!(ev in on)) { out.push(`${r.workflow}: required workflow does not run on ${ev}`); continue; }
      if (t && (t.paths || t["paths-ignore"])) out.push(`${r.workflow}: required workflow has a ${ev} paths filter (it would never report on other PRs)`);
      const branches = (t?.branches as string[] | undefined) ?? null;
      if (branches && !branches.includes("main")) out.push(`${r.workflow}: ${ev} does not cover main`);
    }
    const gate = w.jobs?.[r.job];
    if (!gate) { out.push(`${r.workflow}: gate job ${r.job} missing`); continue; }
    if (gate.name !== r.context) out.push(`${r.workflow}: gate job ${r.job} is named ${JSON.stringify(gate.name)}, branch protection expects ${JSON.stringify(r.context)}`);
    if (!String(gate.if ?? "").includes("always()")) out.push(`${r.workflow}: gate job ${r.job} needs if: always() (else a failed dependency SKIPS the gate, and skipped can satisfy protection)`);
    const advisory = new Set(rc.advisoryJobs.filter((a) => a.workflow === r.workflow).map((a) => a.job));
    const want = Object.keys(w.jobs).filter((j) => j !== r.job && !advisory.has(j));
    const have = new Set(needsOf(gate));
    for (const j of want) if (!have.has(j)) out.push(`${r.workflow}: gate ${r.job} does not need job ${j}`);
    for (const j of advisory) if (have.has(j)) out.push(`${r.workflow}: advisory job ${j} must stay outside the gate's needs`);
    for (const [jid, job] of Object.entries(w.jobs)) {
      const coe = job["continue-on-error"];
      if (coe !== undefined && coe !== false) {
        const leg = rc.nonGatingLegs.some((l) => l.workflow === r.workflow && l.job === jid) && typeof coe === "string" && coe.includes("matrix.");
        if (!advisory.has(jid) && !leg) out.push(`${r.workflow}: job ${jid} has continue-on-error (declare it advisory or a non-gating matrix leg in .github/required-checks.json)`);
      }
      for (const st of job.steps ?? []) {
        if (st["continue-on-error"] !== undefined && st["continue-on-error"] !== false && !String(st.if ?? "").includes("failure()")) {
          out.push(`${r.workflow}: job ${jid}: step ${JSON.stringify(st.name ?? st.uses)} has continue-on-error outside a failure()-only diagnostic`);
        }
      }
    }
  }
  for (const n of rc.nonGating) {
    const wf = workflows[n.workflow];
    if (!wf) { out.push(`non-gating ${n.workflow} does not exist`); continue; }
    if (!/\(non-gating\)/.test(wf.parsed.name ?? "")) out.push(`${n.workflow}: non-gating workflow must say "(non-gating)" in its name`);
    if (requiredFiles.has(n.workflow)) out.push(`${n.workflow}: listed as both required and non-gating`);
  }
  return out;
}

export function loadWorkflows(dir = join(ROOT, ".github/workflows")): Record<string, { parsed: Workflow; text: string }> {
  const out: Record<string, { parsed: Workflow; text: string }> = {};
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    out[f] = { parsed: Bun.YAML.parse(text) as Workflow, text };
  }
  return out;
}

if (import.meta.main) {
  const rc = JSON.parse(readFileSync(join(ROOT, ".github/required-checks.json"), "utf8")) as RequiredChecks;
  const problems = checkWorkflows(loadWorkflows(), rc);
  problems.push(...checkQuarantine(loadQuarantine(), new Date().toISOString().slice(0, 10)).map((p) => `quarantine: ${p}`));
  const dep = join(ROOT, ".github/dependabot.yml");
  if (!existsSync(dep) || !/package-ecosystem:\s*github-actions/.test(readFileSync(dep, "utf8"))) problems.push(".github/dependabot.yml must keep the github-actions SHA pins updated");
  for (const p of problems) console.error(`::error::ci-policy: ${p}`);
  if (problems.length) {
    console.error(`[ci-policy] ${problems.length} violation(s) — see docs/ci/CI.md`);
    process.exit(1);
  }
  console.log(`[ci-policy] OK — ${rc.required.length} required checks, ${Object.keys(loadWorkflows()).length} workflows`);
}
