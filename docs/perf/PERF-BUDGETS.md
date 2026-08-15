# XR Performance Budgets & Regression Gate (Phase 3)

> Constitution Article XII · Mandatory Rule 1: *"--version/--help p95 <150ms
> warm / <300ms cold"*; Rule 2: *"No perf claim without a budget and a
> regression gate."* Every number below is a **published budget** with a
> **measured baseline** and a **CI gate** that fails on violation. Nothing here
> is a boast; everything is a contract.

## 1. Published budgets

| Budget | Scenario | Mode | Metric | Budget | Baseline 7.0.1 (source, 21 samples) |
|---|---:|---:|---:|---:|---:|
| version-warm | `--version` | warm | p95 | **150 ms** | 47.4 ms |
| version-cold | `--version` | cold | p95 | **300 ms** | 55.7 ms |
| help-warm | `--help` | warm | p95 | **150 ms** | 43.9 ms |
| help-cold | `--help` | cold | p95 | **300 ms** | 42.6 ms |
| doctor | `doctor --json` | warm | p95 | **2500 ms** | 474.4 ms |
| route-decision | in-process route decision | warm | p95 | **20 ms** | 0.003 ms |
| dashboard-render | daemon `GET /` first body | warm | p95 | **1000 ms** | 15.6 ms |
| retrieval-100k | full retrieval @100k items | warm | p95 | **250 ms** | 33.7 ms |

> Budget values are the **Constitution Article XII ceilings** — the binding
> contract (`--version`/`--help` <150 ms warm / <300 ms cold). The Phase 3
> spec's tighter targets (100/150 ms warm; doctor <1 s; retrieval <100 ms)
> are **met by measurement** on the reference host (47.4/43.9 ms; doctor
> 315-474 ms; retrieval 25-42 ms) but are not the gate: gating on numbers
> this tight caused CI false-failures against a baseline measured on
> different hardware and on noisy shared runners. Gate ceilings for
> machine-sensitive scenarios are set to degraded-runner bounds (doctor 2500
> ms, retrieval 250 ms) — the measured claims are unchanged and documented.
> Measured values are reported with every gate run.
>
> **doctor 1500 → 2500 ms (2026-08-12, independent audit).** Under CPU
> saturation on a 2-vCPU host the audit measured doctor p95 at **1263 ms on
> unmodified `main@3308aff`** and **1270 ms on the audit branch** — a 0.6%
> delta, i.e. host contention, not a code regression — yet only ~15% under the
> old ceiling, so a loaded GitHub runner could breach it either way (PR #48's
> perf lane did). `doctor --json` spawns several subprocesses
> (`commandExists`, `bun --version`) and is the most contention-sensitive
> scenario in the matrix. The ceiling is a *liveness* bound for shared
> runners; the performance CLAIM (<1 s on a reference host, measured
> 315–474 ms) is unchanged, still gated by the other eight budgets, and
> printed on every gate run.

- **warm** = shared XR_HOME with a discarded warm-up sample; **cold** = fresh
  isolated XR_HOME per sample.
- Measurement: wall-clock process duration for process scenarios; in-process
  `performance.now()` for the micro-benchmarks. Machine-independent — budgets
  are enforced on the CI host, not asserted as universal hardware claims.
- Machine-readable: `scripts/perf/budgets.json` (single source of truth).

## 2. The regression gate

`bun run scripts/perf-gate.ts` (CI job `perf-gate` in `.github/workflows/ci.yml`):

1. **Budget gate (always blocks)** — current p95 must be ≤ the published
   budget (Constitution ceilings; never scaled, never waived silently).
2. **Regression band (blocks on the SAME HOST only)** — current p95 must be ≤
   a **same-host baseline** p95 × machine-calibration factor × 1.10. The
   same-host baseline lives in `~/.cache/xr/perf-baseline-<mode>.json`
   (persisted across CI runs via `actions/cache`, key
   `perf-baseline-<os>-7.0.1`) and **ratchets down only** (min p95 per
   scenario). The very first run on any host has no same-host baseline, so
   the band WARNS (never blocks) and seeds the cache; from run 2 onward the
   band blocks on that host. This is what keeps a baseline measured on a
   developer sandbox from false-failing GitHub's runners, while still
   catching real regressions per host after its first run.
3. **Machine calibration** — when the band is active, the `version` (cold)
   reference scenario (pure spawn+exit, no kernel) scales the band:
   `clamp(current ref p95 / baseline ref p95, 1.0, 3.0)`. The budget gate is
   never calibrated.

Budget violations fail CI unless covered by a ratified waiver in
[`WAIVERS.md`](WAIVERS.md) (owner + review date; `--waiver <id>`). The gate
prints the band mode, calibration factor and cache path on every run.

**The gate is proven non-vacuous** by `test/perf/perf-gate.test.ts`, which
seeds a regression and asserts the gate fails, and by the CI job running the
real matrix against the committed baseline (`docs/perf/baseline-7.0.1-source.json`).

## 3. The boot-profile model (command-scoped boot)

A command boots only the subsystems it needs (Art. VI.4 / Cmdt 11):

- `src/core/boot-profile.ts` — provider requires-graph + per-command provider
  sets (`COMMAND_PROFILES`) + `providerClosure()` (deps first, canonical order).
- `src/core/provider-modules.ts` — per-provider modules loaded via
  **literal-path** dynamic imports; `XRApp.bootstrap({ profile })` registers
  only the profiled providers.
- `src/cli/command-loaders.ts` — commands are lazy-loaded on first execution
  (literal-path dynamic imports; compile-safe).
- `XR_TRACE_BOOT=1 xr <cmd>` prints a per-phase boot trace (kernel-import →
  register → start → execute) to stderr — the boot-profile view for diagnosing
  a slow command.

Verified subsystems-per-command (test/perf/boot-profile.test.ts):

| Command | Booted providers |
|---|---|
| `--version` / `--help` | none (kernel never loads) |
| `config get` | `config` |
| `doctor` | `state, config, providers, capabilities` |
| `skills` | `skills` |
| `run` | agent closure (`state, config, providers, budget, plugins, mcp, skills, execution, agent`) |

## 4. Compile-safe dynamic imports (Global Rule 7)

`bun --compile` statically traces imports. Two hard rules, enforced by the
build + `test/perf/binary-smoke.test.ts`:

1. **Never** `await import(<computed path>)` — the compiler cannot trace it and
   the binary fails at boot (`Cannot find module` in `$bunfs`). This exact
   failure was caught in Phase 3 development and fixed by rewriting both loader
   modules as literal-path `switch` statements.
2. Late-bound dependencies (e.g. `playwright` for browser control) are
   `--external` in the build matrix and resolved at runtime.

Adding a command: add one entry to `src/cli/command-loaders.ts`
**including one literal-path case** in `importCommandModule`, plus a profile
entry in `src/core/boot-profile.ts` if the command needs a subset of providers.

## 5. Hot-path sync I/O (Article XII · Rule 4)

- **Fast path = zero sync I/O.** The modules serving `--version`, `--help`,
  `xr <cmd> --help`, `shell`, `serve` and every command's route decision
  (`src/cli/*`, `src/core/boot-trace.ts`, `stall-detector.ts`, `src/index.ts`)
  contain **0 synchronous FS/process calls** — enforced by
  `scripts/hot-path-lint.ts` (CI) and `test/perf/hot-path-lint.test.ts`
  (non-vacuous: seeded violation is caught).
- **Event-loop stall detection.** `XRApp.stallDetector` (src/core/stall-detector.ts)
  attaches at `start()`, records any loop block > 200 ms, and is asserted to
  report **zero violations on the golden path** and to **catch synthetic
  blocks** (test/perf/stall-detection.test.ts).
- **Owned exceptions on the kernel-boot path** (documented, measured, enforced
  indirectly by the stall detector — these are single small-file reads, not
  stalls):
  1. `loadConfig()` — the config substrate's canonical load (one cached file,
     ~1–2 ms; converting would touch 40+ call sites).
  2. Workspace-state sync fallback in `WorkspaceManager` for **standalone
     consumers** that never call the kernel's async `load()`; the kernel boot
     path itself uses async `load()` (no sync FS).
  3. SQLite open/PRAGMA — the Phase-1 single-writer persistence substrate
     (bun:sqlite is synchronous by design; not FS/process API).
  4. Scan-cache payload read — one ~30 KB gzipped file replacing 50–140 ms of
     per-file parsing.

## 6. Incremental content-addressed scans (T4) & indexing (T9)

- `src/util/scan-cache.ts` — Merkle-style fingerprint (rel path + size +
  mtimeMs per entry, plus tracked state files) → payload cache in
  `$XR_HOME/cache/scans/`. Warm scan cost ≈ O(stat of the tree), not O(parse).
  Known limitation (standard mtime/size fingerprint tradeoff): an entry
  modified to the same size *and* same mtime tick is not invalidated.
- Skill catalog + skill records are cached (warm `skills` boot: 345 ms → ~176 ms
  end-to-end; loader `load()` 79 ms → 22 ms).
- `memory reindex` is content-addressed: `content_hash` (sha256 of content+tags)
  per row; unchanged rows are skipped (warm re-index near O(changed)). Verified
  by test/perf/incremental-index.test.ts (second pass skips 50/50; one changed
  row re-embeds exactly 1).

## 7. Streaming metrics (T7)

`xr providers metrics [--json]` reports per-turn TTFT, tokens/s, token counts,
cancellation latency and memory high-water from `$XR_HOME/cache/metrics/streaming.jsonl`
(bounded 500 lines). **TTFT note:** the current provider substrate returns
complete turns (no token streaming API in the `Provider` contract), so TTFT is
measured as time-to-first-byte of the turn. Metrics contain **no secrets**
(whitelist-asserted in tests).

## 8. Local-load admission (T8)

`xr models install` preflights the model against detected hardware
(`src/local/admission.ts`) before `ollama pull`: footprint = params ×
quantization factor (q4 ≈ 0.7 GB/1B, fp16 ≈ 2.2 GB/1B) vs usable RAM and VRAM
per hardware tier. Clear OOM candidates are **denied** with the reason;
`--force` overrides. Profiles documented in the module and asserted by
test/perf/load-admission.test.ts.

## 9. Model-switch state machine (T6)

`xr providers set <id> [model] [--force]` runs preflight → warm → canary →
swap → verify with rollback: every phase timeout-bounded (no unexplained
waits), canary failure keeps the previous config and explains why, `--force`
bypasses only the canary. Rollback (including swap-failure and verify-failure
paths) is unit-tested. `xr models set` keeps its interactive flow.

## 10. Profiling tooling

- `XR_TRACE_BOOT=1` — per-phase boot trace (boot-profile view).
- `scripts/perf/route-bench.ts` · `dashboard-bench.ts` · `retrieval-bench.ts` —
  micro-benchmarks behind the matrix.
- `scripts/perf-baseline.ts` — regenerate a versioned baseline artifact.
- `scripts/perf-gate.ts` — budget + regression gate (CI).
- `stallDetector` — event-loop stall reporting in-process.

## 11. Measurement discipline (Part 19)

Sample isolation (fresh XR_HOME for cold samples), a discarded warm-up sample
for warm scenarios, ≥9 samples for gate runs, ≥21 for baseline artifacts,
p95 as the metric, and a 30% noise budget in the regression gate (Phase 4 · T4; see scripts/perf/budgets.json note for the measured rationale). If a budget
is missed the real number is reported with the blocker — a budget is never
claimed without being measured (Phase-0/1/2 honesty discipline).

## 12. Phase 01 — daemon runtime performance (P0)

### 12.1 Critical-path budgets (Phase 01 gate)

| Metric | Baseline (main@9680298) | Target | Actual (this host, normal env) | Actual (blackhole worst case) | Status |
|---|---:|---:|---:|---:|---:|
| providers.list | 16.0 s server-side; client killed at Bun 10 s | p95 < 2.5 s | 3–4 ms warm | 3 ms warm / 2.5 s cold (health bound) | PASS |
| models.list | ~36 s server-side; client killed at 10 s | p95 < 2.5 s | 1–2 ms | 2 ms (cached) | PASS |
| onboarding.status | 30.6 s server-side; client killed at 10 s | p95 < 3 s | 1–2 ms | 1 ms warm / ~2.6 s cold | PASS |
| runtime detection (11 runtimes) | 29 s sequential | 10 runtimes < 3 s (normal) | 19 ms cold | 7.5 s cold / 0.1 ms warm | PASS |
| cached runtime lookup | n/a (no cache) | < 50 ms | 0.1 ms | 0.1 ms | PASS |
| hardware detection request impact | 3.5 s sync per request | no stall > 100 ms | 13 ms async | async; 0 ms request impact | PASS |
| chat.stream offline 503 | 32 s → 503 | bounded health | 3 ms (negative cache) | 2.5 s → 503 (bound) | PASS |
| dashboard first paint | fails (10 s timeout) | < 2 s | sub-100 ms (cached) | ~2.6 s cold / < 100 ms warm | PASS |
| Bun 10 s request timeout | triggered on every heavy endpoint | never on normal loading | not triggered | not triggered | PASS |
| catalog N+1 per providers.list | 26 builds | ≤ 1 build | 0–1 build | 0–1 build | PASS |

Measured with `bun run scripts/perf-daemon-routes.ts --samples 5` (normal) and
`XR_BENCH_BLACKHOLE=1 bun run scripts/perf-daemon-routes.ts --samples 3`
(blackhole = TCP listeners on all 9 local-runtime ports that accept but never
answer, plus slow nvidia-smi/lspci shims — reproduces the forensic audit
environment). Full regression coverage: test/perf/runtime-detection.test.ts,
provider-health.test.ts, hardware.test.ts, daemon-routes.test.ts.

### 12.2 Cache design (one primitive: src/util/ttl-cache.ts)

| Resource | Key | TTL | SWR | Negative | Invalidation | Stale policy |
|---|---|---:|---:|---:|---|---|
| runtime detection | config fingerprint (baseUrls, cliCommands, localModels, defaults) | 60 s | 30 s | — | config change → new key | stale served + background refresh |
| hardware specs | "default" | 5 min | 5 min | — | XR_HARDWARE_CACHE_TTL_MS; background refresh at startup + every TTL | stale served + background refresh |
| intelligence catalog | config + registry.version + API-key presence | 60 s | 15 s | — | config/registry/key change → new key | stale served + microtask rebuild |
| provider health | provider id + model | 60 s | 15 s | 15 s (failures) | key stored/cleared via auth short-circuit | stale served + background refresh |
| internet probe | "default" | 15 s | — | same | — | never stale beyond TTL |
| git summary | cwd | 5 s | — | — | — | never stale beyond TTL |

Kill switches (env, consistent with the existing XR_* override pattern):
`XR_RUNTIME_CACHE=0`, `XR_HARDWARE_CACHE=0`, `XR_CATALOG_CACHE=0`,
`XR_HEALTH_CACHE=0` — each disables ONLY its cache; the bounded/parallel
implementations remain active (never fall back to the old unbounded
sequential behavior). TTL knobs: `XR_RUNTIME_CACHE_TTL_MS`,
`XR_HARDWARE_CACHE_TTL_MS`, `XR_CATALOG_CACHE_TTL_MS`, `XR_HEALTH_CACHE_TTL_MS`
(precedent: `XR_CONFIG_CACHE_TTL_MS`).

### 12.3 Bounded concurrency & timeout semantics

- Runtime probes: Semaphore(5) bounded parallelism (never sequential, never an
  unbounded Promise.all). Per-runtime operation bounded by
  max(commandExists 1.5 s, HTTP probe 2.5 s) because the two run concurrently.
  11 runtimes ⇒ 3 waves ≈ 7.5 s worst case cold; typical envs 19–300 ms.
- Provider health: bounded race at 2500 ms + dedup (one in-flight probe per
  provider+model) + cache. **Timeout ≠ cancellation:** the underlying
  `provider.health()` fetch (8 s internal bound per probe) continues after the
  race because the `Provider` interface has no signal plumbing — the cache
  ensures the raced probe is never repeated within the TTL. Documented
  limitation; real cancellation is deferred (provider gateway, Phase 4).
- Rejected work is never cached; pending slots are removed on rejection so the
  next caller retries (no cache poisoning). Caches are memory-bounded
  (maxEntries with oldest-eviction).
- Stale-while-revalidate applies ONLY where staleness is benign (runtime
  health display, hardware, catalog). `models.select` / `models.test` /
  onboarding key-save stay FRESH (direct bounded probes, never cached).
- No authorization decision, secret, or user-scoped value is cached anywhere.

### 12.4 What must NOT regress (guarded by tests)

- `/api/health` and `/api/overview` never trigger runtime/hardware/catalog
  work (asserted in test/perf/daemon-routes.test.ts).
- Windows/Linux/macOS probe parity: `where`/`command` selection,
  PowerShell path, nvidia-smi/lspci parsing preserved in the async variants
  (statfsSync stays sync — a cheap <1 ms syscall).
- API contracts unchanged; response shapes identical.
