# Phase 12 · Shield / Trust Center — study notes

## Environment reality (sandbox)
- Branch `phase/12-shield` from `main @ 86d9743` (Phase 11 merged). bun 1.3.14 (`~/.npm-global`), no `cargo`/display → Rust is written to the house pattern and compile-checked by CI (cargo check + clippy `-D warnings` + `cargo test --lib`, Linux + Windows); UI verified in the browser dev-seam (Vite + Playwright) exactly like Phases 9–11.
- **`previews/03-shield-trust.png` does not exist** (repo `previews/`, `desktop/previews/`, uploads). Authoritative spec = SCREEN-BRIEFS §SCREEN 8 + the Phase 12 build brief + DESIGN-SYSTEM/THEME-SYSTEM. One reference mock is generated to `previews/implementation/phase-12/00-reference-mock.png` before coding (same call as Phase 11).
- The brief refers to a 368-line `screens/Trust.tsx`. It does not exist: the real file is `screens/Shield/index.tsx`, a 5-line `PlaceholderScreen`. Nothing to preserve there; everything worth keeping lives in the Phase 7 approval engine.

## What "XR Shield" already means in this repo (do not contradict it)
- **ADR-0027** — "XR Shield" is the *enforcement boundary*, not the host scanner: capability policy · action guard · trust lattice/placement · consent/approvals · network egress · execution+output integrity · signed audit evidence (7 components, `src/xr-shield/index.ts` facade). The desktop screen is the *window onto* that boundary; its vocabulary (decisions, risk tiers, rule ids, audit chain) follows the CLI's.
- **CLI audit evidence** (`src/security/audit-signer.ts`): SHA-256 hash chain = tamper-*evident*, Ed25519 checkpoint signatures = the asymmetric anchor. The desktop's Phase 12 chain is the first half only → UI must say **"hash-chained (Ed25519 signatures planned)"**, never "signed". `signature` stays `NULL`.
- Constitution citations that are real and relevant: **Art. IV.2** (degraded is never shown as success), **IV.4** (ambiguity denies — fail closed), **IV.5** (consent is never inferred), **IX** (isolation follows risk; every action attributable), **X** (honest degradation + repair path). `scripts/claim-lint.ts` gate 5 fails CI on citations of Articles the Constitution doesn't define — cite only these. (Art. VIII is Memory/Context, not "truth in pixels".)
- `release.manifest.json` prohibited/supervised terms (claim-lint scans README/SECURITY/website, not `desktop/`, but the copy rules apply anyway): never "100% secure", "unhackable", "zero-risk", "military-grade", "kernel-level isolation", "Provable Security", "certified", "guaranteed", "complete", "enterprise-grade", "production-ready".

## Existing code facts (studied)
- **Approval engine (Phase 7)** — `stores/approvalStore.ts` (pure queue + promise resolvers; `requestApproval(req)`, `decide(id, decision, newRule?)`, `activate`, `withdraw`, `rules`, `decisions`), `lib/approvalCore.ts` (types, `checkRules`, `ruleFromDecision`, copy), `lib/approvalEvents.ts` (surface API: `requestApproval()` = rule check → queue → bell/OS notification/toast/orb; `decideApproval(id,status,{remember,reason})` = the single decide path; `withdrawRequest`; `makeApprovalGate(signal)` for the mock provider). **Two entry points today:** chat goes through `approvalEvents.requestApproval`; the Brain (`brainStore.waitApproval`) calls the *store's* `requestApproval` directly (no rule check, no notification). Any Shield gate must therefore sit at the **store** level to be unconditional.
- **ApprovalModal** (`components/approvals/ApprovalModal.tsx`) — rendered once in `App.tsx` above every route; shows `activeId`; away-only auto-deny countdown (`xr.approval.autoDenyMs` dev override); Escape/backdrop → deny; `ApprovalInfo.tsx` rows (Skill/Action/Resource/BodyPreview/Risk/Justification) are reusable in cards.
- **mockLLM** approval scripts: email (medium), delete folder (high), write file (medium), shell (`shell-skill`, high). No low-risk approval exists → add one ("read file") so the auto-approve-low-risk policy has a visible effect. Denied path emits `tool_result {status:'error', output:'User denied…'}` — the gate's reason must flow through so a Shield block reads "Blocked by XR Shield".
- **Runs / Brain kill path (Phase 11)** — `runsStore.killAll(reason)` stops owned Brain streams silently, `applyCancelled(ids)` → status `killed`, `invoke('bulk_cancel_runs')`, toast. `RunSummary.errorSummary` is preserved across Brain projections (`upsertFromBrain`). → Emergency revoke calls `killAll('Paused by XR Shield emergency revoke')` and marks rows `killedBy:'shield'`.
- **Notifications** — `sendNotification({type,title,body,data})` writes the bell feed (+ OS notification when unfocused, policy-gated); `badgeLabel`. Bell items with `data.approvalId` get inline Approve/Deny (`NotificationItem.tsx`).
- **Orb** — `orbSetState(state)` with `AvatarState` = idle | listening | thinking | speaking | waiting-approval | error | sleeping. "Brief red blink" = `error` for ~1.2 s then back (no new state invented).
- **Shell** — `lib/nav.ts` already has `shield` (label "Shield", `ShieldCheck`, between Skills Store and Control Room — the GLOBAL SHELL brief fixes the order; not moved). Sidebar renders a static `BudgetDot` for budget → same slot pattern for the Shield status dot. Topbar title = NAV label; add a state dot after the title on `/shield`. `App.tsx` mounts `ApprovalModal` + Toaster above the router → paused banner + compromised modal mount there too.
- **Settings** — `settingsStore` has `privacy.redactPii` and `privacy.telemetry`; Privacy tab already shows "Egress proxy (Shield) … Not configured" with a Phase-12 stub toast. Shield's PII/data-sharing rows read/write the **same** settings keys (one store per concern). Primitives to reuse: `SettingsSection`, `SettingRow`, `Toggle`, `Segmented`, `ConfirmDialog`; `ui/alert-dialog.tsx` (Phase 11) for the emergency confirm (Radix focuses Cancel by default).
- **Brain tabs** — plain buttons with a 1.5 px accent underline (`brain/detail.tsx`); Shield tabs copy the look with `role=tablist/tab/tabpanel` + a Framer `layoutId` indicator.
- **Rust** — `commands/chat.rs` opens `xr.db` (app data dir, WAL, idempotent `CREATE TABLE IF NOT EXISTS`). `commands/approvals.rs` keeps remember rules in `approvals.json` (Tauri Store). `commands/runs.rs` = Phase 11 pattern for events (`app.emit`), save dialogs (`save_runs_export`) and unit tests. `Cargo.toml` already has `rusqlite` (bundled), `keyring`, `tauri-plugin-store`; **`sha2` is added** for the chain. No biometric plugin on desktop → `biometric_supported=false`, honestly.
- **Export** — `runsStore.saveText()` (Blob in browser, `save_runs_export` in Tauri) — reused through a new generic `save_shield_export`-free path: the Shield export calls the same Rust command (it is filename-agnostic).
- **Virtual list** — react-window 2.3.3 `List` (`rowComponent/rowCount/rowHeight/rowProps/rowKey/listRef`, `onRowsRendered`), ARIA roles on the wrapper (RunsTable).
- **Shortcuts** — screen-local `keydown` listener with the dialog-aware guard (RunsScreen lines 137–277); cmdk commands in `lib/paletteCommands.ts` (`openRoute()`), `pause-all-agents` is a Phase 13 stub (left alone), `clear-chat-history` says "ships with Shield (Phase 12)" → left for Phase 21/Memory, not in SCREEN 8 scope.
- **Tests** — `test/desktop/*.test.ts` (bun, relative imports of pure modules). Shield pure logic goes to `desktop/src/shield/core.ts` + `test/desktop/shield-core.test.ts`.
- **Themes** — `--success/--warning/--danger/--wait` exist per theme (contrast-tuned); `--accent-glow` is transparent in Paper/Arctic. Add `--risk-low/--risk-medium/--risk-high` (mapped per theme) + `--shield-glow` (1 in XR Native & Midnight, 0 elsewhere).

## Design decisions
1. **One gate, at the store.** `approvalStore.requestApproval` runs `runApprovalGate(req)` (registry in `lib/approvalGate.ts`, registered by `shield/enforce.ts`). The gate returns a synchronous decision for: Shield paused (`blocked`, "XR is paused — all actions blocked"), shell exec disabled (`blocked`), a *removed* quarantined skill (`blocked`), low-risk auto-approve policy (`auto-approved`, ruleId `policy.auto-approve-low`). Otherwise `null` → queue as before. `approvalEvents.requestApproval` detects "not queued" and notifies honestly instead of saying "needs approval". Brain's direct store call is covered for free.
2. **Audit = observer of the approval store.** `onApprovalEvent` (same registry) fires on gate decisions and on `decide()`; the Shield store writes the audit entry (+ history) from there, so **every** decision is audited whatever surface made it (modal, bell, Shield card, bulk, auto-timeout).
3. **Shield store is canonical for trust state**; approvalStore stays canonical for the pending queue (Shield reads it, never copies it). `paused`, `policy`, `status`, `audit`, `history`, `quarantine`, `healthRunning`, `compromisedModalOpen` live in `stores/shieldStore.ts`.
4. **Enforced vs Planned, honestly.** Enforced in this build: auto-approve low-risk, shell execution switch, quarantine new skills (quarantined skills always prompt at high risk and ignore remember rules; removed ones are blocked), PII redaction (masks emails/phones/cards in what the audit log *records* — visible today; provider calls arrive in Phase 14). Planned: egress proxy (lists persist, nothing is proxied), constitution strictness (persists only), biometric prompt (unsupported → "○ Unavailable", disabled), data sharing (no telemetry pipeline exists; switch mirrors Settings → Privacy and sends nothing either way). The tooltip on each badge says exactly this.
5. **Hash chain in both runtimes.** Rust: `shield_audit` table (append-only triggers), `prev_hash`/`entry_hash` SHA-256 over canonical fields, `verify_audit_chain` walks it. Browser dev-seam: same canonical string hashed with WebCrypto, kept in memory + localStorage (capped) so screenshots/e2e exercise the identical UI. Seed: 200 deterministic entries over 30 days (fixed PRNG), only past timestamps, `signature = null`.
6. **Compromised is never faked.** `state` is derived from the last *completed* health check: any fail in checks 1–5 → compromised; any warn → attention; fresh install before the first run → "Checking…" (no green until a check ran). Egress proxy and biometric honestly warn ("Not configured"/"Unavailable") → the default state is **attention**, not protected. Dev-only trigger forces a failing check for the modal (`import.meta.env.DEV`).
7. **Emergency revoke really stops things:** denies every pending request (decision `blocked`), `runsStore.killAll()` (Brain streams + Rust `bulk_cancel_runs`), sets `paused=true` so new requests are auto-denied by the gate, writes one audit entry, emits `shield:emergency-revoke`, and shows the app-wide red banner until "Resume agents" (confirm).
8. **Modal vs Shield list:** while the Shield Approvals tab is mounted the root modal yields (renders nothing; its away-countdown effect is also paused — the brief: no timer while the user is looking at the tab). Inline Approve/Deny call `decideApproval()` → the same promise the modal would have resolved.
9. **Bundle:** no new runtime deps in the webview (react-window, Shiki, Radix, Framer already present). Rust adds `sha2` only.

## Built (what shipped vs. the plan)

- Webview: `src/shield/{types,hash,core,seed,api,enforce}.ts`, one canonical
  `stores/shieldStore.ts`, `screens/Shield/*` (Status / Approvals / Audit Log /
  Security Settings), `components/shield/{PausedBanner,ResumeDialogHost,CompromisedModal}.tsx`.
  Enforcement hooks live in `lib/approvalGate.ts` + `approvalStore` (gate runs
  before any prompt; `blocked` outcomes are audited, never shown as a prompt).
- Rust: `src-tauri/src/shield/mod.rs` — `shield_audit` (append-only via
  BEFORE UPDATE/DELETE triggers), `ShieldDb` own connection on `xr.db`,
  `shield.json` for policy/paused/quarantine/last checks, commands
  `get_shield_status · get_audit_log · append_audit · verify_audit_chain ·
  run_health_check · set_security_policy · set_shield_paused · set_quarantine ·
  save_shield_checks · revoke_all · list_approvals`.
- Canonical hash input is the JSON array
  `[id, ts, actor, skill, action, resource, decision, ruleId, risk, cost(6dp), prevHash, detail]`
  — `serde_json::to_string(&[&str; 12])` and `JSON.stringify([...])` produce
  the same bytes. Cross-language vectors pinned in both test suites:
  `mulberry32(0x5a1e1d)` → `0.17755939578637481, …`; seed chain for
  `now = 1_700_000_000_000`: 204 entries, `hash[0] = 3f52655c…`,
  `hash[203] = 52a23b48…`.
- Honest copy: the chain is "hash-chained (Ed25519 signatures planned)";
  `signature` is always `null`; keychain unreachable is a **warning**
  ("compromised" is reserved for integrity failures of the audit db / chain).

## Verification

- `bun run typecheck`, `bun run lint`, `bun test test/desktop/` (121 tests)
  green locally; Rust compiles only in CI (`cargo check` / `clippy -D warnings`
  / `cargo test --lib`) — no toolchain in the sandbox.
- Playwright flows against the Vite preview: tabs + keys, inline approve/deny,
  bulk actions, audit filters/slide-over/Esc, chain verification after bulk
  parallel writes (serialised; stays intact), emergency revoke → banner →
  resume, compromised modal cannot be dismissed with Esc/backdrop, red wide
  toast renders at 560px. Screenshots: `previews/implementation/phase-12/`.
