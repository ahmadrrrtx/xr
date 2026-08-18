/**
 * XR Phase 08 — Capability Inventory generation (deterministic).
 *
 * Generates capabilities/inventory.json with deterministic ordering.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ToolRegistryService } from "../tools/registry-service.ts";

export interface InventoryEntry {
  id: string;
  name: string;
  exposedName: string;
  kind: string;
  source: string;
  provider: string | undefined;
  version: string | undefined;
  lifecycle: string | undefined;
  trust: string | undefined;
  scope: string | undefined;
  permissions: string[] | undefined;
  riskTier: string | undefined;
  sourceHash: string | undefined;
  provenance: any;
  shadowed: string;
}

export function generateInventory(registry: ToolRegistryService): InventoryEntry[] {
  const entries = registry.list().sort((a, b) => a.id.localeCompare(b.id));
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    exposedName: e.exposedName,
    kind: e.kind,
    source: e.source,
    provider: e.providerId,
    version: e.version,
    lifecycle: e.lifecycle,
    trust: e.trustLevel,
    scope: e.scope,
    permissions: e.permissions,
    riskTier: e.riskTier,
    sourceHash: e.sourceHash,
    provenance: e.provenance,
    shadowed: e.shadowed,
  }));
}

export function writeInventoryFile(registry: ToolRegistryService, outPath?: string): string {
  const inventory = generateInventory(registry);
  const path = outPath ?? join(homedir(), ".xr", "capabilities", "inventory.json");
  // Also write to repo local for tests
  const repoPath = join(process.cwd(), "capabilities", "inventory.json");
  try {
    mkdirSync(dirname(repoPath), { recursive: true });
    writeFileSync(repoPath, JSON.stringify({ generatedAt: new Date().toISOString(), total: inventory.length, capabilities: inventory }, null, 2));
  } catch {}
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), total: inventory.length, capabilities: inventory }, null, 2));
  } catch (e) {
    console.warn(`[inventory] failed to write ${path}: ${(e as Error).message}`);
  }
  return repoPath;
}

export function inventoryHealth(registry: ToolRegistryService) {
  const inv = generateInventory(registry);
  return {
    total: inv.length,
    byKind: inv.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {}),
    byLifecycle: inv.reduce<Record<string, number>>((acc, e) => {
      const lc = e.lifecycle ?? "unknown";
      acc[lc] = (acc[lc] ?? 0) + 1;
      return acc;
    }, {}),
    enabled: inv.filter((e) => e.lifecycle === "enabled").length,
    quarantined: inv.filter((e) => e.lifecycle === "quarantined").length,
  };
}
