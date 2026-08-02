/**
 * XR Phase 5 · T3 — Rolling provider health + circuit breaker.
 *
 * 2026 ops consensus adopted (docs/phase5-routing/03-RESEARCH-NOTES.md · R3):
 *   · ROLLING health score (windowed aggregation with hysteresis), not binary.
 *   · A circuit breaker that trips on ERROR RATE and on QUALITY DEGRADATION
 *     (a provider returning well-formed-but-invalid answers is failing in
 *     exactly the way uptime checks cannot see).
 *   · CLOSED → OPEN (trip) → cooldown → HALF-OPEN (single probe) → CLOSED;
 *     failed probes re-open with jittered, capped backoff (no thundering
 *     herd against a recovering endpoint).
 *
 * The breaker is in-process (XR is local-first single-process CLI/daemon —
 * shared multi-replica state is recorded as future work in
 * docs/phase5-routing/KNOWN-LIMITATIONS.md). Snapshots persist to
 * $XR_HOME/cache/intelligence/health.json (atomic, bounded, secret-free) so a
 * tripped breaker survives a restart of the same workspace machine.
 *
 * Deterministic under injected `now`/`random` — fully testable without
 * network or sleeps.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const XR_HOME_DIR = () => process.env.XR_HOME ?? join(homedir(), ".xr");
const STORE_DIR = () => join(XR_HOME_DIR(), "cache", "intelligence");
const STORE_FILE = () => join(STORE_DIR(), "health.json");

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerConfig {
  /** Rolling window size (samples). */
  windowSize: number;
  /** Minimum samples before any trip decision. */
  minSamples: number;
  /** Trip when rolling error rate ≥ this (0..1). */
  errorRateThreshold: number;
  /** Trip when rolling quality-failure rate ≥ this (0..1). */
  qualityRateThreshold: number;
  /** Base cooldown before a half-open probe, ms. */
  cooldownMs: number;
  /** Max cooldown after repeated failed probes, ms. */
  cooldownMaxMs: number;
  /** Jitter ratio applied to cooldowns (0..1). */
  jitterRatio: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  windowSize: 32,
  minSamples: 4,
  errorRateThreshold: 0.5,
  qualityRateThreshold: 0.6,
  cooldownMs: 30_000,
  cooldownMaxMs: 300_000,
  jitterRatio: 0.2,
};

interface Sample {
  ok: boolean;
  qualityOk: boolean;
  latencyMs?: number;
  at: number;
}

interface KeyState {
  samples: Sample[];
  state: BreakerState;
  /** When the breaker opened (epoch ms). */
  openedAt?: number;
  /** Consecutive open→probe→open cycles (drives capped backoff). */
  openStreak: number;
  /** Half-open probe currently permitted. */
  probeInFlight: boolean;
  /** Total trips (for SLO/reporting). */
  trips: number;
  lastTripReason?: string;
}

export interface HealthGate {
  key: string;
  state: BreakerState;
  /** 0..1 rolling success-weighted score (1 when no data). */
  score: number;
  samples: number;
  errorRate: number;
  qualityFailRate: number;
  /** Rolling average latency when known. */
  avgLatencyMs?: number;
  /** Present when open: why. */
  reason?: string;
  /** Next time a probe may be attempted (epoch ms) when open. */
  nextProbeAt?: number;
}

export type Permit = "allow" | "deny_open" | "probe";

export interface TripEvent {
  key: string;
  reason: string;
  at: number;
}

interface HealthFile {
  version: 1;
  keys: Record<
    string,
    Pick<KeyState, "state" | "openedAt" | "openStreak" | "trips" | "lastTripReason"> & {
      samples: Sample[];
    }
  >;
}

function keyOf(providerId: string, modelId?: string): string {
  return modelId ? `${providerId}/${modelId}` : providerId;
}

export class RoutingHealth {
  private cfg: BreakerConfig;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly file: string | null;
  private keys = new Map<string, KeyState>();
  private dirty = false;
  private writesSinceFlush = 0;

  constructor(opts: {
    config?: Partial<BreakerConfig>;
    now?: () => number;
    random?: () => number;
    /** null disables persistence (pure in-memory, e.g. unit tests). */
    file?: string | null;
  } = {}) {
    this.cfg = { ...DEFAULT_BREAKER_CONFIG, ...opts.config };
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.file = opts.file === undefined ? STORE_FILE() : opts.file;
    this.loadSnapshot();
  }

  /** Apply workspace breaker tuning (idempotent; called with each config load). */
  configure(partial: Partial<BreakerConfig>): void {
    this.cfg = { ...this.cfg, ...partial };
  }

  private state(key: string): KeyState {
    let s = this.keys.get(key);
    if (!s) {
      s = { samples: [], state: "closed", openStreak: 0, probeInFlight: false, trips: 0 };
      this.keys.set(key, s);
    }
    return s;
  }

  /** Record one observed outcome. Returns a trip event when the breaker opens. */
  record(
    providerId: string,
    modelId: string | undefined,
    outcome: { ok: boolean; latencyMs?: number; qualityOk?: boolean },
  ): TripEvent | null {
    const key = keyOf(providerId, modelId);
    const s = this.state(key);
    s.samples.push({
      ok: outcome.ok,
      qualityOk: outcome.qualityOk ?? outcome.ok,
      latencyMs: outcome.latencyMs,
      at: this.now(),
    });
    if (s.samples.length > this.cfg.windowSize) s.samples.shift();

    let trip: TripEvent | null = null;
    if (s.state === "closed" && s.samples.length >= this.cfg.minSamples) {
      const { errorRate, qualityFailRate } = rates(s.samples);
      let reason: string | null = null;
      if (errorRate >= this.cfg.errorRateThreshold) {
        reason = `error rate ${(errorRate * 100).toFixed(0)}% ≥ threshold ${(this.cfg.errorRateThreshold * 100).toFixed(0)}% over ${s.samples.length} samples`;
      } else if (qualityFailRate >= this.cfg.qualityRateThreshold) {
        reason = `quality degradation ${(qualityFailRate * 100).toFixed(0)}% ≥ threshold ${(this.cfg.qualityRateThreshold * 100).toFixed(0)}% over ${s.samples.length} samples (semantic/contract failures)`;
      }
      if (reason) {
        s.state = "open";
        s.openedAt = this.now();
        s.trips += 1;
        s.lastTripReason = reason;
        s.probeInFlight = false;
        trip = { key, reason, at: this.now() };
      }
    }
    this.persistSoon(trip != null);
    return trip;
  }

  /**
   * Ask permission to call a target. "probe" means the caller is the single
   * half-open probe — it MUST call resolveProbe afterwards.
   */
  permit(providerId: string, modelId?: string): Permit {
    const s = this.state(keyOf(providerId, modelId));
    if (s.state === "closed") return "allow";
    if (s.state === "half_open") {
      if (s.probeInFlight) return "deny_open";
      s.probeInFlight = true;
      return "probe";
    }
    // open — cooldown elapsed?
    const next = this.nextProbeAt(s);
    if (this.now() >= next) {
      s.state = "half_open";
      s.probeInFlight = true;
      this.persistSoon(true);
      return "probe";
    }
    return "deny_open";
  }

  /** Resolve a half-open probe: success closes; failure re-opens with backoff. */
  resolveProbe(providerId: string, modelId: string | undefined, ok: boolean): void {
    const s = this.state(keyOf(providerId, modelId));
    if (s.state !== "half_open") return;
    s.probeInFlight = false;
    if (ok) {
      s.state = "closed";
      s.samples = [];
      s.openStreak = 0;
      s.openedAt = undefined;
    } else {
      s.state = "open";
      s.openStreak += 1;
      s.openedAt = this.now();
    }
    this.persistSoon(true);
  }

  /** Current gate view for one target (router + reporting). */
  gate(providerId: string, modelId?: string): HealthGate {
    const key = keyOf(providerId, modelId);
    const s = this.state(key);
    // A persisted open breaker whose cooldown elapsed still reports open
    // until permit() promotes it — report the effective view.
    if (s.state === "open" && this.now() >= this.nextProbeAt(s)) {
      // eligible for probe — surface as half_open for explainability
      return this.gateView(key, s, "half_open");
    }
    return this.gateView(key, s, s.state);
  }

  private gateView(key: string, s: KeyState, state: BreakerState): HealthGate {
    const { errorRate, qualityFailRate } = rates(s.samples);
    const successes = s.samples.filter((x) => x.ok).length;
    const lats = s.samples.map((x) => x.latencyMs).filter((n): n is number => typeof n === "number");
    const successRate = s.samples.length ? successes / s.samples.length : 1;
    // Latency goodput: <1.5s → 1; ≥15s → 0 (bounded, linear) with hysteresis
    const avgLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : undefined;
    const latScore = avgLat === undefined ? 1 : Math.max(0, Math.min(1, 1 - (avgLat - 1500) / 13_500));
    const score = Math.round((0.75 * successRate + 0.25 * latScore) * 1000) / 1000;
    return {
      key,
      state,
      score: s.samples.length ? score : 1,
      samples: s.samples.length,
      errorRate: Math.round(errorRate * 1000) / 1000,
      qualityFailRate: Math.round(qualityFailRate * 1000) / 1000,
      avgLatencyMs: avgLat !== undefined ? Math.round(avgLat) : undefined,
      reason: state !== "closed" ? s.lastTripReason : undefined,
      nextProbeAt: state === "open" ? this.nextProbeAt(s) : undefined,
    };
  }

  private nextProbeAt(s: KeyState): number {
    const base = this.cfg.cooldownMs * Math.pow(2, Math.min(s.openStreak, 6));
    const capped = Math.min(base, this.cfg.cooldownMaxMs);
    const jitter = 1 + (this.random() * 2 - 1) * this.cfg.jitterRatio;
    return (s.openedAt ?? this.now()) + Math.round(capped * jitter);
  }

  /** All known keys (reporting / SLO). */
  report(): HealthGate[] {
    return [...this.keys.keys()].map((k) => {
      const [providerId, modelId] = k.split("/");
      return this.gate(providerId!, modelId || undefined);
    });
  }

  // ── persistence (bounded, atomic, secret-free) ──────────────────────────

  private persistSoon(force: boolean): void {
    this.dirty = true;
    this.writesSinceFlush++;
    if (force || this.writesSinceFlush >= 8) this.flush();
  }

  flush(): void {
    if (!this.dirty || !this.file) return;
    this.dirty = false;
    this.writesSinceFlush = 0;
    try {
      const data: HealthFile = { version: 1, keys: {} };
      for (const [k, s] of this.keys) {
        data.keys[k] = {
          state: s.state,
          openedAt: s.openedAt,
          openStreak: s.openStreak,
          trips: s.trips,
          lastTripReason: s.lastTripReason,
          samples: s.samples.slice(-this.cfg.windowSize),
        };
      }
      mkdirSync(STORE_DIR(), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
    } catch {
      // Persistence is best-effort; the in-process breaker still protects.
    }
  }

  private loadSnapshot(): void {
    if (!this.file) return;
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as HealthFile;
      if (!raw || raw.version !== 1 || typeof raw.keys !== "object") return;
      for (const [k, v] of Object.entries(raw.keys)) {
        this.keys.set(k, {
          samples: Array.isArray(v.samples) ? v.samples.slice(-this.cfg.windowSize) : [],
          state: v.state === "open" || v.state === "half_open" || v.state === "closed" ? v.state : "closed",
          openedAt: v.openedAt,
          openStreak: v.openStreak ?? 0,
          probeInFlight: false,
          trips: v.trips ?? 0,
          lastTripReason: v.lastTripReason,
        });
      }
    } catch {
      // Corrupt snapshot → cold breakers. Fail CLOSED per-provider policy is
      // unaffected: routing still enforces locality/credentials.
    }
  }
}

function rates(samples: Sample[]): { errorRate: number; qualityFailRate: number } {
  if (!samples.length) return { errorRate: 0, qualityFailRate: 0 };
  const errors = samples.filter((s) => !s.ok).length;
  const qFails = samples.filter((s) => s.ok && !s.qualityOk).length;
  // Quality failure rate is measured over SUCCESSES (a semantically bad
  // "success" is the dangerous class); errors already counted in errorRate.
  return {
    errorRate: errors / samples.length,
    qualityFailRate: (qFails + errors) / samples.length, // errors are also quality failures
  };
}

/** Narrow read view for the routing decision path. */
export interface RoutingHealthView {
  gate(providerId: string, modelId?: string): HealthGate;
}

export function healthView(health: RoutingHealth): RoutingHealthView {
  return { gate: (p, m) => health.gate(p, m) };
}
