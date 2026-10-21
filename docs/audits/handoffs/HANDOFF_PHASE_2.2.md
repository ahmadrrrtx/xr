# Phase 2.2 handoff — Strict write schemas (P1-6)

**Commit:** `9618afe6` on `stage-2` — `fix(api): reject unknown write fields on v1, report them on legacy (P1-6)`
**Patch:** `/home/user/git-patches-stage2/0002-fix-api-reject-unknown-write-fields-on-v1-report-on-legacy.patch`
**Date:** 2026-10-17 · **Branch base:** `70c13d2` (2.1)

## What changed

- **`src/daemon/routes/body-strictness.ts` (new, 56 LOC)** — `unknownFieldPaths(schema, raw)` / `declaredKeys(schema)`: descends declared `ZodObject` shapes and `ZodArray` elements (`[i]` paths), unwraps `ZodOptional/ZodNullable/ZodDefault`; **opaque by design**: unions, discriminated unions, records, maps, catch, any, unknown, and empty-shape bags are never descended (no false positives > completeness). Hard caps: 20 paths, depth 8; `try/catch` degrades to findings-so-far — a strictness failure can never 500 a request. Imports `z` from `"zod/v4"` (same specifier the schemas use — mixing breaks `instanceof`).
- **`src/daemon/routes/index.ts`** — `validateBody(ctx, meta, mount, opId) → {bad, ignored}` runs the walker after `safeParse` success: **v1** → 400 problem envelope (`errors[0].path` dotted, message: "Unknown field. {opId} accepts: {set}."); **legacy** → 200 + `x-xr-ignored-fields: a,b.c` (≤10, sorted, deduped) + `api.ignored_fields` audit event, until `LEGACY_SUNSET_ISO` = **2027-08-01**. Reads a body CLONE; GET/HEAD never gated.
- **Policy** — schemas.ts header comment rewritten (v1 rejects / legacy warns until sunset / responses stay loose); `docs/api/COMPATIBILITY.md` §4.1 documents the mount table + audit entries; CHANGELOG **Changed** entry names the reversal + sunset date.
- **Schema repairs (declared, never relaxed — found by the handler-read-vs-declared sweep):**
  - `BudgetSetRequest.autoFallback` (handler read it, schema didn't — the mismatch class that made `{"usd":50}` dangerous)
  - chat stream: `mode` (ask/agent/plan), `sessionId`, `model`, `provider`, `context` — HTTPS + SSE variants (VS Code extension sends these)
  - `OnboardingProviderRequest.setDefault` (desktop key save sends false)
  - NEW `CustomAgentImportRequest` + `agents.custom.import` routing: import ≠ create — round-trips the exported doc's echo fields (`schemaVersion/id/version/createdAt/updatedAt`, `constitution.destructiveApproval: z.literal(true).optional()`)
- **Census resolved:** 89 request schemas — 85 `z.looseObject` (response-compat posture, all touched request paths stay loose at the schema level; enforcement is at the runtime walker), 4 odds: `CustomAgentPatchRequest`, `DiscordChannelRemoveRequest`, `WhatsAppContactRemoveRequest`, `WhatsAppUnpairRequest`.
- **Generated:** `docs/api/openapi.json` (272 ops, regenerated — diff is additions only: the four schema repairs above; api:compat green) · `src/clients/daemon-client.generated.ts` (one type rename `CustomAgentInputRequest` → `CustomAgentImportRequest`, source-compatible).

## Evidence

- **Fail-before:** `git stash push -- src/` → `body-strictness.test.ts` 12 fail/8 pass (groups 1/3/4 + walker + legacy header); `budget-audit-null-regression.test.ts` 2 fail (pre-fix the typo'd body persisted a phantom all-null `budget.update` event — the literal bug). Post-fix: 20/20 + 2/2.
- **Live after-probe** (fresh daemon :3143, clean `XR_HOME=/tmp/xr-p22-after`): v1 `{"usd":50}` → 400 `errors[0].path=usd` + accepted set in message; legacy → 200 + `x-xr-ignored-fields: usd` + Link/deprecation headers; valid `{"perTaskUsd":5}` → 200 both mounts (persisted, audit confirms); semantic `{"perTaskUsd":-5}` → original-envelope 400 on both mounts, untouched by the new gate.
- **Gates:** root `bun test` **4,461 pass / 19 skip / 0 fail / 411 files** (TEST-BASELINE.json + README refreshed; commit field stays `ec672fe` = phase base) · typecheck ✓ · `bun run ci` **19/19** (typecheck, test, release:check, channel:check, claim-lint, placeholder-lint, desktop:sink-lint, platform:parity:check, changelog:check, baseline:inventory, ci-capability-gate, api:schema:check, client:check, api:compat, boundaries, size-gate, hot-path-lint, ownership:check, website:marketplace:check).

## ⚠️ Critical for the next phase (2.3)

1. **size-gate margin is 2 LOC**: tree **171,998 / 172,000** ceiling. Phase src/ budget ≤120 was consumed by +102 net. **2.3 (or any subsequent phase) MUST extract/move code before adding ~any new src/ lines** — the walker + validateBody changes are already maximally condensed. Do NOT edit TREE_CEILING/TREE files.
2. **Client sweep result:** desktop/website/mobile/vscode send only declared fields. Exception: **mobile `/api/v1/chat` sends `chatId/content` while the handler requires `message`** — a pre-existing broken pairing. Not a strictness rejection (message-missing 400 predates 2.2) → parked for **2.4** (mobile control path).
3. **api:compat quirk:** reported "0 compatible change(s)" despite added optional request fields — it diffs response/breaking shape only; harmless, but don't rely on it to flag additive request drift.
4. **Regeneration rule honored:** openapi/client diffs contain ONLY the four intended additions — anything else in a future regen diff = stop, revert, re-scope (2.2 stop rule #6).
5. Hygiene: stray untracked `mobile/bun.lock` deleted (no CI references mobile installs; deviation recorded in tracker).

## Research sources (accessed 2026-10-17)

- RFC 9457 §3.2/§4 — problem+json extension members incl. array `errors[]` explicitly permitted; 400-on-validation established → XR's 400 problem+errors envelope is conformant.
- Zalando REST API Guidelines — unknown request fields SHOULD NOT be silently ignored; 400 on the versioned surface.
- microsoft/api-guidelines (azure Guidelines.md) — unknown field for a given api-version → 400 (strict-per-version = mount-as-switch precedent).
- bjpirt/api-guidelines compatibility.md — same 400 rule + PUT symmetry rationale.
- CAMARA Commonalities #632 — strict-by-default WITH documented exceptions → precedent for the legacy warn-only window.
