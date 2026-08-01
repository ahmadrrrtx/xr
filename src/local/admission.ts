/**
 * XR Phase 3 · T8 — Local model load admission.
 *
 * Preflights a large local-model download/load against the DETECTED host
 * (RAM, VRAM, tier) BEFORE the model is pulled, so a machine cannot be sent
 * into OOM/thrash by an oversized model. Pure + deterministic (unit-testable
 * without hardware).
 *
 * Profiles (documented in docs/perf/PERF-BUDGETS.md · §Local-load admission):
 *
 *   Tier "unsupported"  — no useful compute; allow only tiny models
 *                         (paramsB <= 1.5) without a GPU.
 *   Tier "lightweight"  — CPU-only ~8GB RAM: allow models whose practical
 *                         footprint (paramsB × 2.2 GB fp16 ceiling) fits in
 *                         available RAM.
 *   Tier "medium"       — 8-16GB RAM and/or ≥6GB VRAM: allow medium models;
 *                         large models admitted only when they fit VRAM.
 *   Tier "heavy"        — ≥16GB RAM and/or ≥12GB VRAM: admitted unless the
 *                         footprint exceeds RAM by a wide margin.
 *
 * Practical footprint per parameter count (quantization-aware):
 *   fp16 ≈ 2.2 GB / 1B params · q4 ≈ 0.7 GB / 1B params (documented ranges).
 *
 * The verdict is advisory-by-default for small models and a hard DENY for
 * clear OOM candidates; the CLI surfaces `--force` for explicit override.
 */

import type { HardwareSpecs } from "./hardware.ts";
import type { LocalModelSpec } from "./registry.ts";

export type AdmissionVerdict = {
  admitted: boolean;
  tier: "ok" | "warn" | "denied";
  reason: string;
};

export interface AdmissionOptions {
  /** Available RAM in GB (default: detected total × 0.7 practical ceiling). */
  availableRamGb?: number;
  /** Skip the RAM/VRAM ceiling (--force). */
  force?: boolean;
}

/** Practical resident footprint estimate in GB for a parameter count. */
export function footprintGb(paramsB: number, quantization?: string): number {
  const q = (quantization ?? "").toLowerCase();
  if (q.includes("q4")) return Math.round(paramsB * 0.7 * 10) / 10;
  if (q.includes("q5")) return Math.round(paramsB * 0.9 * 10) / 10;
  if (q.includes("q8")) return Math.round(paramsB * 1.3 * 10) / 10;
  return Math.round(paramsB * 2.2 * 10) / 10; // fp16 default
}

/** Highest VRAM across GPUs (GB). */
export function maxVramGb(specs: HardwareSpecs): number {
  return Math.max(0, ...specs.gpus.map((g) => g.vramGb ?? 0));
}

/**
 * Admission decision for loading a local model on the detected host.
 * Pure: takes specs + model, returns a verdict.
 */
export function admitLocalModelLoad(
  model: Pick<LocalModelSpec, "id" | "paramsB" | "minRamGb" | "recommendedRamGb" | "minVramGb" | "quantization">,
  specs: HardwareSpecs,
  opts: AdmissionOptions = {},
): AdmissionVerdict {
  if (opts.force) {
    return { admitted: true, tier: "warn", reason: `forced admission of ${model.id} (--force)` };
  }
  const ramGb = opts.availableRamGb ?? Math.round(specs.totalRamGb * 0.7 * 10) / 10;
  const vram = maxVramGb(specs);
  const footprint = footprintGb(model.paramsB, model.quantization);
  const gpuAble = vram >= (model.minVramGb ?? 0) && vram >= footprint * 0.6;

  switch (specs.tier) {
    case "unsupported":
      if (model.paramsB > 1.5 && !gpuAble) {
        return {
          admitted: false,
          tier: "denied",
          reason: `${model.id} (~${footprint}GB) exceeds the ${specs.tier} tier; no GPU detected and only ${ramGb}GB RAM usable — loading it risks OOM/thrash. Use --force to override.`,
        };
      }
      return { admitted: true, tier: "warn", reason: `${specs.tier} tier: keep to small models (${model.id} ~${footprint}GB, ${ramGb}GB RAM usable).` };
    case "lightweight":
      if (model.paramsB > 7 || footprint > ramGb) {
        return {
          admitted: false,
          tier: "denied",
          reason: `${model.id} (~${footprint}GB) does not fit ${ramGb}GB usable RAM on the ${specs.tier} tier — OOM/thrash risk. Use --force to override.`,
        };
      }
      return { admitted: true, tier: footprint > ramGb * 0.6 ? "warn" : "ok", reason: `${model.id} (~${footprint}GB) fits ${ramGb}GB usable RAM (CPU).` };
    case "medium":
      if (gpuAble) return { admitted: true, tier: "ok", reason: `${model.id} (~${footprint}GB) fits ${vram}GB VRAM (${specs.gpus.map((g) => g.name).join(", ")}).` };
      if (footprint > ramGb) {
        return {
          admitted: false,
          tier: "denied",
          reason: `${model.id} (~${footprint}GB) exceeds ${ramGb}GB usable RAM with no sufficient GPU — OOM/thrash risk. Use --force to override.`,
        };
      }
      return { admitted: true, tier: footprint > ramGb * 0.7 ? "warn" : "ok", reason: `${model.id} (~${footprint}GB) fits ${ramGb}GB usable RAM (CPU fallback).` };
    case "heavy":
      if (footprint > ramGb * 1.2 && !gpuAble) {
        return {
          admitted: false,
          tier: "denied",
          reason: `${model.id} (~${footprint}GB) is far beyond ${ramGb}GB usable RAM — OOM risk. Use --force to override.`,
        };
      }
      return { admitted: true, tier: "ok", reason: `${model.id} (~${footprint}GB) within ${ramGb}GB usable RAM${gpuAble ? ` + ${vram}GB VRAM` : ""}.` };
  }
}
