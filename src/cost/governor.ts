import { BudgetManager, BudgetCheckResult } from "./manager.ts";
import type { ReservationStoreLike } from "../state/repos/reservation-repo.ts";

/**
 * Phase 6 · Step 2 — the partition admission interface the Governor consumes.
 * Implemented by `PartitionRepo` (src/state/repos/partition-repo.ts). Kept as
 * an interface so the governor stays store-free (same discipline as
 * `ReservationStoreLike`).
 */
export interface PartitionAdmitter {
  admit(
    taskId: string,
    childId: string,
    estUsd: number,
    estTokens: number,
  ): { ok: true; reservationId: string } | { ok: false; reason: string };
  commit(taskId: string, childId: string, reservationId: string, actualUsd: number, actualTokens: number): void;
  release(taskId: string, childId: string, reservationId: string): void;
}

export interface PartitionRef {
  ledger: PartitionAdmitter;
  /** Root envelope id — the workflow/task whose root cap bounds the tree. */
  taskId: string;
  /** Child partition key — normally the delegated task id. */
  childId: string;
}

export interface Budget {
  /** Hard ceiling in USD for this task (0 or undefined = local/free, no $ cap). */
  maxUsd?: number;
  /** Hard ceiling in total tokens for this task. */
  maxTokens?: number;
}

/** Per-model pricing in USD per 1M tokens. Local models = 0. */
export interface Pricing {
  inPerMTok: number;
  outPerMTok: number;
}

export interface CostSnapshot {
  inTokens: number;
  outTokens: number;
  totalTokens: number;
  usd: number;
}

export type GovernorDecision =
  | { allow: true; warning?: string }
  | { allow: false; reason: string; snapshot: CostSnapshot; suggestLocal?: boolean };

export class CostGovernor {
  private inTokens = 0;
  private outTokens = 0;
  private usd = 0;
  private steps = 0;
  /**
   * Phase 2 · F-12 — the open reservation for the currently-admitted step
   * (settled at the head of the next checkBeforeStep). Undefined when no
   * admission layer is wired or nothing is currently admitted.
   */
  private openReservationId: string | undefined;
  /** Usage snapshot at the moment the open reservation was admitted. */
  private lastCommittedUsd = 0;
  private lastCommittedTokens = 0;
  /**
   * Phase 6 · F-12 — when set, this governor meters a PARTITIONED worker:
   * admission goes through the root-envelope ledger (child cap + root cap,
   * atomically), never through the per-session reservation copy that let
   * N workers each spend the full root budget.
   */
  private partitionRef: PartitionRef | undefined;
  private openPartitionReservationId: string | undefined;

  constructor(
    private budget: Budget,
    private pricing: Pricing,
    /**
     * Global budget manager. OPTIONAL: when omitted the governor still enforces
     * the per-task token/USD ceilings (its headline guarantee) but skips the
     * global monthly/daily cap check. This keeps the governor usable standalone
     * (e.g. in unit tests or any caller that has no Store) without weakening the
     * per-task ceiling in any way.
     */
    private budgetManager?: BudgetManager,
    /**
     * Phase 2 · F-12 — reservation store (atomic check-and-reserve). OPTIONAL:
     * absent callers keep the read-then-decide per-task behavior unchanged.
     * When present, admission is a serialized write transaction and the race
     * between processes is impossible by construction.
     */
    private reservationStore?: ReservationStoreLike,
    /** Phase 2 · F-12 — task env id (session/run) for per-task reservations. */
    private envId?: string,
  ) {}

  /** Record real usage after a model call. */
  record(inTok: number, outTok: number): void {
    this.inTokens += inTok;
    this.outTokens += outTok;
    this.usd +=
      (inTok / 1_000_000) * this.pricing.inPerMTok +
      (outTok / 1_000_000) * this.pricing.outPerMTok;
    this.steps++;
  }

  /**
   * Phase 6 · Step 6 — add EXPLICIT usage (resume seeding): a resumed run
   * inherits its checkpointed meter exactly, rather than re-pricing tokens
   * under a possibly-different pricing table.
   */
  addUsage(inTok: number, outTok: number, usd: number): void {
    this.inTokens += inTok;
    this.outTokens += outTok;
    this.usd += usd;
  }

  snapshot(): CostSnapshot {
    return {
      inTokens: this.inTokens,
      outTokens: this.outTokens,
      totalTokens: this.inTokens + this.outTokens,
      usd: this.usd,
    };
  }

  /**
   * Pre-flight check BEFORE the next step. Estimates the next call's cost from
   * the running average and refuses if it would breach a ceiling.
   * Returns allow:false → the loop must pause and ask the human.
   *
   * Phase 2 · F-12 — when an admission layer is wired this is the in-loop
   * facade over admitStep: the previous reservation is settled against actual
   * usage, then the next admission runs inside ONE serialized write
   * transaction (global + per-task caps evaluated atomically).
   */
  checkBeforeStep(): GovernorDecision {
    // Settle the previous step's reservation against ACTUAL usage before the
    // next admission, so reservations track reality and never drift.
    this.settleOpenReservation();

    const snap = this.snapshot();

    // 1. Global Budget Check
    const avgTokens = this.steps > 0 ? snap.totalTokens / this.steps : 2000;
    const estTokens = Math.max(avgTokens, 500);
    const estUsd =
      this.steps > 0 ? snap.usd / this.steps : (estTokens / 1_000_000) * this.pricing.outPerMTok;

    // Global cap check only runs when a budget manager was provided. When it is
    // absent we fall through to the per-task ceilings below (still enforced).
    const globalCheck: BudgetCheckResult = this.budgetManager
      ? this.budgetManager.checkBudget(estUsd)
      : { allow: true };
    if (!globalCheck.allow) {
      return { 
        allow: false, 
        reason: globalCheck.reason, 
        snapshot: snap,
        suggestLocal: globalCheck.suggestLocal 
      };
    }

    // 2. Per-Task Budget Check
    if (this.overBudget()) {
      return { allow: false, reason: "per-task budget ceiling reached", snapshot: snap };
    }

    if (
      this.budget.maxTokens !== undefined &&
      snap.totalTokens + estTokens > this.budget.maxTokens
    ) {
      return {
        allow: false,
        reason: `next step (~${Math.round(estTokens)} tok) would exceed per-task token ceiling (${this.budget.maxTokens})`,
        snapshot: snap,
      };
    }
    if (
      this.budget.maxUsd !== undefined &&
      this.budget.maxUsd > 0 &&
      snap.usd + estUsd > this.budget.maxUsd
    ) {
      return {
        allow: false,
        reason: `next step (~$${estUsd.toFixed(4)}) would exceed per-task spend ceiling ($${this.budget.maxUsd})`,
        snapshot: snap,
      };
    }

    // 3. Phase 6 · Step 2 — partitioned admission (worker of a delegated
    //    tree). Authoritative when attached: the ledger atomically checks the
    //    CHILD ceiling and the ROOT envelope (settled consumption + every
    //    child's in-flight estimates) in one write transaction. The per-task
    //    ceilings above already ARE the child partition's caps.
    if (this.partitionRef) {
      const admitted = this.partitionRef.ledger.admit(
        this.partitionRef.taskId,
        this.partitionRef.childId,
        estUsd,
        estTokens,
      );
      if (!admitted.ok) {
        return {
          allow: false,
          reason: admitted.reason,
          snapshot: snap,
        };
      }
      this.openPartitionReservationId = admitted.reservationId;
      this.lastCommittedUsd = snap.usd;
      this.lastCommittedTokens = snap.totalTokens;
      return { allow: true, warning: globalCheck.warning };
    }

    // 3b. Phase 2 · F-12 — atomic admission (check-and-reserve as a write
    //     transaction). Authoritative for store-backed runs: it re-checks the
    //     global + per-task caps against recorded spend PLUS active
    //     reservations from every process sharing this workspace.
    if (this.reservationStore && this.envId) {
      const cfg = this.budgetManager?.getConfig();
      const admitted = this.admitStep({
        envId: this.envId,
        estUsd,
        estTokens,
        monthlyCapUsd: cfg?.monthly_cap ?? null,
        dailyCapUsd: cfg?.daily_cap ?? null,
        taskUsdCap: this.budget.maxUsd ?? null,
        taskTokenCap: this.budget.maxTokens ?? null,
      });
      if (!admitted.allow) {
        return {
          allow: false,
          reason: admitted.reason ?? "budget admission denied",
          snapshot: snap,
          suggestLocal: admitted.suggestLocal,
        };
      }
    }

    return { 
      allow: true, 
      warning: globalCheck.warning 
    };
  }

  /**
   * Phase 2 · F-12 — Governor v1 admission primitive. Performs the
   * check-and-reserve inside the reservation store's serialized write
   * transaction (see ReservationRepo). Returns the reservation id on allow so
   * the caller can commit/release it explicitly.
   */
  admitStep(est: {
    envId: string;
    estUsd: number;
    estTokens: number;
    monthlyCapUsd?: number | null;
    dailyCapUsd?: number | null;
    taskUsdCap?: number | null;
    taskTokenCap?: number | null;
  }): GovernorDecision & { reservationId?: string } {
    if (!this.reservationStore) {
      return { allow: true };
    }
    const result = this.reservationStore.admit(
      est.envId,
      est.estUsd,
      est.estTokens,
      {
        monthlyCapUsd: est.monthlyCapUsd ?? null,
        dailyCapUsd: est.dailyCapUsd ?? null,
        taskUsdCap: est.taskUsdCap ?? null,
        taskTokenCap: est.taskTokenCap ?? null,
      },
    );
    if (!result.ok) {
      return { allow: false, reason: result.reason, snapshot: this.snapshot(), suggestLocal: result.suggestLocal };
    }
    this.openReservationId = result.reservationId;
    this.lastCommittedUsd = this.snapshot().usd;
    this.lastCommittedTokens = this.snapshot().totalTokens;
    return { allow: true, reservationId: result.reservationId };
  }

  /**
   * Phase 6 · Step 2 — bind this governor to a partition of a root envelope.
   * From the moment of attach, every step admission is checked against the
   * CHILD ceiling and the ROOT envelope in one ledger transaction; the
   * per-session reservation layer is superseded (its caps are the partition's).
   */
  attachPartitionLedger(ref: PartitionRef): void {
    this.partitionRef = ref;
  }

  /** The bound partition (for checkpoint/audit records), if any. */
  get partition(): PartitionRef | undefined {
    return this.partitionRef;
  }

  /** Phase 2 · F-12 — settle an explicit reservation against actual usage. */
  commit(reservationId: string, actualUsd: number, actualTokens: number): void {
    this.reservationStore?.commit(reservationId, actualUsd, actualTokens);
    if (this.openReservationId === reservationId) {
      this.openReservationId = undefined;
    }
  }

  /** Phase 2 · F-12 — release a reservation without usage (cancelled path). */
  releaseReservation(reservationId?: string): void {
    if (this.partitionRef) {
      const rid = reservationId ?? this.openPartitionReservationId;
      if (rid) this.partitionRef.ledger.release(this.partitionRef.taskId, this.partitionRef.childId, rid);
      this.openPartitionReservationId = undefined;
      return;
    }
    if (!this.reservationStore) return;
    if (reservationId) this.reservationStore.release(reservationId);
    else if (this.openReservationId) this.reservationStore.release(this.openReservationId);
    this.openReservationId = undefined;
  }

  /** Settle the open reservation with the usage accrued since admission. */
  private settleOpenReservation(): void {
    if (this.partitionRef) {
      if (!this.openPartitionReservationId) return;
      const snap = this.snapshot();
      this.partitionRef.ledger.commit(
        this.partitionRef.taskId,
        this.partitionRef.childId,
        this.openPartitionReservationId,
        Math.max(0, snap.usd - this.lastCommittedUsd),
        Math.max(0, snap.totalTokens - this.lastCommittedTokens),
      );
      this.openPartitionReservationId = undefined;
      return;
    }
    if (!this.reservationStore || !this.openReservationId) return;
    const snap = this.snapshot();
    this.reservationStore.commit(
      this.openReservationId,
      snap.usd - this.lastCommittedUsd,
      snap.totalTokens - this.lastCommittedTokens,
    );
    this.openReservationId = undefined;
  }

  /** Phase 2 · F-12 — teardown: settle any open reservation for this task. */
  close(): void {
    this.settleOpenReservation();
  }

  overBudget(): boolean {
    const snap = this.snapshot();
    if (this.budget.maxTokens !== undefined && snap.totalTokens >= this.budget.maxTokens) return true;
    if (this.budget.maxUsd !== undefined && this.budget.maxUsd > 0 && snap.usd >= this.budget.maxUsd) return true;
    return false;
  }

  /** Raise the ceiling (after a human approves continuing). */
  raise(extra: { usd?: number; tokens?: number }): void {
    if (extra.usd && this.budget.maxUsd !== undefined) this.budget.maxUsd += extra.usd;
    if (extra.tokens && this.budget.maxTokens !== undefined) this.budget.maxTokens += extra.tokens;
  }

  /** A short live-meter string for the UI. */
  meter(): string {
    const s = this.snapshot();
    const tokPart = `${fmt(s.totalTokens)} tok`;
    const usdPart = this.pricing.inPerMTok + this.pricing.outPerMTok > 0
      ? ` ≈ $${s.usd.toFixed(4)}`
      : " (local · $0)";
    const cap = this.budget.maxUsd
      ? ` / $${this.budget.maxUsd} cap`
      : this.budget.maxTokens
        ? ` / ${fmt(this.budget.maxTokens)} cap`
        : "";
    return `💰 ${tokPart}${usdPart}${cap}`;
  }
}

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n));
}
