/** XR v0.5 — transparent local model recommendation heuristics. */
import type { HardwareSpecs } from "./hardware.ts";
import { LOCAL_MODEL_REGISTRY, type LocalModelSpec } from "./registry.ts";

export interface LocalModelRecommendation {
  model: LocalModelSpec;
  confidence: "high" | "medium" | "low";
  reason: string;
  considered: Array<{ id: string; eligible: boolean; reason: string }>;
}

function hasUsefulGpu(specs: HardwareSpecs): boolean {
  return specs.gpus.some((g) => (g.vramGb ?? 0) >= 6 || g.vendor === "apple");
}

export function recommendLocalModel(specs: HardwareSpecs): LocalModelRecommendation {
  const ram = specs.totalRamGb;
  const disk = specs.availableDiskGb;
  const gpu = hasUsefulGpu(specs);
  const diskReserveGb = 4;

  const considered = LOCAL_MODEL_REGISTRY.map((m) => {
    const enoughRam = ram >= m.minRamGb;
    const enoughDisk = disk === 0 || disk >= m.estimatedDiskGb + diskReserveGb;
    const gpuPenalty = !gpu && m.paramsB >= 14;
    const eligible = enoughRam && enoughDisk && !gpuPenalty;
    const reason = !enoughRam
      ? `needs at least ${m.minRamGb}GB RAM`
      : !enoughDisk
        ? `needs about ${m.estimatedDiskGb + diskReserveGb}GB free disk including reserve`
        : gpuPenalty
          ? "large CPU-only runs are likely too slow; GPU not detected"
          : "fits detected RAM/disk/GPU envelope";
    return { id: m.id, eligible, reason };
  });

  const eligible = LOCAL_MODEL_REGISTRY
    .filter((m) => considered.find((c) => c.id === m.id)?.eligible)
    .sort((a, b) => b.paramsB - a.paramsB);

  // Pick strongest eligible, but keep 8–16GB laptops on the more reliable 7B tier.
  let model = eligible[0] ?? LOCAL_MODEL_REGISTRY[0];
  if (ram < 16) model = LOCAL_MODEL_REGISTRY.find((m) => m.id === "qwen2.5:7b" && ram >= m.minRamGb) ?? model;
  if (ram < 8) model = LOCAL_MODEL_REGISTRY.find((m) => m.id === "qwen2.5:3b") ?? model;

  const confidence: LocalModelRecommendation["confidence"] =
    ram >= model.recommendedRamGb && (disk === 0 || disk >= model.estimatedDiskGb + diskReserveGb) ? "high" :
    ram >= model.minRamGb ? "medium" : "low";

  const gpuText = specs.gpus.length
    ? `Detected GPU support (${specs.gpus.map((g) => `${g.vendor}${g.vramGb ? ` ${g.vramGb}GB` : ""}`).join(", ")}).`
    : "No dedicated GPU was detected, so XR avoided very large models for CPU-only usability.";

  const reason = [
    `${model.id} was selected because this machine has ${ram}GB RAM and ${disk || "unknown"}GB free disk.`,
    gpuText,
    `The model needs ~${model.minRamGb}GB RAM and ~${model.estimatedDiskGb}GB disk; recommended RAM is ${model.recommendedRamGb}GB.`,
  ].join(" ");

  return { model, confidence, reason, considered };
}
