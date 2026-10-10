/**
 * Phase 22 · Integrations — service-level tests (no network, no keychain).
 *
 * Runs the real CredentialVault (AES-GCM v2 envelope), the real ConnectorRegistry,
 * the real ConnectionStore and PKCE, against an in-memory SQLite database. Provider
 * HTTP is replaced by a fetch mock. The master key is a fixed test key, so the
 * keychain is not touched.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { CredentialVault } from "../../src/integrations/credentials.ts";
import { ConnectionStore } from "../../src/integrations/connector-store.ts";
import { ConnectorRegistry } from "../../src/integrations/registry.ts";
import { IntegrationError, IntegrationService, REFRESH_SKEW_MS } from "../../src/integrations/service.ts";
import { PendingOAuthStore, createPkcePair } from "../../src/integrations/oauth-state.ts";
import { buildGithubAuthorizeUrl, OAUTH_REDIRECT_URI } from "../../src/integrations/providers/github.ts";
import { validateInstanceUrl } from "../../src/integrations/providers/api-key.ts";
import { ensureIntegrationSchema, integrationCredentialsDb } from "../../src/integrations/vault-adapter.ts";

const WS = "ws-test";
const TEST_MASTER_KEY = "test-master-key-0123456789abcdef";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function harness(handlers: Partial<Record<"token" | "user" | "revoke" | "coolify", Handler>> = {}, opts: { now?: () => number; env?: Record<string, string> } = {}) {
  const db = new Database(":memory:");
  ensureIntegrationSchema(db as never);
  const scoped = integrationCredentialsDb(db as never);
  const vault = new CredentialVault(scoped, TEST_MASTER_KEY);
  const connections = new ConnectionStore(db as never);
  const audits: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return handlers.token ? handlers.token(url, init) : json({ error: "bad_verification_code" });
    }
    if (url === "https://api.github.com/user") {
      return handlers.user ? handlers.user(url, init) : json({ id: 42, login: "alex", name: "Alex" });
    }
    if (url.includes("/applications/") && url.endsWith("/grant")) {
      return handlers.revoke ? handlers.revoke(url, init) : new Response(null, { status: 204 });
    }
    if (url.endsWith("/api/v1/teams/current")) {
      return handlers.coolify ? handlers.coolify(url, init) : json({ name: "Root Team" });
    }
    return new Response("not mocked", { status: 599 });
  }) as typeof fetch;
  let clock = Date.parse("2026-10-09T10:00:00Z");
  const now = opts.now ?? (() => clock);
  const pending = new PendingOAuthStore(10 * 60 * 1000, now);
  const service = new IntegrationService({
    registry: new ConnectorRegistry(),
    vault,
    connections,
    workspaceId: WS,
    pending,
    fetch: fetchImpl,
    now,
    audit: (event, detail) => audits.push({ event, detail }),
    env: opts.env ?? {},
  });
  return {
    db,
    vault,
    connections,
    service,
    audits,
    calls,
    pending,
    advance(ms: number) {
      clock += ms;
    },
  };
}

/** Raw ciphertext rows as they sit on disk. Used to prove no plaintext secret is stored. */
function rawRows(db: Database): string {
  const rows = db.prepare("SELECT credentials FROM integration_credentials").all() as Array<{ credentials: string }>;
  const connectors = db.prepare("SELECT config, account FROM integration_connectors").all() as Array<Record<string, string | null>>;
  return JSON.stringify({ rows, connectors });
}

/** Saves BYOK app credentials and starts a sign-in. The provider mock comes from the harness. */
function connectGithub(h: ReturnType<typeof harness>) {
  h.service.saveAppCredentials("github", { clientId: "Iv1.clientid01", clientSecret: "client_secret_value_1" });
  const { authorizeUrl } = h.service.startOAuth("github");
  const state = new URL(authorizeUrl).searchParams.get("state") as string;
  return { state, authorizeUrl };
}

describe("PKCE and pending sign-ins", () => {
  test("S256 challenge matches the verifier and the verifier is 43 URL-safe chars", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  test("state is single-use and expires after the TTL", () => {
    let t = 1_000_000;
    const store = new PendingOAuthStore(60_000, () => t);
    const state = store.begin("github", "verifier-a");
    expect(store.take(state)).toEqual({ connectorId: "github", verifier: "verifier-a" });
    expect(store.take(state)).toBeNull(); // replay
    const state2 = store.begin("github", "verifier-b");
    t += 60_001;
    expect(store.take(state2)).toBeNull(); // expired
    expect(store.take("never-issued")).toBeNull();
  });

  test("authorize URL carries PKCE S256, the xr:// redirect, state and the refresh scope", () => {
    const url = new URL(buildGithubAuthorizeUrl({ clientId: "Iv1.abc" }, "state-xyz", "challenge-abc"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });
});

describe("registry view", () => {
  test("renders every built-in connector; only GitHub and Coolify are connectable", () => {
    const h = harness();
    const list = h.service.list();
    expect(list.length).toBe(32);
    const available = list.filter((c) => c.support === "available").map((c) => c.id).sort();
    expect(available).toEqual(["coolify", "github"]);
    expect(list.every((c) => c.status === "disconnected")).toBe(true);
  });

  test("GitHub reports BYOK setup needed until app credentials are saved", () => {
    const h = harness();
    expect(h.service.view("github").needsAppCredentials).toBe(true);
    expect(h.service.view("github").hasAppCredentials).toBe(false);
    h.service.saveAppCredentials("github", { clientId: "Iv1.clientid01", clientSecret: "client_secret_value_1" });
    expect(h.service.view("github").hasAppCredentials).toBe(true);
    expect(h.service.view("github").scopeCopy?.willAccess.length).toBeGreaterThan(0);
  });

  test("saveAppCredentials rejects malformed client IDs and whitespace in secrets", () => {
    const h = harness();
    expect(() => h.service.saveAppCredentials("github", { clientId: "x", clientSecret: "long_enough_secret" })).toThrow(IntegrationError);
    expect(() => h.service.saveAppCredentials("github", { clientId: "Iv1.ok123", clientSecret: "has space inside" })).toThrow(IntegrationError);
  });
});

describe("GitHub OAuth end to end (mocked provider)", () => {
  test("connect stores tokens encrypted, marks connected, and keeps secrets out of the database", async () => {
    const h = harness({ token: () => json({ access_token: "gho_ACCESS_SECRET_1", refresh_token: "ghr_REFRESH_SECRET_1", expires_in: 28800, refresh_token_expires_in: 15897600, scope: "repo,read:org" }) });
    const { state } = await connectGithub(h);
    const view = await h.service.completeOAuth({ code: "code-1", state });
    expect(view.status).toBe("connected");
    expect(view.account).toEqual({ login: "alex", name: "Alex" });

    // The exchange request must carry the verifier and the client secret, and never a token.
    const tokenCall = h.calls.find((c) => c.url.startsWith("https://github.com/login/oauth/access_token"));
    const sent = JSON.parse(String(tokenCall?.init?.body));
    expect(sent.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sent.redirect_uri).toBe(OAUTH_REDIRECT_URI);

    // Secrets are not in plaintext anywhere on disk.
    const disk = rawRows(h.db);
    expect(disk).not.toContain("gho_ACCESS_SECRET_1");
    expect(disk).not.toContain("ghr_REFRESH_SECRET_1");
    expect(disk).not.toContain("client_secret_value_1");

    // The vault round-trips them.
    const stored = h.vault.getByConnector("local", "integration:github");
    expect(stored?.credentials.accessToken).toBe("gho_ACCESS_SECRET_1");

    expect(h.audits.some((a) => a.event === "integration.connect")).toBe(true);
    // Audit detail never carries a secret.
    expect(JSON.stringify(h.audits)).not.toContain("gho_ACCESS_SECRET_1");
  });

  test("state is checked: unknown or replayed state is refused, and the code is never sent", async () => {
    const h = harness({ token: () => json({ access_token: "gho_X", scope: "" }) });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    await expect(h.service.completeOAuth({ code: "code-1", state })).rejects.toMatchObject({ code: "state_invalid" });
    await expect(h.service.completeOAuth({ code: "code-2", state: "forged" })).rejects.toMatchObject({ code: "state_invalid" });
    expect(h.calls.filter((c) => c.url.includes("access_token")).length).toBe(1);
  });

  test("a provider denial consumes the state, reports access_denied, and never calls the token endpoint", async () => {
    const h = harness({ token: () => json({ access_token: "gho_X", scope: "" }) });
    const { state } = await connectGithub(h);
    expect(() => h.service.cancelOAuth(state)).toThrow(IntegrationError);
    try {
      h.service.cancelOAuth(state);
    } catch (err) {
      expect((err as IntegrationError).code).toBe("access_denied");
    }
    // The state is gone: a later callback with a real code is refused.
    await expect(h.service.completeOAuth({ code: "code-1", state })).rejects.toMatchObject({ code: "state_invalid" });
    expect(h.calls.filter((c) => c.url.includes("access_token")).length).toBe(0);
    expect(h.service.view("github").status).toBe("disconnected");
  });

  test("a failed token exchange is reported and nothing is persisted", async () => {
    const h = harness({ token: () => json({ error: "bad_verification_code", error_description: "The code passed is incorrect or expired." }) });
    const { state } = await connectGithub(h);
    await expect(h.service.completeOAuth({ code: "stale", state })).rejects.toMatchObject({ code: "exchange_failed" });
    expect(h.service.view("github").status).toBe("disconnected");
    expect(h.vault.getByConnector("local", "integration:github")).toBeNull();
  });

  test("an expired sign-in state is refused even with a valid code", async () => {
    let t = Date.parse("2026-10-09T10:00:00Z");
    const h = harness({ token: () => json({ access_token: "gho_X", scope: "" }) }, { now: () => t });
    const { state } = await connectGithub(h);
    t += 11 * 60 * 1000;
    await expect(h.service.completeOAuth({ code: "code-1", state })).rejects.toMatchObject({ code: "state_invalid" });
  });

  test("access token near expiry is refreshed, and the rotated refresh token is saved before use", async () => {
    let refreshed = false;
    const h = harness({
      token: (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.grant_type === "refresh_token") {
          refreshed = true;
          expect(body.refresh_token).toBe("ghr_REFRESH_SECRET_1");
          return json({ access_token: "gho_ACCESS_SECRET_2", refresh_token: "ghr_REFRESH_SECRET_2", expires_in: 28800, refresh_token_expires_in: 15897600, scope: "repo,read:org" });
        }
        return json({ access_token: "gho_ACCESS_SECRET_1", refresh_token: "ghr_REFRESH_SECRET_1", expires_in: 28800, refresh_token_expires_in: 15897600, scope: "repo,read:org" });
      },
    });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    // Move forward so the token is inside the refresh window.
    h.advance(28800 * 1000 - REFRESH_SKEW_MS + 1000);
    const token = await h.service.getAccessToken("github");
    expect(refreshed).toBe(true);
    expect(token).toBe("gho_ACCESS_SECRET_2");
    expect(h.vault.getByConnector("local", "integration:github")?.credentials.refreshToken).toBe("ghr_REFRESH_SECRET_2");
  });

  test("a rejected refresh marks the connection expired (re-auth) and does not loop", async () => {
    let refreshCalls = 0;
    const h = harness({
      token: (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.grant_type === "refresh_token") {
          refreshCalls += 1;
          return json({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." });
        }
        return json({ access_token: "gho_ACCESS_SECRET_1", refresh_token: "ghr_REFRESH_SECRET_1", expires_in: 28800, scope: "" });
      },
    });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    h.advance(28800 * 1000);
    await expect(h.service.getAccessToken("github")).rejects.toMatchObject({ code: "reauth_required" });
    expect(h.service.view("github").status).toBe("expired");
    expect(refreshCalls).toBe(1);
  });

  test("sync with a revoked token marks the connection expired", async () => {
    let revokedUpstream = false;
    const h = harness({
      token: () => json({ access_token: "gho_ACCESS_SECRET_1", scope: "" }),
      user: () => (revokedUpstream ? json({ message: "Bad credentials" }, 401) : json({ id: 42, login: "alex" })),
    });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    revokedUpstream = true;
    await expect(h.service.sync("github")).rejects.toMatchObject({ code: "unauthorized" });
    expect(h.service.view("github").status).toBe("expired");
  });

  test("disconnect revokes the grant with Basic auth, deletes the token, and keeps the BYOK app", async () => {
    let revokeAuth = "";
    let revokeBody = "";
    const h = harness({
      token: () => json({ access_token: "gho_ACCESS_SECRET_1", scope: "" }),
      revoke: (_url, init) => {
        revokeAuth = String((init?.headers as Record<string, string>).Authorization);
        revokeBody = String(init?.body);
        return new Response(null, { status: 204 });
      },
    });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    const result = await h.service.disconnect("github");
    expect(result.revoked).toBe(true);
    expect(revokeAuth).toBe(`Basic ${Buffer.from("Iv1.clientid01:client_secret_value_1").toString("base64")}`);
    expect(JSON.parse(revokeBody)).toEqual({ access_token: "gho_ACCESS_SECRET_1" });
    expect(h.vault.getByConnector("local", "integration:github")).toBeNull();
    expect(h.service.view("github").status).toBe("disconnected");
    expect(h.service.view("github").hasAppCredentials).toBe(true);
    expect(h.audits.some((a) => a.event === "integration.disconnect")).toBe(true);
  });

  test("disconnect still deletes local secrets when the provider revoke fails", async () => {
    const h = harness({
      token: () => json({ access_token: "gho_ACCESS_SECRET_1", scope: "" }),
      revoke: () => new Response("down", { status: 503 }),
    });
    const { state } = await connectGithub(h);
    await h.service.completeOAuth({ code: "code-1", state });
    const result = await h.service.disconnect("github");
    expect(result.revoked).toBe(false);
    expect(h.vault.getByConnector("local", "integration:github")).toBeNull();
  });

  test("env-provided client credentials work without writing them to the vault", async () => {
    const h = harness({ token: () => json({ access_token: "gho_ENV", scope: "" }) }, { env: { XR_OAUTH_GITHUB_CLIENT_ID: "Iv1.envclient", XR_OAUTH_GITHUB_CLIENT_SECRET: "env_secret_value_9" } });
    const { authorizeUrl } = h.service.startOAuth("github");
    expect(new URL(authorizeUrl).searchParams.get("client_id")).toBe("Iv1.envclient");
    expect(h.vault.getByConnector("local", "integration:github:app")).toBeNull();
  });
});

describe("API-key connector (Coolify)", () => {
  test("wrong key is refused inline and nothing is stored", async () => {
    const h = harness({ coolify: () => json({ message: "Unauthenticated." }, 401) });
    await expect(h.service.connectApiKey("coolify", { url: "https://coolify.example.com", apiKey: "bad-key-value" })).rejects.toMatchObject({ code: "unauthorized" });
    expect(h.service.view("coolify").status).toBe("disconnected");
    expect(h.vault.getByConnector("local", "integration:coolify")).toBeNull();
  });

  test("correct key connects; the URL is non-secret config and the key is vault-only", async () => {
    const h = harness();
    const view = await h.service.connectApiKey("coolify", { url: "https://coolify.example.com/", apiKey: "cool-key-0001" });
    expect(view.status).toBe("connected");
    expect(view.config).toEqual({ url: "https://coolify.example.com" });
    expect(view.account).toEqual({ name: "Root Team" });
    const disk = rawRows(h.db);
    expect(disk).not.toContain("cool-key-0001");
    expect(disk).toContain("https://coolify.example.com"); // non-secret config is allowed on disk
    expect(h.vault.getByConnector("local", "integration:coolify")?.credentials.apiKey).toBe("cool-key-0001");
  });

  test("sync re-probes with the stored key", async () => {
    let authHeader = "";
    const h = harness({ coolify: (_u, init) => { authHeader = String((init?.headers as Record<string, string>).Authorization); return json({ name: "Root Team" }); } });
    await h.service.connectApiKey("coolify", { url: "https://coolify.example.com", apiKey: "cool-key-0001" });
    await h.service.sync("coolify");
    expect(authHeader).toBe("Bearer cool-key-0001");
  });

  test("a non-connectable api-key connector is refused, not faked", async () => {
    const h = harness();
    await expect(h.service.connectApiKey("n8n", { url: "https://n8n.example.com", apiKey: "k" })).rejects.toMatchObject({ code: "coming_soon" });
  });

  test("required fields and URL rules are enforced", async () => {
    const h = harness();
    await expect(h.service.connectApiKey("coolify", { url: "https://coolify.example.com" })).rejects.toMatchObject({ code: "missing_field" });
    await expect(h.service.connectApiKey("coolify", { url: "http://coolify.example.com", apiKey: "k" })).rejects.toMatchObject({ code: "insecure_url" });
  });
});

describe("URL validation", () => {
  test("https is required for remote hosts; http only for loopback; no embedded credentials", () => {
    expect(validateInstanceUrl("https://coolify.example.com").hostname).toBe("coolify.example.com");
    expect(validateInstanceUrl("http://localhost:8000").hostname).toBe("localhost");
    expect(() => validateInstanceUrl("http://coolify.example.com")).toThrow();
    expect(() => validateInstanceUrl("https://user:pass@coolify.example.com")).toThrow();
    expect(() => validateInstanceUrl("not a url")).toThrow();
  });
});

describe("vault integrity", () => {
  test("a tampered ciphertext fails closed instead of returning garbage", async () => {
    const h = harness();
    await h.service.connectApiKey("coolify", { url: "https://coolify.example.com", apiKey: "cool-key-0001" });
    const row = h.db.prepare("SELECT id, credentials FROM integration_credentials").get() as { id: string; credentials: string };
    const parts = row.credentials.split(":");
    parts[parts.length - 1] = Buffer.from("tampered").toString("hex");
    h.db.prepare("UPDATE integration_credentials SET credentials = ? WHERE id = ?").run(parts.join(":"), row.id);
    expect(() => h.vault.retrieve(row.id)).toThrow();
  });

  test("the vault is the integrations table, not biz_credentials", async () => {
    const h = harness();
    await h.service.connectApiKey("coolify", { url: "https://coolify.example.com", apiKey: "cool-key-0001" });
    const tables = (h.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((t) => t.name);
    expect(tables).toContain("integration_credentials");
    expect(tables).not.toContain("biz_credentials");
  });
});

describe("every secret use is audited with a purpose", () => {
  test("exchange, token use and revoke are recorded, and the audit never holds the token", async () => {
    const h = harness({
      token: () => json({ access_token: "gho_AUDIT_TEST_TOKEN", token_type: "bearer", scope: "repo,read:org" }),
    });
    const { state } = connectGithub(h);
    await h.service.completeOAuth({ code: "code-audit", state });
    await h.service.sync("github");
    await h.service.disconnect("github");

    const purposes = h.audits
      .filter((a) => a.event === "integration.credential.read")
      .map((a) => a.detail.purpose);
    expect(purposes).toContain("oauth_exchange");
    expect(purposes).toContain("token_use");
    expect(purposes).toContain("revoke");
    expect(JSON.stringify(h.audits)).not.toContain("gho_AUDIT_TEST_TOKEN");
    expect(JSON.stringify(h.audits)).not.toContain("client_secret_value_1");
  });
});

