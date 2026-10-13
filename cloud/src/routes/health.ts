/**
 * XR Cloud — health endpoints.
 *
 * `/healthz` answers "is the process alive". It never touches the database, so a
 * database outage does not make an orchestrator kill and restart every healthy
 * process — which is the classic way a small incident becomes a large one.
 *
 * `/readyz` answers "should this instance receive traffic", and therefore **does**
 * check dependencies. It reports each one individually rather than collapsing to
 * a boolean, so a human reading it learns *which* thing is broken. It answers 503
 * only when a dependency that request handling actually requires is down; a
 * missing Stripe key or an unset S3 bucket is reported as `disabled` and does not
 * take the service out of rotation, because teams, SSO, memory and audit all work
 * without them (Constitution Art. IV.2 — a degraded result is reported as
 * degraded, not as failure).
 */

import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";

export function healthRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      service: "xr-cloud",
      version: "1.0.0",
      uptimeSeconds: Math.round(process.uptime()),
      at: deps.clock().toISOString(),
    }),
  );

  app.get("/readyz", async (c) => {
    const dbOk = await deps.database.ping().catch(() => false);

    // Every check speaks the same three words — `ready`, `disabled`,
    // `misconfigured` — so the admin console can render one status dot component
    // instead of special-casing each capability. `ok` is kept alongside `state`
    // for probes that only care about a boolean.
    const checks = {
      database: {
        state: dbOk ? ("ready" as const) : ("misconfigured" as const),
        ok: dbOk,
        driver: deps.database.driver,
        detail: dbOk ? `connected via ${deps.database.driver}` : "database did not answer a liveness probe",
      },
      rateLimiter: {
        state: deps.limiter.degraded
          ? ("misconfigured" as const)
          : deps.limiter.backend === "redis"
            ? ("ready" as const)
            : ("disabled" as const),
        ok: !deps.limiter.degraded || deps.limiter.backend === "memory",
        backend: deps.limiter.backend,
        // A degraded limiter is reported in full sentences because an operator
        // seeing it needs to know whether their shared limits are actually shared.
        detail: deps.limiter.degraded
          ? "Redis is unreachable — limits are falling back to the per-process policy, so they are not shared across replicas"
          : deps.limiter.backend === "memory"
            ? "in-memory limiter: correct for a single instance, wrong behind a load balancer"
            : "",
      },
      mail: {
        ...deps.env.capabilities.mail,
        transport: deps.mailer.transport,
        // `ok` mirrors the shared vocabulary so a probe never has to know that
        // one capability reports itself differently from the others.
        ok: deps.env.capabilities.mail.state === "ready",
      },
      stripe: { ...deps.env.capabilities.stripe, ok: deps.env.capabilities.stripe.state === "ready" },
      blobStorage: { ...deps.env.capabilities.blobStorage, ok: deps.env.capabilities.blobStorage.state === "ready" },
      licenseSigning: {
        ...deps.env.capabilities.licenseSigning,
        ok: deps.env.capabilities.licenseSigning.state === "ready",
      },
      relay: { state: "ready" as const, ok: true, detail: "", ...deps.relay.stats() },
    };

    // Only the database is load-bearing for every request. A deployment with no
    // Stripe keys is *ready* — it serves the free tier and every team feature that
    // does not involve money.
    const ready = checks.database.ok;
    return c.json(
      {
        ok: ready,
        checks,
        at: deps.clock().toISOString(),
        note:
          "A capability in state `disabled` is a configuration choice and does not make this instance unready. " +
          "`misconfigured` means it was configured wrongly and is the state that should page someone.",
      },
      ready ? 200 : 503,
    );
  });

  /**
   * The licence public key. Public, cacheable, and the only thing the desktop
   * would ever need from the network for licence purposes — and it does not need
   * it, because the key is baked into the binary. This endpoint exists so a
   * third-party verifier (or a curious customer) can confirm signatures.
   */
  app.get("/.well-known/xr-license-pubkey", async (c) => {
    const { buildLicensePublicKeyDocument } = await import("../lib/license-pubkey.ts");
    const document = await buildLicensePublicKeyDocument(deps.env);
    // Never cached empty: a deployment with no signing key must not have its
    // (empty) answer pinned by a CDN for an hour.
    return c.json({ ...document }, 200, {
      "cache-control": document.keys.length > 0 ? "public, max-age=3600" : "no-store",
    });
  });

  /**
   * `security.txt` (RFC 9116). Served from the API as well as the website so a
   * researcher who only ever saw api.xr.rrrtx.ai still finds the reporting route.
   */
  app.get("/.well-known/security.txt", (c) =>
    c.text(
      [
        "Contact: mailto:security@xr.rrrtx.ai",
        "Expires: 2027-10-14T00:00:00.000Z",
        "Preferred-Languages: en",
        "Canonical: https://xr.rrrtx.ai/.well-known/security.txt",
        "Policy: https://xr.rrrtx.ai/security",
        "# We read every report and reply. No bounty is paid in v1.0 — reports are credited if you want them to be.",
      ].join("\n"),
      200,
      { "content-type": "text/plain; charset=utf-8" },
    ),
  );

  return app;
}
