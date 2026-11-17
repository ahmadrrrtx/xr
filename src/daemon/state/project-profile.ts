/** Advisory project observations: never scan a tree while building an HTTP response.
 * No file bodies, authorization decisions or credentials are cached. */
import { fingerprintAsync, type Fingerprint } from "../../context/memory/rag.ts";
import { yieldEventLoop } from "../../util/concurrency.ts";
import { TtlCache } from "../../util/ttl-cache.ts";

const MAX_FLIGHTS = 2;
const profiles = new TtlCache<{ fingerprint: Fingerprint | null; observedAt: number | null }>({ ttlMs: 5_000, maxEntries: 2 });
const flights = new Map<string, AbortController>();
export interface ProjectProfileObservation {
  fingerprint: Fingerprint | null;
  fingerprintStatus: { state: "ready" | "pending" | "unavailable" | "busy"; observedAt: number | null };
}

/** Cold/expired observations are explicitly unknown, never invented as an empty project.
 * Completion is published by the shared TTL primitive, which rejects invalidated flights. */
export function observeProjectProfile(root: string): ProjectProfileObservation {
  const hit = profiles.get(root);
  if (hit) return {
    fingerprint: hit.value.fingerprint,
    fingerprintStatus: { state: hit.value.fingerprint ? "ready" : "unavailable", observedAt: hit.value.observedAt },
  };
  if (!flights.has(root) && flights.size < MAX_FLIGHTS) {
    const controller = new AbortController();
    flights.set(root, controller);
    void profiles.getOrStart(root, async () => {
      try {
        // A microtask is not enough: defer the first filesystem open until the
        // current response can finish, then keep yielding inside the shared walk.
        await yieldEventLoop();
        controller.signal.throwIfAborted();
        const fingerprint = await fingerprintAsync(root, controller.signal);
        return { fingerprint, observedAt: Date.now() };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // A refused/unsupported scope is not a verified zero-file project.
        return { fingerprint: null, observedAt: null };
      }
    }).catch(() => { /* invalidation owns cancellation; no rejected background work escapes */ })
      .finally(() => { if (flights.get(root) === controller) flights.delete(root); });
  }
  return { fingerprint: null, fingerprintStatus: { state: flights.has(root) ? "pending" : "busy", observedAt: null } };
}

/** Drop observations and stop retained-authority walks; late work cannot repopulate them. */
export function invalidateProjectProfiles(): void {
  for (const controller of flights.values()) controller.abort();
  flights.clear();
  profiles.clear();
}
