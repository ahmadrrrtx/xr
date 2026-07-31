/** XR 5.2 — common capability inspection/discovery service. */
import type { Store } from "../../state/workspace-store.ts";
import type { XRConfig } from "../../config/config.ts";
import { loadConfig } from "../../config/config.ts";
import { allTools } from "../../tools/registry.ts";
import { PRESETS, type ProviderPreset } from "../../providers/presets.ts";
import { PluginManager } from "../../plugins/manager.ts";
import { SkillMarketplace } from "../../skills/marketplace.ts";
import { SkillMarketplaceStore } from "../../skills/marketplace-store.ts";
import { UnifiedSkillRuntime } from "../../skills/runtime.ts";
import { McpRegistry } from "../../mcp/registry.ts";
import { WorkflowRepository } from "../../execution/workflow/repository.ts";
import { CONNECTORS } from "../../integrations/registry.ts";
import type { LifecycleHook } from "../../core/lifecycle.ts";
import type { ServiceRegistry } from "../../core/service-registry.ts";
import { Tokens } from "../../core/tokens.ts";
import type { CapabilityDescriptor, CapabilityLifecycleState, CapabilityType } from "./types.ts";
import { capabilityId } from "./types.ts";
import { CapabilityMetadataStore } from "./store.ts";
import { runCapabilityContractTests } from "./certification.ts";
import {
  descriptorForArtifactTransform,
  descriptorFromIntegration,
  descriptorFromMcp,
  descriptorFromPlugin,
  descriptorFromProvider,
  descriptorFromSkill,
  descriptorFromTool,
  descriptorFromWorkflow,
} from "./adapters.ts";

export interface CapabilityDiscoverQuery {
  task?: string;
  type?: CapabilityType | CapabilityType[];
  requires?: string[];
  excludesPermissions?: string[];
  maxRiskTier?: "tier0" | "tier1" | "tier2";
  locality?: "local" | "private" | "internet" | "any";
  trust?: string[];
  publisher?: string;
  certified?: boolean;
  installedOnly?: boolean;
  enabledOnly?: boolean;
  limit?: number;
}

export interface CapabilityMutationResult {
  ok: boolean;
  id: string;
  state?: CapabilityLifecycleState;
  reason?: string;
}

const RISK_RANK = { tier0: 0, tier1: 1, tier2: 2, unknown: 99, blocked: 99 } as const;

function normalizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9@/._:-]+/).filter((x) => x.length > 1);
}

function scoreDescriptor(d: CapabilityDescriptor, query: CapabilityDiscoverQuery): number {
  let score = 0;
  if (query.task) {
    const terms = normalizeWords(query.task);
    const haystack = normalizeWords([d.id, d.nativeId, d.name, d.description ?? "", ...d.tags, ...d.keywords, ...d.interfaces.map((i) => `${i.kind} ${i.name} ${i.description ?? ""}`)].join(" "));
    const hay = new Set(haystack);
    for (const term of terms) {
      if (d.nativeId.toLowerCase() === term || d.name.toLowerCase() === term) score += 12;
      if (hay.has(term)) score += 4;
      else if (haystack.some((h) => h.includes(term))) score += 1;
    }
  } else {
    score += 1;
  }
  if (d.lifecycle.enabled) score += 2;
  if (d.lifecycle.installed) score += 1;
  if (d.trust.verifiedPublisher) score += 2;
  if (d.trust.signedPackage) score += 2;
  if (d.certification.status === "verified") score += 4;
  else if (d.certification.status === "xr-tested") score += 3;
  else if (d.certification.status === "self-tested") score += 1;
  if (d.lifecycle.state === "quarantined" || d.trust.vulnerabilityStatus === "quarantined") score -= 100;
  // Deliberately no download-count/popularity boost: evidence only.
  return score;
}

function customProviderPreset(custom: any): ProviderPreset {
  return {
    id: custom.id,
    label: custom.label,
    kind: "custom",
    tier: "custom",
    baseUrl: custom.baseUrl,
    apiKeyEnv: custom.apiKeyEnv,
    authType: custom.apiKeyEnv ? "bearer" : "none",
    defaultModel: custom.defaultModel,
    knownModels: [custom.defaultModel].filter(Boolean),
    capabilities: custom.capabilities ?? { chat: true },
    description: `Custom OpenAI-compatible provider ${custom.label ?? custom.id}`,
  };
}

export class CapabilityService implements LifecycleHook {
  private readonly metadata = new CapabilityMetadataStore();
  private config: XRConfig;

  constructor(private readonly store?: Store, config?: XRConfig) {
    this.config = config ?? loadConfig().config;
  }

  static fromRegistry(registry: ServiceRegistry): CapabilityService {
    const store = registry.resolve(Tokens.Store);
    const config = registry.resolve(Tokens.Config).get();
    return new CapabilityService(store, config);
  }

  list(): CapabilityDescriptor[] {
    const overlays = new Map(this.metadata.list().map((row) => [row.id, row]));
    const denied = [
      ...((this.config as any).plugins?.deniedPermissions ?? []),
      ...((this.config as any).capabilities?.deniedPermissions ?? []),
    ];
    const rows: CapabilityDescriptor[] = [];

    // Plugins: existing registry/manifest remains authoritative.
    try {
      if (this.store) {
        const mgr = new PluginManager(this.store, process.cwd(), this.config);
        for (const h of mgr.health()) {
          if (h.manifest) rows.push(descriptorFromPlugin(h.manifest, h.entry, overlays.get(capabilityId("plugin", h.entry.id)), denied));
        }
      }
    } catch {
      // Capability listing is best-effort across planes; other planes still list.
    }

    // Skills: marketplace/runtime remains authoritative.
    try {
      const skillStore = new SkillMarketplaceStore();
      const marketplace = new SkillMarketplace(skillStore);
      const runtime = new UnifiedSkillRuntime(marketplace);
      for (const record of runtime.list()) {
        rows.push(descriptorFromSkill(record, skillStore.getInstallation(record.manifest.id), overlays.get(capabilityId("skill", record.manifest.id)), denied));
      }
    } catch {}

    // MCP servers.
    try {
      const mcp = new McpRegistry();
      for (const entry of mcp.list()) rows.push(descriptorFromMcp(entry, overlays.get(capabilityId("mcp", entry.id)), denied));
    } catch {}

    // Providers (built-in + custom config).
    try {
      for (const preset of Object.values(PRESETS)) rows.push(descriptorFromProvider(preset, overlays.get(capabilityId("provider", preset.id))));
      for (const custom of this.config.providerEngine?.customProviders ?? []) rows.push(descriptorFromProvider(customProviderPreset(custom), overlays.get(capabilityId("provider", custom.id))));
    } catch {}

    // Core tools.
    try {
      for (const tool of allTools()) rows.push(descriptorFromTool(tool, overlays.get(capabilityId("tool", tool.name))));
    } catch {}

    // Workflows (workspace-scoped).
    try {
      if (this.store) {
        const wf = new WorkflowRepository(this.store as any);
        for (const def of wf.listDefinitions({ limit: 200 })) rows.push(descriptorFromWorkflow(def, overlays.get(capabilityId("workflow", def.definitionId))));
      }
    } catch {}

    // Existing integration catalog — metadata only; no new business module.
    try {
      for (const connector of CONNECTORS) rows.push(descriptorFromIntegration(connector, overlays.get(capabilityId("integration", connector.id))));
    } catch {}

    // Built-in artifact transform surfaces used by workflow/export contracts.
    rows.push(descriptorForArtifactTransform("artifact:json-to-markdown", "JSON to Markdown", { description: "Transform JSON artifacts into Markdown reports." }));
    rows.push(descriptorForArtifactTransform("artifact:markdown-to-html", "Markdown to HTML", { description: "Transform Markdown artifacts into local HTML previews." }));

    return rows.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  inspect(id: string): CapabilityDescriptor | null {
    const rows = this.list();
    const direct = rows.find((d) => d.id === id);
    if (direct) return direct;
    const native = rows.filter((d) => d.nativeId === id || d.id.endsWith(`:${id}`));
    return native.length === 1 ? native[0] : null;
  }

  discover(query: CapabilityDiscoverQuery = {}): CapabilityDescriptor[] {
    const types = query.type ? new Set(Array.isArray(query.type) ? query.type : [query.type]) : null;
    const requires = new Set(query.requires ?? []);
    const excludes = new Set(query.excludesPermissions ?? []);
    const trust = query.trust ? new Set(query.trust) : null;
    const maxRisk = query.maxRiskTier ? RISK_RANK[query.maxRiskTier] : 99;

    return this.list()
      .filter((d) => !types || types.has(d.type))
      .filter((d) => !query.installedOnly || d.lifecycle.installed)
      .filter((d) => !query.enabledOnly || d.lifecycle.enabled)
      .filter((d) => !query.publisher || d.publisher.id.includes(query.publisher) || d.publisher.name.toLowerCase().includes(query.publisher.toLowerCase()))
      .filter((d) => !trust || trust.has(d.trust.trustLevel) || trust.has(d.certification.status))
      .filter((d) => !query.certified || ["verified", "xr-tested", "self-tested"].includes(d.certification.status))
      .filter((d) => RISK_RANK[d.placement.riskTier] <= maxRisk)
      .filter((d) => !query.locality || query.locality === "any" || d.network.locality === query.locality || (!d.network.required && query.locality === "local"))
      .filter((d) => [...requires].every((r) => d.permissions.effective.effective.includes(r) || d.interfaces.some((i) => i.kind === r || i.name.includes(r)) || d.tags.includes(r)))
      .filter((d) => ![...excludes].some((p) => d.permissions.effective.effective.includes(p) || d.permissions.declared.some((decl) => decl.scope === p)))
      .map((d) => ({ d, score: scoreDescriptor(d, query) }))
      .filter((row) => row.score > -50)
      .sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name))
      .slice(0, query.limit ?? 50)
      .map((row) => row.d);
  }

  permissions(id: string) {
    const d = this.inspect(id);
    if (!d) return null;
    return { id: d.id, type: d.type, declared: d.permissions.declared, effective: d.permissions.effective, riskTier: d.placement.riskTier, placement: d.placement };
  }

  certify(id: string): CapabilityMutationResult & { descriptor?: CapabilityDescriptor } {
    const d = this.inspect(id);
    if (!d) return { ok: false, id, reason: "capability not found" };
    const certification = runCapabilityContractTests(d, { xrTested: true });
    this.metadata.setCertification(d.id, certification);
    const updated = this.inspect(d.id) ?? d;
    return { ok: certification.status !== "quarantined", id: d.id, state: updated.lifecycle.state, descriptor: updated, reason: certification.reason };
  }

  async enable(id: string): Promise<CapabilityMutationResult> {
    const d = this.inspect(id);
    if (!d) return { ok: false, id, reason: "capability not found" };
    if (d.lifecycle.state === "quarantined") return { ok: false, id: d.id, state: "quarantined", reason: d.lifecycle.quarantineReason ?? "capability is quarantined" };
    try {
      if (d.type === "plugin" && this.store) {
        const r = new PluginManager(this.store, process.cwd(), this.config).enable(d.nativeId);
        if (!r.ok) return { ok: false, id: d.id, reason: r.reason };
      } else if (d.type === "skill") {
        new SkillMarketplace().enable(d.nativeId);
      } else if (d.type === "mcp") {
        new McpRegistry().setEnabled(d.nativeId, true);
      } else {
        this.metadata.setState(d.id, "enabled", "metadata-only capability enabled");
      }
      this.metadata.record(d.id, "enable");
      return { ok: true, id: d.id, state: "enabled" };
    } catch (e) {
      return { ok: false, id: d.id, reason: (e as Error).message };
    }
  }

  async disable(id: string): Promise<CapabilityMutationResult> {
    const d = this.inspect(id);
    if (!d) return { ok: false, id, reason: "capability not found" };
    try {
      if (d.type === "plugin" && this.store) {
        const r = await new PluginManager(this.store, process.cwd(), this.config).disable(d.nativeId);
        if (!r.ok) return { ok: false, id: d.id, reason: r.reason };
      } else if (d.type === "skill") {
        new SkillMarketplace().disable(d.nativeId);
      } else if (d.type === "mcp") {
        new McpRegistry().setEnabled(d.nativeId, false);
      } else {
        this.metadata.setState(d.id, "disabled", "metadata-only capability disabled");
      }
      this.metadata.record(d.id, "disable");
      return { ok: true, id: d.id, state: "disabled" };
    } catch (e) {
      return { ok: false, id: d.id, reason: (e as Error).message };
    }
  }

  async quarantine(id: string, reason: string): Promise<CapabilityMutationResult> {
    const d = this.inspect(id);
    if (!d) return { ok: false, id, reason: "capability not found" };
    try { await this.disable(d.id); } catch {}
    this.metadata.quarantine(d.id, reason || "manual quarantine");
    if (d.type === "plugin" && this.store) {
      try { await (new PluginManager(this.store, process.cwd(), this.config) as any).quarantine?.(d.nativeId, reason); } catch {}
    }
    if (d.type === "mcp") {
      try { new McpRegistry().patch(d.nativeId, { enabled: false, health: "untrusted" as any, healthDetail: reason }); } catch {}
    }
    return { ok: true, id: d.id, state: "quarantined", reason };
  }

  async rollback(id: string, version?: string): Promise<CapabilityMutationResult> {
    const d = this.inspect(id);
    if (!d) return { ok: false, id, reason: "capability not found" };
    try {
      if (d.type === "plugin" && this.store) {
        const r = (new PluginManager(this.store, process.cwd(), this.config) as any).rollback?.(d.nativeId, version);
        if (!r?.ok) return { ok: false, id: d.id, reason: r?.reason ?? "plugin rollback unavailable" };
      } else if (d.type === "skill") {
        new SkillMarketplace().rollback(d.nativeId, version);
      } else {
        return { ok: false, id: d.id, reason: `rollback is not supported for ${d.type}` };
      }
      this.metadata.setState(d.id, "rolled_back", version);
      this.metadata.record(d.id, "rollback", version);
      return { ok: true, id: d.id, state: "rolled_back" };
    } catch (e) {
      return { ok: false, id: d.id, reason: (e as Error).message };
    }
  }

  health() {
    const rows = this.list();
    return {
      total: rows.length,
      byType: rows.reduce<Record<string, number>>((acc, d) => ((acc[d.type] = (acc[d.type] ?? 0) + 1), acc), {}),
      installed: rows.filter((d) => d.lifecycle.installed).length,
      enabled: rows.filter((d) => d.lifecycle.enabled).length,
      quarantined: rows.filter((d) => d.lifecycle.state === "quarantined").length,
      certified: rows.filter((d) => ["verified", "xr-tested", "self-tested"].includes(d.certification.status)).length,
    };
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> { this.list(); }
  async onStop(): Promise<void> {}
}
