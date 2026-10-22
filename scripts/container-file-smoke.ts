#!/usr/bin/env bun
/**
 * XR-LAUNCH-020 — file-tool smoke for the shipped container image.
 *
 *   docker run --rm --entrypoint bun <image> run scripts/container-file-smoke.ts
 *
 * Runs the REAL model-facing `write_file` → `read_file` tools (src/tools/files.ts)
 * through the native filesystem authority (src/security/fs-native.ts, which
 * dlopens glibc's libc.so.6 on Linux) in a scratch workspace, then checks that a
 * `../` escape is refused. On a musl base the authority reports `unsupported`
 * and this exits 1, so the image's libc can never silently disable file tools.
 * Prints one JSON line; exit 0 only when every check passes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_BACKEND } from "../src/security/fs-native.ts";
import { readFileTool, writeFileTool } from "../src/tools/files.ts";
import type { ToolContext } from "../src/core/types.ts";

export interface ContainerFileSmoke {
  backend: string;
  write: { ok: boolean; output: string };
  read: { ok: boolean; matches: boolean; output: string };
  escape: { refused: boolean; output: string };
  pass: boolean;
}

export async function runContainerFileSmoke(): Promise<ContainerFileSmoke> {
  const cwd = mkdtempSync(join(tmpdir(), "xr-container-smoke-"));
  const ctx: ToolContext = {
    cwd,
    approve: async () => true, // the smoke is the approver; nothing leaves the scratch dir
    audit: () => {},
  };
  const content = `xr container smoke ${Date.now()}\n`;
  try {
    const write = await writeFileTool.run({ path: "smoke/proof.txt", content }, ctx);
    const read = await readFileTool.run({ path: "smoke/proof.txt" }, ctx);
    const escape = await readFileTool.run({ path: "../outside.txt" }, ctx);
    const result: ContainerFileSmoke = {
      backend: NATIVE_BACKEND,
      write: { ok: write.ok, output: write.output.slice(0, 300) },
      read: { ok: read.ok, matches: read.ok && read.output === content, output: read.output.slice(0, 300) },
      escape: { refused: !escape.ok, output: escape.output.slice(0, 300) },
      pass: false,
    };
    result.pass = result.write.ok && result.read.matches && result.escape.refused;
    return result;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const r = await runContainerFileSmoke();
  console.log(JSON.stringify(r));
  process.exit(r.pass ? 0 : 1);
}
