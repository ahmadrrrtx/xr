/**
 * XR Phase 01 — generic TTL cache + promise-dedup + stale-while-revalidate.
 *
 * ONE primitive for every Phase-01 resource cache (runtime detection, provider
 * health, hardware specs, intelligence catalog, internet probe, git summary):
 * no duplicated cache implementations anywhere else.
 *
 * Design contract (docs/perf/PERF-BUDGETS.md §Phase 01):
 *  · KEY   — supplied by the caller; resources define config-aware keys so a
 *            config/env change invalidates automatically.
 *  · VALUE — the resource value; never a promise, never an error.
 *  · TTL   — fresh window.
 *  · STALE — `staleWhileRevalidateMs` after TTL: the stale value is served
 *            immediately and a SINGLE background refresh is started (deduped).
 *            Beyond it, callers await a fresh value.
 *  · ERROR POLICY — rejected work is never cached; the pending slot is removed
 *            so the next caller retries (no poison).
 *  · CONCURRENCY — getOrStart dedupes concurrent callers onto ONE in-flight
 *            operation per key (request A starts; B/C await the same promise).
 *  · MEMORY — maxEntries with oldest-eviction bounds the map.
 *  · No timers: expiry is checked lazily on access (no unref'd timer leaks).
 *
 * This module must stay dependency-free (L0) so L1/L2 modules and surfaces can
 * all import it.
 */

export interface TtlCacheOptions {
  /** Fresh window in ms. */
  ttlMs: number;
  /** Serve stale for this many ms beyond ttlMs while refreshing in background. */
  staleWhileRevalidateMs?: number;
  /** Maximum distinct keys; oldest insertion is evicted beyond this. */
  maxEntries?: number;
  /** Optional stats callbacks (metrics wiring). */
  onStats?: (event: "hit" | "miss" | "dedup" | "refresh") => void;
}

interface Entry<V> {
  value: V;
  at: number;
  /** True when the value is past ttlMs but still within the SWR window. */
  stale: boolean;
  insertedAt: number;
  /** Per-entry TTL override (e.g. shorter negative caching); default = cache ttlMs. */
  ttlMs?: number;
}

interface Pending<V> {
  /** Foreground getOrStart promises resolve CacheGetResult<V>; background refreshes resolve void. */
  promise: Promise<CacheGetResult<V>> | Promise<void>;
  at: number;
}

export interface CacheGetResult<V> {
  value: V;
  /** True when served from cache (fresh or stale). */
  fromCache: boolean;
  /** True when the value is past TTL but was served during background refresh. */
  stale: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  deduped: number;
  refreshes: number;
  entries: number;
  pending: number;
}

export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  private pending = new Map<string, Pending<V>>();
  private hits = 0;
  private misses = 0;
  private deduped = 0;
  private refreshes = 0;
  private readonly ttlMs: number;
  private readonly swrMs: number;
  private readonly maxEntries: number;
  private readonly onStats?: (event: "hit" | "miss" | "dedup" | "refresh") => void;

  constructor(opts: TtlCacheOptions) {
    if (!(opts.ttlMs > 0)) throw new Error("TtlCache: ttlMs must be > 0");
    this.ttlMs = opts.ttlMs;
    this.swrMs = Math.max(0, opts.staleWhileRevalidateMs ?? 0);
    this.maxEntries = Math.max(1, opts.maxEntries ?? 64);
    this.onStats = opts.onStats;
  }

  /** Look up a value without starting work. Returns undefined when absent or fully expired. */
  get(key: string): CacheGetResult<V> | undefined {
    const result = this.peek(key);
    if (result) {
      this.hits++;
      this.onStats?.("hit");
    } else {
      this.misses++;
      this.onStats?.("miss");
    }
    return result;
  }

  /** Stat-less lookup (getOrStart counts its own misses to avoid double-counting). */
  private peek(key: string): CacheGetResult<V> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.at;
    const ttlMs = entry.ttlMs ?? this.ttlMs;
    if (age > ttlMs + this.swrMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: entry.value, fromCache: true, stale: age > ttlMs };
  }

  /** True when a fresh (within-TTL) value exists. */
  isFresh(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    const ttlMs = entry.ttlMs ?? this.ttlMs;
    return Date.now() - entry.at <= ttlMs;
  }

  /** Store a value (overwrites; resets the clock). */
  set(key: string, value: V, opts?: { ttlMs?: number }): void {
    this.evictIfNeeded();
    this.entries.set(key, {
      value,
      at: Date.now(),
      stale: false,
      insertedAt: Date.now(),
      ttlMs: opts?.ttlMs,
    });
  }

  /** Remove one key or clear everything. */
  delete(key: string): void {
    this.entries.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      deduped: this.deduped,
      refreshes: this.refreshes,
      entries: this.entries.size,
      pending: this.pending.size,
    };
  }

  /**
   * Get a cached value or start `work` to produce one — deduplicated.
   *
   * Semantics:
   *   · fresh entry        → return it immediately (no work).
   *   · stale entry (SWR)  → return it immediately AND start one background
   *                          refresh (deduped per key; failures are swallowed
   *                          for the background path so callers still get the
   *                          stale value — the next call retries).
   *   · no entry / expired → await a single in-flight `work`; concurrent
   *                          callers share it. On rejection the pending slot is
   *                          removed and the error propagates to all awaiters
   *                          (nothing is cached).
   */
  getOrStart(
    key: string,
    work: () => Promise<V>,
    opts?: { ttlMs?: (value: V) => number | undefined },
  ): Promise<CacheGetResult<V>> {
    const fresh = this.peek(key);
    if (fresh && !fresh.stale) {
      this.hits++;
      this.onStats?.("hit");
      return Promise.resolve(fresh);
    }

    // Stale within SWR window: serve it now, refresh in the background.
    if (fresh?.stale) {
      this.backgroundRefresh(key, work, opts);
      return Promise.resolve(fresh);
    }

    const existing = this.pending.get(key);
    if (existing) {
      this.deduped++;
      this.onStats?.("dedup");
      return existing.promise as Promise<CacheGetResult<V>>;
    }

    this.misses++;
    this.onStats?.("miss");
    const promise = work().then((value) => {
      // Success: cache and clear the pending slot.
      this.pending.delete(key);
      this.set(key, value, { ttlMs: opts?.ttlMs?.(value) });
      return { value, fromCache: false, stale: false } as CacheGetResult<V>;
    });
    this.pending.set(key, { promise, at: Date.now() });
    // On rejection: remove the pending slot so the NEXT caller retries; the
    // error propagates to everyone awaiting this promise (no poison).
    promise.catch(() => {
      this.pending.delete(key);
    });
    return promise;
  }

  /** Number of keys currently held (memory-bound observability). */
  get size(): number {
    return this.entries.size;
  }

  /** Live keys (for targeted invalidation). */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  private backgroundRefresh(
    key: string,
    work: () => Promise<V>,
    opts?: { ttlMs?: (value: V) => number | undefined },
  ): void {
    const existing = this.pending.get(key);
    if (existing) {
      this.deduped++;
      this.onStats?.("dedup");
      return;
    }
    this.refreshes++;
    this.onStats?.("refresh");
    const promise = work()
      .then((value) => {
        this.pending.delete(key);
        this.set(key, value, { ttlMs: opts?.ttlMs?.(value) });
      })
      .catch(() => {
        // Background refresh failed: keep the stale value; next caller retries.
        this.pending.delete(key);
      });
    this.pending.set(key, { promise, at: Date.now() });
  }

  private evictIfNeeded(): void {
    while (this.entries.size >= this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [k, e] of this.entries) {
        if (e.insertedAt < oldestAt) {
          oldestAt = e.insertedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}
