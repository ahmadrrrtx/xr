/**
 * XR — self-healing update logic (the "never breaks on update" guarantee).
 *
 * The core algorithm, isolated and pure-ish so it's testable:
 *   install new version → run self-test → switch ONLY if it passes,
 *   otherwise keep the current version (auto-rollback). (TRD §3.4.)
 *
 * The actual file/symlink ops are injected so this is unit-testable without
 * touching the real filesystem.
 */

export interface UpdatePlan<V> {
  current: V;
  candidate: V;
  /** Install the candidate; may throw. */
  install: (v: V) => void | Promise<void>;
  /** Self-test the candidate: boot + canned task + injection smoke. */
  selfTest: (v: V) => boolean | Promise<boolean>;
  /** Atomically make a version active. */
  activate: (v: V) => void | Promise<void>;
  /** Cleanup a failed candidate (optional). */
  discard?: (v: V) => void | Promise<void>;
}

export type UpdateResult<V> =
  | { ok: true; activated: V }
  | { ok: false; keptCurrent: V; reason: string };

export async function applyUpdate<V>(plan: UpdatePlan<V>): Promise<UpdateResult<V>> {
  // 1. Install the candidate (never touches the active version yet).
  try {
    await plan.install(plan.candidate);
  } catch (e) {
    return { ok: false, keptCurrent: plan.current, reason: `install failed: ${(e as Error).message}` };
  }

  // 2. Self-test. If it throws or fails, we DO NOT switch.
  let passed = false;
  try {
    passed = await plan.selfTest(plan.candidate);
  } catch (e) {
    passed = false;
  }

  if (!passed) {
    if (plan.discard) {
      try {
        await plan.discard(plan.candidate);
      } catch {
        /* best-effort cleanup */
      }
    }
    return {
      ok: false,
      keptCurrent: plan.current,
      reason: "self-test failed — kept current version (auto-rollback)",
    };
  }

  // 3. Only now do we atomically switch.
  try {
    await plan.activate(plan.candidate);
  } catch (e) {
    return { ok: false, keptCurrent: plan.current, reason: `activate failed: ${(e as Error).message}` };
  }
  return { ok: true, activated: plan.candidate };
}
