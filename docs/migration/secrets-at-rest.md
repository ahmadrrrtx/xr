# Migration — Secrets file fallback encryption (plaintext → `XRG1` sealed)

**Applies to:** XR 7.1.0 (launch hardening; audit discrepancy D-1 / finding A-4)
**Scope:** the `~/.xr/.env` file fallback used for provider keys **only when no OS
secret backend is available** (headless Linux without `secret-tool`, minimal
containers, CI runners)
**Reversible:** yes — a legacy plaintext value is only ever rewritten after it has
been read and re-sealed successfully; nothing is deleted
**User action required:** none — migration is automatic and transparent

---

## Why this migration exists

When no OS secret backend is available, XR previously fell back to storing
provider API keys as plaintext `NAME=value` lines in `~/.xr/.env` (chmod 600).

An external audit described XR as having an "AES-256-GCM encrypted credential
vault". That claim was true of the business-integration `CredentialVault` (see
[`credential-vault.md`](credential-vault.md)) but **not** of this file fallback —
the fallback was plaintext. The audit ledger records this as discrepancy D-1.

A plaintext file chmod 600 is the weakest form of secret storage XR could ship:
any backup, accidental `git add`, container image layer, or partial file
exfiltration that included `~/.xr/.env` exposed live provider keys.

## What changed

Values in `~/.xr/.env` are now sealed with **AES-256-GCM**:

```
NAME=XRG1.<base64 iv>.<base64 auth tag>.<base64 ciphertext>
```

| Field | Purpose |
|---|---|
| `XRG1.` | Format marker, so sealed vs legacy plaintext detection is unambiguous and a future format can coexist |
| `iv` | Random 96-bit nonce, generated per value (writing the same value twice yields different ciphertext) |
| `tag` | GCM authentication tag — any tampering with the ciphertext fails decryption instead of returning garbage |
| `ciphertext` | AES-256-GCM payload under the per-install key |

The key is a **per-install 256-bit random key** generated on first use at
`~/.xr/secrets/.file-key` (chmod 600, inside the `secrets/` directory, chmod 700).
It is never logged and never leaves the machine.

The file itself starts with a header marking it as managed:

```
# XR secrets — values sealed with AES-256-GCM (per-install key in secrets/.file-key).
# Do not edit by hand; use `xr providers keys` / the onboarding wizard.
```

## Honest threat model

This change protects the secrets file **when it leaks without the key**:

- backups / sync clients / disk images that capture `~/.xr/.env` but not
  `~/.xr/secrets/.file-key`
- accidental commits of the `.env` file
- partial exfiltration of a single file

It does **not** protect against an attacker who can read the whole `~/.xr`
directory — they would read the key alongside the ciphertext. For that threat
class the OS backends remain the strong anchor (macOS Keychain, Linux Secret
Service, Windows DPAPI), which is why `xr doctor` still reports the `file`
backend as **warn** and recommends installing OS secret tooling. The fallback is
no longer the weakest storage XR could ship; it is now sealed-at-rest with an
explicitly documented ceiling.

## Behaviour with old files

**No user action is needed.** The first read or write after upgrade migrates
transparently:

1. Legacy plaintext `NAME=value` lines are parsed with the same rules the old
   parser used (first `=` splits name/value; value trimmed — exactly what older
   versions would have returned).
2. Every recovered value is re-sealed in `XRG1` form and the file is rewritten
   with the header.
3. The in-memory memo is populated with the recovered plaintext, so a running
   process is unaffected.

### Entries that cannot be decrypted are never dropped

If a sealed entry cannot be decrypted — e.g. the `.env` file was copied from a
**different** install whose `.file-key` is different — the entry is:

- carried through **verbatim** on every rewrite (it stays in the file, so
  restoring the matching key restores the secret), and
- surfaced as *absent* to readers, which behaves exactly like "key not set"
  (the provider is reported unconfigured; `xr providers add` re-seals a fresh
  value).

It is never silently deleted, and it never decrypts to garbage — GCM
authentication fails closed.

### A corrupt key fails closed

If `~/.xr/secrets/.file-key` exists but is not 32 bytes, XR **refuses to
continue** with an explicit error rather than overwriting it — overwriting
would permanently orphan every sealed value. Restore the key from backup, or
delete it and re-enter your provider keys (`xr providers add ...`); the sealed
values from the lost key are unrecoverable, by design.

## Downgrade note

If you run an XR version older than 7.1.0 against a migrated `~/.xr`, the old
version will read the `XRG1.…` ciphertext as if it were the key value. Re-enter
the affected keys (`xr providers add ...`) or restore a pre-migration backup of
`~/.xr/.env` to return to plaintext.

## Guarantees

- **No silent data loss.** Nothing is deleted. A value is only rewritten after
  its plaintext was successfully recovered; undecryptable entries ride along
  verbatim.
- **Tamper detection.** A corrupted ciphertext fails GCM authentication and is
  treated as absent — never as a wrong key silently failing later.
- **Idempotent.** A fully sealed file is left untouched; re-reading it performs
  no writes.
- **Exact round-trip.** Values migrate back byte-for-byte (subject only to the
  whitespace trim the legacy parser already applied), verified by test.

## Verification

The behaviour above is covered by `test/security/secrets.test.ts` — at-rest file
is ciphertext unrecoverable without the key, key is 32 bytes chmod 600, fresh
IVs per write, legacy plaintext migration, mixed sealed/plaintext migration,
foreign-key entry preserved verbatim, and removal keeps the file sealed:

```bash
bun test test/security/secrets.test.ts
```
