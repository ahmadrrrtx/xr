/**
 * XR 4.4 — Candidate filtering.
 * Hard constraints only. Never score an incompatible candidate as selectable.
 */

import { capabilityRequired } from "./capability.ts";
import type {
  CandidateEvaluation,
  ModelCapabilities,
  ModelClass,
  ModelDescriptor,
  PolicyConstraints,
  RejectionReason,
  TaskRequirements,
} from "./types.ts";

const CLASS_CAP_FIELD: Partial<Record<ModelClass, keyof ModelCapabilities>> = {
  chat: "chat",
  completion: "completion",
  reasoning: "reasoning",
  code: "code",
  tool_use: "toolUse",
  structured_output: "structuredOutput",
  vision: "vision",
  image_understanding: "imageUnderstanding",
  image_generation: "imageGeneration",
  speech_to_text: "speechToText",
  text_to_speech: "textToSpeech",
  embeddings: "embeddings",
  reranking: "reranking",
  multimodal: "multimodal",
};

export interface EvaluateOptions {
  /** When true, unknown capability fails closed for required features. */
  strictUnknown?: boolean;
  /** Skip health hard-fail (still recorded). */
  ignoreHealth?: boolean;
}

/**
 * Evaluate one model against requirements + policy.
 * Returns compatible=false with reasons when any hard filter fails.
 */
export function evaluateCandidate(
  model: ModelDescriptor,
  requirements: TaskRequirements,
  policy: PolicyConstraints,
  opts: EvaluateOptions = {},
): CandidateEvaluation {
  const rejections: RejectionReason[] = [];
  const strictUnknown = opts.strictUnknown ?? true;

  // Disabled mode
  if (policy.routingMode === "disabled") {
    rejections.push({
      code: "disabled",
      message: "Intelligence routing is disabled",
    });
    return { model, compatible: false, rejections };
  }

  // Pin restriction: when strict pin to another provider, reject others
  if (requirements.pin?.providerId && requirements.pin.strict) {
    if (model.providerId !== requirements.pin.providerId) {
      rejections.push({
        code: "user_pin",
        message: `Pinned to provider ${requirements.pin.providerId}`,
      });
    }
    if (requirements.pin.modelId && model.modelId !== requirements.pin.modelId) {
      rejections.push({
        code: "user_pin",
        message: `Pinned to model ${requirements.pin.modelId}`,
      });
    }
  }

  // Locality policy (requirements override policy)
  const locality = requirements.localityPolicy ?? policy.localityPolicy;
  if (locality === "local_only" || locality === "no_cloud") {
    if (model.locality.locality === "cloud") {
      rejections.push({
        code: "locality_policy",
        message: "Cloud providers blocked by locality policy",
        detail: locality,
      });
    }
    if (locality === "local_only" && model.locality.locality !== "local") {
      rejections.push({
        code: "locality_policy",
        message: "Only local models allowed",
        detail: model.locality.locality,
      });
    }
  }
  if (locality === "private_only") {
    if (model.locality.locality === "cloud") {
      rejections.push({
        code: "locality_policy",
        message: "Public cloud blocked; private/local only",
      });
    }
  }

  // Credentials
  if (model.locality.requiresCredential) {
    // Credential flag is on provider descriptor; model inherits via construction.
    // We check health.authOk when present, else assume catalog set it on provider.
    // ModelDescriptor doesn't carry credentialAvailable directly — use health + tags.
  }

  // Model class / primary capability
  const classField = CLASS_CAP_FIELD[requirements.modelClass];
  if (classField) {
    const { ok, support } = capabilityRequired(model.capabilities, classField, {
      allowUnknown: !strictUnknown,
    });
    if (!ok) {
      rejections.push({
        code: support === "unknown" ? "capability_unknown" : "capability_unsupported",
        message: `Model class ${requirements.modelClass} not supported`,
        detail: `${String(classField)}=${support}`,
      });
    }
  } else if (requirements.modelClass === "unknown") {
    // allow any chat-capable as soft default
    if (model.capabilities.chat === "unsupported") {
      rejections.push({
        code: "capability_unsupported",
        message: "Chat unsupported for unknown class fallback",
      });
    }
  }

  // Explicit capability requirements
  const req = requirements.require ?? {};
  const need = (
    flag: boolean | undefined,
    field: keyof ModelCapabilities,
    label: string,
  ) => {
    if (!flag) return;
    const { ok, support } = capabilityRequired(model.capabilities, field, {
      allowUnknown: !strictUnknown,
    });
    if (!ok) {
      rejections.push({
        code: support === "unknown" ? "capability_unknown" : "capability_unsupported",
        message: `Required capability missing: ${label}`,
        detail: `${String(field)}=${support}`,
      });
    }
  };
  need(req.toolUse, "toolUse", "tool-use");
  need(req.structuredOutput, "structuredOutput", "structured-output");
  need(req.jsonMode, "jsonMode", "json-mode");
  need(req.streaming, "streaming", "streaming");
  need(req.vision, "vision", "vision");
  need(req.embeddings, "embeddings", "embeddings");
  need(req.reasoning, "reasoning", "reasoning");
  need(req.functionCalling, "functionCalling", "function-calling");

  // Modalities
  if (requirements.modalities?.length) {
    for (const mod of requirements.modalities) {
      if (!model.modalities.includes(mod)) {
        // embedding modality special-case
        if (mod === "embedding" && model.capabilities.embeddings === "supported") continue;
        if (mod === "text" && model.capabilities.chat === "supported") continue;
        rejections.push({
          code: "modality_missing",
          message: `Missing modality: ${mod}`,
        });
      }
    }
  }

  // Context window
  if (requirements.minContextTokens) {
    const window =
      model.context.contextWindow ??
      model.context.maxInputTokens ??
      undefined;
    if (window !== undefined && window < requirements.minContextTokens) {
      rejections.push({
        code: "context_too_small",
        message: `Context window ${window} < required ${requirements.minContextTokens}`,
      });
    }
    // If unknown context and requirement is very large, fail closed only when > 32k
    if (window === undefined && requirements.minContextTokens > 32_000) {
      rejections.push({
        code: "context_too_small",
        message: "Context window unknown; cannot satisfy large context requirement",
      });
    }
  }

  // Budget (rough per-call estimate using cost profile)
  const maxCost = requirements.maxCostUsd ?? policy.maxCostUsd;
  if (maxCost !== undefined && maxCost >= 0) {
    if (!model.cost.free) {
      const inP = model.cost.inPerMTok ?? tierDefaultIn(model.cost.tier);
      const outP = model.cost.outPerMTok ?? tierDefaultOut(model.cost.tier);
      // Assume ~2k in + 500 out for a typical call estimate
      const est = (2000 / 1e6) * inP + (500 / 1e6) * outP;
      if (est > maxCost && maxCost === 0 && !model.cost.free) {
        rejections.push({
          code: "budget",
          message: "Non-free model exceeds zero cost ceiling",
        });
      } else if (maxCost > 0 && est > maxCost * 10) {
        // Only reject when wildly over (soft budget is scored, hard when absurd)
        rejections.push({
          code: "budget",
          message: `Estimated call cost $${est.toFixed(4)} exceeds ceiling`,
        });
      }
    }
  }

  // Health
  if (!opts.ignoreHealth && model.health) {
    if (model.health.available === false || model.health.ok === false) {
      // Soft: only hard-reject when explicitly marked unavailable and not stale-unknown
      if (!model.health.stale) {
        rejections.push({
          code: "health_unavailable",
          message: model.health.detail ?? "Provider health check failed",
        });
      }
    }
    if (model.health.authOk === false) {
      rejections.push({
        code: "credential_missing",
        message: "Provider credentials not available",
      });
    }
  }

  // Credential via provider auth — check tag on model through locality
  if (model.locality.requiresCredential && model.health?.authOk === false) {
    if (!rejections.some((r) => r.code === "credential_missing")) {
      rejections.push({
        code: "credential_missing",
        message: "API key not configured",
      });
    }
  }

  return {
    model,
    compatible: rejections.length === 0,
    rejections,
  };
}

function tierDefaultIn(tier: string): number {
  switch (tier) {
    case "free":
      return 0;
    case "cheap":
      return 0.2;
    case "premium":
      return 3;
    case "enterprise":
      return 5;
    default:
      return 1;
  }
}
function tierDefaultOut(tier: string): number {
  switch (tier) {
    case "free":
      return 0;
    case "cheap":
      return 0.6;
    case "premium":
      return 12;
    case "enterprise":
      return 15;
    default:
      return 3;
  }
}

/** Filter a list; returns evaluations (compatible and not). */
export function evaluateAll(
  models: ModelDescriptor[],
  requirements: TaskRequirements,
  policy: PolicyConstraints,
  opts?: EvaluateOptions,
): CandidateEvaluation[] {
  return models.map((m) => evaluateCandidate(m, requirements, policy, opts));
}
