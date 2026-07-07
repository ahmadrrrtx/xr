/** XR 2.1C — Marketplace Backend tests. */
import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillSDK } from "../src/skills/sdk.ts";
import { SkillMarketplace } from "../src/skills/marketplace.ts";
import { SkillMarketplaceBackend } from "../src/skills/marketplace-backend.ts";
import { sha256File } from "../src/skills/signing.ts";

function makePackagedSkill(root: string, name: string, version: string) {
  const dir = join(root, name.toLowerCase().replace(/\s+/g, "-"));
  const sdk = new SkillSDK(new SkillMarketplace());
  const scaffold = sdk.init({ dir, name, category: "business", publisher: "test-publisher", force: true });
  const manifestPath = join(dir, "xr-skill.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const build = sdk.build(dir, join(root, "build"));
  if (!build.ok || !build.packagePath) throw new Error(`build failed: ${build.errors.join("; ")}`);
  const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return { dir, manifest: updatedManifest, packagePath: build.packagePath, packageSha256: sha256File(build.packagePath) };
}

function writeRegistry(root: string, skill: ReturnType<typeof makePackagedSkill>, extraVersions: Array<ReturnType<typeof makePackagedSkill>> = []) {
  const versions = [skill, ...extraVersions].map((row) => ({
    id: row.manifest.id,
    version: row.manifest.version,
    manifest: row.manifest,
    publisherId: "test-publisher",
    packageUrl: row.packagePath,
    packageSha256: row.packageSha256,
    treeSha256: row.manifest.verification?.checksum,
    publishedAt: Date.now() + Number(row.manifest.version.replace(/\D/g, "")),
    changelog: `Release ${row.manifest.version}`,
  }));
  const registry = {
    schemaVersion: 1,
    type: "xr.skill.registry.v1",
    id: "local-test",
    name: "Local Test Registry",
    generatedAt: Date.now(),
    publishers: [{ id: "test-publisher", name: "Test Publisher", verified: true, trustLevel: "verified" }],
    skills: [{
      id: skill.manifest.id,
      name: skill.manifest.name,
      description: skill.manifest.description,
      publisherId: "test-publisher",
      categories: skill.manifest.categories,
      tags: skill.manifest.tags,
      versions,
      verified: true,
      updatedAt: Date.now(),
    }],
  };
  const path = join(root, "registry.json");
  writeFileSync(path, JSON.stringify(registry, null, 2));
  return path;
}

test("marketplace backend syncs local registry, resolves version, and installs online package", async () => {
  const root = mkdtempSync(join(tmpdir(), "xr-market-c-"));
  process.env.XR_HOME = join(root, "home");
  const skill = makePackagedSkill(root, "Contract Reviewer", "1.0.0");
  const registryPath = writeRegistry(root, skill);
  const backend = new SkillMarketplaceBackend(new SkillMarketplace());
  backend.addRegistry("local", registryPath);
  const sync = await backend.syncRegistries();
  expect(sync[0].ok).toBe(true);
  const resolved = backend.resolve(skill.manifest.id, "^1.0.0", "local");
  expect(resolved.ok).toBe(true);
  expect(resolved.version?.version).toBe("1.0.0");
  const installed = await backend.installOnline(skill.manifest.id, { registryId: "local" });
  expect(installed.ok).toBe(true);
  expect(installed.installed.some((row) => row.id === skill.manifest.id)).toBe(true);
});

test("marketplace backend detects updates and can verify package hash", async () => {
  const root = mkdtempSync(join(tmpdir(), "xr-market-c-update-"));
  process.env.XR_HOME = join(root, "home");
  const v1 = makePackagedSkill(root, "Proposal Writer Pro", "1.0.0");
  const v2 = makePackagedSkill(root, "Proposal Writer Pro", "1.1.0");
  const registryPath = writeRegistry(root, v1, [v2]);
  const marketplace = new SkillMarketplace();
  const backend = new SkillMarketplaceBackend(marketplace);
  backend.addRegistry("local", registryPath);
  const install = await backend.installOnline(v1.manifest.id, { registryId: "local", versionRange: "1.0.0" });
  expect(install.ok).toBe(true);
  const updates = await backend.checkUpdates();
  expect(updates.some((row) => row.id === v1.manifest.id && row.latestVersion === "1.1.0")).toBe(true);
  const verify = backend.verifyPackage(v2.packagePath);
  expect(verify.ok).toBe(true);
  expect(verify.sha256).toBe(v2.packageSha256);
});
