/** XR 5.2 — adapters from existing extension planes to common descriptors. */
import type { Tool } from "../core/types.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import type { PluginManifest, PermissionScope } from "../plugins/types.ts";
import type { RegistryEntry as PluginRegistryEntry } from "../plugins/registry.ts";
import type { UnifiedSkillRecord } from "../skills/adapters.ts";
import type { SkillInstallation, SkillManifest } from "../skills/schema.ts";
import type { McpRegistryEntry } from "../mcp/registry.ts";
import type { ProviderPreset } from "../providers/presets.ts";
import { capabilityLabels } from "../providers/capabilities.ts";
import type { WorkflowDefinition } from "../execution/workflow/types.ts";
import type { ConnectorDefinition } from "../integrations/registry.ts";
import type {
  CapabilityAuthorityVector,
  CapabilityCertification,
  CapabilityCredentialRequirement,
  CapabilityDataScope,
  CapabilityDependency,
  CapabilityDescriptor,
  CapabilityInterface,
  CapabilityLifecycle,
  CapabilityLifecycleState,
  CapabilityNetworkRequirement,
  CapabilityPackageIntegrity,
  CapabilityPermissionDeclaration,
  CapabilityPlacement,
  CapabilityPlacementRequirement,
  CapabilityProvenance,
  CapabilityPublisherIdentity,
  CapabilitySignatureStatus,
  CapabilityTrustSignals,
  CapabilityType,
} from "./types.ts";
import { CAPABILITY_DESCRIPTOR_SCHEMA_VERSION, capabilityId } from "./types.ts";
import { permissionsFromDeclarations, resolveEffectiveAuthority, riskTierForPermissions } from "./authority.ts";
import { runCapabilityContractTests, certificationEvidenceScore } from "./certification.ts";
import type { CapabilityOverlay } from "./store.ts";

const NOW = () => Date.now();

function slug(input: string | undefined, fallback: string): string {
  return (input || fallback).toLowerCase().replace(/[^a-z0-9@/._:-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function uniq(xs: readonly string[] | undefined): string[] {
  return [...new Set((xs ?? []).filter(Boolean).map(String))].sort();
}

function signatureStatus(signature?: string, hash?: string, trustLevel?: string): CapabilitySignatureStatus {
  if (signature) return "valid";
  if (hash) return "unverified";
  if (trustLevel === "official" || trustLevel === "verified") return "unknown";
  return "unsigned";
}

function publisher(id: string, name?: string, trustLevel = "unknown", verified = false, keyId?: string, website?: string): CapabilityPublisherIdentity {
  return { id: slug(id, "unknown"), name: name || id || "unknown", verified, trustLevel, keyId, website };
}

function certificationFromTrust(trustLevel: string | undefined, hasTests = false): CapabilityCertification {
  if (trustLevel === "official" || trustLevel === "verified") return { status: "verified", tests: [], reason: trustLevel };
  if (trustLevel === "reviewed") return { status: "xr-tested", tests: [], reason: "reviewed" };
  if (hasTests) return { status: "self-tested", tests: [], reason: "declares tests" };
  return { status: "unknown", tests: [] };
}

function applyOverlay(descriptor: CapabilityDescriptor, overlay?: CapabilityOverlay): CapabilityDescriptor {
  if (!overlay) return finalizeDescriptor(descriptor);
  const state = (overlay.state as CapabilityLifecycleState | undefined) ?? descriptor.lifecycle.state;
  const certification = (overlay.certification as CapabilityCertification | undefined) ?? descriptor.certification;
  const vulnerabilityStatus = overlay.vulnerabilityStatus ?? descriptor.trust.vulnerabilityStatus;
  const maintenanceStatus = overlay.maintenanceStatus ?? descriptor.trust.maintenanceStatus;
  const history = [...descriptor.lifecycle.history, ...(overlay.history ?? [])].slice(-200);
  const next: CapabilityDescriptor = {
    ...descriptor,
    certification,
    lifecycle: {
      ...descriptor.lifecycle,
      state,
      enabled: state === "quarantined" ? false : descriptor.lifecycle.enabled,
      quarantineReason: overlay.quarantineReason ?? descriptor.lifecycle.quarantineReason,
      pendingReview: Boolean(overlay.pendingReview) || descriptor.lifecycle.pendingReview,
      history,
    },
    trust: {
      ...descriptor.trust,
      certificationStatus: certification.status,
      vulnerabilityStatus,
      maintenanceStatus,
      evidence: [...descriptor.trust.evidence, ...(overlay.trustDecisionReason ? [`trust decision: ${overlay.trustDecisionReason}`] : [])],
    },
    support: { ...descriptor.support, maintenance: maintenanceStatus },
  };
  return finalizeDescriptor(next);
}

function finalizeDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  const cert = descriptor.certification.tests.length ? descriptor.certification : runCapabilityContractTests(descriptor, { xrTested: false });
  const evidenceScore = Math.max(descriptor.trust.evidenceScore, certificationEvidenceScore(cert));
  return {
    ...descriptor,
    certification: cert,
    trust: {
      ...descriptor.trust,
      certificationStatus: cert.status,
      evidenceScore,
      signedPackage: descriptor.package.signatureStatus === "valid",
      signatureStatus: descriptor.package.signatureStatus,
    },
  };
}

function dataScopesFromPermissions(scopes: readonly string[]): CapabilityDataScope[] {
  const out: CapabilityDataScope[] = [];
  if (scopes.includes("fs:read") || scopes.includes("fs:write")) out.push({ kind: "filesystem", access: scopes.includes("fs:write") ? "read_write" : "read", scope: "declared/host-confined" });
  if (scopes.includes("memory:read") || scopes.includes("memory:write")) out.push({ kind: "memory", access: scopes.includes("memory:write") ? "read_write" : "read", scope: "XR durable memory policy" });
  if (scopes.includes("secrets")) out.push({ kind: "credential", access: "read", scope: "named secrets only" });
  if (scopes.includes("net")) out.push({ kind: "network", access: "read_write", scope: "XR egress allow-list" });
  if (scopes.includes("provider")) out.push({ kind: "provider", access: "read_write", scope: "XR provider/budget gate" });
  return out.length ? out : [{ kind: "unknown", access: "none" }];
}

function networkFromPermissions(scopes: readonly string[], domains: string[] = [], locality: CapabilityNetworkRequirement["locality"] = "unknown"): CapabilityNetworkRequirement {
  return { required: scopes.includes("net") || domains.length > 0, domains: uniq(domains), locality, reason: scopes.includes("net") ? "declares network authority" : domains.length ? "network endpoint declared" : undefined };
}

function credentialsFromScopes(scopes: readonly string[], refs: string[] = []): CapabilityCredentialRequirement {
  return { required: scopes.includes("secrets") || refs.length > 0, refs: uniq(refs), reason: scopes.includes("secrets") ? "declares secret access" : refs.length ? "credential refs declared" : undefined };
}

function placementFor(type: CapabilityType, riskTier: ReturnType<typeof riskTierForPermissions>, remote = false): CapabilityPlacementRequirement {
  let requested: CapabilityPlacement = "in_process";
  if (type === "skill") requested = "prompt_runtime";
  if (type === "workflow") requested = "workflow_engine";
  if (type === "provider") requested = "provider_api";
  if (type === "mcp" && remote) requested = "remote_service";
  if (riskTier === "tier1" && requested === "in_process") requested = "restricted_process";
  if (riskTier === "tier2") requested = "namespace_sandbox";
  if (riskTier === "blocked") requested = "unknown";
  return { requested, riskTier, requiresHostAuthority: false, reason: `${type} adapter risk placement` };
}

function trustSignals(input: {
  trustLevel: string;
  publisherVerified: boolean;
  package: CapabilityPackageIntegrity;
  certification: CapabilityCertification;
  vulnerabilityStatus?: CapabilityTrustSignals["vulnerabilityStatus"];
  maintenanceStatus?: CapabilityTrustSignals["maintenanceStatus"];
  evidence?: string[];
}): CapabilityTrustSignals {
  const evidence = [...(input.evidence ?? [])];
  if (input.publisherVerified) evidence.push("publisher verified");
  if (input.package.signatureStatus === "valid") evidence.push("package signature valid");
  if (input.package.packageSha256 || input.package.treeSha256) evidence.push("package hash recorded");
  if (input.certification.status !== "unknown") evidence.push(`certification: ${input.certification.status}`);
  return {
    trustLevel: input.trustLevel,
    verifiedPublisher: input.publisherVerified,
    signedPackage: input.package.signatureStatus === "valid",
    signatureStatus: input.package.signatureStatus,
    certificationStatus: input.certification.status,
    vulnerabilityStatus: input.vulnerabilityStatus ?? "unknown",
    maintenanceStatus: input.maintenanceStatus ?? "unknown",
    evidenceScore: 0,
    evidence: uniq(evidence),
  };
}

function lifecycle(state: CapabilityLifecycleState, enabled: boolean, installed: boolean, history: CapabilityLifecycle["history"] = [], rollbackAvailable = false, loaded?: boolean): CapabilityLifecycle {
  return { state, enabled, installed, loaded, rollbackAvailable, history };
}

function descriptorBase(args: {
  type: CapabilityType;
  nativeId: string;
  name: string;
  version: string;
  description?: string;
  publisher: CapabilityPublisherIdentity;
  provenance: CapabilityProvenance;
  package: CapabilityPackageIntegrity;
  compatibility?: CapabilityDescriptor["compatibility"];
  dependencies?: CapabilityDependency[];
  declarations?: CapabilityPermissionDeclaration[];
  granted?: string[];
  denied?: string[];
  interfaces?: CapabilityInterface[];
  lifecycle: CapabilityLifecycle;
  network?: CapabilityNetworkRequirement;
  credentials?: CapabilityCredentialRequirement;
  providerRequirements?: CapabilityDescriptor["providerRequirements"];
  placement?: CapabilityPlacementRequirement;
  certification?: CapabilityCertification;
  trustLevel?: string;
  support?: CapabilityDescriptor["support"];
  cost?: CapabilityDescriptor["cost"];
  tags?: string[];
  keywords?: string[];
  overlay?: CapabilityOverlay;
}): CapabilityDescriptor {
  const declarations = args.declarations ?? [];
  const declared = permissionsFromDeclarations(declarations);
  const effective: CapabilityAuthorityVector = resolveEffectiveAuthority({
    declared,
    workspacePolicy: { denied: args.denied ?? [] },
    userGrant: { allowed: args.granted ?? declared },
    agentTaskGrant: { allowed: args.granted ?? declared },
    denied: args.denied,
  });
  const riskTier = riskTierForPermissions(effective.effective, effective.undetermined);
  const cert = args.certification ?? certificationFromTrust(args.trustLevel, false);
  const pack = args.package;
  const desc: CapabilityDescriptor = {
    schemaVersion: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    id: capabilityId(args.type, args.nativeId),
    nativeId: args.nativeId,
    type: args.type,
    name: args.name,
    version: args.version,
    description: args.description,
    publisher: args.publisher,
    provenance: args.provenance,
    package: pack,
    compatibility: args.compatibility ?? { xr: CORE_VERSION },
    dependencies: args.dependencies ?? [],
    permissions: { declared: declarations, effective },
    dataScopes: dataScopesFromPermissions(effective.effective),
    network: args.network ?? networkFromPermissions(effective.effective),
    credentials: args.credentials ?? credentialsFromScopes(effective.effective),
    providerRequirements: args.providerRequirements ?? { providerIds: [], modelCapabilities: [] },
    placement: args.placement ?? placementFor(args.type, riskTier),
    interfaces: args.interfaces ?? [],
    certification: cert,
    lifecycle: args.lifecycle,
    trust: trustSignals({ trustLevel: args.trustLevel ?? args.publisher.trustLevel, publisherVerified: args.publisher.verified, package: pack, certification: cert }),
    support: args.support ?? { maintenance: "unknown" },
    cost: args.cost ?? { cpu: "unknown" },
    tags: uniq(args.tags),
    keywords: uniq(args.keywords),
  };
  return applyOverlay(desc, args.overlay);
}

export function descriptorFromPlugin(manifest: PluginManifest, entry?: PluginRegistryEntry, overlay?: CapabilityOverlay, denied: string[] = []): CapabilityDescriptor {
  const declared: CapabilityPermissionDeclaration[] = manifest.permissions.map((scope) => ({ scope, reason: `Plugin manifest requests ${scope}`, dangerous: ["shell", "control", "browser", "secrets", "fs:write", "net"].includes(scope), declaredBy: "manifest" }));
  const pack: CapabilityPackageIntegrity = {
    packageSha256: manifest.trust.sha256 ?? entry?.installedHash,
    treeSha256: manifest.trust.treeSha256 ?? entry?.treeHash,
    signatureStatus: signatureStatus(manifest.trust.signature, manifest.trust.sha256 ?? entry?.installedHash, manifest.trustLevel),
    signatureKeyId: manifest.trust.keyId,
    verifiedAt: manifest.trust.reviewedAt ? Date.parse(manifest.trust.reviewedAt) || undefined : undefined,
  };
  const deps = manifest.dependencies.map((id) => ({ type: "plugin" as const, id, status: "unknown" as const }));
  const interfaces: CapabilityInterface[] = [
    ...manifest.capabilities.map((c) => ({ kind: c.kind as CapabilityInterface["kind"], name: c.name, description: c.description })),
    ...manifest.commandHooks.map((name) => ({ kind: "command" as const, name })),
    ...manifest.toolHooks.map((name) => ({ kind: "tool" as const, name })),
    ...manifest.skillPaths.map((name) => ({ kind: "skill" as const, name })),
    ...manifest.mcpServers.map((s) => ({ kind: "mcp_tool" as const, name: s.id, description: s.description })),
    ...manifest.uiHooks.map((u) => ({ kind: "ui" as const, name: u.id, description: u.description })),
  ];
  const state: CapabilityLifecycleState = overlay?.state as any || (entry ? (entry.enabled ? "enabled" : "disabled") : "discovered");
  return descriptorBase({
    type: "plugin",
    nativeId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    publisher: publisher(manifest.author, manifest.author, manifest.trustLevel, ["verified", "official"].includes(manifest.trustLevel), manifest.trust.keyId, manifest.homepage),
    provenance: { source: typeof manifest.source === "string" ? "unknown" : (manifest.source?.kind as any) ?? "local", sourceUrl: typeof manifest.source === "string" ? manifest.source : manifest.source?.url ?? manifest.sourceUrl, ref: typeof manifest.source === "string" ? undefined : manifest.source?.ref, installedAt: entry?.installedAt, updatedAt: entry?.updatedAt, observedAt: NOW() },
    package: pack,
    compatibility: { xr: manifest.compatibility, apiVersion: manifest.apiVersion, notes: [`core ${CORE_VERSION}`, `plugin api ${PLUGIN_API_VERSION}`] },
    dependencies: deps,
    declarations: declared,
    granted: entry?.grantedPermissions,
    denied,
    interfaces,
    lifecycle: lifecycle(state, Boolean(entry?.enabled), Boolean(entry), (entry?.history ?? []).map((h) => ({ at: h.at, action: h.action, detail: h.detail })), Boolean((entry as any)?.rollback?.length), undefined),
    network: networkFromPermissions(entry?.grantedPermissions ?? manifest.permissions, manifest.mcpServers.flatMap((s) => s.url ? [s.url] : []), manifest.mcpServers.some((s) => s.transport === "http") ? "internet" : "unknown"),
    credentials: credentialsFromScopes(entry?.grantedPermissions ?? manifest.permissions, manifest.mcpServers.flatMap((s) => s.apiKeyEnv ? [s.apiKeyEnv] : [])),
    certification: certificationFromTrust(manifest.trustLevel, false),
    trustLevel: manifest.trustLevel,
    support: { homepage: manifest.homepage, license: manifest.license, maintenance: "unknown" },
    tags: [manifest.type, ...manifest.keywords],
    keywords: [manifest.id, manifest.name, manifest.description, ...manifest.keywords],
    overlay,
  });
}

export function descriptorFromSkill(record: UnifiedSkillRecord, installation?: SkillInstallation, overlay?: CapabilityOverlay, denied: string[] = []): CapabilityDescriptor {
  const m: SkillManifest = record.manifest;
  const declared = m.permissions.map((p) => ({ scope: p.scope, reason: p.reason, optional: p.optional, dangerous: p.dangerous, paths: p.paths, domains: p.domains, declaredBy: "manifest" as const }));
  const pack: CapabilityPackageIntegrity = {
    packageSha256: m.verification.checksum,
    signatureStatus: signatureStatus(m.verification.signature, m.verification.checksum, m.verification.level),
    signatureKeyId: undefined,
    verifiedAt: m.verification.reviewedAt ? Date.parse(m.verification.reviewedAt) || undefined : undefined,
  };
  const deps = m.dependencies.map((d) => ({ type: d.kind === "skill" || d.kind === "plugin" || d.kind === "mcp" || d.kind === "provider" ? d.kind : d.kind as any, id: d.id, version: d.version, optional: d.optional, status: "unknown" as const, reason: d.reason }));
  const interfaces: CapabilityInterface[] = [
    ...m.contributions.commands.map((c) => ({ kind: "command" as const, name: c.name, description: c.description })),
    ...m.contributions.slashCommands.map((c) => ({ kind: "command" as const, name: c.name, description: c.description })),
    ...m.contributions.chatActions.map((a) => ({ kind: "prompt" as const, name: a.id, description: a.description })),
    ...m.contributions.workflows.map((w) => ({ kind: "workflow" as const, name: w.id, description: w.description })),
    ...m.mcp.map((s) => ({ kind: "mcp_tool" as const, name: s.id, description: s.reason })),
    ...m.tools.map((t) => ({ kind: "tool" as const, name: t })),
  ];
  const state: CapabilityLifecycleState = overlay?.state as any || (record.enabled ? "enabled" : "disabled");
  const trustLevel = m.verification.level === "official" ? "official" : m.verification.level === "verified" ? "verified" : m.verification.level;
  return descriptorBase({
    type: "skill",
    nativeId: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    publisher: publisher(m.publisher, m.publisher, trustLevel, ["verified", "official"].includes(m.verification.level), undefined, m.homepage),
    provenance: { source: record.source === "installed" ? "local" : record.source === "bundled" ? "bundled" : record.source as any, sourceUrl: installation?.sourceUrl ?? m.repository ?? m.homepage, installedAt: installation?.installedAt, updatedAt: installation?.updatedAt, observedAt: NOW() },
    package: pack,
    compatibility: { xr: m.compatibility.xr, os: m.compatibility.os, providers: m.compatibility.providers, modes: m.compatibility.modes },
    dependencies: deps,
    declarations: declared,
    granted: installation?.grantedPermissions ?? m.permissions.filter((p) => !p.dangerous).map((p) => p.scope),
    denied,
    interfaces,
    lifecycle: lifecycle(state, record.enabled, record.installed, installation ? [{ at: installation.installedAt, action: "install", detail: installation.source }, { at: installation.updatedAt, action: "update", detail: installation.version }] : [], Boolean(installation?.rollback.length), undefined),
    network: networkFromPermissions(installation?.grantedPermissions ?? m.permissions.map((p) => p.scope), m.permissions.flatMap((p) => p.domains ?? [])),
    credentials: credentialsFromScopes(installation?.grantedPermissions ?? m.permissions.map((p) => p.scope), m.settings.filter((s) => s.type === "secret").map((s) => s.key)),
    providerRequirements: { providerIds: m.compatibility.providers, modelCapabilities: [], locality: "any" },
    certification: certificationFromTrust(trustLevel, m.content.tests.length > 0),
    trustLevel,
    support: { homepage: m.homepage, repository: m.repository, license: m.license, maintenance: "unknown" },
    tags: [...m.categories, ...m.tags, record.kind],
    keywords: [m.id, m.name, m.description, ...m.keywords, ...m.activation.phrases],
    overlay,
  });
}

export function descriptorFromMcp(entry: McpRegistryEntry, overlay?: CapabilityOverlay, denied: string[] = []): CapabilityDescriptor {
  const declared: CapabilityPermissionDeclaration[] = (entry.declaredPermissions ?? []).map((scope) => ({ scope, reason: `MCP server declares ${scope}`, dangerous: ["shell", "control", "secrets", "fs:write", "net"].includes(scope), declaredBy: "registry" }));
  const pack: CapabilityPackageIntegrity = { packageSha256: entry.checksum, signatureStatus: entry.checksum ? "unverified" : "unknown" };
  const interfaces: CapabilityInterface[] = [
    ...(entry.tools ?? []).map((t) => ({ kind: "mcp_tool" as const, name: t.name, description: t.description, inputSchema: t.inputSchema })),
    ...(entry.resources ?? []).map((r) => ({ kind: "mcp_resource" as const, name: r.uri, description: r.description })),
    ...(entry.prompts ?? []).map((p) => ({ kind: "mcp_prompt" as const, name: p.name, description: p.description })),
  ];
  const granted = (entry as any).grantedPermissions ?? entry.declaredPermissions ?? [];
  const state: CapabilityLifecycleState = overlay?.state as any || (entry.enabled ? "enabled" : "disabled");
  return descriptorBase({
    type: "mcp",
    nativeId: entry.id,
    name: entry.name,
    version: entry.version,
    description: entry.description,
    publisher: publisher(entry.source, entry.source, entry.trustLevel, ["verified", "official"].includes(entry.trustLevel)),
    provenance: { source: entry.source as any, sourceUrl: entry.sourceUrl ?? entry.url, installedAt: entry.installedAt, updatedAt: entry.updatedAt, observedAt: NOW() },
    package: pack,
    compatibility: { xr: CORE_VERSION, runtimes: [entry.transport] },
    dependencies: [],
    declarations: declared,
    granted,
    denied,
    interfaces,
    lifecycle: lifecycle(state, entry.enabled, true, (entry.history ?? []).map((h) => ({ at: h.at, action: h.action, detail: h.detail })), false, undefined),
    network: networkFromPermissions(granted, entry.url ? [entry.url] : [], entry.localOrRemote === "remote" ? "internet" : "local"),
    credentials: credentialsFromScopes(granted, entry.apiKeyEnv ? [entry.apiKeyEnv] : []),
    certification: certificationFromTrust(entry.trustLevel, false),
    trustLevel: entry.trustLevel,
    support: { maintenance: "unknown" },
    tags: ["mcp", entry.transport, entry.localOrRemote, entry.source],
    keywords: [entry.id, entry.name, entry.description ?? "", ...(entry.tools ?? []).map((t) => t.name)],
    overlay,
  });
}

export function descriptorFromProvider(preset: ProviderPreset, overlay?: CapabilityOverlay): CapabilityDescriptor {
  const scopes = preset.kind === "local" ? ["provider"] : ["provider", "net", ...(preset.apiKeyEnv ? ["secrets"] : [])];
  const declared = scopes.map((scope) => ({ scope, reason: `Provider ${preset.id} ${scope}`, dangerous: scope !== "provider", declaredBy: "adapter" as const }));
  const interfaces: CapabilityInterface[] = [{ kind: "provider", name: preset.id, description: preset.description }];
  return descriptorBase({
    type: "provider",
    nativeId: preset.id,
    name: preset.label,
    version: "builtin",
    description: preset.description,
    publisher: publisher(preset.kind === "custom" ? "custom" : "xr-core", preset.kind === "custom" ? "Custom" : "XR Core", preset.kind === "custom" ? "unknown" : "official", preset.kind !== "custom"),
    provenance: { source: preset.kind === "custom" ? "config" : "builtin", sourceUrl: preset.docsUrl ?? preset.baseUrl, observedAt: NOW() },
    package: { signatureStatus: "unknown" },
    compatibility: { xr: CORE_VERSION, providers: [preset.id], models: preset.knownModels },
    dependencies: [],
    declarations: declared,
    granted: scopes,
    interfaces,
    lifecycle: lifecycle("enabled", true, true, [{ at: NOW(), action: "builtin" }], false, true),
    network: { required: preset.kind !== "local", domains: preset.baseUrl ? [preset.baseUrl] : [], locality: preset.kind === "local" ? "local" : "internet" },
    credentials: credentialsFromScopes(scopes, preset.apiKeyEnv ? [preset.apiKeyEnv] : []),
    providerRequirements: { providerIds: [preset.id], modelCapabilities: capabilityLabels(preset.capabilities), locality: preset.kind === "local" ? "local" : "cloud" },
    placement: { requested: "provider_api", riskTier: preset.kind === "local" ? "tier1" : "tier2", requiresHostAuthority: false, reason: "provider API boundary" },
    certification: certificationFromTrust(preset.kind === "custom" ? "unknown" : "official", false),
    trustLevel: preset.kind === "custom" ? "unknown" : "official",
    support: { homepage: preset.docsUrl, maintenance: preset.kind === "custom" ? "unknown" : "active" },
    cost: { cpu: preset.kind === "local" ? "high" : "low", notes: `tier=${preset.tier}` },
    tags: ["provider", preset.kind, preset.tier, ...capabilityLabels(preset.capabilities)],
    keywords: [preset.id, preset.label, preset.defaultModel, ...preset.knownModels, ...capabilityLabels(preset.capabilities)],
    overlay,
  });
}

export function descriptorFromTool(tool: Tool, overlay?: CapabilityOverlay): CapabilityDescriptor {
  const inferred = inferToolPermissions(tool.name);
  const declared = inferred.map((scope) => ({ scope, reason: `Inferred from core tool ${tool.name}`, dangerous: ["shell", "control", "browser", "fs:write", "net"].includes(scope), declaredBy: "adapter" as const }));
  return descriptorBase({
    type: "tool",
    nativeId: tool.name,
    name: tool.name,
    version: "core",
    description: tool.description,
    publisher: publisher("xr-core", "XR Core", "official", true),
    provenance: { source: "builtin", observedAt: NOW() },
    package: { signatureStatus: "unknown" },
    compatibility: { xr: CORE_VERSION },
    dependencies: [],
    declarations: declared,
    granted: inferred,
    interfaces: [{ kind: "tool", name: tool.name, description: tool.description, inputSchema: tool.parameters }],
    lifecycle: lifecycle("enabled", true, true, [{ at: NOW(), action: "builtin" }], false, true),
    certification: certificationFromTrust("official", false),
    trustLevel: "official",
    support: { maintenance: "active" },
    tags: ["tool", ...inferred],
    keywords: [tool.name, tool.description, ...inferred],
    overlay,
  });
}

function inferToolPermissions(name: string): string[] {
  if (name === "read_file" || name === "list_dir") return ["fs:read"];
  if (name === "write_file" || name === "delete_file") return ["fs:write"];
  if (name === "fetch_url" || name === "web_search" || name === "check_package") return ["net"];
  if (name === "shell") return ["shell", "fs:read", "fs:write"];
  if (name.includes("clipboard_write") || name.includes("open_app") || name.includes("trash") || name.includes("media") || name === "computer_control") return ["control"];
  if (name.includes("screenshot") || name.includes("clipboard_read") || name.includes("system_")) return ["control"];
  return [];
}

export function descriptorFromWorkflow(def: WorkflowDefinition, overlay?: CapabilityOverlay): CapabilityDescriptor {
  const scopes = ["workflow:run", ...def.nodes.flatMap((n) => n.kind === "tool_action" ? ["tool"] : n.kind === "agentic" ? ["provider"] : [])];
  const declared = uniq(scopes).map((scope) => ({ scope, reason: `Workflow node graph uses ${scope}`, dangerous: scope !== "tool", declaredBy: "adapter" as const }));
  const interfaces: CapabilityInterface[] = [{ kind: "workflow", name: def.definitionId, description: def.description, inputSchema: def.parameters, outputSchema: def.expectedArtifacts }];
  return descriptorBase({
    type: "workflow",
    nativeId: def.definitionId,
    name: def.name,
    version: String(def.version),
    description: def.description,
    publisher: publisher(def.authoredBy.id, def.authoredBy.name ?? def.authoredBy.id, def.authoredBy.kind === "system" ? "official" : "unknown", def.authoredBy.kind === "system"),
    provenance: { source: def.authoredBy.kind === "system" ? "builtin" : "local", builtAt: def.publishedAt, observedAt: NOW() },
    package: { packageSha256: def.contentHash, signatureStatus: def.contentHash ? "unverified" : "unknown" },
    compatibility: { xr: def.schemaVersion },
    dependencies: [],
    declarations: declared,
    granted: declared.map((d) => d.scope),
    interfaces,
    lifecycle: lifecycle(def.active ? "enabled" : "disabled", def.active, true, [{ at: def.publishedAt, action: "publish", detail: def.contentHash }], false, def.active),
    certification: certificationFromTrust(def.authoredBy.kind === "system" ? "official" : "unknown", false),
    trustLevel: def.authoredBy.kind === "system" ? "official" : "unknown",
    support: { maintenance: "unknown" },
    tags: ["workflow", ...def.tags],
    keywords: [def.definitionId, def.name, def.description ?? "", ...def.tags, ...def.nodes.map((n) => n.kind)],
    overlay,
  });
}

export function descriptorFromIntegration(connector: ConnectorDefinition, overlay?: CapabilityOverlay): CapabilityDescriptor {
  const scopes = [connector.authType === "none" ? "" : "secrets", connector.mcpServer ? "mcp" : "", connector.pluginId ? "plugin" : "", ...(connector.scopes?.length ? ["net"] : [])].filter(Boolean);
  const declared = uniq(scopes).map((scope) => ({ scope, reason: `Integration ${connector.id} requires ${scope}`, dangerous: scope !== "plugin", declaredBy: "adapter" as const }));
  const credentialRefs = connector.configFields.filter((f) => f.type === "password").map((f) => f.key);
  return descriptorBase({
    type: "integration",
    nativeId: connector.id,
    name: connector.name,
    version: "catalog",
    description: connector.description,
    publisher: publisher("xr-core", "XR Core", "official", true),
    provenance: { source: "builtin", observedAt: NOW() },
    package: { signatureStatus: "unknown" },
    compatibility: { xr: CORE_VERSION },
    dependencies: [
      ...(connector.mcpServer ? [{ type: "mcp" as const, id: connector.mcpServer, status: "unknown" as const }] : []),
      ...(connector.pluginId ? [{ type: "plugin" as const, id: connector.pluginId, status: "unknown" as const }] : []),
    ],
    declarations: declared,
    granted: declared.map((d) => d.scope),
    interfaces: connector.capabilities.map((name) => ({ kind: "integration" as const, name, description: connector.description })),
    lifecycle: lifecycle("discovered", false, false, [{ at: NOW(), action: "catalog" }], false, false),
    network: { required: connector.authType !== "none" || Boolean(connector.scopes?.length), domains: [], locality: connector.authType === "none" ? "local" : "internet", reason: `auth=${connector.authType}` },
    credentials: { required: connector.authType !== "none" || credentialRefs.length > 0, refs: [...credentialRefs, ...(connector.scopes ?? [])], reason: `auth=${connector.authType}` },
    certification: certificationFromTrust("official", false),
    trustLevel: "official",
    support: { maintenance: "active" },
    tags: ["integration", connector.category, connector.authType, ...connector.capabilities],
    keywords: [connector.id, connector.name, connector.description, connector.category, ...connector.capabilities],
    overlay,
  });
}

export function descriptorForArtifactTransform(id: string, name: string, opts: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  const nativeId = id;
  return descriptorBase({
    type: "artifact",
    nativeId,
    name,
    version: opts.version ?? "1.0.0",
    description: opts.description ?? "Artifact transformation capability",
    publisher: opts.publisher ?? publisher("xr-core", "XR Core", "official", true),
    provenance: opts.provenance ?? { source: "builtin", observedAt: NOW() },
    package: opts.package ?? { signatureStatus: "unknown" },
    declarations: opts.permissions?.declared ?? [],
    granted: opts.permissions?.effective.effective ?? [],
    interfaces: opts.interfaces ?? [{ kind: "artifact", name }],
    lifecycle: opts.lifecycle ?? lifecycle("enabled", true, true, [{ at: NOW(), action: "builtin" }], false, true),
    certification: opts.certification ?? certificationFromTrust("official", false),
    trustLevel: opts.trust?.trustLevel ?? "official",
    support: opts.support ?? { maintenance: "active" },
    tags: opts.tags ?? ["artifact"],
    keywords: opts.keywords ?? [id, name],
  });
}
