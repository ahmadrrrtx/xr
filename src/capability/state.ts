/**
 * XR 5.2.0 — Capability State & Migrations
 *
 * Additive, versioned storage for publisher/capability/certification/
 * update/quarantine metadata. Preserves existing installations.
 */
import { CapabilityDescriptor } from "./types.ts";

export const CAPABILITY_STATE_SCHEMA_VERSION = 1;

export interface CapabilityStateStore {
  version: number;
  descriptors: Record<string, CapabilityDescriptor>;
  quarantinedIds: string[];
  rollbackVersions: Record<string, { descriptor: CapabilityDescriptor; timestamp: number; reason: string }>;
  certificationHistory: Record<string, Array<{ status: string; timestamp: number; certifiedBy?: string }>>;
}

export function createStateStore(): CapabilityStateStore {
  return {
    version: CAPABILITY_STATE_SCHEMA_VERSION,
    descriptors: {},
    quarantinedIds: [],
    rollbackVersions: {},
    certificationHistory: {},
  };
}

export function migrateStateStore(store: CapabilityStateStore, targetVersion = CAPABILITY_STATE_SCHEMA_VERSION): CapabilityStateStore {
  const current = store.version ?? 0;
  if (current >= targetVersion) return store;

  const migrated = { ...store, version: targetVersion };

  // Migration 0 -> 1: ensure descriptors have descriptorVersion
  for (const [id, desc] of Object.entries(migrated.descriptors ?? {})) {
    if (!desc.descriptorVersion) {
      (migrated.descriptors as any)[id] = { ...desc, descriptorVersion: "xr-5.2.0/capability-v1" };
    }
  }

  return migrated;
}

export function saveDescriptorToState(store: CapabilityStateStore, descriptor: CapabilityDescriptor): void {
  store.descriptors[descriptor.capabilityId] = descriptor;
  // Remove from quarantined if present and state is not quarantined
  if (descriptor.lifecycleState !== "quarantined") {
    store.quarantinedIds = store.quarantinedIds.filter((id) => id !== descriptor.capabilityId);
  } else {
    if (!store.quarantinedIds.includes(descriptor.capabilityId)) {
      store.quarantinedIds.push(descriptor.capabilityId);
    }
  }
}

export function recordRollback(store: CapabilityStateStore, descriptor: CapabilityDescriptor, previousDescriptor: CapabilityDescriptor, reason?: string): void {
  store.rollbackVersions[descriptor.capabilityId] = {
    descriptor: previousDescriptor,
    timestamp: Date.now(),
    reason: reason ?? "manual rollback",
  };
}

export function recordCertificationUpdate(store: CapabilityStateStore, capabilityId: string, status: string, certifiedBy?: string): void {
  const history = store.certificationHistory[capabilityId] ?? [];
  history.push({ status, timestamp: Date.now(), certifiedBy });
  store.certificationHistory[capabilityId] = history;
}
