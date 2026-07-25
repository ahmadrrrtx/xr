import { describe, expect, test } from "bun:test";
import {
  pluginCapabilityTier,
  assessPluginRisk,
  pluginTrustRequestFromPerms,
  PLUGIN_HARD_BOUNDARY_PERMS,
} from "../../src/trust/tool-support.ts";
import { classifyRisk } from "../../src/trust/classify.ts";

describe("XR 4.2 plugin capability tier model", () => {
  test("hard-boundary capabilities (shell/control/browser) are Tier 2", () => {
    for (const p of PLUGIN_HARD_BOUNDARY_PERMS) {
      expect(pluginCapabilityTier(p)).toBe("tier2_isolated");
    }
  });
  test("secrets (credentials) is Tier 2; net is Tier 1 (egress-gated); reads are Tier 0", () => {
    expect(pluginCapabilityTier("secrets")).toBe("tier2_isolated");
    expect(pluginCapabilityTier("net")).toBe("tier1_restricted");
    expect(pluginCapabilityTier("fs:write")).toBe("tier1_restricted");
    expect(pluginCapabilityTier("provider")).toBe("tier1_restricted");
    expect(pluginCapabilityTier("fs:read")).toBe("tier0_in_process");
    expect(pluginCapabilityTier("memory:read")).toBe("tier0_in_process");
    expect(pluginCapabilityTier("ui")).toBe("tier0_in_process");
  });
});

describe("XR 4.2 declared-vs-effective plugin risk (declared ≠ authority)", () => {
  test("a DECLARED shell the plugin is not granted is membrane-blocked and does not raise effective tier", () => {
    const a = assessPluginRisk(["shell", "fs:read"], ["fs:read"]);
    expect(a.effectiveTier).toBe("tier0_in_process"); // only fs:read is granted
    expect(a.requiresHardBoundary).toEqual(["shell"]);
    expect(a.membraneBlocked).toEqual(["shell"]); // blocked by the VM membrane
    expect(a.declaredNotGranted).toEqual(["shell"]);
  });

  test("granted net + fs:write → effective Tier 1", () => {
    const a = assessPluginRisk(["net", "fs:write"], ["net", "fs:write"]);
    expect(a.effectiveTier).toBe("tier1_restricted");
    expect(a.membraneBlocked).toEqual([]);
  });

  test("granted secrets → effective Tier 2 with credential access", () => {
    const a = assessPluginRisk(["secrets"], ["secrets"]);
    expect(a.effectiveTier).toBe("tier2_isolated");
    expect(a.grantedCredentialAccess).toBe(true);
  });

  test("declared shell+control with nothing granted → all membrane-blocked, effective Tier 0", () => {
    const a = assessPluginRisk(["shell", "control"], []);
    expect(a.effectiveTier).toBe("tier0_in_process");
    expect(a.membraneBlocked.sort()).toEqual(["control", "shell"]);
  });
});

describe("XR 4.2 plugin trust request from permissions", () => {
  test("granted secrets → credential-bearing, destructive classification", () => {
    const req = pluginTrustRequestFromPerms("plug", "invoke", ["secrets"], ["secrets"], "/tmp/ws");
    expect(req.needsCredentials).toBe(true);
    expect(classifyRisk(req).tier).toBe("tier2_isolated");
  });

  test("declared shell but only fs:read granted → NOT credential-bearing, classified by effective (granted) risk", () => {
    const req = pluginTrustRequestFromPerms("plug", "invoke", ["fs:read"], ["shell", "fs:read"], "/tmp/ws");
    expect(req.needsCredentials).toBe(false);
    // effective risk is from GRANTED perms only; the declared shell is membrane-blocked, not authority.
    expect(req.controlRisk).toBe("safe");
    expect(classifyRisk(req).tier).toBe("tier0_in_process");
  });
});
