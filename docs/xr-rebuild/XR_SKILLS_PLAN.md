# XR — Skills Library Plan (65 bundled + marketplace)

> Base: `skills/` 65 dirs (54 `xr-skill.json`, 11 legacy md), `src/skills/` 32 modules (loader, manifest, signing, verifier, permissions, tool-allowlist, marketplace backend/store/dependency-solver, download engine, search index, autolearn) [OBSERVED].

## 1. Product shape
Library→Skills = discoverable capability library: search (fuzzy+tags), categories (research/developer/creative/business/security/writing…), featured (official), recent, installed, enabled toggles.
- **Skill detail sheet:** description (plain language), publisher trust chip (official/signed/unknown), version, permission badges (tools required, network scopes, memory scopes, computer control), examples (runnable), compatibility chips (modes/os/providers), provenance (signature, source), health (last run status).
- **Run:** from sheet (prefilled composer) or palette ("run skill …") or Work pin chip.
- **Configure:** per-skill settings where manifest declares; enable/disable; uninstall (marketplace-installed).

## 2. Trust legibility (SEC-02)
- Install flow: permissions diff sheet (what it can touch) → sign/verify status → sandbox notes; manifest change after install → re-approve diff (pinning, same mechanic as MCP SEC-01).
- Legacy-md skills: badge "basic manifest — limited permission data"; migration tooling (`xr skills upgrade-manifest`, P3) to bring all 65 to manifest parity.
- Quarantine: verifier failure → auto-disable + Trust→Permissions entry.

## 3. Discovery aids
- Category rails from manifest categories; "skills for this task" suggestions engine-side (search-index [OBSERVED]) shown as pin chips in composer (progressive, never auto-run).
- Autolearn [OBSERVED] surfaced as "XR suggests saving this as a skill" (user-confirm draft flow), never silent.

## 4. New skills (APPROVED 2026-09-17, D-03 — PLANNED for P3)
1. `release_notes_writer` (changelog→notes; complements generate_readme/pr_description).
2. `dependency_upgrader` (safe upgrade runs w/ diff+tests; complements db_migrate/devops).
3. `a11y_reviewer` (WCAG review; complements ui/ux designers; matches own a11y gates).
4. `runbook_builder` (incident→runbook; complements incident_response/soc_analyst).
5. `data_dict_curator` (schema→data dictionary; complements db skills).
(Each maps to existing tool permissions only; no new backend capability required.)

## 5. Phasing
P3: library UI, detail sheets, run/config, badges, legacy flagging. P4: pinning/re-approve diffs, quarantine UX. P5: manifest upgrade tooling GA, suggestion chips v2, marketplace parity feed w/ website.
