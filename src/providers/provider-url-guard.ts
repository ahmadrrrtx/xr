/**
 * XR Phase 31 · Bucket A (A5) — SSRF defence for custom provider URLs.
 *
 * A user-configured `baseUrl` (custom OpenAI-compatible chat provider,
 * embeddings endpoint) is an instruction to the daemon to open a network
 * connection. Without a guard it is also an SSRF primitive: point it at
 * `http://169.254.169.254/…` or a LAN service and XR will happily POST to
 * it. This guard is checked BEFORE any fetch to a custom URL.
 *
 * Rules (fail closed):
 *   · protocol must be `https:` (`http:` only reaches loopback, and only
 *     through the escape hatch below);
 *   · the host must not be `localhost`, `*.local`, `metadata.google.internal`,
 *     or an IP literal in a blocked range — loopback 127/8 + ::1, link-local
 *     169.254/16 + fe80::/10 (includes every cloud metadata IP, incl.
 *     100.100.100.200 via CGNAT and fd00:ec2::254 via ULA), RFC1918
 *     10/8 + 172.16/12 + 192.168/16, IPv6 ULA fc00::/7. Range math is NOT
 *     re-implemented here: it reuses `isBlockedAddress` from
 *     src/security/private-ip.ts, the same table the egress proxy enforces;
 *   · DNS-rebinding: the async check resolves EVERY A/AAAA record and
 *     refuses when ANY is blocked (same policy as `checkEgressTarget`);
 *   · official provider hosts (api.openai.com, api.anthropic.com,
 *     generativelanguage.googleapis.com, … — derived from the preset
 *     table's hosted baseUrls plus the native endpoints) are hard
 *     allow-listed and exempt from the private/DNS checks;
 *   · built-in LOCAL presets (Ollama & friends, `kind: "local"`) never pass
 *     through here at all — they are first-class local-first configuration,
 *     not user-supplied custom URLs.
 *
 * Escape hatch: `XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1` permits private /
 * loopback custom URLs (self-hosted OpenAI-compatible servers on the LAN).
 * It is deliberately loud: every allowance carries a warning string, and
 * the daemon logs it again at boot (src/daemon/server.ts).
 */
import { isBlockedAddress, blockedRangeLabel } from "../security/private-ip.ts";
import { defaultResolve } from "../security/egress-proxy.ts";
import { PRESETS } from "./presets.ts";

export const PRIVATE_PROVIDER_ENV = "XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER";

export const PRIVATE_PROVIDER_WARNING =
  "XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1 — custom provider URLs may point at private/loopback addresses. " +
  "This disables SSRF protection for custom providers; only do this for a self-hosted model server you control.";

/** Official hosted provider hosts, hard allow-listed (A5). */
export const OFFICIAL_PROVIDER_HOSTS: ReadonlySet<string> = (() => {
  const hosts = new Set<string>([
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.mistral.ai",
    "api.cohere.ai",
    "api.cerebras.ai",
  ]);
  for (const preset of Object.values(PRESETS)) {
    if (preset.kind !== "hosted" || !preset.baseUrl) continue;
    try {
      hosts.add(new URL(preset.baseUrl).hostname.toLowerCase());
    } catch {
      /* preset URLs are in-tree constants; a bad one is a build bug */
    }
  }
  return hosts;
})();

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export interface ProviderUrlCheck {
  ok: boolean;
  reason?: string;
  /** Canonical URL string (present when ok). */
  url?: string;
  host?: string;
  /** True when the escape hatch allowed a private destination. */
  allowedPrivate?: boolean;
  warnings: string[];
}

export interface ProviderUrlGuardOptions {
  /** Permit private/loopback destinations (escape hatch). Defaults to env. */
  allowPrivate?: boolean;
  /** Injectable DNS resolver for tests (host → all A/AAAA addresses). */
  resolve?: (host: string) => Promise<string[]>;
  env?: NodeJS.ProcessEnv;
}

export function privateProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PRIVATE_PROVIDER_ENV] === "1";
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** Hostname-level blocks that need no DNS: names, suffixes, IP literals. */
function syncHostBlock(hostRaw: string): string | null {
  const host = hostRaw.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return `host ${host} is blocked`;
  if (host.endsWith(".local")) return `host ${host} is a .local name and is blocked`;
  if (isIpLiteral(host) && isBlockedAddress(host)) {
    return `destination ${host} is in a blocked range (${blockedRangeLabel(host)})`;
  }
  return null;
}

/**
 * Synchronous half of the guard: protocol + host rules only (no DNS).
 * Used at provider-registration time, where a DNS lookup cannot run.
 */
export function validateProviderUrlSync(
  raw: string,
  opts: ProviderUrlGuardOptions = {},
): ProviderUrlCheck {
  const allowPrivate = opts.allowPrivate ?? privateProviderAllowed(opts.env);
  const warnings: string[] = [];
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false, reason: "provider URL is not a valid URL", warnings };
  }
  const host = url.hostname.toLowerCase();

  if (OFFICIAL_PROVIDER_HOSTS.has(host)) {
    if (url.protocol !== "https:") {
      return { ok: false, reason: `official provider ${host} must be reached over https`, warnings };
    }
    return { ok: true, url: url.toString(), host, warnings };
  }

  const blocked = syncHostBlock(url.hostname);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `provider URL protocol ${url.protocol} is not allowed`, warnings };
  }
  if (blocked) {
    if (!allowPrivate) return { ok: false, reason: blocked, warnings };
    warnings.push(PRIVATE_PROVIDER_WARNING);
    return { ok: true, url: url.toString(), host, allowedPrivate: true, warnings };
  }
  if (url.protocol === "http:") {
    // Plain http is only ever sane for a loopback model server, and that
    // destination is private — so it needs the escape hatch like any
    // other private target. A public http endpoint is refused outright
    // (credentials and prompts would cross the network in cleartext).
    if (!allowPrivate) {
      return {
        ok: false,
        reason: "provider URL must use https (http is only allowed for private/loopback servers with XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1)",
        warnings,
      };
    }
    warnings.push(PRIVATE_PROVIDER_WARNING);
    return { ok: true, url: url.toString(), host, allowedPrivate: true, warnings };
  }
  return { ok: true, url: url.toString(), host, warnings };
}

/**
 * Full guard: sync rules + DNS-rebinding check (every resolved address
 * re-checked). Used before an actual fetch to a custom URL.
 */
export async function validateProviderUrl(
  raw: string,
  opts: ProviderUrlGuardOptions = {},
): Promise<ProviderUrlCheck> {
  const sync = validateProviderUrlSync(raw, opts);
  if (!sync.ok || sync.allowedPrivate || !sync.host) return sync;
  if (OFFICIAL_PROVIDER_HOSTS.has(sync.host)) return sync;
  if (isIpLiteral(sync.host)) return sync; // literal already range-checked

  const resolve = opts.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolve(sync.host);
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${sync.host}`, warnings: sync.warnings };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: `DNS resolution returned no addresses for ${sync.host}`, warnings: sync.warnings };
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      return {
        ok: false,
        reason: `host ${sync.host} resolves to ${addr} (${blockedRangeLabel(addr)}) — refused (DNS-rebinding/metadata guard)`,
        warnings: sync.warnings,
      };
    }
  }
  return sync;
}
