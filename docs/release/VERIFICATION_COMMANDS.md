# Candidate verification and owner handoff commands

Candidate: **1.1.1-rc.1 / developer-preview**. Public defaults: **1.0.0**.
Commands below run from the repository root unless stated otherwise. Exact
executions, UTC starts, exit codes, wall time and measured RSS are in the
[candidate report](RELEASE_CANDIDATE_REPORT.md) and its evidence index. Do not
interpret a documented owner command as an executed native/platform pass.

# # Verified local preparation and source checks

```bash
bun install --frozen-lockfile --ignore-scripts
(cd desktop && bun install --frozen-lockfile --ignore-scripts)
bun run release:check
bun scripts/release-manifest.ts --check --tag v1.1.1-rc.1
bun run channel:check
bun run claim-lint
bun run ci:policy
bun run api:schema:check
bun run client:check
bun run desktop:ipc-acl --check
bun run size-gate
bun run ownership:check
node --max-old-space-size=1024 --max-semi-space-size=16 node_modules/typescript/bin/tsc --noEmit
(cd desktop && bun run build)
(cd desktop && bun run lint)
bun scripts/desktop-seed-gate.ts desktop/dist
```

Use the repository-pinned Bun1.4.2. The observed system Node was20.20.2;
CI trusted npm publication separately pins Node22.22.2/npm12.2.1. Do not
unnecessarily upgrade local dependencies. Renderer build warnings about large
chunks/ineffective dynamic imports are recorded, not hidden.

# # Verified behavioral security and deterministic benchmark

```bash
# Default targeted security gate: actual Linux namespace self-check/effect
# tests, behavior regressions, smoke and mandatory online dependency audit.
bun run security:check --out security-report.json

# Full uses the EXISTING segmented parity authority, NOT monolithic bun test.
# E2E-blackbox and the existing quarantine are separately identified.
XR_SEG_TIMEOUT=120 bun run security:check --full --out security-full.json
XR_TEST_CONCURRENCY=1 bun test test/e2e-blackbox

bun run benchmark:agent --out agent-benchmark.json
bun run benchmark:agent:smoke --out agent-smoke.json
bun test test/reliability/agent-benchmark.test.ts test/reliability/bounded-check.test.ts
```

Linux requires a real enforcing backend; unavailable required isolation is a
BLOCK, never a successful mock. This workspace supplied a checksum-verified
user-owned bwrap binary through trusted test wiring:

```bash
XR_TEST_BWRAP_PATH=/home/user/toolchains/bubblewrap-0.12.0/extracted/usr/bin/bwrap \
  XR_SEG_TIMEOUT=120 bun run security:check --full --out security-full.json
```

That absolute path is workspace-specific. Ordinary installations may use an
available system bwrap or tested unshare. No backend is silently substituted
with an unenforced process. The watchdog streams diagnostics, enforces a
process-group deadline and cleans its owned child on parent cancellation.
An explicitly offline audit is incomplete and exits nonzero:
`bun run security:check --offline`.

The benchmark is scripted engine/effect regression, not live model quality,
billing or superiority. Its monitored unauthorized effects/network attempts
must be zero; unknown effect counts fail. See [metric/protocol definitions](../../benchmarks/agent/README.md).

# # Verified standalone engine and isolated CLI lifecycles

```bash
bun scripts/compile-sidecar.ts
bun scripts/compile-sidecar.ts --if-missing
bash scripts/smoke-sidecar.sh x86_64-unknown-linux-gnu

bun scripts/journey/cli-journey.ts --channel binary --class LR --evidence cli-binary.json
bun scripts/journey/cli-journey.ts --channel npm --class LR --evidence cli-npm.json
```

The sidecar is the real governed engine, not a global CLI dependency. Cache
reuse requires source/scripts/lock/tool/target and binary digests; this detects
stale/damaged development caches, not publisher authenticity. The journeys
install only in disposable homes/prefixes, make a real file change through a
loopback provider, update to a clearly synthetic next version and uninstall,
checking retained/removed data and byte-identical shell fixtures. They do not
validate a historical release migration or paid vendor.

To inspect a locally built source package without publishing:

```bash
mkdir -p .cache/rc-artifacts
npm pack --ignore-scripts --pack-destination .cache/rc-artifacts
bun scripts/consumer-smoke.ts --tarball .cache/rc-artifacts/rrrtx-xr-1.1.1-rc.1.tgz
bun scripts/sbom.ts --scope combined --out .cache/rc-artifacts/sbom.cyclonedx.json
# --out is a file, not a publishing operation.
bun scripts/build-deb.ts --bin desktop/src-tauri/binaries/xr-engine-x86_64-unknown-linux-gnu \
  --out .cache/rc-artifacts/xr_1.1.1-rc.1_amd64.deb
bun scripts/write-sums.ts .cache/rc-artifacts
```

These are unsigned/private artifacts. Debian control version is derived as
`1.1.1~rc.1`, so it sorts before stable1.1.1, while the binary reports canonical
semver1.1.1-rc.1. Extracting/running a payload is not a system/native installer
PASS. Checksums alone do not authenticate a publisher.

# # Verified pure Rust subset; native shell remains blocked

With the pinned verified Rust1.99.1 compiler and one build job:

```bash
cargo test --locked --manifest-path scripts/native-budget-check/Cargo.toml --jobs 1
mkdir -p .cache/native-contract-tests
rustc --test desktop/src-tauri/src/legacy_credentials.rs -o .cache/native-contract-tests/legacy
.cache/native-contract-tests/legacy
rustc --test desktop/src-tauri/src/desktop_home.rs -o .cache/native-contract-tests/home
.cache/native-contract-tests/home
```

The18governor,2legacy-scope and3home tests import shipped code. They do not
compile or execute the whole Tauri shell, actual OS keychains or Rust1.77 MSRV.
The workspace used private cache CARGO_HOME/CARGO_TARGET_DIR to keep artifacts
out of recovery snapshots.

# # Development/native/production commands — NOT executed as GUI/platform proof

From `desktop/`, the existing development commands are:

```bash
bun run engine       # independent engine home; development proxy token
bun run dev          # browser renderer, requires engine
bun run dev:tauri    # native GUI; requires GTK/WebKit/Rust/platform prerequisites
```

These are documented interfaces, **not** a recorded interactive GUI pass here.
Do not start them against valuable user data to manufacture lifecycle evidence.
Use an absolute dedicated XR_DESKTOP_HOME and clean OS profile for native tests.
The native journey is `scripts/journey/desktop-journey.ts`; the existing
Desktop App workflow owns installers, OS signature verification, actual launch,
agent effect, same-version reinstall/data retention and uninstall. Cross-version
and automatic-update lifecycle need separate real evidence, not a renamed
reinstall result.

Production verification is intentionally blocked locally. The command below
requires real signature/provenance artifacts and external verifier tools; local
fixture keys cannot substitute:

```bash
bun run release:verify --artifact <exact-signed-tarball> --sums SHA256SUMS \
  --sbom sbom.cyclonedx.json --provenance <actual.intoto.jsonl> \
  --expected-version 1.1.1-rc.1 \
  --cosign-identity https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v1.1.1-rc.1 \
  --slsa-source-uri github.com/ahmadrrrtx/xr --slsa-source-tag v1.1.1-rc.1
```

Placeholders above denote owner-provided real files; that recipe was NOT run
with invented proofs. See [signing prerequisites](DESKTOP_SIGNING.md) and
[authenticated release verification](VERIFYING_RELEASES.md). Never paste
production credentials into chat, argv, generic config or source control.
