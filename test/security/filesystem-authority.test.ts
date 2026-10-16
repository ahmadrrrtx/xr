import { expect, test } from "bun:test";
import { closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemAuthority } from "../../src/security/filesystem.ts";
import { anchoredOpen, descriptorIo, fdClose, fdReadAll, FD_FLAGS } from "../../src/security/fs-native.ts";
import { AuthorityRegistry, createGrant } from "../../src/runtime/trust/authority.ts";
import { filesystemFromGrant } from "../../src/runtime/trust/filesystem.ts";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import { readTrustRequest } from "../../src/runtime/trust/tool-support.ts";
import { readFileTool } from "../../src/tools/files.ts";

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "a1-authority-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("FS02/FS10 missing destination parents are approval-bound and made only on commit", () => fixture(root => {
  const fs = new FilesystemAuthority(root), p = fs.prepare("new/nested/file.txt", "write");
  try {
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(p.identity.missingParents).toEqual(["new", "nested"]);
    p.commit("SAFE_CREATED");
    expect(readFileSync(join(root, "new/nested/file.txt"), "utf8")).toBe("SAFE_CREATED");
  } finally { p.close(); fs.close(); }
}));
test("FS10 missing ancestor appearing after approval invalidates creation", () => fixture(root => {
  const fs = new FilesystemAuthority(root), p = fs.prepare("new/nested/file.txt", "write");
  try {
    mkdirSync(join(root, "new"));
    expect(() => p.commit("NEVER_WRITTEN")).toThrow();
    expect(existsSync(join(root, "new/nested"))).toBe(false);
  } finally { p.close(); fs.close(); }
}));
test("FS03 canonical root alias is usable; hostile components and foreign spellings refuse", () => fixture(parent => {
  const root = join(parent, "workspace"), alias = join(parent, "alias"); mkdirSync(root); symlinkSync(root, alias);
  writeFileSync(join(root, "ordinary.txt"), "SAFE_ROOT_ALIAS");
  const fs = new FilesystemAuthority(alias);
  try {
    expect(fs.read(join(alias, "ordinary.txt")).content).toBe("SAFE_ROOT_ALIAS");
    expect(fs.read(join(root, "ordinary.txt")).content).toBe("SAFE_ROOT_ALIAS");
    for (const p of ["../outside.txt", "nested/../../ordinary.txt", "nested\\ordinary.txt", "C:\\ordinary.txt", "//server/share", "x\0y"]) expect(() => fs.read(p)).toThrow();
  } finally { fs.close(); }
}));
test("FS04 exact dotenv templates are ordinary context, nested suffixes and keys are sensitive", () => fixture(root => {
  const fs = new FilesystemAuthority(root);
  try {
    for (const p of [".env.example", ".env.sample", ".env.template"]) { writeFileSync(join(root, p), "SAFE_TEMPLATE"); expect(fs.read(p).content).toBe("SAFE_TEMPLATE"); }
    for (const p of [".env", ".ENV.PRODUCTION.LOCAL", ".env.example.local", "private.key", "credentials.backup.txt"]) { writeFileSync(join(root, p), "SYNTHETIC_SECRET"); expect(() => fs.read(p)).toThrow(); }
  } finally { fs.close(); }
}));
test("FS13 FIFO, device alias and hardlinks refuse before content I/O", () => fixture(root => {
  // FIFO and device-node cases are POSIX-only; the hardlink case runs everywhere.
  const posix = process.platform !== "win32";
  const special: string[] = [];
  if (posix) {
    const made = spawnSync("mkfifo", [join(root, "pipe.txt")]); expect(made.status).toBe(0);
    special.push("pipe.txt");
    symlinkSync("/dev/zero", join(root, "device.txt"));
    special.push("device.txt");
  }
  writeFileSync(join(root, ".env"), "SYNTHETIC_SECRET"); linkSync(join(root, ".env"), join(root, "alias.txt"));
  const denied = [...special, "alias.txt"];
  const fs = new FilesystemAuthority(root);
  try {
    for (const p of denied) {
      expect(() => fs.read(p)).toThrow(); expect(() => fs.prepare(p, "write")).toThrow(); expect(() => fs.prepare(p, "delete")).toThrow();
    }
    expect(fs.list().some(e => denied.includes(e.name))).toBe(false);
  } finally { fs.close(); }
}));
test("FS11 native retained read does not follow a parent swapped after acquisition", () => fixture(root => {
  mkdirSync(join(root, "workspace")); mkdirSync(join(root, "workspace/parent")); mkdirSync(join(root, "outside"));
  writeFileSync(join(root, "workspace/parent/data.txt"), "SAFE_INODE"); writeFileSync(join(root, "outside/data.txt"), "SYNTHETIC_OUTSIDE");
  const r = anchoredOpen(-100, join(root, "workspace"), FD_FLAGS.PATH | FD_FLAGS.DIRECTORY, 0, true);
  const f = anchoredOpen(r, "parent/data.txt", FD_FLAGS.PATH);
  try {
    const swapped = trySwapDir(join(root, "workspace/parent"), join(root, "workspace/original"));
    if (swapped) symlinkSync(join(root, "outside"), join(root, "workspace/parent"));
    const io = descriptorIo(f, false);
    try { expect(fdReadAll(io).toString("utf8")).toBe("SAFE_INODE"); } finally { fdClose(io); }
    if (swapped) expect(() => anchoredOpen(r, "parent/data.txt", FD_FLAGS.PATH)).toThrow();
    expect(readFileSync(join(root, "outside/data.txt"), "utf8")).toBe("SYNTHETIC_OUTSIDE");
  } finally { fdClose(f); fdClose(r); }
}));

// Windows refuses to rename a directory while a handle bound by a pending approval or
// retained read is open. That refusal is the stronger guarantee; the swap then never happens.
function trySwapDir(from: string, to: string): boolean {
  try { renameSync(from, to); return true; } catch (e) {
    if (process.platform === "win32" && (e as NodeJS.ErrnoException).code === "EPERM") return false;
    throw e;
  }
}

function grantFixture(root: string) {
  // Grants record the canonical root (realpath); macOS temp dirs are /var -> /private/var aliases.
  root = realpathSync(root);
  const fs = new FilesystemAuthority(root, "desktop"), descriptor = fs.descriptor(), exact = fs.metadata(".env"); fs.close();
  const classification = classifyRisk(readTrustRequest("read_file", root));
  const grant = createGrant({ actor: "trusted-desktop", executionId: "synthetic-run", correlationId: "synthetic-correlation", workspaceId: root, capability: "file:read", approvalRef: "synthetic-explicit-disclosure-consent" }, {
    ...classification, fs: { ...classification.fs, writableRoots: [root], readOnlyRoots: [], blockedPaths: [], contentScope: { root, rootIdentity: descriptor.rootIdentity, purpose: "desktop", operations: ["read", "write", "list"], sensitiveReads: [{ path: join(root, ".env"), objectId: exact.objectId }] } },
  });
  const registry = new AuthorityRegistry(); registry.register(grant);
  const use = { grantId: grant.grantId, actor: grant.actor, executionId: grant.executionId, workspaceId: root, purpose: "desktop" as const };
  return { registry, use, grant };
}
test("FS04/FS14 trusted registry-backed narrow disclosure works; yolo/labels cannot create it", async () => {
  const root = mkdtempSync(join(tmpdir(), "a1-grant-"));
  try {
    writeFileSync(join(root, ".env"), "SYNTHETIC_EXPLICITLY_CONSENTED"); writeFileSync(join(root, ".env.other"), "SYNTHETIC_NOT_CONSENTED");
    const { registry, use } = grantFixture(root), fs = filesystemFromGrant(registry, use);
    try {
      const allowed = await readFileTool.run({ path: ".env", grant: "model-invented" }, { cwd: root, filesystem: fs, audit() {}, approve: async () => true });
      expect(allowed.ok).toBe(true); expect(allowed.output).toBe("SYNTHETIC_EXPLICITLY_CONSENTED");
      expect(() => fs.read(".env.other")).toThrow();
      const without = await readFileTool.run({ path: ".env", grantId: use.grantId }, { cwd: root, audit() {}, approve: async () => true }); expect(without.ok).toBe(false);
      expect(fs.descriptor().grantId).toBe(use.grantId); expect(fs.descriptor().grantGeneration).not.toBeNull(); expect(fs.descriptor().deniedPathPolicyId.length).toBe(64);
      registry.revoke(use.grantId, "synthetic revocation"); expect(() => fs.read(".env")).toThrow();
    } finally { fs.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("FS10/FS14 grant actor, workspace, purpose, registered identity and exact object bind every use", () => fixture(root => {
  writeFileSync(join(root, ".env"), "SYNTHETIC_EXACT"); writeFileSync(join(root, "ordinary.txt"), "SAFE_ORIGINAL");
  const { registry, use, grant } = grantFixture(root);
  for (const bad of [{ actor: "model" }, { executionId: "other" }, { workspaceId: "/other" }, { purpose: "model-tool" as const }, { grantId: "model-invented" }]) expect(() => filesystemFromGrant(registry, { ...use, ...bad })).toThrow();
  const fs = filesystemFromGrant(registry, use), p = fs.prepare("ordinary.txt", "write");
  try {
    // Replacing a registry entry with an equal-looking serialized grant invalidates old capabilities.
    registry.register({ ...grant });
    expect(() => p.commit("NEVER_WRITTEN")).toThrow(); expect(readFileSync(join(root, "ordinary.txt"), "utf8")).toBe("SAFE_ORIGINAL");
  } finally { p.close(); fs.close(); }
  registry.register(grant); const fresh = filesystemFromGrant(registry, use);
  try {
    renameSync(join(root, ".env"), join(root, "old")); writeFileSync(join(root, ".env"), "SYNTHETIC_DIFFERENT_OBJECT");
    expect(() => fresh.read(".env")).toThrow();
  } finally { fresh.close(); }
}));
