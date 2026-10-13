/**
 * XR Cloud — test harness.
 *
 * Every test runs against a **fresh PGlite database in a scratch directory**, with
 * the real composition root, the real middleware stack and the real migrations.
 * Nothing is mocked except the four things that cannot exist in a test process:
 *
 *   - **Stripe** — the driver is left `disabled`, which is a supported production
 *     state (billing routes answer 503 with a repair string). Tests that need an
 *     entitled org write the subscription row directly, which is what the webhook
 *     would have done. This is deliberately *not* a fake Stripe object: a fake
 *     would let a test pass against behaviour Stripe does not have.
 *   - **Mail** — `capture` mode, which is real production code writing real `.eml`
 *     files. Tests read the file back and pull the token out of it, so the token
 *     extraction exercises the same template that ships.
 *   - **Redis** — absent, so the rate limiter uses its in-process fallback. Rate
 *     limit behaviour under a shared backend is a Redis concern, not XR's.
 *   - **S3** — absent, so the blob store uses the local-directory fallback.
 *
 * Using PGlite rather than Postgres means these tests cannot prove anything about
 * Postgres-specific behaviour (concurrent transactions, advisory locks, `FOR
 * UPDATE` under contention). That gap is real and is listed in
 * `docs/business/SELF-HOST.md` as an operator-runbook item rather than papered
 * over with a green check.
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/app.ts";
import { bootstrap } from "../src/bootstrap.ts";
import { loadEnv, resetEnvCache, type CloudEnv } from "../src/env.ts";
import { eq } from "drizzle-orm";

import { subscriptions } from "../src/db/schema.ts";
import { newId } from "../src/lib/ids.ts";
import type { AppDeps } from "../src/deps.ts";
import type { Hono } from "hono";

export interface Harness {
  readonly app: Hono;
  readonly deps: AppDeps;
  readonly env: CloudEnv;
  readonly mailDir: string;
  /** Read every captured `.eml`, newest last. */
  mails(): Promise<Array<{ to: string; subject: string; body: string; path: string }>>;
  /** Pull the first `token=` value out of the most recent mail to an address. */
  tokenFromMail(email: string): Promise<string>;
  /** Make an org entitled the way a completed Stripe checkout would. */
  grantBusiness(orgId: string, options?: { seats?: number; status?: "active" | "trialing" | "past_due" }): Promise<void>;
  /**
   * Drop an org back to Personal.
   *
   * Needed because signup legitimately starts a Business trial — so "what does a
   * free account see" is only observable after the trial is gone.
   */
  cancelBusiness(orgId: string): Promise<void>;
  close(): Promise<void>;
}

/** Boot a complete, isolated cloud instance. */
export async function harness(label = "test"): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), `xr-cloud-${label}-`));
  const mailDir = join(dir, "mail");

  resetEnvCache();
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_DRIVER: "pglite",
    PGLITE_DIR: join(dir, "db"),
    MAIL_TRANSPORT: "capture",
    MAIL_CAPTURE_DIR: mailDir,
    MAIL_FROM: "XR <no-reply@xr.test>",
    JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
    XR_KEY_ENCRYPTION_KEY: "7DoG1/LYXQB8WIKmOBJt7J2YuZLKrLuckzW+79FYJIY=",
    APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:8787",
    LOG_LEVEL: process.env.XR_TEST_LOG_LEVEL ?? "fatal",
    TRUST_PROXY: "0",
  } satisfies Partial<NodeJS.ProcessEnv>);

  const env = loadEnv(process.env, { reload: true });
  const { deps, shutdown } = await bootstrap(env);
  const { hono } = createApp(deps);

  const readMails = async (): Promise<Array<{ to: string; subject: string; body: string; path: string }>> => {
    let names: string[];
    try {
      names = (await readdir(mailDir)).filter((n) => n.endsWith(".eml")).sort();
    } catch {
      return [];
    }
    const out: Array<{ to: string; subject: string; body: string; path: string }> = [];
    for (const name of names) {
      const path = join(mailDir, name);
      const raw = await readFile(path, "utf8");
      out.push({
        to: /^To:\s*(.*)$/m.exec(raw)?.[1]?.trim() ?? "",
        subject: /^Subject:\s*(.*)$/m.exec(raw)?.[1]?.trim() ?? "",
        body: raw,
        path,
      });
    }
    return out;
  };

  const readToken = async (email: string): Promise<string> => {
    const mails = await readMails();
    const match = [...mails].reverse().find((m) => m.to.toLowerCase().includes(email.toLowerCase()));
    if (!match) throw new Error(`no captured mail for ${email}`);
    const token = /token=([A-Za-z0-9_-]{16,})/.exec(match.body)?.[1];
    if (!token) throw new Error(`no token= in the mail to ${email}`);
    return token;
  };

  const instance: Harness = {
    app: hono,
    deps,
    env,
    mailDir,

    mails: readMails,
    tokenFromMail: readToken,

    async grantBusiness(orgId, options = {}) {
      const seats = options.seats ?? 3;
      const status = options.status ?? "active";
      const now = deps.clock();
      await deps.db.insert(subscriptions).values({
        id: newId("subscription"),
        orgId,
        stripeCustomerId: `cus_test_${orgId.slice(-8)}`,
        stripeSubscriptionId: `sub_test_${orgId.slice(-8)}`,
        stripePriceId: "price_test_seat_monthly",
        plan: "business",
        status,
        interval: "month",
        seats,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        billingEmail: "billing@example.com",
        createdAt: now,
        updatedAt: now,
      });
    },

    async cancelBusiness(orgId) {
      await deps.db
        .update(subscriptions)
        .set({ status: "canceled", canceledAt: deps.clock(), updatedAt: deps.clock() })
        .where(eq(subscriptions.orgId, orgId));
    },

    async close() {
      await shutdown();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return instance;
}

export interface SignupResult {
  readonly accessToken: string;
  readonly refreshCookie: string;
  readonly userId: string;
  readonly orgId: string;
  readonly email: string;
}

export function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Sign up and return a usable bearer token plus the org it created. */
export async function signup(
  h: Harness,
  options: { email?: string; orgName?: string; name?: string } = {},
): Promise<SignupResult> {
  // Every request in this harness arrives from the same peer address, so the
  // per-IP signup limit (5/min — a real, correct limit) would fire long before the
  // suite finished. Clearing buckets between cases keeps the limiter's own test
  // meaningful while leaving the others unaffected.
  await h.deps.limiter.resetAll();
  const email = options.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const res = await h.app.request(
    "/auth/signup",
    jsonBody({ email, name: options.name ?? "Test Person", orgName: options.orgName ?? "Test Team" }),
  );
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    user: { id: string };
    org: { id: string };
    tokens: { accessToken: string };
  };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const refreshCookie = setCookie.split(",").map((s) => s.trim()).find((s) => s.startsWith("xr_refresh=")) ?? "";
  return {
    accessToken: body.tokens.accessToken,
    refreshCookie,
    userId: body.user.id,
    orgId: body.org.id,
    email,
  };
}

/** Add a second user to an existing org through the real invite + accept flow. */
export async function inviteAndAccept(
  h: Harness,
  inviter: SignupResult,
  email: string,
  role: "admin" | "member" = "member",
): Promise<SignupResult> {
  const invited = await h.app.request(
    `/teams/${inviter.orgId}/invites`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${inviter.accessToken}` },
      body: JSON.stringify({ email, role }),
    },
  );
  if (invited.status !== 201 && invited.status !== 200) {
    throw new Error(`invite failed: ${invited.status} ${await invited.text()}`);
  }
  const token = await h.tokenFromMail(email);
  const accepted = await h.app.request(`/invites/${token}/accept`, jsonBody({ name: "Invited Person" }));
  if (accepted.status !== 200 && accepted.status !== 201) {
    throw new Error(`accept failed: ${accepted.status} ${await accepted.text()}`);
  }
  const body = (await accepted.json()) as { org: { id: string }; tokens: { accessToken: string } };
  const setCookie = accepted.headers.get("set-cookie") ?? "";
  const refreshCookie = setCookie.split(",").map((s) => s.trim()).find((s) => s.startsWith("xr_refresh=")) ?? "";

  // The accept endpoint returns the org and a session, not the user record — read
  // the identity back from /auth/me so the helper reflects what a client would do.
  const me = await h.app.request("/auth/me", { headers: { authorization: `Bearer ${body.tokens.accessToken}` } });
  const meBody = (await me.json()) as { user: { id: string } };

  return {
    accessToken: body.tokens.accessToken,
    refreshCookie,
    userId: meBody.user.id,
    orgId: body.org.id,
    email,
  };
}

/** Helpers for the calling conventions used throughout the suite. */
export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function bearerJson(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Micro-USD, because that is the unit the API speaks. $10 == 10_000_000. */
export function dollars(amount: number): number {
  return Math.round(amount * 1_000_000);
}
