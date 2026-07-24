import { describe, expect, test } from "bun:test";
import { CredentialBroker } from "../../src/trust/credentials.ts";

describe("XR 4.2 credential broker (reference-only, redacting)", () => {
  test("register returns a reference that carries NO raw value", () => {
    const b = new CredentialBroker();
    const ref = b.register("github_token", "ghp_SUPERSECRETTOKENVALUE1234567890abcd", "core_tool:git");
    expect(ref.refId).toStartWith("cred_");
    expect(ref.label).toBe("github_token");
    expect(JSON.stringify(ref)).not.toContain("ghp_SUPERSECRETTOKENVALUE");
  });

  test("scopeFor exposes env var NAMES only, never values (safe to persist)", () => {
    const b = new CredentialBroker();
    const ref = b.register("api_key", "sk-live_ABCDEFGHIJ1234567890", "mcp_tool:x");
    const scope = b.scopeFor([ref], "task_scoped");
    expect(scope.envNames.length).toBe(1);
    expect(scope.envNames[0]).toStartWith("XR_CRED_");
    const serialized = JSON.stringify(scope);
    expect(serialized).not.toContain("sk-live_ABCDEFGHIJ");
  });

  test("prepareInjection yields the raw value transiently for the sandbox env only", () => {
    const b = new CredentialBroker();
    const ref = b.register("token", "VALUE1234567890", "core_tool:shell");
    const inj = b.prepareInjection([ref]);
    expect(Object.values(inj.env)).toContain("VALUE1234567890");
    expect(inj.injected.length).toBe(1);
  });

  test("revoke deletes the raw value (has() false, injection empty)", () => {
    const b = new CredentialBroker();
    const ref = b.register("token", "VALUE1234567890", "core_tool:shell");
    expect(b.has(ref.refId)).toBe(true);
    expect(b.revoke([ref])).toBe(1);
    expect(b.has(ref.refId)).toBe(false);
    expect(Object.keys(b.prepareInjection([ref]).env)).toHaveLength(0);
  });

  test("redact scrubs a registered secret value from arbitrary text", () => {
    const b = new CredentialBroker();
    b.register("token", "MYSECRETVALUE987654321", "x");
    const out = b.redact("the token is MYSECRETVALUE987654321 ok");
    expect(out).not.toContain("MYSECRETVALUE987654321");
    expect(out).toContain("[REDACTED]");
  });

  test("redact scrubs generic secret shapes (AWS key, JWT) even if unregistered", () => {
    const b = new CredentialBroker();
    const out = b.redact("key AKIAIOSFODNN7EXAMPLE and jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123456");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  test("assertClean throws when a registered secret leaks into serialized output", () => {
    const b = new CredentialBroker();
    b.register("token", "LEAKYVALUE1234567890", "x");
    expect(() => b.assertClean({ log: "value=LEAKYVALUE1234567890" })).toThrow();
    expect(() => b.assertClean({ log: "value=[REDACTED]" })).not.toThrow();
  });

  test("expired refs are not injected", () => {
    const b = new CredentialBroker();
    const ref = b.register("token", "VALUE1234567890", "x", "task_scoped", 1);
    // force expiry
    (ref as { expiresAt?: number }).expiresAt = Date.now() - 1;
    expect(Object.keys(b.prepareInjection([ref]).env)).toHaveLength(0);
  });
});
