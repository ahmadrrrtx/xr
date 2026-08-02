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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  // ── Skills ────────────────────────────────────────────────────────────────
  const skillsRoot = join(ROOT, "skills");
  if (existsSync(skillsRoot)) {
    for (const name of readdirSync(skillsRoot)) {
      const dir = join(skillsRoot, name);
      if (!existsSync(join(dir, "xr-skill.json"))) continue;
      const loaded = readSkillManifest(dir);
      if (!loaded.ok || !loaded.manifest) {
        failures.push(`skill ${name}: invalid manifest — ${loaded.errors.join("; ")}`);
        continue;
      }
      checked.push(`skill:${name}`);
      const allowlist = validateToolAllowlist(loaded.manifest, knownTools);
      if (!allowlist.ok) failures.push(`skill ${name}: ${allowlist.errors.join("; ")}`);
      const descriptor = descriptorFromSkill({ manifest: loaded.manifest, dir, kind: "xr-manifest", source: "bundled", enabled: false, installed: true, health: "healthy", skillType: "executable", errors: [], warnings: [] });
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

  console.log(`[capability-gate] scanned ${checked.length} bundled capabilities: ${checked.join(", ") || "(none)"}`);
  if (failures.length) {
    console.error(`[capability-gate] FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    return 1;
  }
  console.log("[capability-gate] OK — no reject-level findings in bundled capabilities");
  return 0;
}

process.exitCode = await main();
