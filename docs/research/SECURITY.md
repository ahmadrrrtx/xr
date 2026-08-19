# Research — Security

## Boundary chain

```
capability request → policy → approval → budget → egress → provider → website
```

## SSRF (one implementation, reused)

- **XR-originated requests** (SearXNG query, Firecrawl API call, direct fetch):
  `guardedFetch` / `checkEgressTarget` (`src/security/egress-proxy.ts`) blocks
  private/link-local/metadata ranges at connection time, pins the resolved
  address, and revalidates every redirect.
- **Provider target URLs** (what XR asks Firecrawl to touch): validated first
  by `assertResearchSafeUrl` (`src/research/url-guard.ts`), which composes the
  centralized `normalizeHost` + `isBlockedAddress` (`src/security/private-ip.ts`)
  + all-addresses DNS resolution.
- Blocked: `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
  (incl. `169.254.169.254` metadata), `100.64/10` CGNAT, `0/8`, multicast,
  reserved, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped.
- Redirect-to-private-IP is refused at every hop (direct fetch follows
  redirects manually, revalidating each hop).
- The Phase-10 work **removed** a duplicate SSRF check that had lived in
  `src/research/search.ts`; direct fetch now delegates to the single
  public-fetch path.

## Web content = untrusted data

Every search snippet, scraped page, crawl result, and extracted field is
scanned (`scanUntrusted`) and framed (`frameToolOutput`) before it can reach
model context. The scanner is defense-in-depth framing — it does not make
content safe and does not silently drop it. See `src/research/content-guard.ts`
and `test/research/security.test.ts`.

## Secrets

The Firecrawl key is resolved inside `src/research/factory.ts` via the existing
secret system and is never serialized into job JSON, never logged (the adapter
uses `redactSecrets` on error bodies), and never included in citations or SSE.

## Domain policy

`allowedDomains` / `blockedDomains` / `sameDomainOnly` / `includeSubdomains`
are enforced on every source set (search results, map links, crawl pages) with
suffix-safe matching — `example.com.evil.com` never matches `example.com`.
Punycode domains are normalized before comparison.

## Retry policy

Retryable: `rate_limit`, `timeout`, `unavailable`, `network_failure`.
Never retried: authentication, invalid request/schema, blocked domain,
SSRF violation, budget exhaustion, permission denied.
