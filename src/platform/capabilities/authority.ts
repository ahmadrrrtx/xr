/** XR 5.2 — declared vs effective capability authority resolution. */
import type { CapabilityAuthorityVector, CapabilityPermissionDeclaration, CapabilityRiskTier } from "./types.ts";

export interface AuthorityPolicy {
  /** If omitted, this policy layer imposes no allow-list narrowing. */
  allowed?: string[];
  /** Deny always wins, regardless of any allow/grant layer. */
  denied?: string[];
  /** Marks this layer as not knowable; execution must fail closed. */
  undetermined?: boolean;
  label?: string;
}

export interface EffectiveAuthorityInput {
  declared: string[];
  publisherPolicy?: AuthorityPolicy;
  packagePolicy?: AuthorityPolicy;
  workspacePolicy?: AuthorityPolicy;
  userGrant?: AuthorityPolicy;
  agentTaskGrant?: AuthorityPolicy;
  trustPlacementLimit?: AuthorityPolicy;
  /** Deny list that is applied after all layers. */
  denied?: string[];
  /** When true, missing user/task grant means authority cannot be determined. */
  requireExplicitGrant?: boolean;
}

function uniq(xs: readonly string[] | undefined): string[] {
  return [...new Set((xs ?? []).filter(Boolean).map(String))].sort();
}

function intersect(left: string[], right: string[] | undefined): string[] {
  if (!right) return left;
  const set = new Set(right);
  return left.filter((x) => set.has(x));
}

function policyList(p?: AuthorityPolicy): string[] {
  return uniq(p?.allowed);
}

function deniedList(input: EffectiveAuthorityInput): string[] {
  return uniq([
    ...(input.denied ?? []),
    ...(input.publisherPolicy?.denied ?? []),
    ...(input.packagePolicy?.denied ?? []),
    ...(input.workspacePolicy?.denied ?? []),
    ...(input.userGrant?.denied ?? []),
    ...(input.agentTaskGrant?.denied ?? []),
    ...(input.trustPlacementLimit?.denied ?? []),
  ]);
}

export function resolveEffectiveAuthority(input: EffectiveAuthorityInput): CapabilityAuthorityVector {
  const declared = uniq(input.declared);
  const denied = deniedList(input);
  let effective = [...declared];
  let undetermined = false;
  const reasons: string[] = [];

  const layers: Array<[keyof CapabilityAuthorityVector, AuthorityPolicy | undefined]> = [
    ["publisherPolicy", input.publisherPolicy],
    ["packagePolicy", input.packagePolicy],
    ["workspacePolicy", input.workspacePolicy],
    ["userGrant", input.userGrant],
    ["agentTaskGrant", input.agentTaskGrant],
    ["trustPlacementLimit", input.trustPlacementLimit],
  ];

  for (const [name, layer] of layers) {
    if (layer?.undetermined) {
      undetermined = true;
      reasons.push(`${layer.label ?? name} undetermined`);
    }
    if (layer?.allowed) effective = intersect(effective, uniq(layer.allowed));
  }

  if (input.requireExplicitGrant && !input.userGrant?.allowed) {
    undetermined = true;
    reasons.push("user grant missing");
  }
  if (input.requireExplicitGrant && !input.agentTaskGrant?.allowed) {
    undetermined = true;
    reasons.push("agent/task grant missing");
  }

  const deniedSet = new Set(denied);
  effective = effective.filter((p) => !deniedSet.has(p)).sort();

  return {
    declared,
    publisherPolicy: policyList(input.publisherPolicy),
    packagePolicy: policyList(input.packagePolicy),
    workspacePolicy: policyList(input.workspacePolicy),
    userGrant: policyList(input.userGrant),
    agentTaskGrant: policyList(input.agentTaskGrant),
    trustPlacementLimit: policyList(input.trustPlacementLimit),
    denied,
    effective: undetermined ? [] : effective,
    undetermined,
    reason: reasons.length ? reasons.join("; ") : undefined,
  };
}

const TIER2 = new Set([
  "shell",
  "control",
  "browser",
  "secrets",
  "computer:act",
  "computer:read-screen",
  "credential",
]);

const TIER1 = new Set([
  "fs:write",
  "net",
  "mcp",
  "provider",
  "memory:write",
  "workflow:run",
  "skill:execute",
  "skill:install",
  "skill:update",
  "skill:publish",
  "git",
  "db",
  "analytics:write",
]);

export function riskTierForPermissions(scopes: readonly string[], undetermined = false): CapabilityRiskTier {
  if (undetermined) return "blocked";
  if (scopes.some((p) => TIER2.has(p))) return "tier2";
  if (scopes.some((p) => TIER1.has(p))) return "tier1";
  return "tier0";
}

export function placementLimitForRisk(risk: CapabilityRiskTier): string[] {
  if (risk === "blocked") return [];
  if (risk === "tier2") return ["fs:read", "memory:read", "ui", "voice", "provider", "net", "mcp", "fs:write", "memory:write", "secrets"];
  if (risk === "tier1") return ["fs:read", "memory:read", "ui", "voice", "provider", "net", "mcp", "fs:write", "memory:write", "workflow:run", "skill:execute", "git", "db"];
  return ["fs:read", "memory:read", "ui", "voice", "skill:execute"];
}

export function permissionsFromDeclarations(declared: readonly CapabilityPermissionDeclaration[]): string[] {
  return uniq(declared.map((p) => p.scope));
}

export function detectNewAuthority(previousGranted: readonly string[] = [], nextDeclared: readonly string[] = []): string[] {
  const old = new Set(previousGranted);
  return uniq(nextDeclared.filter((p) => !old.has(p)));
}

export function authorityDeterminedOrThrow(vector: CapabilityAuthorityVector, capabilityId: string): void {
  if (vector.undetermined) {
    throw new Error(`effective authority for ${capabilityId} cannot be determined${vector.reason ? `: ${vector.reason}` : ""}`);
  }
}
