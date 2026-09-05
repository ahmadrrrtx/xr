/**
 * XR 6.0 — Portable Task Capsules
 *
 * Task capsules are the portable, versioned, integrity-checked representation
 * of a unit of work that can move between local, private, and remote placements.
 *
 * Rules:
 *   - Capsules NEVER embed raw secrets.
 *   - Capsules are bounded in size.
 *   - Capsules carry authority and provenance — not just data.
 *   - Capsules are integrity-hashed; optionally signed.
 *   - Serialization/deserialization validates the schema version.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  CAPSULE_SCHEMA_VERSION,
  DEPLOYMENT_BOUNDS,
  type TaskCapsule,
  type CapsuleIntent,
  type CapsuleAuthority,
  type CapsulePlacement,
  type CapsuleContext,
  type CapsuleRequirements,
  type CapsuleLimits,
  type CapsuleRecovery,
  type CapsuleArtifactRef,
  type CapsuleProvenance,
  type CapsuleResidency,
  type CapsuleWorkflowRef,
  type DeploymentProfileKind,
} from "./types.ts";
import type { ExecutionId, ActorIdentity } from "@xr/core/execution/types.ts";
import type { RiskTier } from "@xr/core/runtime/trust/types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Capsule Builder
// ═══════════════════════════════════════════════════════════════════════════

export interface CapsuleBuildInput {
  executionId: ExecutionId;
  actor: ActorIdentity;
  intent: CapsuleIntent;
  authority: CapsuleAuthority;
  placement: CapsulePlacement;
  context: CapsuleContext;
  requirements: CapsuleRequirements;
  limits: CapsuleLimits;
  recovery?: CapsuleRecovery;
  artifacts?: readonly CapsuleArtifactRef[];
  provenance: CapsuleProvenance;
  residency: CapsuleResidency;
  workflowRef?: CapsuleWorkflowRef;
}

/**
 * Build a new task capsule from the provided inputs.
 * Validates all bounds and computes the integrity hash.
 */
export function buildCapsule(input: CapsuleBuildInput): TaskCapsule {
  validateCapsuleInputs(input);

  const capsuleId = `cap_${randomUUID().replace(/-/g, "")}`;
  const now = Date.now();

  // Compute integrity hash over the payload (excluding hash itself)
  const payloadForHash = {
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    capsuleId,
    createdAt: now,
    executionId: input.executionId,
    actor: input.actor,
    intent: input.intent,
    workflowRef: input.workflowRef,
    authority: input.authority,
    placement: input.placement,
    context: input.context,
    requirements: input.requirements,
    limits: input.limits,
    recovery: input.recovery,
    artifacts: input.artifacts ?? [],
    provenance: input.provenance,
    residency: input.residency,
  };

  const integrityHash = computeIntegrityHash(payloadForHash);

  const capsule: TaskCapsule = {
    ...payloadForHash,
    integrityHash,
  };

  return capsule;
}

/**
 * Validate capsule build inputs against bounds.
 */
function validateCapsuleInputs(input: CapsuleBuildInput): void {
  // Intent bounds
  if (input.intent.summary.length > DEPLOYMENT_BOUNDS.MAX_CAPSULE_INTENT_CHARS) {
    throw new CapsuleValidationError(
      `Intent summary exceeds maximum ${DEPLOYMENT_BOUNDS.MAX_CAPSULE_INTENT_CHARS} characters`
    );
  }

  // Context refs bounds
  if (input.context.contextRefs.length > DEPLOYMENT_BOUNDS.MAX_CAPSULE_CONTEXT_REFS) {
    throw new CapsuleValidationError(
      `Context refs exceed maximum ${DEPLOYMENT_BOUNDS.MAX_CAPSULE_CONTEXT_REFS}`
    );
  }

  // Artifacts bounds
  const artifactCount = input.artifacts?.length ?? 0;
  if (artifactCount > DEPLOYMENT_BOUNDS.MAX_CAPSULE_ARTIFACT_REFS) {
    throw new CapsuleValidationError(
      `Artifact refs exceed maximum ${DEPLOYMENT_BOUNDS.MAX_CAPSULE_ARTIFACT_REFS}`
    );
  }

  // Requirements bounds
  if (input.requirements.capabilities.length > DEPLOYMENT_BOUNDS.MAX_CAPSULE_REQUIREMENTS) {
    throw new CapsuleValidationError(
      `Capability requirements exceed maximum ${DEPLOYMENT_BOUNDS.MAX_CAPSULE_REQUIREMENTS}`
    );
  }

  // Provenance chain bounds
  if (input.provenance.transferChain.length > DEPLOYMENT_BOUNDS.MAX_TRANSFER_CHAIN) {
    throw new CapsuleValidationError(
      `Transfer chain exceeds maximum ${DEPLOYMENT_BOUNDS.MAX_TRANSFER_CHAIN}`
    );
  }

  // Must have at least one placement target
  if (!input.placement.allowLocal && !input.placement.allowRemote) {
    throw new CapsuleValidationError(
      "Capsule must allow at least local or remote placement"
    );
  }

  // Limits must be positive
  if (input.limits.maxCostUsd < 0) {
    throw new CapsuleValidationError("maxCostUsd must be non-negative");
  }
  if (input.limits.maxDurationMs <= 0) {
    throw new CapsuleValidationError("maxDurationMs must be positive");
  }
  if (input.limits.maxRetries < 0) {
    throw new CapsuleValidationError("maxRetries must be non-negative");
  }

  // Residency: if mustNotLeaveOrigin, forbidden regions should include all non-origin
  if (input.residency.mustNotLeaveOrigin && input.residency.allowedRegions.length > 1) {
    throw new CapsuleValidationError(
      "mustNotLeaveOrigin capsule should not allow multiple regions"
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Capsule Serialization / Deserialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Serialize a capsule to a JSON-safe string.
 * The output is suitable for transfer over the wire or persistence.
 */
export function serializeCapsule(capsule: TaskCapsule): string {
  return JSON.stringify(capsule, null, 0);
}

/**
 * Deserialize a capsule from a JSON string.
 * Validates the schema version and integrity hash.
 */
export function deserializeCapsule(json: string): TaskCapsule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new CapsuleValidationError("Invalid JSON: " + (err instanceof Error ? err.message : String(err)));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CapsuleValidationError("Capsule must be a JSON object");
  }

  const capsule = parsed as Record<string, unknown>;

  // Schema version check
  const schemaVersion = capsule.schemaVersion as string | undefined;
  if (!schemaVersion) {
    throw new CapsuleValidationError("Missing schemaVersion");
  }
  if (!isCompatibleCapsuleVersion(schemaVersion)) {
    throw new CapsuleValidationError(
      `Incompatible capsule schema: got ${schemaVersion}, expected ${CAPSULE_SCHEMA_VERSION}`
    );
  }

  // Required fields
  const requiredFields = [
    "capsuleId", "createdAt", "executionId", "actor", "intent",
    "authority", "placement", "context", "requirements", "limits",
    "provenance", "residency", "integrityHash",
  ];
  for (const field of requiredFields) {
    if (!(field in capsule)) {
      throw new CapsuleValidationError(`Missing required field: ${field}`);
    }
  }

  // Integrity verification
  const receivedHash = capsule.integrityHash as string;
  const computedHash = computeCapsuleIntegrityHash(capsule);
  if (receivedHash !== computedHash) {
    throw new CapsuleIntegrityError(
      `Capsule integrity check failed: expected ${computedHash}, got ${receivedHash}`
    );
  }

  return capsule as unknown as TaskCapsule;
}

/**
 * Check if a capsule schema version is compatible with the current runtime.
 * Compatible means same major version or explicitly forward-compatible.
 */
export function isCompatibleCapsuleVersion(version: string): boolean {
  // xr-6.0.0/capsule-v1 is the first version
  // All xr-6.x capsule-v1 are compatible
  if (version.startsWith("xr-6.") && version.includes("/capsule-v1")) {
    return true;
  }
  // Future major versions (xr-7.x, xr-8.x etc) with capsule-v1 may declare backward compatibility
  // but only if they explicitly use the xr-6+ prefix
  if (/^xr-[7-9]\./.test(version) && version.includes("/capsule-v1")) {
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Capsule Integrity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute an integrity hash for a capsule payload.
 * SHA-256 of the canonical JSON representation.
 */
function computeIntegrityHash(payload: Record<string, unknown>): string {
  const canonical = canonicalJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compute integrity hash from a parsed capsule (excluding the hash field itself).
 */
function computeCapsuleIntegrityHash(capsule: Record<string, unknown>): string {
  const { integrityHash: _, signature: __, ...payload } = capsule;
  return computeIntegrityHash(payload as Record<string, unknown>);
}

/**
 * Verify a capsule's integrity hash.
 */
export function verifyCapsuleIntegrity(capsule: TaskCapsule): boolean {
  const { integrityHash: _, signature: __, ...payload } = capsule as unknown as Record<string, unknown>;
  const computed = computeIntegrityHash(payload as Record<string, unknown>);
  return computed === capsule.integrityHash;
}

/**
 * Canonical JSON: sorted keys, no whitespace, deterministic.
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([_, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v)).join(",") + "}";
  }
  return JSON.stringify(value);
}

// ═══════════════════════════════════════════════════════════════════════════
// Capsule Redaction (for control-plane transfer)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a redacted version of a capsule suitable for control plane visibility.
 * Removes sensitive context references and limits detail exposure.
 */
export function redactCapsuleForControlPlane(capsule: TaskCapsule): Record<string, unknown> {
  return {
    capsuleId: capsule.capsuleId,
    schemaVersion: capsule.schemaVersion,
    createdAt: capsule.createdAt,
    executionId: capsule.executionId,
    actor: capsule.actor,
    intent: capsule.intent,
    workflowRef: capsule.workflowRef,
    authority: {
      policyVersion: capsule.authority.policyVersion,
      riskTier: capsule.authority.riskTier,
      approvalRef: capsule.authority.approvalRef,
      // Deliberately omit grantRef and permissionsHash
    },
    placement: capsule.placement,
    context: {
      // Redact context refs to counts only
      contextRefCount: capsule.context.contextRefs.length,
      consentScope: capsule.context.consentScope,
      sensitiveContextTransfer: capsule.context.sensitiveContextTransfer,
    },
    requirements: capsule.requirements,
    limits: capsule.limits,
    residency: capsule.residency,
    provenance: capsule.provenance,
    integrityHash: capsule.integrityHash,
  };
}

/**
 * Create a redacted capsule for logging/audit (safe for external consumption).
 */
export function redactCapsuleForAudit(capsule: TaskCapsule): Record<string, unknown> {
  return {
    capsuleId: capsule.capsuleId,
    createdAt: capsule.createdAt,
    runId: capsule.executionId.runId,
    workspaceId: capsule.executionId.workspaceId,
    actorKind: capsule.actor.kind,
    intentSummary: capsule.intent.summary.slice(0, 200),
    riskTier: capsule.authority.riskTier,
    placementAllowLocal: capsule.placement.allowLocal,
    placementAllowRemote: capsule.placement.allowRemote,
    dataClassification: capsule.residency.dataClassification,
    integrityHash: capsule.integrityHash.slice(0, 16) + "...",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Capsule Transfer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a transfer of a capsule between instances.
 * Returns a new capsule with the transfer chain updated and integrity re-hashed.
 */
export function recordCapsuleTransfer(
  capsule: TaskCapsule,
  from: string,
  to: string,
  reason: string,
  approvedBy?: string,
): TaskCapsule {
  const newTransferRecord = {
    from,
    to,
    at: Date.now(),
    reason,
    approvedBy,
  };

  const updatedProvenance: CapsuleProvenance = {
    ...capsule.provenance,
    transferChain: [...capsule.provenance.transferChain, newTransferRecord],
  };

  // Rebuild capsule with new provenance and recompute hash
  const { integrityHash: _, signature: __, ...rest } = capsule as unknown as Record<string, unknown>;
  const payload = {
    ...rest,
    provenance: updatedProvenance,
  };

  const newHash = computeIntegrityHash(payload as Record<string, unknown>);

  return {
    ...(capsule as unknown as Record<string, unknown>),
    provenance: updatedProvenance,
    integrityHash: newHash,
  } as unknown as TaskCapsule;
}

/**
 * Check if a capsule has expired (exceeded maximum age).
 */
export function isCapsuleExpired(capsule: TaskCapsule): boolean {
  const age = Date.now() - capsule.createdAt;
  return age > DEPLOYMENT_BOUNDS.CAPSULE_MAX_AGE_MS;
}

/**
 * Check if a capsule can be executed in the given profile.
 */
export function isCapsuleCompatibleWithProfile(
  capsule: TaskCapsule,
  profile: DeploymentProfileKind,
): boolean {
  // Check residency constraints
  if (capsule.residency.mustNotLeaveOrigin) {
    if (profile !== capsule.provenance.originProfile) {
      return false;
    }
  }

  // Check remote capability
  if (capsule.placement.allowRemote && !capsule.placement.allowLocal) {
    // Capsule requires remote; personal_local doesn't support it
    if (profile === "personal_local") {
      return false;
    }
  }

  // Check local-only constraint
  if (capsule.placement.allowLocal && !capsule.placement.allowRemote) {
    // Capsule requires local only — all profiles support local
    return true;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

export class CapsuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapsuleValidationError";
  }
}

export class CapsuleIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapsuleIntegrityError";
  }
}
