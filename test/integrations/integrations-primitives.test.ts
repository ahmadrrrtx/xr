/**
 * Phase 22 · Integrations — OAuth and URL primitives (no network, no keychain).
 *
 * Covers the PKCE pair, the single-use pending-state store with expiry, the GitHub
 * authorize URL, and the instance-URL rules for API-key connectors.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";

import { PendingOAuthStore, createPkcePair, OAUTH_STATE_TTL_MS } from "../../src/integrations/oauth-state.ts";
import { buildGithubAuthorizeUrl, OAUTH_REDIRECT_URI, ProviderError } from "../../src/integrations/providers/github.ts";
import { validateInstanceUrl } from "../../src/integrations/providers/api-key.ts";

describe("PKCE (RFC 7636, S256)", () => {
  test("the challenge is the base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  test("the verifier is 43 URL-safe characters and is never reused", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("PendingOAuthStore", () => {
  test("a state can be taken once, and a second take returns null", () => {
    let now = 1_000;
    const store = new PendingOAuthStore(OAUTH_STATE_TTL_MS, () => now);
    const state = store.begin("github", "verifier-1");
    expect(store.take(state)).toEqual({ connectorId: "github", verifier: "verifier-1" });
    expect(store.take(state)).toBeNull();
  });

  test("an unknown state returns null", () => {
    const store = new PendingOAuthStore();
    expect(store.take("never-issued")).toBeNull();
  });

  test("a state older than the TTL is refused, even if it was never taken", () => {
    let now = 1_000;
    const store = new PendingOAuthStore(1_000, () => now);
    const state = store.begin("github", "v");
    now += 1_001;
    expect(store.take(state)).toBeNull();
  });

  test("a state inside the TTL still works", () => {
    let now = 1_000;
    const store = new PendingOAuthStore(1_000, () => now);
    const state = store.begin("github", "v");
    now += 999;
    expect(store.take(state)).not.toBeNull();
  });

  test("expired entries are swept on the next begin, so the map cannot grow forever", () => {
    let now = 0;
    const store = new PendingOAuthStore(100, () => now);
    store.begin("github", "a");
    store.begin("github", "b");
    expect(store.size).toBe(2);
    now = 500;
    store.begin("github", "c");
    expect(store.size).toBe(1);
  });

  test("states are unguessable: distinct and long", () => {
    const store = new PendingOAuthStore();
    const states = new Set(Array.from({ length: 50 }, () => store.begin("github", "v")));
    expect(states.size).toBe(50);
    for (const s of states) expect(s.length).toBeGreaterThanOrEqual(40);
  });
});

describe("GitHub authorize URL", () => {
  test("carries client, redirect, PKCE S256, state, and the requested scopes", () => {
    const url = new URL(buildGithubAuthorizeUrl({ clientId: "Iv1.test" }, "state-xyz", "challenge-abc"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.test");
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("repo");
    expect(scopes).toContain("read:org");
  });

  test("the redirect is the custom xr:// scheme, never an http page", () => {
    expect(OAUTH_REDIRECT_URI).toBe("xr://oauth/callback");
  });
});

describe("instance URL rules (API-key connectors)", () => {
  test("https is accepted; query and hash are stripped", () => {
    const url = validateInstanceUrl("https://coolify.example.com/?x=1#frag");
    expect(url.toString()).toBe("https://coolify.example.com/");
  });

  test("http is accepted only for loopback hosts", () => {
    expect(validateInstanceUrl("http://localhost:8000").hostname).toBe("localhost");
    expect(() => validateInstanceUrl("http://coolify.example.com")).toThrow(ProviderError);
  });

  test("credentials in the URL are refused, so a key never sits in a URL", () => {
    expect(() => validateInstanceUrl("https://user:pass@coolify.example.com")).toThrow(ProviderError);
  });

  test("a non-URL is refused with a plain message", () => {
    try {
      validateInstanceUrl("not a url");
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("invalid_url");
    }
  });
});
