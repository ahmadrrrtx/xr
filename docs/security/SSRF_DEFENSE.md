# XR — SSRF / Private-IP / Metadata Defense

**Files:** `src/security/private-ip.ts`, `src/security/egress-proxy.ts`. Already present
and mature at HEAD; Phase 07 **verified + added tests** rather than rebuilt.

## Architecture (correct, per NCC/Craft/Cloudflare guidance)
`guardedFetch` (egress proxy) enforces, per request:
1. **Parse** URL; reject non-`http(s)` schemes (`file://`, `gopher://`, `dict://`, …).
2. **Resolve ALL** A/AAAA records via an injectable resolver (tests use a fake).
3. **Refuse if ANY resolved address** is in a blocked range (fail-closed DNS-rebinding
   defense — a domain that resolves to `127.0.0.1` or `169.254.169.254` is refused).
4. **Pin** the resolved address; the connection is made to the **pinned IP** (Host
   header = original hostname), so no second resolution occurs.
5. **Revalidate every redirect** (max 3 hops) through steps 1–4; a redirect into a
   blocked range is refused.
6. Byte caps + timeout. Fail-closed: any parse/resolve/validate failure → deny.

## Blocked ranges (`isBlockedAddress` / `isPrivateIpv4` / `isPrivateIpv6`)
- Loopback `127.0.0.0/8`, `::1`
- RFC1918 `10/8`, `172.16/12`, `192.168/16`
- Link-local `169.254.0.0/16` **(incl. `169.254.169.254` cloud metadata)**
- IPv6 link-local `fe80::/10`, ULA `fc00::/7`
- CGNAT `100.64.0.0/10`
- Unspecified `0.0.0.0`, `::`; multicast `224/4`, `ff00::/8`; reserved `240/4`
- **IPv4-mapped IPv6** `::ffff:0:0/96` unwrapped to the embedded IPv4 (defeats the
  `[::ffff:169.254.169.254]` bypass class, CVE-2026-35409 Directus)

## What XR does NOT guarantee (honest)
- **Application-layer only.** XR does not kernel-block egress. A process that reaches
  the host network namespace can still contact internal addresses; pair with OS-level
  egress filtering where required.
- **IMDSv2 is an infrastructure control.** Blocking `169.254.169.254` stops the easy
  path; enforcing IMDSv2 (AWS) / metadata headers (Azure/GCP) at the cloud layer is
  recommended for full safety.
- The proxy trusts the **injectable resolver** in tests; in production it uses the real
  `dns.lookup`. A compromised resolver could lie, but the pin+validate still binds the
  connection to the validated address.

## Tests
- `test/security/egress-proxy.test.ts` (existing) — uses an **injectable resolver** so
  tests never reach real metadata services. Phase 07 added/extended coverage for:
  metadata IP, private ranges, IPv4-mapped IPv6, redirect-to-private, DNS resolving
  public→private (rebinding), multiple A/AAAA records (any-blocked refusal).
- No test depends on actually reaching `169.254.169.254`.

## Residual risk
Low at the application layer. The only realistic bypass is a malicious/compromised DNS
resolver returning consistent lies (mitigated by pinning) or a kernel-level egress path
XR does not control. For kernel-grade egress enforcement, see SECURITY_RESEARCH_PHASE_07.md.
