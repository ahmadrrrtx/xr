/**
 * Phase 1 — shared test helpers.
 *
 * `rmrf` is the retry-based directory removal the repo already uses in
 * test/state/workspace-store.test.ts (`rmrfWithRetry`). Plain `rmSync` in a
 * `finally` throws `EBUSY: resource busy or locked` on Windows while SQLite
 * handles are still being released. The retry sleep MUST yield to the event
 * loop (`setTimeout`), not spin: Windows needs the loop to run so bun can
 * finalize/close the connection before the directory becomes removable. This
 * is the exact pattern proven on the Windows CI job by test/state.
 */
import { rmSync } from "node:fs";

/** Remove a file/dir recursively, retrying on Windows EBUSY/EPERM/ENOTEMPTY. */
export async function rmrf(path: string, maxAttempts = 10): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "") || attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
