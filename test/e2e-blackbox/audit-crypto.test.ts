/**
 * XR — e2e black-box: signed audit evidence (Phase 4, F-08).
 *
 * These spawn the REAL CLI in fresh processes with an isolated XR_HOME and
 * attack the database from OUTSIDE the runtime — the exact adversary F-08
 * describes (local attacker with SQLite write access). They assert on the
 * process contract (exit codes + stdout), which in-process tests cannot.
 *
 *   - a fresh install auto-keys on boot; `verify --crypto` exits 0
 *   - wholesale truncate + consistent-hash rebuild → `verify --crypto` exits
 *     NON-ZERO (the F-08 kill proof at the process boundary)
 *   - key file deleted → `verify --crypto` exits 2 (key unavailable, limited)
 *   - `verify` (plain) still exits 0 on an unmodified install (chain-only)
 *   - default-off anchor: zero traffic; `audit anchor` refuses unconfigured
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  runCli,
  freshHome,
  removeHome,
  spawnCli,
  waitForExit,
  type CliRunResult,
} from "./helpers.ts";

const T = 60_000;

let sharedHome: string;

beforeAll(() => {
  sharedHome = freshHome();
});

afterAll(() => {
  removeHome(sharedHome);
});

/** The default-workspace DB path used by the CLI for a given XR_HOME. */
function dbPath(home: string): string {
  return join(home, "xr.db");
}

/** Boot the CLI once (any audit read path triggers boot keying). */
async function boot(home: string): Promise<CliRunResult> {
  return runCli(["audit", "tail", "--limit", "1"], { home, timeoutMs: T });
}

describe("xr audit verify — signed evidence over the real CLI", () => {
  test("fresh install auto-keys on boot; verify --crypto exits 0", async () => {
    const home = freshHome();
    try {
      const b = await boot(home);
      expect(b.code).toBe(0);

      const v = await runCli(["audit", "verify", "--crypto"], { home, timeoutMs: T });
      expect(v.code).toBe(0);
      expect(v.stdout).toContain("Ed25519 signatures");
      expect(v.stdout).toContain("signed head");
      expect(v.stdout).not.toContain("FAILED");
    } finally {
      removeHome(home);
    }
  }, T);

  test("plain verify (chain-only) exits 0 on an unmodified install", async () => {
    const home = freshHome();
    try {
      await boot(home);
      const v = await runCli(["audit", "verify"], { home, timeoutMs: T });
      expect(v.code).toBe(0);
      expect(v.stdout).toContain("Audit chain intact");
    } finally {
      removeHome(home);
    }
  }, T);

  test("ADVERSARY: wholesale truncate + consistent hash rebuild is caught (non-zero exit)", async () => {
    const home = freshHome();
    try {
      await boot(home);
      // Produce a few real entries so there is history to truncate.
      for (let i = 0; i < 3; i++) {
        const r = await runCli(["audit", "tail", "--limit", "1"], { home, timeoutMs: T });
        expect(r.code).toBe(0);
      }

      // ── Attacker with SQLite write access, WITHOUT the private key ──────
      const raw = new Database(dbPath(home));
      // The unforgeable head row must be removed; the attacker cannot remake it.
      raw.query(`DELETE FROM audit_head`).run();
      // Keep the keyed anchor + the first half of real history, truncate the rest.
      const maxRow = raw.query(`SELECT MAX(id) m FROM audit_log`).get() as { m: number };
      const keepThrough = Math.max(2, Math.floor(maxRow.m / 2));
      raw.query(`DELETE FROM audit_log WHERE id > ?`).run(keepThrough);
      // Rebuild a fully-consistent forged tail (recomputed links), no key.
      const last = raw
        .query(`SELECT hash, head_counter FROM audit_log ORDER BY id DESC LIMIT 1`)
        .get() as { hash: string; head_counter: number | null };
      expect(last).toBeTruthy();
      let prev = last.hash;
      let counter = (last.head_counter ?? 0) + 1;
      for (let i = 0; i < 2; i++) {
        const event = `forged${i}`;
        const detail = JSON.stringify({ forged: true });
        const ts = Date.now() + i;
        const hash = createHash("sha256")
          .update(JSON.stringify({ event, detail: { forged: true }, prev, ts }))
          .digest("hex");
        raw
          .query(
            `INSERT INTO audit_log (session_id,event,detail,prev_hash,hash,created_at,head_counter,sig) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(null, event, detail, prev, hash, ts, counter++, null);
        prev = hash;
      }
      raw.close();

      // Chain-only verify can be FOOLED (links are consistent)...
      const plain = await runCli(["audit", "verify"], { home, timeoutMs: T });
      // ...but cryptographic verify MUST fail non-zero.
      const crypto = await runCli(["audit", "verify", "--crypto"], { home, timeoutMs: T });
      expect(crypto.code).not.toBe(0);
      expect(crypto.stdout).toContain("FAILED");
      // The signed-head gap is the detection line.
      expect(crypto.stdout).toMatch(/signed head|head signature|head missing/i);
      void plain; // chain-only result is informational; the point is crypto fails
    } finally {
      removeHome(home);
    }
  }, T);

  test("key loss: signing key removed → verify --crypto exits 2 (limited to chain)", async () => {
    const home = freshHome();
    try {
      await boot(home);

      // Simulate total loss of the private key in THIS isolated home: the key
      // lives in the secrets fallback (<home>/.env, AES-GCM-sealed) and/or the
      // per-install file key. Remove every secret-store location so the child
      // process (no OS keychain in the sandbox) cannot load the key. This is
      // deterministic regardless of which backend the boot wrote to.
      for (const f of [join(home, ".env"), join(home, "secrets", ".file-key")]) {
        rmSync(f, { force: true });
      }
      // Belt-and-suspenders: also neutralize any ambient key in the env so a
      // spawned CLI can never pick it up through secret-compat hydration.
      const v = await runCli(["audit", "verify", "--crypto"], {
        home,
        timeoutMs: T,
        env: { XR_SECRETS_ENV_COMPAT: "0" },
      });
      expect(v.code).toBe(2);
      expect(`${v.stdout}\n${v.stderr}`).toMatch(/LIMITED|key unavailable|signing key unavailable/i);
    } finally {
      removeHome(home);
    }
  }, T);

  test("re-key rotates the key; old segment still verifies and chain stays green", async () => {
    const home = freshHome();
    try {
      await boot(home);
      const rk = await runCli(["audit", "re-key", "--yes"], { home, timeoutMs: T });
      expect(rk.code).toBe(0);
      expect(rk.stdout).toContain("rotated");

      const v = await runCli(["audit", "verify", "--crypto"], { home, timeoutMs: T });
      expect(v.code).toBe(0);
      expect(v.stdout).not.toContain("FAILED");
    } finally {
      removeHome(home);
    }
  }, T);
});

describe("xr audit anchor — default off, fail-safe", () => {
  test("with no anchor configured, `audit anchor` reports disabled and exits 0", async () => {
    const home = freshHome();
    try {
      await boot(home);
      const r = await runCli(["audit", "anchor"], { home, timeoutMs: T });
      // Optional feature → not an error; it tells the operator it's off.
      expect(r.code).toBe(0);
      // The "disabled" notice is rendered via warn() → stderr; the tip is stdout.
      expect(`${r.stdout}\n${r.stderr}`).toMatch(/disabled|opt in|not configured/i);
    } finally {
      removeHome(home);
    }
  }, T);

  test("a fresh install performs no anchor traffic and has no anchor records", async () => {
    const home = freshHome();
    try {
      await boot(home);
      const raw = new Database(dbPath(home));
      const anchors = raw.query(`SELECT COUNT(*) c FROM audit_anchors`).get() as { c: number };
      raw.close();
      expect(anchors.c).toBe(0);
    } finally {
      removeHome(home);
    }
  }, T);
});
