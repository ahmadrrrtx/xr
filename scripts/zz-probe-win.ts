// TEMPORARY diagnostic (removed before merge)
import { mkdtempSync, mkdirSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const out = (...a: unknown[]) => console.log("[dbg]", ...a);
const { FilesystemAuthority, canonicalAbsolute } = await import("../src/security/filesystem.ts");
const { classifyRisk } = await import("../src/runtime/trust/classify.ts");
const { readTrustRequest } = await import("../src/runtime/trust/tool-support.ts");
const { createGrant, AuthorityRegistry } = await import("../src/runtime/trust/authority.ts");
const { filesystemFromGrant } = await import("../src/runtime/trust/filesystem.ts");
const base0 = mkdtempSync(join(tmpdir(), "dbg-")); const root0 = join(base0, "workspace"); mkdirSync(root0);
const { realpathSync } = await import("node:fs");
const root = realpathSync(root0);
writeFileSync(join(root, "allowed.txt"), "A"); writeFileSync(join(root, "blocked.txt"), "B");
writeFileSync(join(root, ".env"), "S"); linkSync(join(root, ".env"), join(root, "alias.txt"));
out("root", root, "root0", root0);
const d = new FilesystemAuthority(root, "desktop"); const rootIdentity = d.descriptor().rootIdentity; d.close();
const c = classifyRisk(readTrustRequest("read_file", root));
const grant = createGrant({ actor: "synthetic-trusted-host", executionId: "test-execution", correlationId: "test-correlation", workspaceId: root, capability: "file:read" }, {
  ...c, fs: { ...c.fs, readOnlyRoots: [root], writableRoots: [], blockedPaths: [join(root, "blocked.txt")], contentScope: { root, rootIdentity, purpose: "desktop", operations: ["read", "list"] } },
});
const registry = new AuthorityRegistry(); registry.register(grant);
const fs = filesystemFromGrant(registry, { grantId: grant.grantId, actor: grant.actor, executionId: grant.executionId, workspaceId: root, purpose: "desktop" });
out("fs.root", fs.root, "blocked", grant.fs.blockedPaths);
const absB = resolve(fs.root, "blocked.txt");
out("absB", absB, "permits read", (fs as any).lease.permits(absB, "read", "x"));
try { out("metadata blocked", JSON.stringify(fs.metadata("blocked.txt"))); } catch (e) { out("metadata blocked THREW", (e as Error).message); }
try { out("metadata allowed", JSON.stringify(fs.metadata("allowed.txt")).slice(0, 80)); } catch (e) { out("metadata allowed THREW", (e as Error).message); }
try { out("read alias", fs.read("alias.txt").content); } catch (e) { out("read alias THREW", (e as Error).message); }
try { out("prepare alias write", typeof fs.prepare("alias.txt", "write")); } catch (e) { out("prepare alias write THREW", (e as Error).message); }
fs.close();
