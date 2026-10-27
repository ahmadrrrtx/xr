/**
 * Launch-audit L-002/L-003/L-004 regression: every Rust triple the desktop
 * bundling matrix ships must have a REAL bun compile target (cross-compile
 * that produces a genuine target-arch binary), and the bundling workflow must
 * ship legs for every launch-committed OS/arch — Windows ARM and Intel mac
 * included. Written when compile-sidecar.ts gained its --target mapping;
 * would have caught both missing-leg findings and the rename-only hazard the
 * workflow comment already warned about.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRIPLE_TO_BUN_TARGET, resolveCompile, tripleExt } from "../../scripts/compile-sidecar.ts";

const ROOT = join(import.meta.dir, "..", "..");

const LAUNCH_TRIPLES = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
];

describe("sidecar compile matrix (L-002/L-003)", () => {
  test("every launch triple has a real bun compile target (no rename-only cross)", () => {
    for (const triple of LAUNCH_TRIPLES) {
      const bunTarget = TRIPLE_TO_BUN_TARGET[triple];
      expect(bunTarget, `missing bun target for ${triple}`).toBeTruthy();
      expect(bunTarget).toMatch(/^bun-(linux|darwin|windows)-(x64|arm64)$/);
    }
    expect(TRIPLE_TO_BUN_TARGET["aarch64-pc-windows-msvc"]).toBe("bun-windows-arm64");
  });

  test("resolveCompile flags cross builds and windows .exe follows the TARGET", () => {
    const cross = resolveCompile("darwin-arm64", "x86_64-apple-darwin");
    expect(cross.cross).toBe(true);
    expect(cross.bunTarget).toBe("bun-darwin-x64");
    expect(cross.ext).toBe("");
    const win = resolveCompile("linux-x64", "aarch64-pc-windows-msvc");
    expect(win.ext).toBe(".exe");
    expect(win.cross).toBe(true);
    expect(tripleExt("x86_64-unknown-linux-gnu")).toBe("");
  });

  test("unknown host fails loudly instead of producing a mislabeled binary", () => {
    expect(() => resolveCompile("freebsd-x64")).toThrow(/unsupported host/);
  });

  test("desktop-app.yml ships a bundle leg for every launch triple", () => {
    const wf = readFileSync(join(ROOT, ".github/workflows/desktop-app.yml"), "utf8");
    for (const triple of LAUNCH_TRIPLES) {
      expect(wf, `desktop-app.yml has no bundle leg for ${triple}`).toContain(triple);
    }
    // Windows ARM must build on a native ARM runner (sidecar must RUN on-target).
    expect(wf).toMatch(/windows-11-(arm|vs2026-arm)/);
  });

  test("smoke-sidecar.sh skips cross-target honestly instead of faking a run", () => {
    const sh = readFileSync(join(ROOT, "scripts/smoke-sidecar.sh"), "utf8");
    expect(sh).toContain("SKIPPED (cross-target)");
  });
});

test('sidecar dev cache refuses stale source, target, tool, missing metadata or changed binary bytes',async()=>{
  const {sidecarFingerprint,sidecarCacheMatches}=await import('../../scripts/compile-sidecar');
  const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createHash}=await import('node:crypto');
  const root=mkdtempSync(join(tmpdir(),'xr-sidecar-cache-'));
  try{
    mkdirSync(join(root,'src'));mkdirSync(join(root,'scripts'));
    for(const path of ['package.json','bun.lock','.bun-version','scripts/compile-sidecar.ts','src/index.ts'])writeFileSync(join(root,path),'fixture input');
    const binary=join(root,'engine');writeFileSync(binary,'fixture binary (not executable)');
    const inputs=sidecarFingerprint(root,'bun-linux-x64');expect(sidecarCacheMatches(binary,inputs)).toBe(false);
    writeFileSync(binary+'.build.json',JSON.stringify({schemaVersion:1,inputsSha256:inputs,binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex')}));
    expect(sidecarCacheMatches(binary,inputs)).toBe(true);
    expect(sidecarCacheMatches(binary,sidecarFingerprint(root,'bun-linux-arm64'))).toBe(false);
    expect(sidecarCacheMatches(binary,sidecarFingerprint(root,'bun-linux-x64','other-bun'))).toBe(false);
    writeFileSync(join(root,'src/index.ts'),'changed policy');expect(sidecarCacheMatches(binary,sidecarFingerprint(root,'bun-linux-x64'))).toBe(false);
    writeFileSync(binary,'changed binary');expect(sidecarCacheMatches(binary,inputs)).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});


test("real Windows process.platform win32 resolves native x64/arm64 without environment overrides",()=>{
  expect(resolveCompile("win32-x64")).toEqual({triple:"x86_64-pc-windows-msvc",bunTarget:"bun-windows-x64",ext:".exe",cross:false});
  expect(resolveCompile("win32-arm64")).toEqual({triple:"aarch64-pc-windows-msvc",bunTarget:"bun-windows-arm64",ext:".exe",cross:false});
  expect(resolveCompile("win32-x64","aarch64-pc-windows-msvc").cross).toBe(true);
});
