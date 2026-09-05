# XR Phase 7 — Research Notes (STEP 3)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


Principles adopted for XR, each verified against an external source and adapted (not copied) to a local-first single-user system. Sources were verified 2026-08-02.

## 1. TUF / The Update Framework — safe update & rollback

**Sources:**
- TUF is a CNCF-graduated framework "for securing software update systems … protect against key compromise, rollback attacks, and mix-and-match attacks" with four-role metadata (root, targets, snapshot, timestamp) and threshold signing + delegation. [1](https://github.com/api-evangelist/tuf) [2](https://apis.io/providers/tuf/)
- Attack coverage table: arbitrary package blocked by targets metadata; rollback blocked by version-number verification; freeze blocked by timestamp freshness; mix-and-match blocked by snapshot integrity; key compromise limited by role separation; slow retrieval blocked by size limits. [3](https://pavanmadduri.wordpress.com/2025/12/25/tuf-the-security-framework-protecting-billions-of-software-updates-from-supply-chain-attacks/)
- Root = trust anchor (defines keys for all roles, threshold signatures, rarely updated); targets = file inventory w/ hashes+sizes, delegation; snapshot = version consistency (prevents mix-and-match); timestamp = freshness (prevents freeze), checked first. [3](https://pavanmadduri.wordpress.com/2025/12/25/tuf-the-security-framework-protecting-billions-of-software-updates-from-supply-chain-attacks/)

**Principles adopted for XR (adapted to a local-first system — no multi-role repository):**
1. **Signed versioned metadata** for every capability update: the update channel ships `root` (trust anchor / key rotation), `targets` (per-capability file inventory: hashes + sizes), `snapshot` (pins every metadata version — mix-and-match protection), `timestamp` (freshness — freeze protection). All ed25519-signed with threshold support (default threshold 1; configurable for future multi-signer publishers).
2. **Rollback protection:** client persists last-seen metadata versions and refuses versions that regress below the highest seen (except explicit, re-signed downgrades by the operator).
3. **Freeze protection:** timestamp must be newer than `now − freshnessWindow` and must reference the snapshot the client actually validated.
4. **Mix-and-match protection:** target files' hashes must equal the snapshot's pinned hashes; metadata versions must equal snapshot's records; no mixing old targets with new snapshot or vice-versa.
5. **Arbitrary/endless-data protection:** metadata + target size limits.
6. **Reversible + workspace-safe application:** candidate staged beside the active capability; canary (manifest parse + contract tests) before switch; on failure, revert to prior version; the workspace store is only touched at the final atomic step.

## 2. Extension-marketplace trust (security map)

**Sources:**
- Real-world marketplaces are often "just a GitHub repository … no review, no signing, no central index"; packages can declare scripts with **default-allow** policy; an extension runs with the user's full permissions (read/write/spawn/network) — the blast radius of a first install is outsized. [4](https://devopsjournal.io/blog/2026/05/01/Copilot-extension-governance-concerns)
- VS Code: the Marketplace signs extensions on publish and the client verifies on install (integrity + source); a failed signature check yields explicit error codes and a "cannot verify" refusal; publisher trust prompts appear on first install. [5](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
- A "verified" badge is not a trust anchor: the verified symbol itself can be exploited; install from official channels only. [6](https://www.ox.security/blog/can-you-trust-that-verified-symbol-exploiting-ide-extensions-is-easier-than-it-should-be/)
- npm supply-chain reality: malicious packages (e.g., axios RAT incident) show in-process packages are a prime attack surface — treat in-process extensions like npm packages. [7](https://www.malwarebytes.com/blog/news/2026/03/axios-supply-chain-attack-chops-away-at-npm-trust)

**Principles adopted for XR:**
1. **Default-deny:** nothing is enabled on first install; permissions are requests, not authority; MCP servers are refused unless on a signed allowlist.
2. **Signed authorship + publisher verification:** capability packages carry an ed25519 signature envelope over the package digest; a local publisher key ring verifies authorship; "signed" and "publisher verified" are distinct signals.
3. **SBOM + capability statement + dependency locks:** manifests declare a bill of materials, the capability statement (what it does, tied to declared permissions), and dependency locks (id+version+hash) so updates cannot silently swap dependencies.
4. **Human-readable authority diff before enable:** the operator sees the delta (new permissions, changed data scopes, risk-tier change) before any enable/update is applied.
5. **Trust = provenance + behavioral + permissions + maintenance + outcomes; never popularity.** Downloads may inform but never dominate (weighted ≤ 5%).
6. **Independent evaluator verdicts:** XR's contract tests (`certification.ts`) are the evaluator; "xr-tested/verified" statuses come from the evaluator, not the author's self-label.

## 3. Provenance / composite trust signals

**Source:** composite trust = provenance + behavioral + credential + governance attestation; the independent evaluator is the trust anchor, not the author; capability-style manifests with explicit permissions/scopes. (General security literature, mirrored by TUF delegation + XR Constitution Art. XIV/XV; see also §10.2 of the Constitution: "Marketplace trust = signatures + provenance + tests + permissions + maintenance + outcomes — never popularity".)

**Adopted:** `EvidenceTrustScorer` fuses signature status, provenance completeness, contract-test evidence, least-privilege permissions, maintenance status, and outcome records into one explainable score; every component contributes only what it proves.

## 4. Business OS decoupling — modular-monolith extraction behind a stable contract

**Source:** modular-monolith extraction pattern (stable internal contract, effect-verification before graduation, default-exclusion until proven, reversible migration) — as codified by the XR Constitution Part Eight (Business OS Constitutional Decision) and Art. XVI; the Constitution itself cites the placeholder-bridge/simulated-decision defect as the reason.

**Adopted:** thin L0 contract in `src/core/business-l0.ts` (record/artifact/identity/audit over the existing single-writer store — no domain schema); `src/business/**` moves to `extensions/business-os/**` as an L5 governed extension; per-module effect-verification harness gates inclusion; unproven modules are default-excluded; user data lives in the same store before and after (reversible).
