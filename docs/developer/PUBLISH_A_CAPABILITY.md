# How to publish a capability (sign / SBOM / permissions / dependencies)

Phase 7 · T4 — manifests carry real security, and XR is default-deny.
Follow this checklist for a plugin or skill you want others to trust.

## 1. Manifest basics (plugin: `xr-plugin.json`, skill: `xr-skill.json`)

- Declare **only the permissions you actually need** (least privilege).
  Wildcards (`"*"`, auto-approve markers) are REJECTED by the security
  scanner and block enable.
- Declare **tools as an allow-list** (skills): every name must exist in the
  runtime registry; `*` is refused at install (Art. XV).
- Keep the **description routing-safe**: no `Permissions:`, `tools:`,
  `system:`, or instruction-injection tokens. The security scanner rejects
  descriptions that try to hijack routing.
- Add the Phase-7 security fields (all optional, all recommended):

```jsonc
// plugin: xr-plugin.json
{
  "id": "acme/toolkit",
  "version": "1.2.0",
  "trust": { "sha256": "<pkg>", "treeSha256": "<tree>", "signature": "<base64 ed25519 over package digest>", "keyId": "acme-1", "reviewedBy": "acme", "reviewedAt": "2026-08-01" },
  "sbom": { "ref": "sbom.spdx.json", "format": "spdx-json" },
  "capabilityStatement": "Runs acme toolkit commands; writes only to its private data dir; no network.",
  "dependencyLocks": [{ "id": "acme/lib", "version": "3.1.0", "hash": "sha256…" }]
}
```

```jsonc
// skill: xr-skill.json
{
  "id": "acme/skill",
  "version": "1.2.0",
  "skillType": "executable",             // executable|connector|prompt-pack|knowledge-pack|experimental
  "tools": ["read_file", "web_search"],  // enforced allow-list
  "verification": { "level": "verified", "checksum": "sha256…", "signature": "…", "reviewedBy": "…", "reviewedAt": "…" },
  "sbom": { "ref": "sbom.spdx.json", "format": "spdx-json" },
  "dependencyLocks": [{ "id": "acme/lib", "version": "1.0.0", "hash": "sha256…" }]
}
```

## 2. Sign

- Sign the package digest with an ed25519 key; record `keyId`.
- Publish the public key out-of-band (your site, a key server, a
  well-known URL) so XR can verify authorship against the publisher key
  ring (`xr capabilities security <id> --strict` with the ring configured).
- Skill packages: `xr skills package <dir>` then attach the signature
  envelope (see `src/skills/signing.ts`).

## 3. Test yourself before publishing

- `xr capabilities certify <type:id>` — XR's contract tests (schema,
  authority honesty, package integrity, placement, context scope,
  durability, cleanup, compatibility). Certification status is the
  independent-evaluator signal; "xr-tested" comes from XR's evaluator, not
  your self-label.
- `xr capabilities security <type:id>` — the manifest-security posture.

## 4. Update metadata (optional but recommended for remote distribution)

Ship TUF-style signed metadata (`root/targets/snapshot/timestamp`, see
`docs/adr/0015-tuf-style-capability-updates.md`) so consumers get rollback/
freeze/mix-and-match protection. `xr capabilities update` verifies it
before applying.

## 5. After publishing

- Watch your maintenance status: "abandoned" capabilities are trusted less.
- Recorded outcomes (uses/successes) feed the evidence score — a
  capability that works and is used ranks higher, independent of downloads.

## Remember

- **Installation is never trust.** Popularity never dominates the trust
  score (≤ 5% nudge). What decides rank: signatures, provenance, tests,
  permissions, maintenance, outcomes.
- Prompt-packs are typed `prompt-pack` and are never presented as
  executable — typing is what keeps counts honest (Art. XV.2).
