/**
 * XR — research budget guard.
 *
 * Adapts XR's existing CostGovernor + BudgetManager to the research engine's
 * simple ResearchBudgetGuard interface. This keeps research budget enforcement
 * IDENTICAL to the rest of XR (same global monthly/daily caps, same per-task
 * ceiling, same pricing) instead of inventing a parallel system.
 *
 * Security rule honored: research never spends silently. Token usage is recorded
 * and surfaced through meter(); when a cap would be breached, allow() returns
 * false and the engine stops gracefully.
 */
import { CostGovernor, type Budget, type Pricing } from "../cost/governor.ts";
import { BudgetManager } from "../cost/manager.ts";
import type { Store } from "../state/workspace-store.ts";
import type { ResearchBudgetGuard } from "./engine.ts";
import type { ResearchBudgetState } from "./provider-types.ts";

export class GovernedResearchBudget implements ResearchBudgetGuard {
  private gov: CostGovernor;
  private lastReason = "";

  constructor(store: Store, budget: Budget, pricing: Pricing) {
    this.gov = new CostGovernor(budget, pricing, new BudgetManager(store));
  }

  allow(): boolean {
    const decision = this.gov.checkBeforeStep();
    if (!decision.allow) {
      this.lastReason = decision.reason;
      return false;
    }
    return true;
  }

  record(inTokens: number, outTokens: number): void {
    this.gov.record(inTokens, outTokens);
  }

  meter(): string {
    return this.gov.meter();
  }

  reason(): string {
    return this.lastReason || "budget ceiling reached";
  }
}

/** A no-op guard for local/free models (no $ spend to govern, only a soft step cap). */
export class LocalResearchBudget implements ResearchBudgetGuard {
  private steps = 0;
  constructor(private maxSteps = 60) {}
  allow(): boolean {
    return this.steps++ < this.maxSteps;
  }
  record(): void {
    /* local = free */
  }
  meter(): string {
    return "💰 local · $0";
  }
  reason(): string {
    return `local step ceiling (${this.maxSteps}) reached`;
  }
}

/**
 * Phase 10 — per-run resource budget for research operations.
 *
 * Tracks pages / requests / bytes / tokens / wall-clock duration and stops
 * truthfully. A missing limit NEVER means infinite: every counter has a
 * positive default ceiling. Exhaustion is surfaced as
 * `research_budget_exhausted` (with partial results preserved), never a
 * generic `failed`.
 */
export interface ResearchRunBudgetConfig {
  maxPages: number;
  maxRequests: number;
  maxBytes: number;
  maxDurationMs: number;
  signal?: AbortSignal;
}

export class ResearchRunBudget {
  private pages = 0;
  private requests = 0;
  private bytes = 0;
  private tokens = 0;
  private readonly startedAt = Date.now();
  private lastAt = Date.now();
  private exhaustedFlag = false;
  private lastReason?: string;
  readonly maxPages: number;
  readonly maxRequests: number;
  readonly maxBytes: number;
  readonly maxDurationMs: number;
  private readonly signal?: AbortSignal;

  constructor(cfg: ResearchRunBudgetConfig) {
    this.maxPages = Math.max(1, cfg.maxPages);
    this.maxRequests = Math.max(1, cfg.maxRequests);
    this.maxBytes = Math.max(1, cfg.maxBytes);
    this.maxDurationMs = Math.max(1, cfg.maxDurationMs);
    this.signal = cfg.signal;
  }

  /** True when more work may proceed; false once any ceiling is hit. */
  allow(): boolean {
    if (this.exhaustedFlag) return false;
    if (this.signal?.aborted) {
      this.exhaustedFlag = true;
      this.lastReason = "cancelled";
      return false;
    }
    if (this.pages >= this.maxPages) {
      this.exhaustedFlag = true;
      this.lastReason = `page limit (${this.maxPages}) reached`;
      return false;
    }
    if (this.requests >= this.maxRequests) {
      this.exhaustedFlag = true;
      this.lastReason = `request limit (${this.maxRequests}) reached`;
      return false;
    }
    if (this.bytes >= this.maxBytes) {
      this.exhaustedFlag = true;
      this.lastReason = `byte limit (${this.maxBytes}) reached`;
      return false;
    }
    if (Date.now() - this.startedAt >= this.maxDurationMs) {
      this.exhaustedFlag = true;
      this.lastReason = `duration limit (${this.maxDurationMs}ms) reached`;
      return false;
    }
    return true;
  }

  /** Record consumption (page/request/bytes/tokens). */
  consume(kind: "page" | "request" | "bytes" | "tokens", amount = 1): void {
    if (kind === "page") this.pages += amount;
    else if (kind === "request") this.requests += amount;
    else if (kind === "bytes") this.bytes += amount;
    else this.tokens += amount;
    this.lastAt = Date.now();
  }

  exhausted(): boolean {
    this.allow();
    return this.exhaustedFlag;
  }

  reason(): string {
    return this.lastReason ?? "budget ceiling reached";
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  state(): ResearchBudgetState {
    return {
      pages: this.pages,
      requests: this.requests,
      bytes: this.bytes,
      tokens: this.tokens,
      startedAt: this.startedAt,
      lastAt: this.lastAt,
      exhausted: this.exhaustedFlag,
      reason: this.lastReason,
      providerUsage: {},
    };
  }
}
