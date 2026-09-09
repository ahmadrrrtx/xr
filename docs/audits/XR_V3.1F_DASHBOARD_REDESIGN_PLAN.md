# XR — REDESIGN PLAN (design document · no implementation yet)

**Goal:** turn XR into "OpenClaw-level usability or better" **without** diluting its differentiators (BYOK, enforced approvals, spend caps, tamper-evident audit, local-first).
**Strategy:** *Truth first, then structure, then delight.* Every phase is independently shippable and reversible; no big-bang rewrite.

---

## Phase 0 — STOP THE BLEEDING (1–2 weeks · correctness & truth)

*Goal: nothing on any surface lies, dies silently, or reports success without effect.*

| # | Work | Bug IDs | Exit criteria |
|---|---|---|---|
| 0.1 | npm launcher: link `bin/xr.cjs` (Node-safe, Bun-detect, install hint); republish 1.0.1 | P0-1 | `npm i -g` works on Node-only machine |
| 0.2 | `--yes` assume-approve path through the durable store (audited, risk-tier floors); fix non-TTY TTL copy | P0-2 | `xr --yes` performs gated actions; tier2 still blocks |
| 0.3 | Pass `args` at every `ctx.approve` call site; preview shows real diffs; `argsHash` real | P1-1 | contract test: every requiresApproval tool sends args |
| 0.4 | Kill/hide fake panels: Business CRM, Webhooks, Devices; fix bento "MCP Healthy", "Computer Use Authorized · Jarvis", runtime ports | P1-7 | grep-rule: no literal metrics in panel templates |
| 0.5 | Fix audit panel `created_at`; wire or remove MCP panel routes | P1-5/6 | panels render live data |
| 0.6 | Exit-code contract + unknown-flag rejection + `--max-tokens` documented | P1-3/12 | `xr ask` fails non-zero; `xr --bogus` exits 2 |
| 0.7 | Custom-provider pricing field + `priced:false` warning that fails closed on budget | P1-2 | unpriced non-local provider cannot silently bypass USD cap |
| 0.8 | Test isolation: re-exec with `XR_TEST_HOME`; sentinel test guards real `~/.xr` | P1-8 | `bun test` leaves HOME untouched |
| 0.9 | Secret backend honest display; document file-mirror | P1-9 | status never claims secret-service without it |
| 0.10 | npm: deprecate 3.x line or resume numbering; README stamp parity | P1-10/16 | one stable line |
| 0.11 | VS Code: port 3141 default (or autodiscover), implement Ask via /api/v1/chat | P1-11 | extension connects & asks out of the box |
| 0.12 | `xr update` no-op guard; session-title sanitization; `tsconfig` stale exclude; `cron add` copy fix | P2 set | — |

**Phase 0 ships as 1.0.x.** No IA changes yet — trust repair only.

---

## Phase 1 — ONE TRUTH (2–3 weeks · the model story)

*Goal: one answer to "what runs my tasks, and what does it cost?"*

1. **RoutingDecision record + service** (ARCHITECTURE_AUDIT §3.2): persisted per workspace; user action or router writes it; every surface renders it.
2. **ActiveModelCard component** (CLI status line, TUI status bar, dashboard header, chat composer): provider · model · tier · priced? · one-sentence why · "Change (⌘K)".
3. **Model picker v1** (palette-first): local (autodetected), cloud presets (live price), custom URLs; one-click test; strategy as plain options: *Prefer local · Prefer cloud · Exactly this*.
4. Demote `xr providers`/`xr models` output to the decision record; `xr providers explain` keeps the debug detail.
5. Dashboard header stops rendering raw `defaults.provider`; contradiction structurally impossible.

**Exit criteria:** on a fresh install, all four surfaces show the same provider+model+why. Screenshot test pins it.

---

## Phase 2 — THE SEVEN AREAS (3–5 weeks · dashboard IA)

*Goal: 26 panels → 7 areas; every panel truthful.*

1. New nav: **Chat · Runs · Extensions · Guardrails · Memory · Workspaces/Files · Settings** (grouped, collapsible; palette is the fast path).
2. **Runs**: merge Sessions + execution; RunView (status, timeline, cost, artifacts, approvals, receipt link, resume/branch).
3. **Extensions**: one marketplace over skills/plugins/MCP (+capabilities as the index); kind badges; one permission dialog; one enable/quarantine switch; delete four separate panels.
4. **Guardrails**: Approvals (queue + history + allow-always rules from the durable store), Spend (live meters, unpriced warnings), Audit → **Receipts** (per-run grouping; system-event noise filtered by default), Host Safety (Shield tabs), Advanced (trust/isolation) collapsed behind opt-in.
5. **Memory**: merge memory + context surfaces; "what the model sees" tab.
6. Chat: default mode `agent`; mode segmented control; right-rail **activity timeline** for the live run; approval cards inline (Yes / Yes-always(scope) / No / Edit); receipts attached to messages.
7. Onboarding becomes the landing when `needsSetup` (API exists); four steps: model → test call → budget → chat.
8. **Client rebuild (incremental):** dashboard JS moves to modules built with a bundler, consuming the *existing generated typed client*; contract tests per panel; external cached assets; drop 1.25MB inlined art (SVG logo); gzip; paginate `/api/skills`, `/api/capabilities`.
9. Delete: Business/Webhooks/Devices/Alerts-as-panel/Voice-as-panel (→ Settings), Downloads (→ Guardrails tab).

**Exit criteria:** ≤7 nav areas; zero panels without live API data; first load < 300KB; axe suite green in CI (unskip browser tests).

---

## Phase 3 — SURFACE PARITY (2–4 weeks · CLI/TUI/Telegram/IDE)

1. CLI: default help = quick start; `--all` for the system map; verb unification (`add/remove/list` for extensions, `create/pause/resume` for triggers); error template (What/Why/Next) for every command incl. zod failures; `xr help --exit-codes`.
2. TUI: skip single-workspace modal; `/` palette parity; ActiveModelCard in status bar; run timeline view reuses RunView.
3. Telegram: render ApprovalView/RunView (it becomes a remote Guardrails surface — remote approve is a genuine differentiator).
4. VS Code: ActiveModelCard status item; Ask XR via chat API; approvals surfacing in IDE notifications.
5. Terminology pass across all surfaces (single name for the dashboard; kill "Jarvis/Dojo/Bento/EDR/⌁" copy); i18n strings updated where they exist.

---

## Phase 4 — DEEPER UNIFICATION (ongoing · engines under the seam)

1. Product-services seam hardening (RunService/ExtensionService/etc. become the only import surface for UIs; dependency-cruiser rule added).
2. Capabilities index becomes the Extension index (single source); skills/plugins/MCP register into it at load.
3. `workspace-store.ts` split along existing repo seams; audit event classification (system vs task) with default-filtered system noise.
4. Satellites: finish removal of shims/panels/docs references; `docs/historical` moves out of the npm package.
5. Progressive-delegation data: approval patterns → suggested allow-always rules (argsHash now real).

---

## Guardrails for the redesign itself

- **IA budget in CI:** max 7 nav areas, max ~12 verbs in default help, no panel without a live endpoint, no literal metrics in templates.
- **Truth tests:** screenshot/contract tests pin ActiveModelCard parity across 4 surfaces.
- **Keep the trust plane frozen** (behavior-level regression suite already exists — extend, don't rewrite).
- **Each phase ships behind flags** where behavior changes (chat default mode, nav restructure) with a one-release deprecation window.
- **No net new concepts:** any new UI noun requires deleting an old one (concept-budget review in PR template).

## Success metrics (how we'll know it worked)

| Metric | Today | Target |
|---|---|---|
| First-run success (Node-only machine) | ~0% (Bun error) | >95% |
| Time from install → first successful tool-using run | unmeasured (blocked) | <5 min |
| Simultaneous answers to "which model?" | 6 | 1 |
| Dashboard nav areas | 26 flat | 7 grouped |
| Dashboard first load (uncompressed) | ~2.1MB | <300KB |
| Panels with dead/fake data | 9 | 0 |
| Approvals present structured args | never | always |
| `--yes`/headless correctness | silent no-op | audited auto-approve within tier floors |
| Test suite pollutes real HOME | yes | never (sentinel-enforced) |
| a11y suites running in CI | skipped | green |

---

### Sequencing summary

```
Phase 0  TRUTH     ── fix lies & broken doors (1.0.x)        [weeks 1–2]
Phase 1  ONE TRUTH ── RoutingDecision + ModelCard (1.1)      [weeks 3–5]
Phase 2  STRUCTURE ── 7-area dashboard + client rebuild (2.0)[weeks 6–10]
Phase 3  PARITY    ── CLI/TUI/Telegram/IDE render the same   [weeks 11–14]
Phase 4  DEPTH     ── extension index, store split, delegation [ongoing]
```

**Do not implement yet.** Approve/adjust the plan first; Phase 0 items are independently mergeable the moment they're approved.
