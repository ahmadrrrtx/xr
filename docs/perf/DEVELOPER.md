# XR Phase 3 — Developer Guide (performance engineering)

## Keeping imports compile-safe for `bun --compile`

`bun build --compile` statically traces imports. **A runtime-computed
`await import(name)` fails at boot in the compiled binary** (the Phase 3
development loop proved this: `Cannot find module './providers/…' from
'/$bunfs/root/…'`). Rules:

1. Dynamic imports on any boot path must be **static string literals**.
   `src/core/provider-modules.ts` and `src/cli/command-loaders.ts` show the
   pattern: a `switch` over the id with one literal `await import("./path")`
   per case.
2. Late-bound dependencies (playwright) go through `--external` in
   `scripts/build-matrix.ts`; never import them eagerly.
3. Verify with `bun run scripts/build-matrix.ts --targets linux-x64` and
   `bun test test/perf/binary-smoke.test.ts`.

## Adding a command without eager boot

1. Add a lazy loader entry + one literal-path case in
   `src/cli/command-loaders.ts`.
2. Add a profile in `src/core/boot-profile.ts` (`COMMAND_PROFILES`) listing the
   provider ids the command resolves (`Tokens.*`), and ensure
   `PROVIDER_REQUIRES` covers its dependencies.
3. No import of the kernel or command modules in `src/cli/router.ts` — the
   router only routes; `bootKernelForCommand` does the rest.
4. Run `bun test test/perf/boot-profile.test.ts` — it asserts every profile is
   a strict subset with valid dependency order.

## The budget / regression workflow

1. **Local fast guard:** `bun test test/perf/startup-latency.test.ts` (guards,
   budget × 1.25, few samples).
2. **Full gate:** `bun run perf:gate --baseline docs/perf/baseline-7.0.1-source.json`.
3. **New release baseline:** `bun run perf:baseline --samples 21 --mode source`
   → commit `docs/perf/baseline-<version>-source.json`.
4. **Waiver:** only with measured evidence + an owned review date
   (docs/perf/WAIVERS.md).

## Hot-path hygiene

- Fast-path modules (`src/cli/*`, `src/index.ts`, `boot-trace.ts`,
  `stall-detector.ts`) must keep **zero** synchronous FS/process calls —
  `bun run hot-path-lint` enforces it. Prefer async (`Bun.file`,
  `node:fs/promises`) on boot paths.
- Expensive scans (skills/capabilities) must go through
  `src/util/scan-cache.ts` (content-addressed, incremental).
- Memory re-indexing is content-addressed: never re-embed unchanged rows
  (`content_hash` + embedding cache in `user_memory`).

## Perf architecture at a glance

```
bin/xr (binary-first launcher) → dist/<platform> binary | bun src/index.ts
src/index.ts → src/cli/router.ts (lazy, fast-path sync-I/O = 0)
  → route decision (src/cli/route-decision.ts, <20 ms budget)
  → bootKernelForCommand (src/cli/kernel-boot.ts)
    → XRApp.bootstrap({ profile })  (src/core/app.ts + provider-modules.ts)
    → lazy command loaders (src/cli/command-loaders.ts)
  → command executes against profiled providers only
```
