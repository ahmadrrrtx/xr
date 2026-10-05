# Phase 12 · Shield / Trust Center — implementation plan

Route `/shield` · branch `phase/12-shield` · spec: SCREEN-BRIEFS §SCREEN 8 + Phase 12 brief + IMPLEMENTATION-PLAN Phase 12.

## Files

### Pure core (unit-tested, no React/Tauri)
- `desktop/src/shield/types.ts` — `ShieldState`, `ShieldStatus`, `HealthCheck`, `AuditEntry`, `AuditDecision`, `AuditFilter`, `ApprovalRecord`, `SecurityPolicy`, `QuarantinedSkill`, defaults.
- `desktop/src/shield/core.ts` — canonical string + hash-chain helpers (`canonicalEntry`, `verifyChain(entries, hashFn)`), `deriveState(checks)`, `sortChecks`, `filterAudit`, `sortAudit`, `auditToCsv/Json`, `redactPii(text)`, `isValidHostname`, `normalizeDomains`, `statsFrom(entries, pending)`, `relative/format` helpers, keyboard map.
- `desktop/src/shield/seed.ts` — deterministic 200-entry audit seed over 30 days (mulberry32 PRNG), mock quarantined skills, default policy.
- `desktop/src/shield/hash.ts` — `sha256Hex` (WebCrypto, with a tiny pure-JS fallback for non-secure contexts/tests).

### Wiring
- `desktop/src/lib/approvalGate.ts` — registry: `setApprovalGate(fn)`, `runApprovalGate(req)`, `onApprovalEvent(listener)`, `emitApprovalEvent(kind, req, decision)`.
- `desktop/src/stores/approvalStore.ts` — call the gate in `requestApproval` (synchronous decision ⇒ resolve immediately, record decision, emit `gated`); emit `decided` from `decide()`; add `inlineSurface` flag.
- `desktop/src/lib/approvalEvents.ts` — handle the "gated" (not queued) path with honest notifications/toasts; `makeApprovalGate` returns `{approved, reason, blocked}`.
- `desktop/src/lib/mockLLM.ts` — denied/blocked output uses the gate reason; new low-risk "read a file" script; `tool_result` carries `blocked`.
- `desktop/src/lib/chat-db.ts` + `ToolCallCard.tsx` — `blocked?: boolean` on tool calls → red "Blocked by XR Shield" badge.
- `desktop/src/shield/enforce.ts` — registers the gate + audit observer, listens to `shield:emergency-revoke`, runs the orb blink for compromised, bell notifications ("Shield needs attention").
- `desktop/src/shield/api.ts` — Tauri/browser dual backend (`get_shield_status`, `get_audit_log`, `run_health_check`, `revoke_all`, `set_security_policy`, `verify_audit_chain`, `append_audit`, `decide_approval` bookkeeping, `list_approvals`, export save).
- `desktop/src/stores/shieldStore.ts` — the canonical trust store (brief §2) + selectors.

### Screen
- `desktop/src/screens/Shield/index.tsx` — header, tabs (1–4), URL `?tab=`, keyboard, slide-over host, banner-aware layout.
- `desktop/src/screens/Shield/components/`: `ShieldTabs.tsx`, `StatusTab.tsx` (hero, stat tiles, health card, recent activity, emergency card), `ApprovalsTab.tsx` (pending cards, bulk bar, approved/denied collapsibles), `ApprovalCard.tsx`, `AuditTab.tsx` (filter bar, virtualized grid, slide-over, empty/skeleton states), `AuditSlideOver.tsx`, `SecurityTab.tsx` (grouped rows, badges, domain lists, quarantine, health + emergency cards), `EmergencyDialog.tsx`, `shared.tsx` (StateIcon, RiskChip, DecisionDot, Badge, Card chrome).
- `desktop/src/components/shield/PausedBanner.tsx` — app-wide red banner + resume confirm.
- `desktop/src/components/shield/CompromisedModal.tsx` — non-dismissible overlay.
- `desktop/src/components/layout/Sidebar.tsx` — 6 px live status dot on the Shield item; `Topbar.tsx` — state dot after the title on `/shield`.
- `desktop/src/App.tsx` — mount banner + modal; `AppShell.tsx` — `initShield()`.
- `desktop/src/stores/runsStore.ts` + `brain/types.ts` + `RunsTable.tsx` — `killedBy:'shield'` → shield icon + "Shield revoked".
- `desktop/src/screens/Settings/tabs/PrivacyTab.tsx` — "Advanced security controls →" link, egress row → `/shield?tab=security`.
- `desktop/src/screens/Onboarding/StepAllSet.tsx` — "Review XR Shield" link.
- `desktop/src/lib/paletteCommands.ts` — Shield: open / run health check / review approvals.
- `desktop/src/styles/themes.css` — `--risk-*`, `--shield-glow` per theme; `globals.css` — hero breathing glow, pulse, wipe keyframes (reduced-motion safe).

### Rust
- `desktop/src-tauri/src/shield/mod.rs` — `ShieldState` (SQLite conn on `xr.db`, policy in `shield.json` store, `paused` flag), migration + append-only triggers, seed, commands listed in the brief, `verify_audit_chain`, unit tests (chain verify, tamper detection, state derivation, hostname validation).
- `lib.rs` — `mod shield;` + `shield::init(app)` + handlers. `Cargo.toml` — `sha2 = "0.10"`.

### Tests / docs
- `test/desktop/shield-core.test.ts` — chain verify + tamper, state derivation, filters/sort, CSV escaping, PII masking, hostname validation, seed determinism, keyboard map.
- `CHANGELOG.md` Unreleased entry; `docs/phases/12-shield-{notes,plan}.md`; screenshots to `previews/implementation/phase-12/`.

## Order of work
1. Tokens + core + seed + hash (+ tests green).
2. Gate registry + approvalStore/approvalEvents/mockLLM wiring (typecheck).
3. shieldStore + api (browser backend first) + enforce.
4. Screen: tabs shell → Status → Approvals → Audit → Security; banner, compromised modal, emergency dialog.
5. Cross-surface: sidebar/topbar dots, runs `killedBy`, tool card badge, palette, Privacy link, onboarding link.
6. Rust module + lib.rs registration.
7. Playwright pass (5 themes spot-check, reduced motion, keyboard), screenshots, gates (typecheck, lint, bun test, sink-lint), CHANGELOG, commit, push, PR.

## Acceptance (brief §15) → how it is verified
- Status/Approvals/Audit/Security tabs render + keyboard 1–4 → Playwright.
- Modal and inline card resolve the same promise → chat "send email" with Shield Approvals open, approve inline, chat continues.
- Revoke: pending denied, runs killed (Brain + Runs rows), banner, paused gate → Playwright sequence + audit entries.
- Chain: `verify_audit_chain` valid on seed; tampering a row (Rust test / core test) → invalid.
- Shell switch OFF → chat "run a shell command" tool card shows "Blocked by XR Shield" without a modal; ON → modal.
- Auto-approve low-risk ON → "read file" runs without a modal and logs `auto-approved`; OFF → modal.
- Export CSV/JSON of the filtered audit → file + "Exported N entries".
- Reduced motion: no glow/pulse/tween; a11y roles present.
