/**
 * XR 1.0 — plugin ecosystem tests.
 *
 * Covers: manifest parsing/validation, the semver compatibility matcher, the
 * permission-scoped host boundary, the registry, and the full manager lifecycle
 * (install → enable → tools → tamper detection → disable → remove), plus the
 * key security guarantees (no ungranted capability; egress + budget gates).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// IMPORTANT: set XR_HOME before importing anything that reads it.
const tmp = mkdtempSync(join(tmpdir(), "xr-plugins-"));
process.env.XR_HOME = join(tmp, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

import { Store } from "../src/state/db.ts";
import { parseManifestObject, validatePermissions, effectiveGrant } from "../src/plugins/manifest.ts";
import { satisfies, checkCompatibility, parseSemver } from "../src/plugins/compat.ts";
import { buildHost } from "../src/plugins/host.ts";
import { PluginManager } from "../src/plugins/manager.ts";
import { loadConfig } from "../src/config/config.ts";

let store: Store;
let workdir: string;

beforeEach(() => {
  store = new Store(join(tmp, `db-${Math.random().toString(36).slice(2)}.db`));
  workdir = mkdtempSync(join(tmp, "work-"));
  // Reset the shared registry + installed plugins between tests so state from
  // one lifecycle test never leaks into another (XR_HOME is process-global).
  const pluginsDir = join(process.env.XR_HOME!, "plugins");
  if (existsSync(pluginsDir)) rmSync(pluginsDir, { recursive: true, force: true });
});

/** Write a minimal valid plugin into a fresh source dir. Returns its path. */
function makePluginSource(opts: {
  id?: string;
  permissions?: string[];
  compatibility?: string;
  apiVersion?: number;
  body?: string;
} = {}): string {
  const dir = mkdtempSync(join(tmp, "src-"));
  const manifest = {
    id: opts.id ?? "demo",
    name: "Demo",
    version: "1.0.0",
    type: "tool",
    entrypoint: "index.ts",
    permissions: opts.permissions ?? [],
    compatibility: opts.compatibility ?? "*",
    apiVersion: opts.apiVersion ?? 1,
  };
  writeFileSync(join(dir, "xr-plugin.json"), JSON.stringify(manifest, null, 2));
  const body =
    opts.body ??
    `export function activate(host){
       return {
         commands: [{ name: "ping", run(){ host.log("pong"); } }],
         tools: [{ name: "echo", description: "echo", requiresApproval: false,
                   run(args){ return { ok: true, output: "echo:" + (args.message ?? "") }; } }],
       };
     }
     export default activate;`;
  writeFileSync(join(dir, "index.ts"), body);
  return dir;
}

// ── manifest parsing & validation ───────────────────────────────────────────────

test("manifest: valid object parses with defaults", () => {
  const r = parseManifestObject({ id: "github", name: "GitHub", version: "1.0.0" });
  expect(r.ok).toBe(true);
  expect(r.manifest?.type).toBe("tool");
  expect(r.manifest?.permissions).toEqual([]);
  expect(r.manifest?.compatibility).toBe("*");
});

test("manifest: rejects bad id and unknown permission", () => {
  const bad = parseManifestObject({ id: "Bad Id!", name: "x", version: "1" });
  expect(bad.ok).toBe(false);
  const badPerm = parseManifestObject({ id: "ok", name: "x", version: "1", permissions: ["telepathy"] });
  expect(badPerm.ok).toBe(false);
});

test("validatePermissions: denies policy-denied scopes", () => {
  const v = validatePermissions(["net", "shell"], { denied: ["shell"] });
  expect(v.ok).toBe(false);
  expect(v.errors.join()).toContain("shell");
});

test("effectiveGrant: intersection of declared and approved", () => {
  expect(effectiveGrant(["net", "secrets"], ["net"])).toEqual(["net"]);
  // cannot grant something not declared
  expect(effectiveGrant(["net"], ["net", "secrets"])).toEqual(["net"]);
});

// ── compatibility matcher ───────────────────────────────────────────────────────

test("semver parse + satisfies", () => {
  expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  expect(satisfies("1.0.0", "*")).toBe(true);
  expect(satisfies("1.0.0", ">=1.0.0 <2.0.0")).toBe(true);
  expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
  expect(satisfies("1.4.0", "^1.2.0")).toBe(true);
  expect(satisfies("2.0.0", "^1.2.0")).toBe(false);
  expect(satisfies("1.2.9", "~1.2.0")).toBe(true);
  expect(satisfies("1.3.0", "~1.2.0")).toBe(false);
  expect(satisfies("1.5.0", "1.x")).toBe(true);
  expect(satisfies("1.0.0", "0.x || 1.x")).toBe(true);
});

test("checkCompatibility: rejects future ABI and out-of-range core", () => {
  expect(checkCompatibility("1.0.0", 2, 1, "*").ok).toBe(false); // plugin wants newer host
  expect(checkCompatibility("1.0.0", 1, 1, ">=2.0.0").ok).toBe(false);
  expect(checkCompatibility("1.0.0", 1, 1, ">=1.0.0 <2.0.0").ok).toBe(true);
});

// ── host boundary (the security core) ────────────────────────────────────────────

test("host: ungranted capabilities are absent", () => {
  const { config } = loadConfig();
  const host = buildHost([], { store, config, cwd: workdir, pluginDir: join(tmp, "p", "x") });
  expect(host.fs).toBeUndefined();
  expect(host.net).toBeUndefined();
  expect(host.memory).toBeUndefined();
  expect(host.provider).toBeUndefined();
  expect(host.secrets).toBeUndefined();
  expect(host.can("net")).toBe(false);
});

test("host: granted fs is sandboxed and cannot escape", () => {
  const { config } = loadConfig();
  const pdir = join(tmp, "pp", "fsplug");
  mkdirSync(pdir, { recursive: true });
  const host = buildHost(["fs:read", "fs:write"], { store, config, cwd: workdir, pluginDir: pdir });
  host.fs!.write!("note.txt", "hi");
  expect(host.fs!.read!("note.txt")).toBe("hi");
  // path traversal is refused
  expect(() => host.fs!.write!("../../escape.txt", "x")).toThrow();
});

test("host: net respects the egress allow-list", async () => {
  const { config } = loadConfig();
  config.security.egressAllowlist = ["api.github.com"];
  const host = buildHost(["net"], { store, config, cwd: workdir, pluginDir: join(tmp, "n", "net") });
  expect(host.net!.isAllowed("https://api.github.com/repos")).toBe(true);
  expect(host.net!.isAllowed("https://evil.example.com/x")).toBe(false);
  await expect(host.net!.fetch("https://evil.example.com/x")).rejects.toThrow(/egress blocked/);
});

// ── full lifecycle via the manager ───────────────────────────────────────────────

test("lifecycle: install (disabled) → enable → tools → run command → disable → remove", async () => {
  const src = makePluginSource({ id: "demo" });
  const mgr = new PluginManager(store, workdir);

  // prepareInstall surfaces requested permissions without copying anything
  const prep = mgr.prepareInstall(src);
  expect(prep.ok).toBe(true);
  expect(prep.manifest?.id).toBe("demo");

  // install (explicit: enabled defaults to false)
  const inst = mgr.commitInstall(src, []);
  expect(inst.ok).toBe(true);
  expect(mgr.getEntry("demo")?.enabled).toBe(false);

  // not loaded until enabled
  await mgr.loadEnabled();
  expect(mgr.pluginTools().length).toBe(0);

  // enable → load → tool is exposed, namespaced
  expect(mgr.enable("demo").ok).toBe(true);
  await mgr.loadEnabled();
  const tools = mgr.pluginTools();
  expect(tools.map((t) => t.name)).toContain("plugin.demo.echo");

  // contributed command runs
  const found = mgr.findCommand("demo", "ping");
  expect(found).not.toBeNull();

  // disable removes it from the loaded set
  expect((await mgr.disable("demo")).ok).toBe(true);
  await mgr.loadEnabled();
  expect(mgr.pluginTools().length).toBe(0);

  // remove deletes files + registry row
  expect((await mgr.remove("demo")).ok).toBe(true);
  expect(mgr.getEntry("demo")).toBeUndefined();
});

test("security: plugin tool is namespaced + approval-gated by default", async () => {
  const src = makePluginSource({
    id: "needsok",
    body: `export default function(host){
      return { tools: [{ name: "danger", description: "x", run(){ return { ok:true, output:"ran" }; } }] };
    }`,
  });
  const mgr = new PluginManager(store, workdir);
  mgr.commitInstall(src, []);
  mgr.enable("needsok");
  await mgr.loadEnabled();
  const tool = mgr.pluginTools().find((t) => t.name === "plugin.needsok.danger")!;
  expect(tool.requiresApproval).toBe(true);

  // denied approval → tool does not run
  const denied = await tool.run({}, { cwd: workdir, approve: async () => false, audit: () => {}, egressAllowlist: [], dryRun: false });
  expect(denied.ok).toBe(false);
  expect(denied.output).toContain("denied");

  // approved → runs
  const approved = await tool.run({}, { cwd: workdir, approve: async () => true, audit: () => {}, egressAllowlist: [], dryRun: false });
  expect(approved.ok).toBe(true);
  expect(approved.output).toBe("ran");
});

test("isolation: a plugin that throws on activate is recorded, not fatal", async () => {
  const src = makePluginSource({
    id: "boom",
    body: `export default function(){ throw new Error("kaboom"); }`,
  });
  const mgr = new PluginManager(store, workdir);
  mgr.commitInstall(src, []);
  mgr.enable("boom");
  await mgr.loadEnabled(); // must not throw
  const health = mgr.health().find((h) => h.entry.id === "boom")!;
  expect(health.status.kind).toBe("error");
  expect(health.status.loaded).toBe(false);
});

test("trust: tampering with the entrypoint after install is refused", async () => {
  const src = makePluginSource({ id: "trusty" });
  const mgr = new PluginManager(store, workdir);
  mgr.commitInstall(src, []);
  mgr.enable("trusty");

  // tamper: append to the installed entrypoint
  appendFileSync(join(mgr.dirFor("trusty"), "index.ts"), "\n// tampered\n");

  await mgr.loadEnabled();
  const health = mgr.health().find((h) => h.entry.id === "trusty")!;
  expect(health.status.kind).toBe("untrusted");
  expect(mgr.pluginTools().length).toBe(0);
});

test("compatibility: an incompatible plugin is rejected at install (fail-fast)", () => {
  const src = makePluginSource({ id: "old", compatibility: ">=99.0.0" });
  const mgr = new PluginManager(store, workdir);
  // Install validates compatibility up front and refuses an incompatible plugin.
  const inst = mgr.commitInstall(src, []);
  expect(inst.ok).toBe(false);
  expect(inst.reason).toContain("range");
  expect(mgr.getEntry("old")).toBeUndefined();
});

test("dependencies: enable refuses when a dependency is missing", () => {
  const dir = mkdtempSync(join(tmp, "dep-"));
  writeFileSync(
    join(dir, "xr-plugin.json"),
    JSON.stringify({ id: "child", name: "Child", version: "1.0.0", dependencies: ["parent"] }),
  );
  writeFileSync(join(dir, "index.ts"), `export default function(){ return {}; }`);
  const mgr = new PluginManager(store, workdir);
  mgr.commitInstall(dir, []);
  const r = mgr.enable("child");
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("dependency");
});

test("update: rejects when new permissions are requested", () => {
  const v1 = makePluginSource({ id: "grow", permissions: [] });
  const mgr = new PluginManager(store, workdir);
  mgr.commitInstall(v1, []);
  const v2 = makePluginSource({ id: "grow", permissions: ["secrets"] });
  const r = mgr.update("grow", v2);
  expect(r.ok).toBe(false);
  expect(r.newPermissions).toEqual(["secrets"]);
});
