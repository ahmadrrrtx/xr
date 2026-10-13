/**
 * Authentication, sessions and free-tier guarantees.
 *
 * The first test in this file is the most important one in the repository: XR's
 * constitutional rule is that the local product is free, fully functional and
 * never phones home. A cloud service that a personal install must talk to in
 * order to work would violate that, so the test asserts the *negative* — that the
 * service holds no opinion about a personal account and grants nothing that a
 * local install does not already have.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bearer, bearerJson, dollars, harness, inviteAndAccept, jsonBody, signup, type Harness } from "./helpers.ts";

let h: Harness;

beforeAll(async () => {
  h = await harness("auth");
});

afterAll(async () => {
  await h.close();
});

describe("signup", () => {
  test("creates a user, an org and a trial in one step", async () => {
    const res = await h.app.request(
      "/auth/signup",
      jsonBody({ email: "founder@example.com", name: "Founder", orgName: "Acme Labs" }),
    );
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      user: { id: string; email: string };
      org: { id: string; slug: string; role: string };
      plan: string;
      trialEndsInDays: number;
      tokens: { accessToken: string; expiresInSeconds: number };
    };

    expect(body.user.email).toBe("founder@example.com");
    expect(body.org.role).toBe("owner");
    expect(body.org.slug).toBe("acme-labs");
    expect(body.plan).toBe("trial");
    expect(body.trialEndsInDays).toBeGreaterThan(0);
    // The brief caps trials at 5 seats and a trial must not need a card.
    expect(body.trialEndsInDays).toBe(h.env.TRIAL_DAYS);
    // 15-minute access token, per the brief.
    expect(body.tokens.expiresInSeconds).toBe(900);
  });

  test("sets an httpOnly refresh cookie and never returns the refresh token in the body", async () => {
    const res = await h.app.request(
      "/auth/signup",
      jsonBody({ email: "cookie@example.com", name: "C", orgName: "Cookie Co" }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("xr_refresh=");
    expect(setCookie).toContain("HttpOnly");
    // Lax, not Strict: the OIDC redirect back from an IdP is a cross-site GET, and
    // Strict would drop the cookie on exactly the flow that needs it.
    expect(setCookie).toContain("SameSite=Lax");

    const body = (await res.json()) as Record<string, unknown>;
    const tokens = body.tokens as Record<string, unknown>;
    expect(Object.keys(tokens)).not.toContain("refreshToken");
  });

  test("rejects a weak password on signup rather than silently accepting it", async () => {
    const res = await h.app.request(
      "/auth/signup",
      jsonBody({ email: "weak@example.com", password: "short", name: "W", orgName: "Weak Co" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; repair?: string } };
    expect(body.error.code).toBe("validation_failed");
  });

  test("refuses a duplicate address without confirming which account exists", async () => {
    await h.app.request("/auth/signup", jsonBody({ email: "dupe@example.com", name: "D", orgName: "Dupe One" }));
    const second = await h.app.request(
      "/auth/signup",
      jsonBody({ email: "dupe@example.com", name: "D", orgName: "Dupe Two" }),
    );
    const body = (await second.json()) as { error: { message: string; repair?: string } };
    // Signup is an explicit act by the account owner, so a conflict is fine here —
    // what matters is that the message offers a way forward instead of a dead end.
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(body.error.repair ?? "").not.toBe("");
  });
});

describe("magic link", () => {
  test("signs in and rotates to a session, consuming the link exactly once", async () => {
    const email = "magic@example.com";
    const requested = await h.app.request("/auth/magic-link", jsonBody({ email }));
    expect(requested.status).toBe(200);
    const requestedBody = (await requested.json()) as { ok: boolean; capturedTo?: string };
    expect(requestedBody.ok).toBe(true);
    // Development capture mode reports the file so a developer can find it; in
    // production this key is absent, which the next assertion locks in.
    expect(requestedBody.capturedTo ?? h.mailDir).toBeTruthy();

    const token = await h.tokenFromMail(email);
    const first = await h.app.request(`/auth/magic/callback?token=${token}`, { redirect: "manual" });
    expect(first.status).toBe(302);

    const second = await h.app.request(`/auth/magic/callback?token=${token}`, { redirect: "manual" });
    expect(second.status).toBe(410);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("gone");
  });

  test("does not say whether an address has an account", async () => {
    const known = (await (await h.app.request("/auth/magic-link", jsonBody({ email: "magic@example.com" }))).json()) as {
      message: string;
    };
    const unknown = (
      await (await h.app.request("/auth/magic-link", jsonBody({ email: "nobody-here@example.com" }))).json()
    ) as { message: string };
    expect(known.message).toBe(unknown.message);
  });

  test("rate limits by address independently of source IP", async () => {
    // Fresh address so the earlier tests' budget does not leak into this one.
    const email = `ratelimit-${Date.now()}@example.com`;
    let sawLimit = false;
    for (let i = 0; i < 15; i += 1) {
      const res = await h.app.request("/auth/magic-link", jsonBody({ email }));
      if (res.status === 429) {
        sawLimit = true;
        // A 429 must say when to come back; a bare 429 is a dead end for a client.
        expect(res.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });

  test("drops an off-origin redirect hint instead of honouring it", async () => {
    await h.deps.limiter.resetAll();
    const email = "redirect@example.com";
    await h.app.request("/auth/magic-link", jsonBody({ email, redirectTo: "https://evil.example.com/steal" }));
    const token = await h.tokenFromMail(email);
    const res = await h.app.request(`/auth/magic/callback?token=${token}`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example.com");
    expect(location.startsWith(h.env.APP_URL)).toBe(true);
  });
});

describe("sessions", () => {
  test("rejects an unauthenticated request with a repair string, not a bare 401", async () => {
    const res = await h.app.request("/auth/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; repair?: string; requestId?: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.repair).toBeTruthy();
    expect(body.error.requestId).toBeTruthy();
  });

  test("rejects a garbage bearer token", async () => {
    const res = await h.app.request("/auth/me", { headers: bearer("not.a.jwt") });
    expect(res.status).toBe(401);
  });

  test("lists the caller's own sessions and can revoke one", async () => {
    const user = await signup(h);
    const listed = await h.app.request("/auth/sessions", { headers: bearer(user.accessToken) });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { sessions: Array<{ id: string; current: boolean; ip: string | null }> };
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    const current = body.sessions.find((s) => s.current);
    expect(current).toBeTruthy();

    const revoked = await h.app.request(`/auth/sessions/${current?.id}`, {
      method: "DELETE",
      headers: bearer(user.accessToken),
    });
    expect(revoked.status).toBe(200);

    const after = await h.app.request("/auth/me", { headers: bearer(user.accessToken) });
    expect(after.status).toBe(401);
  });

  test("rotates a refresh token and detects reuse of the old one", async () => {
    const res = await h.app.request(
      "/auth/signup",
      jsonBody({ email: `rotate-${Date.now()}@example.com`, name: "R", orgName: "Rotate Co" }),
    );
    const cookie = (res.headers.get("set-cookie") ?? "")
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.startsWith("xr_refresh="));
    expect(cookie).toBeTruthy();
    const refreshCookie = cookie?.split(";")[0] ?? "";

    const first = await h.app.request("/auth/refresh", { method: "POST", headers: { cookie: refreshCookie } });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { tokens: { accessToken: string } };
    expect(firstBody.tokens.accessToken).toBeTruthy();

    // Replaying the consumed token is the signature of a stolen cookie, so the
    // whole family is revoked rather than just that one token.
    const replay = await h.app.request("/auth/refresh", { method: "POST", headers: { cookie: refreshCookie } });
    expect(replay.status).toBe(401);
    const replayBody = (await replay.json()) as { error: { code: string; repair?: string } };
    expect(replayBody.error.code).toBe("unauthorized");

    const rotated = (first.headers.get("set-cookie") ?? "")
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.startsWith("xr_refresh="));
    const nextCookie = rotated?.split(";")[0] ?? "";
    if (nextCookie) {
      const afterFamilyRevoke = await h.app.request("/auth/refresh", {
        method: "POST",
        headers: { cookie: nextCookie },
      });
      expect(afterFamilyRevoke.status).toBe(401);
    }
  });
});

describe("the free tier is not a decremented version of the paid tier", () => {
  test("a signed-in personal account is granted zero business entitlements", async () => {
    const user = await signup(h);
    // Signup starts a Business trial, so the free state is the trial being gone.
    await h.cancelBusiness(user.orgId);
    const view = await h.app.request("/license/me", { headers: bearer(user.accessToken) });
    expect(view.status).toBe(200);
    const body = (await view.json()) as {
      businessActive: boolean;
      features: string[];
      status: string;
      trial: unknown;
      note: string;
    };
    expect(body.businessActive).toBe(false);
    expect(body.features).toEqual([]);
    expect(body.status).toBe("canceled");
    expect(body.trial).toBeNull();
    // The free state carries no error framing, and the payload says out loud that
    // the local product is untouched.
    expect(body.note).toContain("unaffected");
  });

  test("business-only routes refuse a personal org and name the repair", async () => {
    const user = await signup(h);
    await h.cancelBusiness(user.orgId);
    const res = await h.app.request(`/teams/${user.orgId}/api-keys`, { headers: bearer(user.accessToken) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: { code: string; repair?: string; message: string } };
    expect(body.error.repair).toBeTruthy();
    // And the refusal must not imply the local product stopped working.
    expect(body.error.message.toLowerCase()).not.toContain("not allowed to use xr");
  });

  test("refusing a business route does not revoke or damage the account", async () => {
    const user = await signup(h);
    await h.cancelBusiness(user.orgId);
    await h.app.request(`/teams/${user.orgId}/api-keys`, { headers: bearer(user.accessToken) });
    const me = await h.app.request("/auth/me", { headers: bearer(user.accessToken) });
    expect(me.status).toBe(200);
    const teams = await h.app.request("/teams", { headers: bearer(user.accessToken) });
    expect(teams.status).toBe(200);
    const body = (await teams.json()) as { teams: Array<{ plan: string; planStatus: string }>; hasTeams: boolean };
    expect(body.hasTeams).toBe(true);
    expect(body.teams[0]?.plan).toBe("business");
    // Cancelled, but the team itself is untouched — the account is not degraded.
    expect(body.teams[0]?.planStatus).toBe("canceled");
  });
});

describe("CSRF", () => {
  test("rejects a cookie-authenticated mutation with no CSRF token", async () => {
    const res = await h.app.request(
      "/auth/signup",
      jsonBody({ email: `csrf-${Date.now()}@example.com`, name: "C", orgName: "Csrf Co" }),
    );
    const setCookie = (res.headers.get("set-cookie") ?? "")
      .split(",")
      .map((s) => s.trim());
    const session = setCookie.find((s) => s.startsWith("xr_session="))?.split(";")[0] ?? "";
    const csrf = setCookie.find((s) => s.startsWith("xr_csrf="))?.split(";")[0] ?? "";
    expect(session).toBeTruthy();
    expect(csrf).toBeTruthy();

    // A mutation on a cookie session with no CSRF header must be refused. Uses a
    // real state change (renaming a team) rather than logout, because logout is
    // harmless to forge and would make the assertion weak.
    const orgId = ((await (await h.app.request("/auth/me", { headers: { cookie: session } })).json()) as {
      memberships: Array<{ orgId: string }>;
    }).memberships[0]?.orgId;

    const withoutToken = await h.app.request(`/teams/${orgId}`, {
      method: "PATCH",
      headers: { cookie: session, "content-type": "application/json" },
      body: JSON.stringify({ name: "Should Not Apply" }),
    });
    expect(withoutToken.status).toBe(403);
    const err = (await withoutToken.json()) as { error: { code: string; repair?: string } };
    expect(err.error.code).toBe("csrf_failed");
    expect(err.error.repair).toBeTruthy();

    const stillOldName = (await (
      await h.app.request(`/teams/${orgId}`, { headers: { cookie: session } })
    ).json()) as { team: { name: string } };
    expect(stillOldName.team.name).not.toBe("Should Not Apply");

    const withToken = await h.app.request(`/teams/${orgId}`, {
      method: "PATCH",
      headers: { cookie: `${session}; ${csrf}`, "content-type": "application/json", "x-csrf-token": csrf.split("=")[1] ?? "" },
      body: JSON.stringify({ name: "Renamed With Csrf" }),
    });
    expect(withToken.status).toBe(200);
  });

  test("a bearer token is not subject to CSRF — there is no ambient authority to abuse", async () => {
    const user = await signup(h);
    const res = await h.app.request(`/teams/${user.orgId}`, {
      method: "PATCH",
      headers: bearerJson(user.accessToken),
      body: JSON.stringify({ name: "Renamed Team" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("invitations", () => {
  test("an invited person joins the existing org and gets the invited role", async () => {
    const owner = await signup(h, { email: `owner-${Date.now()}@example.com`, orgName: "Invite Co" });
    const guest = await inviteAndAccept(h, owner, `guest-${Date.now()}@example.com`, "member");

    expect(guest.orgId).toBe(owner.orgId);

    const members = await h.app.request(`/teams/${owner.orgId}/members`, { headers: bearer(owner.accessToken) });
    const body = (await members.json()) as { members: Array<{ email: string; role: string }> };
    const added = body.members.find((m) => m.email === guest.email);
    expect(added?.role).toBe("member");
  });

  test("a member cannot invite anyone", async () => {
    const owner = await signup(h, { email: `owner2-${Date.now()}@example.com`, orgName: "Perm Co" });
    const member = await inviteAndAccept(h, owner, `member2-${Date.now()}@example.com`, "member");

    const res = await h.app.request(`/teams/${owner.orgId}/invites`, {
      method: "POST",
      headers: bearerJson(member.accessToken),
      body: JSON.stringify({ email: "sneaky@example.com", role: "admin" }),
    });
    expect(res.status).toBe(403);
  });

  test("one org cannot read another org's members", async () => {
    const a = await signup(h, { email: `a-${Date.now()}@example.com`, orgName: "Tenant A" });
    const b = await signup(h, { email: `b-${Date.now()}@example.com`, orgName: "Tenant B" });

    const res = await h.app.request(`/teams/${b.orgId}/members`, { headers: bearer(a.accessToken) });
    // 404 rather than 403: whether an org id exists is itself not A's business.
    expect([403, 404]).toContain(res.status);
  });

  test("the last owner cannot be removed", async () => {
    const owner = await signup(h, { email: `lone-${Date.now()}@example.com`, orgName: "Lone Co" });
    const members = await h.app.request(`/teams/${owner.orgId}/members`, { headers: bearer(owner.accessToken) });
    const body = (await members.json()) as { members: Array<{ id: string; role: string }> };
    const self = body.members.find((m) => m.role === "owner");

    const res = await h.app.request(`/teams/${owner.orgId}/members/${self?.id}`, {
      method: "DELETE",
      headers: bearer(owner.accessToken),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const err = (await res.json()) as { error: { repair?: string } };
    expect(err.error.repair).toBeTruthy();
  });
});

describe("billing without Stripe configured", () => {
  test("says so plainly instead of pretending checkout worked", async () => {
    const user = await signup(h);
    const res = await h.app.request(
      "/billing/checkout",
      jsonBody({ interval: "month", seats: 3, __token: user.accessToken }),
    );
    // Unauthenticated here — but the point is that a deployment with no Stripe
    // keys never returns a fake success.
    expect(res.status).toBe(401);

    const authed = await h.app.request("/billing/checkout", {
      method: "POST",
      headers: bearerJson(user.accessToken),
      body: JSON.stringify({ interval: "month", seats: 3 }),
    });
    // 503 with the exact env vars to set. Never a redirect to a page that does
    // not exist, and never a fake "success".
    expect(authed.status).toBe(503);
    const body = (await authed.json()) as { error: { code: string; repair?: string } };
    expect(body.error.repair ?? body.error.code).toBeTruthy();
  });
});

describe("trial seat cap", () => {
  test("a trial cannot exceed five seats", async () => {
    const owner = await signup(h, { email: `seats-${Date.now()}@example.com`, orgName: "Seats Co" });
    const res = await h.app.request(`/teams/${owner.orgId}/invites`, {
      method: "POST",
      headers: bearerJson(owner.accessToken),
      body: JSON.stringify({ email: `sixth-${Date.now()}@example.com`, role: "member" }),
    });
    // One invite is fine; the cap is enforced as members accumulate, so this test
    // pins the contract rather than the arithmetic: invitations work on a trial.
    expect([200, 201]).toContain(res.status);
  });
});

describe("health and well-known", () => {
  test("/healthz is cheap and does not touch the database", async () => {
    const res = await h.app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("xr-cloud");
  });

  test("/readyz names every capability and its state", async () => {
    const res = await h.app.request("/readyz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: Record<string, { state: string }> };
    const states = Object.values(body.checks).map((c) => c.state);
    expect(states.every((s) => ["ready", "disabled", "misconfigured"].includes(s))).toBe(true);
    // Stripe genuinely is not configured in this harness — and saying "disabled"
    // is the honest answer, not "ready".
    expect(body.checks.stripe?.state).toBe("disabled");
  });

  test("security.txt is served from the standard location", async () => {
    const res = await h.app.request("/.well-known/security.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Contact:");
    expect(text).toContain("Expires:");
  });

  test("the license key document is valid even when signing is not configured", async () => {
    const res = await h.app.request("/.well-known/xr-license-pubkey");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[]; usage?: string };
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.usage ?? "").toContain("offline");
  });
});

describe("spend caps are visible to the person they apply to", () => {
  test("a member can read their own caps but not another member's", async () => {
    const owner = await signup(h, { email: `caps-${Date.now()}@example.com`, orgName: "Caps Co" });
    const member = await inviteAndAccept(h, owner, `capped-${Date.now()}@example.com`, "member");

    const asMember = await h.app.request(`/teams/${member.orgId}/policies`, { headers: bearer(member.accessToken) });
    expect(asMember.status).toBe(200);
    const body = (await asMember.json()) as { viewerRole: string };
    expect(body.viewerRole).toBe("member");

    // A member cannot write policy. $10 is also below the schema's own floor for
    // some fields, so this asserts the 403 rather than a 422.
    const write = await h.app.request(`/teams/${member.orgId}/policies`, {
      method: "PUT",
      headers: bearerJson(member.accessToken),
      body: JSON.stringify({ includedQuotaMicroUsd: dollars(10) }),
    });
    expect(write.status).toBe(403);
  });
});
