/** XR 5.1 — Browser URL/session policy tests (§7.3, adversarial §10). */
import { describe, test, expect, afterEach } from "bun:test";
import {
  validateBrowserUrl,
  isPrivateNetworkHost,
} from "../../src/control/browser.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SESSION_POLICY = {
  blockPrivateNetworks: true,
  allowedDomains: [] as string[],
  blockedDomains: ["ads.example", "tracker.net"] as string[],
};

afterEach(() => {
  delete process.env.XR_BROWSER_BLOCK_PRIVATE_IPS;
  delete process.env.XR_BROWSER_BLOCK_LOCALHOST;
});

describe("private-network blocking", () => {
  test("localhost, loopback, RFC1918, link-local are all detected", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "127.5.5.5",
      "10.0.0.8",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.0.1",
      "::1",
      "printer.local",
      "nas.internal",
      "router.localhost",
    ]) {
      expect(isPrivateNetworkHost(h)).toBe(true);
    }
  });

  test("public hosts are not flagged", () => {
    for (const h of ["example.com", "github.com", "172.15.0.1", "172.32.0.1", "10x.example.com"]) {
      expect(isPrivateNetworkHost(h)).toBe(false);
    }
  });

  test("governed sessions (policy on) refuse private-network navigation", () => {
    expect(() => validateBrowserUrl("http://localhost:8080/admin", SESSION_POLICY)).toThrow(/private\/localhost blocked/);
    expect(() => validateBrowserUrl("http://192.168.1.1/router", SESSION_POLICY)).toThrow(/blocked/);
    expect(() => validateBrowserUrl("https://10.0.0.1/internal", SESSION_POLICY)).toThrow(/blocked/);
  });

  test("legacy env-flag behavior still works when no session policy is given", () => {
    process.env.XR_BROWSER_BLOCK_PRIVATE_IPS = "1";
    expect(() => validateBrowserUrl("http://127.0.0.1:3000")).toThrow(/blocked/);
    delete process.env.XR_BROWSER_BLOCK_PRIVATE_IPS;
    expect(validateBrowserUrl("http://127.0.0.1:3000").hostname).toBe("127.0.0.1");
  });
});

describe("domain policy", () => {
  test("blocked domains match subdomains too", () => {
    expect(() => validateBrowserUrl("https://ads.example/x", SESSION_POLICY)).toThrow(/blocked by session domain policy/);
    expect(() => validateBrowserUrl("https://cdn.ads.example/x", SESSION_POLICY)).toThrow(/blocked by session domain policy/);
    expect(validateBrowserUrl("https://example.com", SESSION_POLICY).hostname).toBe("example.com");
  });

  test("non-empty allowedDomains acts as a strict allowlist", () => {
    const allow = { ...SESSION_POLICY, allowedDomains: ["github.com"] };
    expect(validateBrowserUrl("https://github.com/ahmadrrrtx/xr", allow).hostname).toBe("github.com");
    expect(validateBrowserUrl("https://api.github.com", allow).hostname).toBe("api.github.com");
    expect(() => validateBrowserUrl("https://gitlab.com", allow)).toThrow(/not in session allowed-domain list/);
    // allowlist cannot be widened by lookalike suffixes
    expect(() => validateBrowserUrl("https://github.com.evil.test", allow)).toThrow();
  });
});

describe("protocol safety (unchanged from 5.0)", () => {
  test("only http/https are navigable", () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<script>1</script>", "chrome://settings"]) {
      expect(() => validateBrowserUrl(u, SESSION_POLICY)).toThrow(/protocol/);
    }
  });
});

describe("governed session structure (source-level, no browser launch)", () => {
  const SRC = readFileSync(join(import.meta.dir, "../../src/control/browser.ts"), "utf8");

  test("session contexts are isolated and never share storage state", () => {
    expect(SRC).toContain("openBrowserSession");
    expect(SRC).not.toContain("storageState");
  });

  test("redirect escape is checked after navigation and reverted", () => {
    expect(SRC).toContain("redirect escaped session policy");
    expect(SRC).toContain("about:blank");
  });

  test("downloads are capped and oversized files deleted, not silently kept", () => {
    expect(SRC).toContain("maxDownloadBytes");
    expect(SRC).toContain("oversized");
  });

  test("crash listeners mark the session so later actions fail closed", () => {
    expect(SRC).toContain('page.on("crash"');
    expect(SRC).toContain("browser session crashed");
  });

  test("network policy is enforced at the routing layer for sub-resources", () => {
    expect(SRC).toContain('context.route("**/*"');
    expect(SRC).toContain("route.abort()");
  });

  test("credential boundaries: no credential injection APIs in the session layer", () => {
    const sessionSection = SRC.slice(SRC.indexOf("Governed isolated browser sessions"));
    expect(sessionSection).not.toContain("addCookies");
    expect(sessionSection).not.toContain("httpCredentials");
    expect(sessionSection).not.toContain("storageState");
  });
});
