/**
 * XR Phase 8 · XR804 — plugin signed allowlist + high-risk placement.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PluginAllowlist,
  generatePluginAllowlistKeyPair,
  writePluginAllowlistKeys,
  pluginsAllowUnsigned,
} from "../../src/plugins/allowlist.ts";
import { decidePluginPlacement, grantedHardBoundaryPerms } from "../../src/plugins/placement.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "xr-p8-plug-"));
  process.env.XR_HOME = join(home, "home");
  mkdirSync(process.env.XR_HOME, { recursive: true });
});

describe("XR804 plugin allowlist", () => {
  test("unsigned / no keys ⇒ default-deny", () => {
    const al = new PluginAllowlist();
    expect(al.isAllowed("anything").ok).toBe(false);
    expect(al.verifyFile().ok).toBe(false);
  });

  test("listed+signed plugin allowed; unlisted refused; hash pin mismatch refused", () => {
    const pair = generatePluginAllowlistKeyPair("op-1");
    writePluginAllowlistKeys([pair]);
    const al = new PluginAllowlist();
    const allowed = al.allow("demo", { by: "operator", treeHash: "aaa", manifestHash: "bbb" });
    expect(allowed.ok).toBe(true);
    expect(al.isAllowed("demo", { treeHash: "aaa", manifestHash: "bbb" }).ok).toBe(true);
    expect(al.isAllowed("other").ok).toBe(false);
    expect(al.isAllowed("demo", { treeHash: "TAMPERED" }).ok).toBe(false);
  });

  test("revoke removes the entry and re-signs", () => {
    const pair = generatePluginAllowlistKeyPair("op-1");
    writePluginAllowlistKeys([pair]);
    const al = new PluginAllowlist();
    al.allow("demo", { by: "operator" });
    expect(al.revoke("demo").ok).toBe(true);
    expect(al.isAllowed("demo").ok).toBe(false);
    expect(al.verifyFile().ok).toBe(true);
  });

  test("unsigned hatch is explicit XR_PLUGINS_ALLOW_UNSIGNED=1 only", () => {
    const prev = process.env.XR_PLUGINS_ALLOW_UNSIGNED;
    delete process.env.XR_PLUGINS_ALLOW_UNSIGNED;
    expect(pluginsAllowUnsigned()).toBe(false);
    process.env.XR_PLUGINS_ALLOW_UNSIGNED = "1";
    expect(pluginsAllowUnsigned()).toBe(true);
    if (prev === undefined) delete process.env.XR_PLUGINS_ALLOW_UNSIGNED;
    else process.env.XR_PLUGINS_ALLOW_UNSIGNED = prev;
  });
});

describe("XR804 high-risk plugin placement", () => {
  test("no hard-boundary perms ⇒ in_process", () => {
    expect(grantedHardBoundaryPerms(["fs", "net"])).toEqual([]);
    expect(decidePluginPlacement([], true, "tier0_in_process")).toBe("in_process");
    expect(decidePluginPlacement([], false, "tier0_in_process")).toBe("in_process");
  });

  test("shell/control/browser + sandbox ⇒ isolated; without sandbox ⇒ blocked", () => {
    expect(grantedHardBoundaryPerms(["shell", "fs"])).toEqual(["shell"]);
    expect(decidePluginPlacement(["shell"], true)).toBe("isolated");
    expect(decidePluginPlacement(["shell"], false)).toBe("blocked");
    expect(decidePluginPlacement(["control"], false)).toBe("blocked");
    expect(decidePluginPlacement(["browser"], true)).toBe("isolated");
  });
});
