#!/usr/bin/env bun
/** Generate XR Phase 0 repository inventory from source files. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CATALOG } from "../src/cli/catalog.ts";
import { versionInfo } from "../src/core/version.ts";
import { PRESETS } from "../src/providers/presets.ts";
import { LOCAL_RUNTIMES } from "../src/local/registry.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "docs", "release", "3.1.6");

function walk(dir: string, predicate: (path: string) => boolean = () => true): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build", "coverage", ".cache"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(relative(ROOT, full).replaceAll("\\", "/"));
  }
  return out.sort();
}

function dirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function daemonRoutes(): Array<{ file: string; id?: string; method?: string; path?: string; prefix?: string; auth: string }> {
  const files = walk(join(ROOT, "src", "daemon", "routes"), (p) => p.endsWith(".ts"));
  const routes: Array<{ file: string; id?: string; method?: string; path?: string; prefix?: string; auth: string }> = [];
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const routeBlocks = src.match(/route\(\{[\s\S]*?\}\)/g) ?? [];
    for (const block of routeBlocks) {
      const get = (key: string) => block.match(new RegExp(`${key}:\\s*[\"']([^\"']+)[\"']`))?.[1];
      const path = get("path");
      routes.push({
        file,
        id: get("id"),
        method: get("method"),
        path,
        prefix: get("prefix"),
        auth: path === "/api/health" ? "open" : "local bearer token or dashboard query token",
      });
    }
  }
  return routes.sort((a, b) => `${a.path ?? a.prefix}`.localeCompare(`${b.path ?? b.prefix}`));
}

function skillInventory(): Array<{ id: string; path: string; manifest: string; status: string }> {
  return dirs(join(ROOT, "skills")).map((id) => {
    const manifest = ["xr-skill.json", "SKILL.md"].find((name) => existsSync(join(ROOT, "skills", id, name))) ?? "missing";
    return { id, path: `skills/${id}`, manifest, status: manifest === "missing" ? "broken/unverified" : "supported content" };
  });
}

function pluginInventory(): Array<{ id: string; path: string; manifest: string; status: string }> {
  return dirs(join(ROOT, "plugins")).map((id) => {
    const manifestPath = join(ROOT, "plugins", id, "xr-plugin.json");
    let status = "broken/unverified";
    if (existsSync(manifestPath)) {
      try {
        readJson(manifestPath);
        status = "experimental plugin package";
      } catch {
        status = "broken/unverified";
      }
    }
    return { id, path: `plugins/${id}`, manifest: existsSync(manifestPath) ? "xr-plugin.json" : "missing", status };
  });
}

function fileSize(path: string): number {
  try { return statSync(join(ROOT, path)).size; } catch { return 0; }
}

const rootPackage = readJson(join(ROOT, "package.json"));
const sourceFiles = walk(join(ROOT, "src"), (p) => p.endsWith(".ts") || p.endsWith(".json") || p.endsWith(".css"));
const tests = walk(join(ROOT, "test"), (p) => p.endsWith(".test.ts"));
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version: versionInfo(),
  package: {
    name: rootPackage.name,
    version: rootPackage.version,
    packageManager: rootPackage.packageManager,
    engines: rootPackage.engines,
    bin: rootPackage.bin,
    dependencies: rootPackage.dependencies,
    optionalDependencies: rootPackage.optionalDependencies,
    devDependencies: rootPackage.devDependencies,
    files: rootPackage.files,
  },
  counts: {
    sourceFiles: sourceFiles.length,
    testFiles: tests.length,
    cliCommands: CATALOG.length,
    daemonRoutes: daemonRoutes().length,
    providers: Object.keys(PRESETS).length,
    localRuntimes: LOCAL_RUNTIMES.length,
    plugins: pluginInventory().length,
    skills: skillInventory().length,
  },
  rootFiles: walk(ROOT, (p) => p.split("/").length === ROOT.split("/").length + 1).map((p) => ({ path: p, bytes: fileSize(p) })),
  sourceFiles,
  tests,
  cliCommands: CATALOG.map((c) => ({
    name: c.name,
    aliases: c.aliases ?? [],
    group: c.group,
    usage: c.usage,
    needsKernel: c.needsKernel,
    fastPath: Boolean(c.fastPath),
    classification: c.fastPath ? "stable" : "supported",
  })),
  daemonRoutes: daemonRoutes(),
  providers: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, kind: p.kind, tier: p.tier, defaultModel: p.defaultModel, apiKeyEnv: p.apiKeyEnv ?? null, status: p.kind === "local" ? "supported with local runtime" : "supported with user-provided credentials" })),
  localRuntimes: LOCAL_RUNTIMES.map((r) => ({ id: r.id, providerId: r.providerId, label: r.label, installSupport: r.installSupport, modelManagement: r.modelManagement, status: "detected/optional unless configured" })),
  plugins: pluginInventory(),
  skills: skillInventory(),
  deployment: {
    dockerfile: existsSync(join(ROOT, "Dockerfile")),
    compose: existsSync(join(ROOT, "docker-compose.yml")),
    installSh: existsSync(join(ROOT, "install.sh")),
    installPs1: existsSync(join(ROOT, "install.ps1")),
    ciWorkflow: existsSync(join(ROOT, ".github/workflows/ci.yml")),
    websiteDirectory: existsSync(join(ROOT, "website")),
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "inventory.json"), JSON.stringify(inventory, null, 2));
writeFileSync(join(OUT_DIR, "INVENTORY.md"), `# XR 3.1.6 Repository Inventory\n\nGenerated: ${inventory.generatedAt}\n\n## Summary\n\n| Area | Count |\n|---|---:|\n| Source files | ${inventory.counts.sourceFiles} |\n| Test files | ${inventory.counts.testFiles} |\n| CLI commands | ${inventory.counts.cliCommands} |\n| Daemon routes | ${inventory.counts.daemonRoutes} |\n| Providers | ${inventory.counts.providers} |\n| Local runtimes | ${inventory.counts.localRuntimes} |\n| Plugins | ${inventory.counts.plugins} |\n| Skills | ${inventory.counts.skills} |\n\n## Entrypoints\n\n- Package bin: \`${rootPackage.bin?.xr}\`\n- Runtime CLI: \`src/index.ts\`\n- Daemon: \`src/daemon/server.ts\`\n- Docker entrypoint: \`bun run src/index.ts serve --port 7842\`\n\n## CLI commands\n\n${inventory.cliCommands.map((c) => `- \`${c.name}\` (${c.group}, ${c.classification}) — ${c.usage}`).join("\n")}\n\n## Daemon routes\n\n${inventory.daemonRoutes.map((r) => `- ${r.method ?? "ANY"} \`${r.path ?? `${r.prefix}*`}\` — ${r.auth} (${r.file})`).join("\n")}\n\n## Providers and runtimes\n\n${inventory.providers.map((p) => `- \`${p.id}\` — ${p.kind}, ${p.status}`).join("\n")}\n\n## Plugins\n\n${inventory.plugins.map((p) => `- \`${p.id}\` — ${p.status}`).join("\n")}\n\n## Skills\n\n${inventory.skills.map((s) => `- \`${s.id}\` — ${s.status}`).join("\n")}\n\nMachine-readable inventory: \`inventory.json\`.\n`);
console.log(`wrote ${relative(ROOT, OUT_DIR)}/inventory.json and INVENTORY.md`);
