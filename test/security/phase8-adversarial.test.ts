/**
 * XR Phase 8 — ADVERSARIAL SUITE.
 *
 * Every other Phase 8 test asks "does the feature work?". This file asks the
 * opposite question: given an attacker who knows exactly how the mechanism is
 * built, can they get past it? Each test is written from the attacker's side
 * and PASSES only when the attack FAILS.
 *
 * The five attack classes named in the plan's acceptance criteria:
 *
 *   1. REPLAY    — reuse a grant that was already spent.
 *   2. MUTATION  — get a grant approved for X, execute Y (the TOCTOU).
 *   3. EXFIL     — read provider credentials out of the process.
 *   4. UNSIGNED  — load third-party code with no provenance.
 *   5. HEADLESS  — approve a Tier-2 action with no human present.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grants } from "../../src/capabilities/grant.ts";
import { requireGrant } from "../../src/capabilities/enforce.ts";
import type { ToolContext } from "../../src/core/types.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-adv-"));
  process.env.XR_HOME = join(tmp, "home");
});

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: tmp,
    approve: async () => true,
    audit: () => {},
    egressAllowlist: [],
    dryRun: false,
    ...over,
  } as ToolContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REPLAY
// ─────────────────────────────────────────────────────────────────────────────
describe("Adversarial · REPLAY — a spent grant cannot be reused", () => {
  test("the same grantId twice is refused the second time", () => {
    const args = { path: "a.txt", content: "x" };
    const g = grants.mint({ capabilityId: "write_file", args, runId: "r" });

    expect(requireGrant(ctx({ grantId: g.grantId }), "write_file", args).ok).toBe(true);
    const second = requireGrant(ctx({ grantId: g.grantId }), "write_file", args);
    expect(second.ok).toBe(false);
  });

  test("a fabricated grantId is refused", () => {
    const res = requireGrant(ctx({ grantId: "grant_deadbeefdeadbeef" }), "write_file", { path: "a" });
    expect(res.ok).toBe(false);
  });

  test("an attacker cannot forge a grant id by guessing the format", () => {
    const real = grants.mint({ capabilityId: "shell", args: { cmd: "ls" }, runId: "r" });
    // Same shape, one character different.
    const forged = real.grantId.slice(0, -1) + (real.grantId.endsWith("a") ? "b" : "a");
    expect(requireGrant(ctx({ grantId: forged }), "shell", { cmd: "ls" }).ok).toBe(false);
  });

  test("a real write_file tool call cannot be replayed on disk", async () => {
    const { allTools } = await import("../../src/tools/registry.ts");
    const writeFile = allTools().find((t) => t.name === "write_file")!;
    const args = { path: "replay.txt", content: "first" };
    const g = grants.mint({ capabilityId: "write_file", args, runId: "r" });

    expect((await writeFile.run(args, ctx({ grantId: g.grantId }))).ok).toBe(true);

    // The attacker replays with different content under the SAME grant.
    const evil = { path: "replay.txt", content: "OVERWRITTEN" };
    const replay = await writeFile.run(evil, ctx({ grantId: g.grantId }));
    expect(replay.ok).toBe(false);
    expect(readFileSync(join(tmp, "replay.txt"), "utf8")).toBe("first");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MUTATION (the TOCTOU Phase 8 exists to close)
// ─────────────────────────────────────────────────────────────────────────────
describe("Adversarial · MUTATION — args cannot change after authorization", () => {
  test("approved for a safe path, executed against a sensitive one → refused", () => {
    const approved = { path: "notes.txt", content: "hello" };
    const g = grants.mint({ capabilityId: "write_file", args: approved, runId: "r" });

    const escalated = { path: "../../.ssh/authorized_keys", content: "attacker-key" };
    expect(requireGrant(ctx({ grantId: g.grantId }), "write_file", escalated).ok).toBe(false);
  });

  test("approved for `ls`, executed as `rm -rf /` → refused", () => {
    const g = grants.mint({ capabilityId: "shell", args: { cmd: "ls" }, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "shell", { cmd: "rm -rf /" }).ok).toBe(false);
  });

  test("adding an extra argument invalidates the grant", () => {
    const args = { cmd: "echo hi" };
    const g = grants.mint({ capabilityId: "shell", args, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "shell", { ...args, sudo: true }).ok).toBe(false);
  });

  test("removing an argument invalidates the grant", () => {
    const g = grants.mint({ capabilityId: "shell", args: { cmd: "echo hi", timeout: 5 }, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "shell", { cmd: "echo hi" }).ok).toBe(false);
  });

  test("key ORDER does not matter (canonicalization is real, not accidental)", () => {
    // The binding must survive honest re-serialization, or callers will hit
    // false denials and someone will 'fix' it by weakening the check.
    const g = grants.mint({ capabilityId: "write_file", args: { path: "a", content: "b" }, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "write_file", { content: "b", path: "a" }).ok).toBe(true);
  });

  test("nested-object mutation is caught (deep hashing, not shallow)", () => {
    const g = grants.mint({ capabilityId: "t", args: { opts: { force: false } }, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "t", { opts: { force: true } }).ok).toBe(false);
  });

  test("a grant for one capability cannot be swapped onto another", () => {
    const args = { path: "x" };
    const g = grants.mint({ capabilityId: "read_file", args, runId: "r" });
    expect(requireGrant(ctx({ grantId: g.grantId }), "delete_file", args).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXFIL
// ─────────────────────────────────────────────────────────────────────────────
describe("Adversarial · EXFIL — provider keys are not in the environment", () => {
  test("setSecret does NOT hydrate process.env under the default posture", async () => {
    const { envHydrationEnabled } = await import("../../src/security/env-compat.ts");
    // The default is what ships; this is the F-24 claim in one line.
    expect(envHydrationEnabled()).toBe(false);
  });

  test("the broker resolves a durable secret WITHOUT exporting it", async () => {
    const { setSecret } = await import("../../src/security/secrets.ts");
    const { secretBrokerSync } = await import("../../src/security/secret-broker.ts");

    const NAME = "XR_ADV_PROVIDER_KEY";
    delete (process.env as Record<string, string | undefined>)[NAME];
    setSecret(NAME, "sk-super-secret");

    // Resolvable by the runtime…
    expect(secretBrokerSync(NAME)).toBe("sk-super-secret");
    // …but NOT visible to any child process or `env`-reading code.
    expect((process.env as Record<string, string | undefined>)[NAME]).toBeUndefined();
  });

  test("a redacted secret never reveals its value", async () => {
    const { redactSecret } = await import("../../src/security/secret-broker.ts");
    const secret = "sk-ant-api03-REALKEYMATERIAL";
    const red = redactSecret(secret) ?? "";
    expect(red).not.toContain("REALKEYMATERIAL");
    expect(red.length).toBeLessThan(secret.length);
  });

  test("a short secret is FULLY masked (no partial-reveal side channel)", async () => {
    const { redactSecret } = await import("../../src/security/secret-broker.ts");
    expect(redactSecret("abc123") ?? "").not.toContain("abc");
  });

  test("BYOK still works: an ambient exported key is readable", async () => {
    const { secretBrokerSync } = await import("../../src/security/secret-broker.ts");
    process.env.XR_ADV_AMBIENT_KEY = "user-exported";
    // The user's own `export FOO=...` must keep working — a security change
    // that breaks the documented workflow gets disabled by its users.
    expect(secretBrokerSync("XR_ADV_AMBIENT_KEY")).toBe("user-exported");
    delete process.env.XR_ADV_AMBIENT_KEY;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. UNSIGNED
// ─────────────────────────────────────────────────────────────────────────────
describe("Adversarial · UNSIGNED — code without provenance cannot run", () => {
  test("an unsigned plugin is not trusted", async () => {
    const { PluginTrustStore } = await import("../../src/plugins/signing.ts");
    expect(new PluginTrustStore().isTrusted("evil", "somehash").ok).toBe(false);
  });

  test("hand-writing a trust record without the key is rejected", async () => {
    const { PluginTrustStore, defaultPluginTrustPath } = await import("../../src/plugins/signing.ts");
    const ts = new PluginTrustStore();
    ts.ensureKeys();
    ts.record("good", "hash-good", "operator-allowed");

    // Attacker appends their own plugin to the signed file.
    const path = defaultPluginTrustPath();
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.plugins.evil = {
      pluginId: "evil",
      treeHash: "hash-evil",
      kind: "signed",
      grantedAt: Date.now(),
      by: "attacker",
    };
    writeFileSync(path, JSON.stringify(raw));

    const reopened = new PluginTrustStore();
    expect(reopened.verifyFile().ok).toBe(false);
    expect(reopened.isTrusted("evil", "hash-evil").ok).toBe(false);
    // The forgery invalidates the whole store — the legitimate entry stops
    // verifying too. Fail-closed, not fail-partial.
    expect(reopened.isTrusted("good", "hash-good").ok).toBe(false);
  });

  test("an unsigned MCP allowlist grants nothing", async () => {
    const { McpAllowlist } = await import("../../src/mcp/allowlist.ts");
    const al = new McpAllowlist();
    expect(al.isAllowed("anything").ok).toBe(false);
    expect(al.isolationFor("anything").unisolatedGranted).toBe(false);
  });

  test("an isolation grant cannot be injected into a signed allowlist", async () => {
    const {
      McpAllowlist,
      defaultAllowlistKeysPath,
      generateAllowlistKeyPair,
      writeAllowlistKeys,
    } = await import("../../src/mcp/allowlist.ts");

    if (!existsSync(defaultAllowlistKeysPath())) {
      writeAllowlistKeys([generateAllowlistKeyPair()]);
    }
    const al = new McpAllowlist();
    al.allow("srv", { by: "operator" }); // isolation: "required"
    expect(al.isolationFor("srv").unisolatedGranted).toBe(false);

    // Attacker edits the signed file to grant the escape hatch.
    const path = join(process.env.XR_HOME!, "mcp", "allowlist.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.servers.srv.isolation = "granted-unisolated-by:xr-operator-1";
    writeFileSync(path, JSON.stringify(raw));

    // `isolation` is inside the signed payload, so this breaks the signature.
    const reopened = new McpAllowlist();
    expect(reopened.verifyFile().ok).toBe(false);
    expect(reopened.isolationFor("srv").unisolatedGranted).toBe(false);
  });

  test("the deleted MCP env escape hatch has no effect", async () => {
    process.env.XR_MCP_ALLOW_UNISOLATED = "1";
    const { decideMcpStdioPlacement } = await import("../../src/runtime/trust/isolated-spawn.ts");
    // High risk, no sandbox, no signed grant → blocked, env var notwithstanding.
    const placement = decideMcpStdioPlacement(
      "high",
      false,
      { isolateStdio: false, allowNet: false, unisolatedGrant: false },
      false,
    );
    expect(placement).toBe("blocked");
    delete process.env.XR_MCP_ALLOW_UNISOLATED;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. HEADLESS
// ─────────────────────────────────────────────────────────────────────────────
describe("Adversarial · HEADLESS — no silent Tier-2 approval", () => {
  test("a blind approve() on a headless tier-2 request fails", async () => {
    const { Store } = await import("../../src/state/workspace-store.ts");
    const { ApprovalStore } = await import("../../src/control/approval-store.ts");
    const store = new Store(join(tmp, "adv.db"));
    const approvals = new ApprovalStore(store, { defaultTtlMs: 60_000 });

    const h = approvals.request({
      tool: "delete_file",
      reason: "cleanup",
      args: { path: "/important" },
      riskTier: "tier2",
      surface: "daemon",
      headless: true,
    });

    // The attacker has the approval id (it is not a secret) but never read the
    // request body, so they cannot produce the phrase.
    expect(approvals.decide(h.id, true, { channel: "daemon", userId: "attacker" })).toBe(false);
    expect(approvals.decide(h.id, true, { channel: "daemon" }, "yes")).toBe(false);
    expect(approvals.decide(h.id, true, { channel: "daemon" }, h.id)).toBe(false);
    expect(approvals.get(h.id)?.decision).toBe(null);

    store.close();
  });

  test("the phrase cannot be derived from the tool name alone", async () => {
    const { typedConfirmPhrase } = await import("../../src/control/approval-store.ts");
    const p1 = typedConfirmPhrase({ id: "ap_aaa", tool: "delete_file", argsHash: "sha256:111111" });
    const p2 = typedConfirmPhrase({ id: "ap_bbb", tool: "delete_file", argsHash: "sha256:222222" });
    expect(p1).not.toBe(p2);
  });
});
