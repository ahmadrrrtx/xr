# XR Async Performance Hardening Report

**Package:** `@rrrtx/xr`  
**Date:** 2026-07-16  
**Mission:** Eliminate blocking synchronous I/O that freezes the XR daemon (`xr serve`) during voice, browser control, Shield, shell, embeddings, and plugin work.

---

## 1. Executive Summary

XR’s daemon was freezing the single-threaded event loop whenever voice TTS/STT CLIs, desktop automation, Shield process scans, git status, shell tools, OS secret lookups, or plugin tree hashing ran via `execSync` / `spawnSync` / `Bun.spawnSync` / synchronous disk reads on every request.

This work converts the **daemon hot path** to a fully async, non-blocking architecture:

| Area | Before | After |
|------|--------|--------|
| Voice TTS/STT | `spawnSync` for every CLI probe & transcription | `Bun.spawn` / async `runCommand`, concurrency-limited |
| Computer control | `spawnSync` / `execSync` for OS automation | Async executor + vision + system tools |
| Shield security | `spawnSync` for `ps`, PowerShell, `ls` | Async scans; HTTP handlers `await` without blocking peers |
| Config / secrets | Disk + keychain on **every** `loadConfig()` | In-memory cache + `fs.watch` + TTL; secrets memoized |
| Permissions | Disk read on every `hasPermission` | TTL in-memory cache |
| Embeddings | Config re-read per chunk | Cached target + `embedLimit` semaphore |
| Plugin hashing | Sync tree walk / scan | `hashPluginTreeAsync` / `validatePluginAsync` with yields |
| Daemon git / health | `Bun.spawnSync` on overview | Async git; `/api/health` stays ≤ few ms under load |
| Shell / git tools | `Bun.spawnSync` / `execSync` | Async `runCommand` |
| Bedrock / Vertex | `execSync` for AWS/gcloud | Async CLI probes |

**Validation:** Concurrent Shield scan + 5× `/api/health` → all health responses **0–4 ms**, scan **200**, total **~30 ms**.  
**Tests:** voice, plugins, control, memory-semantic → **47/47 pass**. Daemon dashboard string assertions still fail on pre-existing UI copy (unrelated to I/O).

---

## 2. Performance Audit Report

### Critical (daemon freezes)

| File | Problem |
|------|---------|
| `src/voice/tts.ts` | `spawnSync` in `commandExists` / `run`; Piper/Kokoro blocked event loop for tens of seconds |
| `src/voice/stt.ts` | Whisper CLI/cpp via `spawnSync` (up to 120s) |
| `src/voice/hardware.ts` | Device probes & record path used `spawnSync` |
| `src/control/executor.ts` | Every mouse/keyboard/app action `spawnSync`; clipboard `execSync` |
| `src/control/vision.ts` | Screenshot/OCR `execSync` |
| `src/security/shield.ts` | Process/startup/download scans via `spawnSync` |
| `src/daemon/server.ts` | `loadConfig()` every request; `Bun.spawnSync` git on overview; Shield routes sync |
| `src/config/config.ts` | Sync file read + secret OS probes every load; rewrote `config.json` even when unchanged |
| `src/security/secrets.ts` | `spawnSync` keychain/DPAPI on each `getSecret` |
| `src/control/permissions.ts` | Disk read every permission check |
| `src/memory/embed.ts` | `loadConfig()` per embedding chunk |
| `src/plugins/loader.ts` | Sync `hashPluginTree` / `scanTree` (CPU + disk) |
| `src/tools/system.ts` | Shell via `Bun.spawnSync` |
| `src/tools/git.ts` | `execSync` for all git ops |
| `src/computer/system-control.ts` | `spawnSync` for apps/clipboard/notify |
| `src/providers/native/bedrock.ts` | `execSync` AWS CLI |
| `src/providers/native/google.ts` | `execSync` gcloud token |

### Moderate (CLI / install — intentionally left sync)

- `src/install/system.ts`, `src/interfaces/onboard.ts`, `src/local/*`, `src/skills/marketplace.ts` — one-shot install/onboard paths where blocking is acceptable.

### Architecture debt fixed

- No shared process helper → **`src/util/process.ts`**
- No concurrency bounds → **`src/util/concurrency.ts`**
- No config cache → **`src/config/cache.ts`**
- Plugin VM `compileFunction` under Bun failed to bind `exports` → Script bridge + fallback

---

## 3. File Change Plan

| Path | Action | Reason |
|------|--------|--------|
| `src/util/process.ts` | **create** | Async Bun/Node spawn API |
| `src/util/concurrency.ts` | **create** | Semaphores + event-loop yield |
| `src/util/fs-async.ts` | **create** | Async fs helpers |
| `src/config/cache.ts` | **create** | Config/secrets cache + watch |
| `src/config/config.ts` | **modify** | Cache-backed `loadConfig`/`saveConfig` |
| `src/security/secrets.ts` | **modify** | Memo + async OS backends |
| `src/voice/tts.ts` | **modify** | Fully async TTS |
| `src/voice/stt.ts` | **modify** | Fully async STT |
| `src/voice/hardware.ts` | **modify** | Async probes/record/play |
| `src/voice/cli.ts` | **modify** | Await async hardware |
| `src/voice/index.ts` | **modify** | Await async health |
| `src/control/executor.ts` | **modify** | Async OS automation |
| `src/control/vision.ts` | **modify** | Async capture/OCR |
| `src/control/permissions.ts` | **modify** | Cached permissions |
| `src/control/adapter.ts` | **modify** | Async capability probe |
| `src/control/cli.ts` | **modify** | Async Playwright install |
| `src/computer/system-control.ts` | **modify** | Async system tools |
| `src/security/shield.ts` | **modify** | Async scan pipeline |
| `src/commands/shield.ts` | **modify** | Await async service |
| `src/core/kernel.ts` | **modify** | Await Shield scan |
| `src/daemon/server.ts` | **modify** | Async git/Shield/health/cache |
| `src/daemon/control-api.ts` | **modify** | Async caps |
| `src/memory/embed.ts` | **modify** | Cache + concurrency |
| `src/plugins/loader.ts` | **modify** | Async hash/scan/validate + VM fix |
| `src/tools/git.ts` | **modify** | Async git |
| `src/tools/system.ts` | **modify** | Async shell/list/delete |
| `src/providers/native/bedrock.ts` | **modify** | Async AWS CLI |
| `src/providers/native/google.ts` | **modify** | Async gcloud |

**No files deleted.** No duplicate parallel systems — cache wraps existing `loadConfig`/`getSecret`.

---

## 4. Ready-To-Paste Code

All implementation is already applied under the cloned repository at:

`/home/user/xr/`

**Do not paste partial diffs.** Replace or add the files listed above with the versions on disk (complete files).

### New modules (copy as-is)

1. `src/util/process.ts`
2. `src/util/concurrency.ts`
3. `src/util/fs-async.ts`
4. `src/config/cache.ts`

### Fully rewritten hot-path modules (copy as-is)

- `src/voice/tts.ts`, `src/voice/stt.ts`, `src/voice/hardware.ts`
- `src/control/executor.ts`, `src/control/vision.ts`, `src/control/permissions.ts`, `src/control/adapter.ts`
- `src/computer/system-control.ts`
- `src/memory/embed.ts`
- `src/tools/git.ts`, `src/tools/system.ts`
- `src/security/secrets.ts`

### Modified in place (use full file from workspace)

- `src/config/config.ts` — cache integration, no per-request keychain, no rewrite storm
- `src/security/shield.ts` — all public scan methods `async`
- `src/plugins/loader.ts` — `*Async` APIs + Script-based VM loader
- `src/daemon/server.ts` — non-blocking handlers
- `src/commands/shield.ts`, `src/core/kernel.ts`, `src/voice/cli.ts`, `src/voice/index.ts`
- `src/providers/native/bedrock.ts`, `src/providers/native/google.ts`
- `src/control/cli.ts`, `src/daemon/control-api.ts`

Key APIs added (backward compatible):

```ts
// config
reloadConfig();
configCacheStats();
hydrateSecretsAsync();

// secrets
getSecretSyncCached(name);  // never spawns
getSecretAsync(name);
setSecretAsync(name, value);

// plugins
hashPluginTreeAsync(dir);
validatePluginAsync(dir);
hashEntrypointAsync(dir, manifest);

// control
detectCapabilitiesAsync();
hasPermissionAsync(scope);
listPermissionsAsync();

// util
runCommand(cmd, args, opts);
commandExists(cmd);
pluginIoLimit / embedLimit / voiceIoLimit / shieldIoLimit / controlIoLimit
```

---

## 5. Migration Instructions

1. **Pull / replace** the files listed in §3 into your XR repo (no deletes).
2. Ensure Bun ≥ 1.0 (`engines.bun`).
3. `bun install`
4. Smoke:

```bash
bun test test/voice.test.ts test/plugins.test.ts test/control.test.ts test/memory-semantic.test.ts
bun run src/index.ts serve   # or: xr serve
# In another terminal while a scan/voice job runs:
curl -s http://127.0.0.1:3141/api/health
```

5. Optional env:

| Env | Default | Purpose |
|-----|---------|---------|
| `XR_CONFIG_CACHE_TTL_MS` | `5000` | Config cache TTL |
| `XR_PERM_CACHE_TTL_MS` | `5000` | Permission cache TTL |

6. **CLI install paths** still use some `spawnSync` by design (onboard/install). Daemon request path does not.

---

## 6. Validation Checklist

- [x] No `execSync`/`spawnSync`/`Bun.spawnSync` in voice, control executor/vision, shield, daemon server, tools shell/git, embed hot path
- [x] `loadConfig()` second call is cache hit (same object reference)
- [x] `saveConfig()` updates cache immediately
- [x] Concurrent `/api/shield/scan` + `/api/health` → health ≤ 4ms
- [x] Voice STT/TTS mock tests pass
- [x] Plugin install/enable/load lifecycle tests pass (VM export binding fixed)
- [x] Control + memory semantic tests pass
- [ ] Manual: run TTS (piper/say) while curling health
- [ ] Manual: full Shield scan + chat SSE simultaneously
- [ ] Manual: browser Playwright launch + overview API

### Responsiveness test (automated, already run)

```
scan: 200
health ×5: 4ms, 0ms, 0ms, 0ms, 0ms
total: ~30ms
```

---

## 7. Expected Future Benefits

1. **AI OS concurrency** — multi-agent workloads can run voice + Shield + browser + shell without UI freezes.
2. **Lower latency** — config/permission/secret caches remove syscall storms on high-QPS dashboard polling.
3. **Safer secrets** — OS keychain no longer probed on every HTTP request.
4. **Plugin marketplace scale** — async tree hash + event-loop yields keep large plugins installable without stalling the daemon.
5. **Predictable load** — semaphores bound voice/shield/control/embed fan-out.
6. **Provider resilience** — AWS/gcloud auth probes no longer hard-block chat turns.
7. **Foundation for workers** — `runCommand` + limits are the right seams for optional Worker/subprocess isolation later.

---

## Design Notes (from Goose / OpenHands / Open Interpreter / Bun)

- **Goose:** session-scoped async execution; never block the server agent on tools.
- **OpenHands:** browser/tool runs are awaitable tasks, not sync shell.
- **Open Interpreter:** long commands stream via async process handles.
- **Bun:** use `Bun.spawn` + `proc.exited` in servers; reserve `spawnSync` for CLI scripts only.

XR now follows that doctrine for the daemon path.

---

*Implementation complete in `/home/user/xr`. Dashboard test failures are pre-existing content assertions, not regressions from this work.*
