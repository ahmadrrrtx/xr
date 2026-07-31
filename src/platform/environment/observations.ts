/**
 * XR 5.1 — Observation registry.
 *
 * Bounded in-memory store of environment observations so coordinate/vision-
 * guided actions can cite a specific, FRESH observation as target evidence.
 * Observations are references (path+hash), never raw media, and expire.
 */
import { isObservationStale, type EnvironmentObservation } from "./types.ts";

const MAX_OBSERVATIONS = 64;
const PRUNE_AGE_MS = 5 * 60 * 1000;

class ObservationRegistry {
  private items = new Map<string, EnvironmentObservation>();

  put(obs: EnvironmentObservation): EnvironmentObservation {
    this.prune();
    if (this.items.size >= MAX_OBSERVATIONS) {
      const oldest = [...this.items.entries()].sort((a, b) => a[1].capturedAt - b[1].capturedAt)[0];
      if (oldest) this.items.delete(oldest[0]);
    }
    this.items.set(obs.observationId, obs);
    return obs;
  }

  get(observationId: string): EnvironmentObservation | undefined {
    return this.items.get(observationId);
  }

  /** Lookup + freshness verdict for action gating. */
  check(observationId: string, now = Date.now()):
    | { ok: true; observation: EnvironmentObservation }
    | { ok: false; reason: string; observation?: EnvironmentObservation } {
    const obs = this.items.get(observationId);
    if (!obs) return { ok: false, reason: `unknown observation '${observationId}' — capture a fresh observation first` };
    if (isObservationStale(obs, now)) {
      const ageS = Math.round((now - obs.capturedAt) / 1000);
      return {
        ok: false,
        reason: `observation is stale (${ageS}s old, limit ${Math.round(obs.staleAfterMs / 1000)}s) — re-observe before acting on it`,
        observation: obs,
      };
    }
    return { ok: true, observation: obs };
  }

  list(sessionId?: string): EnvironmentObservation[] {
    this.prune();
    const all = [...this.items.values()].sort((a, b) => b.capturedAt - a.capturedAt);
    return sessionId ? all.filter((o) => o.sessionId === sessionId) : all;
  }

  prune(now = Date.now()): number {
    let n = 0;
    for (const [id, obs] of this.items) {
      if (now - obs.capturedAt > PRUNE_AGE_MS) {
        this.items.delete(id);
        n++;
      }
    }
    return n;
  }

  clear(): void {
    this.items.clear();
  }
}

export const environmentObservations = new ObservationRegistry();
