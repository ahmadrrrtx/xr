/**
 * XR Phase 10 · Step 2 — canonicalization BYPASS regression suite.
 *
 * Fuzz establishes "no crash". This file establishes the stronger property the
 * audits (§25.9 / A / B) actually care about: deterministic policy (`checkAction`)
 * decides on CANONICAL values, so re-encoding a target must not let it dodge a
 * block. Every case asserts `allowed === false` for a secret-path read.
 *
 * This is also the vehicle for pentest findings that concern guard
 * canonicalization: any new re-encoding family that slips through lands here as
 * a regression test first, then the fix.
 */
import { describe, expect, test } from "bun:test";
import { checkAction, type PolicyContext } from "../../src/security/guard.ts";

// Nothing may be fetched/read automatically: egress + secret paths denied.
const HARDENED: PolicyContext = { egressAllowlist: ["example.com"], requireApproval: [], allowedHosts: [] };

/** Encode every byte with %XX (and optionally do it N times = double/triple encode). */
function percentEncodeAll(s: string, times: number): string {
  let out = s;
  for (let i = 0; i < times; i++) {
    out = Array.from(out)
      .map((ch) => ch.split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""))
      .join("");
  }
  return out;
}

/** Encode every byte with %XX, uppercase hex (e.g. %2F), N passes deep. */
function percentEncodeAllUpper(s: string, times: number): string {
  let out = s;
  for (let i = 0; i < times; i++) {
    out = Array.from(out)
      .map((c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
      .join("");
  }
  return out;
}

/** Encode only dot and slash (the traversal-relevant bytes). */
function encodeDotSlash(s: string): string {
  return s.replace(/\./g, "%2e").replace(/\//g, "%2f");
}

function encodeDotSlashUpper(s: string): string {
  return s.replace(/\./g, "%2E").replace(/\//g, "%2F");
}

/** Secret targets that policy must block whether they exist on disk or not. */
const SECRET_TARGETS = [
  "/home/user/.ssh/id_rsa",
  "/etc/passwd",
  "/private/etc/passwd",
  "/home/user/.ssh/authorized_keys",
  "/etc/shadow",
];

function reencodings(target: string): { name: string; value: string }[] {
  return [
    { name: "plain", value: target },
    { name: "dot-slash-encoded", value: encodeDotSlash(target) },
    { name: "dot-slash-encoded-upper", value: encodeDotSlashUpper(target) },
    { name: "percent-all-1x", value: percentEncodeAll(target, 1) },
    { name: "percent-all-2x", value: percentEncodeAll(target, 2) },
    { name: "percent-all-3x", value: percentEncodeAll(target, 3) },
    { name: "traversal-prefix", value: "/../../../.." + target },
    { name: "double-slash-prefix", value: "//" + target },
    // NOTE: literal tab/newline bytes are NOT a bypass on POSIX — the OS treats
    // them as part of a distinct filename, so they never resolve to `target`.
    // They are deliberately not asserted as blocked (that would be over-blocking).
    { name: "percent-all-1x-upper", value: percentEncodeAllUpper(target, 1) },
    { name: "percent-all-2x-upper", value: percentEncodeAllUpper(target, 2) },
  ];
}

describe("Phase 10 · guard canonicalization bypass regression", () => {
  for (const target of SECRET_TARGETS) {
    describe(`secret target: ${target}`, () => {
      for (const enc of reencodings(target)) {
        test(`${enc.name} read is BLOCKED (allowed:false)`, () => {
          const r = checkAction({ tool: "read_file", args: { path: enc.value } }, HARDENED);
          expect(r.allowed, `re-encoding '${enc.value}' must not bypass the block`).toBe(false);
        });
        test(`${enc.name} write to it is BLOCKED`, () => {
          const r = checkAction({ tool: "write_file", args: { path: enc.value } }, HARDENED);
          expect(r.allowed, `re-encoding '${enc.value}' (write) must not bypass`).toBe(false);
        });
      }
    });
  }

  describe("egress canonicalization", () => {
    const BAD = ["127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254"];
    for (const host of BAD) {
      test(`egress to raw ${host} (not allow-listed) is BLOCKED`, () => {
        const r = checkAction({ tool: "fetch_url", args: { url: `http://${host}/` } }, HARDENED);
        expect(r.allowed).toBe(false);
      });
    }
  });
});
