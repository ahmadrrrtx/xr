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
 * and no probe yet, or a discovered local runtime, reported "no model configured". Local
 * readiness must nevertheless come from discovery/probe evidence, never the
 * mere presence of a built-in preset. This file is that predicate, written once, in the
 * affirmative direction.
 *
 * Deliberately NOT loosened: a provider the engine has PROBED and found
 * unreachable is not usable, whatever its kinds and keys say. `unreachable` is
 * an observation and it outranks a guess.
 */
import type { EngineModelsResponse, EngineProvider } from '@/engine/types';

/** The runtime the engine reports as current (GET /models). */
type EngineCurrentRuntime = EngineModelsResponse['current'];

/** Eligibility to TRY a provider, not proof of successful inference.
 * A credential is configuration evidence. A built-in local preset (including
 * hasKey:true for auth:none) says nothing about installation or running state. */
export function providerIsUsable(p: EngineProvider): boolean {
  if (p.healthState === 'unreachable') return false;
  if (p.healthState === 'reachable') return true;
  if (p.kind === 'local') return p.healthy === true; // legacy observed probe only
  return p.hasKey;
}

/** Any provider the engine can run a turn with. */
export function hasUsableProvider(providers: ReadonlyArray<EngineProvider> | null | undefined): boolean {
  return (providers ?? []).some(providerIsUsable);
}

/**
 * The engine's current LOCAL runtime is installed, running, and has models. That beats the
 * provider row's key state, because a local runtime needs no key — this is the
 * "Ollama is up with models, why does the app say nothing is configured" case.
 */
export function localRuntimeUsable(current: EngineCurrentRuntime | null | undefined): boolean {
  return Boolean(current?.installed && current.running && current.models?.length);
}
