# Audit Evidence Integrity (Phase 4)

**Status:** implemented · **Finding:** F-08 · **Scope statement:** this document
is the authoritative, honest description of what XR's signed audit chain does
and does **not** protect against.

## 1. What changed

XR's audit log is a SHA-256 hash chain: every entry is
`sha256({event, detail, prev, ts})`, linking back to a genesis seed. That makes
the chain **tamper-evident** — editing any single entry breaks a link, and
appends fail closed until an explicit, audited repair.

But a hash chain is only as good as the machine that verifies it. **F-08:** an
attacker who can write the SQLite database directly can *truncate the chain and
rebuild every link consistently*, recomputing all hashes. A full replay then
comes back green over forged history. Tamper-evident, locally — but forensically
weak against a full-DB attacker.

Phase 4 adds an asymmetric anchor:

- A **per-install Ed25519 keypair** is generated on first real boot and stored in
  the **existing** secret backends (`src/security/secrets.ts` — macOS Keychain /
  Linux secret-service / Windows DPAPI, with an AES-256-GCM file fallback). No
  new storage mechanism is introduced.
- The **public key is embedded in the chain** in an `audit.keyed` event. That
  event — and every chain **re-key** (`audit.rekey`) — is itself signed and
  starts a signed segment.
- Checkpoints are signed every N entries (default 256, env-tunable). The
  **latest signed head** is kept in a single-row `audit_head` table and is
  **re-signed on EVERY keyed append** over the latest entry's
  `{hash, counter, pubkey}` — so the tail between in-chain checkpoints is
  covered too, and a trimmed or rebuilt tail cannot rewind the head onto an
  older entry. (Before the 2026-09-05 CI repair, the head was refreshed only
  on the checkpoint cadence, which made an honest install inside the window
  fail its own `--crypto` verification with "head is stale".)
- `xr audit verify --crypto` replays the chain **and** verifies every Ed25519
  signature, checks counter monotonicity, and verifies the signed head.
- An **optional remote anchor** (`audit.anchor`, default **off**) pushes a
  redacted signed checkpoint to an operator-controlled sink, egress-gated
  through the same allowlist proxy as every other outbound request.

## 2. The exact threat model

### What the signature DOES protect against ✅

**Silent local rewrite by an attacker who has the database but not the private
key.** The F-08 attack — truncate the audit log, recompute the hash links,
replace the file — now fails:

- The attacker can rebuild consistent hash links, but the `audit_head` row
  carries an **Ed25519 signature over `{head entry hash, counter, pubkey}`**.
  Without the private key they cannot produce a valid head signature.
- If they delete the head row to hide the gap, verification reports
  **"signed head missing — a rebuilt/forged chain cannot restore it"**.
- If they sign with their own key, the signature does not verify against the
  on-chain public key.
- If they splice entries mid-chain, the per-segment **counter** (a contiguous
  `0,1,2,…` run) reveals the gap.

This is the "tamper-**resistant** (keyed)" claim, and its kill proof is the
tamper matrix case (b) running in CI
(`test/security/audit-crypto.test.ts`, `test/e2e-blackbox/audit-crypto.test.ts`).

### What it does NOT protect against ❌ (stated honestly)

| Attack | Mitigated? | Why |
|---|---|---|
| Single-entry edit / local tamper | **Yes** | hash-chain replay (pre-existing) |
| Wholesale truncate + consistent hash rebuild | **Yes** | signed head cannot be forged without the key |
| Replay/splice with a foreign key | **Yes** | signature won't verify against on-chain pubkey |
| Counter truncation within a segment | **Yes** | counter contiguity check |
| **Attacker who exfiltrates the private key** (full host compromise) | **No, by design** | whoever holds the private key can sign for this install. The local key is intentionally not a root of trust against a fully compromised host. |
| Malicious XR process / kernel-level rootkit | **No** | same privilege ring as the key store. |
| A user who intentionally destroys their own audit data | **No** | it is their machine and their key. |

The remote **anchor** raises the bar for the row that is NOT covered locally: to
forge history after an anchor, an attacker needs **both** the private key **and**
write access to the independent anchor sink.

### Offline-first preserved

The anchor is never a dependency for local verification. `xr audit verify
--crypto` works fully offline; an unconfigured or unreachable anchor only means
"no remote attestation," never a verification failure.

## 3. Egress gating (the anchor is safe to enable)

- `audit.anchor.enabled` defaults to **false** — a fresh install makes **zero**
  anchor network calls.
- An `https://` sink must be on `security.egressAllowlist` / `allowedHosts`. The
  PUT goes through `guardedFetch` (DNS-pinned, private-range blocked, redirects
  revalidated). An un-allow-listed sink is **audited and skipped — fail-safe,
  never fail-stop**; the run continues.
- `file://` sinks append a JSON-lines checkpoint locally (useful for
  air-gapped/cron-shipped setups). `s3://` requires an HTTPS connector (no SDK /
  credentials in scope) and otherwise refuses honestly.
- The payload is **redacted**: only `{counter, entry_hash, entry_id, sig,
  pubkey, anchored_at}`. Never audit content.

## 4. The commands

| Command | Purpose |
|---|---|
| `xr audit verify` | SHA-256 chain replay only (the pre-existing tamper-evidence). Exit 0/1. |
| `xr audit verify --crypto` | chain **+** Ed25519 signatures **+** counter monotonicity **+** signed head. |
| `xr audit verify --crypto --anchor` | also append-verify remote anchor records. |
| `xr audit verify --crypto-legacy` | accept an entirely unsigned (pre-keying) chain without a warning state. |
| `xr audit anchor` | push one signed checkpoint to the configured sink now. |
| `xr audit export-key <file>` | write the private key as an **AES-256-GCM, scrypt-passphrase-encrypted** backup (mode 600). Recovery for key loss. |
| `xr audit re-key --yes` | rotate the signing key: appends an audited `audit.rekey`; the **old segment stays verifiable** to the re-key point. |

### Exit codes (automation-friendly)

- `0` — verified (or legacy unsigned explicitly accepted).
- `1` — integrity failure: broken chain, bad signature, counter gap, missing/bad
  head. Treat history as potentially forged.
- `2` — **key unavailable** on a keyed install: the signed prefix and chain
  still verify, but new appends cannot be signed in this environment. Locate /
  restore the key or re-key.

## 5. Key-loss and re-key story

- The private key is held only in the OS secret backend (or the 600-perm
  AES-GCM file fallback). Back it up with `xr audit export-key` to a password
  manager or safe.
- If the key is lost, `verify --crypto` reports the honest **exit-2 limited**
  state — it never silently mints a replacement key (that would mask loss and
  fork identity). Re-establish with `xr audit re-key`, which writes an explicit,
  audited segment boundary. The evidence **before** the re-key remains
  verifiable under the old public key; evidence after is signed by the new key.
- Evidence produced **before first keying** is chain-only. It remains verifiable
  and is labeled as such (the `--crypto-legacy` posture). This is documented, not
  hidden: we cannot retroactively sign what was written before a key existed.

## 6. Storage / migration

Migration 7 (additive; the chain is never rewritten by a migration):

- `audit_log` + `head_counter INTEGER`, `sig TEXT` (both NULL on legacy rows);
- `audit_head` — the single signed head row;
- `audit_anchors` — append-verified anchor records.

Existing unsigned databases open unchanged, stay chain-verifiable, and key on
the next real boot (an audited `audit.keyed` event). Migration is reversible
(`runMigrationsDown`).

## 7. Claims, precisely

- **"Tamper-evident (locally)"** — true for all installs since the hash chain
  existed; verified by full replay.
- **"Tamper-resistant (keyed)"** — true from first keying onward, against an
  attacker who controls the database but not the private key.
- The signature is **not** a defense against a fully compromised host that holds
  the key; that gap is exactly what the opt-in remote anchor narrows.

Exit gate: both claims may be made **only** with the scope above. The proof is
the tamper matrix (case (b) — wholesale rebuild) in CI.
