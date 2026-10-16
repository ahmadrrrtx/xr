/** A1 implicit-consumer positives and operation-policy regressions. No real credentials. */
import { expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowRecord } from "../../src/agents/types.ts";
import { buildArtifactManifest } from "../../src/services/multi-agent-orchestration.ts";
import { capturePreImage } from "../../src/platform/environment/providers/filesystem.ts";
import { FilesystemAuthority } from "../../src/security/filesystem.ts";
import { AuthorityRegistry, createGrant } from "../../src/runtime/trust/authority.ts";
import { filesystemFromGrant } from "../../src/runtime/trust/filesystem.ts";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import { readTrustRequest } from "../../src/runtime/trust/tool-support.ts";
import { shellTool } from "../../src/tools/system.ts";

async function fixture(run: (root: string, base: string) => void | Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), "a1-implicit-")), root0 = join(base, "workspace");
  mkdirSync(root0);
  // Grants record the canonical root (macOS /var -> /private/var).
  const root = realpathSync(root0);
  try { await run(root, base); } finally { rmSync(base, { recursive: true, force: true }); }
}
function scoped(root: string) {
  const ordinary = new FilesystemAuthority(root, "desktop"), d = ordinary.descriptor(); ordinary.close();
  const c = classifyRisk(readTrustRequest("read_file", root));
  const grant = createGrant({ actor: "synthetic-trusted-host", executionId: "test-execution", correlationId: "test-correlation", workspaceId: root, capability: "file:read" }, {
    ...c, fs: { ...c.fs, readOnlyRoots: [root], writableRoots: [], blockedPaths: [join(root, "blocked.txt")], contentScope: { root, rootIdentity: d.rootIdentity, purpose: "desktop", operations: ["read", "list"] } },
  });
  const registry = new AuthorityRegistry(); registry.register(grant);
  return filesystemFromGrant(registry, { grantId: grant.grantId, actor: grant.actor, executionId: grant.executionId, workspaceId: root, purpose: "desktop" });
}

test("FS14 blocked-path grant applies to metadata and list candidates, not just content", async () => fixture(root => {
  writeFileSync(join(root, "allowed.txt"), "SAFE_METADATA_CONTROL");
  writeFileSync(join(root, "blocked.txt"), "SYNTHETIC_BLOCKED_BODY");
  const fs = scoped(root);
  try {
    let metadataDenied = false;
    try { fs.metadata("blocked.txt"); } catch { metadataDenied = true; }
    expect({ metadataDenied, names: fs.list().map(e => e.name) }).toEqual({ metadataDenied: true, names: ["allowed.txt"] });
    expect(fs.read("allowed.txt").content).toBe("SAFE_METADATA_CONTROL");
    expect(() => fs.read("blocked.txt")).toThrow();
  } finally { fs.close(); }
}));

test("FS05 artifact hashing preserves allowed binary hashes and distinguishes denied from absent", async () => fixture((root, base) => {
  const binary = Buffer.from([0, 1, 2, 255, 17]);
  writeFileSync(join(root, "safe.bin"), binary);
  writeFileSync(join(root, ".env"), "SYNTHETIC_ARTIFACT_SECRET");
  writeFileSync(join(base, "outside.txt"), "SYNTHETIC_ARTIFACT_OUTSIDE");
  symlinkSync(join(base, "outside.txt"), join(root, "linked.txt"));
  linkSync(join(base, "outside.txt"), join(root, "alias.txt"));
  const paths = ["safe.bin", ".env", "linked.txt", "alias.txt", "absent.txt", "../outside.txt"];
  const record = { workflowId: "synthetic-workflow", tasks: [{ taskId: "builder", role: "builder", outputs: { artifacts: paths.map(path => ({ path })) } }] } as unknown as WorkflowRecord;
  const manifest = buildArtifactManifest(record, root);
  expect(manifest.entries[0]).toMatchObject({ exists: true, sizeBytes: binary.length, sha256: createHash("sha256").update(binary).digest("hex").slice(0, 32) });
  const byPath = new Map(manifest.entries.map(e => [e.path, e]));
  expect(byPath.get("absent.txt")?.note).toContain("MISSING");
  for (const path of [".env", "linked.txt", "alias.txt", "../outside.txt"]) {
    expect(byPath.get(path)?.sha256).toBeNull();
    expect(byPath.get(path)?.note).toContain("not inspected");
    expect(byPath.get(path)?.note).not.toContain("MISSING");
  }
  expect(JSON.stringify(manifest)).not.toContain("SYNTHETIC_ARTIFACT_SECRET");
  expect(JSON.stringify(manifest)).not.toContain("SYNTHETIC_ARTIFACT_OUTSIDE");
}));

test("FS05 compensation preimages retain authorized content and do not claim denied reads are missing", async () => fixture(async (root, base) => {
  writeFileSync(join(root, "ordinary.txt"), "SAFE_PREIMAGE_CONTROL");
  writeFileSync(join(root, ".env"), "SYNTHETIC_PREIMAGE_SECRET");
  writeFileSync(join(base, "outside.txt"), "SYNTHETIC_PREIMAGE_OUTSIDE");
  symlinkSync(join(base, "outside.txt"), join(root, "linked.txt"));
  const capture = (path: string) => capturePreImage({ type: "file", op: "write", path, content: "proposed" }, root);
  expect((await capture("ordinary.txt"))?.content).toBe("SAFE_PREIMAGE_CONTROL");
  const absent = await capture("new/nested.txt");
  expect(absent?.note).toContain("did not exist");
  expect(absent?.content).toBeUndefined();
  expect(existsSync(join(root, "new"))).toBe(false);
  for (const path of [".env", "linked.txt", "../outside.txt"]) expect(await capture(path)).toBeNull();
  expect(readFileSync(join(base, "outside.txt"), "utf8")).toBe("SYNTHETIC_PREIMAGE_OUTSIDE");
}));

test("FS05 RAG index and fingerprint authorize before real local embedding requests", async () => {
  const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../helpers/a1-implicit-probe.ts")], {
    cwd: join(import.meta.dir, "../.."), env: { ...process.env, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  const result = JSON.parse(stdout.trim());
  expect(result.count).toBe(2);
  expect(result.fp).toMatchObject({ files: 2, frameworks: ["react"], hasTests: true });
  expect(result.chunks.map((c: { path: string }) => c.path).sort()).toEqual(["package.json", "safe.test.ts"]);
  expect(result.embeddingRequests).toHaveLength(2);
  expect(JSON.stringify(result)).toContain("SAFE_INDEX_CONTROL");
  for (const secret of ["A1_RAG_SECRET_CANARY", "A1_RAG_OUTSIDE_CANARY"]) expect(JSON.stringify(result)).not.toContain(secret);
});

test("FS14 shell forwards the captured denied-policy identity; this is NOT mount enforcement", async () => fixture(async root => {
  const fs = scoped(root);
  const captured: any[] = [];
  try {
    const result = await shellTool.run({ cmd: "printf A1_DESCRIPTOR_ONLY" }, {
      cwd: root, filesystem: fs, approve: async () => true, audit() {},
      runIsolated: async (request, executable) => {
        captured.push({ request, executable });
        return { ok: false, blocked: true, reason: "descriptor transport fixture; no backend executed", exitCode: null, stdout: "", stderr: "", timedOut: false };
      },
    });
    expect(result.ok).toBe(false);
    expect(captured).toHaveLength(1);
    expect(captured[0].request.filesystemAuthority).toEqual(fs.descriptor());
    expect(captured[0].request.filesystemAuthority.deniedPaths).toEqual([join(root, "blocked.txt")]);
    expect(captured[0].request.filesystemAuthority.grantId).not.toBeNull();
    expect(captured[0].executable.argv).toEqual(["bash", "-lc", "printf A1_DESCRIPTOR_ONLY"]);
  } finally { fs.close(); }
}));
