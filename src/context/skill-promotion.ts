/**
 * Phase 09 — Memory → Skill promotion gate.
 *
 * A successful workflow MAY become procedural knowledge, but:
 *
 *   conversation  ≠  automatic skill
 *
 * Promotion is allowed ONLY when the existing SkillEngine verification
 * requirements pass (verifiability gate, freeze baseline, regression case,
 * backward-transfer guard, rollback). This module never weakens those gates
 * and never writes a skill from raw conversation text.
 */

import { SkillEngine, type ActionSequence, type LearnInput, type LearnOutcome } from "../skills/engine.ts";
import { isVerifiable, type VerifierSpec } from "../skills/verifier.ts";
import type { Store } from "../state/workspace-store.ts";

export interface PromotionRequest {
  /** Free-text conversation or memory content. NEVER sufficient on its own. */
  conversation?: string;
  skillId: string;
  actions: ActionSequence;
  verifier: VerifierSpec;
  why: string;
}

export interface PromotionDecision {
  promoted: boolean;
  reason: string;
  outcome?: LearnOutcome;
}

/**
 * Refuse automatic promotion of arbitrary conversation.
 * Only a fully specified, verifiable action sequence may proceed — and then
 * only through SkillEngine.learn(), which remains the authority.
 */
export function considerSkillPromotion(
  store: Store,
  cwd: string,
  req: PromotionRequest,
  ctx: { userApproved?: boolean } = {},
): PromotionDecision {
  if (!req.actions?.steps?.length) {
    return {
      promoted: false,
      reason: "conversation is not a skill — no verified action sequence supplied",
    };
  }
  if (!isVerifiable(req.verifier)) {
    return {
      promoted: false,
      reason: "SkillEngine verifiability gate refused — outcome is not objectively verifiable",
    };
  }
  // Presence of conversation text must never be enough; it is ignored as authority.
  void req.conversation;

  const engine = new SkillEngine(store, cwd);
  const input: LearnInput = {
    skillId: req.skillId,
    actions: req.actions,
    verifier: req.verifier,
    why: req.why,
  };
  const outcome = engine.learn(input, ctx);
  if (!outcome.learned) {
    return { promoted: false, reason: outcome.reason, outcome };
  }
  return { promoted: true, reason: `frozen as ${req.skillId}@${outcome.version}`, outcome };
}
