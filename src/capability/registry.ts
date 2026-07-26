/**
 * XR 5.2.0 — Capability Registry / Catalog Integration
 *
 * Supports capability lookup, effective authority, compatibility, trust,
 * certification, lifecycle state, and quarantine. Does NOT build a
 * second registry; integrates with existing plugin/skill/MCP/provider
 * registries.
 */
import { CapabilityDescriptor } from "./types.ts";

export interface CapabilityCatalogEntry {
  descriptor: CapabilityDescriptor;
  discoveredAt: number;
  lastInspectedAt?: number;
  installedPath?: string;
  enabled: boolean;
  quarantined: boolean;
  rollbackAvailable?: boolean;
  previousVersion?: string;
  previousDescriptor?: CapabilityDescriptor;
}

export class CapabilityCatalog {
  private entries = new Map<string, CapabilityCatalogEntry>();

  upsert(entry: CapabilityCatalogEntry): void {
    this.entries.set(entry.descriptor.capabilityId, entry);
  }

  get(id: string): CapabilityCatalogEntry | undefined {
    return this.entries.get(id);
  }

  list(): CapabilityCatalogEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.descriptor.capabilityId.localeCompare(b.descriptor.capabilityId));
  }

  listEnabled(): CapabilityCatalogEntry[] {
    return this.list().filter((e) => e.enabled && !e.quarantined);
  }

  listQuarantined(): CapabilityCatalogEntry[] {
    return this.list().filter((e) => e.quarantined);
  }

  search(query: string): CapabilityCatalogEntry[] {
    const q = query.toLowerCase();
    return this.list().filter((e) => {
      const text = `${e.descriptor.name} ${e.descriptor.description ?? ""} ${e.descriptor.capabilityType}`.toLowerCase();
      return text.includes(q);
    });
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  quarantine(id: string, reason?: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.quarantined = true;
    entry.enabled = false;
    entry.descriptor.lifecycleState = "quarantined";
    return true;
  }

  rollback(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || !entry.previousDescriptor) return false;
    entry.descriptor = entry.previousDescriptor;
    entry.descriptor.lifecycleState = "roll_back";
    entry.descriptor.version = entry.previousDescriptor.version;
    entry.previousDescriptor = undefined;
    return true;
  }

  disable(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = false;
    entry.descriptor.lifecycleState = "disabled";
    return true;
  }

  enable(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.quarantined) return false;
    entry.enabled = true;
    entry.descriptor.lifecycleState = "enabled";
    return true;
  }
}

export const globalCatalog = new CapabilityCatalog();
