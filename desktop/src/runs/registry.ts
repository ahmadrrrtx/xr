/*
 * Summary lookup seam (Phase 11).
 *
 * brainStore needs a run's list-level metadata when `/brain/:id` opens a
 * seeded run it has never streamed (title, agent, model, status, cost…).
 * It must not import runsStore (runsStore imports brainStore), so the
 * bridge registers a lookup here at boot and brainStore reads through it.
 */
import type { RunSummary } from '@/brain/types';

type Lookup = (id: string) => RunSummary | undefined;

let lookup: Lookup = () => undefined;

export function registerSummaryLookup(fn: Lookup): void {
  lookup = fn;
}

export function lookupRunSummary(id: string): RunSummary | undefined {
  return lookup(id);
}
