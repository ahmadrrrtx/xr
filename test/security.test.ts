/**
 * XR — Security Guardrail Test Suite
 *
 * Verifies that the critical RCE / data-leak vectors remain closed:
 *
 *  1. Plugin sandbox  — static scan rejects dangerous imports/patterns
 *                       (deep VM-isolation coverage lives in test/plugins/).
 *  2. Browser control — --no-sandbox is never silently added; the Chromium
 *                       sandbox stays enabled unless explicitly forced with
 *                       multi-flag acknowledgement.
 *  3. MCP client      — child processes receive an allow-listed environment
 *                       (never the full process.env), tool names are
 *                       validated, and payloads are sanitized against
 *                       prototype pollution.
 *
 * These tests assert against the REAL implementation markers (verified
 * against the current source), not an imagined architecture.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

import { validatePlugin } from "../src/plugins/loader.ts";
import { buildHost } from "../src/plugins/host.ts";

const SRC = join(import.meta.dir, "..", "src");

async function readSource(rel: string): Promise<string> {
  return await Bun.file(join(SRC, rel)).text();
}

function writePlugin(dir: string, manifest: Record<string, unknown>, code: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "xr-plugin.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "security-probe",
        name: "Security Probe",
        version: "1.0.0",
        author: "xr-tests",
        description: "Security test fixture",
        type: "tool",
        entrypoint: "index.ts",
        permissions: [],
        ...manifest,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "index.ts"), code);
}

describe("XR Security Guardrails", () => {
  // ── Vector 1: Plugin sandbox ────────────────────────────────────────────

  describe("Plugin sandbox (RCE vector #1)", () => {
    const fixturesDir = join(import.meta.dir, "test-plugins");

    beforeAll(() => {
      mkdirSync(fixturesDir, { recursive: true });
    });

    afterAll(() => {
      rmSync(fixturesDir, { recursive: true, force: true });
    });

    it("static scan rejects require('node:fs')", () => {
      const dir = join(fixturesDir, "require-fs");
      writePlugin(
        dir,
        { id: "probe-require-fs" },
        `const fs = require("node:fs");
         export default function activate() {};`,
      );
      const result = validatePlugin(dir);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("disallowed import"))).toBe(true);
    });

    it("static scan rejects direct process.env access", () => {
      const dir = join(fixturesDir, "process-env");
      writePlugin(
        dir,
        { id: "probe-process-env" },
        `export default function activate() { return process.env.SECRET; }`,
      );
      const result = validatePlugin(dir);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("process.env"))).toBe(true);
    });

    it("static scan rejects eval()", () => {
      const dir = join(fixturesDir, "eval-call");
      writePlugin(
        dir,
        { id: "probe-eval" },
        `export default function activate() { eval("1+1"); }`,
      );
      const result = validatePlugin(dir);
      expect(result.ok).toBe(false);
    });

    it("accepts a genuinely safe plugin", () => {
      const dir = join(fixturesDir, "safe-plugin");
      writePlugin(
        dir,
        { id: "probe-safe" },
        `export async function activate(host: any) {
           return {
             tools: [{
               name: "safe-tool",
               description: "A safe tool",
               requiresApproval: false,
               run: async () => ({ ok: true, output: "safe" }),
             }],
           };
         }`,
      );
      const result = validatePlugin(dir);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── Vector 2: Browser sandbox ───────────────────────────────────────────

  describe("Browser control hardening (RCE vector #2)", () => {
    it("strips --no-sandbox from production launch args", async () => {
      const browserSource = await readSource("control/browser.ts");
      // Defense: production path filters the sandbox breakers out of args.
      expect(browserSource.includes('args.filter((a) => a !== "--no-sandbox"')).toBe(true);
    });

    it("blocks running as root with the sandbox disabled unless multi-flag acknowledged", async () => {
      const browserSource = await readSource("control/browser.ts");
      expect(browserSource.includes("XR_BROWSER_ALLOW_ROOT")).toBe(true);
      expect(browserSource.includes("XR_BROWSER_DISABLE_SANDBOX")).toBe(true);
      expect(browserSource.includes("XR_BROWSER_UNSAFE_ACK")).toBe(true);
      expect(browserSource.includes("Running as root with --no-sandbox is blocked")).toBe(true);
    });

    it("validates navigation URLs to http/https only", async () => {
      const browserSource = await readSource("control/browser.ts");
      expect(browserSource.includes("only http/https allowed")).toBe(true);
      expect(browserSource.includes("unsupported protocol")).toBe(true);
    });

    it("rejects invalid goto actions without needing a browser", async () => {
      // Behavioral check: validation runs before any browser launch, so this
      // passes in headless CI where no Chromium binary exists.
      const { executeBrowserAction } = await import("../src/control/browser.ts");
      const result = await executeBrowserAction({ type: "browser", op: "goto" } as any);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("goto needs value");
    });
  });

  // ── Vector 3: MCP environment leakage ───────────────────────────────────

  describe("MCP environment isolation (secret-leak vector #3)", () => {
    it("builds an allow-listed environment instead of inheriting process.env", async () => {
      const mcpSource = await readSource("mcp/client.ts");
      expect(mcpSource.includes("createAllowedEnv")).toBe(true);
      expect(mcpSource.includes("SAFE_ENV_EXACT")).toBe(true);
      // The anti-pattern must not exist anywhere:
      expect(mcpSource.includes("...process.env")).toBe(false);
    });

    it("spawns child processes without a shell", async () => {
      const mcpSource = await readSource("mcp/client.ts");
      expect(mcpSource.includes("shell: false")).toBe(true);
    });

    it("validates tool names before invocation", async () => {
      const mcpSource = await readSource("mcp/client.ts");
      expect(mcpSource.includes("validateToolName")).toBe(true);
      expect(mcpSource.includes("/^[a-zA-Z0-9_.-]{1,120}$/")).toBe(true);
    });

    it("sanitizes payloads against prototype pollution", async () => {
      const mcpSource = await readSource("mcp/client.ts");
      expect(mcpSource.includes("sanitizeObject")).toBe(true);
      expect(mcpSource.includes("__proto__")).toBe(true);
    });
  });

  // ── Cross-cutting: host capability gating smoke checks ──────────────────

  describe("Host capability gating (smoke)", () => {
    const mockStore = { audit: () => "hash" } as any;
    const mockConfig = {
      security: { egressAllowlist: [] },
      defaults: { provider: "test", model: "test" },
    } as any;

    it("grants no capabilities when nothing is granted", () => {
      const host = buildHost([], {
        store: mockStore,
        config: mockConfig,
        cwd: "/tmp",
        pluginDir: "/tmp/plugin",
      });
      expect(host.fs).toBeUndefined();
      expect(host.net).toBeUndefined();
      expect(host.memory).toBeUndefined();
      expect(host.provider).toBeUndefined();
      expect(host.secrets).toBeUndefined();
      expect(host.mcp).toBeUndefined();
    });

    it("rejects path traversal through the fs capability", () => {
      const host = buildHost(["fs:read", "fs:write"], {
        store: mockStore,
        config: mockConfig,
        cwd: "/tmp",
        pluginDir: "/tmp/plugin",
      });
      expect(() => host.fs?.path("../../../etc/passwd")).toThrow("path escapes plugin data directory");
      expect(() => host.fs?.path("/absolute/path")).toThrow("absolute paths not allowed");
    });
  });
});
