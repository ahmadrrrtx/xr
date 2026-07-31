/**
 * Phase 1 — shared test helpers.
 *
 * `rmrf` is the retry-based directory removal the repo already uses in
 * test/state/workspace-store.test.ts (`rmrfWithRetry`). Plain `rmSync` in a
 * `finally` throws `EBUSY: resource busy or locked` on Windows when a SQLite
 * handle is still being released, which failed the cross-platform CI. Every
 * Phase-1 reliability test cleans up through this helper.
 *
 * Synchronous (tests' `finally` blocks are sync); the retry sleep is a brief
 * spin that only happens on the rare Windows EBUSY/EPERM/ENOTEMPTY path.
 */
import { rmSync } from "node:fs";

/** Remove a file/dir recursively, retrying on Windows EBUSY/EPERM/ENOTEMPTY. */
export function rmrf(path: string, maxAttempts = 10): void {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "") || attempt === maxAttempts - 1) {
        throw error;
      }
      const end = Date.now() + 50 * (attempt + 1);
      while (Date.now() < end) {
        /* spin */
      }
    }
  }
}
