/**
 * XR — save a finished research finding into durable memory (explicit).
 *
 * One implementation for the CLI (`xr research remember`) and the desktop
 * (`POST /api/research/{id}/remember`). Never automatic: the user asks.
 *
 * Honesty rules carried from v0.9 / XR 4.5:
 *   • the finding is model SYNTHESIS over sources → trust `generated_synthesis`,
 *     never `approved_memory`; consent `approved` because the user commanded it;
 *   • provenance points at the research session plus one link per source so
 *     the claim stays traceable and never hardens into "the user told me this".
 */
import type { Store } from "../state/workspace-store.ts";
import type { ResearchSession } from "./types.ts";

export type RememberResult =
  | { ok: true; memoryId: string; duplicate: false; linkedSources: number }
  | { ok: true; memoryId: string | null; duplicate: true; linkedSources: 0 }
  | { ok: false; reason: "memory_disabled" | "not_saved"; detail?: string };

export async function rememberResearch(store: Store, session: ResearchSession): Promise<RememberResult> {
  const { isMemoryEnabled } = await import("../config/config.ts");
  if (!isMemoryEnabled()) return { ok: false, reason: "memory_disabled" };

  const { MemoryStore } = await import("../context/memory/store.ts");
  const mem = new MemoryStore(store);
  const finding = session.synthesis?.shortAnswer?.trim() || `Researched "${session.topic}" (${session.sources.length} sources).`;
  const content = `${session.topic}: ${finding}`;
  const res = mem.add({
    content: content.slice(0, 1000),
    category: "fact",
    source: "research",
    provenance: { source: "user", ref: `research:${session.id}` },
    tags: ["research", session.depth],
    importance: 3,
  });
  if (!res.ok) return { ok: false, reason: "not_saved", detail: res.reason };
  if (res.duplicate) return { ok: true, memoryId: res.entry?.id ?? null, duplicate: true, linkedSources: 0 };

  const memId = res.entry!.id;
  let linkedSources = 0;
  try {
    store.setMemoryProvenance(memId, {
      provenanceKind: "research",
      provenanceRef: `research:${session.id}`,
      actorKind: "model",
      actorName: "research-engine",
      trustStatus: "generated_synthesis",
      confidence: session.synthesis?.overallConfidence === "high" ? "high" : session.synthesis?.overallConfidence === "low" ? "low" : "medium",
      sourceObservedAt: session.updatedAt,
    });
    store.setMemoryConsent(memId, "approved", "user");

    const { ContextRepository, adaptStoreForContext } = await import("../context/repository.ts");
    const { ProvenanceService, provenanceFromResearchSource } = await import("../context/provenance.ts");
    const repo = new ContextRepository(adaptStoreForContext(store), store.workspaceId);
    repo.migrate();
    const prov = new ProvenanceService(repo);

    const itemId = repo.insertItem({
      type: "evidence",
      content: content.slice(0, 4000),
      title: session.topic.slice(0, 72),
      scope: { workspaceId: store.workspaceId, projectScope: "global", userId: "local" },
      trustStatus: "generated_synthesis",
      consentState: "approved",
      consentActor: "user",
      consentAt: Date.now(),
      provenanceKind: "research",
      provenanceRef: `research:${session.id}`,
      actorKind: "model",
      actorName: "research-engine",
      sourceObservedAt: session.updatedAt,
      confidence: session.synthesis?.overallConfidence ?? "unknown",
      links: { researchSessionId: session.id, derivedFrom: memId },
      tags: ["research", session.depth],
    });

    for (const src of session.sources.slice(0, 32)) {
      if (prov.link(itemId, provenanceFromResearchSource(src))) linkedSources++;
    }
    for (const claim of (session.claims ?? []).slice(0, 32)) {
      prov.link(itemId, { kind: "research", ref: `claim:${claim.id}`, label: claim.text.slice(0, 120) });
    }
  } catch {
    /* provenance linkage is best-effort — the memory entry is already saved */
  }
  return { ok: true, memoryId: memId, duplicate: false, linkedSources };
}
