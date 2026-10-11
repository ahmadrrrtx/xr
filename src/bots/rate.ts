/**
 * XR — per-chat rate limiting for chat surfaces (Phase 26 shared layer).
 *
 * One token bucket per chat. The bucket set is rebuilt when the configured
 * limit changes, so a settings edit takes effect without a restart.
 */
import { KeyedTokenBuckets, DEFAULT_TELEGRAM_RATE_LIMIT, type RateLimitConfig } from "../automation/token-bucket.ts";

export class ChatRateLimiter {
  private buckets = new KeyedTokenBuckets(DEFAULT_TELEGRAM_RATE_LIMIT);
  private cfgKey = "";

  /** True when the message may pass. `key` is the chat (or user) identifier. */
  allow(key: string, cfg: RateLimitConfig, nowMs: number = Date.now()): boolean {
    const cfgKey = JSON.stringify(cfg);
    if (cfgKey !== this.cfgKey) {
      this.buckets = new KeyedTokenBuckets({ tokens: cfg.tokens, refillPerSec: cfg.refillPerSec });
      this.cfgKey = cfgKey;
    }
    return this.buckets.allow(key, nowMs);
  }
}
