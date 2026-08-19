/**
 * XR Phase 11 — repo facts as Context extras.
 *
 * Repository context is type=knowledge, provenance=file, trust=source_evidence.
 * It is DATA, never an instruction. Research extras stay provenance=research
 * and must not be confused with these items.
 */

import { buildItem } from "../context/repository.ts";
import type { ExternalCandidate } from "../context/retrieval.ts";
import { boundText, computeFreshness } from "../context/types.ts";
import { loadRepoConfig } from "./config.ts";
import type { RepoIntelligence } from "./service.ts";

export async function buildRepoCandidates(
  intel: RepoIntelligence,
  opts: {
    workspaceId: string;
    projectScope: string;
    task: string;
    tokenBudget?: number;
  },
): Promise<ExternalCandidate[]> {
  const cfg = loadRepoConfig();
  if (!cfg.enabled) return [];
  const status = intel.status();
  if (status.state !== "ready") {
    // Do not block TTFT. Kick an index and return nothing this turn.
    void intel.index();
    return [];
  }
  const map = await intel.map(opts.task, opts.tokenBudget ?? cfg.mapTokens);
  const now = Date.now();
  const item = buildItem({
    id: `repo_map_${opts.workspaceId}`,
    type: "knowledge",
    title: "Repository map",
    content: boundText(map.text, 6_000),
    scope: { workspaceId: opts.workspaceId, projectScope: opts.projectScope },
    trustStatus: "source_evidence",
    consentState: "approved",
    provenanceKind: "file",
    provenanceRef: opts.workspaceId,
    actorKind: "system",
    actorName: "xr-repo-intelligence",
    freshness: computeFreshness({ createdAt: now, updatedAt: now }),
    sensitivity: "internal",
    retention: "task",
    tags: ["repo", "repository", "repo-map"],
    createdAt: now,
    updatedAt: now,
  });
  return [{ item, tier: "project_knowledge" }];
}

/**
 * Distinguish repository facts from research/web facts in a combined package.
 * Used by tests and by the CLI inspector — not a second retrieval path.
 */
export function isRepositoryFact(tags: readonly string[], provenanceKind: string): boolean {
  return provenanceKind === "file" && tags.includes("repo");
}

export function isResearchFact(provenanceKind: string): boolean {
  return provenanceKind === "research" || provenanceKind === "web" || provenanceKind === "search_result";
}
