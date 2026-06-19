/** XR Stage 4 — transparent local AI recommendation heuristics. */
import type { HardwareSpecs } from "./hardware.ts";
import {
  LOCAL_MODEL_REGISTRY,
  type LocalModelSpec,
  type LocalRuntimeId,
  type LocalUseCase,
  getRuntimeDefinition,
  modelNameForRuntime,
} from "./registry.ts";
import type { LocalRuntimeStatus } from "./runtimes.ts";

export interface LocalAIRecommendation {
  runtime: LocalRuntimeId;
  providerId: string;
  model: LocalModelSpec;
  runtimeModel: string;
  confidence: "high" | "medium" | "low";
  hardwareTier: HardwareSpecs["tier"];
  reason: string;
  nextAction: string;
  considered: Array<{ id: string; eligible: boolean; score: number; reason: string }>;
}

function maxVram(specs: HardwareSpecs): number {
  return Math.max(0, ...specs.gpus.map((g) => g.vramGb ?? 0));
}

function hasUsefulGpu(specs: HardwareSpecs): boolean {
  return maxVram(specs) >= 6 || specs.gpus.some((g) => g.vendor === "apple");
}

function runtimeScore(runtime: LocalRuntimeId, statuses?: LocalRuntimeStatus[]): number {
  const status = statuses?.find((s) => s.id === runtime);
  const def = getRuntimeDefinition(runtime);
  let score = 0;
  if (runtime === "ollama") score += 20;
  if (def?.nonTechnicalFit === "excellent") score += 12;
  if (def?.nonTechnicalFit === "good") score += 6;
  if (status?.healthy && status.models.length) score += 50;
  else if (status?.healthy) score += 35;
  else if (status?.installed) score += 20;
  if (status?.configured) score += 10;
  return score;
}

function chooseRuntime(model: LocalModelSpec, preferred?: LocalRuntimeId, statuses?: LocalRuntimeStatus[]): LocalRuntimeId {
  if (preferred && model.runtimeIds.includes(preferred)) return preferred;
  return [...model.runtimeIds].sort((a, b) => runtimeScore(b, statuses) - runtimeScore(a, statuses))[0] ?? "ollama";
}

export function recommendLocalAI(
  specs: HardwareSpecs,
  opts: { useCase?: LocalUseCase; preferredRuntime?: LocalRuntimeId; runtimes?: LocalRuntimeStatus[] } = {},
): LocalAIRecommendation {
  const useCase = opts.useCase ?? "general";
  const ram = specs.totalRamGb;
  const disk = specs.availableDiskGb;
  const gpu = hasUsefulGpu(specs);
  const vram = maxVram(specs);
  const diskReserveGb = 4;

  const considered = LOCAL_MODEL_REGISTRY
    .filter((m) => !m.family.includes("embedding"))
    .map((m) => {
      const enoughRam = ram >= m.minRamGb;
      const enoughDisk = disk === 0 || disk >= m.estimatedDiskGb + diskReserveGb;
      const enoughVram = !m.minVramGb || vram >= m.minVramGb || specs.gpus.some((g) => g.vendor === "apple");
      const hugeCpuPenalty = !gpu && !m.cpuUsable;
      const supportsUse = m.useCases.includes(useCase) || useCase === "general";
      const eligible = enoughRam && enoughDisk && enoughVram && !hugeCpuPenalty;
      let score = 0;
      if (eligible) score += 100;
      score += Math.min(40, m.paramsB * 2);
      if (supportsUse) score += 25;
      if (m.family.includes("coding") && useCase === "coding") score += 20;
      if (m.family.includes("reasoning") && (useCase === "reasoning" || useCase === "research")) score += 20;
      if (ram < 8 && m.paramsB <= 4) score += 30;
      if (ram >= 8 && ram < 16 && m.paramsB >= 6 && m.paramsB <= 8) score += 25;
      if (ram >= 16 && ram < 32 && m.paramsB >= 7 && m.paramsB <= 14) score += 20;
      if (!gpu && m.paramsB > 14) score -= 60;
      if (disk !== 0 && disk < m.estimatedDiskGb + 10) score -= 10;
      const reason = !enoughRam
        ? `needs at least ${m.minRamGb}GB RAM`
        : !enoughDisk
          ? `needs about ${m.estimatedDiskGb + diskReserveGb}GB free disk including reserve`
          : !enoughVram
            ? `works best with about ${m.minVramGb}GB VRAM`
            : hugeCpuPenalty
              ? "too slow for CPU-only use on this machine"
              : supportsUse
                ? `fits hardware and ${useCase} use case`
                : "fits hardware but is less targeted for this use case";
      return { id: m.id, eligible, score, reason };
    });

  const model = [...LOCAL_MODEL_REGISTRY]
    .filter((m) => !m.family.includes("embedding"))
    .sort((a, b) => {
      const ca = considered.find((c) => c.id === a.id)!;
      const cb = considered.find((c) => c.id === b.id)!;
      return cb.score - ca.score;
    })[0] ?? LOCAL_MODEL_REGISTRY[0];

  const runtime = chooseRuntime(model, opts.preferredRuntime, opts.runtimes);
  const def = getRuntimeDefinition(runtime)!;
  const runtimeModel = modelNameForRuntime(model, runtime);
  const confidence: LocalAIRecommendation["confidence"] =
    ram >= model.recommendedRamGb && (disk === 0 || disk >= model.estimatedDiskGb + diskReserveGb) ? "high" :
    ram >= model.minRamGb ? "medium" : "low";

  const gpuText = specs.gpus.length
    ? `Detected GPU/acceleration: ${specs.gpus.map((g) => `${g.vendor}${g.vramGb ? ` ${g.vramGb}GB` : ""}`).join(", ")}.`
    : "No dedicated GPU was detected, so XR avoided large GPU-oriented models.";
  const reason = [
    `${model.label} was selected for ${useCase} because this machine has ${ram}GB RAM and ${disk || "unknown"}GB free disk.`,
    gpuText,
    `XR chose ${def.label} because it is ${def.nonTechnicalFit === "excellent" ? "simple for non-technical users" : def.nonTechnicalFit === "good" ? "usable with a local server" : "available for power users"}.`,
    `The model needs ~${model.minRamGb}GB RAM and ~${model.estimatedDiskGb}GB disk; recommended RAM is ${model.recommendedRamGb}GB.`,
  ].join(" ");
  const nextAction = runtime === "ollama"
    ? `XR can pull ${runtimeModel} with explicit approval.`
    : `Start ${def.label}, load/download a compatible model, then run xr models set ${runtime} <model-name>.`;

  return { runtime, providerId: def.providerId, model, runtimeModel, confidence, hardwareTier: specs.tier, reason, nextAction, considered };
}

export function recommendLocalModel(specs: HardwareSpecs) {
  const rec = recommendLocalAI(specs);
  return { model: { ...rec.model, id: rec.runtimeModel, runtime: rec.runtime }, confidence: rec.confidence, reason: rec.reason, considered: rec.considered };
}
