import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashFileContent,
  resolveToken,
  resolveArgvIdentity,
  resolveShellCommandIdentity,
  decideExecIntegrity,
  loadExecAllowlist,
  type ExecutableIdentity,
} from "../../src/security/exec-integrity.ts";

const dir = mkdtempSync(join(tmpdir(), "xr-exec-"));
const real = join(dir, "real-binary");
writeFileSync(real, "#!/bin/sh\necho real\n");
const other = join(dir, "other-binary");
writeFileSync(other, "#!/bin/sh\necho other\n");
const link = join(dir, "link-to-real");
try {
  symlinkSync(real, link);
} catch {
  /* symlinks may be unsupported on some FS; tests tolerate */
}

const realHash = hashFileContent(real)!;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Phase 07 · content-hash execution identity", () => {
  it("hashes file content (sha256 hex)", () => {
    expect(realHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashFileContent(other)).not.toBe(realHash);
    expect(hashFileContent(join(dir, "does-not-exist"))).toBeNull();
  });

  it("resolves a token to a canonical path + hash", () => {
    const id = resolveToken(real, dir);
    expect(id.canonical).toBe(real);
    expect(id.hash).toBe(realHash);
  });

  it("symlink canonicalization yields the TARGET's hash (content is identity)", () => {
    const id = resolveToken(link, dir);
    expect(id.canonical).toBe(real); // not the symlink
    expect(id.hash).toBe(realHash); // shares the approved hash
  });

  it("covers the ld-linux dynamic-linker bypass (hashes argv[1], not the linker)", () => {
    const id = resolveArgvIdentity(["/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2", real], dir);
    expect(id.interpreter?.token).toContain("ld-linux");
    expect(id.direct[0]?.hash).toBe(realHash); // the executed binary, not the linker
  });

  it("covers /usr/bin/env <prog> (hashes the real program)", () => {
    const id = resolveArgvIdentity(["/usr/bin/env", real], dir);
    expect(id.direct[0]?.hash).toBe(realHash);
  });

  it("best-effort parses a direct executable from a shell command", () => {
    const id = resolveShellCommandIdentity(`${real} --flag`, dir);
    expect(id.interpreter?.token).toBe("bash");
    expect(id.direct[0]?.hash).toBe(realHash);
  });

  it("records an error (unknown) for a non-existent token", () => {
    const id = resolveToken("/no/such/binary-xyz", dir);
    expect(id.error).toBeTruthy();
    expect(id.hash).toBeUndefined();
  });
});

describe("Phase 07 · execution-integrity decision", () => {
  const knownId: ExecutableIdentity = { token: "x", resolved: real, canonical: real, hash: realHash };
  const unknownId: ExecutableIdentity = { token: "y", resolved: other, canonical: other, hash: "deadbeef".repeat(8) };

  it("audit mode records but allows unknown binaries (no regression)", () => {
    const d = decideExecIntegrity({ interpreter: unknownId, direct: [] }, { mode: "audit" });
    expect(d.decision).toBe("audit");
    expect(d.unknown.length).toBe(1);
  });

  it("off mode always allows", () => {
    const d = decideExecIntegrity({ interpreter: unknownId, direct: [] }, { mode: "off" });
    expect(d.decision).toBe("allow");
  });

  it("approval mode escalates unknown binaries to requireApproval", () => {
    const d = decideExecIntegrity({ interpreter: unknownId, direct: [] }, { mode: "approval" });
    expect(d.decision).toBe("requireApproval");
  });

  it("enforce mode denies unknown binaries (fail closed)", () => {
    const d = decideExecIntegrity({ interpreter: unknownId, direct: [] }, { mode: "enforce" });
    expect(d.decision).toBe("deny");
  });

  it("enforce mode allows a hash on the allowlist", () => {
    const d = decideExecIntegrity({ interpreter: knownId, direct: [] }, { mode: "enforce", allowlist: new Set([realHash]) });
    expect(d.decision).toBe("allow");
    expect(d.known.length).toBe(1);
    expect(d.unknown.length).toBe(0);
  });

  it("enforce mode denies an unresolvable (error) executable", () => {
    const errId: ExecutableIdentity = { token: "z", error: "not found" };
    const d = decideExecIntegrity({ interpreter: errId, direct: [] }, { mode: "enforce" });
    expect(d.decision).toBe("deny");
    expect(d.unknown.length).toBe(1);
  });

  it("corrupt/missing allowlist fails closed to empty set", () => {
    const set = loadExecAllowlist("/nonexistent/path/exec-hashes.json");
    expect(set.size).toBe(0);
    const d = decideExecIntegrity({ interpreter: knownId, direct: [] }, { mode: "enforce", allowlist: set });
    expect(d.decision).toBe("deny");
  });
});
