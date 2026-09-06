/**
 * XR Phase 8 · Step 4 — plugin signing, grandfathering and high-risk placement.
 *
 * The properties under test are the ones the design turns on:
 *
 *   1. a plugin installed AFTER the signing rule is live is quarantined, not
 *      loaded (provenance is required for new code);
 *   2. a plugin present BEFORE the rule is grandfathered and keeps working
 *      (no upgrade breakage);
 *   3. grandfathering is bound to the tree hash — modify the code and trust
 *      does not follow it (the amnesty is not a blank cheque);
 *   4. `xr plugins allow` restores a quarantined plugin;
 *   5. high-risk (shell/process/network) plugins are Tier-2 and cannot
 *      self-declare their way out of approval.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import {
  PluginTrustStore,
  pluginRiskTier,
  highRiskPermissions,
  generatePluginKeyPair,
} from "../../src/plugins/signing.ts";

let tmp: string;
let store: Store;
let workdir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-psign-"));
  process.env.XR_HOME = join(tmp, "home");
  delete process.env.XR_PLUGINS_ALLOW_UNSIGNED;
  store = new Store(join(tmp, "s.db"));
  workdir = join(tmp, "work");
  mkdirSync(workdir, { recursive: true });
});

/** Minimal valid plugin source tree. */
function makePlugin(id: string, opts: { permissions?: string[]; body?: string } = {}): string {
  const dir = join(tmp, `src-${id}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "xr-plugin.json"),
    JSON.stringify({
      id,
      name: id,
      version: "1.0.0",
      type: "tool",
      entrypoint: "index.ts",
      permissions: opts.permissions ?? [],
      compatibility: "*",
      apiVersion: 1,
    }, null, 2),
  );
  writeFileSync(
    join(dir, "index.ts"),
    opts.body ??
      `export function activate(host){ return { tools: [{ name: "t", description: "d", run(){ return { ok:true, output:"ran" }; } }] }; }`,
  );
  return dir;
}

describe("Phase 8 · Step 4 — pure risk classification", () => {
  test("shell / process / network are high risk ⇒ tier2", () => {
    expect(pluginRiskTier(["shell"])).toBe("tier2");
    expect(pluginRiskTier(["process"])).toBe("tier2");
    expect(pluginRiskTier(["network"])).toBe("tier2");
  });

  test("scoped forms (network:api.example.com) are still high risk", () => {
    expect(pluginRiskTier(["network:api.example.com"])).toBe("tier2");
  });

  test("ordinary permissions stay tier1", () => {
    expect(pluginRiskTier([])).toBe("tier1");
    expect(pluginRiskTier(["read", "memory"])).toBe("tier1");
  });

  test("the risky permissions are reported for the approval prompt", () => {
    expect(highRiskPermissions(["read", "shell", "network"])).toEqual(["shell", "network"]);
  });
});

describe("Phase 8 · Step 4 — the trust store fails closed", () => {
  test("an uninitialised store trusts nothing", () => {
    const ts = new PluginTrustStore();
    expect(ts.isUninitialised).toBe(true);
    expect(ts.isTrusted("anything", "deadbeef").ok).toBe(false);
  });

  test("a record vouches ONLY for the tree hash it was issued against", () => {
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("p", "hash-A", "operator-allowed");
    expect(ts.isTrusted("p", "hash-A").ok).toBe(true);
    const drifted = ts.isTrusted("p", "hash-B");
    expect(drifted.ok).toBe(false);
    expect(drifted.reason).toContain("code changed");
  });

  test("tampering with a record breaks the signature (whole store fails closed)", () => {
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("p", "hash-A", "operator-allowed");
    const path = join(process.env.XR_HOME!, "plugins", "trust.json");
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    // Forge: point the existing signed record at different code.
    raw.plugins.p.treeHash = "hash-EVIL";
    writeFileSync(path, JSON.stringify(raw));
    const reopened = new PluginTrustStore();
    expect(reopened.verifyFile().ok).toBe(false);
    expect(reopened.isTrusted("p", "hash-EVIL").ok).toBe(false);
  });

  test("upgrading a grandfathered record to `signed` by hand is rejected", () => {
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("p", "hash-A", "grandfathered");
    const path = join(process.env.XR_HOME!, "plugins", "trust.json");
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
    raw.plugins.p.kind = "signed"; // `kind` is inside the signed payload
    writeFileSync(path, JSON.stringify(raw));
    expect(new PluginTrustStore().verifyFile().ok).toBe(false);
  });

  test("revocation removes trust", () => {
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("p", "h", "operator-allowed");
    expect(ts.isTrusted("p", "h").ok).toBe(true);
    ts.revoke("p");
    expect(new PluginTrustStore().isTrusted("p", "h").ok).toBe(false);
  });
});

describe("Phase 8 · Step 4 — grandfathering vs new installs", () => {
  test("plugins present before the rule are grandfathered and still load", async () => {
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("legacy"), []);
    mgr.enable("legacy");

    // First loadEnabled with no trust store = the upgrade moment.
    await mgr.loadEnabled();

    const entry = mgr.getEntry("legacy")!;
    expect(entry.lifecycleState).not.toBe("quarantined");
    expect(mgr.pluginTools().some((t) => t.name === "plugin.legacy.t")).toBe(true);

    const rec = new PluginTrustStore().list().find((r) => r.pluginId === "legacy");
    expect(rec?.kind).toBe("grandfathered");
    expect(rec?.treeHash).toBe(entry.treeHash);
  });

  test("a plugin installed AFTER the rule is live is quarantined, not loaded", async () => {
    // Establish the trust store (the upgrade already happened).
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("legacy"), []);
    mgr.enable("legacy");
    await mgr.loadEnabled();
    expect(new PluginTrustStore().isUninitialised).toBe(false);

    // Now a NEW, unsigned plugin arrives.
    const mgr2 = new PluginManager(store, workdir);
    mgr2.commitInstall(makePlugin("newcomer"), []);
    mgr2.enable("newcomer");
    await mgr2.loadEnabled();

    const entry = mgr2.getEntry("newcomer")!;
    expect(entry.lifecycleState).toBe("quarantined");
    expect(entry.quarantineReason).toContain("unsigned");
    expect(mgr2.pluginTools().some((t) => t.name.startsWith("plugin.newcomer."))).toBe(false);
  });

  test("`xr plugins allow` (operator trust) lets the quarantined plugin load", async () => {
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("legacy"), []);
    mgr.enable("legacy");
    await mgr.loadEnabled();

    const mgr2 = new PluginManager(store, workdir);
    mgr2.commitInstall(makePlugin("newcomer"), []);
    mgr2.enable("newcomer");
    await mgr2.loadEnabled();
    expect(mgr2.getEntry("newcomer")!.lifecycleState).toBe("quarantined");

    // What `xr plugins allow` does.
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("newcomer", mgr2.getEntry("newcomer")!.treeHash!, "operator-allowed");

    const mgr3 = new PluginManager(store, workdir);
    const lift = mgr3.liftUnsignedQuarantine("newcomer");
    expect(lift.ok).toBe(true);
    await mgr3.loadEnabled();
    expect(mgr3.getEntry("newcomer")!.lifecycleState).not.toBe("quarantined");
    expect(mgr3.pluginTools().some((t) => t.name === "plugin.newcomer.t")).toBe(true);
  });

  test("a quarantine cannot be lifted while the plugin is still untrusted", async () => {
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("legacy"), []);
    mgr.enable("legacy");
    await mgr.loadEnabled();

    const mgr2 = new PluginManager(store, workdir);
    mgr2.commitInstall(makePlugin("newcomer"), []);
    mgr2.enable("newcomer");
    await mgr2.loadEnabled();

    // No trust recorded — the lift must refuse rather than quietly enable.
    const lift = mgr2.liftUnsignedQuarantine("newcomer");
    expect(lift.ok).toBe(false);
    expect(lift.reason).toContain("still untrusted");
    expect(mgr2.getEntry("newcomer")!.lifecycleState).toBe("quarantined");
  });

  test("XR_PLUGINS_ALLOW_UNSIGNED=1 is an escape hatch that still loads unsigned code", async () => {
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("legacy"), []);
    mgr.enable("legacy");
    await mgr.loadEnabled();

    process.env.XR_PLUGINS_ALLOW_UNSIGNED = "1";
    const mgr2 = new PluginManager(store, workdir);
    mgr2.commitInstall(makePlugin("newcomer"), []);
    mgr2.enable("newcomer");
    await mgr2.loadEnabled();
    expect(mgr2.getEntry("newcomer")!.lifecycleState).not.toBe("quarantined");
    delete process.env.XR_PLUGINS_ALLOW_UNSIGNED;
  });
});

describe("Phase 8 · Step 4 — high-risk plugins are Tier-2", () => {
  test("a shell-declaring plugin's tool requires approval even if it opts out", async () => {
    const mgr = new PluginManager(store, workdir);
    const src = makePlugin("risky", {
      permissions: ["shell"],
      // The plugin ASKS to skip approval. It must not be granted.
      body: `export function activate(host){ return { tools: [{ name: "danger", description: "d", requiresApproval: false, run(){ return { ok:true, output:"ran" }; } }] }; }`,
    });
    mgr.commitInstall(src, ["shell"]);
    mgr.enable("risky");
    await mgr.loadEnabled();

    const tool = mgr.pluginTools().find((t) => t.name === "plugin.risky.danger");
    expect(tool).toBeDefined();
    expect(tool!.requiresApproval).toBe(true);
  });

  test("the Tier-2 approval prompt names the high-risk permission", async () => {
    const mgr = new PluginManager(store, workdir);
    mgr.commitInstall(makePlugin("risky2", { permissions: ["shell"] }), ["shell"]);
    mgr.enable("risky2");
    await mgr.loadEnabled();
    const tool = mgr.pluginTools().find((t) => t.name === "plugin.risky2.t")!;

    const seen: Array<{ reason: string; riskTier?: string }> = [];
    const { mintTestGrant } = await import("../helpers/grant.ts");
    await tool.run({}, {
      cwd: workdir,
      approve: async (req: any) => {
        seen.push({ reason: req.reason, riskTier: req.riskTier });
        return false;
      },
      audit: () => {},
      egressAllowlist: [],
      dryRun: false,
      grantId: mintTestGrant("plugin.risky2.t", {}),
    } as any);

    expect(seen.length).toBe(1);
    expect(seen[0].riskTier).toBe("tier2");
    expect(seen[0].reason).toContain("shell");
    expect(seen[0].reason).toContain("TIER-2");
  });
});
