/**
 * XR — PluginHost (Capability Gateway) Tests
 *
 * The host is the ONLY API a plugin can reach. These tests pin the contract:
 *  - capabilities exist IFF the matching permission was granted
 *  - the host object itself is escape-proof (null prototype, frozen,
 *    prototype-less functions)
 *  - fs capability is traversal-safe, size-limited, dotfile-filtered, audited
 *  - net capability is egress-gated BEFORE any network activity
 *  - secrets capability validates/sanitizes names and audits every access
 *  - memory capability is scope-correct and size-limited
 *  - provider capability enforces the budget rail before any remote call
 *  - console output redacts credentials
 *  - mcp capability exposes metadata only (never command/env)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import { buildHost, type PluginHost, type HostDeps } from "../../src/plugins/host.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { PLUGIN_API_VERSION, CORE_VERSION } from "../../src/core/version.ts";
import { projectScopeFromCwd } from "../../src/memory/store.ts";
import type { XRConfig } from "../../src/config/config.ts";
import type { PermissionScope } from "../../src/plugins/types.ts";

let tmp: string;
let store: WorkspaceStore;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-host-"));
  store = new WorkspaceStore("host-test", join(tmp, "xr.db"));
  mkdirSync(join(tmp, "plugin"), { recursive: true });
});

afterEach(() => {
  try {
    store.close();
  } catch {}
  rmSync(tmp, { recursive: true, force: true });
});

function makeConfig(overrides: Record<string, unknown> = {}): XRConfig {
  return {
    security: { egressAllowlist: ["api.github.com", "localhost"], requireApproval: [] },
    defaults: { provider: "anthropic", model: "claude-test" },
    ...overrides,
  } as unknown as XRConfig;
}

function makeHost(granted: PermissionScope[], deps: Partial<HostDeps> = {}): PluginHost {
  return buildHost(granted, {
    store,
    config: makeConfig(),
    cwd: tmp,
    pluginDir: join(tmp, "plugin"),
    pluginId: "host-test-plugin",
    ...deps,
  });
}

// ── capability gating matrix ────────────────────────────────────────────────

describe("capability gating: permission = capability", () => {
  test("no permissions → zero capabilities", () => {
    const host = makeHost([]);
    expect(host.fs).toBeUndefined();
    expect(host.net).toBeUndefined();
    expect(host.memory).toBeUndefined();
    expect(host.provider).toBeUndefined();
    expect(host.secrets).toBeUndefined();
    expect(host.mcp).toBeUndefined();
  });

  test("fs:read grants read/list only; fs:write grants write only", () => {
    const reader = makeHost(["fs:read"]);
    expect(reader.fs?.read).toBeDefined();
    expect(reader.fs?.list).toBeDefined();
    expect(reader.fs?.write).toBeUndefined();

    const writer = makeHost(["fs:write"]);
    expect(writer.fs?.write).toBeDefined();
    expect(writer.fs?.read).toBeUndefined();
  });

  test("memory:read / memory:write map to recall / add exactly", () => {
    const reader = makeHost(["memory:read"]);
    expect(reader.memory?.recall).toBeDefined();
    expect(reader.memory?.add).toBeUndefined();

    const writer = makeHost(["memory:write"]);
    expect(writer.memory?.add).toBeDefined();
    expect(writer.memory?.recall).toBeUndefined();
  });

  test("net / secrets / provider / mcp each require their own grant", () => {
    expect(makeHost(["net"]).net).toBeDefined();
    expect(makeHost(["secrets"]).secrets).toBeDefined();
    expect(makeHost(["provider"]).provider).toBeDefined();
    expect(makeHost(["mcp"]).mcp).toBeDefined();
    expect(makeHost([]).net).toBeUndefined();
    expect(makeHost([]).secrets).toBeUndefined();
    expect(makeHost([]).provider).toBeUndefined();
    expect(makeHost([]).mcp).toBeUndefined();
  });

  test("host.can reports grants truthfully", () => {
    const host = makeHost(["fs:read", "secrets"]);
    expect(host.can("fs:read")).toBe(true);
    expect(host.can("secrets")).toBe(true);
    expect(host.can("fs:write")).toBe(false);
    expect(host.can("net")).toBe(false);
    expect(host.permissions).toContain("fs:read");
    expect(Object.isFrozen(host.permissions)).toBe(true);
  });
});

// ── host object hardening ───────────────────────────────────────────────────

describe("host object hardening (escape-proof surface)", () => {
  test("host has a null prototype and is frozen", () => {
    const host = makeHost(["fs:read"]);
    expect(Object.getPrototypeOf(host)).toBeNull();
    expect(Object.isFrozen(host)).toBe(true);
  });

  test("host functions carry no prototype or constructor path", () => {
    const host = makeHost(["fs:read"]);
    const fns = [host.log, host.warn, host.audit, host.can, host.fs!.read!, host.fs!.list!];
    for (const fn of fns) {
      expect((fn as any).prototype).toBeUndefined();
      expect((fn as any).constructor).toBeUndefined();
      expect(Object.getPrototypeOf(fn as any)).toBeNull();
    }
  });

  test("identity fields come from the single version source of truth", () => {
    const host = makeHost([]);
    expect(host.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(host.coreVersion).toBe(CORE_VERSION);
    expect(host.id).toBe("host-test-plugin");
  });
});

// ── fs capability ───────────────────────────────────────────────────────────

describe("fs capability: containment and limits", () => {
  test("blocks ../ traversal (win and posix separators) and absolute paths", () => {
    const host = makeHost(["fs:read", "fs:write"]);
    expect(() => host.fs?.path("../../../etc/passwd")).toThrow("path escapes plugin data directory");
    expect(() => host.fs?.path("..\\..\\windows\\system32")).toThrow("path escapes plugin data directory");
    expect(() => host.fs?.path("/etc/passwd")).toThrow("absolute paths not allowed");
    expect(() => host.fs?.path("nested/../../escape")).toThrow("path escapes plugin data directory");
  });

  test("rejects empty and overlong paths", () => {
    const host = makeHost(["fs:write"]);
    expect(() => host.fs?.path("")).toThrow("path must be non-empty string");
    expect(() => host.fs?.path("x".repeat(2000))).toThrow("path too long");
  });

  test("write + read round-trips inside plugin data dir (and is audited)", () => {
    const host = makeHost(["fs:read", "fs:write"]);
    host.fs!.write!("notes/todo.txt", "buy milk");
    expect(host.fs!.read!("notes/todo.txt")).toBe("buy milk");

    const events = store.recentAudit(10).map((r) => r.event);
    expect(events).toContain("plugin.fs.write");
    expect(events).toContain("plugin.fs.read");
    // No secret can leak through the audit trail detail.
    const detail = store.recentAudit(10).map((r) => r.detail).join(" ");
    expect(detail).toContain("notes/todo.txt");
  });

  test("reading a missing file returns empty string (not undefined/throw)", () => {
    const host = makeHost(["fs:read"]);
    expect(host.fs!.read!("does-not-exist.txt")).toBe("");
  });

  test("list() hides dotfiles, node_modules and __pycache__", () => {
    const dataDir = join(tmp, "plugin", "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "visible.txt"), "v");
    writeFileSync(join(dataDir, ".hidden"), "h");
    mkdirSync(join(dataDir, "node_modules"), { recursive: true });
    mkdirSync(join(dataDir, "__pycache__"), { recursive: true });

    const host = makeHost(["fs:read"]);
    expect(host.fs!.list!(".")).toEqual(["visible.txt"]);
  });

  test("write refuses oversized content", () => {
    const host = makeHost(["fs:write"]);
    expect(() => host.fs!.write!("big.txt", "x".repeat(10 * 1024 * 1024 + 1))).toThrow("content too large");
  });
});

// ── net capability ──────────────────────────────────────────────────────────

describe("net capability: egress allow-list", () => {
  test("isAllowed matches exact hosts and subdomains, case-insensitively", () => {
    const host = makeHost(["net"]);
    expect(host.net?.isAllowed("https://api.github.com/repos/a/b")).toBe(true);
    expect(host.net?.isAllowed("https://raw.api.github.com/file")).toBe(true);
    expect(host.net?.isAllowed("https://API.GITHUB.COM/")).toBe(true);
    expect(host.net?.isAllowed("https://notgithub.com/")).toBe(false);
    expect(host.net?.isAllowed("https://github.com.evil.example/")).toBe(false);
    expect(host.net?.isAllowed("not a url")).toBe(false);
  });

  test("fetch rejects non-http(s) protocols before any network activity", async () => {
    const host = makeHost(["net"]);
    await expect(host.net?.fetch("file:///etc/passwd")).rejects.toThrow("unsupported protocol");
    await expect(host.net?.fetch("ftp://localhost/x")).rejects.toThrow("unsupported protocol");
  });

  test("fetch rejects non-allow-listed hosts (and audits the block)", async () => {
    const host = makeHost(["net"]);
    await expect(host.net?.fetch("https://evil.example.com/exfil")).rejects.toThrow("egress blocked");
    // Never even reaches DNS — the block event is audited.
    expect(store.recentAudit(10).map((r) => r.event)).toContain("plugin.net.blocked");
  });

  test("fetch rejects unparseable URLs", async () => {
    const host = makeHost(["net"]);
    await expect(host.net?.fetch("::not a url::")).rejects.toThrow("invalid URL");
  });
});

// ── secrets capability ──────────────────────────────────────────────────────

describe("secrets capability: validated, audited, never logged", () => {
  test("get() returns undefined for unset names without throwing", () => {
    const host = makeHost(["secrets"]);
    expect(host.secrets?.get("DEFINITELY_NOT_SET_XR_TEST")).toBeUndefined();
  });

  test("secret names are sanitized (shell metacharacters stripped, audited)", () => {
    const host = makeHost(["secrets"]);
    // Injection-shaped names must not throw or reach the backend verbatim.
    expect(host.secrets?.get("A; rm -rf / $(whoami)")).toBeUndefined();
    const audit = store.recentAudit(10).map((r) => r.event);
    expect(audit).toContain("plugin.secrets.get");
    const details = store.recentAudit(10).map((r) => r.detail).join(" ");
    expect(details).not.toContain("$(whoami)");
  });
});

// ── memory capability ───────────────────────────────────────────────────────

describe("memory capability: scoped, size-limited, audited", () => {
  test("add writes under the caller's project scope", async () => {
    const host = makeHost(["memory:read", "memory:write"]);
    const scope = projectScopeFromCwd(tmp);
    const res = host.memory!.add!("plugin learned this fact");
    expect(res?.ok).toBe(true);

    const row = store.listMemory({ scope }).find((m) => m.content === "plugin learned this fact");
    expect(row).toBeDefined();
    expect(row!.scope).toBe(scope);
    // Attribution: tagged with the plugin id.
    expect(row!.tags).toContain("plugin:host-test-plugin");

    const hits = await host.memory!.recall!("plugin learned", { k: 5 });
    expect(hits?.some((h) => h.content === "plugin learned this fact")).toBe(true);
  });

  test("add rejects oversized content", () => {
    const host = makeHost(["memory:write"]);
    expect(() => host.memory!.add!("x".repeat(100_001))).toThrow("content too large");
  });

  test("recall rejects oversized queries", async () => {
    const host = makeHost(["memory:read"]);
    await expect(host.memory!.recall!("q".repeat(1001))).rejects.toThrow("query too long");
  });

  test("duplicate add is idempotent (no repeated rows)", () => {
    const host = makeHost(["memory:write"]);
    host.memory!.add!("same fact");
    host.memory!.add!("same fact");
    const scope = projectScopeFromCwd(tmp);
    expect(store.listMemory({ scope }).filter((m) => m.content === "same fact")).toHaveLength(1);
  });
});

// ── provider capability ─────────────────────────────────────────────────────

describe("provider capability: budget rail before network", () => {
  test("chat is refused when the monthly budget is exhausted (offline-safe)", async () => {
    // Bankrupt the budget in the unified store so no provider call can start.
    store.setBudgetConfig({ monthly_cap: 0.0001 });
    store.recordCost("seed", "anthropic", "claude-test", 1, 1, 1.0);

    const host = makeHost(["provider"]);
    const res = await host.provider?.chat([{ role: "user", content: "hello" }]);
    expect(res?.ok).toBe(false);
    expect(res?.reason).toContain("budget exhausted");
    expect(store.recentAudit(10).map((r) => r.event)).toContain("plugin.provider.blocked");
  });

  test("chat validates message shape before anything else", async () => {
    const host = makeHost(["provider"]);
    await expect(host.provider?.chat([])).rejects.toThrow("non-empty array");
  });
});

// ── mcp capability ──────────────────────────────────────────────────────────

describe("mcp capability: metadata only", () => {
  test("servers() never leaks command, args or env", () => {
    const host = makeHost(["mcp"], {
      mcpServers: [
        {
          id: "web",
          transport: "stdio",
          command: "dangerous-binary --secret-flag",
          args: ["leak-me"],
          env: { AWS_SECRET_ACCESS_KEY: "hunter2" },
          url: undefined,
          tools: ["search"],
          description: "demo server",
        } as any,
      ],
    });
    const servers = host.mcp?.servers() ?? [];
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("web");
    expect(servers[0].transport).toBe("stdio");
    expect(servers[0].tools).toEqual(["search"]);
    expect(servers[0].description).toBe("demo server");
    const keys = Object.keys(servers[0]);
    expect(keys).not.toContain("command");
    expect(keys).not.toContain("args");
    expect(keys).not.toContain("env");
    expect(JSON.stringify(servers)).not.toContain("AWS_SECRET_ACCESS_KEY");
  });
});

// ── console redaction ───────────────────────────────────────────────────────

describe("host console output redacts credentials", () => {
  test("host.log masks api keys, bearer tokens and password= values", () => {
    const host = makeHost([]);
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      host.log("using key sk-abcdefghij0123456789 and Bearer abcdefghijklmnop and password= hunter2");
    } finally {
      console.log = original;
    }
    const out = lines.join("\n");
    expect(out).not.toContain("sk-abcdefghij0123456789");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("«redacted");
  });
});
