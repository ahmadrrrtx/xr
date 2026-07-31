# Migration — Credential vault format (pre-7.0.1 → v2)

**Applies to:** XR 7.0.1 and later
**Scope:** business integration credentials stored in `biz_credentials`
**Reversible:** yes — nothing is deleted or overwritten unless the plaintext was recovered

---

## Why this migration exists

Before 7.0.1, `CredentialVault` derived its AES key in the constructor from a salt it immediately
threw away:

```ts
const salt = randomBytes(SALT_LENGTH);          // never persisted
this.encryptionKey = scryptSync(masterKey, salt, 32);
```

Because the salt was not stored with the ciphertext, **every process start produced a different
key**. A credential written before a restart could never be decrypted after it. The stored records
are, in the general case, permanently unreadable.

This was not a theoretical risk: it affected 100% of stored business credentials on every restart.

## What changed

Records are now self-describing and use envelope encryption:

```
v2:<salt>:<iv>:<tag>:<wrappedDEK>:<dekIv>:<dekTag>:<ciphertext>
```

| Field | Purpose |
|---|---|
| `v2` | Format version, so detection is unambiguous and future migration is possible |
| `salt` | Per-record scrypt salt, **persisted with the record**, so the key is reproducible |
| `wrappedDEK` | A random 256-bit data key, encrypted under the key derived from your master key |
| `iv` / `tag` | AES-256-GCM nonce and authentication tag for the payload |
| `dekIv` / `dekTag` | Nonce and tag authenticating the wrapped data key |

Envelope encryption means the master key can be rotated by re-wrapping each data key, without
re-encrypting payloads and without any window where plaintext is written to disk.

## Behaviour with old records

Legacy `iv:tag:ciphertext` records are **detected and refused**, not guessed:

```
CredentialVaultError: credential is stored in the pre-7.0.1 format, which did not persist
its KDF salt and cannot be decrypted. Run the credential-vault migration
(see docs/migration/credential-vault.md) or re-enter the credential.
```

Refusing is deliberate. Attempting to decrypt with a freshly derived key would either throw from
deep inside OpenSSL or — worse — appear to succeed and return garbage.

## How to migrate

### Check your exposure first

```ts
const vault = new CredentialVault(db, masterKey);
console.log(vault.legacyRecordCount());   // how many records are affected
```

### Case A — you have the original derived key

Only possible if you captured it out-of-band (it was never written to disk).

```ts
const report = vault.migrateLegacyRecords(originalDerivedKey);
console.log(report);
// { scanned: 12, migrated: 12, alreadyCurrent: 0, failed: [] }
```

Each record is decrypted with the old key, re-encrypted in v2 format, and written back. The
operation is **idempotent** — re-running it reports `alreadyCurrent` and changes nothing.

### Case B — you do not have the key (the common case)

The credentials are unrecoverable. Re-enter them:

```bash
xr business credentials list      # see what is stored
xr business credentials add ...   # re-enter each one
```

Calling `migrateLegacyRecords()` without a key is still safe and useful: it reports each record as
`failed` with the reason and **leaves the row untouched**, so you get an inventory without any risk
of data loss.

## Rotating the master key

```ts
const result = vault.rotateMasterKey(newMasterKey);
// { rotated: 12, failed: [] }
```

After rotation, records decrypt with the new key and **not** with the old one — verified by test.

## Guarantees

- **No silent data loss.** Nothing is deleted. A record is only rewritten after its plaintext has
  been successfully recovered.
- **Tamper detection.** A corrupted payload or a corrupted wrapped key fails GCM authentication and
  raises `CredentialVaultError` instead of returning partial output.
- **Idempotent.** Safe to run repeatedly.
- **Reversible.** Because migration only ever rewrites a record whose plaintext was recovered, you
  can restore a database snapshot and be exactly where you started.

## Verification

The behaviour above is covered by `test/phase0/credential-vault.test.ts`, including the
write → restart → decrypt effect test that the old implementation cannot pass:

```bash
bun test test/phase0/credential-vault.test.ts
```
