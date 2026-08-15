/**
 * XR Phase 01 — shared daemon state/cache layer.
 *
 * ONE coherent home for daemon-scoped cached resources that have no natural
 * domain module of their own:
 *   · internet reachability probe (onboarding) — TTL 15 s
 *   · git summary for /api/overview — TTL 5 s (dashboard polling guard)
 *
 * Domain caches live with their domains because the CLI shares them:
 *   · runtimes   → src/local/runtimes.ts (60 s, config-fingerprint keyed)
 *   · hardware   → src/local/hardware.ts (5 min, background refresh)
 *   · catalog    → src/intelligence/catalog.ts (60 s, fingerprint keyed)
 *   · health     → src/providers/health.ts (60 s positive / 15 s negative)
 * All are built on the SAME primitive (src/util/ttl-cache.ts) — there is
 * exactly one cache implementation in XR.
 *
 * No authorization decision, secret, or user-scoped value is ever cached here
 * (single-user daemon; auth stays per-request in server.ts).
 */

import { TtlCache } from "../../util/ttl-cache.ts";

// ── Internet probe (onboarding.status) ───────────────────────────────────────
const INTERNET_TTL_MS = 15_000;
const internetCache = new TtlCache<boolean>({ ttlMs: INTERNET_TTL_MS, maxEntries: 2 });

/** Best-effort reachability probe; never blocks or throws. Cached 15 s. */
export async function checkInternetCached(): Promise<boolean> {
  const hit = internetCache.get("default");
  if (hit) return hit.value;
  try {
    const res = await fetch("https://registry.npmjs.org/", {
      method: "HEAD",
      signal: AbortSignal.timeout(2000),
    });
    internetCache.set("default", res.ok);
    return res.ok;
  } catch {
    internetCache.set("default", false);
    return false;
  }
}

export function invalidateInternetCache(): void {
  internetCache.clear();
}

// ── Git summary (/api/overview) ──────────────────────────────────────────────
const GIT_TTL_MS = 5_000;
const gitCache = new TtlCache<{ branch: string; dirty: boolean }>({ ttlMs: GIT_TTL_MS, maxEntries: 2 });

/**
 * Cached git summary so dashboard polling never re-runs `git status` on every
 * overview request. Errors fall back to the caller's default (branch: "no git").
 */
export async function gitSummaryCached(cwd: string): Promise<{ branch: string; dirty: boolean } | undefined> {
  const hit = gitCache.get(cwd);
  if (hit) return hit.value;
  try {
    const { runCommand } = await import("../../util/process.ts");
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 3000 }),
      runCommand("git", ["status", "--porcelain"], { cwd, timeoutMs: 3000 }),
    ]);
    if (!branch.ok || !status.ok) return undefined;
    const summary = { branch: branch.stdout.trim() || "detached", dirty: status.stdout.trim().length > 0 };
    gitCache.set(cwd, summary);
    return summary;
  } catch {
    return undefined;
  }
}

export function invalidateGitCache(): void {
  gitCache.clear();
}

/** Ops/observability: TTLs + live stats across the daemon state layer. */
export function daemonCacheStatus() {
  return {
    internet: { ttlMs: INTERNET_TTL_MS, ...internetCache.stats() },
    git: { ttlMs: GIT_TTL_MS, ...gitCache.stats() },
  };
}
