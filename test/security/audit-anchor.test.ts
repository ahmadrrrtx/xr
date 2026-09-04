/**
 * Phase 4 (Evidence Integrity, F-08) — remote anchor E2E / fail-safe tests.
 *
 *  - file:// sink round-trip: pushAnchor appends a checkpoint line, records it,
 *    and verifyAnchors() append-verifies against the signed chain.
 *  - https sink to an UN-allowlisted host is EGRESS-BLOCKED → audited refusal,
 *    the run continues (fail-safe), and NO record is added.
 *  - disabled anchor (default) → skipped with zero network traffic.
 *  - anchor signature/containment: a forged anchor record fails verification.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { pushAnchor, buildAnchorPayload, sinkKind } from "../../src/security/audit-anchor.ts";
import { signCheckpoint, generateAuditIdentity, checkpointMessage } from "../../src/security/audit-signer.ts";
import { clearSecretMemo } from "../../src/security/secrets.ts";

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-anchor-home-"));
  prevHome = process.env.XR_HOME;
  process.env.XR_HOME = home;
  process.env.XR_AUDIT_SIGN_EVERY = "1";
  clearSecretMemo();
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = prevHome;
  delete process.env.XR_AUDIT_SIGN_EVERY;
  clearSecretMemo();
});

function freshStore(label: string): { store: WorkspaceStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `xr-anchor-${label}-`));
  const store = new WorkspaceStore("t", join(dir, "xr.db"));
  store.ensureAuditKeying("test");
  for (let i = 0; i < 3; i++) store.audit(`e${i}`, { i });
  return { store, dir };
}

function cfg(sink: string | undefined, enabled: boolean, extra: Record<string, unknown> = {}) {
  return {
    audit: {
      signEvery: 1,
      anchor: { enabled, sink, intervalMs: 3_600_000, anchorOnExit: true },
    },
    security: {
      egressAllowlist: ["anchor.example.com"] as string[],
      allowedHosts: [] as string[],
    },
    ...extra,
  } as any;
}

describe("Phase 4 · anchor — sink classification + payload", () => {
  test("sinkKind classifies schemes", () => {
    expect(sinkKind("file:///tmp/a.jsonl")).toBe("file");
    expect(sinkKind("https://anchor.example.com/xr")).toBe("https");
    expect(sinkKind("s3://bucket/key")).toBe("s3");
    expect(sinkKind("ftp://x")).toBe("unknown");
  });

  test("buildAnchorPayload is null on an unkeyed chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-anchor-nokey-"));
    try {
      const store = new WorkspaceStore("t", join(dir, "xr.db"));
      expect(buildAnchorPayload(store)).toBeNull();
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 4 · anchor — file sink round-trip", () => {
  test("pushAnchor appends a line, records it, and it append-verifies", async () => {
    const { store, dir } = freshStore("file");
    const sinkFile = join(dir, "anchors.jsonl");
    try {
      const res = await pushAnchor(store, { config: cfg(`file://${sinkFile}`, true) });
      expect(res.ok).toBe(true);
      expect(res.kind).toBe("file");
      expect(existsSync(sinkFile)).toBe(true);

      const lines = readFileSync(sinkFile, "utf8").trim().split("\n");
      expect(lines.length).toBe(1);
      const payload = JSON.parse(lines[0]!);
      expect(payload.xr).toBe("xr-audit-anchor-v1");
      expect(payload.sig).toBeTruthy();

      const v = store.verifyAnchors();
      expect(v.verified).toBe(1);
      expect(v.failed).toHaveLength(0);
      expect(v.highestCounter).toBe(payload.counter);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("anchor is skipped (no traffic) when disabled (the default)", async () => {
    const { store, dir } = freshStore("off");
    try {
      const res = await pushAnchor(store, { config: cfg(undefined, false) });
      expect(res.ok).toBe(false);
      expect(res.kind).toBe("skipped");
      expect(store.anchorCount()).toBe(0);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 4 · anchor — https sink egress gating (fail-safe)", () => {
  test("an un-allowlisted https sink is blocked, audited, and the run continues", async () => {
    const { store, dir } = freshStore("block");
    // Local stub server that SHOULD never be hit (the gate refuses first).
    let hits = 0;
    const server: Server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await pushAnchor(store, {
        config: cfg(`http://127.0.0.1:${port}/anchor`, true, {
          security: { egressAllowlist: ["anchor.example.com"], allowedHosts: [] },
        }),
      });
      // Loopback + un-allowlisted → blocked (or connError) but NEVER thrown.
      expect(res.ok).toBe(false);
      expect(["blocked", "error"]).toContain(res.kind);
      // No anchor record on failure; the run continues (no throw).
      expect(store.anchorCount()).toBe(0);
      // The refusal is audited.
      const events = store.recentAudit(20).map((e) => e.event);
      expect(events.some((e) => e === "audit.anchor_blocked")).toBe(true);
      expect(hits).toBe(0); // gate refused before connecting
      store.close();
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an allowlisted https sink round-trips through the egress gate", async () => {
    const { store, dir } = freshStore("ok");
    let received: any = null;
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = body;
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      // allowedHosts permits the loopback stub (the real operator allowlist path).
      const res = await pushAnchor(store, {
        config: {
          audit: { anchor: { enabled: true, sink: `http://127.0.0.1:${port}/anchor`, intervalMs: 3_600_000, anchorOnExit: true } },
          security: { egressAllowlist: [], allowedHosts: [`127.0.0.1:${port}`] },
        } as any,
      });
      expect(res.ok).toBe(true);
      expect(res.kind).toBe("https");
      expect(received).toBeTruthy();
      const payload = JSON.parse(received);
      expect(payload.xr).toBe("xr-audit-anchor-v1");
      expect(store.verifyAnchors().verified).toBe(1);
      store.close();
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Phase 4 · anchor — append-verification rejects forgeries", () => {
  test("a forged anchor record (wrong signature) fails verifyAnchors", async () => {
    const { store, dir } = freshStore("forge");
    const sinkFile = join(dir, "anchors.jsonl");
    try {
      const good = await pushAnchor(store, { config: cfg(`file://${sinkFile}`, true) });
      expect(good.ok).toBe(true);

      // Inject a forged anchor: real counter/hash but signed by an attacker key.
      const attacker = generateAuditIdentity();
      const head = store.headForAnchor()!;
      const forgedSig = signCheckpoint(
        attacker.privateKeyB64,
        checkpointMessage({ entryHash: head.entry_hash, counter: 999, publicKeyB64: attacker.publicKeyB64, kind: "head" }),
      );
      store.recordAnchor({
        counter: 999,
        entry_hash: head.entry_hash,
        entry_id: head.entry_id,
        sig: forgedSig,
        pubkey: attacker.publicKeyB64,
        sink: "attacker",
      });
      const v = store.verifyAnchors();
      expect(v.verified).toBe(1); // the legitimate one still verifies
      expect(v.failed.length).toBe(1);
      expect(v.failed[0]!.counter).toBe(999);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
