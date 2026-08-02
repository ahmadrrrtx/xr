# ADR-0015 — TUF-style Capability Update/Rollback

- **Status:** accepted (Phase 7 · T2)
- **Owner:** capability ecosystem · **Review:** 2026-08-02

## Context
Phase-1 atomic updater protects the XR binary; plugin/skill rollbacks are
snapshot-based. Neither protected capability updates against rollback,
freeze, or mix-and-match attacks, and nothing verified update metadata
signatures. TUF (CNCF-graduated, verified 2026-08-02) defines the
protection model: signed versioned metadata (root/targets/snapshot/
timestamp), thresholds, freshness, monotonic versions.

## Decision
Adopt TUF *principles* (not a full multi-role repository — local-first):
`src/platform/capabilities/updates.ts` implements ed25519-signed metadata
with roles root/targets/snapshot/timestamp, threshold signing (default 1),
persisted last-seen state (`~/.xr/capabilities/tuf-state.json`), and
explicit protections:
- **rollback** — metadata versions must never regress below last-seen;
- **freeze** — timestamp freshness window (default 7d);
- **mix-and-match** — timestamp pins snapshot; snapshot pins targets
  (version + sha256 + length);
- **arbitrary package / endless data** — targets inventory + size limits.
- Root rotation requires ≥ threshold signatures from the PREVIOUS root.
Application stays workspace-safe: verification precedes the plane's staged,
reversible update; `xr capabilities update` shows the authority diff and
TUF gate before applying. Unsigned updates are refused unless the operator
explicitly opts in (`--allow-unsigned`).

## Consequences
- Updates are versioned, verified, reversible, workspace-aware (§10.4).
- The update gate is a library + CLI surface; the hosted/operated update
  repository remains Phase 10 (no claim otherwise).
- Local (directory) skill/plugin sources remain usable via explicit opt-in.

## Test
`test/capabilities/tuf-updates.test.ts` (12 tests: happy path; rollback,
freeze, mix-and-match, arbitrary-package attacks blocked; threshold;
rotation; endless-data; gate opt-in; state advance + replay; skill-plane
update+rollback round-trip; signature primitives).
