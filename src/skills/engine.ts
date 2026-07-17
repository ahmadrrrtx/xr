/**
 * XR — Non-Regressive Skills engine.
 *
 * The differentiator nobody ships: self-improvement that can NEVER overwrite a
 * known-good behavior.
 *
 *   1. Verifiability gate — only learn from runs an objective verifier confirms.
 *   2. Validated-behavior freezing — store the verified action sequence as an
 *      IMMUTABLE baseline + a regression case.
 *   3. Backward-transfer guard — before activating a new skill version, re-run
 *      the regression suite; if ANY past frozen win regresses → AUTO-ROLLBACK.
 *
 * (TRD §3.3, research: catastrophic forgetting / verifiability constraint /
 *  decision-context-graph "freeze validated sequences".)
 */
import { randomUUID } from "node:crypto";
import type { Store } from "../state/workspace-store.ts";
import { verify, isVerifiable, type VerifierSpec, type VerifyResult } from "./verifier.ts";

/** A recorded action sequence from a run (what the agent did). */
export interface ActionSequence {
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
}

export interface LearnInput {
  skillId: string;
  actions: ActionSequence;
  verifier: VerifierSpec;
  why: string;
}

export type LearnOutcome =
  | { learned: true; version: number; baselineId: string }
  | { learned: false; reason: string };

export class SkillEngine {
  constructor(
    private store: Store,
    /** Working dir for running verifiers. */
    private cwd: string,
  ) {}

  /**
   * Attempt to learn (freeze) a skill from a completed run.
   * Gate: must be objectively verifiable AND currently pass.
   */
  learn(input: LearnInput, ctx: { userApproved?: boolean } = {}): LearnOutcome {
    // Gate 1: is this even verifiable?
    if (!isVerifiable(input.verifier)) {
      return { learned: false, reason: "outcome not objectively verifiable — refusing to auto-learn" };
    }
    // Gate 2: does it actually pass right now?
    const res = verify(input.verifier, { cwd: this.cwd, userApproved: ctx.userApproved });
    if (!res.passed) {
      return { learned: false, reason: `verifier did not pass: ${res.reason}` };
    }

    // Freeze: new version, immutable baseline, regression case.
    const version = this.store.latestSkillVersion(input.skillId) + 1;
    const baselineId = `fb_${randomUUID().slice(0, 8)}`;
    this.store.insertSkill(input.skillId, version, "learned", input.why);
    this.store.setActiveSkillVersion(input.skillId, version);
    this.store.freezeBaseline(
      baselineId,
      input.skillId,
      version,
      JSON.stringify(input.actions),
      JSON.stringify(input.verifier),
    );
    this.store.addRegressionCase(
      `rc_${randomUUID().slice(0, 8)}`,
      input.skillId,
      baselineId,
      JSON.stringify(input.verifier),
    );
    this.store.audit("skill.frozen", { skillId: input.skillId, version, baselineId, why: input.why });
    return { learned: true, version, baselineId };
  }

  /**
   * Run the backward-transfer regression suite for a skill.
   * Re-verifies every frozen baseline's verifier against current state.
   * Returns whether all still pass (no forgetting).
   */
  runRegression(skillId: string): { allPass: boolean; results: Array<{ id: string; result: VerifyResult }> } {
    const cases = this.store.regressionCasesFor(skillId);
    const results: Array<{ id: string; result: VerifyResult }> = [];
    let allPass = true;
    for (const c of cases) {
      const spec = JSON.parse(c.verifier_json) as VerifierSpec;
      // user_approved cases can't be auto-re-run; treat as pass (already validated once).
      const result =
        spec.kind === "user_approved"
          ? { passed: true, reason: "previously user-approved (skipped in auto-regression)" }
          : verify(spec, { cwd: this.cwd });
      this.store.markRegression(c.id, result.passed ? "pass" : "fail");
      if (!result.passed) allPass = false;
      results.push({ id: c.id, result });
    }
    return { allPass, results };
  }

  /**
   * Apply a skill update guarded by the regression suite.
   * @param apply  performs the actual change and returns the new version.
   * @param rollback  reverts to the previous version (called on regression).
   *
   * The contract: if the update causes ANY frozen win to regress, we roll back
   * and report — the agent literally cannot ship a regression.
   */
  updateGuarded(
    skillId: string,
    prevVersion: number,
    apply: () => number,
    rollback: (toVersion: number) => void,
  ): { ok: true; version: number } | { ok: false; reason: string; failed: string[] } {
    const newVersion = apply();
    const reg = this.runRegression(skillId);
    if (reg.allPass) {
      this.store.audit("skill.update.ok", { skillId, version: newVersion });
      return { ok: true, version: newVersion };
    }
    // Regression detected → AUTO-ROLLBACK.
    rollback(prevVersion);
    this.store.setActiveSkillVersion(skillId, prevVersion);
    const failed = reg.results.filter((r) => !r.result.passed).map((r) => r.id);
    this.store.audit("skill.update.rolled_back", { skillId, attempted: newVersion, restored: prevVersion, failed });
    return { ok: false, reason: "update caused a regression; auto-rolled back to keep known-good behavior", failed };
  }
}
