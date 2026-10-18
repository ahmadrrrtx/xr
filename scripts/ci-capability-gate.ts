/**
 * XR Phase 7 · T7 — CI capability certification + scanning gate.
 *
 * Runs in `bun run ci` (wired into package.json ci script). Scans every
 * bundled capability (plugins + skills) through:
 *   1. the manifest-security scanner (unsigned/over-permissive/injection
 *      findings FAIL the build for bundled first-party capabilities);
 *   2. the capability contract tests (certification smoke).
 * Fails with a non-zero exit code on any reject-level finding so a
 * permissive or hijackable manifest cannot land on main.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

async function main(): Promise<number> {
  const failures: string[] = [];
  const checked: string[] = [];

  const { readSkillManifest } = await import(join(ROOT, "src/skills/manifest.ts"));
  const { readManifest } = await import(join(ROOT, "src/plugins/manifest.ts"));
  const { scanManifestSecurity } = await import(join(ROOT, "src/platform/capabilities/manifest-security.ts"));
  const { descriptorFromPlugin, descriptorFromSkill } = await import(join(ROOT, "src/platform/capabilities/adapters.ts"));
  const { runCapabilityContractTests } = await import(join(ROOT, "src/platform/capabilities/certification.ts"));
  const { validateToolAllowlist } = await import(join(ROOT, "src/skills/tool-allowlist.ts"));
  const { allTools } = await import(join(ROOT, "src/tools/registry.ts"));
  const knownTools = allTools().map((t) => t.name);

  // ── Skills (Phase 2.5 · P2-15 — the full bundled population) ─────────────
  // Every skills/<name> DIRECTORY is a skill: `xr-skill.json` is the manifest
  // format, plain `SKILL.md` is the legacy markdown format, and both load
  // through readSkillManifest (its frontmatter fallback is the established
  // path). A directory with NEITHER is an honest gate failure, not a skipped
  // count. Categories are measured and labelled with src/skills/counts.ts
  // vocabulary: officialManifests / legacyMarkdown (never a bare "N skills").
  const skillsRoot = join(ROOT, "skills");
  const category = { manifest: 0, legacy: 0, plugins: 0 };
  if (existsSync(skillsRoot)) {
    for (const name of readdirSync(skillsRoot)) {
      const dir = join(skillsRoot, name);
      const hasManifest = existsSync(join(dir, "xr-skill.json"));
      let isDir = false;
      try { isDir = statSync(dir).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      if (!hasManifest && !existsSync(join(dir, "SKILL.md"))) {
        failures.push(`skill ${name}: directory has neither xr-skill.json nor SKILL.md (unclassifiable bundled skill)`);
        continue;
      }
      const loaded = readSkillManifest(dir);
      if (!loaded.ok || !loaded.manifest) {
        failures.push(`skill ${name} (${hasManifest ? "manifest" : "legacy Markdown"}): invalid — ${loaded.errors.join("; ")}`);
        continue;
      }
      if (hasManifest) category.manifest++; else category.legacy++;
      checked.push(`skill:${name}`);
      const allowlist = validateToolAllowlist(loaded.manifest, knownTools);
      if (!allowlist.ok) failures.push(`skill ${name}: ${allowlist.errors.join("; ")}`);
      const descriptor = descriptorFromSkill({ manifest: loaded.manifest, dir, kind: hasManifest ? "xr-manifest" : "legacy-markdown", source: "bundled", enabled: false, installed: true, health: "healthy", skillType: "executable", errors: [], warnings: [] });
      const security = scanManifestSecurity(descriptor);
      if (security.verdict === "reject") {
        failures.push(`skill ${name}: manifest security REJECT — ${security.rejects.join("; ")}`);
      }
      const cert = runCapabilityContractTests(descriptor, { xrTested: true });
      if (cert.status === "quarantined") failures.push(`skill ${name}: contract tests QUARANTINED`);
    }
  }

  // ── Plugins (bundled in repo) ─────────────────────────────────────────────
  const pluginsRoot = join(ROOT, "plugins");
  if (existsSync(pluginsRoot)) {
    for (const name of readdirSync(pluginsRoot)) {
      const dir = join(pluginsRoot, name);
      const manifestFile = join(dir, "xr-plugin.json");
      if (!existsSync(manifestFile)) continue;
      const loaded = readManifest(dir);
      if (!loaded.ok || !loaded.manifest) {
        failures.push(`plugin ${name}: invalid manifest — ${loaded.errors.join("; ")}`);
        continue;
      }
      category.plugins++;
      checked.push(`plugin:${name}`);
      const descriptor = descriptorFromPlugin(loaded.manifest);
      const security = scanManifestSecurity(descriptor);
      if (security.verdict === "reject") {
        failures.push(`plugin ${name}: manifest security REJECT — ${security.rejects.join("; ")}`);
      }
      const cert = runCapabilityContractTests(descriptor, { xrTested: true });
      if (cert.status === "quarantined") failures.push(`plugin ${name}: contract tests QUARANTINED`);
    }
  }

  console.log(
    `[capability-gate] scanned ${checked.length} bundled capabilities (${category.manifest} manifest skills, ${category.legacy} legacy Markdown skills, ${category.plugins} plugins): ${checked.join(", ") || "(none)"}`,
  );
  if (failures.length) {
    console.error(`[capability-gate] FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.log("[capability-gate] OK — no reject-level findings in bundled capabilities");
  return 0;
}

process.exitCode = await main();
