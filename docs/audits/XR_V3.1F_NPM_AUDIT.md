# @rrrtx/xr — NPM PACKAGE AUDIT

**Package inspected:** `@rrrtx/xr@1.0.0` (dist-tag `latest`), pulled via `npm pack` and via a real `npm install` in a clean prefix.
**Compared against:** GitHub `main` @ v1.0.0 ("Truth") · README claims · runtime behavior.

---

## 1. Registry metadata

| Field | Value | Verdict |
|---|---|---|
| name | `@rrrtx/xr` | ✅ |
| latest | `1.0.0` (2026-09-08) | ⚠️ lower than 3.1.5 published 2026-07-08 |
| beta | `1.0.0-beta.1` | ✅ prerelease channel exists |
| versions | 0.2.0 → 3.0.0 → 3.0.1/2/3 → 3.1.5 → 1.0.0-beta.1 → 1.0.0 | ❌ **version history goes backwards**; 3.x users can never `npm update` into the 1.x line |
| engines | `bun >= 1.3.0` only | ❌ not enforced by npm (nonstandard field), and no `node` engine at all despite shipping a `.cjs` launcher |
| bin | `xr` → `./bin/xr` | ❌ Bun-shebang launcher; the Node-safe `bin/xr.cjs` is never linked (P0-1 in BUGS.md) |
| os/cpu | not set | ⚠️ launcher path expects platform binaries (`dist/xr-<plat>-<arch>`) but none ship; fine, but no guards |
| deps | `zod ^3.23.8` (runtime), `playwright ^1.47` (optional) | ✅ minimal · ⚠️ optional playwright still installs by default (~42MB node_modules incl. playwright-core) |
| maintainers | 1 (ahmadrrrtx1) | neutral |
| homepage | `https://xr-gules.vercel.app` | ✅ |
| license | MIT | ✅ (LICENSE present in tarball) |

**Versioning verdict:** the "deliberate semver rebaseline" (release.manifest.json: "1.0.0 is a DELIBERATE semver rebaseline of 7.1.0 (Truth)") plus the previously-published 3.x line creates a registry state where:
- `npm i -g @rrrtx/xr` today installs 1.0.0.
- A user who installed 3.1.5 in July runs `npm update -g @rrrtx/xr` and **stays on 3.1.5 forever** (1.0.0 is a downgrade).
- Two doc sets, two support matrices, and an npm README that says "Public Beta" while GitHub says "Stable" for the same version string.

**Required action:** `npm deprecate` the 3.x series or resume ≥3.1.6; republish a patch so README/status stamps agree; add a `POSTINSTALL`-free but informative engines check in the launcher.

---

## 2. Tarball contents (npm pack)

- **Tarball:** 5.5 MB · **Unpacked:** 18 MB · 1,968 files.
- Top-level: `bin/ (2)` · `src/ (579 TS files)` · `skills/ (875 files, 65 skills)` · `docs/ (483 files)` · `assets/ (7)` · `plugins/ (2)` · `install.sh` · `install.ps1` · `README.md` · `LICENSE` · `package.json`.

### Size offenders (unnecessary in a runtime artifact)

| File | Size | Why it ships |
|---|---|---|
| `assets/brand/avatar-hero.png` | 936 KB | dashboard branding |
| `assets/brand/avatar-front.png` | 740 KB | dashboard branding |
| `assets/avatar.png` | 195 KB | dashboard (also inlined as ~1.25MB base64 in the served HTML) |
| `docs/api/openapi.json` | 384 KB | docs |
| `docs/ux/evidence/*.png` | ~440 KB total | UX evidence screenshots |
| `docs/release/*/inventory.json` | 95 + 85 KB | release inventories |
| `docs/` overall | 483 files | includes 100+ historical phase documents |

**Verdict:** a CLI/agent runtime whose *runtime* payload (src + skills + bin + plugins) is a fraction of the tarball; the rest is internal documentation and brand art. No runtime code reads `docs/`. Ship `README.md`, `LICENSE`, `docs/cli/` subset at most. Cuts the package to a few MB and materially speeds global installs.

### Source parity GitHub vs npm

- `diff -rq` of `src/`, `bin/`, `plugins/`, `skills/`: **identical** ✅ (no source drift at publish time).
- `package.json`: **identical** ✅.
- `README.md`: **differs** ❌ — npm copy says "Status: Public Beta" / "npm latest (legacy)" badge; GitHub says "Status: Stable". The repo moved its README forward after publishing 1.0.0 without a version bump, violating its own "one manifest stamps every surface, CI fails on drift" constitution (the check only guards the repo, not the published artifact).

---

## 3. Clean-install behavior (the user's first five minutes)

### 3.1 Without Bun on PATH (typical npm user)

```
$ npm i -g @rrrtx/xr
$ xr --version
env: 'bun': No such file or directory        # exit 127
```
- The `.cjs` launcher that prints "XR requires Bun. Install it from https://bun.sh" is **not** what runs.
- No preinstall warning, no postinstall message, nothing on npm's install output.

### 3.2 With Bun on PATH

```
$ xr --version
v1.0.0 (Truth)
$ xr status          # works; ~190ms cold start; creates ~/.xr/config.json (v22)
```
- CLI operates normally; doctor/status/providers/audit all function.
- `xr serve` default port **3141** (matches its help) — note Docker/VS Code use 7842.

### 3.3 Dependency behavior

- `optionalDependencies.playwright` installs by default (npm treats optional as "install unless platform-incompatible") — pulls `playwright` + `playwright-core` (~42MB in node_modules) for a feature most users never enable. Consider moving to `peerDependencies` + `xr browser setup`, or a lazy `npm i` on first use.
- Runtime dep is only `zod` ✅ — excellent, genuinely minimal.

### 3.4 Global bin + Windows note (code-verified, not executed on Windows here)

- `bin/xr` is an ESM TypeScript-importing script: on Windows, npm creates `xr.cmd` → `node bin/xr`? No — npm shims invoke the file with its shebang via the shell; without Bun the same class of failure applies. `bin/xr.cjs` handles `where bun.exe` correctly — it's just not linked.
- `install.ps1` exists for the binary channel; package consumers on PowerShell get the broken path unless Bun is installed.

---

## 4. Behavior of the installed CLI (independent of the repo)

Tested from `/tmp/xr-global-test` with a clean `$HOME`:

| Command | Result | Verdict |
|---|---|---|
| `xr --version` | `v1.0.0 (Truth)` | ✅ |
| `xr status` | full status, 186ms, creates config | ✅ but shows false "✓ linux-secret-service" (BUGS P1-9) |
| `xr doctor` | readiness ✗ when no provider, exit 1 | ✅ honest |
| `xr help` | 100+ line command wall | ⚠️ see UX audit |
| `xr "task"` | provider failure → checkpoint + resume hint, exit 1 | ✅ (but `ask` exits 0 — P1-12) |
| `xr serve` | 3141, token URL printed | ✅ |
| `xr mcp add` | raw zod error on bad syntax | ❌ P2-1 |
| `xr update` | builds a 98MB binary from the installed package's own source and reports success at the same version | ❌ P2-5 — inside node_modules this writes ~100MB into the global prefix |

**`xr update` inside an npm global install is a special hazard:** it compiles `node_modules/@rrrtx/xr/src` into `node_modules/@rrrtx/xr/dist/xr-<plat>` (95MB). Any subsequent `npm update` or uninstall surprises, disk bloat, and "which xr am I running" ambiguity (bin/xr prefers the dist binary when present).

---

## 5. ESM/CJS compatibility

- `"type": "module"`; `bin/xr` is ESM TS (Bun-only); `bin/xr.cjs` is proper CJS for Node.
- No `exports` map: `import "@rrrtx/xr"` from another package resolves into raw TS sources — **the package is not importable as a library** despite being scoped (`@rrrtx/`). If library use is intended, ship compiled JS + `exports`; if not intended, fine, but document "CLI-only package" (npm shows no such note).

## 6. Metadata honesty checklist

| Check | Status |
|---|---|
| README install row `npm i -g @rrrtx/xr` works on stock Node | ❌ |
| README "Status: Stable" matches published README ("Public Beta") | ❌ |
| README "npm latest (legacy)" badge (published) vs "npm" badge (GitHub) | ❌ drift |
| Version single-source-of-truth (`version.ts` = package.json = manifest) | ✅ in-repo |
| Dist-tags (latest/beta) documented behavior | ✅ (beta never moves latest) |
| Tarball integrity / files list sane | ⚠️ oversized but valid |
| Provenance/cosign claims | not verifiable from tarball; CI workflows exist (supply-chain.yml) — plausibly real for GitHub releases; npm provenance not visible in this environment |

---

## 7. Fix list for the package (ordered)

1. **(P0)** Link `bin.xr` → `bin/xr.cjs` (Node-safe launcher with Bun detection + install hint). One-line package.json change; re-publish as 1.0.1.
2. **(P1)** Deprecate 3.0.0–3.1.5 on npm with a pointer to the 1.x line (or resume 3.x numbering).
3. **(P1)** Republish so the npm README matches the repo README for the same version (stamp drift).
4. **(P2)** Trim `files` to runtime-only (`bin`, `src`, `skills`, `plugins`, `README`, `LICENSE`, subset of `docs`); drop brand PNGs and `docs/**/evidence|inventory| historical`.
5. **(P2)** Move `playwright` out of `optionalDependencies` to an opt-in installer path.
6. **(P2)** Guard `xr update` in npm installs: detect package-manager ownership (global prefix under npm) and print "update via npm" instead of self-building.
7. **(P3)** Add `"node": ">=20"` to engines alongside bun (the .cjs path needs it), and a `README` note: "CLI package — not importable as a library."
8. **(P3)** Consider per-platform binary optionalDependencies so the 98MB self-build path is never needed.
