/** XR 2.1C — Skill Version Resolution. */
import { maxSatisfying } from "./semver.ts";
import type { VersionResolutionRequest, VersionResolutionResult } from "./marketplace-backend-types.ts";
import { OnlineSkillRegistryClient } from "./online-registry.ts";

export class SkillVersionResolver {
  constructor(private readonly online = new OnlineSkillRegistryClient()) {}

  resolve(req: VersionResolutionRequest): VersionResolutionResult {
    const candidates = this.online
      .allVersions(req.id, req.registryId)
      .filter((row) => req.includeYanked || !row.version.yanked);
    if (!candidates.length) return { ok: false, reason: `skill not found in synced registries: ${req.id}`, candidates: [] };
    const versions = candidates.map((row) => row.version.version);
    const selected = maxSatisfying(versions, req.range);
    if (!selected) return { ok: false, reason: `no version of ${req.id} satisfies ${req.range ?? "latest"}`, candidates: candidates.map((c) => c.version) };
    const row = candidates.find((c) => c.version.version === selected)!;
    return { ok: true, version: row.version, registry: row.registry, candidates: candidates.map((c) => c.version) };
  }
}
