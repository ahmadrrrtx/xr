# Phase 2.4 · P1-1 — Mobile & LAN control path (wire + prove) — HANDOFF

Date: 2026-10-18 · Branch: `stage-2` (rebuilt chain, see journal)

## What shipped (one landing commit atop @4603e75)

**`xr serve --lan`: the explicit, fail-closed mobile LAN server.** Wire, protocol, proof:

1. **LAN/TLS wire (+CLI wiring).** `src/cli/serve-lan.ts` (67): `prepareLan(port)` mints/reuses a
   self-signed P-256 LAN cert (`src/daemon/lan-tls.ts`, 359 — zero-dep DER writer; SANs = LAN IPs,
   hostname, `.local`, `xr.local`) and warms the VAPID pair, then installs the QR renderer against
   the optional `qrcode` dependency via the daemon's `setQrRenderer` seam. `src/cli/router.ts`
   threads `--lan` through; cert/VAPID failure exits non-zero (never an insecure fallback dressed
   as LAN). `xr serve --lan` binds `0.0.0.0` with TLS *only after* material prep; the shipping
   `serve()` in `src/daemon/server.ts` stays the ONE daemon (unified `Bun.serve` with conditional
   `...(lanRuntime ? { tls } : {})`), and prints `printLanBanner` (banner carries the fingerprint +
   pairing URL, never token material). `--lan` is flag-only: the `XR_DAEMON_LAN` env was removed —
   LAN is too loud to switch on by accident.
2. **Pairing protocol.** `src/daemon/mobile-pairing.ts` (392): 6-digit codes (10-min TTL, single
   use, 10 attempts/min/peer via the strict pairing limiter, generic 401s), paired sessions in an
   `xr_session` cookie (`HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`), device registry
   (`mobile-devices.ts`, 147 — tokens stored as SHA-256 hashes), revocation rotates the hash
   server-side. Session context: `MobileContext { lan, fingerprint, lanUrl,
   version, daemonToken }` threaded from the boot, with `lanUrl` finalised in place *after* the real
   bind so a pairing URL never advertises `:0`.
3. **Auth seam + §15#10.** `server.ts` (874): at the EXISTING seam — bearer/desktop-cookie →
   `desktopPrivileged` (mirrors `resolveSession`'s rule; never a bearer bypass); otherwise a
   paired-device cookie → `kind:"mobile"`; anonymous `/api/mobile/*` falls through with per-op roles
   (the TOFU fingerprint GET stays public; everything else returns its documented 401/403). The
   loopback bootstrap cookie is **unchanged**; LAN-TLS bootstrap gains `; Secure` (§15#10: Secure
   iff the listener is TLS). `XR_DAEMON_TOKEN` is the operator channel for the daemon token in LAN
   mode (nothing ever prints token material there).
4. **403 wall (canonical).** `mobileGate` runs before any handler effect on the *canonical* path —
   files/terminal/git/mcp 403 for paired mobiles on BOTH mounts, so the legacy unversioned form
   cannot slip a device past the wall.
5. **Routes through the ONE router.** `src/daemon/routes/mobile.routes.ts` (34) + `schemas-mobile.ts`
   (27) + `contract-mobile.ts` (22): 11 ops (`cert-fingerprint`, `pair`, `session delete`,
   `devices list/revoke/push-test`, `pair-qr`, `push vapid-pubkey/subscribe/test`) registered like
   every other route group — canonical mount → Phase-2.2 body validation → registry/OpenAPI/client
   (`ApiOperationMeta.public?: true` → OpenAPI `security: []` for the TOFU fingerprint only;
   `openapi.ts` one-liner). Off-LAN the group answers 404 "LAN mode is off" — nothing is exposed.
6. **Push.** `web-push.ts` (276): VAPID/JWT + RFC 8291/8188 aes128gcm + an inner AES-GCM layer
   keyed by the device-generated pairing key — push services relay ciphertext only. Keep-awake
   advisory stays in the banner (no relay in v1).

## Evidence ledger (all measured 2026-10-18)

- Integration `test/daemon/mobile-lan-integration.test.ts`: **6/6** (real TLS `serve({lan})` on an
  ephemeral port; §15#10 cookie matrix included).
- Shipping harness `node tools/test-lan-flow-shipping.mjs`: **ALL CHECKS PASSED (25)** — real CLI
  `serve --lan` child, token redacted everywhere, XR_DAEMON_TOKEN honored.
- `bun test`: **4,477 pass / 0 fail / 413 files** (~183 s).
- `tools/test-web-push.mjs` crypto crosscheck (reference `web-push` package): **A–D all pass**.
- typecheck ✓ · size-gate **171,997 / 172,000**, **18 waivers** (server.ts@874 NEW with split plan;
  contract.ts@808; daemon-client.generated.ts@1,479).
- Gates: api:compat (0 breaking, **283 ops** incl. 11 mobile) · api:schema · client · ownership ·
  release · channel · placeholder · sink · parity · capability · boundaries · hot-path ·
  marketplace · claim-lint — all green.
- Fail-before: integration suite's §15#10 + seam assertions were developed against the pre-patch
  daemon (stash proof earlier this window).

## Reconstruction journal

- Mid-window sandbox flash-reset wiped bun + `.git` and regressed the tree to a mid-turn snapshot.
  Rebuilt: bun 1.4.3 reinstall, `tar xzf /home/user/xr-git-backup.tar.gz` (.git @4603e75), tracked
  reset, replay of the idempotent anchor scripts + this-window edits regenerated from the design
  doc (`HANDOFF_PHASE_2.4_DESIGN.md`, untracked survivor) and the odd-tree forensic tar
  (`/home/user/xr-tree-odd-state.tar.gz`) which supplied the final tools/ harness files.
- A10 lesson from the journal: per-file post-golf line counts were recorded (see tracker row) and
  serve as the register for this commit; the tree landed at **171,997** (≤ ceiling; exactly the
  four-line margin under the 171,999 aspiration).
- Rollback: waivers `docs/perf/SIZE-WAIVERS.json` are the binding risk register — server.ts's
  2027-01-15 review date is the scheduled split point (`src/daemon/server-lan.ts` extraction).

## Open items / next phase (2.5·4.x)

- Parked (ledger): legacy `/api/chats` list for paired devices — the 2.1-era "chat list" claim was
  retired; the truthful companion read path is models/approvals/budget (proved in the harnesses).
- Parked: PWA install banner presence on the mobile shell (post-2.4 UI pass).
- server.ts split plan by 2027-01-15 (extract `server-lan.ts`; returns server.ts under 800).
- `qrcode` is an optional dependency at the seam — pairing works without an image by design.
