/**
 * XR Phase 08 — Capability Inventory deterministic generation
 */

import { describe, test, expect } from "bun:test";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import { generateInventory, inventoryHealth } from "../../src/capabilities/inventory.ts";
import type { CapabilityMetadata } from "../../src/tools/registry-types.ts";

function makeRegistry() {
  const r = new ToolRegistryService();
  const core = coreToolContributions();
  const meta: Record<string, CapabilityMetadata> = {};
  for (const t of core.tools) {
    meta[t.name] = {
      lifecycle: "enabled",
      trustLevel: "official",
      scope: "workspace",
      permissions: [] as any,
      riskTier: "tier0",
      providerId: "core",
      version: "core",
    };
  }
  r.registerTools({ ...core, metadata: meta });
  return r;
}

describe("Phase 08 — Inventory", () => {
  test("inventory deterministic ordering", () => {
    const r = makeRegistry();
    const inv1 = generateInventory(r);
    const inv2 = generateInventory(r);
    expect(inv1.length).toBe(inv2.length);
    for (let i = 0; i < inv1.length; i++) {
      expect(inv1[i].id).toBe(inv2[i].id);
    }
    // Check ordering by id
    const sorted = [...inv1].sort((a, b) => a.id.localeCompare(b.id));
    expect(inv1.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });

  test("inventory includes required fields", () => {
    const r = makeRegistry();
    const inv = generateInventory(r);
    expect(inv.length).toBeGreaterThan(0);
    for (const entry of inv) {
      expect(entry.id).toBeDefined();
      expect(entry.name).toBeDefined();
      expect(entry.exposedName).toBeDefined();
      expect(entry.kind).toBeDefined();
      expect(entry.provider).toBeDefined();
      expect(entry.lifecycle).toBeDefined();
      expect(entry.trust).toBeDefined();
      expect(entry.scope).toBeDefined();
    }
  });

  test("inventory health counts", () => {
    const r = makeRegistry();
    const health = inventoryHealth(r);
    expect(health.total).toBeGreaterThan(0);
    expect(health.enabled).toBe(health.total); // all enabled in test
    expect(health.byKind.core).toBeGreaterThan(0);
  });
});
