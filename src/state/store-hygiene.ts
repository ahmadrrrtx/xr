/**
 * XR — store hygiene for harnesses (Phase 2).
 *
 * A WorkspaceStore connection still open when a test run ends is a test that
 * never closed its store: invisible on POSIX (an open file can be unlinked),
 * EBUSY on Windows for every delete that follows. `closeAllStores()` closes
 * every shared connection through the gate's strict close and reports what
 * it found — the count is the hygiene backlog, the failures are zombies.
 * Not for product paths: the product closes stores it opened.
 */
import { WorkspaceStore } from "./workspace-store.ts";

export function closeAllStores(): { open: number; closed: number; failures: string[] } {
  const registry = WorkspaceStore.sharedRegistry();
  const open = registry.size;
  const failures: string[] = [];
  let closed = 0;
  for (const [key, shared] of [...registry.entries()]) {
    registry.delete(key);
    const failure = shared.gate.closeConnection();
    if (failure) failures.push(`${key}: ${failure}`);
    else closed += 1;
  }
  return { open, closed, failures };
}
