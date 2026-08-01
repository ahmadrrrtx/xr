/**
 * XR Phase 4 · T4 — private / link-local / metadata address blocking.
 *
 * The centralized egress proxy resolves every hostname and refuses the
 * connection when ANY resolved address falls into a blocked range — this is
 * the connection-time SSRF defence that an argument-level allowlist cannot
 * provide (a domain in the allowlist can resolve to 127.0.0.1 or to the cloud
 * metadata endpoint 169.254.169.254; DNS rebinding can move it there after
 * the policy check).
 *
 * Blocked ranges (RFC-compliant + cloud metadata + IPv6 equivalents):
 *   · loopback        127.0.0.0/8, ::1
 *   · RFC1918         10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   · link-local      169.254.0.0/16  (includes 169.254.169.254 metadata)
 *                     169.254.0.0/16 also covers AWS/GCP/Azure metadata
 *   · IPv6 link-local fe80::/10
 *   · IPv6 ULA        fc00::/7
 *   · IPv6 loopback   ::1 (above)
 *   · CGNAT           100.64.0.0/10
 *   · unspecified     0.0.0.0, ::
 *   · multicast       224.0.0.0/4, ff00::/8
 *   · reserved        240.0.0.0/4 (incl. 255.255.255.255 broadcast)
 *   · IPv4-mapped     ::ffff:0:0/96 (host's own IPv4)
 *
 * PURE module: no I/O. Tests live in test/security/egress-proxy.test.ts.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Parse an IPv6 literal (browser-grade parser; no DNS). Returns null on garbage. */
export function parseIpv6(ip: string): number[] | null {
  const lower = ip.toLowerCase();
  if (lower.includes(".")) {
    // IPv4-mapped / embedded: normalize the dotted tail to hex groups.
    const m = lower.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (!m) return null;
    const v4 = m[2].split(".").map(Number);
    if (v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hex = v4.map((n) => n.toString(16).padStart(2, "0"));
    const embedded = `${m[1]}${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
    return parseIpv6Groups(embedded);
  }
  return parseIpv6Groups(lower);
}

function parseIpv6Groups(ip: string): number[] | null {
  let head: string[];
  let tail: string[] | null = null;
  const doubleColon = ip.split("::");
  if (doubleColon.length > 2) return null;
  if (doubleColon.length === 2) {
    head = doubleColon[0] === "" ? [] : doubleColon[0].split(":");
    tail = doubleColon[1] === "" ? [] : doubleColon[1].split(":");
  } else {
    head = ip.split(":");
  }
  const groups: number[] = [];
  for (const g of head) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  if (tail !== null) {
    const tailGroups: number[] = [];
    for (const g of tail) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      tailGroups.push(parseInt(g, 16));
    }
    const fill = 8 - groups.length - tailGroups.length;
    if (fill < 0) return null;
    for (let i = 0; i < fill; i++) groups.push(0);
    groups.push(...tailGroups);
  }
  if (groups.length !== 8) return null;
  return groups;
}

export function isPrivateIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return false;
  // :: (unspecified) and ::1 (loopback)
  if (g.every((x) => x === 0)) return true;
  if (g[7] === 1 && g.slice(0, 7).every((x) => x === 0)) return true;
  // IPv4-mapped ::ffff:0:0/96 → the embedded IPv4 decides
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
    return isPrivateIpv4(v4);
  }
  // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // fc00::/7 ULA
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // ff00::/8 multicast
  if ((g[0] >> 8) === 0xff) return true;
  // 2001:db8::/32 is documentation-space — NOT blocked (it never routes).
  return false;
}

/**
 * True when the address is in a blocked (private/link-local/metadata/loopback)
 * range. Accepts IPv4 dotted-quad, IPv6 literals (with or without brackets)
 * and IPv4-mapped IPv6.
 */
export function isBlockedAddress(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes(":")) return isPrivateIpv6(ip);
  return isPrivateIpv4(ip);
}

/** Human label of the range family (for error messages). */
export function blockedRangeLabel(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes(":")) {
    if (ip === "::1") return "IPv6 loopback";
    const g = parseIpv6(ip);
    if (g && (g[0] & 0xffc0) === 0xfe80) return "IPv6 link-local";
    if (g && (g[0] & 0xfe00) === 0xfc00) return "IPv6 unique-local";
    return "IPv6 blocked range";
  }
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local / cloud metadata";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private network (RFC1918)";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT";
  return "reserved/multicast";
}
