/**
 * XR Phase 10 — research URL guard tests (offline, deterministic).
 *
 * The guard composes the centralized private-ip tables + normalizeHost, so
 * these tests prove the SSRF boundary without any network: DNS is injected.
 */

import { test, expect } from "bun:test";
import {
  assertResearchSafeUrl,
  assertResearchUrlShallow,
  canonicalizeUrl,
  dedupeCanonical,
  filterSourcesByDomainPolicy,
  hostMatchesDomain,
  hostnameOf,
  normalizeDomain,
} from "../../src/research/url-guard.ts";

const resolver = async (host: string) => (host === "blocked.example" ? ["10.0.0.5"] : ["93.184.216.34"]);

test("blocks private IP literals (all RFC ranges + metadata)", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
    const check = await assertResearchSafeUrl(`http://${ip}/`, { allowedDomains: [], blockedDomains: [], resolve: resolver });
    expect(check.ok, ip).toBe(false);
  }
});

test("blocks IPv6 private/link-local/loopback literals", async () => {
  for (const ip of ["::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1"]) {
    const check = await assertResearchSafeUrl(`http://[${ip}]/`, { allowedDomains: [], blockedDomains: [], resolve: resolver });
    expect(check.ok, ip).toBe(false);
  }
});

test("blocks hostnames that resolve to private IPs (DNS-rebinding guard)", async () => {
  const check = await assertResearchSafeUrl("http://blocked.example/", { allowedDomains: [], blockedDomains: [], resolve: resolver });
  expect(check.ok).toBe(false);
  expect(check.reason).toContain("10.0.0.5");
});

test("allows public hosts and canonicalizes the URL", async () => {
  const check = await assertResearchSafeUrl("https://example.com/page#sec?utm_source=x", { allowedDomains: [], blockedDomains: [], resolve: resolver });
  expect(check.ok).toBe(true);
  expect(check.canonical).not.toContain("utm_source");
  expect(check.canonical).not.toContain("#sec");
});

test("rejects non-http(s) schemes and embedded credentials", async () => {
  expect((await assertResearchSafeUrl("ftp://example.com/", { allowedDomains: [], blockedDomains: [], resolve: resolver })).ok).toBe(false);
  expect((await assertResearchSafeUrl("file:///etc/passwd", { allowedDomains: [], blockedDomains: [], resolve: resolver })).ok).toBe(false);
  expect((await assertResearchSafeUrl("https://user:pass@example.com/", { allowedDomains: [], blockedDomains: [], resolve: resolver })).ok).toBe(false);
});

test("domain matching is suffix-safe (no example.com.evil.com confusion)", () => {
  expect(hostMatchesDomain("example.com.evil.com", "example.com")).toBe(false);
  expect(hostMatchesDomain("evil.com", "example.com")).toBe(false);
  expect(hostMatchesDomain("example.com", "example.com")).toBe(true);
  expect(hostMatchesDomain("sub.example.com", "example.com")).toBe(true);
});

test("unicode/punycode domains normalize for comparison", () => {
  expect(normalizeDomain("bücher.example")).toBe("xn--bcher-kva.example");
  expect(hostMatchesDomain("xn--bcher-kva.example", "bücher.example")).toBe(true);
});

test("canonical dedupe collapses fragments + tracking params only", () => {
  const urls = [
    "https://example.com/page",
    "https://example.com/page/",
    "https://example.com/page#section",
    "https://example.com/page?utm_source=x",
    "https://example.com/page?id=42",
  ];
  const deduped = dedupeCanonical(urls);
  // id=42 is a meaningful param — preserved. Everything else collapses.
  expect(deduped.length).toBe(2);
});

test("filterSourcesByDomainPolicy enforces allow/block/same-domain", () => {
  const sources = [
    { url: "https://docs.example.com/a", domain: "docs.example.com" },
    { url: "https://example.com/b", domain: "example.com" },
    { url: "https://evil.com/c", domain: "evil.com" },
    { url: "https://other.net/d", domain: "other.net" },
  ];
  const res = filterSourcesByDomainPolicy(
    sources,
    { allowedDomains: ["example.com"], blockedDomains: ["evil.com"], sameDomainOnly: false, includeSubdomains: true },
  );
  expect(res.kept.map((s) => s.domain)).toEqual(["docs.example.com", "example.com"]);
  expect(res.dropped.map((s) => s.domain)).toEqual(["evil.com", "other.net"]);

  const same = filterSourcesByDomainPolicy(
    sources,
    { allowedDomains: [], blockedDomains: [], sameDomainOnly: true, includeSubdomains: false },
    "example.com",
  );
  expect(same.kept.map((s) => s.domain)).toEqual(["example.com"]);
});

test("shallow validation blocks private IP literals without DNS", () => {
  expect(assertResearchUrlShallow("http://127.0.0.1/").ok).toBe(false);
  expect(assertResearchUrlShallow("http://169.254.169.254/latest/meta-data").ok).toBe(false);
  expect(assertResearchUrlShallow("https://example.com/").ok).toBe(true);
  expect(hostnameOf("HTTPS://Example.COM/path")).toBe("example.com");
});

test("canonicalizeUrl lowercases the host", () => {
  expect(canonicalizeUrl("https://WWW.Example.COM/Path")).toBe("https://www.example.com/Path");
});
