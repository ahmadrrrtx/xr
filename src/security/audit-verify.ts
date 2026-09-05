/**
 * XR Phase 4 (Evidence Integrity, F-08) — pure read-only signed-audit
 * verification.
 *
 * Extracted from WorkspaceStore so the single-writer store stays within its
 * size waiver: these functions perform NO writes and take a minimal read
 * interface (the few queries they need), making the verification logic both
 * reusable (CLI, dashboard, tests) and independent of the connection owner.
 *
 * Verification covers:
 *   1. SHA-256 chain replay (passed in from the store's verifyChain()),
 *   2. per-segment Ed25519 checkpoint signatures over the on-chain public key,
 *   3. head-counter monotonicity (a contiguous 0,1,2,… run per segment),
 *   4. the signed `audit_head` (the F-08 kill: a wholesale chain rebuild
 *      cannot reproduce a valid head signature without the private key),
 *   5. append-verification of remote anchor records.
 */
import { checkpointMessage, verifyCheckpoint } from "./audit-signer.ts";

export interface CryptoVerifySegment {
  startId: number;
  pubkey: string;
  legacy: boolean;
}

export interface CryptoVerifyResult {
  chainValid: boolean;
  keyed: boolean;
  keyAvailable: boolean;
  signaturesValid: boolean;
  counterError?: { atId: number; reason: string };
  segments: CryptoVerifySegment[];
  head?: {
    present: boolean;
    matches: boolean;
    counter: number | null;
    stale: boolean;
    entryId: number | null;
    reason?: string;
  };
}

export interface AnchorRecord {
  counter: number;
  entry_hash: string;
  entry_id: number;
  sig: string;
  pubkey: string;
  sink: string;
  anchored_at: number;
}

export interface AnchorVerifyResult {
  verified: number;
  failed: Array<{ counter: number; reason: string }>;
  highestCounter: number | null;
  anchorLag: boolean;
}

/** Minimal read surface the verifier needs (implemented by WorkspaceStore). */
export interface AuditReadSource {
  all<T = unknown>(sql: string): T[];
  get<T = unknown>(sql: string): T | undefined;
}

interface AuditRow {
  id: number;
  event: string;
  detail: string;
  hash: string;
  head_counter: number | null;
  sig: string | null;
}

interface HeadRow {
  counter: number;
  entry_hash: string;
  entry_id: number;
  sig: string;
  pubkey: string;
}

function detailPubkey(detail: string): string | null {
  try {
    return (JSON.parse(detail) as { pubkey?: string }).pubkey ?? null;
  } catch {
    return null;
  }
}

/**
 * Verify the signed chain. `chainValid` comes from the store's own hash-chain
 * replay; `keyAvailable` reflects whether THIS process holds the private key
 * (false → the code-2 "limited" state rather than a forgery).
 */
export function verifySignedChain(
  db: AuditReadSource,
  chainValid: boolean,
  keyAvailable: boolean,
): CryptoVerifyResult {
  const rows = db.all<AuditRow>(
    `SELECT id,event,detail,hash,head_counter,sig FROM audit_log ORDER BY id ASC`,
  );

  const segments: CryptoVerifySegment[] = [];
  let currentPubkey: string | null = null;
  let segStartId = rows[0]?.id ?? 0;
  let expectedCounter = 0;
  let signaturesValid = true;
  let counterError: CryptoVerifyResult["counterError"];

  const fail = (atId: number, reason: string) => {
    signaturesValid = false;
    if (!counterError) counterError = { atId, reason };
  };

  for (const r of rows) {
    if (r.event === "audit.keyed" || r.event === "audit.rekey") {
      const pub = detailPubkey(r.detail);
      if (!pub) {
        fail(r.id, `${r.event} event carries no public key`);
      } else {
        segments.push({ startId: segStartId, pubkey: currentPubkey ?? "", legacy: currentPubkey === null });
        currentPubkey = pub;
        segStartId = r.id;
        expectedCounter = r.head_counter ?? 0;
      }
    }

    if (currentPubkey !== null) {
      if (r.head_counter === null) {
        fail(r.id, "signed-segment entry has no counter");
      } else if (r.head_counter !== expectedCounter) {
        fail(r.id, `counter ${r.head_counter} ≠ expected ${expectedCounter}`);
      } else {
        expectedCounter += 1;
      }
      if (r.sig !== null) {
        const verifyKey =
          r.event === "audit.keyed" || r.event === "audit.rekey" ? detailPubkey(r.detail) : currentPubkey;
        const ok =
          verifyKey !== null &&
          r.head_counter !== null &&
          verifyCheckpoint(
            verifyKey,
            checkpointMessage({ entryHash: r.hash, counter: r.head_counter, publicKeyB64: verifyKey, kind: "checkpoint" }),
            r.sig,
          );
        if (!ok) fail(r.id, "signature does not verify");
      }
    }
  }
  segments.push({ startId: segStartId, pubkey: currentPubkey ?? "", legacy: currentPubkey === null });

  const keyed = rows.some((r) => r.event === "audit.keyed" || r.event === "audit.rekey");

  // ── signed head ──────────────────────────────────────────────────────────
  const head = db.get<HeadRow>(`SELECT counter,entry_hash,entry_id,sig,pubkey FROM audit_head WHERE id = 1`);
  const last = rows[rows.length - 1];
  let headResult: CryptoVerifyResult["head"];

  if (!head) {
    headResult = { present: false, matches: false, counter: null, stale: false, entryId: null };
    if (keyed) {
      // F-08 kill: a keyed chain with no signed head means a wholesale
      // truncate/rebuild that deleted the unforgeable head.
      fail(0, "signed head missing — a rebuilt/forged chain cannot restore it");
    }
  } else {
    let matches = false;
    try {
      matches = verifyCheckpoint(
        head.pubkey,
        checkpointMessage({ entryHash: head.entry_hash, counter: head.counter, publicKeyB64: head.pubkey, kind: "head" }),
        head.sig,
      );
    } catch {
      matches = false;
    }
    const stale = !last ? false : head.entry_id !== last.id || head.entry_hash !== last.hash;
    if (!matches) {
      fail(head.entry_id, "head signature does not verify");
    } else if (stale && keyAvailable) {
      // Stale head with the key IN HAND is anomalous; with the key MISSING it
      // is the expected code-2 "limited" state (later appends couldn't sign).
      fail(head.entry_id, "head is stale (does not cover the latest entry)");
    }
    headResult = { present: true, matches, counter: head.counter, stale, entryId: head.entry_id };
  }

  return {
    chainValid,
    keyed,
    keyAvailable,
    signaturesValid: chainValid && signaturesValid,
    counterError,
    segments,
    head: headResult,
  };
}

/** Append-verify remote anchor records against the local signed chain. */
export function verifyAnchorRecords(db: AuditReadSource): AnchorVerifyResult {
  const anchors = db.all<AnchorRecord>(
    `SELECT counter,entry_hash,entry_id,sig,pubkey,sink,anchored_at FROM audit_anchors ORDER BY id ASC`,
  );
  const chain = new Map<number, { hash: string }>();
  const rows = db.all<{ id: number; hash: string; head_counter: number | null }>(
    `SELECT id,hash,head_counter FROM audit_log WHERE head_counter IS NOT NULL ORDER BY id ASC`,
  );
  for (const r of rows) if (r.head_counter !== null) chain.set(r.head_counter, { hash: r.hash });

  let verified = 0;
  let highestCounter: number | null = null;
  const failed: Array<{ counter: number; reason: string }> = [];
  for (const a of anchors) {
    const local = chain.get(a.counter);
    const sigOk = verifyCheckpoint(
      a.pubkey,
      checkpointMessage({ entryHash: a.entry_hash, counter: a.counter, publicKeyB64: a.pubkey, kind: "head" }),
      a.sig,
    );
    if (!sigOk) {
      failed.push({ counter: a.counter, reason: "anchor signature does not verify" });
      continue;
    }
    if (!local || local.hash !== a.entry_hash) {
      failed.push({ counter: a.counter, reason: "anchor does not match a local chain entry" });
      continue;
    }
    verified += 1;
    highestCounter = highestCounter === null ? a.counter : Math.max(highestCounter, a.counter);
  }
  const maxLocal = rows.length ? rows[rows.length - 1]!.head_counter : null;
  const anchorLag = highestCounter !== null && maxLocal !== null && maxLocal > highestCounter;
  return { verified, failed, highestCounter, anchorLag };
}
