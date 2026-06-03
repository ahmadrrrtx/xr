/**
 * XR — pre-task cost estimator.
 * Gives the user "this will cost ~$X. Proceed?" BEFORE burning tokens.
 * Heuristic (no model call): based on task length, workspace size, and a
 * typical multi-step agent loop. Deliberately conservative (rounds up).
 */
import type { Pricing } from "./governor.ts";

export interface Estimate {
  estTokens: number;
  estUsd: number;
  basis: string;
}

export function estimateTask(
  task: string,
  pricing: Pricing,
  opts: { steps?: number; workspaceFiles?: number } = {},
): Estimate {
  const steps = opts.steps ?? 4; // typical short agent loop
  const files = opts.workspaceFiles ?? 0;

  // Per-step input: system+envelope (~600) + task + accumulated context + a bit
  // per known file. Output ~300/step.
  const taskTokens = Math.ceil(task.length / 4); // ~4 chars/token
  const perStepIn = 600 + taskTokens + files * 50 + steps * 200; // context grows
  const perStepOut = 300;
  const estTokens = steps * (perStepIn + perStepOut);

  const estUsd =
    (steps * perStepIn / 1_000_000) * pricing.inPerMTok +
    (steps * perStepOut / 1_000_000) * pricing.outPerMTok;

  return {
    estTokens,
    estUsd,
    basis: `~${steps} steps, ${files} workspace files`,
  };
}
