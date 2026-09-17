# XR — Migration Strategy (current XR → XR Desktop)

> Law: do not damage the engine. Tags: [RECOMMENDED].

## 1. Disposition table

| Area | Disposition |
|---|---|
| Core loop / execution / trust / security / state / cost / providers / intelligence / context / research / skills / plugins / mcp loaders / voice pipeline / automation | **REMAIN** untouched (engine); extend only via new routes/events |
| Daemon server + routes | **REMAIN**; adapt: pairing (SEC-04), PTY route (new), voice WS (new), event extensions; republish npm w/ mcp routes (BUG-001) |
| Dashboard (23 panels) | **WRAP → DEPRECATE**: keep as headless fallback + API playground; deprecation banner in P4; removal in 2.x after desktop GA parity matrix |
| TUI Shell | **REMAIN** first-class operator surface; glossary sync; brand lockup refresh only |
| CLI | **REMAIN**; add `xr desktop` verb (install/launch/pair) |
| VS Code ext | **REMAIN**; add xr:// deep links to Work |
| business routes/L0 | **MIGRATE**: finish ADR-0028 (satellite) or feature-flag OFF (SEC-05) in P5 |
| store.ts shim, runAgent alias, satellite shims | **DELETE LATER** at 2.0.0 (already scheduled [OBSERVED]) |
| Legacy-md skills (11) | **MIGRATE** to manifests (P3 tooling), keep loading until then |
| Brand SVGs | **REPLACE** geometry w/ unified canonical mark (keep files as legacy aliases one release) |
| npm `files` docs bloat | **REPLACE** packaging list (P1) |
| Website | **REMAIN**; marketplace feed parity w/ Library (P5) |

## 2. Backward compatibility guarantees
- `/api/v1/*` contract: additive-only during 1.x (api:compat gate heritage [OBSERVED]); desktop consumes generated client.
- Config/state/migrations: engine-owned; desktop never writes SQLite directly.
- CLI verbs: no removals in 1.x; deprecations follow announce→warn→migrate→remove (Art. XXVII heritage).

## 3. Cutover mechanics
1. P1–P3: desktop ships **alongside** (npm `xr desktop` + installers); dashboard unchanged.
2. P4: dashboard banner "XR Desktop is the primary experience"; feature-parity matrix published (surface × capability).
3. P5/GA: default `xr` on desktop OSes launches desktop (env var/headless keeps TUI); dashboard = `xr serve --headless`.
4. 2.x: remove dashboard panels, shims, aliases; keep daemon+API+TUI+CLI.

## 4. Risk register
| Risk | Mitigation |
|---|---|
| Parity gaps block cutover | parity matrix as CI-checked doc (capability × surface tests) |
| Engine refactor temptation | boundary CI: desktop pkg imports only generated client; engine PRs reviewed vs blueprint |
| State migration bugs | engine migrations already gated; add desktop-attach integration tests per migration |
| User confusion (two UIs) | single glossary + cross-links + deprecation banner timing |
| npm drift recurrence | tarball-invariant gate (Technical Audit) |

## 5. Rollback
- Desktop uninstall = engine untouched; `xr serve`/TUI/CLI unaffected at every phase (verified by consumer-smoke heritage).
