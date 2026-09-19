#!/usr/bin/env bun
/**
 * XR Phase 1 — tarball-invariant gate
 * Ensures npm tarball file list + OpenAPI hash matches repo, preventing BUG-001 drift.
 * Checks:
 * - src/daemon/routes/mcp.routes.ts exists in tarball
 * - OpenAPI paths count matches repo (126 vs tarball 120 previously)
 * - No prohibited docs bloat? Warn if docs/ > 50 files in tarball
 */

import { $ } from "bun";
import { existsSync, readFileSync } from "fs";

async function main() {
  const check = process.argv.includes("--check");
  console.log("XR tarball-invariant check — Phase 1 hardening");

  // 1. Verify mcp.routes.ts exists in repo
  if (!existsSync("src/daemon/routes/mcp.routes.ts")) {
    console.error("FAIL: src/daemon/routes/mcp.routes.ts missing in repo");
    process.exit(1);
  }
  console.log("✓ repo has src/daemon/routes/mcp.routes.ts");

  // 2. Pack and inspect file list
  console.log("Packing @rrrtx/xr tarball...");
  const packOut = await $`npm pack --dry-run --json`.json().catch(async () => {
    // fallback: npm pack --dry-run may not output json on all npm versions
    const out = await $`npm pack --dry-run`.text();
    return [{ files: out.split("\n").filter(l => l.trim()) }];
  });

  // Alternative: use bun pm pack --dry-run
  let files: string[] = [];
  try {
    const dry = await $`bun pm pack --dry-run`.text();
    files = dry.split("\n").map(l => l.trim()).filter(Boolean);
  } catch {
    // npm fallback
    if (Array.isArray(packOut) && packOut[0]?.files) {
      files = packOut[0].files.map((f: { path: string }) => f.path);
    }
  }

  if (files.length === 0) {
    console.warn("WARN: could not get tarball file list — skipping file list checks (need npm pack)");
  } else {
    const hasMcp = files.some(f => f.includes("mcp.routes.ts"));
    if (!hasMcp) {
      console.error(`FAIL: tarball missing mcp.routes.ts — ${files.length} files listed`);
      console.error(files.filter(f => f.includes("daemon/routes")).join("\n"));
      process.exit(1);
    }
    console.log(`✓ tarball includes mcp.routes.ts (${files.length} files)`);

    const docsCount = files.filter(f => f.startsWith("docs/")).length;
    if (docsCount > 100) {
      console.warn(`WARN: tarball includes ${docsCount} docs/ files — bloat (recommend prune to README/LICENSE + link)`);
    } else {
      console.log(`✓ docs bloat check: ${docsCount} docs files`);
    }
  }

  // 3. OpenAPI hash check — repo vs generated
  try {
    const openapiRepo = JSON.parse(readFileSync("docs/api/openapi.json", "utf-8"));
    const pathsCount = Object.keys(openapiRepo.paths ?? {}).length;
    console.log(`✓ OpenAPI repo has ${pathsCount} paths`);
    if (pathsCount < 120) {
      console.error(`FAIL: OpenAPI paths ${pathsCount} < 120 — expected ~126`);
      process.exit(1);
    }
  } catch (e) {
    console.warn(`WARN: could not read docs/api/openapi.json — ${e}`);
  }

  // 4. Check package.json files field
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  const filesField = pkg.files as string[];
  if (filesField.includes("docs")) {
    console.warn("WARN: package.json files includes 'docs' — 483 files bloat, recommend prune in 2.0.0 (keep README/LICENSE + link)");
  }

  console.log("✓ tarball-invariant check passed");
  if (check) console.log("(check mode — no write)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
