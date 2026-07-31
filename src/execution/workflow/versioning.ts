/**
 * XR 5.0 — Workflow Versioning
 *
 * Workflow definitions are immutable once published. Each publish increments
 * the version. Active runs reference a specific definition version and are
 * never silently migrated.
 */

import type {
  DefinitionIntegrityResult,
  WorkflowDefinition,
} from "./types.ts";
import { WORKFLOW_DEFINITION_SCHEMA_VERSION, checkDefinitionIntegrity, hashDefinition } from "./types.ts";

/**
 * Create a new draft definition (version 0, not published).
 */
export function createDraft(
  opts: {
    definitionId?: string;
    name: string;
    description?: string;
    nodes: WorkflowDefinition["nodes"];
    entryNodeIds: string[];
    tags?: string[];
    authoredBy: WorkflowDefinition["authoredBy"];
    parameters?: WorkflowDefinition["parameters"];
    expectedArtifacts?: WorkflowDefinition["expectedArtifacts"];
  },
): WorkflowDefinition {
  const def: WorkflowDefinition = {
    definitionId: opts.definitionId ?? `wfd_${Date.now().toString(36)}`,
    name: opts.name,
    description: opts.description,
    version: 0,
    schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    nodes: opts.nodes,
    entryNodeIds: opts.entryNodeIds,
    expectedArtifacts: opts.expectedArtifacts,
    tags: opts.tags ?? [],
    authoredBy: opts.authoredBy,
    publishedAt: 0,
    contentHash: "",
    active: false,
    parameters: opts.parameters,
  };
  def.contentHash = hashDefinition(def);
  return def;
}

/**
 * Publish a draft, creating an immutable version. Returns the published definition
 * with version > 0 and publishedAt set.
 */
export function publishDraft(
  draft: WorkflowDefinition,
  supersedes?: string,
): WorkflowDefinition {
  if (draft.version !== 0) {
    throw new Error("Cannot publish: definition is already published");
  }
  const published: WorkflowDefinition = {
    ...draft,
    version: 1,
    publishedAt: Date.now(),
    active: true,
    supersedes,
  };
  published.contentHash = hashDefinition(published);
  return published;
}

/**
 * Create a new draft version from an existing published definition.
 * The new draft has version 0 (unpublished) and the same definitionId.
 */
export function createNewVersion(
  base: WorkflowDefinition,
  updates: {
    name?: string;
    description?: string;
    nodes?: WorkflowDefinition["nodes"];
    entryNodeIds?: string[];
    tags?: string[];
    authoredBy: WorkflowDefinition["authoredBy"];
    parameters?: WorkflowDefinition["parameters"];
    expectedArtifacts?: WorkflowDefinition["expectedArtifacts"];
  },
): WorkflowDefinition {
  const draft: WorkflowDefinition = {
    definitionId: base.definitionId,
    name: updates.name ?? base.name,
    description: updates.description ?? base.description,
    version: 0,
    schemaVersion: WORKFLOW_DEFINITION_SCHEMA_VERSION,
    nodes: updates.nodes ?? base.nodes,
    entryNodeIds: updates.entryNodeIds ?? base.entryNodeIds,
    expectedArtifacts: updates.expectedArtifacts ?? base.expectedArtifacts,
    tags: updates.tags ?? base.tags,
    authoredBy: updates.authoredBy,
    publishedAt: 0,
    contentHash: "",
    active: false,
    parameters: updates.parameters ?? base.parameters,
  };
  draft.contentHash = hashDefinition(draft);
  return draft;
}

/**
 * Publish a new version incrementing from the last published version.
 */
export function publishNewVersion(
  draft: WorkflowDefinition,
  lastPublishedVersion: number,
  supersedes?: string,
): WorkflowDefinition {
  if (draft.version !== 0) {
    throw new Error("Cannot publish: draft already has a version number");
  }
  const published: WorkflowDefinition = {
    ...draft,
    version: lastPublishedVersion + 1,
    publishedAt: Date.now(),
    active: true,
    supersedes,
  };
  published.contentHash = hashDefinition(published);
  return published;
}

/**
 * Verify that a definition's content hash matches.
 */
export function verifyIntegrity(def: WorkflowDefinition): boolean {
  return checkDefinitionIntegrity(def).valid;
}

/**
 * Verify integrity AND report which hashing scheme matched.
 *
 * XR 7.0: definitions published before this release carry a legacy hash that
 * only covered node ids and kinds. They remain loadable (no destructive
 * migration) but are reported as `legacy_v1` so operators can re-publish them
 * to obtain full-content coverage.
 */
export function inspectIntegrity(def: WorkflowDefinition): DefinitionIntegrityResult {
  return checkDefinitionIntegrity(def);
}

/**
 * Check if two definitions are compatible for migration.
 * Migrations are safe when only node IDs are added/removed in a compatible way
 * and no active run states would be corrupted.
 */
export function canMigrateActiveRun(
  from: WorkflowDefinition,
  to: WorkflowDefinition,
): { migratable: boolean; reason?: string } {
  if (from.definitionId !== to.definitionId) {
    return { migratable: false, reason: "Different definition IDs" };
  }
  if (from.version >= to.version) {
    return { migratable: false, reason: "Target version is not newer" };
  }
  // Migration is allowed when:
  // - All nodes present in the old definition exist in the new one
  // - No node kind changes for existing nodes
  // - Dependencies are only added, never removed from existing nodes
  const oldIds = new Set(from.nodes.map(n => n.id));
  for (const oldNode of from.nodes) {
    const newNode = to.nodes.find(n => n.id === oldNode.id);
    if (!newNode) {
      return { migratable: false, reason: `Node ${oldNode.id} removed in new version` };
    }
    if (newNode.kind !== oldNode.kind) {
      return { migratable: false, reason: `Node ${oldNode.id} kind changed` };
    }
    for (const dep of oldNode.dependencies) {
      if (!newNode.dependencies.includes(dep)) {
        return { migratable: false, reason: `Dependency removed from node ${oldNode.id}` };
      }
    }
  }
  return { migratable: true };
}
