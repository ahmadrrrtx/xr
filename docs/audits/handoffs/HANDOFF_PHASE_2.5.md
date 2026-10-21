# HANDOFF — Phase 2.5 · CLI contract, onboarding & dev hygiene

**Phase:** 2.5 (Stage 2 — Fail-Closed Runtime & Honest Wiring)
**Findings closed:** `P1-4`, `P1-16`, `P2-15`, `P2-16`, `P2-17`, `§15#16`, `§15#21`
**Branch:** `main` (stage-2 chain) · **base:** `a30013c` · **close commit:** see tracker row 2.5
**Date:** 2026-10-18 (Asia/Karachi)

> This file is the durable handoff demanded by the phase brief: Base · Map · Mechanism ·
> Ownership · Next. Everything claimed here is spelled in full and is verifiable from the
> named tests; nothing is fenced.

---

## 1. Acceptance-criteria closure (A1–A12)

| # | Criterion | How met |
|---|---|---|
| A1 | Unknown global flags exit 2 before kernel/task work; `--` escape preserved | `flags.pendingDashes` (src/cli/flags.ts) catches unknown pre-head dash tokens — incl. `applyValue`'s new boolean return so `--nonsense-flag=x` joins the same class — and `router.ts` throws `usageError` (existing `usageError()`/`EXIT.USAGE`, id `usage`, exit 2) BEFORE version/help/kernel dispatch. After `--`, args go through verbatim; decideRoute treats a dashed head (only reachable via `--`) as task input. |
| A2 | `--nonsense-flag=x` class (`applyValue` ignores unknown names silently) | Same class — `applyValue` now returns `false` for unrecognized `--flag=value` names and the parse routes them to pendingDashes. Exit 2, name-shaped message (`unknown option: --nonsense-flag`). |
| A3 | `xr daemon` → precise exit-2 relocation to `xr serve` | `decideRoute` returns new `RouteKind: "daemon"` FIRST (before version/help/command/serve/task — so `daemon --help` relocates identically); router throws `usageError("\`daemon\` is not a command — start the local server with \`xr serve\`.", "Usage: xr serve [--port <n>] [--parent-pid <pid>] [--lan]")`. |
| A4 | Phase 2.4's `xr serve --lan` survives strict parsing | The catalog gains a declarative `flags?: string[]` (`CatalogEntry`); `serve` declares `["--lan"]` (matching its existing usage skeleton). Pre-head `--lan` is relocated to `rest` through the same router loop; serve-local validation (`assertServeArgs`) accepts only `--lan`, `--port [=]`, `--parent-pid [=]` — consumed by the same parser, no second `--lan` codepath. |
| A5 | Command-local options never rejected (no `xr skill --list` breakage) | Policy is explicit: dashes-after-a-positional pass through verbatim (proof test pins `["fix", "--yolo", "tests"]`). Only the ONE command this phase owns (serve) self-validates, against the same declared set. |
| A6 | Missing `desktop/` deps → guided setup, portable preflight | `scripts/typecheck-preflight.ts` runs before either `tsc` (wired into `bun run typecheck`), checks the REAL prerequisite `desktop/node_modules/typescript/package.json` (not any dir), prints exactly `cd desktop && bun install`, exits 3, installs nothing, no POSIX shell (`node:fs` ESM). Pure `desktopDepsReady(root)` export lets the test stage absence in a temp root — never touches a developer's real install. |
| A7 | Capability census = whole tree, honest counts | `scripts/ci-capability-gate.ts` walks every skills/<name> DIRECTORY: manifest skills AND legacy `SKILL.md` skills validated through `readSkillManifest` (its established frontmatter fallback — no bespoke parser), both scanned/certified and labelled by provenance kind (`xr-manifest`/`legacy-markdown` from `src/skills/adapters.ts`); plugins continue as before. Headline: `scanned 67 bundled capabilities (54 manifest skills, 11 legacy Markdown skills, 2 plugins)`. Neither-format directory → honest gate failure. |
| A8 | `bots/types` no-orphans: audit's [DERIVED] condition honored | `^src/bots/types\.ts$` appended to the existing documented "type-only contracts" family in `.dependency-cruiser.cjs` `pathNot` (the same family at :279-281; never a wildcard, never a new family). Warning reproduced first (762-module cruise, exactly 1), rationale comment recorded in-file, regression test pins the family shape AND that ≥10 type-only consumers still exist (the exception cannot outlive its justification). Zero-warning bar now: `✔ no dependency violations found (762 modules, 2480 dependencies cruised)`. |
| A9 | Ordinary daemon banner carries no token | Two-channel design in `src/daemon/server.ts`: `reveal = opts.revealToken === true \|\| process.env.XR_PRINT_TOKEN === "1"`. PRIVATE channel (--parent-pid sidecar / operator opt-in) prints the byte-stable legacy lines the Rust banner parser consumes (`engine_state.rs` — parser + its tests untouched by design). HUMAN banner prints token-free URLs + one honest recovery line (dashboard paste sign-in — the WCAG 3.3.8 paste form already first-class — or `XR_PRINT_TOKEN=1 xr serve` on a private terminal). auth-page.ts/openapi.ts copy brought to the truthful state. |
| A10 | Line-neutral | `size-gate` ROOT truth: tree **171,955 / 172,000** — **−42** vs the pre-phase measurement (171,997), i.c. a genuine REDUCTION, funded by the deduction census below. server.ts waiver bumped 874 → 879 with a dated Phase-2.5 reason; review date 2027-01-15 kept. |
| A11 | §15#21 engines.node only with settled evidence | Settled by three independent maintained statements: website downloads page ×3 `Node.js 20+`, CI node-version 20 (ci.yml) / 22 (release.yml), runnable proof `node bin/xr --version` under node v20.20.2 → printed `v1.1.0 (Graphite)`. Reconciled the stale spots (`bin/xr` header comment, `docs/SCREEN-BRIEFS.md`). No invented floor. |
| A12 | Fail-before proofs + regression tests | HEAD worktree (`a30013c`) + staged new tests: unknown-flags **8 fail**/4 pass; banner **5 fail**; metadata **3 fail**; onboarding **2 fail** (plus import-time absence); bot-types + capability-census **6 fail**; capability gate printed the bare `scanned 56`; boundaries printed the single no-orphans warning; live repro `xr --yolo` exit **0** / `xr daemon` exit **1** (silent task swallow). Post-fix: all green (34/34 new tests). |

**OUT constraints (all honored):** no workspace conversion (independent `desktop/` install kept by design) · command-local options untouched · no second `--lan` parser (catalog is the single source; serve's 2.4 parser consumes) · no token in logs/tests/docs/tracker/browser copies (tests assert only the reveal-gated expression placement − no literal tokens) · no dummy runtime import in bots/types (type-only exception, mechanized exactly as the audit prescribed) · `desktop/node_modules` never deleted as a test technique (temp-root staging only).

## 2. Mechanism map (paths & anchors)

- `src/cli/flags.ts` — `GlobalFlags.pendingDashes`, `seenPositional` tracker in the parse loop; `applyValue(): boolean` (false → pendingDashes when pre-head); post-head unknown dashes still verbatim into `args`.
- `src/cli/catalog.ts` — `CatalogEntry.flags?: string[]`; serve declares `["--lan"]`.
- `src/cli/route-decision.ts` — `RouteKind` extended with `"daemon"`; daemon check first; dashed-head ⇒ `task` (via `--`).
- `src/cli/router.ts` — pendingDashes resolution loop against `route.catalog?.flags ?? serve.flags`; daemon relocation; `assertServeArgs()` (allowlist: `--lan`, `--port`, `--parent-pid` both spellings); `revealToken: parentPid !== undefined` threaded into `serve()`.
- `src/daemon/server.ts` — `DaemonOptions.revealToken?: boolean`; single banner template, `reveal ?` ternaries on the three token-bearing rows (Dashboard/Chat/Token); test asserts every token-bearing banner line sits inside `reveal ?` scope.
- `src/daemon/auth-page.ts` — sign-in copy names the truthful recovery path (paste remains never blocked — WCAG 3.3.8 pinned copy kept).
- `src/daemon/api/openapi.ts` — bearerAuth description truthful; generated artifact + typed client regenerated, `api:compat` additive-only (0 breaking, 283 operations).
- `scripts/typecheck-preflight.ts` — new; `.dependency-cruiser.cjs` — one entry + comment; `bin/xr`, `docs/SCREEN-BRIEFS.md`, `package.json` — Node 20+ reconciliation.
- Tests: `test/cli/unknown-flags.test.ts`, `test/release/onboarding.test.ts`, `test/release/capability-census.test.ts`, `test/architecture/bot-types-contract.test.ts`, `test/daemon/banner.test.ts`, `test/metadata.test.ts` (34 tests).

## 3. Deduction census (line-neutral funding, −42 net src)

| File | Removed (dead export, zero referees corpus-wide) | Lines |
|---|---|---:|
| `src/util/fs-async.ts` | `listDirents`, `statPath`, `lstatPath`, `chmodPath` (+ now-unused type import) | −21 |
| `src/util/paths.ts` | `migrationLockPath` | −7 |
| `src/util/scan-cache.ts` | `countTree` | −4 |
| `src/util/child-channel.ts`-adjacent `src/util/fs-async.ts` | — (see row 1) | 0 |
| `src/providers/errors.ts` | `isNonRetryableProviderError` | −7 |
| `src/providers/fallback-chain.ts` | `executeFallbackChain` (+its docblock) | −20 |
| `src/providers/gateway.ts` | `GATEWAY_VERSION` | −1 |
| `src/providers/capabilities.ts` | `defaultCapabilities`, `knownSupportedLabels` | −10 |
| `src/context/types.ts` | `isConfidenceLevel` | −3 |
| `src/context/memory/types.ts` | `isSource`, `categoryIsInstruction` | −12 |
| `src/context/memory/acl.ts` | `principalRole`, `principalLabel` | −7 |
| `src/context/memory-scope.ts` | `isMemoryScopeKind` | −3 |
| `src/skills/manifest.ts` | `nearestSkillDir` | −4 |
| `src/skills/online-registry.ts` | `registryFileExists` | −3 |
| `src/plugins/types.ts` | `isPluginType` | −3 |
| `src/plugins/worker-protocol.ts` | `CAPABILITY_TIMEOUT_MS` | −2 |

Every candidate verified 1-reference (the definition itself) across `src/`, `test/`, `scripts/`, `website/`, `desktop/src` (incl. `.rs`) before deletion; `barrel export *` consumers checked; root+desktop typecheck clean after each batch. The removal was measured again at the end: src diff net **−42** (171,955 total, 45 under TREE_CEILING=172,000, which was NOT raised).

## 4. Gate battery at close

| Gate | Result |
|---|---|
| `bun test` | **4,511 pass · 19 skip · 0 fail** (4,530 tests, 419 files) |
| `bun run typecheck` (preflight + root + desktop) | 0 errors |
| `bun run boundaries` | 0 violations, 0 warnings (762 modules) |
| `bun run ci-capability-gate` | 67 scanned (54 manifest + 11 legacy + 2 plugins), no rejects |
| `bun run size-gate` | tree 171,955/172,000 ✓ · 18 waivers (server.ts bumped w/ dated split plan) |
| `bun run api:compat` | OK — no breaking changes (283 operations) |
| `bun run api:schema:check`, `client:check` | in sync (regenerated) |
| `bun run ownership:check` | in sync (210 areas) |
| `release:check` · `channel:check` · `changelog:check` · `claim-lint` · `placeholder-lint` · `desktop:sink-lint` · `platform:parity` · `website:marketplace` · `baseline:inventory` · `hot-path-lint` | all green (`baseline:inventory` regenerated = truthful current counts; routes 294→305 delta proven to pre-date this phase — src/daemon/routes has no diff vs base) |
| Desktop Rust (`engine.rs`/`engine_state.rs`) | untouched by design; cargo not present in this sandbox — CI lane covers |

Live smoke (shipping path): `--yolo`/`--nonsense-flag=42`/`--bogus serve`/`serve --bogus-flag`/`daemon`/`daemon --help` → exit 2 with structured usageError; `-- --dashed-task` → task/coder path; `xr serve --lan --port 0` boots with LAN banner; `xr serve` → redacted banner; `XR_PRINT_TOKEN=1 xr serve` → legacy private lines (1× `Token:`, 2× `?token=`); `node bin/xr --version` → v1.1.0 (Graphite) under node v20.20.2.

## 5. Research anchors (fetched during design)

- Unknown-option strictness is the established CLI convention with `error: unknown option` + nonzero exit — Claude Code docs/issues: <https://code.claude.com/docs/en/headless> (unknown-option error for unrecognized flags), <https://github.com/anthropics/claude-code/issues/3844> (`--` end-of-options separation for dash-leading task text), <https://github.com/cline/cline/issues/4566> (`error: unknown option '--system-prompt'`), <https://github.com/Yeachan-Heo/oh-my-claudecode/issues/3221> (same misparse class).
- Token-in-banner as a real leak class (scrollback, asciinema, agent transcripts) and the two-channel fix shape (status output token-free + explicit opt-in escape hatch): paniolo issue <https://github.com/curtisgalloway/paniolo/issues/196> and the merged fix <https://github.com/curtisgalloway/paniolo/pull/217> — Phase 2.5's two-channel banner independently matches that fix shape (XR_PRINT_TOKEN=1 as the documented operator escape).

## 6. What the next phase must NOT break

1. The catalog `flags` table is now the ONLY declared source for command-local options: if you add a local option to a NEW catalog command, declare it there (serve-local validation is the template), or your option is unrejected-but-undocumented.
2. `--` is the ONLY end-of-options escape; task text after it starts with a dash and lands in `kind: "task"` — do not reintroduce a `startsWith("-")` unknown-command branch.
3. `xr daemon` must keep relocating to `xr serve` with exit 2 — including under `--help`.
4. The private banner lines (`Token: <48hex>` + `?token=`) are a byte-stable contract with the desktop Rust banner parser. If Phase 2.6 changes them, it changes `engine_state.rs` + its parser tests in the SAME diff.
5. `XR_PRINT_TOKEN=1` is the documented recovery escape hatch; keep it out of general logs (it recovers the human flow).

## 7. Next (board order)

- **Phase 2.6:** P1-2 bots live (they consume `src/bots/types.ts` — the type-only exception remains justified), plus P1-12 research; fold P2-18 after Phase 2.5 (per owner's board order).
- Stage 2 gate evidence to refresh at stage close: live probe matrix row `--nonsense-flag exit 2` now passable via `test/cli/unknown-flags.test.ts` + `HANDOFF_PHASE_2.5.md`.
