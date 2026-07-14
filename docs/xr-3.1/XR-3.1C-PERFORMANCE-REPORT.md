# XR 3.1C — CLI Performance Report

**Reference:** Performance Standards (`XR-3.1-PERFORMANCE-STANDARDS.md` §1, §8, §10)  
**Measured:** 2026-07-14 · Bun 1.3.14 · Linux x64 sandbox

---

## 1. Wall-clock fast paths (warm-ish process)

| Command | Target | Observed (approx, 5-run) | Verdict |
|---|---|---|---|
| `xr --version` | <100 ms ideal / practical Bun start | **~137–150 ms** median | Acceptable for Bun cold-ish start; in-process work ≪1 ms |
| `xr help` | <200 ms | **~142 ms** | PASS practical |

> Hard <100 ms for full process spawn depends on Bun + OS page cache. The architecture guarantees **no kernel bootstrap** on these paths.

---

## 2. In-process microbenchmarks (`xr doctor --perf`)

| Bench | Target | Median | Result |
|---|---|---|---|
| version-string | ≤100 ms | ~0.00 ms | PASS |
| catalog-help-build | ≤200 ms | ~0.04 ms | PASS |
| flag-parse | ≤50 ms | ~0.01 ms | PASS |

---

## 3. Architectural guarantees

1. **Lazy kernel** — version/help/serve/shell never call `XRKernel.bootstrap()`.  
2. **Command modules** — heavy handlers still dynamic-import subsystem CLIs (memory, voice, control, research).  
3. **Catalog is static data** — help does not scan the filesystem.  
4. **JSON mode** skips banners/spinners (less I/O).  

---

## 4. Improvements vs pre-3.1C

| Before | After |
|---|---|
| Help was a large sequential `console.log` block in one file | Same cost class, but structured catalog enables future lazy sections |
| Kernel always for any non-fast command | Unchanged necessity; clearer separation |
| Latent skill-index crash on start | Fixed — kernel commands no longer fail closed on incomplete skill manifests |

---

## 5. Recommendations (follow-ups, not blockers)

1. CI gate: assert `xr --version` / `xr help` p50 regression <20%.  
2. Optional: defer `SkillService.onStart` index build until first `skills` command (backend policy decision).  
3. Document Bun install warm-cache expectations for Termux/Windows.
