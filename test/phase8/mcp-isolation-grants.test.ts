/**
 * XR Phase 8 · XR805 — MCP allowlist v2 isolation grants; env flag gone.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpAllowlist,
  generateAllowlistKeyPair,
  writeAllowlistKeys,
  mcpAllowlistPath,
  MCP_ALLOWLIST_SCHEMA_VERSION,
  signAllowlist,
  verifyAllowlist,
} from "../../src/mcp/allowlist.ts";

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "xr-p8-mcp-"));
  process.env.XR_HOME = join(home, "home");
  mkdirSync(process.env.XR_HOME, { recursive: true });
});

describe("XR805 MCP allowlist v2", () => {
  test("schema version is 2; default isolation is required", () => {
    expect(MCP_ALLOWLIST_SCHEMA_VERSION).toBe(2);
    const pair = generateAllowlistKeyPair("op-1");
    writeAllowlistKeys([pair]);
    const al = new McpAllowlist();
    al.allow("fs", { by: "operator" });
    expect(al.isolationGrant("fs")).toBe("required");
    expect(al.isolationGrant("missing")).toBe("required");
    const raw = JSON.parse(readFileSync(mcpAllowlistPath(), "utf8"));
    expect(raw.schemaVersion).toBe(2);
    expect(raw.servers.fs.isolation).toBe("required");
  });

  test("--unisolated writes a signed granted-unisolated-by grant", () => {
    const pair = generateAllowlistKeyPair("op-1");
    writeAllowlistKeys([pair]);
    const al = new McpAllowlist();
    al.allow("creds", { by: "operator", isolation: "unisolated" });
    expect(al.isolationGrant("creds")).toBe("granted-unisolated-by:operator");
    expect(al.verifyFile().ok).toBe(true);
  });

  test("tampering isolation invalidates the v2 signature", () => {
    const pair = generateAllowlistKeyPair("op-1");
    writeAllowlistKeys([pair]);
    const al = new McpAllowlist();
    al.allow("creds", { by: "operator" });
    const path = mcpAllowlistPath();
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.servers.creds.isolation = "granted-unisolated-by:attacker";
    writeFileSync(path, JSON.stringify(raw));
    const reloaded = new McpAllowlist();
    expect(reloaded.verifyFile().ok).toBe(false);
  });

  test("v1 files still verify (isolation not in v1 digest)", () => {
    const pair = generateAllowlistKeyPair("op-1");
    const servers = { fs: { grantedAt: 1, by: "operator" } };
    const sig = signAllowlist(servers, pair.privateKeyPem!, pair.keyId, 1);
    const file = { schemaVersion: 1, generatedAt: 1, servers, signatures: [sig] };
    const v = verifyAllowlist(file, { [pair.keyId]: pair.publicKeyPem });
    expect(v.ok).toBe(true);
  });

  test("reSign upgrades to v2 with isolation=required", () => {
    const pair = generateAllowlistKeyPair("op-1");
    writeAllowlistKeys([pair]);
    const al = new McpAllowlist();
    al.allow("fs", { by: "operator" });
    const r = al.reSign();
    expect(r.ok).toBe(true);
    expect(al.isolationGrant("fs")).toBe("required");
    expect(al.verifyFile().ok).toBe(true);
  });
});
