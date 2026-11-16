/*
 * S-7 — "is a provider configured?" is not "did the last probe succeed?".
 *
 * Three surfaces (the Brain's empty state, the Brain's demo gate, Diagnostics)
 * each hand-rolled the same predicate:
 *
 *     providers.some((x) => x.healthy && (x.kind === 'local' || x.hasKey))
 *
 * `healthy` comes from the engine's health probe (`health?.ok ?? false`) and is
 * FALSE when no probe has run — `healthState` exists precisely because that
 * boolean is pessimistic about "unknown". So a hosted provider with a saved key
 * and no probe yet, or a local runtime that is installed and running but whose
 * probe has not fired, reported "no model configured": a perfectly usable
 * engine described as empty. This file is that predicate, written once, in the
 * affirmative direction.
 *
 * Deliberately NOT loosened: a provider the engine has PROBED and found
 * unreachable is not usable, whatever its kinds and keys say. `unreachable` is
 * an observation and it outranks a guess.
 */
import type { EngineModelsResponse, EngineProvider } from '@/engine/types';

/** The runtime the engine reports as current (GET /models). */
type EngineCurrentRuntime = EngineModelsResponse['current'];

/**
 * A provider the engine can actually run a turn with.
 *
 *  · probed and reachable  → yes (a key is implied by the probe having run);
 *  · never probed          → a saved key, or a local runtime with nothing to
 *                            authenticate, is the best evidence available;
 *  · probed and unreachable → no. That is a fact, not an absence of one.
 */
export function providerIsUsable(p: EngineProvider): boolean {
  if (p.healthState === 'reachable') return true;
  if (p.healthState === 'unreachable') return false;
  // Unknown: a local runtime (keyless by nature) or a saved credential.
  return p.kind === 'local' || p.hasKey;
}

/** Any provider the engine can run a turn with. */
export function hasUsableProvider(providers: ReadonlyArray<EngineProvider> | null | undefined): boolean {
  return (providers ?? []).some(providerIsUsable);
}

/**
 * The engine's current LOCAL runtime is installed and running. That beats the
 * provider row's key state, because a local runtime needs no key — this is the
 * "Ollama is up with models, why does the app say nothing is configured" case.
 */
export function localRuntimeUsable(current: EngineCurrentRuntime | null | undefined): boolean {
  return Boolean(current && current.installed && current.running);
}
