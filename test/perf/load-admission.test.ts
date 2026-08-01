/**
 * XR Phase 3 · T8 — local-load admission tests.
 *
 * Pure verdicts over detected-hardware profiles:
 *   - a 70B model on a lightweight host is DENIED (OOM prevention);
 *   - a 7B model on a lightweight host is admitted;
 *   - a 13B model on a medium host with 8GB VRAM is admitted via GPU;
 *   - --force overrides a denial;
 *   - an unsupported tier admits only tiny models.
 */

import { describe, test, expect } from "bun:test";
import { admitLocalModelLoad, footprintGb } from "../../src/local/admission.ts";
import type { HardwareSpecs } from "../../src/local/hardware.ts";
import type { LocalModelSpec } from "../../src/local/registry.ts";

const GB = (n: number) => n * 1024 * 1024 * 1024;

function specs(partial: Partial<HardwareSpecs>): HardwareSpecs {
  return {
    os: "linux",
    osRelease: "x",
    arch: "x64",
    cpuModel: "test",
    cpuCores: 4,
    totalRamGb: 8,
    freeRamGb: 6,
    availableDiskGb: 100,
    gpus: [],
    acceleration: [],
    tier: "lightweight",
    suitability: { lightweight: true, medium: false, heavy: false, reason: "test" },
    ...partial,
  };
}

const model = (partial: Partial<LocalModelSpec>): LocalModelSpec => ({
  id: "m",
  label: "M",
  family: ["general"],
  useCases: ["general"],
  runtimeIds: ["ollama"],
  paramsB: 7,
  minRamGb: 8,
  recommendedRamGb: 16,
  estimatedDiskGb: 5,
  cpuUsable: true,
  strengths: [],
  notes: "",
  ...partial,
});

describe("Phase 3 · T8 — local-load admission", () => {
  test("footprint estimates are quantization-aware", () => {
    expect(footprintGb(7, "q4_K_M")).toBeCloseTo(4.9, 0);
    expect(footprintGb(7, "q8_0")).toBeCloseTo(9.1, 0);
    expect(footprintGb(7)).toBeCloseTo(15.4, 0); // fp16
  });

  test("a 70B model on a lightweight host is DENIED (OOM prevention)", () => {
    const v = admitLocalModelLoad(model({ id: "70b", paramsB: 70, minRamGb: 64 }), specs({ tier: "lightweight", totalRamGb: 8 }));
    expect(v.admitted).toBe(false);
    expect(v.tier).toBe("denied");
    expect(v.reason.toLowerCase()).toContain("oom");
  });

  test("a 7B q4 model on a lightweight host is admitted", () => {
    // Ollama defaults to q4 (~0.7GB/1B) — the realistic install path.
    const v = admitLocalModelLoad(
      model({ paramsB: 7, quantization: "q4_K_M" }),
      specs({ tier: "lightweight", totalRamGb: 8 }),
    );
    expect(v.admitted).toBe(true);
  });

  test("a 7B fp16 model on a lightweight host is denied (no quantization info)", () => {
    // Conservative default: without quantization data, fp16 footprint is
    // assumed — 15.4GB does not fit 5.6GB usable RAM.
    const v = admitLocalModelLoad(model({ paramsB: 7 }), specs({ tier: "lightweight", totalRamGb: 8 }));
    expect(v.admitted).toBe(false);
  });

  test("a 13B model on a medium host with 8GB VRAM is admitted via GPU", () => {
    const v = admitLocalModelLoad(
      model({ id: "13b", paramsB: 13, minVramGb: 8, quantization: "q4_K_M" }),
      specs({ tier: "medium", totalRamGb: 16, gpus: [{ vendor: "nvidia", name: "RTX 3070", vramGb: 8, acceleration: ["cuda"] }] }),
    );
    expect(v.admitted).toBe(true);
    expect(v.reason).toContain("VRAM");
  });

  test("--force overrides a denial", () => {
    const v = admitLocalModelLoad(model({ id: "70b", paramsB: 70 }), specs({ tier: "lightweight", totalRamGb: 8 }), { force: true });
    expect(v.admitted).toBe(true);
    expect(v.tier).toBe("warn");
  });

  test("unsupported tier admits only tiny models", () => {
    const tiny = admitLocalModelLoad(model({ id: "tiny", paramsB: 1 }), specs({ tier: "unsupported", totalRamGb: 4, gpus: [] }));
    expect(tiny.admitted).toBe(true);
    const big = admitLocalModelLoad(model({ id: "big", paramsB: 8 }), specs({ tier: "unsupported", totalRamGb: 4, gpus: [] }));
    expect(big.admitted).toBe(false);
  });

  test("heavy tier admits large models within RAM", () => {
    const v = admitLocalModelLoad(
      model({ id: "32b", paramsB: 32, quantization: "q4_K_M" }),
      specs({ tier: "heavy", totalRamGb: 64, gpus: [{ vendor: "nvidia", name: "A100", vramGb: 40, acceleration: ["cuda"] }] }),
    );
    expect(v.admitted).toBe(true);
  });
});
