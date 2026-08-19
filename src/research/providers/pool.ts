/**
 * XR Phase 10 — research provider pool (selection + fallback).
 *
 * Deterministic selection: explicit preference first, then availability, then
 * failure count (fewer failures first). Never an LLM decision.
 */

import type { ResearchCapabilityId } from "../provider-types.ts";
import type { ProviderPool, ResearchProvider } from "./types.ts";

export function createProviderPool(providers: ResearchProvider[]): ProviderPool {
  const failures = new Map<string, number>();

  return {
    list: () => [...providers],

    forCapability(capability: ResearchCapabilityId, preferred?: string): ResearchProvider[] {
      const supporting = providers.filter((p) => p.capabilities().includes(capability));
      // Stable sort: explicit preference, then fewer recorded failures.
      supporting.sort((a, b) => {
        if (preferred) {
          if (a.id === preferred) return -1;
          if (b.id === preferred) return 1;
        }
        const fa = failures.get(a.id) ?? 0;
        const fb = failures.get(b.id) ?? 0;
        return fa - fb;
      });
      return supporting;
    },

    recordFailure(providerId: string): void {
      failures.set(providerId, (failures.get(providerId) ?? 0) + 1);
    },

    recordSuccess(providerId: string): void {
      failures.set(providerId, 0);
    },
  };
}
