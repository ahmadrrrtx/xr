/**
 * XR Phase 7 · T8 — Business OS module effect-verification.
 *
 * Constitution Art. XVI / Part Eight permanent rule 2: "No module ships by
 * default until its effect-verification test passes." and rule 4: "No
 * simulated success; no ok:true on no-op business actions."
 *
 * Each module registers deterministic EFFECT tests that run against a
 * SCRATCH database (not the user's workspace). A module is:
 *   verified   — every required effect test passed (deterministic side
 *                effect asserted, not simulated);
 *   unverified — missing/failing tests → EXCLUDED from default loads.
 *
 * The harness never touches user data; it creates a temporary store.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";

export interface ModuleEffectSpec {
  module: string;
  /** Deterministic checks: each must assert a REAL side effect. */
  tests: Array<{
    id: string;
    name: string;
    run: (store: Store) => { ok: boolean; effect: string } | Promise<{ ok: boolean; effect: string }>;
  }>;
}

export interface EffectVerificationResult {
  module: string;
  status: "verified" | "unverified" | "excluded";
  reason: string;
  passed: number;
  failed: number;
  effects: string[];
}

/** Import the module registry (extension-internal; builtin specs below). */
import { MODULE_EFFECT_SPECS } from "./effect-specs.ts";

export async function verifyModule(module: string): Promise<EffectVerificationResult> {
  const spec = MODULE_EFFECT_SPECS.find((s) => s.module === module);
  if (!spec) {
    return { module, status: "excluded", reason: "no effect-verification spec registered — default-excluded", passed: 0, failed: 0, effects: [] };
  }
  return runSpec(spec);
}

export async function verifyAllModules(): Promise<EffectVerificationResult[]> {
  const all = new Set([
    "crm", "sales", "marketing", "support", "projects", "knowledge", "finance",
    "hr", "analytics", "automation", "scheduling", "communication", "documents",
    "meetings", "ai-workers",
  ]);
  const results: EffectVerificationResult[] = [];
  for (const module of [...all].sort()) {
    results.push(await verifyModule(module));
  }
  return results;
}

async function runSpec(spec: ModuleEffectSpec): Promise<EffectVerificationResult> {
  const dir = mkdtempSync(join(tmpdir(), "xr-biz-verify-"));
  let store: Store;
  try {
    store = new Store(join(dir, "scratch.db"));
  } catch (e) {
    return { module: spec.module, status: "unverified", reason: `scratch db failed: ${(e as Error).message}`, passed: 0, failed: 0, effects: [] };
  }
  const effects: string[] = [];
  let passed = 0;
  let failed = 0;
  try {
    for (const test of spec.tests) {
      try {
        const r = await test.run(store);
        if (r.ok) {
          passed += 1;
          effects.push(`${test.id}: ${r.effect}`);
        } else {
          failed += 1;
          effects.push(`${test.id}: FAILED — ${r.effect}`);
        }
      } catch (e) {
        failed += 1;
        effects.push(`${test.id}: THREW — ${String((e as Error)?.message ?? e)} @ ${(e as Error)?.stack?.split("\n")[1] ?? "?"}`);
      }
    }
  } finally {
    try { store.close(); } catch { /* best-effort */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (failed > 0) {
    return { module: spec.module, status: "unverified", reason: `${failed} effect test(s) failed — excluded from default loads`, passed, failed, effects };
  }
  if (passed === 0) {
    return { module: spec.module, status: "excluded", reason: "no passing effect tests — default-excluded", passed, failed, effects };
  }
  return { module: spec.module, status: "verified", reason: `${passed} deterministic effect test(s) passed`, passed, failed, effects };
}

/** The canonical store lifecycle: the kernel provider calls this. */
export async function verifyBusinessOsModules(): Promise<EffectVerificationResult[]> {
  return verifyAllModules();
}
