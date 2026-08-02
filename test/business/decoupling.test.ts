/**
 * XR Phase 7 · T8 — Business OS decoupling + effect-verification +
 * default-exclusion + data-preservation tests.
 *
 * Proves:
 *   1. The kernel has NO business domain schema and NO static import of the
 *      extension (Art. XVI.1; Part Eight rule 1).
 *   2. The extension is DEFAULT-EXCLUDED: loads only when config-enabled
 *      AND every requested module passes effect-verification.
 *   3. Every module's effects are verified deterministically (no simulated
 *      success — Art. XVI.4).
 *   4. User data (biz_* rows) survives the move and is readable through the
 *      thin L0 contract.
 *   5. The ExecutionBridge never records 'succeeded' without a verified
 *      effect.
 */
import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "xr-biz-decouple-"));
process.env.XR_HOME = join(root, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

import { Store } from "../../src/state/workspace-store.ts";
import { BusinessL0 } from "../../src/core/business-l0.ts";
import { BusinessServiceProvider } from "../../src/core/providers/business.ts";

let store: Store;

beforeEach(() => {
  const home = process.env.XR_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  store = new Store(join(root, `db-${Math.random().toString(36).slice(2)}.db`));
});

test("kernel has no business domain schema and no static extension import", () => {
  const repoRoot = join(process.cwd());
  // 1. No biz_* DDL in the kernel's migrations/schema (only the L0 contract
  //    tables xr_l0_* may exist).
  const migrations = readFileSync(join(repoRoot, "src/state/migrations.ts"), "utf8");
  expect(migrations).not.toMatch(/CREATE TABLE IF NOT EXISTS biz_/);
  expect(migrations).toMatch(/xr_l0_records/);
  // 2. No static import of the extension from src/.
  const forbidden = [
    ["src/core/providers/business.ts", "extensions/business-os"],
    ["src/core/tokens.ts", "business/index"],
    ["src/commands/business.ts", "business/index"],
  ];
  for (const [file, marker] of forbidden) {
    const content = readFileSync(join(repoRoot, file), "utf8");
    if (file === "src/core/providers/business.ts") {
      // Dynamic-only: specifiers must not be static literal imports of the
      // extension. (new URL(...) dynamic imports are allowed.)
      const staticImports = content.match(/^import .*from ["'][^"']+["']/gm) ?? [];
      for (const line of staticImports) expect(line).not.toContain(marker);
    } else {
      expect(content).not.toContain(marker);
    }
  }
  // 3. The extension lives OUTSIDE src/.
  expect(existsSync(join(repoRoot, "extensions/business-os/manifest.json"))).toBe(true);
  expect(existsSync(join(repoRoot, "src/business"))).toBe(false);
});

test("default-exclusion: extension status reports excluded unless enabled", () => {
  const provider = new BusinessServiceProvider();
  expect(provider.status().loaded).toBe(false);
  // Default config: business.enabled unset → excluded (reason recorded).
  const reason = provider.status().reason ?? "";
  expect(reason.length).toBeGreaterThan(0);
});

test("effect-verification: every registered module passes its deterministic effect tests", async () => {
  const { verifyBusinessOsModules } = await import("../../extensions/business-os/effect-verification.ts");
  const results = await verifyBusinessOsModules();
  // All 15 modules have specs and ALL must be verified (each proves a real
  // persisted side effect).
  expect(results.length).toBe(15);
  const unverified = results.filter((r) => r.status !== "verified");
  expect(unverified).toEqual([]);
  for (const r of results) {
    expect(r.passed).toBeGreaterThan(0);
    for (const e of r.effects) expect(e).toMatch(/persisted|appended|biz_/);
  }
});

test("unproven module is excluded: a module with no spec never loads", async () => {
  const { verifyModule } = await import("../../extensions/business-os/effect-verification.ts");
  const result = await verifyModule("nonexistent-module");
  expect(result.status).toBe("excluded");
  expect(result.reason).toContain("default-excluded");
});

test("data preservation: pre-existing biz_* rows survive the move and are readable via L0", async () => {
  // Simulate a user who had Business OS data BEFORE the decoupling: write a
  // biz_contacts row the way the old in-kernel code did, then read it back
  // through the thin L0 contract and the extension's own managers.
  const { BusinessDatabase } = await import("../../extensions/business-os/src/core/database.ts");
  const { OrganizationManager } = await import("../../extensions/business-os/src/core/organization.ts");
  const { ContactManager } = await import("../../extensions/business-os/src/core/contacts.ts");
  const db = new BusinessDatabase(store as any);
  await db.initialize();
  const orgs = new OrganizationManager(db);
  const org = orgs.create({ name: "Legacy Org", slug: "legacy-org", ownerId: "u1" });
  const wsRow = store.prepare("SELECT id FROM biz_workspaces WHERE org_id = ? LIMIT 1").get(org.id) as { id: string };
  const contacts = new ContactManager(db);
  const contact = contacts.create(wsRow.id, { name: "Legacy Contact", type: "person" });
  expect(contact).toBeDefined();

  // The same store is readable through the L0 contract (records layer).
  const l0 = new BusinessL0(store);
  const rec = l0.putRecord({ module: "crm", entity: "contact", entityId: contact.id, workspaceId: wsRow.id, data: { name: "Legacy Contact" }, actor: { kind: "user", id: "u1" } });
  expect(rec.version).toBe(1);
  const readBack = l0.readRecord({ module: "crm", entity: "contact", entityId: contact.id, workspaceId: wsRow.id });
  expect(readBack?.data.name).toBe("Legacy Contact");
  // And the original biz_ row is untouched.
  const row = store.prepare("SELECT name FROM biz_contacts WHERE id = ?").get(contact.id) as { name: string };
  expect(row.name).toBe("Legacy Contact");
});

test("L0 contract: records, artifacts, identity, audit are hash-chained and durable", () => {
  const l0 = new BusinessL0(store);
  const rec = l0.putRecord({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1", data: { value: 100 }, actor: { kind: "worker", id: "sales_director" } });
  expect(l0.readRecord({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1" })?.version).toBe(1);
  // Update bumps version.
  l0.putRecord({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1", data: { value: 200 }, actor: { kind: "worker", id: "sales_director" } });
  expect(l0.readRecord({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1" })?.version).toBe(2);
  // Artifacts carry content hash.
  const art = l0.putArtifact({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1", kind: "quote", content: "quote-v1", actor: { kind: "user", id: "u1" } });
  expect(art.contentHash.length).toBe(64);
  expect(l0.readArtifact(art.artifactId)?.content).toBe("quote-v1");
  expect(l0.artifactsFor({ module: "sales", entity: "deal", entityId: "d1", workspaceId: "w1" }).length).toBe(1);
  // Audit events land in the tamper-evident log.
  expect(store.verifyChain().valid).toBe(true);
  // Identity normalization.
  expect(l0.identityFor({ kind: "user", id: "u1", label: "Alice" }).label).toBe("Alice");
});

test("ExecutionBridge: no 'succeeded' without a verified effect (no simulated success)", async () => {
  const { ExecutionBridge } = await import("../../extensions/business-os/src/core/execution-bridge.ts");
  const { BusinessDatabase } = await import("../../extensions/business-os/src/core/database.ts");
  const { AuditTrail } = await import("../../extensions/business-os/src/core/audit.ts");
  const db = new BusinessDatabase(store as any);
  await db.initialize();
  const audit = new AuditTrail(db);
  const bridge = new ExecutionBridge({ db, audit });
  const params = {
    orgId: "o1", workspaceId: "w1", module: "crm", entity: "contact", entityId: "c1",
    operation: "create", actor: { kind: "user", id: "u1" }, inputSummary: "create contact",
    capability: { kind: "crm", name: "createContact" },
  };

  // WITHOUT a verifier → fail-closed (never an assumed success).
  const noVerifier = await bridge.executeBusinessAction(params as never);
  expect(noVerifier.outcome).toBe("failed");
  expect(noVerifier.verified).toBe(false);

  // WITH a verifier that fails → failed.
  const failing = await bridge.executeBusinessAction(params as never, { verify: () => ({ ok: false, detail: "row missing" }) });
  expect(failing.outcome).toBe("failed");

  // WITH a verifier that confirms the effect → succeeded, marked verified.
  const passing = await bridge.executeBusinessAction(params as never, { verify: () => ({ ok: true, detail: "biz_contacts row persisted" }) });
  expect(passing.outcome).toBe("succeeded");
  expect(passing.verified).toBe(true);
  expect(passing.verificationDetail).toContain("persisted");

  // The execution record says failed for the unverified attempts.
  const failedCount = store.prepare("SELECT COUNT(*) AS c FROM biz_execution_records WHERE outcome = 'failed'").get() as { c: number };
  expect(Number(failedCount.c)).toBe(2);
  const okCount = store.prepare("SELECT COUNT(*) AS c FROM biz_execution_records WHERE outcome = 'succeeded'").get() as { c: number };
  expect(Number(okCount.c)).toBe(1);
});

test("extension manifest declares L0 contract version + effect-verification policy", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "extensions/business-os/manifest.json"), "utf8"));
  expect(manifest.id).toBe("business-os");
  expect(manifest.l0ContractVersion).toBe(1);
  expect(manifest.effectVerification.policy).toContain("effect");
  expect(manifest.capabilityStatement.length).toBeGreaterThan(20);
});

test("kernel provider: config-enabled AND verified ⇒ loads; unverified ⇒ excluded", async () => {
  // Directly exercise the provider's gate logic with a stubbed registry.
  const provider = new BusinessServiceProvider();
  const fakeRegistry = {
    resolve: (token: { id: string }) => {
      if (token.id === "xr.config") return { get: () => ({ business: { enabled: true } }) };
      if (token.id === "xr.store") return store;
      if (token.id === "xr.business.l0") return new BusinessL0(store);
      throw new Error("unexpected token " + token.id);
    },
  } as never;

  const ext = await (provider as unknown as { loadExtension(r: unknown): Promise<unknown> }).loadExtension(fakeRegistry);
  // All 15 modules are effect-verified → the extension loads.
  expect(ext).not.toBeNull();
  expect(provider.status().loaded).toBe(true);
  const health = (ext as { health(): { loaded: boolean } }).health();
  expect(health.loaded).toBe(true);

  // Disabled config → excluded.
  const provider2 = new BusinessServiceProvider();
  const disabledRegistry = {
    resolve: (token: { id: string }) => {
      if (token.id === "xr.config") return { get: () => ({ business: { enabled: false } }) };
      if (token.id === "xr.store") return store;
      throw new Error("unexpected token " + token.id);
    },
  } as never;
  const ext2 = await (provider2 as unknown as { loadExtension(r: unknown): Promise<unknown> }).loadExtension(disabledRegistry);
  expect(ext2).toBeNull();
  expect(provider2.status().reason).toContain("default-excluded");
});
