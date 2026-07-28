/**
 * XR 7.0 — Evaluation CLI (Phase 13).
 *
 * Surfaces the evaluation harness:
 *   run, inspect, compare, regressions, export, certify, compatibility,
 *   claims, limitations, verify, reproduce.
 *
 * Design rules:
 *   - No marketing-only score page. Every view shows configuration,
 *     failures, limitations, and what the result does not prove.
 *   - Read-only by default; `run` writes results only when asked.
 *   - Works fully offline on `personal_local` with no control plane.
 */

import { join } from "node:path";
import { writeFileSync } from "node:fs";
import type { Command, CommandContext } from "../core/command-registry.ts";
import { colors as C, heading, ok, warn, error, info } from "../interfaces/cli.ts";
import { CORE_VERSION } from "../core/version.ts";
import { XR_HOME } from "../config/config.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import {
  ALL_SUITES,
  EvaluationRepository,
  EvaluationRunner,
  adaptStoreForEvaluation,
  assertNoUnsupportedSuperiorityClaim,
  auditClaims,
  buildCompatibilityReport,
  buildEvidenceBundle,
  buildScorecard,
  certify,
  compareRuns,
  effectiveStatus,
  evaluateRegressionGate,
  fingerprintSuites,
  PHASE13_DISCOVERED_GAPS,
  renderComparison,
  renderScenarioDetail,
  renderScorecard,
  scorecardJson,
  verifyEvidenceBundle,
  XR_CLAIMS,
  type CertificationTarget,
  type EvaluationRun,
  type ScenarioSet,
} from "../evaluation/index.ts";

// ── Arg parsing (mirrors src/commands/enterprise.ts) ──────────────────────────

type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) flags[key] = args[++i]!;
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function flagStr(flags: Parsed["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagList(flags: Parsed["flags"], key: string): string[] {
  const v = flagStr(flags, key);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function isJson(flags: Parsed["flags"]): boolean {
  return flags.json === true || flags.json === "true";
}

// ── Repository wiring ─────────────────────────────────────────────────────────

function openRepository(): { repo: EvaluationRepository; close: () => void } {
  const store = new WorkspaceStore("default", join(XR_HOME, "xr.db"));
  const repo = new EvaluationRepository(adaptStoreForEvaluation(store));
  return {
    repo,
    close: () => {
      try {
        store.close();
      } catch {
        /* noop */
      }
    },
  };
}

// ── Command ───────────────────────────────────────────────────────────────────

export class EvaluateCommand implements Command {
  name = "evaluate";
  description = "run outcome benchmarks, inspect evidence, compare releases, and certify by evidence";
  usage =
    "xr evaluate [run|list|inspect|compare|regressions|export|verify|certify|compatibility|claims|limitations|suites|reproduce|gaps]";

  async execute(ctx: CommandContext): Promise<void> {
    const { positional, flags } = parse(ctx.args);
    const sub = positional[0] ?? "help";

    switch (sub) {
      case "run":
        return this.run(positional.slice(1), flags);
      case "suites":
        return this.suites(flags);
      case "list":
        return this.list(flags);
      case "inspect":
        return this.inspect(positional[1], flags);
      case "compare":
        return this.compare(positional[1], positional[2], flags);
      case "regressions":
        return this.regressions(flags);
      case "export":
        return this.export(positional[1], flags);
      case "verify":
        return this.verify(positional[1], flags);
      case "certify":
        return this.certify(positional[1], positional[2], flags);
      case "compatibility":
        return this.compatibility(flags);
      case "claims":
        return this.claims(flags);
      case "limitations":
        return this.limitations(flags);
      case "reproduce":
        return this.reproduce(positional[1], flags);
      case "gaps":
        return this.gaps(flags);
      default:
        return this.help();
    }
  }

  // ── run ────────────────────────────────────────────────────────────────────

  private async run(args: string[], flags: Parsed["flags"]): Promise<void> {
    const suiteIds = args.length > 0 ? args : flagList(flags, "suite");
    const scenarioIds = flagList(flags, "scenario");
    const sets = flagList(flags, "set") as ScenarioSet[];
    const offline = flags.offline === true || flags.offline === "true";
    const profile = flagStr(flags, "profile") ?? "personal_local";
    const save = flags.save === true || flags.save === "true";
    const json = isJson(flags);

    const runner = new EvaluationRunner(ALL_SUITES);

    if (!json) {
      heading("XR evaluation");
      console.log(
        `  ${C.dim("suites:")} ${suiteIds.length > 0 ? suiteIds.join(", ") : "all"}   ` +
          `${C.dim("profile:")} ${profile}   ${C.dim("offline:")} ${offline ? "yes" : "no"}`,
      );
      console.log("");
    }

    const started = Date.now();
    const run = await runner.run({
      ...(suiteIds.length > 0 ? { suiteIds } : {}),
      ...(scenarioIds.length > 0 ? { scenarioIds } : {}),
      ...(sets.length > 0 ? { sets } : {}),
      offline,
      offlineOnly: flags["offline-only"] === true,
      deploymentProfile: profile,
      onScenario: json
        ? undefined
        : (r) => {
            const mark =
              r.status === "passed"
                ? `${C.green("✓")}`
                : r.status === "partial"
                  ? `${C.yellow("~")}`
                  : r.status === "not_applicable"
                    ? `${C.dim("·")}`
                    : `${C.red("✗")}`;
            console.log(`  ${mark} ${r.scenarioId.padEnd(48)} ${C.dim(`${r.status} (${r.durationMs}ms)`)}`);
          },
    });

    if (save) {
      const { repo, close } = openRepository();
      try {
        repo.save(run);
        if (!json) {
          console.log("");
          ok(`saved run ${run.provenance.runId}`);
        }
      } finally {
        close();
      }
    }

    if (json) {
      console.log(JSON.stringify(scorecardJson(run), null, 2));
      return;
    }

    console.log("");
    console.log(renderScorecard(run));

    const card = buildScorecard(run);
    const failing = run.suites.flatMap((s) =>
      s.scenarios.filter((x) => x.status === "failed" || x.status === "blocked" || x.status === "errored"),
    );
    if (failing.length > 0) {
      console.log("");
      heading("failures");
      console.log(renderScenarioDetail(run));
    }

    console.log("");
    console.log(`${C.dim(`elapsed ${Date.now() - started}ms · ${save ? "saved" : "not saved (use --save)"}`)}`);
    if (card.hardFailure) process.exitCode = 1;
  }

  // ── suites ─────────────────────────────────────────────────────────────────

  private suites(flags: Parsed["flags"]): void {
    const runner = new EvaluationRunner(ALL_SUITES);
    if (isJson(flags)) {
      console.log(
        JSON.stringify(
          ALL_SUITES.map((s) => ({
            id: s.id,
            version: s.version,
            dimension: s.dimension,
            title: s.title,
            scenarios: s.scenarios.map((x) => ({
              id: x.id,
              version: x.version,
              set: x.set,
              determinism: x.determinism,
              offlineCapable: x.offlineCapable,
              intent: x.intent,
              expectedOutcome: x.expectedOutcome,
              contracts: x.contracts,
              blindSpots: x.blindSpots,
            })),
          })),
          null,
          2,
        ),
      );
      return;
    }

    heading("evaluation suites");
    for (const s of ALL_SUITES) {
      console.log(`\n${C.bold(`${s.id}`)} ${C.dim(`v${s.version} · ${s.dimension}`)}`);
      console.log(`  ${s.description}`);
      for (const sc of s.scenarios) {
        console.log(
          `    ${C.dim("·")} ${sc.id} ${C.dim(`v${sc.version} [${sc.set}/${sc.determinism}]${sc.offlineCapable ? " offline" : ""}`)}`,
        );
      }
    }
    console.log(
      `\n${C.dim(`${ALL_SUITES.length} suites · ${runner.totalScenarioCount()} scenarios · ${runner.offlineCapableCount()} offline-capable`)}`,
    );
  }

  // ── list / inspect ─────────────────────────────────────────────────────────

  private list(flags: Parsed["flags"]): void {
    const { repo, close } = openRepository();
    try {
      const runs = repo.list({
        includeInvalidated: flags.all === true,
        ...(flagStr(flags, "version") ? { productVersion: flagStr(flags, "version")! } : {}),
      });
      if (isJson(flags)) {
        console.log(
          JSON.stringify(
            runs.map((r) => ({
              runId: r.run.provenance.runId,
              productVersion: r.run.provenance.productVersion,
              commit: r.run.provenance.commit,
              startedAt: r.run.provenance.startedAt,
              profile: r.run.provenance.configuration.deploymentProfile,
              integrityValid: r.integrityValid,
              invalidated: Boolean(r.run.invalidation),
            })),
            null,
            2,
          ),
        );
        return;
      }

      heading("stored evaluation runs");
      if (runs.length === 0) {
        console.log(`  ${C.dim(`none yet — run \`xr evaluate run --save\``)}`);
        return;
      }
      for (const r of runs) {
        const p = r.run.provenance;
        const flagsText = [
          r.integrityValid ? "" : `${C.red("INTEGRITY MISMATCH")}`,
          r.run.invalidation ? `${C.yellow("invalidated")}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        console.log(
          `  ${p.runId}  ${C.dim(`v${p.productVersion} ${p.commit.slice(0, 8)} ${new Date(p.startedAt).toISOString()} ${p.configuration.deploymentProfile}`)} ${flagsText}`,
        );
      }
    } finally {
      close();
    }
  }

  private inspect(runId: string | undefined, flags: Parsed["flags"]): void {
    if (!runId) {
      error("usage: xr evaluate inspect <runId> [--suite <id>] [--json]");
      process.exitCode = 1;
      return;
    }
    const { repo, close } = openRepository();
    try {
      const stored = repo.get(runId);
      if (!stored) {
        error(`unknown run "${runId}"`);
        process.exitCode = 1;
        return;
      }
      if (isJson(flags)) {
        console.log(JSON.stringify({ ...scorecardJson(stored.run), integrityValid: stored.integrityValid }, null, 2));
        return;
      }
      console.log(renderScorecard(stored.run));
      console.log("");
      if (stored.integrityValid) ok(stored.integrityDetail); else error(stored.integrityDetail);
      console.log(renderScenarioDetail(stored.run, flagStr(flags, "suite")));
    } finally {
      close();
    }
  }

  // ── compare / regressions ──────────────────────────────────────────────────

  private compare(baselineId: string | undefined, candidateId: string | undefined, flags: Parsed["flags"]): void {
    if (!baselineId || !candidateId) {
      error("usage: xr evaluate compare <baselineRunId> <candidateRunId> [--json]");
      process.exitCode = 1;
      return;
    }
    const { repo, close } = openRepository();
    try {
      const a = repo.get(baselineId);
      const b = repo.get(candidateId);
      if (!a || !b) {
        error(`unknown run: ${!a ? baselineId : candidateId}`);
        process.exitCode = 1;
        return;
      }
      const comparison = compareRuns(a.run, b.run);
      const gate = evaluateRegressionGate(comparison);
      if (isJson(flags)) {
        console.log(JSON.stringify({ comparison, gate }, null, 2));
        return;
      }
      console.log(renderComparison(comparison));
      console.log("");
      if (gate.pass) ok("no critical regressions"); else error(`${gate.criticalCount} critical regression(s)`);
      if (!gate.pass) process.exitCode = 1;
    } finally {
      close();
    }
  }

  private regressions(flags: Parsed["flags"]): void {
    const { repo, close } = openRepository();
    try {
      const runs = repo.list({ limit: 2 });
      if (runs.length < 2) {
        warn("need at least two stored runs to detect regressions");
        return;
      }
      const comparison = compareRuns(runs[1]!.run, runs[0]!.run);
      const gate = evaluateRegressionGate(comparison);
      if (isJson(flags)) {
        console.log(JSON.stringify({ comparison, gate }, null, 2));
        return;
      }
      console.log(renderComparison(comparison));
      if (!gate.pass) process.exitCode = 1;
    } finally {
      close();
    }
  }

  // ── export / verify ────────────────────────────────────────────────────────

  private export(runId: string | undefined, flags: Parsed["flags"]): void {
    if (!runId) {
      error("usage: xr evaluate export <runId> [--out <file>]");
      process.exitCode = 1;
      return;
    }
    const { repo, close } = openRepository();
    try {
      const stored = repo.get(runId);
      if (!stored) {
        error(`unknown run "${runId}"`);
        process.exitCode = 1;
        return;
      }
      const bundle = buildEvidenceBundle(stored.run);
      const out = flagStr(flags, "out");
      const text = JSON.stringify(bundle, null, 2);
      if (out) {
        writeFileSync(out, text, "utf8");
        ok(`wrote evidence bundle to ${out}`);
        console.log(`  ${C.dim(`digest ${bundle.bundleDigest}`)}`);
        console.log(`  ${C.dim(`${bundle.verificationInstructions}`)}`);
      } else {
        console.log(text);
      }
    } finally {
      close();
    }
  }

  private verify(runId: string | undefined, flags: Parsed["flags"]): void {
    const { repo, close } = openRepository();
    try {
      if (runId) {
        const stored = repo.get(runId);
        if (!stored) {
          error(`unknown run "${runId}"`);
          process.exitCode = 1;
          return;
        }
        const bundle = buildEvidenceBundle(stored.run);
        const bundleCheck = verifyEvidenceBundle(bundle);
        if (isJson(flags)) {
          console.log(JSON.stringify({ runId, storedIntegrity: stored.integrityDetail, valid: stored.integrityValid, bundleCheck }, null, 2));
          return;
        }
        if (stored.integrityValid) ok(stored.integrityDetail); else error(stored.integrityDetail);
        if (bundleCheck.valid) ok(bundleCheck.detail); else error(bundleCheck.detail);
        if (!stored.integrityValid || !bundleCheck.valid) process.exitCode = 1;
        return;
      }

      const all = repo.verifyAll();
      if (isJson(flags)) {
        console.log(JSON.stringify(all, null, 2));
        return;
      }
      heading("result integrity");
      if (all.length === 0) {
        console.log(`  ${C.dim("no stored runs")}`);
        return;
      }
      for (const r of all) { if (r.valid) ok(r.runId); else error(`${r.runId}: ${r.detail}`); }
      if (all.some((r) => !r.valid)) process.exitCode = 1;
    } finally {
      close();
    }
  }

  // ── certify ────────────────────────────────────────────────────────────────

  private certify(target: string | undefined, subjectId: string | undefined, flags: Parsed["flags"]): void {
    const validTargets: CertificationTarget[] = [
      "provider",
      "capability",
      "workflow",
      "deployment_profile",
      "runtime_version",
    ];
    if (!target || !validTargets.includes(target as CertificationTarget)) {
      error(`usage: xr evaluate certify <${validTargets.join("|")}> <subjectId> [--run <runId>]`);
      process.exitCode = 1;
      return;
    }

    const { repo, close } = openRepository();
    try {
      const runId = flagStr(flags, "run");
      const runs: EvaluationRun[] = runId
        ? [repo.get(runId)?.run].filter((r): r is EvaluationRun => Boolean(r))
        : repo.list({ limit: 5 }).map((s) => s.run);

      if (runs.length === 0) {
        warn("no evaluation evidence available — run `xr evaluate run --save` first");
        process.exitCode = 1;
        return;
      }

      const record = certify({
        target: target as CertificationTarget,
        subjectId: subjectId ?? "@rrrtx/xr",
        subjectVersion: flagStr(flags, "subject-version") ?? CORE_VERSION,
        runs,
      });

      if (isJson(flags)) {
        console.log(JSON.stringify({ ...record, effectiveStatus: effectiveStatus(record) }, null, 2));
        return;
      }

      heading(`certification — ${target}`);
      console.log(`  ${C.dim("subject:")} ${record.subjectId} v${record.subjectVersion}`);
      console.log(`  ${C.dim("status: ")} ${record.status}`);
      console.log(`  ${C.dim("issued: ")} ${new Date(record.issuedAt).toISOString()}`);
      console.log(`  ${C.dim("expires:")} ${new Date(record.expiresAt).toISOString()}`);
      console.log(`  ${C.dim("evidence:")} ${record.evidence.length} scenario result(s)`);
      for (const e of record.evidence) {
        console.log(`    ${C.dim("·")} ${e.scenarioId} v${e.scenarioVersion} → ${e.status} (run ${e.runId.slice(0, 16)}…)`);
      }
      if (record.unmetRequirements.length > 0) {
        console.log(`\n  ${C.yellow("unmet requirements:")}`);
        for (const u of record.unmetRequirements) console.log(`    ✗ ${u}`);
      }
      console.log(`\n  ${C.dim("limitations:")}`);
      for (const l of record.limitations) console.log(`    • ${l}`);
    } finally {
      close();
    }
  }

  // ── compatibility ──────────────────────────────────────────────────────────

  private async compatibility(flags: Parsed["flags"]): Promise<void> {
    const report = await buildCompatibilityReport();
    if (isJson(flags)) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    heading(`compatibility — XR ${report.productVersion}`);
    for (const c of report.checks) {
      const mark = c.compatible ? `${C.green("✓")}` : `${C.red("✗")}`;
      console.log(`  ${mark} ${c.id.padEnd(34)} ${C.dim(`[${c.change}]`)} ${c.detail}`);
    }
    console.log("");
    if (report.compatible) ok("no breaking contract changes");
    else error(`${report.breakingCount} breaking contract change(s)`);
    if (!report.compatible) process.exitCode = 1;
  }

  // ── claims ─────────────────────────────────────────────────────────────────

  private claims(flags: Parsed["flags"]): void {
    const { repo, close } = openRepository();
    try {
      const runs = repo.list({ limit: 5 }).map((s) => s.run);
      const audit = auditClaims(runs);

      let guard = "guard passed";
      try {
        assertNoUnsupportedSuperiorityClaim();
      } catch (e) {
        guard = e instanceof Error ? e.message : String(e);
      }

      if (isJson(flags)) {
        console.log(JSON.stringify({ ...audit, superiorityGuard: guard }, null, 2));
        return;
      }

      heading("public claims and their evidence");
      for (const c of XR_CLAIMS) {
        const tag =
          c.classification === "verified_by_benchmark"
            ? `${C.green("benchmark")}`
            : c.classification === "verified_by_contract"
              ? `${C.green("contract")}`
              : c.classification === "documented_limitation"
                ? `${C.yellow("limited")}`
                : c.classification === "product_vision"
                  ? `${C.dim("vision")}`
                  : `${C.red("unsupported")}`;
        console.log(`\n  [${tag}] ${C.bold(`${c.id}`)}`);
        console.log(`    "${c.statement}"`);
        if (c.evidenceScenarios.length > 0) console.log(`    ${C.dim(`scenarios: ${c.evidenceScenarios.join(", ")}`)}`);
        if (c.evidenceTests.length > 0) console.log(`    ${C.dim(`tests:     ${c.evidenceTests.join(", ")}`)}`);
        console.log(`    ${C.dim(`does NOT prove: ${c.doesNotProve}`)}`);
        if (c.requiredCorrection) console.log(`    ${C.yellow(`correction required: ${c.requiredCorrection}`)}`);
      }

      console.log("");
      if (audit.unsupported.length > 0) {
        error(`${audit.unsupported.length} claim(s) lack current evidence:`);
        for (const u of audit.unsupported) console.log(`  ✗ ${u}`);
        process.exitCode = 1;
      } else {
        ok("every non-vision claim is bound to evidence");
      }
      console.log(`${C.dim(`superiority guard: ${guard}`)}`);
    } finally {
      close();
    }
  }

  // ── limitations / gaps ─────────────────────────────────────────────────────

  private limitations(flags: Parsed["flags"]): void {
    const blindSpots = new Set<string>();
    for (const s of ALL_SUITES) for (const sc of s.scenarios) for (const b of sc.blindSpots) blindSpots.add(b);

    if (isJson(flags)) {
      console.log(JSON.stringify({ blindSpots: [...blindSpots] }, null, 2));
      return;
    }
    heading("what XR's benchmarks do not measure");
    for (const b of blindSpots) console.log(`  • ${b}`);
    console.log("");
    console.log(`${C.dim("These are published deliberately. A benchmark that hides its blind spots is marketing.")}`);
  }

  private gaps(flags: Parsed["flags"]): void {
    if (isJson(flags)) {
      console.log(JSON.stringify(PHASE13_DISCOVERED_GAPS, null, 2));
      return;
    }
    heading("gaps discovered by evaluation");
    for (const g of PHASE13_DISCOVERED_GAPS) {
      const tag = g.fixableInPhase ? `${C.yellow(`${g.classification}`)}` : `${C.dim(`${g.classification}`)}`;
      console.log(`\n  [${tag}] ${C.bold(`${g.id}`)} ${C.dim(`owner: ${g.owner}`)}`);
      console.log(`    ${g.summary}`);
      console.log(`    ${C.dim(`${g.detail}`)}`);
    }
  }

  // ── reproduce ──────────────────────────────────────────────────────────────

  private async reproduce(scenarioId: string | undefined, flags: Parsed["flags"]): Promise<void> {
    if (!scenarioId) {
      error("usage: xr evaluate reproduce <scenarioId> [--runs 3]");
      process.exitCode = 1;
      return;
    }
    const runner = new EvaluationRunner(ALL_SUITES);
    const runs = Number(flagStr(flags, "runs") ?? 3);
    const result = await runner.checkReproducibility(scenarioId, Number.isFinite(runs) ? runs : 3, {
      offline: flags.offline === true,
    });

    if (isJson(flags)) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    heading(`reproducibility — ${scenarioId}`);
    console.log(`  ${C.dim("declared determinism:")} ${result.declaredDeterminism}`);
    console.log(`  ${C.dim("statuses:")} ${result.statuses.join(", ")}`);
    console.log("");
    if (result.reproducible) ok(result.detail); else error(result.detail);
    if (!result.reproducible && result.declaredDeterminism === "deterministic") process.exitCode = 1;
  }

  // ── help ───────────────────────────────────────────────────────────────────

  private help(): void {
    const runner = new EvaluationRunner(ALL_SUITES);
    heading("xr evaluate — outcome benchmarks and evidence");
    console.log(`
  ${C.bold("run")} [suite...]              run benchmark suites
      --save                     store the result for longitudinal comparison
      --offline                  run with no network permitted
      --offline-only             only scenarios that are offline-capable
      --profile <kind>           deployment profile (default personal_local)
      --set <dev,validation,independent>
      --scenario <id,...>        run specific scenarios
      --json                     machine-readable scorecard

  ${C.bold("suites")}                     list suites, scenarios, and their versions
  ${C.bold("list")}                       stored runs        ${C.dim("--all --version <v>")}
  ${C.bold("inspect")} <runId>            full scorecard + per-scenario detail
  ${C.bold("compare")} <base> <candidate> regression comparison between two runs
  ${C.bold("regressions")}                compare the two most recent runs
  ${C.bold("export")} <runId>             hash-verifiable evidence bundle  ${C.dim("--out <file>")}
  ${C.bold("verify")} [runId]             recompute result/bundle integrity
  ${C.bold("certify")} <target> <id>      evidence-backed certification
  ${C.bold("compatibility")}              public API / CLI / schema contract checks
  ${C.bold("claims")}                     claim → evidence matrix
  ${C.bold("limitations")}                what the benchmarks do NOT measure
  ${C.bold("gaps")}                       gaps discovered by evaluation, with owners
  ${C.bold("reproduce")} <scenarioId>     re-run a scenario to test determinism

  ${C.dim(`${ALL_SUITES.length} suites · ${runner.totalScenarioCount()} scenarios · ${runner.offlineCapableCount()} runnable fully offline`)}
  ${C.dim("Scores never replace evidence: every view shows configuration, failures, and limitations.")}
`);
  }
}

/** `xr eval` alias. */
export class EvalAliasCommand extends EvaluateCommand {
  override name = "eval";
}
