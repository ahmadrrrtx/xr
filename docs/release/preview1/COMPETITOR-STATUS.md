# XR Preview 1 — where it stands next to the neighbours

Plan section 8. This is a **status comparison, not a marketing table.** It exists so the Preview 1
notes claim nothing a competitor cannot undercut, and so the owner can see the shape of the market
without a sales deck.

## How to read the evidence column

| Label | Meaning |
|---|---|
| **RUN** | We executed it on this machine and recorded the result. |
| **DOCS** | Taken from the vendor's/public documentation on the date shown, with the link. Not executed by us. |
| **UNKNOWN** | We looked and could not establish it. It stays unknown rather than becoming a guess. |

**No competitor product was installed or run here.** Every competitor row is **DOCS**. Every XR row
is **RUN**. That asymmetry is the honest position and it is the one thing to keep in mind: we know
our own product far better than the field, and this table cannot fix that.

Checked 2026-11-10. Versions move fast — treat these as a snapshot with a date, not facts.

## The comparison

| | **XR 1.2.0-preview.1** (ours) | **Hermes Agent + Hermes Desktop** | **Claude Code** | **OpenHands** |
|---|---|---|---|---|
| Current version | 1.2.0-preview.1 (**RUN**) | v0.19.0 per one 2026-09 source; **desktop public preview since 2026-06-02 at v0.15.2** (**DOCS**) | v2.1.319 (2026-11-06), v2.1.321 just noted (**DOCS**) | v1.37.0 (2026-11-06); Agent Canvas 1.35.0 (**DOCS**) |
| Licence | Open source, MIT-licensed | MIT (**DOCS**) | Proprietary | MIT (**DOCS**) |
| Shape | CLI + native desktop (Tauri) + daemon | CLI + Electron desktop + messaging gateways (**DOCS**) | Terminal + desktop/VS Code surfaces (**DOCS**) | Browser control centre + Python SDK (**DOCS**) |
| Desktop installers | Tauri bundles built in CI for Windows/macOS x64+arm64/Linux — **build verified, not human-launched** (**RUN**) | .dmg/.exe native; Linux still via terminal script (**DOCS**) | Yes (**DOCS**) | Browser-based, self-hosted (**DOCS**) |
| Bring your own key | Yes — 26 provider presets, sealed broker; ambient env ignored by default (**RUN**) | Model-agnostic: Nous Portal, OpenRouter, OpenAI, any compatible endpoint (**DOCS**) | Anthropic account/API; gateway controls (**DOCS**) | Your own LLM key on every tier (**DOCS**) |
| Sandbox / execution isolation | Tiered; **fail-closed on Windows where no isolated environment is wired** (**RUN**, runner 42707408342) | Five backends: local, Docker, SSH, Singularity, Modal; container hardening (**DOCS**) | Bash sandbox with mode options, prompts when it cannot run (**DOCS**) | Runs in a sandboxed runtime (**DOCS**) |
| Approval / permission model | Deny-by-default policy plane, per-action approval, unattended denial exits 4 (**RUN**, Linux + Windows) | Not established to the same depth from the sources read (**UNKNOWN**) | Multiple permission modes, manual default, deny/ask rules (**DOCS**) | Automation/session model; per-command policy not established (**UNKNOWN**) |
| Prompt-injection handling | Tool output scanned + framed as untrusted; **end-to-end test: injected instruction → shell request denied at approval, and again at isolation** (**RUN**) | "Built-in prompt injection scanning and credential filtering by default" (**DOCS**) | Not stated as a discrete control in the changelog read (**UNKNOWN**) | Not established (**UNKNOWN**) |
| Spend controls | Atomic budget governor, retry storms charged, per-step admission (**RUN**, mutation-proven) | Not established (**UNKNOWN**) | Cost reporting for admins, pooled budgets (**DOCS**) | Session caps on Teams; per-conversation budget not established (**UNKNOWN**) |
| Audit / tamper evidence | Hash-chained audit, tamper matrix mutation-proven, SQLite-write attacker assumed (**RUN**) | Not established (**UNKNOWN**) | Transcript recording of system prompt/tools (**DOCS**) | Not established (**UNKNOWN**) |
| Local model support | Working path proven against a local OpenAI-compatible server; **no local model benchmarked on this 2 GB box** (**RUN**) | Model-agnostic including local endpoints (**DOCS**) | Anthropic models (**DOCS**) | Any LLM key, including local (**DOCS**) |
| Ecosystem / scale signals | None claimed | ~219k stars, 321+ contributors, 19,932 skills entries (**DOCS**) | 487 release notes logged for 2026 (**DOCS**) | 92,608 stars, 500+ contributors (**DOCS**) |
| Public preview status | **This release.** Gate 8 of 10 green at week-1 close; desktop app not human-launched | Public preview since 2026-06-02 (**DOCS**) | GA | GA |

## What this table actually says

1. **They are further along on breadth and adoption; we are unusual on controls.** Isolated
   execution backends, permission modes and admin cost reporting are mature elsewhere. A
   hash-chained audit trail, a mutiny-proof budget governor and a documented fail-closed policy are
   where XR is doing real work — and they are the reason to ship *this* preview slowly rather than
   loudly.
2. **Three features are table stakes and we are behind, not ahead**: install-and-run desktop polish,
   messaging gateways as a first-class path, and ecosystem/skill breadth. These are roadmap, not
   preview claims.
3. **The honest risk is credibility, not capability.** A preview that says "8 of 10 gates green,
   desktop app not yet launched by a human, local models unmeasured" is trustworthy. The same
   product with those caveats dropped is not — and the field's changelogs show how fast claims go
   stale.

## What is deliberately missing from this table

- **No productivity or benchmark numbers.** None were run under controlled conditions; the plan
  forbids invented ones, and a made-up "faster by X%" is the fastest way to lose the reader.
- **No pricing comparison.** Tier and licence facts only, because pricing changes without notice and
  a wrong number here would be quoted back at us.
- **No feature-by-feature checklist of everything.** Only the axes where a difference changes a
  buying or trust decision.
- **No competitor installs.** Testing them properly means running each on the same corpus, which is
  a week of work and belongs after Preview 1. Labelling that "UNKNOWN" is more useful than
  pretending otherwise.
