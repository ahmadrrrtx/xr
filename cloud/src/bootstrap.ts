/**
 * XR Cloud — composition root.
 *
 * The single place where a live `AppDeps` is assembled from an environment. Tests
 * build their own with a scratch database and a capture mail transport; this one
 * builds the real thing. Neither path can drift from the other, because the routes
 * only ever see the interface.
 */

import type { AppDeps } from "./deps.ts";
import { assertBootable, loadEnv, type CloudEnv } from "./env.ts";
import { createDatabase } from "./db/client.ts";
import { kekFromEnv } from "./lib/crypto.ts";
import { createBackgroundQueue } from "./lib/background.ts";
import { createLogger, type Logger } from "./lib/logger.ts";
import { createOrgKeyStore } from "./lib/org-keys.ts";
import { createRateLimiter, type RateLimiter } from "./lib/ratelimit.ts";
import { createRelayHub } from "./relay/hub.ts";
import { createAuditService } from "./services/audit.ts";
import { createBlobStore } from "./services/blob.ts";
import { createMailer } from "./services/mailer.ts";
import { createMeteringService } from "./services/metering.ts";
import { createStripeGateway } from "./services/stripe.ts";

export interface BootstrapResult {
  deps: AppDeps;
  log: Logger;
  /** Everything the process must release on shutdown, in order. */
  shutdown: () => Promise<void>;
}

export async function bootstrap(env: CloudEnv = loadEnv()): Promise<BootstrapResult> {
  // Refuse to start half-configured. A capability that is partially set is a bug,
  // not a degraded mode (Constitution Art. IV.4).
  assertBootable(env);

  const log = createLogger({ level: env.LOG_LEVEL });

  const database = await createDatabase((line) => log.info({ migration: line }, "migration"));
  const limiter: RateLimiter = createRateLimiter();

  const orgKeys = createOrgKeyStore(env, kekFromEnv(env.XR_KEY_ENCRYPTION_KEY));
  const audit = createAuditService(database.db, log);
  const metering = createMeteringService(database.db, log);
  const relay = createRelayHub(log);
  const mailer = createMailer(env);
  const stripe = createStripeGateway(env, log);
  const blob = createBlobStore(env, log);
  const background = createBackgroundQueue(log);

  const deps: AppDeps = {
    env,
    db: database.db,
    database,
    log,
    limiter,
    mailer,
    stripe,
    blob,
    relay,
    audit,
    metering,
    background,
    orgKeys,
    clock: () => new Date(),
  };

  // Say out loud what is and is not configured. An operator reading startup logs
  // learns the deployment's shape without calling an endpoint.
  const capabilities = Object.entries(env.capabilities)
    .map(([name, cap]) => `${name}=${cap.state}`)
    .join(" ");
  log.info(
    {
      nodeEnv: env.NODE_ENV,
      database: database.driver,
      rateLimiter: limiter.backend,
      capabilities,
    },
    "xr-cloud booted",
  );
  for (const [name, cap] of Object.entries(env.capabilities)) {
    if (cap.state !== "ready") {
      log.warn({ capability: name, state: cap.state, detail: cap.detail }, "capability unavailable");
    }
  }

  return {
    deps,
    log,
    shutdown: async () => {
      // Order matters. Stop accepting new background work first, then let the
      // queued work finish, and only then close the database. Closing the handle
      // under an in-flight write is how an audit row disappears with nobody told.
      background.close();
      relay.closeAll("server shutting down");
      const drained = await background.drain();
      if (drained.remaining > 0) {
        log.warn({ remaining: drained.remaining, failures: background.failures }, "shutdown dropped queued background work");
      }
      await limiter.close();
      await database.close();
      orgKeys.clear();
    },
  };
}
