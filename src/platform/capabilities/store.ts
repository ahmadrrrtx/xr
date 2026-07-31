/**
 * XR 5.2 — additive capability metadata store.
 *
 * This is NOT a second extension registry. Installed/enabled state remains owned
 * by plugins/skills/MCP/provider/workflow systems. This store only records
 * cross-plane evidence: certification results, trust decisions, quarantine
 * overlays, review gates, and lifecycle audit events.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { CapabilityCertification, CapabilityLifecycleEvent, CapabilityLifecycleState } from "./types.ts";

export const CAPABILITY_METADATA_VERSION = 1;

export function capabilitiesHome(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "capabilities");
}

export function capabilityMetadataPath(): string {
  return join(capabilitiesHome(), "metadata.json");
}

const CertificationSchema = z.object({
  status: z.string(),
  tests: z.array(z.any()).default([]),
  certifiedAt: z.number().optional(),
  certifiedBy: z.string().optional(),
  expiresAt: z.number().optional(),
  reason: z.string().optional(),
});

const OverlaySchema = z.object({
  id: z.string(),
  state: z.string().optional(),
  quarantineReason: z.string().optional(),
  trustDecision: z.enum(["allow", "deny", "review", "unknown"]).default("unknown"),
  trustDecisionReason: z.string().optional(),
  certification: CertificationSchema.optional(),
  pendingReview: z.object({ reason: z.string(), requestedAt: z.number(), newPermissions: z.array(z.string()).default([]) }).optional(),
  vulnerabilityStatus: z.enum(["none-known", "unknown", "flagged", "quarantined"]).default("unknown"),
  maintenanceStatus: z.enum(["active", "unknown", "deprecated", "abandoned"]).default("unknown"),
  history: z.array(z.object({ at: z.number(), action: z.string(), actor: z.string().optional(), detail: z.string().optional() })).default([]),
});

const StateSchema = z.object({
  version: z.literal(CAPABILITY_METADATA_VERSION).default(CAPABILITY_METADATA_VERSION),
  overlays: z.record(OverlaySchema).default({}),
});

export type CapabilityOverlay = z.infer<typeof OverlaySchema>;
type CapabilityMetadataState = z.infer<typeof StateSchema>;

export class CapabilityMetadataStore {
  private state: CapabilityMetadataState;

  constructor(private readonly path = capabilityMetadataPath()) {
    this.state = this.read();
  }

  private read(): CapabilityMetadataState {
    if (!existsSync(this.path)) return StateSchema.parse({});
    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) return parsed.data;
    } catch {}
    try {
      writeFileSync(`${this.path}.broken-${Date.now()}`, readFileSync(this.path));
    } catch {}
    return StateSchema.parse({});
  }

  flush(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  list(): CapabilityOverlay[] {
    return Object.values(this.state.overlays).sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): CapabilityOverlay | undefined {
    return this.state.overlays[id];
  }

  upsert(id: string, patch: Partial<CapabilityOverlay>): CapabilityOverlay {
    const current = this.state.overlays[id] ?? { id, trustDecision: "unknown", vulnerabilityStatus: "unknown", maintenanceStatus: "unknown", history: [] };
    const next = OverlaySchema.parse({ ...current, ...patch, id, history: (patch.history ?? current.history ?? []).slice(-200) });
    this.state.overlays[id] = next;
    this.flush();
    return next;
  }

  record(id: string, action: string, detail?: string, actor = "system"): CapabilityOverlay {
    const current = this.state.overlays[id] ?? { id, trustDecision: "unknown", vulnerabilityStatus: "unknown", maintenanceStatus: "unknown", history: [] };
    const history = [...(current.history ?? []), { at: Date.now(), action, actor, detail }].slice(-200);
    return this.upsert(id, { history });
  }

  setState(id: string, state: CapabilityLifecycleState, detail?: string): CapabilityOverlay {
    const row = this.upsert(id, { state });
    this.record(id, state, detail);
    return row;
  }

  quarantine(id: string, reason: string, actor = "system"): CapabilityOverlay {
    const row = this.upsert(id, {
      state: "quarantined",
      quarantineReason: reason,
      trustDecision: "deny",
      trustDecisionReason: reason,
      vulnerabilityStatus: "quarantined",
    });
    this.record(id, "quarantine", reason, actor);
    return row;
  }

  clearQuarantine(id: string, actor = "system"): CapabilityOverlay {
    const row = this.upsert(id, {
      state: "disabled",
      quarantineReason: undefined,
      trustDecision: "review",
      trustDecisionReason: "quarantine cleared; review before enabling",
      vulnerabilityStatus: "unknown",
    });
    this.record(id, "clear_quarantine", "review required before enable", actor);
    return row;
  }

  setCertification(id: string, certification: CapabilityCertification, actor = "system"): CapabilityOverlay {
    const row = this.upsert(id, { certification: certification as any });
    this.record(id, "certification", certification.status, actor);
    return row;
  }

  markPendingReview(id: string, reason: string, newPermissions: string[] = [], actor = "system"): CapabilityOverlay {
    const row = this.upsert(id, {
      state: "update_pending_review",
      pendingReview: { reason, requestedAt: Date.now(), newPermissions },
      trustDecision: "review",
      trustDecisionReason: reason,
    });
    this.record(id, "pending_review", `${reason}${newPermissions.length ? `: ${newPermissions.join(",")}` : ""}`, actor);
    return row;
  }

  history(id: string): CapabilityLifecycleEvent[] {
    return this.state.overlays[id]?.history ?? [];
  }
}
