/**
 * XR Phase 4 · T4 — centralized egress proxy.
 *
 * Every outbound HTTP(S) request from XR (web tools, plugins, MCP HTTP
 * servers via policy) flows through `guardedFetch`. Enforcement happens at
 * CONNECTION time, not on tool arguments:
 *
 *   1. PARSE   — WHATWG URL; only http/https; canonical host normalization
 *                (dotted-quad/hex/octal/int/IPv6 forms collapse first).
 *   2. ALLOW   — host must match the domain allowlist (or an explicit
 *                allowed-host/IP entry, e.g. a local model runtime).
 *   3. RESOLVE — every A/AAAA record is resolved (injectable resolver).
 *   4. BLOCK   — if ANY resolved address is private/link-local/metadata
 *                (RFC1918, 127/8, 169.254.0.0/16 incl. 169.254.169.254, ::1,
 *                fe80::/10, fc00::/7, 100.64/10, IPv4-mapped), the request is
 *                REFUSED. This kills DNS-rebinding and metadata exfil even
 *                for allow-listed domains.
 *   5. PIN     — the connection is made to the pinned resolved address with
 *                Host/SNI set to the hostname (no re-resolution by the
 *                runtime → no TOCTOU window).
 *   6. REDIRECT— manual redirects only, each revalidated through 1–5
 *                (max 3), so a redirect into a blocked range is refused.
 *   7. CAPS    — byte cap on the response body (streamed), wall-clock
 *                timeout via AbortSignal.
 *
 * Fail-closed: any parse/resolve/validation failure denies.
 */
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { normalizeHost } from "./guard.ts";
import { isBlockedAddress, blockedRangeLabel } from "./private-ip.ts";

export interface EgressPolicy {
  /** Domain allowlist (host or host:port). Empty = nothing allowed. */
  readonly allowlist: readonly string[];
  /** Explicitly permitted IP literals / loopback (e.g. local model runtime). */
  readonly allowedHosts?: readonly string[];
  /** Default true: private/link-local/metadata destinations are refused. */
  readonly blockPrivateNetworks?: boolean;
  /** Max redirects followed (each revalidated). Default 3. */
  readonly maxRedirects?: number;
  /** Max response body bytes. Default 4 MiB. */
  readonly maxBytes?: number;
  /** Wall-clock timeout ms. Default 30 s. */
  readonly timeoutMs?: number;
  /** Injectable DNS resolver: host → addresses. Defaults to dns.lookup(all). */
  readonly resolve?: (host: string) => Promise<string[]>;
  /** Optional audit sink (target + decision). */
  readonly audit?: (event: "egress.allowed" | "egress.blocked", detail: Record<string, unknown>) => void;
}

export interface GuardedFetchResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Final URL after redirects (revalidated). */
  finalUrl?: string;
  /** Address the connection was pinned to. */
  pinnedAddress?: string;
  blocked?: boolean;
  reason?: string;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;

/** Hostname → resolved addresses (default resolver: all A/AAAA records). */
export async function defaultResolve(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses.map((a) => a.address));
    });
  });
}

export interface EgressTargetCheck {
  ok: boolean;
  reason?: string;
  /** Canonical host after normalization. */
  host?: string;
  isIpLiteral?: boolean;
  /** Resolved addresses (when resolution succeeded). */
  addresses?: string[];
  /** The single pinned address chosen for the connection. */
  pinned?: string;
}

/**
 * Validate + resolve a target. Pure decision + DNS; used by the proxy and by
 * tests with an injectable resolver.
 */
export async function checkEgressTarget(
  rawUrl: string,
  policy: EgressPolicy,
): Promise<EgressTargetCheck> {
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
  const { host, isIpLiteral } = normalized;
  const allow = policy.allowlist ?? [];
  const allowedHosts = (policy.allowedHosts ?? []).map((h) => h.trim().toLowerCase());

  const withPort = url.port ? `${host}:${url.port}` : host;
  const allowlisted =
    allowedHosts.includes(host) || allowedHosts.includes(withPort) ||
    allow.some((entry) => {
      const domain = entry.trim().toLowerCase();
      if (!domain) return false;
      return host === domain || host.endsWith(`.${domain}`);
    });
  if (!allowlisted) {
    return { ok: false, reason: `host ${host} is not in the egress allowlist` };
  }

  // IP literals: no DNS — validate the address directly against blocked
  // ranges, UNLESS the operator explicitly allow-listed this address (e.g. a
  // local model runtime at 127.0.0.1:11434). Explicit IP allowlisting is the
  // only way through the private-range block, and it is exact (host or
  // host:port), never a CIDR wildcard.
  if (isIpLiteral) {
    const explicitlyAllowed = allowedHosts.includes(host) || allowedHosts.includes(withPort);
    if (explicitlyAllowed) {
      return { ok: true, host, isIpLiteral, addresses: [host], pinned: host };
    }
    if (isBlockedAddress(host)) {
      if (policy.blockPrivateNetworks === false) {
        return { ok: true, host, isIpLiteral, addresses: [host], pinned: host };
      }
      return {
        ok: false,
        reason: `destination ${host} is in a blocked range (${blockedRangeLabel(host)}); explicit IP allowlisting required`,
      };
    }
    return { ok: true, host, isIpLiteral, addresses: [host], pinned: host };
  }

  // Domain: resolve ALL addresses; if ANY is blocked → refuse (fail-closed).
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
  if (policy.blockPrivateNetworks !== false) {
    for (const addr of addresses) {
      if (isBlockedAddress(addr)) {
        return {
          ok: false,
          reason: `host ${host} resolves to ${addr} (${blockedRangeLabel(addr)}) — refused (DNS-rebinding/metadata guard)`,
        };
      }
    }
  }
  // Pin the first address (stable across the connection).
  return { ok: true, host, isIpLiteral, addresses, pinned: addresses[0] };
}

/**
 * Perform a guarded HTTP(S) request with connection pinning, redirect
 * revalidation, byte caps and timeout. Returns a normalized result; never
 * throws for network-level refusals (returns { ok:false, reason }).
 */
export async function guardedFetch(
  rawUrl: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
  policy: EgressPolicy,
): Promise<GuardedFetchResult> {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const audit = policy.audit;

  let currentUrl = rawUrl;
  for (let redirect = 0; ; redirect++) {
    const check = await checkEgressTarget(currentUrl, policy);
    if (!check.ok || !check.pinned) {
      audit?.("egress.blocked", { url: currentUrl, reason: check.reason ?? "no pinned address" });
      return { ok: false, blocked: true, reason: check.reason ?? "target refused" };
    }

    const result = await performPinnedRequest(currentUrl, check.pinned, opts, timeoutMs, maxBytes, audit);
    if (result.connError) {
      audit?.("egress.blocked", { url: currentUrl, reason: result.connError });
      return { ok: false, blocked: true, reason: result.connError };
    }
    // Redirect handling: manual, revalidated through the full gate.
    const location = result.rawHeaders?.location;
    if (result.status && result.status >= 300 && result.status < 400 && location) {
      if (redirect >= maxRedirects) {
        audit?.("egress.blocked", { url: currentUrl, reason: `redirect limit (${maxRedirects}) exceeded` });
        return { ok: false, blocked: true, reason: `redirect limit (${maxRedirects}) exceeded` };
      }
      let next: URL;
      try {
        next = new URL(String(location), currentUrl);
      } catch {
        audit?.("egress.blocked", { url: currentUrl, reason: "unparseable redirect target" });
        return { ok: false, blocked: true, reason: "unparseable redirect target" };
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        audit?.("egress.blocked", { url: currentUrl, reason: `redirect to non-http scheme ${next.protocol}` });
        return { ok: false, blocked: true, reason: `redirect to non-http scheme ${next.protocol}` };
      }
      currentUrl = next.toString();
      continue; // revalidate + refetch
    }

    audit?.("egress.allowed", { url: currentUrl, status: result.status, bytes: result.body.length });
    return {
      ok: result.status !== undefined && result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.statusText,
      body: result.body,
      finalUrl: currentUrl,
      pinnedAddress: check.pinned,
    };
  }
}

interface PinnedOutcome {
  status?: number;
  statusText?: string;
  rawHeaders?: Record<string, string | string[]>;
  body: string;
  connError?: string;
}

/**
 * One pinned request: the socket connects to `pinnedAddress` (the pre-resolved
 * address) while Host/SNI stay the hostname — no re-resolution, so the
 * validated address is the connected address (no TOCTOU/DNS-rebinding).
 */
function performPinnedRequest(
  url: string,
  pinnedAddress: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
  maxBytes: number,
  audit?: EgressPolicy["audit"],
): Promise<PinnedOutcome> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    const port = u.port ? Number(u.port) : isHttps ? 443 : 80;
    const request = isHttps ? httpsRequest : httpRequest;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const req = request(
      {
        hostname: pinnedAddress, // PINNED — validated address
        port,
        path: `${u.pathname}${u.search}`,
        method: opts.method ?? "GET",
        // TLS SNI = the real hostname (never the pinned address).
        servername: isHttps ? u.hostname : undefined,
        headers: {
          ...(opts.headers ?? {}),
          // Host = the real hostname, not the pinned address.
          Host: u.host,
          "user-agent": opts.headers?.["user-agent"] ?? "XR-Agent/4.0",
        },
      },
      (res: IncomingMessage) => {
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) headers[k] = v as string | string[];
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          bytes += chunk.length;
          if (bytes > maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          finished = true;
          if (timer) clearTimeout(timer);
          const body = Buffer.concat(chunks).toString("utf8");
          if (truncated) {
            audit?.("egress.blocked", { url, reason: `response exceeded ${maxBytes} bytes` });
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              rawHeaders: headers,
              body,
              connError: `response exceeded ${maxBytes} bytes (truncated)`,
            });
            return;
          }
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            rawHeaders: headers,
            body,
          });
        });
        res.on("error", (err) => {
          finished = true;
          if (timer) clearTimeout(timer);
          resolve({ body: "", connError: `connection error: ${err.message}` });
        });
      },
    );
    // Timeout: destroy the request + socket outright (an AbortSignal alone
    // does not reliably abort a hanging socket in Bun; a bare destroy emits
    // 'close', not 'error', so 'close' is handled below).
    let timedOut = false;
    timer = setTimeout(() => {
      timedOut = true;
      try {
        req.destroy();
        (req as unknown as { socket?: { destroy: () => void } }).socket?.destroy();
      } catch {
        /* already closed */
      }
    }, timeoutMs);
    let finished = false;
    let responseStarted = false;
    req.on("response", () => {
      responseStarted = true;
    });
    req.on("error", (err) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (/timed out/i.test(err.message)) {
        resolve({ body: "", connError: `request timed out after ${timeoutMs}ms` });
      } else {
        resolve({ body: "", connError: `connection error: ${err.message}` });
      }
    });
    req.on("close", () => {
      // In Bun the request 'close' fires when the request is fully sent —
      // BEFORE the response completes. Only treat it as terminal when the
      // response never started (or the timeout fired).
      if (finished) return;
      if (responseStarted && !timedOut) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({
        body: "",
        connError: timedOut
          ? `request timed out after ${timeoutMs}ms`
          : "connection closed before response completed",
      });
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
