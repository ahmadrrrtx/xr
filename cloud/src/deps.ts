/**
 * XR Cloud — composition root.
 *
 * Every route is a factory that receives this object. Nothing reaches for a
 * global: no module-level database handle, no module-level Stripe client, no
 * `process.env` read inside a handler. That is what makes the acceptance tests
 * possible — a test builds one `AppDeps` with a scratch PGlite database and a
 * capture mail transport, and the routes under test are the same bytes that run
 * in production.
 *
 * Constitution Art. VI.1 names the composition root as the place services are
 * wired; this is that place for the cloud service.
 */

import type { DatabaseHandle, CloudDb } from "./db/client.ts";
import type { CloudEnv } from "./env.ts";
import type { Logger } from "./lib/logger.ts";
import type { RateLimiter } from "./lib/ratelimit.ts";
import type { Mailer } from "./services/mailer.ts";
import type { StripeGateway } from "./services/stripe.ts";
import type { BlobStore } from "./services/blob.ts";
import type { RelayHub } from "./relay/hub.ts";
import type { BackgroundQueue } from "./lib/background.ts";
import type { AuditService } from "./services/audit.ts";
import type { MeteringService } from "./services/metering.ts";

/** Per-request authenticated principal. Built by `middleware/auth.ts`. */
export interface AuthContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly kind: "web" | "device" | "cli" | "vscode" | "mobile";
  readonly orgId: string | null;
  readonly role: "owner" | "admin" | "member" | null;
  /** How the caller proved identity this request. */
  readonly via: "cookie" | "bearer" | "api_key";
  /** Set when `via === "api_key"`. */
  readonly apiKeyScopes: readonly string[];
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

export interface AppDeps {
  readonly env: CloudEnv;
  readonly db: CloudDb;
  readonly database: DatabaseHandle;
  readonly log: Logger;
  readonly limiter: RateLimiter;
  readonly mailer: Mailer;
  readonly stripe: StripeGateway;
  readonly blob: BlobStore;
  readonly relay: RelayHub;
  readonly audit: AuditService;
  readonly metering: MeteringService;
  /** Serialized fire-and-forget work. Drained before the database closes. */
  readonly background: BackgroundQueue;
  /** Wrapped org keys, decrypted on demand and cached briefly. Never logged. */
  readonly orgKeys: OrgKeyStore;
  readonly clock: () => Date;
}

/**
 * Org key cache. Unwrapping is one AES-GCM open (~microseconds), so the cache is
 * about avoiding a DB round-trip per memory read, not about CPU. Bounded and
 * time-limited (Art. XII · Rule 3) so a rotated KEK takes effect within minutes
 * without a restart.
 */
export interface WrappedOrgKey {
  /** base64(iv||ct||tag) of the org key under the deployment KEK. */
  readonly ciphertext: string;
  /** Which KEK wrapped it. Stored so a rotation can find stale rows. */
  readonly kekId: string;
}

export interface OrgKeyStore {
  /** The deployment KEK. Reading it is the only way to reach team plaintext. */
  readonly kek: Buffer;
  /** Identifier written into every new row's `kek_id` column. */
  readonly kekId: string;
  /** Fresh 32-byte org key, generated once per org at signup. */
  generate(): Buffer;
  /** Wrap an org key under the deployment KEK, tagging it with `kekId`. */
  wrap(key: Buffer): WrappedOrgKey;
  /**
   * Unwrap and cache. Throws `CryptoError` if the wrapped value does not
   * authenticate — a wrong KEK must fail loudly, never fall back to a default.
   */
  get(orgId: string, ciphertext: string): Buffer;
  invalidate(orgId: string): void;
  clear(): void;
  readonly size: number;
}
