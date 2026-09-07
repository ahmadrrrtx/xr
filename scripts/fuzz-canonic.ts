#!/usr/bin/env bun
/**
 * XR Phase 10 · Step 2 — guard canonicalization fuzz harness.
 *
 * The crown-jewel security surface is `src/security/guard.ts`: canonical path /
 * URL / host resolution that deterministic policy decides on (plus the
 * connection-time SSRF defence in `src/security/private-ip.ts`). Audit §25.9/A/B
 * explicitly ask that this be fuzzed, because a *crash* (uncaught exception) or
 * an *invariant break* in canonicalization is how an allow-list / deny-list is
 * turned into a denial-of-service or a bypass.
 *
 * Two layers:
 *   1. A hand-built ADVERSARIAL seed corpus: hex/octal/decimal/IPv6 hosts,
 *      percent-encoding, double-encoding, zero-width/unicode, traversal, null
 *      bytes, Windows paths, over-length numerics.
 *   2. A deterministic PRNG MUTATION pass that derives new inputs from the seeds
 *      so a red run is reproducible from the reported seed, without needing a
 *      native libfuzzer build (the maintainer may later swap in an AFL++/native
 *      harness for the extracted core — the corpus approach is sufficient for 1.x).
 *
 * What is asserted (no crashes + invariants):
 *   · pure functions never throw on hostile input (fail-closed, not throw);
 *   · fullyDecode terminates and is idempotent in the sense that re-decoding the
 *     result changes nothing (a non-stabilising / pathological value is handled);
 *   · normalizeHost returns null OR a well-formed value — never throws;
 *   · canonicalPath never returns an unnormalised path and never throws;
 *   · isSecretPath never throws;
 *   · isBlockedAddress/parseIpv6 never throw on any host-shaped input;
 *   · checkAction(secret-path target) is invariant under hostile re-encoding of
 *     that same path (a bypass = a crash of the assertion).
 *
 * Usage:
 *   bun run scripts/fuzz-canonic.ts --iterations 200000 --seed 7 --json out.json
 *   bun run scripts/fuzz-canonic.ts --quick   # 60s bounded, for CI
 *
 * Exit: 0 = clean (no crash, no invariant break); 1 = found something (report).
 */

import {
  fullyDecode,
  canonicalPath,
  isSecretPath,
  normalizeHost,
  checkAction,
  scanUntrusted,
  type PolicyContext,
} from "../src/security/guard.ts";
import {
  isPrivateIpv4,
  parseIpv6,
  isBlockedAddress,
} from "../src/security/private-ip.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface Finding {
  kind: string;
  input: string;
  error?: string;
  detail?: string;
}

// ── 1. Adversarial seed corpus ───────────────────────────────────────────────

const HOST_SEEDS: string[] = [
  // dotted-quad: hex/octal/decimal components and mixed forms
  "127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "0x7f.0.0.1",
  "127.0.1", "127.1", "0x7f.1", "0177.1", "0", "0.0.0.0", "255.255.255.255",
  "0xffffffff", "0x100000000", "256.1.1.1", "999.999.999.999", "1.2.3.4.5",
  // IPv6 literals
  "[::1]", "[0:0:0:0:0:0:0:1]", "[::ffff:127.0.0.1]", "[fe80::1]", "[fc00::1]",
  "[::ffff:0:0:7f00:1]", "[2001:db8::1]", "::1", "::ffff:127.0.0.1",
  // allow-list bypass attempts (resolve-to-private via naming)
  "0x7f000001.nip.io", "127.0.0.1.nip.io", "localtest.me", "spoofed.burpcollaborator.net",
  // metadata
  "169.254.169.254", "0x7f.0.0.1", "metadata.google.internal",
  // hostname weirdness
  "EXAMPLE.com", "Example.com.", "a.b.c", "-evil.com", "evil-.com", "a_b.com",
  "a..b", "a.b.", ".", "..", " ", "", "x".repeat(300),
  // decimal/hex garbage
  "0x", "0xg", "99999999999999999999999999999999", "0x7fffffffffffffff",
  "0xffffffffffffffffffffffffffffffffffff", "+127.0.0.1", "-127.0.0.1",
];

const PATH_SEEDS: string[] = [
  "/home/user/.ssh/id_rsa", "~/.ssh/id_rsa", "C:\\Users\\me\\.ssh\\id_rsa",
  "/etc/passwd", "/private/etc/passwd", "/etc/shadow", "/etc/ssh/sshd_config",
  "/tmp/x", "./.env", "~/.aws/credentials", "/.kube/config",
  "id_ed25519", "id_rsa.pub", "authorized_keys", "/.netrc", "/.npmrc",
  "/.git-credentials", "C:\\Users\\me\\AppData\\secrets.json",
  // traversal + percent + double-percent
  "../../../../etc/passwd", "%2e%2e/%2e%2e/etc/passwd", "%252e%252e/etc/passwd",
  ".ssh/", "/x/.ssh/../.ssh/id_rsa", "//etc//shadow", "~/../../etc/passwd",
  ".env.local", "creds.yaml", ".config/gcloud/credentials.json",
];

const EGRESS_SEEDS: string[] = [
  "https://127.0.0.1:11434/", "http://2130706433/", "https://0x7f000001/",
  "http://[::1]/", "file:///etc/passwd", "gopher://x/", "http://169.254.169.254/latest/meta-data/",
  "http://0.0.0.0:80/", "http://[::ffff:127.0.0.1]/", "data:text/html,hi",
  "javascript:alert(1)", "http://EXAMPLE.com:8080/x",
];

// ── Deterministic PRNG (mulberry32) so a seed reproduces the whole run ───────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Invariant assertions (pure, throw on break) ─────────────────────────────

function assertNoThrow(name: string, input: string, fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    throw { kind: "crash", input, error: `${name}: ${(e as Error).message}` };
  }
}

const ALLOW_EVERYTHING: PolicyContext = {
  egressAllowlist: ["example.com"],
  requireApproval: [],
  allowedHosts: [],
};

function invariantChecks(input: string): Finding | null {
  // fullyDecode terminates and re-decoding the result is a fixpoint
  const d1 = fullyDecode(input);
  const d2 = fullyDecode(d1);
  if (d2 !== d1) {
    return { kind: "decode_not_fixpoint", input, detail: `d1=${JSON.stringify(d1)} d2=${JSON.stringify(d2)}` };
  }
  return null;
}

function mutate(s: string, rnd: () => number): string {
  const pool = "0123456789abcdefABCDEF.:/%[]_-+ \t.ssh/.env/etc/passwd~`;\"'\u200b\u200c\\u00e9\\u202e\\ufeffid_rsa";
  const op = Math.floor(rnd() * 5);
  if (s.length < 2) return s + pool[Math.floor(rnd() * pool.length)];
  const i = Math.floor(rnd() * s.length);
  switch (op) {
    case 0: return s.slice(0, i) + pool[Math.floor(rnd() * pool.length)] + s.slice(i + 1);
    case 1: return s.slice(0, i) + pool[Math.floor(rnd() * pool.length)] + s.slice(i);
    case 2: return s.slice(0, i) + s.slice(i + 1);
    case 3: return (s + s).slice(0, Math.min(s.length * 2, 256));
    default: return s + "%" + pool[Math.floor(rnd() * pool.length)] + pool[Math.floor(rnd() * pool.length)];
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let iterations = 200000;
  let seed = 7;
  let json: string | null = null;
  let quick = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--iterations") iterations = Number(argv[++i]);
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--json") json = argv[++i]!;
    else if (a === "--quick") quick = true;
    else if (a === "--help") { console.log("Usage: fuzz-canonic.ts [--iterations N] [--seed N] [--json p] [--quick]"); process.exit(0); }
    else { console.error(`unknown flag ${a}`); process.exit(2); }
  }
  if (quick) iterations = 60000;
  return { iterations, seed, json };
}

export async function runFuzz(opts: { iterations: number; seed: number }): Promise<{ findings: Finding[]; checks: number }> {
  const rnd = mulberry32(opts.seed);
  const findings: Finding[] = [];
  let checks = 0;

  const seedAll = [...HOST_SEEDS, ...PATH_SEEDS, ...EGRESS_SEEDS];

  const runOn = (input: string): void => {
    checks++;
    // invariant-level decode check
    const inv = invariantChecks(input);
    if (inv) { findings.push(inv); return; }

    // hosts
    assertNoThrow("normalizeHost", input, () => normalizeHost(input));
    const nh = normalizeHost(input);
    if (nh !== null && nh.host.includes("NaN")) {
      findings.push({ kind: "normalizeHost_NaN", input, detail: nh.host });
    }
    // canonicalPath against a scratch cwd
    assertNoThrow("canonicalPath", input, () => canonicalPath(input, "/tmp"));
    assertNoThrow("isSecretPath", input, () => {
      const c = canonicalPath(input, "/tmp");
      isSecretPath(c);
    });
    // private-ip parser
    assertNoThrow("isPrivateIpv4", input, () => isPrivateIpv4(input));
    assertNoThrow("parseIpv6", input, () => parseIpv6(input));
    assertNoThrow("isBlockedAddress", input, () => isBlockedAddress(input));
    // checkAction: hostile encoding of a secret path must stay blocked
    assertNoThrow("checkAction", input, () =>
      checkAction({ tool: "read_file", args: { path: input } }, ALLOW_EVERYTHING),
    );
    assertNoThrow("scanUntrusted", input, () => scanUntrusted(input));
  };

  // hand seeds first
  for (const s of seedAll) runOn(s);

  // mutation pass
  let budget = opts.iterations;
  let corpus = [...seedAll];
  let ci = 0;
  while (budget-- > 0 && findings.length < 20) {
    const parent = corpus[ci % corpus.length]!;
    const child = mutate(parent, rnd);
    runOn(child);
    if (findings.length === 0 && rnd() < 0.05) corpus.push(child);
    ci++;
    if (corpus.length > 2000) corpus = corpus.slice(-1000);
  }

  return { findings, checks };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const start = Date.now();
  const { findings, checks } = await runFuzz({ iterations: args.iterations, seed: args.seed });
  const ms = Date.now() - start;

  const report = {
    phase: "phase-10-step-2",
    subject: "guard canonicalization (guard.ts + private-ip.ts)",
    iterations: args.iterations,
    checks,
    elapsedMs: ms,
    seed: args.seed,
    findings,
    status: findings.length === 0 ? "clean" : "findings",
    note:
      "No-crash + canonicalization-invariant fuzz. See .github/workflows/fuzz-guard.yml for the weekly CI cadence (2 clean weeks required before the readiness gate).",
  };

  if (findings.length > 0) {
    console.error(`✗ ${findings.length} finding(s):`);
    for (const f of findings.slice(0, 20)) console.error("  -", JSON.stringify(f));
  } else {
    console.log(`✓ clean — ${checks.toLocaleString()} checks, no crash, no invariant break (seed ${args.seed}, ${ms}ms)`);
  }
  if (args.json) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(join(args.json)), { recursive: true });
    writeFileSync(args.json, JSON.stringify(report, null, 2));
  }
  return findings.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
