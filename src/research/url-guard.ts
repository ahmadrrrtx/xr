/**
 * XR Phase 10 — research target URL guard.
 *
 * Validates URLs that research is about to hand to a provider (Firecrawl
 * scrape/crawl/map/extract, direct fetch) WITHOUT trusting the provider.
 * Firecrawl being a trusted vendor does NOT make an arbitrary URL safe.
 *
 * This is NOT a second SSRF implementation. It composes the centralized
 * primitives — `normalizeHost` (src/security/guard.ts) and `isBlockedAddress`
 * / `blockedRangeLabel` (src/security/private-ip.ts) — plus the same
 * all-addresses DNS resolution the egress proxy uses (`defaultResolve` from
 * src/security/egress-proxy.ts). The actual connection-time boundary for any
 * XR-originated HTTP call remains `guardedFetch` / `checkEgressTarget`.
 *
 * Pure decision + optional DNS: no network I/O of its own beyond resolution.
 */

import { normalizeHost } from "../security/guard.ts";
import { isBlockedAddress, blockedRangeLabel } from "../security/private-ip.ts";
import { defaultResolve } from "../security/egress-proxy.ts";

export interface ResearchUrlPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  sameDomainOnly?: boolean;
  includeSubdomains?: boolean;
  /** Injectable resolver for tests; defaults to the egress proxy's resolver. */
  resolve?: (host: string) => Promise<string[]>;
  /** Optional additional port blocklist (numeric ports). */
  blockedPorts?: number[];
}

export interface ResearchUrlCheck {
  ok: boolean;
  reason?: string;
  /** Canonical host (punycoded, lowercased). */
  host?: string;
  /** Canonicalized URL string (hash + tracking params removed). */
  canonical?: string;
}

/** Parse a URL to its lowercased, punycoded hostname ('' on failure). */
export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Normalize a domain for comparison: punycode + lowercase + strip a trailing
 * dot. `example.com` and `EXAMPLE.COM.` and unicode equivalents collapse.
 */
export function normalizeDomain(d: string): string {
  const s = (d ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return "";
  try {
    return new URL(`http://${s}`).hostname; // punycodes unicode labels
  } catch {
    return s;
  }
}

/**
 * Suffix-safe domain match: `host === domain` or `host` ends in `.domain`.
 * Prevents `example.com.evil.com` style confusion — `evil.com` does not match
 * `example.com` because the host does not END in `.example.com`.
 */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = normalizeDomain(host);
  const d = normalizeDomain(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

/** Is `host` covered by `allowedDomains` under the subdomain rule? */
export function hostAllowedByPolicy(
  host: string,
  allowedDomains: string[],
  includeSubdomains: boolean,
): boolean {
  if (!allowedDomains.length) return true; // empty list = no domain restriction
  const h = normalizeDomain(host);
  if (!h) return false;
  return allowedDomains.some((d) => {
    const nd = normalizeDomain(d);
    if (!nd) return false;
    if (h === nd) return true;
    return includeSubdomains && h.endsWith(`.${nd}`);
  });
}

/** Is `host` explicitly blocked? (exact or, always, any subdomain) */
export function hostBlockedByPolicy(host: string, blockedDomains: string[]): boolean {
  if (!blockedDomains.length) return false;
  return blockedDomains.some((d) => hostMatchesDomain(host, d));
}

/** Remove fragment + tracking query params; keep meaningful query params. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase();
    // `/page` and `/page/` are the same source (keep root `/`).
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw;
  }
}

/** Filter sources by domain policy (allowed/blocked/same-domain). */
export function filterSourcesByDomainPolicy<T extends { url: string; domain?: string }>(
  sources: T[],
  limits: { allowedDomains: string[]; blockedDomains: string[]; sameDomainOnly: boolean; includeSubdomains: boolean },
  rootDomain?: string,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const key = canonicalizeUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = s.domain ?? hostnameOf(s.url);
    if (hostBlockedByPolicy(host, limits.blockedDomains)) {
      dropped.push(s);
      continue;
    }
    if (!hostAllowedByPolicy(host, limits.allowedDomains, limits.includeSubdomains)) {
      dropped.push(s);
      continue;
    }
    if (limits.sameDomainOnly && rootDomain) {
      const ok = limits.includeSubdomains ? hostMatchesDomain(host, rootDomain) : normalizeDomain(host) === normalizeDomain(rootDomain);
      if (!ok) {
        dropped.push(s);
        continue;
      }
    }
    kept.push(s);
  }
  return { kept, dropped };
}

/** Canonical dedupe: same page with different fragments/tracking params = one URL. */
export function dedupeCanonical(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const key = canonicalizeUrl(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * Shallow validation for URLs that are only SURFACED as data (e.g. search
 * results), not fetched. Parses, checks scheme/credentials, canonicalizes the
 * host, and blocks literal private/link-local/metadata addresses. No DNS —
 * the full `assertResearchSafeUrl` (with all-addresses resolution) runs before
 * any actual fetch, which is the connection-time boundary that matters.
 */
export function assertResearchUrlShallow(rawUrl: string): ResearchUrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { ok: false, reason: `only http/https permitted, got ${scheme}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in URL are not permitted" };
  }
  const normalized = normalizeHost(url.hostname);
  if (!normalized) {
    return { ok: false, reason: `host "${url.hostname}" could not be canonicalized` };
  }
  const host = normalized.host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized.isIpLiteral && isBlockedAddress(host)) {
    return { ok: false, reason: `destination ${host} is in a blocked range (${blockedRangeLabel(host)})` };
  }
  return { ok: true, host, canonical: canonicalizeUrl(url.toString()) };
}

/**
 * Validate a research TARGET url before it is handed to a provider.
 *  1. http/https only, no embedded credentials
 *  2. host canonicalization (collapses hex/octal/int/IPv6 literal tricks)
 *  3. private/link-local/metadata/IPv6-ULA blocking (reuses private-ip.ts)
 *  4. all-resolved-addresses check (DNS-rebinding guard, like the egress proxy)
 *  5. optional domain allow/block/same-domain policy + port restrictions
 */
export async function assertResearchSafeUrl(
  rawUrl: string,
  policy: ResearchUrlPolicy,
  opts: { sameDomainRoot?: string } = {},
): Promise<ResearchUrlCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { ok: false, reason: `only http/https permitted, got ${scheme}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in URL are not permitted" };
  }

  const normalized = normalizeHost(url.hostname);
  if (!normalized) {
    return { ok: false, reason: `host "${url.hostname}" could not be canonicalized` };
  }
  const host = normalized.host.replace(/^\[|\]$/g, "").toLowerCase();

  // Port restrictions (optional policy; numeric range always enforced).
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, reason: `invalid port ${url.port}` };
    }
    if ((policy.blockedPorts ?? []).includes(port)) {
      return { ok: false, reason: `port ${port} is blocked by research policy` };
    }
  }

  // Domain policy (before any DNS work — cheap, deterministic).
  if (hostBlockedByPolicy(host, policy.blockedDomains)) {
    return { ok: false, reason: `domain ${host} is blocked by research policy` };
  }
  if (!hostAllowedByPolicy(host, policy.allowedDomains, policy.includeSubdomains ?? true)) {
    return { ok: false, reason: `domain ${host} is outside the allowed research domains` };
  }
  if (policy.sameDomainOnly && opts.sameDomainRoot) {
    if (!hostMatchesDomain(host, opts.sameDomainRoot)) {
      return { ok: false, reason: `domain ${host} is outside the crawl root ${opts.sameDomainRoot}` };
    }
  }

  // IP literal / blocked-range check.
  if (normalized.isIpLiteral) {
    if (isBlockedAddress(host)) {
      return { ok: false, reason: `destination ${host} is in a blocked range (${blockedRangeLabel(host)})` };
    }
    return { ok: true, host, canonical: canonicalizeUrl(url.toString()) };
  }

  // Domain: resolve ALL addresses; if ANY is blocked → refuse (fail-closed,
  // same policy as checkEgressTarget — DNS-rebinding guard).
  const resolve = policy.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${host}` };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: `DNS resolution returned no addresses for ${host}` };
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      return { ok: false, reason: `host ${host} resolves to ${addr} (${blockedRangeLabel(addr)}) — refused` };
    }
  }
  return { ok: true, host, canonical: canonicalizeUrl(url.toString()) };
}
