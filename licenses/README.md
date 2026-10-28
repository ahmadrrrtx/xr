# Bun runtime notices

The unpublished npm candidate declares platform-specific `@oven/bun-*` packages
at version 1.4.2 as optional dependencies. They are obtained from npm during
installation; XR's own tarball does not contain the Bun binaries.

`bun-v1.4.2-LICENSE.md` is the upstream notice copied without modification from
<https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md>
(SHA-256 `b9caf52728691b4057e371232c221a132883198be2f3d2ddf92c90404c984b1a`).
Upstream identifies LGPL-licensed JavaScriptCore/WebKit and tinycc, plus other
linked libraries and embedded polyfills. The platform package's MIT metadata
alone is not a complete inventory of those components.

This notice is not a determination that all redistribution, notice, source,
relinking, or XR policy obligations have been met. Legal/owner review and an
explicit policy decision are required before release; the license gate
(`scripts/license-check.ts`) reports that review as outstanding until the
owner records the decision as `licenses/bun-v<version>-REVIEW-ACK.json`
(present, well-formed, version-matched, decision
`acknowledged-for-redistribution`, with `decidedBy`/`decidedAt` provenance).
Anything else — no file, a malformed file, or a version mismatch — fails
closed as review-required.

**Decision recorded (2026-10-28):** `bun-v1.4.2-REVIEW-ACK.json` — the
repository owner acknowledged redistribution of the 1.4.2 platform packages
as npm optionalDependencies (see that file for scope, provenance and the
obligations awareness). Replacing or upgrading Bun requires a fresh review,
which means a new ack file for the new version; the gate enforces this
automatically because the ack is version-pinned.
