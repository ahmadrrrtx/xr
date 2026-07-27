/** XR 5.2 — Capability Ecosystem tests. */
import { beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "xr-capabilities-"));
process.env.XR_HOME = join(root, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

import { resolveEffectiveAuthority, riskTierForPermissions } from "../../src/capabilities/authority.ts";
import { CapabilityService } from "../../src/capabilities/service.ts";
import { validateCapabilityDescriptor } from "../../src/capabilities/types.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { SkillMarketplace } from "../../src/skills/marketplace.ts";
import type { SkillPackageFile } from "../../src/skills/marketplace.ts";
import { Store } from "../../src/state/workspace-store.ts";

let store: Store;
let workdir: string;

beforeEach(() => {
  const home = process.env.XR_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  store = new Store(join(root, `db-${Math.random().toString(36).slice(2)}.db`));
  workdir = mkdtempSync(join(root, "work-"));
});

function pluginSource(id: string, version: string, permissions: string[]) {
  const dir = mkdtempSync(join(root, "plugin-src-"));
  writeFileSync(join(dir, "xr-plugin.json"), JSON.stringify({
    id,
    name: id,
    version,
    type: "tool",
    entrypoint: "index.ts",
    permissions,
    compatibility: "*",
    apiVersion: 1,
  }, null, 2));
  writeFileSync(join(dir, "index.ts"), `export default function activate(host){ return { commands:[{ name:"ping", run(){ host.log("${version}"); } }] }; }`);
  return dir;
}

test("effective authority is declaration ∩ policy ∩ grants minus denied", () => {
  const vector = resolveEffectiveAuthority({
    declared: ["fs:read", "fs:write", "net", "secrets"],
    publisherPolicy: { allowed: ["fs:read", "fs:write", "net"] },
    workspacePolicy: { denied: ["net"] },
    userGrant: { allowed: ["fs:read", "net", "secrets"] },
    agentTaskGrant: { allowed: ["fs:read", "fs:write", "net"] },
    trustPlacementLimit: { allowed: ["fs:read", "net"] },
  });
  expect(vector.effective).toEqual(["fs:read"]);
  expect(vector.denied).toContain("net");
  expect(riskTierForPermissions(vector.effective)).toBe("tier0");
});

test("capability service exposes valid common descriptors and effective authority", () => {
  const service = new CapabilityService(store);
  const readFile = service.inspect("tool:read_file");
  expect(readFile).not.toBeNull();
  expect(readFile?.type).toBe("tool");
  expect(readFile?.permissions.effective.effective).toContain("fs:read");
  expect(readFile?.permissions.effective.effective).not.toContain("fs:write");
  expect(validateCapabilityDescriptor(readFile!).ok).toBe(true);

  const results = service.discover({ task: "read local file", maxRiskTier: "tier0", limit: 10 });
  expect(results.some((d) => d.id === "tool:read_file")).toBe(true);
  expect(results.every((d) => d.placement.riskTier === "tier0")).toBe(true);
});

test("plugin updates requesting new permissions are blocked for review", () => {
  const mgr = new PluginManager(store, workdir);
  const v1 = pluginSource("cap-review", "1.0.0", ["fs:read"]);
  const v2 = pluginSource("cap-review", "1.1.0", ["fs:read", "net"]);
  expect(mgr.commitInstall(v1, ["fs:read"], { enable: true }).ok).toBe(true);
  const update = mgr.update("cap-review", v2);
  expect(update.ok).toBe(false);
  expect(update.newPermissions).toEqual(["net"]);
  expect(mgr.getEntry("cap-review")?.lifecycleState).toBe("update_pending_review");
});

test("plugin rollback restores package but never restores authority silently", () => {
  const mgr = new PluginManager(store, workdir);
  const v1 = pluginSource("cap-rollback", "1.0.0", ["fs:read"]);
  const v2 = pluginSource("cap-rollback", "1.1.0", ["fs:read"]);
  expect(mgr.commitInstall(v1, ["fs:read"], { enable: true }).ok).toBe(true);
  expect(mgr.update("cap-rollback", v2).ok).toBe(true);
  expect(mgr.getEntry("cap-rollback")?.rollback?.length).toBe(1);
  const rolled = mgr.rollback("cap-rollback", "1.0.0");
  expect(rolled.ok).toBe(true);
  const entry = mgr.getEntry("cap-rollback")!;
  expect(entry.version).toBe("1.0.0");
  expect(entry.enabled).toBe(false);
  expect(entry.grantedPermissions).toEqual([]);
});

test("skill package extraction blocks path traversal transactionally", () => {
  const marketplace = new SkillMarketplace();
  const pkg: SkillPackageFile = {
    schemaVersion: 1,
    type: "xr.skill.package",
    manifest: {
      schemaVersion: 1,
      id: "evil-skill",
      name: "Evil Skill",
      version: "1.0.0",
      description: "A deliberately malformed package used to prove path traversal is blocked.",
      publisher: "test",
      license: "MIT",
      categories: ["security"],
      tags: [],
      keywords: [],
      compatibility: { xr: ">=1.0.0", os: ["any"], providers: [], modes: ["agent", "plan", "ask"] },
      activation: { phrases: [], intents: [], fileGlobs: [], slashCommands: [], auto: true },
      content: { instructions: "SKILL.md", knowledge: [], promptTemplates: [], examples: [], tests: [], docs: [], assets: [] },
      contributions: { commands: [], voiceIntents: [], chatActions: [], slashCommands: [], computerActions: [], researchModes: [], planners: [], agentBehaviors: [], workflows: [], uiPanels: [], dashboardWidgets: [] },
      tools: [],
      mcp: [],
      plugins: [],
      memoryTemplates: [],
      dependencies: [],
      permissions: [],
      settings: [],
      verification: { level: "unverified" },
    },
    treeSha256: "0".repeat(64),
    files: [{ path: "../escape.txt", contentBase64: Buffer.from("owned").toString("base64") }],
    packagedAt: Date.now(),
  };
  const file = join(root, "evil.xrs");
  writeFileSync(file, JSON.stringify(pkg));
  expect(() => marketplace.importPackage(file)).toThrow(/unsafe package path/);
  expect(existsSync(join(process.env.XR_HOME!, "skills", "installed", "evil-skill"))).toBe(false);
  expect(existsSync(join(process.env.XR_HOME!, "skills", "installed", "escape.txt"))).toBe(false);
  expect(readFileSync(file, "utf8")).toContain("evil-skill");
});
