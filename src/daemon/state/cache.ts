/**
 * XR Phase 01 — shared daemon state/cache layer.
 *
 * ONE coherent home for daemon-scoped cached resources that have no natural
 * domain module of their own:
 *   · internet reachability probe (onboarding) — TTL 15 s
 *   · git summary for /api/overview — TTL 5 s, then served stale while one
 *     background probe refreshes it; a request never waits on git
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

/** Best-effort reachability probe; never blocks or throws. Cached 15 s.
 *  XR_NETWORK_PROBES=off (set by the test preload, XR-LAUNCH-012) reports
 *  "offline" without dialing out, so hermetic runs never wait on the network. */
export async function checkInternetCached(): Promise<boolean> {
  if (/^(0|off|false|no)$/i.test(process.env.XR_NETWORK_PROBES ?? "")) return false;
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

/** Offline inspection; unknown is not fabricated as a failed live probe. */
export function inspectInternetCache(): boolean | undefined {
  const hit = internetCache.get("default");
  return hit && !hit.stale ? hit.value : undefined;
}

export function invalidateInternetCache(): void {
  internetCache.clear();
}

// ── Git summary (/api/overview) ──────────────────────────────────────────────
const GIT_TTL_MS = 5_000;
const GIT_SWR_MS = 60_000;
export interface GitSummary { branch: string; dirty: boolean }
const gitCache = new TtlCache<{ summary: GitSummary | null; observedAt: number }>({ ttlMs: GIT_TTL_MS, staleWhileRevalidateMs: GIT_SWR_MS, maxEntries: 2 });

async function probeGit(cwd: string): Promise<{ summary: GitSummary | null; observedAt: number }> {
  let summary: GitSummary | null = null;
  try {
    const { runCommand } = await import("../../util/process.ts");
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 3000 }),
      runCommand("git", ["status", "--porcelain"], { cwd, timeoutMs: 3000 }),
    ]);
    if (branch.ok && status.ok) summary = { branch: branch.stdout.trim() || "detached", dirty: status.stdout.trim().length > 0 };
  } catch { /* no git binary or not a repository: unavailable */ }
  return { summary, observedAt: Date.now() };
}

/**
 * The overview's git summary, without ever holding the response on git: `git status` walks the
 * working tree (≈1 s on hosted Windows, up to 0.9 s on hosted macOS). Cold → `pending` while ONE
 * background probe runs; past the TTL the last summary is served while one probe refreshes it.
 * `unavailable` keeps the legacy `{ branch: "no git" }` value.
 */
export function observeGitSummary(cwd: string): { git: GitSummary | null; gitStatus: { state: "ready" | "pending" | "unavailable"; observedAt: number | null } } {
  const hit = gitCache.get(cwd);
  if (!hit || hit.stale) void gitCache.getOrStart(cwd, () => probeGit(cwd)).catch(() => { /* probeGit never rejects */ });
  if (!hit) return { git: null, gitStatus: { state: "pending", observedAt: null } };
  const { summary, observedAt } = hit.value;
  return { git: summary ?? { branch: "no git", dirty: false }, gitStatus: { state: summary ? "ready" : "unavailable", observedAt } };
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
