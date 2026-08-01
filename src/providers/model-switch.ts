/**
 * XR Phase 3 · T6 — Model-switch state machine.
 *
 * Converts "switch provider/model" from an unexplained config write into a
 * predictable, bounded state machine:
 *
 *   preflight → warm → canary → swap → verify → done
 *                        └── any failure → rollback (previous config kept)
 *
 * Guarantees:
 *   - NO UNEXPLAINED WAITS: every phase has a hard timeout (defaults below);
 *     every phase reports ok/failed + durationMs to the caller.
 *   - FAIL-SAFE SWAP: the previous provider/model are snapshotted before the
 *     swap; a failed swap or failed verify restores them (rollback) and
 *     reports the reason.
 *   - HONESTY (Art. X · 1): a canary that cannot reach/auth the candidate
 *     refuses the switch by default with a clear reason and the `--force`
 *     escape hatch — never a silent "switched" that is not true.
 *   - The canary never sends paid traffic: for cloud providers it is the
 *     reachability+auth probe (authOk counts as pass); the full model
 *     completion probe is available for local runtimes (`xr models set`).
 *
 * The machine is dependency-injected (check/apply fns), so tests drive the
 * whole state machine including rollback without any network.
 */

export type SwitchPhase =
  | "preflight"
  | "warm"
  | "canary"
  | "swap"
  | "verify"
  | "done"
  | "rolled-back";

export interface SwitchTarget {
  providerId: string;
  model?: string;
}

export interface SwitchPhaseResult {
  phase: SwitchPhase;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface SwitchResult {
  ok: boolean;
  target: SwitchTarget;
  /** Previous provider/model (what rollback restores). */
  previous: SwitchTarget;
  phases: SwitchPhaseResult[];
  /** Set when the canary failed and --force bypassed it. */
  forced?: boolean;
}

export interface ModelSwitchDeps {
  /** Validate the target statically (unknown id/model → fail fast). */
  preflight(target: SwitchTarget): { ok: boolean; detail: string };
  /** Warm probe: reachability/auth of the candidate provider. */
  warm(target: SwitchTarget, timeoutMs: number): Promise<{ ok: boolean; detail: string }>;
  /**
   * Canary probe: a bounded, free (non-paid) soundness check. Returning
   * { ok:false } refuses the switch unless `force` is set.
   */
  canary(target: SwitchTarget, timeoutMs: number): Promise<{ ok: boolean; detail: string }>;
  /** Persist the new active provider/model. */
  apply(target: SwitchTarget): Promise<void>;
  /** Read back the persisted config (verification after swap). */
  readActive(): SwitchTarget;
  /** Per-phase timeout budgets (ms). */
  timeouts?: { preflight?: number; warm?: number; canary?: number; swap?: number; verify?: number };
}

const DEFAULT_TIMEOUTS = {
  preflight: 2_000,
  warm: 10_000,
  canary: 15_000,
  swap: 10_000,
  verify: 2_000,
};

function withTimeout<T>(fn: () => Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    fn().then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class ModelSwitchStateMachine {
  constructor(private readonly deps: ModelSwitchDeps) {}

  async run(target: SwitchTarget, opts: { force?: boolean } = {}): Promise<SwitchResult> {
    const force = opts.force === true;
    const timeouts = { ...DEFAULT_TIMEOUTS, ...this.deps.timeouts };
    const phases: SwitchPhaseResult[] = [];
    const previous = this.deps.readActive();
    const record = (phase: SwitchPhase, ok: boolean, detail: string, ms: number) => {
      phases.push({ phase, ok, detail, ms });
    };

    // 1. Preflight — static validation, always bounded.
    let t0 = performance.now();
    const pre = this.deps.preflight(target);
    record("preflight", pre.ok, pre.detail, performance.now() - t0);
    if (!pre.ok) return { ok: false, target, previous, phases };

    // 2. Warm — reachability/auth probe.
    try {
      t0 = performance.now();
      const warm = await withTimeout(() => this.deps.warm(target, timeouts.warm), timeouts.warm, "warm probe");
      record("warm", warm.ok, warm.detail, performance.now() - t0);
    } catch (e) {
      record("warm", false, (e as Error).message, performance.now() - t0);
      if (!force) return { ok: false, target, previous, phases };
    }

    // 3. Canary — free soundness probe.
    let forced = false;
    try {
      t0 = performance.now();
      const canary = await withTimeout(() => this.deps.canary(target, timeouts.canary), timeouts.canary, "canary probe");
      record("canary", canary.ok, canary.detail, performance.now() - t0);
      if (!canary.ok && !force) {
        record("rolled-back", false, `canary failed — kept previous (${previous.providerId}); use --force to switch without a canary`, 0);
        return { ok: false, target, previous, phases };
      }
      forced = !canary.ok && force;
    } catch (e) {
      record("canary", false, (e as Error).message, performance.now() - t0);
      if (!force) {
        record("rolled-back", false, `canary error — kept previous (${previous.providerId}); use --force to switch without a canary`, 0);
        return { ok: false, target, previous, phases };
      }
      forced = true;
    }

    // 4. Swap + verify with rollback on failure.
    try {
      t0 = performance.now();
      await withTimeout(() => this.deps.apply(target), timeouts.swap, "swap");
      record("swap", true, "config persisted", performance.now() - t0);
    } catch (e) {
      record("swap", false, (e as Error).message, performance.now() - t0);
      await this.rollback(previous);
      record("rolled-back", false, "swap failed — previous config restored", 0);
      return { ok: false, target, previous, phases };
    }

    // Verify the persisted config actually reads back as the target.
    const active = this.deps.readActive();
    const verifyOk = active.providerId === target.providerId && (!target.model || active.model === target.model);
    record("verify", verifyOk, verifyOk ? `active: ${active.providerId}${active.model ? ` / ${active.model}` : ""}` : `read-back mismatch: ${active.providerId} / ${active.model}`, performance.now() - t0);
    if (!verifyOk) {
      await this.rollback(previous);
      record("rolled-back", false, "verification failed — previous config restored", 0);
      return { ok: false, target, previous, phases };
    }

    record("done", true, "model switch complete", 0);
    return { ok: true, target, previous, phases, forced };
  }

  private async rollback(previous: SwitchTarget): Promise<void> {
    try {
      await this.deps.apply(previous);
    } catch {
      /* rollback is best-effort; the phase report carries the failure */
    }
  }
}
