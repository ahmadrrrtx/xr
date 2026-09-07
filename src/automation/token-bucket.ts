/**
 * XR Phase 9 — token-bucket rate limiter (pure).
 *
 * Used by Telegram per-user limits. Capacity is the burst; refillPerSec is
 * the sustained rate. `take()` is the only mutation; tests drive `now`.
 */
export class TokenBucket {
  tokens: number;
  lastMs: number;

  constructor(
    public readonly capacity: number,
    public readonly refillPerSec: number,
    nowMs = 0,
  ) {
    if (!(capacity > 0) || !(refillPerSec >= 0)) {
      throw new Error("TokenBucket: capacity > 0 and refillPerSec ≥ 0 required");
    }
    this.tokens = capacity;
    this.lastMs = nowMs;
  }

  refill(nowMs: number): void {
    const elapsed = Math.max(0, nowMs - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = nowMs;
  }

  /** Consume `n` tokens. Returns false when the bucket cannot cover the take. */
  take(n = 1, nowMs = this.lastMs): boolean {
    this.refill(nowMs);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  remaining(nowMs = this.lastMs): number {
    this.refill(nowMs);
    return this.tokens;
  }
}

export interface RateLimitConfig {
  /** Burst size (default 10). */
  tokens: number;
  /** Sustained refill (default 0.2/s = 12/min). */
  refillPerSec: number;
}

export const DEFAULT_TELEGRAM_RATE_LIMIT: RateLimitConfig = {
  tokens: 10,
  refillPerSec: 0.2,
};

/** One bucket per key (user id / chat id). */
export class KeyedTokenBuckets {
  private buckets = new Map<string, TokenBucket>();

  constructor(private readonly cfg: RateLimitConfig = DEFAULT_TELEGRAM_RATE_LIMIT) {}

  allow(key: string, nowMs: number, n = 1): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.cfg.tokens, this.cfg.refillPerSec, nowMs);
      this.buckets.set(key, b);
    }
    return b.take(n, nowMs);
  }

  remaining(key: string, nowMs: number): number {
    const b = this.buckets.get(key);
    if (!b) return this.cfg.tokens;
    return b.remaining(nowMs);
  }
}
