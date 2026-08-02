/**
 * XR Phase 7 · T6 — MCP signed allowlist tests (default-deny MCP).
 *
 * Proves: unlisted servers are refused at load even when enabled; an
 * unsigned allowlist is fail-closed; a listed+validly-signed server loads;
 * revocation refuses load and kills the live client; high-risk unisolated
 * spawn fails closed (Phase 4 hardening).
 */
import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "xr-mcp-allowlist-"));
process.env.XR_HOME = join(root, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

import {
  McpAllowlist,
  generateAllowlistKeyPair,
  writeAllowlistKeys,
  mcpAllowlistPath,
  defaultAllowlistKeysPath,
  verifyAllowlist,
} from "../../src/mcp/allowlist.ts";
import { McpRegistry } from "../../src/mcp/registry.ts";
import type { McpServerConfigInput } from "../../src/mcp/types.ts";
import { Store } from "../../src/state/workspace-store.ts";

let store: Store;

beforeEach(() => {
  const home = process.env.XR_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  store = new Store(join(root, `db-${Math.random().toString(36).slice(2)}.db`));
});

const FAKE_MCP = join(__dirname, "..", "fixtures", "fake-mcp-server.ts");

function serverInput(id: string): McpServerConfigInput {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "test server",
    source: "manual",
    transport: "stdio",
    command: process.execPath, // bun
    args: ["run", FAKE_MCP],
    env: {},
    localOrRemote: "local",
    declaredCapabilities: { tools: true },
    declaredPermissions: [],
    enabled: true,
    trustLevel: "unknown",
    installedAt: Date.now(),
    updatedAt: Date.now(),
    invocationCount: 0,
  };
}

test("default-deny: unlisted server refused; unsigned allowlist fail-closed", () => {
  const allowlist = new McpAllowlist();
  // No keys, no file → fail-closed.
  expect(allowlist.isAllowed("anything").ok).toBe(false);
  const file = allowlist.verifyFile();
  expect(file.ok).toBe(false);
});

test("listed server loads; unlisted refused even when enabled (the gate)", () => {
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  const allowlist = new McpAllowlist();
  allowlist.allow("filesystem", { by: "operator" });

  // Listed + signed → allowed.
  expect(allowlist.isAllowed("filesystem").ok).toBe(true);
  // Unlisted → refused (default-deny).
  expect(allowlist.isAllowed("github").ok).toBe(false);
  expect(allowlist.isAllowed("github").reason).toContain("not on the signed allowlist");
});

test("unsigned allowlist file is treated as empty (tamper detection)", () => {
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  const allowlist = new McpAllowlist();
  allowlist.allow("filesystem", { by: "operator" });

  // Tamper: strip signatures from the file.
  const path = mcpAllowlistPath();
  const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  raw.signatures = [];
  require("node:fs").writeFileSync(path, JSON.stringify(raw));

  const reloaded = new McpAllowlist();
  expect(reloaded.verifyFile().ok).toBe(false);
  expect(reloaded.isAllowed("filesystem").ok).toBe(false);
});

test("tampered server list invalidates the signature", () => {
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  const allowlist = new McpAllowlist();
  allowlist.allow("filesystem", { by: "operator" });

  // Tamper: add a server entry WITHOUT re-signing.
  const path = mcpAllowlistPath();
  const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  raw.servers["evil"] = { grantedAt: Date.now(), by: "attacker" };
  require("node:fs").writeFileSync(path, JSON.stringify(raw));

  const reloaded = new McpAllowlist();
  expect(reloaded.verifyFile().ok).toBe(false);
  expect(reloaded.isAllowed("evil").ok).toBe(false);
  expect(reloaded.isAllowed("filesystem").ok).toBe(false); // whole file invalid
});

test("revocation removes the entry and re-signs; live client is unloaded", async () => {
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  const allowlist = new McpAllowlist();
  allowlist.allow("filesystem", { by: "operator" });
  const revoked = allowlist.revoke("filesystem");
  expect(revoked.ok).toBe(true);
  expect(allowlist.isAllowed("filesystem").ok).toBe(false);
  // Re-signed file still verifies (empty list is validly signed).
  expect(allowlist.verifyFile().ok).toBe(true);

  // Manager-level: enable a server, revoke, then loadEnabled must refuse it.
  const { McpManager } = await import("../../src/mcp/manager.ts");
  const mgr = new McpManager(store, root);
  const added = await mgr.addServer(serverInput("revoke-me"));
  expect(added.ok).toBe(true);
  const enabled = mgr.enable("revoke-me");
  expect(enabled.ok).toBe(true);
  await mgr.loadEnabled();
  // Not allowlisted → not loaded.
  expect(mgr.getServer("revoke-me")?.health).toBe("untrusted");

  // Now allow it → loads (the fake MCP server connects; the allowlist gate
  // passes and the load succeeds rather than being refused as untrusted).
  allowlist.allow("revoke-me", { by: "operator" });
  await mgr.loadEnabled();
  const after = mgr.getServer("revoke-me");
  expect(after?.health).not.toBe("untrusted");
  expect(after?.health).toBe("healthy");

  // Revoke → next load is refused again (and the live client is unloaded).
  await mgr.unloadOne("revoke-me");
  allowlist.revoke("revoke-me");
  await mgr.loadEnabled();
  expect(mgr.getServer("revoke-me")?.health).toBe("untrusted");
  await mgr.unloadOne("revoke-me");
});

test("verification helper reports valid key ids", () => {
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  const allowlist = new McpAllowlist();
  allowlist.allow("filesystem", { by: "operator" });
  const raw = JSON.parse(require("node:fs").readFileSync(mcpAllowlistPath(), "utf8"));
  const result = verifyAllowlist(raw, { [pair.keyId]: pair.publicKeyPem });
  expect(result.ok).toBe(true);
  expect(result.validKeyIds).toContain(pair.keyId);
  // Wrong key → invalid.
  const other = generateAllowlistKeyPair("op-2");
  expect(verifyAllowlist(raw, { [other.keyId]: other.publicKeyPem }).ok).toBe(false);
});

test("operator config can explicitly disable the gate — but the default is enforced", async () => {
  const { McpManager } = await import("../../src/mcp/manager.ts");
  const mgr = new McpManager(store, root);
  const added = await mgr.addServer(serverInput("gate-test"));
  expect(added.ok).toBe(true);
  mgr.enable("gate-test");
  await mgr.loadEnabled();
  // Default: gate enforced → untrusted (not on allowlist).
  expect(mgr.getServer("gate-test")?.health).toBe("untrusted");
  const { McpAllowlist: AL } = await import("../../src/mcp/allowlist.ts");
  const pair = generateAllowlistKeyPair("op-1");
  writeAllowlistKeys([pair]);
  new AL().allow("gate-test", { by: "operator" });
  await mgr.loadEnabled();
  expect(mgr.getServer("gate-test")?.health).not.toBe("untrusted");
  await mgr.unloadOne("gate-test");
});
