/** A1 F03 decision: outside-root desktop file access needs a trusted, registered, revocable grant. */
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityRegistry, createGrant } from "../../src/runtime/trust/authority.ts";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import { readTrustRequest } from "../../src/runtime/trust/tool-support.ts";

const base = mkdtempSync(join(tmpdir(), "a1-grant-"));
const home = join(base, "home");
const granted = join(base, "granted");
mkdirSync(home); mkdirSync(granted);
writeFileSync(join(home, "home.txt"), "HOME_OK");
writeFileSync(join(granted, "doc.txt"), "GRANTED_OK");
writeFileSync(join(granted, ".env"), "GRANT_SECRET_CANARY=1");
writeFileSync(join(base, "elsewhere.txt"), "ELSEWHERE_CANARY");

let files: typeof import("../../src/control/files.ts");
let registry: AuthorityRegistry;
let grantId = "";

function mint(root: string, purpose: "desktop" | "model-tool" = "desktop") {
  const classification = classifyRisk(readTrustRequest("read_file", root));
  const grant = createGrant({ actor: "trusted-desktop", executionId: "synthetic-desktop-run", correlationId: "synthetic-corr", workspaceId: root, capability: "file:read", approvalRef: "synthetic-approval" }, {
    ...classification,
    fs: { ...classification.fs, writableRoots: [root], readOnlyRoots: [], blockedPaths: [], contentScope: { root, rootIdentity: "", purpose, operations: ["read", "write", "list"] } },
  });
  return grant;
}

beforeAll(async () => {
  process.env.XR_FILES_ROOT = home;
  files = await import("../../src/control/files.ts");
  registry = new AuthorityRegistry();
  files.setDesktopGrantRegistry(registry);
});

test("outside-root read without a grant is refused; the outside bytes never come back", async () => {
  const r = await files.fileRead(join(granted, "doc.txt"));
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("GRANTED_OK");
});

test("positive: in-home read still works without any grant", async () => {
  const r = await files.fileRead("home.txt");
  expect(r.ok).toBe(true);
  expect(JSON.stringify(r.data)).toContain("HOME_OK");
});

test("an unknown or model-invented grant id grants nothing", async () => {
  const r = await files.fileRead(join(granted, "doc.txt"), "grant_invented");
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("GRANTED_OK");
});

test("a registered desktop grant allows its own root (read and write), outside HOME", async () => {
  // rootIdentity is filled from the live authority so the grant matches the real directory.
  const { FilesystemAuthority } = await import("../../src/security/filesystem.ts");
  const fs = new FilesystemAuthority(granted, "desktop");
  const grant = mint(granted);
  fs.close();
  const bound = { ...grant, fs: { ...grant.fs, contentScope: { ...grant.fs.contentScope!, rootIdentity: fs.rootIdentity } } };
  registry.register(bound as typeof grant);
  grantId = bound.grantId;

  const read = await files.fileRead(join(granted, "doc.txt"), grantId);
  expect(read.ok).toBe(true);
  expect(JSON.stringify(read.data)).toContain("GRANTED_OK");

  const write = await files.fileWrite(join(granted, "new.txt"), "WRITTEN", grantId);
  expect(write.ok).toBe(true);
  expect(readFileSync(join(granted, "new.txt"), "utf8")).toBe("WRITTEN");
});

test("the grant never reaches outside its own root or sensitive files", async () => {
  const outsideGrant = await files.fileRead(join(base, "elsewhere.txt"), grantId);
  expect(outsideGrant.ok).toBe(false);
  expect(JSON.stringify(outsideGrant)).not.toContain("ELSEWHERE_CANARY");

  const env = await files.fileRead(join(granted, ".env"), grantId);
  expect(env.ok).toBe(false);
  expect(JSON.stringify(env)).not.toContain("GRANT_SECRET_CANARY");
});

test("a revoked grant stops working immediately", async () => {
  registry.revoke(grantId, "synthetic revocation");
  const r = await files.fileRead(join(granted, "doc.txt"), grantId);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("GRANTED_OK");
});

test("a grant bound to another purpose (model-tool) is refused by the desktop path", async () => {
  const { FilesystemAuthority } = await import("../../src/security/filesystem.ts");
  const fs = new FilesystemAuthority(base, "desktop");
  const grant = mint(base, "model-tool");
  fs.close();
  const bound = { ...grant, grantId: "grant_wrong_purpose", fs: { ...grant.fs, contentScope: { ...grant.fs.contentScope!, rootIdentity: fs.rootIdentity } } };
  registry.register(bound as typeof grant);
  const r = await files.fileRead(join(base, "elsewhere.txt"), "grant_wrong_purpose");
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("ELSEWHERE_CANARY");
  expect(existsSync(join(base, "elsewhere.txt"))).toBe(true);
});

test("move stays an explicit refusal even with a grant", async () => {
  const r = await files.fileMove(join(granted, "doc.txt"), join(granted, "moved.txt"));
  expect(r.ok).toBe(false);
  expect(existsSync(join(granted, "doc.txt"))).toBe(true);
});
