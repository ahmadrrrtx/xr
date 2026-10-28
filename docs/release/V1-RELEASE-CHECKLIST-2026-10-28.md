# V1 Release Checklist (2026-10-28)

> Branch `work/v1-release-stabilization-2026-10-28`. Authority: the
> [ledger](V1-RELEASE-LEDGER-2026-10-28.md) (§7 = every verification row, with
> commands + exit codes) and the [feature matrix](V1-FEATURE-MATRIX-2026-10-28.md).
> This checklist is the operator-facing extract: what is DONE with evidence,
> what remains OWNER-SIDE, and the exact order of operations to ship V1.
> Nothing here may push, tag, publish, or touch protected `main` without
> explicit owner dispatch (Constitution; ledger §9 closure policy).

## 1. Engineering state (this branch, all evidence-dated 2026-10-28)

| Gate | Status | Evidence |
|---|---|---|
| Frozen-lockfile installs (root + desktop) | PASS | §7 #1–#2 |
| Release/channel/claim/placeholder lint battery | PASS | §7 #3–#6, #29 |
| Typecheck (root + desktop) | PASS | §7 #7, #25–#32 passim |
| Module boundaries | PASS | §7 #8 |
| Desktop build (`tsc && vite build`) | PASS | §7 #9, re-run during Phase 4 |
| Parity suite (55 segments, linux) | **5186 pass / 0 fail / 45 skip** at the Phase-0 baseline commit; RE-RUN REQUIRED at branch head before merge (§4 below) | §7 #16 |
| OS-sandbox + namespace suites (bwrap installed) | 9+38 pass | §7 #17–#18 |
| a11y suite (live Chromium) | 53 pass | §7 #19 |
| Mobile harness battery (web-push, lan-flow, offline) | 28/28 + 12/12 + push crypto | §7 #22–#26 |
| Rust shell `cargo check` (webkit2gtk-4.1, rustc 1.99.1) | PASS — first real compile evidence on this line | §7 #33 |
| Sidecar compile (bun → xr-engine-x86_64-unknown-linux-gnu) | PASS (116 MB, smoke-gated by the script) | Phase 4 log |
| Linux bundle (AppImage + .deb) | see §7 #34 (this environment: 2 CPU / 2 GB) | Phase 4 log |
| Size gate | PASS at TREE_CEILING <!-- XR:TREE-CEILING -->175,500<!-- /XR:TREE-CEILING --> (dated raises per ADR-0028 + D-6) | §5/D-6 |

## 2. What V1 fixed (defect ledger dispositions)

- **V1-P5-001 (P0)** — mobile companion could not talk to the real daemon;
  fixed daemon-side in 4 units (`7c2a92c6` → `83889dfd` → `e638f583` →
  `4ce055f1`), retested adversarially (lan-flow 28/28, offline 12/12,
  real-daemon e2e probe, cross-surface contract tests).
- **V1-P5-002 (P1)** — reference-daemon 403-wall weakness; FIXED (`0ef8acfb`).
- **V1-P5-003 (P2)** — bare `ERR_MODULE_NOT_FOUND` in `mobile:test`; FIXED
  (`tools/check-test-prereqs.mjs` prints the exact fix commands).
- **V1-P35-001 (P2)** — production toasts rendered the browser-default font
  stack; FIXED (`fontFamily: 'inherit'`), before/after computed-style evidence.
- **V1-ENV-001** — environmental skips converted to real evidence (bwrap,
  Chromium, Node 22) rather than waived.

## 3. Owner-side blockers (cannot be executed from this environment — do NOT
   mark done without their evidence)

1. **Windows NSIS/MSI + macOS DMG builds** — need native runners (CI:
   `desktop-app.yml` matrix). Never cross-claim from Linux logs.
2. **Signing + provenance** — `DESKTOP_SIGNING.md`; updater key provisioning
   (L-011): `TAURI_UPDATER_KEY` etc. must be owner secrets; the updater must
   then be verified END-TO-END against the staged channel (L-012).
3. **Live-provider legs** — first-run journey to a successful agent task,
   connector live-key split (tested vs unverified), live push delivery
   (APNs/FCM) from a real phone.
4. **Real-device mobile matrix** — Android/iOS browsers: installability,
   safe areas, keyboard, mic (voice tab M-04).
5. **Human-eye UI review** — the Phase-3.5 sweep shipped 39 PNGs
   (`previews/v1-3.5/`) + 5 mobile PNGs; a human should walk them (dark/light,
   populated data, long content).
6. **Publication** — merge (PR, not direct push), tag, channel promotion per
   `RELEASING.md` §3/§3b; never retag withdrawn v1.1.0; `channel:live` must
   assert bytes before any public promotion.

## 4. Before merge (run at branch HEAD, fresh environment)

```bash
bun install --frozen-lockfile                        # root
bun install --frozen-lockfile                        # desktop (cwd desktop/)
bun run ci                                           # full gate battery
bash scripts/parity-suite-runner.sh linux            # the suite authority
bun run typecheck && bun run boundaries
bun run mobile:test                                  # needs: npm --prefix tools install; node tools/build-daemon.mjs
npm --prefix mobile run build && npm --prefix mobile run typecheck
cargo check                                          # desktop/src-tauri (rustup stable; Debian cargo 1.85 is too old)
./node_modules/.bin/tauri build --bundles appimage,deb   # desktop/ (2 GB RAM min; CI has more)
bun run release:check && bun run channel:check
```

Every command's exit code goes into ledger §7 before the merge PR is opened.
If any gate fails, the merge does not happen (RELEASING.md: evidence-bound).

## 5. After merge (owner dispatch only)

1. Tag `v1.x.y` (never reuse v1.1.0 — withdrawn; see `WITHDRAWN.md`).
2. CI builds + signs all native targets; artifact manifest + SHA256SUMS.
3. `channel:live` verification, then promote public channels.
4. Post-release: `docs/release/<version>/` snapshot; ledger §9 closure.
