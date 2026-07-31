/**
 * XR 5.1 — Voice environment gate.
 *
 * Voice is an interface, never an authority bypass (§7.5). This provider owns
 * the deterministic decisions that make that true for the voice control path:
 * confidence thresholds, confirmation policy on non-safe actions, and the
 * stronger-channel rule for high-risk voice-sourced actions.
 *
 * No audio hardware access here — capture/playback stays in src/voice/*.
 */
import type { Action } from "../../../control/types.ts";
import { classify as controlClassify } from "../../../control/classify.ts";
import { ENVIRONMENT_BOUNDS, type ApprovalStrength } from "../types.ts";

export interface VoiceGateInput {
  confidence: number; // intent parser confidence 0..1
  confirmationPolicy: "always-risky" | "always" | "never-execute-risky";
  minControlConfidence?: number;
  action: Action;
  approvalStrength: ApprovalStrength;
}

export interface VoiceGateDecision {
  allowed: boolean;
  /** When the action may proceed only after approval elsewhere. */
  requiresTextChannelApproval: boolean;
  reason?: string;
  spokenRefusal?: string;
}

/**
 * Deterministic voice gate for control intents:
 *  - intent confidence below threshold → clarify, never execute;
 *  - `never-execute-risky` → anything above `safe` is refused from voice;
 *  - strong-approval actions from voice require the text/dashboard channel
 *    (voice confirmation is reserved for the existing agent-path approver).
 */
export function gateVoiceControlAction(input: VoiceGateInput): VoiceGateDecision {
  const min = input.minControlConfidence ?? ENVIRONMENT_BOUNDS.MIN_VOICE_CONTROL_CONFIDENCE;
  if (input.confidence < min) {
    return {
      allowed: false,
      requiresTextChannelApproval: false,
      reason: `voice intent confidence ${input.confidence.toFixed(2)} below threshold ${min}`,
      spokenRefusal: "I'm not confident I understood that command. Please rephrase it, or run it in text mode.",
    };
  }
  const risk = controlClassify(input.action);
  if (input.confirmationPolicy === "never-execute-risky" && risk.level !== "safe") {
    return {
      allowed: false,
      requiresTextChannelApproval: false,
      reason: `voice confirmation policy 'never-execute-risky' blocks ${risk.level} actions from voice`,
      spokenRefusal: "For safety, I can't do that from voice. Please confirm it in text mode.",
    };
  }
  if (input.approvalStrength === "strong") {
    return {
      allowed: true,
      requiresTextChannelApproval: true,
      reason: "strong-approval action sourced from voice must be confirmed in the text/dashboard channel",
    };
  }
  return { allowed: true, requiresTextChannelApproval: input.confirmationPolicy === "always" && risk.level !== "safe" };
}
