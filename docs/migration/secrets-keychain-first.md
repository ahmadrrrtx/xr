# Migration — keychain-first secret storage (XR-LAUNCH-015/016/017)

**Applies to:** the release after 1.1.0 (launch audit Phase 4B)
**Scope:** provider API keys, channel tokens, the audit signing key and every other
secret XR stores through `src/security/secrets.ts`
**Reversible:** yes — the pre-migration file is kept (still sealed) until a later run
confirms every moved key in the OS store
**User action required:** none. `xr repair` runs the migration on demand.

## What changed

| Before | Now |
|---|---|
| Sync writes (`xr providers`, onboarding, `xr setup`) always wrote `~/.xr/.env`; the keychain write was fire-and-forget | Every write goes to the OS store **first** and is verified by reading it back; the file is written only if that fails |
| macOS put the key on `security … -w <value>` (visible in `ps`) | macOS sends the command line, key included, to `security -i` on stdin; Linux `secret-tool` and Windows PowerShell also read the key from stdin |
| `xr doctor` printed `linux-secret-service` even without `secret-tool` | The doctor reports an OS store only when its tool exists, and says where keys actually live |
| `~/.xr`, `xr.db`, `config.json` followed the umask (0755/0644) | `~/.xr` 0700, DB/WAL/SHM and config 0600; existing installs tightened on start |
| `xr uninstall --purge` left keychain entries behind | Purge deletes XR's keychain entries first and reports what it removed and what survived |

A names-only index (`~/.xr/secrets/index.json`, 0600) records which backend holds
each secret. It never contains values.

## Choosing the backend

| `XR_SECRET_BACKEND` | Behaviour |
|---|---|
| unset / `auto` | OS store first; sealed-file fallback when it is missing or refuses, announced once on stderr |
| `file` | Always the sealed file (explicit opt-in, no warning; the keychain is never touched, including by purge) |
| `keychain` | Strict: a write that the OS store refuses fails instead of falling back |

## The migration

It runs at daemon start (`xr serve`, the desktop app's engine) and in `xr repair`:

1. Every entry in `~/.xr/.env` is copied into the OS store and read back.
2. Verified entries are removed from `.env`. The file as it was is kept at
   `~/.xr/secrets/.env.pre-keychain-<timestamp>` (0600, still AES-GCM sealed).
3. A later run deletes that backup once every key it covered reads back from the
   OS store. While it is unverified no further moves happen and `xr doctor`
   shows the backup path.
4. Once, keychain entries written by older versions without touching the file
   are found (Secret Service and DPAPI are enumerated; macOS is probed by the
   ids XR writes) and indexed.

Names, never values, are logged to `~/.xr/logs/secrets-migration.log`.

**Rolling back by hand:** copy the backup over `~/.xr/.env` and set
`XR_SECRET_BACKEND=file`. The file key in `~/.xr/secrets/.file-key` is never
deleted by the migration.

## Known limits

See rows #22–#24 of the [known-limitations register](../security/KNOWN_LIMITATIONS.md).
In short: without a working OS store the fallback key sits beside the data; Windows
permissions rely on profile ACLs; macOS purge cannot enumerate unknown names; the
macOS and Windows backends are verified with mocked processes, not on real hardware.
