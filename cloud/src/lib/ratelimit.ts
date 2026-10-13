/**
 * XR Cloud — rate limiting.
 *
 * Two backends, one interface:
 *
 *   - **Redis** when `REDIS_URL` is set. Required for a multi-replica deployment,
 *     because an in-memory limiter behind a load balancer is five independent
 *     limiters and therefore no limiter at all.
 *   - **In-memory** otherwise. Correct for a single process — which is what the
 *     dev/test story is — and the health endpoint says which one is live so an
 *     operator who scaled to three replicas without Redis can see the problem.
 *
 * The limits themselves live in `LIMITS` and are named after the thing they
 * protect, not the number they enforce. `magicLink` is the hardened one: email
 * sends cost money and are the classic abuse vector, so it is limited **per
 * email address and per IP independently** — a limit on either alone is trivial
 * to sidestep.
 *
 * Fail-open vs fail-closed, decided per limiter: if the Redis backend is
 * unreachable, auth limiters **fail closed** for the abuse-prone buckets
 * (magic link, signup, export) and fail open for read-heavy buckets, because
 * locking every user out of a working product because Redis blipped is worse than
 * briefly under-limiting a read. The choice is recorded on each entry so it is
 * reviewable rather than implicit.
 */

import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from "rate-limiter-flexible";
import Redis from "ioredis";

import { loadEnv } from "../env.ts";
import { getLogger } from "./logger.ts";

export interface LimitSpec {
  /** Bucket size. */
  points: number;
  /** Window length in seconds. */
  duration: number;
  /** Behaviour when the backend is unavailable. */
  onBackendError: "open" | "closed";
  /** Human description used in the 429 repair text. */
  label: string;
}

export const LIMITS = {
  /** 10/min per email AND per IP, independently (brief §J). */
  magicLink: { points: 10, duration: 60, onBackendError: "closed", label: "sign-in emails" },
  signup: { points: 5, duration: 60, onBackendError: "closed", label: "sign-ups" },
  login: { points: 20, duration: 60, onBackendError: "closed", label: "sign-in attempts" },
  authGeneral: { points: 60, duration: 60, onBackendError: "closed", label: "authentication requests" },
  api: { points: 600, duration: 60, onBackendError: "open", label: "API requests" },
  /** Expensive and rarely legitimate in bulk. */
  export: { points: 5, duration: 3600, onBackendError: "closed", label: "audit exports" },
  /** Managed-model calls: generous, but bounded. */
  models: { points: 300, duration: 60, onBackendError: "open", label: "model requests" },
  invite: { points: 30, duration: 3600, onBackendError: "closed", label: "invitations" },
  relayConnect: { points: 30, duration: 60, onBackendError: "closed", label: "relay connections" },
} as const satisfies Record<string, LimitSpec>;

export type LimitName = keyof typeof LIMITS;

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the bucket refills. Present only when blocked. */
  retryAfterSeconds?: number;
  /** True when the decision was made by the fallback policy, not by a real count. */
  degraded?: boolean;
}

export interface RateLimiter {
  consume(name: LimitName, key: string, cost?: number): Promise<ConsumeResult>;
  /** Resets a bucket — used by a successful sign-in to clear failure counters. */
  reset(name: LimitName, key: string): Promise<void>;
  /**
   * Clear every bucket on every limiter.
   *
   * Two legitimate uses: a test harness needs deterministic state between cases,
   * and an operator who has just flushed Redis (or been under a burst from one
   * NAT'd office) needs to release the blocked keys without a restart. It is
   * deliberately blunt and deliberately named so nobody calls it on a request path.
   */
  resetAll(): Promise<void>;
  readonly backend: "redis" | "memory";
  readonly degraded: boolean;
  close(): Promise<void>;
}

function buildLimiters(backend: "redis" | "memory", redis?: Redis): Map<LimitName, RateLimiterAbstract> {
  const map = new Map<LimitName, RateLimiterAbstract>();
  for (const [name, spec] of Object.entries(LIMITS) as Array<[LimitName, LimitSpec]>) {
    const opts = {
      keyPrefix: `xr:rl:${name}`,
      points: spec.points,
      duration: spec.duration,
    };
    map.set(
      name,
      backend === "redis" && redis ? new RateLimiterRedis({ ...opts, storeClient: redis }) : new RateLimiterMemory(opts),
    );
  }
  return map;
}

export function createRateLimiter(): RateLimiter {
  const env = loadEnv();
  /** Bucket keys this process has touched, per limiter. See `resetAll`. */
  const touched = new Map<LimitName, Set<string>>();
  let backend: "redis" | "memory" = "memory";
  let redis: Redis | undefined;
  let degraded = false;

  if (env.REDIS_URL) {
    try {
      redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
        retryStrategy: (times) => (times > 10 ? null : Math.min(times * 200, 2000)),
      });
      redis.on("error", (error: Error) => {
        // Reconnects are normal; a persistent failure is reported through
        // `degraded` and surfaced by /readyz rather than by log volume.
        if (!degraded) {
          degraded = true;
          getLogger().warn({ detail: error.message }, "redis unavailable — rate limiting degraded");
        }
      });
      redis.on("ready", () => {
        degraded = false;
      });
      backend = "redis";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      getLogger().error({ detail }, "could not create redis client — falling back to in-memory rate limiting");
      redis = undefined;
      backend = "memory";
    }
  }

  const limiters = buildLimiters(backend, redis);

  return {
    backend,
    get degraded() {
      return degraded;
    },

    async consume(name, key, cost = 1) {
      const spec = LIMITS[name];
      const limiter = limiters.get(name);
      if (!limiter) return { allowed: true, remaining: spec.points };

      // Remembered so `resetAll` can clear exactly what this process created.
      let bucket = touched.get(name);
      if (!bucket) {
        bucket = new Set<string>();
        touched.set(name, bucket);
      }
      bucket.add(key);

      try {
        const result = await limiter.consume(key, cost);
        return { allowed: true, remaining: result.remainingPoints };
      } catch (error) {
        // rate-limiter-flexible signals "blocked" and "backend down" through the
        // same rejection channel. Separate them: an object with `msBeforeNext`
        // is a real limit decision; anything else is an infrastructure failure.
        if (error && typeof error === "object" && "msBeforeNext" in error) {
          const ms = Number((error as { msBeforeNext: number }).msBeforeNext);
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)),
          };
        }
        const detail = error instanceof Error ? error.message : String(error);
        getLogger().error({ name, detail }, "rate limiter backend error");
        if (spec.onBackendError === "closed") {
          return { allowed: false, remaining: 0, retryAfterSeconds: 30, degraded: true };
        }
        return { allowed: true, remaining: spec.points, degraded: true };
      }
    },

    async reset(name, key) {
      const limiter = limiters.get(name);
      touched.get(name)?.delete(key);
      if (!limiter) return;
      try {
        await limiter.delete(key);
      } catch {
        // A failed reset is not worth failing a user's request over; the bucket
        // simply expires on its own schedule.
      }
    },

    async resetAll() {
      // Neither rate-limiter-flexible backend offers "drop everything", and
      // scanning Redis by prefix would be a production-footgun dressed as a
      // convenience. Instead each bucket key we have actually seen is remembered,
      // and those are the ones cleared — bounded by whatever the process has
      // served, and exact rather than approximate.
      for (const [name, keys] of touched) {
        const limiter = limiters.get(name);
        if (!limiter) continue;
        for (const key of keys) {
          try {
            await limiter.delete(key);
          } catch {
            // Same reasoning as `reset`: the bucket expires regardless.
          }
        }
        keys.clear();
      }
    },

    async close() {
      if (redis) await redis.quit().catch(() => undefined);
    },
  };
}
