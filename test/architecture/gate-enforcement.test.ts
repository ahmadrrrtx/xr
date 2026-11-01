/**
 * XR-P00 (D-021) — gate-enforcement inventory: the documented battery and
 * the workflows cannot drift apart again.
 *
 * Finding XRD-013 / evidence E-29: five scripts named in `package.json` →
 * `scripts.ci` were invoked by no workflow, so the required aggregate
 * (`Quality Gate`) passed while those gates never ran. Nothing compared
 * the battery definition against the workflows — `scripts/ci-policy.ts`
 * checks pins, aggregate shape and quarantine, but not battery coverage.
 *
 * This test closes that hole, deterministically and offline (it parses
 * `package.json` and the workflow YAML as data; no network, no `gh`):
 *
 *   1. Every gate in the `ci` battery is enforced by at least one
 *      workflow — by script name (`bun run <gate>`), by an alias script
 *      with the same body, or by the gate's underlying file invoked with
 *      the same mode flags (the E-29 command-form rule: invoking
 *      `scripts/changelog.ts --write` does NOT enforce
 *      `changelog:check`, whose mode is `--check`) — or it is listed in
 *      GATE_EXEMPTIONS below with a recorded reason.
 *   2. For every aggregate check named in `.github/required-checks.json`
 *      (e.g. ci.yml's `Quality Gate`), every battery gate implemented in
 *      that workflow is implemented by a non-advisory job that the
 *      aggregate `needs:` — a wired gate cannot be invisible to the
 *      aggregate (E-30). Advisory jobs (ci.yml `quarantine`,
 *      `test-e2e-blackbox-proof`) are read from required-checks.json,
 *      not re-decided here.
 *   3. Reverse direction: every battery entry exists in `scripts`;
 *      every root-context `bun run <name>` in a workflow step names a
 *      real root script; exemptions name real battery gates, carry a
 *      reason, and must not be stale (an enforced gate may not stay
 *      exempted); aggregate `needs:` entries name real jobs; and the
 *      battery may not silently shrink below the XR-P00 floor (removing
 *      a gate requires a recorded decision and an edit here).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/**
 * The ONLY sanctioned way for a battery gate to be unenforced: an entry
 * here with a dated, decision-referenced reason. This map must stay
 * small; the stale-exemption assertion below forces entries out as soon
 * as the gate is wired.
 */
const GATE_EXEMPTIONS: Record<string, string> = {
  "changelog:check":
    "XR-P00 (2026-11-01), D-020 BLOCKED — OWNER DECISION: the gate exits 1 " +
    "at the baseline (no entry for the in-development identity), so wiring it " +
    "as-is would turn main permanently red; D-020a's generated entry was " +
    "previewed and rejected by the executor's stop rule (432 lines / 404 " +
    "commits since v1.0.0, 247 of them already documented under 1.1.0, " +
    "because previousTagFor mis-ranges prerelease versions); D-020b's " +
    "re-scope requires an owner-approved AGENTS.md change the executor may " +
    "not make. Delete this exemption in the same change that resolves D-020.",
};

/** Battery floor at XR-P00: shrinking `scripts.ci` below this is a weakening. */
const BATTERY_FLOOR = [
  "typecheck",
  "bun test",
  "release:check",
  "channel:check",
  "claim-lint",
  "placeholder-lint",
  "desktop:sink-lint",
  "platform:parity:check",
  "changelog:check",
  "baseline:inventory",
  "ci-capability-gate",
  "api:schema:check",
  "client:check",
  "api:compat",
  "boundaries",
  "size-gate",
  "hot-path-lint",
  "ownership:check",
  "website:marketplace:check",
] as const;

const TEST_GATE = "bun test";

interface GateInfo {
  name: string;
  /** Workflow files invoking this gate (any accepted form). */
  workflows: Set<string>;
  /** workflow file → job ids implementing this gate (root-context steps). */
  jobsByWorkflow: Map<string, Set<string>>;
}

type Step = { name?: string; run?: string; "working-directory"?: string };
type Job = {
  name?: string;
  needs?: string | string[];
  steps?: Step[];
  defaults?: { run?: { "working-directory"?: string } };
};
type Workflow = { name?: string; jobs?: Record<string, Job> };
interface RequiredChecks {
  required: Array<{ workflow: string; job: string; context: string }>;
  advisoryJobs: Array<{ workflow: string; job: string }>;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const scripts = pkg.scripts;

const workflowFiles = readdirSync(join(ROOT, ".github/workflows"))
  .filter((f) => /\.yml$/.test(f))
  .sort();
const workflows = new Map<string, Workflow>();
for (const file of workflowFiles) {
  const text = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
  workflows.set(file, Bun.YAML.parse(text) as Workflow);
}

/** Battery gate names parsed from `scripts.ci` (`bun test` = the suite). */
function batteryGates(): string[] {
  return (scripts.ci ?? "").split("&&").map((part) => {
    const p = part.trim();
    if (p === "bun test") return TEST_GATE;
    const m = /^bun run ([^\s]+)$/.exec(p);
    if (!m) throw new Error(`gate-enforcement: cannot parse scripts.ci entry ${JSON.stringify(p)}`);
    return m[1]!;
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Script names whose body IS the gate (same body, or `bun run <gate>` wrapper). */
function aliasesOf(gate: string): string[] {
  const body = (scripts[gate] ?? "").trim();
  const out: string[] = [];
  for (const [name, candidate] of Object.entries(scripts)) {
    if (name === gate) continue;
    const b = candidate.trim();
    if (body !== "" && b === body) out.push(name);
    else if (new RegExp(`^bun run ${escapeRe(gate)}(?![\\w:.-])(\\s.*)?$`).test(b)) out.push(name);
  }
  return out;
}

/**
 * Underlying file + mode flags for a single-command gate body, e.g.
 * `bun run scripts/ownership-map.ts --check` → (scripts/ownership-map.ts, [--check]).
 * Multi-command bodies (typecheck) have no single file form → null.
 */
function fileFormOf(gate: string): { file: string; flags: string[] } | null {
  const body = (scripts[gate] ?? "").trim();
  if (/&&|;/.test(body)) return null;
  const m = /^bun (?:run )?(\S+\.(?:ts|js|mjs|sh))((?:\s+--?[^\s]+)*)$/.exec(body);
  if (!m) return null;
  return { file: m[1]!.replace(/^\.\//, ""), flags: (m[2] ?? "").split(/\s+/).filter((t) => t.startsWith("-")) };
}

/** True if one logical run: line invokes `gate` in any accepted form. */
function lineInvokesGate(line: string, gate: string, aliases: string[], fileForm: { file: string; flags: string[] } | null): boolean {
  if (gate === TEST_GATE) return /\bbun\s+test\b/.test(line);
  for (const name of [gate, ...aliases]) {
    if (new RegExp(`\\bbun\\s+run\\s+${escapeRe(name)}(?![\\w:.-])`).test(line)) return true;
  }
  if (fileForm) {
    const m = new RegExp(`\\bbun\\s+(?:run\\s+)?${escapeRe(fileForm.file)}(?![\\w/.-])(.*)$`).exec(line);
    if (m) {
      const args = (m[1] ?? "").split(/\s+/);
      // E-29 rule: the SAME mode flags must be present, or it is a
      // different invocation of the file (--write is not --check).
      if (fileForm.flags.every((f) => args.includes(f))) return true;
    }
  }
  return false;
}

/** Steps run at repo root (no job/step working-directory override). */
function isRootContext(job: Job, step: Step): boolean {
  const wd = step["working-directory"] ?? job.defaults?.run?.["working-directory"];
  return wd === undefined || wd === ".";
}

const inventory = new Map<string, GateInfo>();
for (const gate of batteryGates()) {
  const aliases = gate === TEST_GATE ? [] : aliasesOf(gate);
  const fileForm = gate === TEST_GATE ? null : fileFormOf(gate);
  const info: GateInfo = { name: gate, workflows: new Set(), jobsByWorkflow: new Map() };
  for (const [file, wf] of workflows) {
    for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (typeof step.run !== "string" || !isRootContext(job, step)) continue;
        const lines = step.run.replace(/\\\r?\n/g, " ").split(/\r?\n/);
        if (lines.some((l) => lineInvokesGate(l, gate, aliases, fileForm))) {
          info.workflows.add(file);
          if (!info.jobsByWorkflow.has(file)) info.jobsByWorkflow.set(file, new Set());
          info.jobsByWorkflow.get(file)!.add(jobId);
        }
      }
    }
  }
  inventory.set(gate, info);
}

const needsOf = (job: Job | undefined): string[] =>
  job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

describe("XR-P00 — gate-enforcement inventory (D-021)", () => {
  test("every battery gate is enforced by a workflow, or explicitly exempted with a reason", () => {
    const violations: string[] = [];
    for (const gate of batteryGates()) {
      if (gate in GATE_EXEMPTIONS) continue;
      if (inventory.get(gate)!.workflows.size === 0) {
        violations.push(
          `${gate}: named in package.json scripts.ci but invoked by no workflow ` +
            `(script name, alias, and command form all absent) — wire it or exempt it in GATE_EXEMPTIONS with a decision reference`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("each required aggregate needs a gating job implementing every gate its workflow runs", () => {
    const rc = JSON.parse(readFileSync(join(ROOT, ".github/required-checks.json"), "utf8")) as RequiredChecks;
    const violations: string[] = [];
    for (const req of rc.required) {
      const wf = workflows.get(req.workflow);
      const gateJob = wf?.jobs?.[req.job];
      const needed = new Set(needsOf(gateJob));
      const advisory = new Set(rc.advisoryJobs.filter((a) => a.workflow === req.workflow).map((a) => a.job));
      for (const gate of batteryGates()) {
        const implementing = inventory.get(gate)!.jobsByWorkflow.get(req.workflow);
        if (!implementing || implementing.size === 0) continue;
        const gating = [...implementing].filter((j) => j !== req.job && !advisory.has(j));
        if (gating.length === 0) {
          violations.push(`${req.workflow}: ${gate} is implemented only by advisory job(s) ${[...implementing].join(", ")} — ${req.context} cannot see it`);
        } else if (!gating.some((j) => needed.has(j))) {
          violations.push(
            `${req.workflow}: ${gate} runs in job(s) ${gating.join(", ")} but ${req.context} (${req.job}) needs none of them — ` +
              `the aggregate would pass while this gate fails (E-30)`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("reverse: battery entries, workflow script names, exemptions and needs all resolve", () => {
    const violations: string[] = [];
    const battery = batteryGates();

    for (const gate of battery) {
      if (gate !== TEST_GATE && !(gate in scripts)) {
        violations.push(`scripts.ci names "${gate}" but package.json has no such script`);
      }
    }
    for (const floor of BATTERY_FLOOR) {
      if (!battery.includes(floor)) {
        violations.push(`scripts.ci no longer contains "${floor}" — removing a gate from the battery is a weakening and needs a recorded decision, not silence`);
      }
    }

    for (const [file, wf] of workflows) {
      for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
        for (const need of needsOf(job)) {
          if (!(need in (wf.jobs ?? {}))) violations.push(`${file}: job ${jobId} needs "${need}", which is not a job in that workflow`);
        }
        for (const step of job.steps ?? []) {
          if (typeof step.run !== "string" || !isRootContext(job, step)) continue;
          for (const m of step.run.matchAll(/\bbun\s+run\s+([^\s;&|]+)/g)) {
            const scriptName = m[1]!;
            if (scriptName.includes("/") || /\.(ts|js|mjs|sh)$/.test(scriptName) || scriptName.startsWith("-") || scriptName.startsWith("$")) continue;
            if (!(scriptName in scripts)) {
              violations.push(`${file}: job ${jobId} runs \`bun run ${token}\` but package.json has no root script "${scriptName}"`);
            }
          }
        }
      }
    }

    for (const [gate, reason] of Object.entries(GATE_EXEMPTIONS)) {
      if (!battery.includes(gate)) violations.push(`GATE_EXEMPTIONS names "${gate}", which is not in scripts.ci — stale exemption`);
      if (reason.trim().length < 40) violations.push(`GATE_EXEMPTIONS["${gate}"] needs a real, decision-referenced reason (≥40 chars)`);
      if ((inventory.get(gate)?.workflows.size ?? 0) > 0) {
        violations.push(`GATE_EXEMPTIONS["${gate}"] is stale: the gate IS enforced (${[...inventory.get(gate)!.workflows].join(", ")}) — delete the exemption`);
      }
    }
    expect(violations).toEqual([]);
  });
});
