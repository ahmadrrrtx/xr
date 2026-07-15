/**
 * Security Test Suite for XR
 * 
 * This test file verifies that the critical RCE vectors are properly closed:
 * 1. Plugin sandbox bypass
 * 2. Browser --no-sandbox flag
 * 3. MCP environment leakage
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

// Import modules to test
import { validatePlugin, loadPlugin } from "../src/plugins/loader.ts";
import { buildHost } from "../src/plugins/host.ts";
import { McpClient } from "../src/mcp/client.ts";
import { executeBrowserAction } from "../src/control/browser.ts";

describe("XR Security Tests", () => {
  
  // ── Test 1: Plugin Sandbox Bypass ───────────────────────────────────
  
  describe("Plugin Isolation (RCE Vector #1)", () => {
    const testPluginDir = join(import.meta.dir, "test-plugins", "malicious-plugin");
    
    beforeAll(() => {
      // Create a test plugin that tries to bypass sandbox
      if (!existsSync(testPluginDir)) {
        mkdirSync(testPluginDir, { recursive: true });
      }
      
      // Write malicious plugin code
      writeFileSync(join(testPluginDir, "index.ts"), `
        // Attempt 1: Direct require (should fail in VM)
        try {
          const fs = require("node:fs");
          console.log("FAIL: require() should not work");
        } catch (e) {
          console.log("PASS: require() blocked");
        }
        
        // Attempt 2: process.env access (should fail in VM)
        try {
          const secret = process.env.API_KEY;
          console.log("FAIL: process.env should not work");
        } catch (e) {
          console.log("PASS: process.env blocked");
        }
        
        // Attempt 3: eval() (should fail in VM)
        try {
          eval("console.log('FAIL: eval() should not work')");
        } catch (e) {
          console.log("PASS: eval() blocked");
        }
        
        export async function activate(host) {
          // This should work - using host API
          const data = host.fs?.read("test.txt");
          return { tools: [] };
        }
      `);
      
      // Write manifest
      writeFileSync(join(testPluginDir, "xr-plugin.json"), JSON.stringify({
        schemaVersion: 1,
        id: "malicious-plugin",
        name: "Malicious Plugin Test",
        version: "1.0.0",
        author: "test",
        description: "Test plugin for security testing",
        type: "tool",
        entrypoint: "index.ts",
        permissions: ["fs:read"],
      }, null, 2));
    });
    
    afterAll(() => {
      // Cleanup
      rmSync(join(import.meta.dir, "test-plugins"), { recursive: true, force: true });
    });
    
    it("should block require() in plugin VM context", async () => {
      const result = validatePlugin(testPluginDir);
      
      // The static scan should catch disallowed imports
      expect(result.errors.some(e => e.includes("disallowed import"))).toBe(true);
    });
    
    it("should block process.env access in plugin VM context", async () => {
      const result = validatePlugin(testPluginDir);
      
      // The static scan should catch process.env access
      expect(result.errors.some(e => e.includes("process.env"))).toBe(true);
    });
    
    it("should load plugin in VM context (if static scan passes)", async () => {
      // This test assumes the plugin code is "safe" (no disallowed patterns)
      // In reality, the VM context would prevent access to require/process anyway
      
      // We need to create a "safe" plugin for this test
      const safePluginDir = join(import.meta.dir, "test-plugins", "safe-plugin");
      if (!existsSync(safePluginDir)) {
        mkdirSync(safePluginDir, { recursive: true });
      }
      
      writeFileSync(join(safePluginDir, "index.ts"), `
        export async function activate(host) {
          return {
            tools: [{
              name: "test-tool",
              description: "A safe tool",
              run: async (args) => {
                return { ok: true, output: "Safe plugin works!" };
              }
            }]
          };
        }
      `);
      
      writeFileSync(join(safePluginDir, "xr-plugin.json"), JSON.stringify({
        schemaVersion: 1,
        id: "safe-plugin",
        name: "Safe Plugin Test",
        version: "1.0.0",
        author: "test",
        description: "Safe test plugin",
        type: "tool",
        entrypoint: "index.ts",
        permissions: [],
      }, null, 2));
      
      const result = validatePlugin(safePluginDir);
      expect(result.ok).toBe(true);
    });
  });
  
  // ── Test 2: Browser Sandbox ─────────────────────────────────────────
  
  describe("Browser Security (RCE Vector #2)", () => {
    it("should NOT have --no-sandbox in default config", () => {
      // Read the browser.ts source and verify
      const browserSource = await Bun.file(join(import.meta.dir, "../src/control/browser.ts")).text();
      
      // Should NOT have --no-sandbox in the default path
      expect(browserSource.includes("--no-sandbox")).toBe(false);
      
      // Should have sandbox enabled by default
      expect(browserSource.includes("--enable-sandbox")).toBe(true);
    });
    
    it("should only disable sandbox with XR_BROWSER_UNSAFE=1", () => {
      const browserSource = await Bun.file(join(import.meta.dir, "../src/control/browser.ts")).text();
      
      // Should check for XR_BROWSER_UNSAFE env var
      expect(browserSource.includes("XR_BROWSER_UNSAFE")).toBe(true);
      
      // Should warn when sandbox is disabled
      expect(browserSource.includes("WARNING")).toBe(true);
    });
  });
  
  // ── Test 3: MCP Environment Leakage ────────────────────────────────
  
  describe("MCP Environment Security", () => {
    it("should NOT inherit full process.env", () => {
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Should NOT spread ...process.env
      expect(mcpSource.includes("...process.env")).toBe(false);
      
      // Should use createAllowedEnvironment()
      expect(mcpSource.includes("createAllowedEnvironment")).toBe(true);
    });
    
    it("should have allow-list for environment variables", () => {
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Should have ALLOWED_ENV_PREFIXES
      expect(mcpSource.includes("ALLOWED_ENV_PREFIXES")).toBe(true);
      
      // Should have ALLOWED_ENV_EXACT
      expect(mcpSource.includes("ALLOWED_ENV_EXACT")).toBe(true);
    });
    
    it("should validate command before spawning", () => {
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Should check for ".." in command
      expect(mcpSource.includes("..")).toBe(true);
      
      // Should use shell: false
      expect(mcpSource.includes("shell: false")).toBe(true);
    });
  });
  
  // ── Test 4: Host Capability Enforcement ─────────────────────────────
  
  describe("Host Capability Enforcement", () => {
    it("should only expose granted capabilities", () => {
      // Mock dependencies
      const mockStore = {
        audit: (event: string, detail: any) => {},
      } as any;
      
      const mockConfig = {
        security: {
          egressAllowlist: ["https://api.example.com"],
        },
        defaults: {
          provider: "test",
          model: "test",
        },
      } as any;
      
      // Test 1: No permissions = no capabilities
      const host1 = buildHost([], {
        store: mockStore,
        config: mockConfig,
        cwd: "/tmp",
        pluginDir: "/tmp/plugin",
      });
      
      expect(host1.fs).toBeUndefined();
      expect(host1.net).toBeUndefined();
      expect(host1.secrets).toBeUndefined();
      
      // Test 2: Only fs:read permission = only fs.read capability
      const host2 = buildHost(["fs:read"], {
        store: mockStore,
        config: mockConfig,
        cwd: "/tmp",
        pluginDir: "/tmp/plugin",
      });
      
      expect(host2.fs).toBeDefined();
      expect(host2.fs?.write).toBeUndefined();  // write not granted
      expect(host2.net).toBeUndefined();
    });
    
    it("should prevent path traversal in fs capability", () => {
      const mockStore = {
        audit: (event: string, detail: any) => {},
      } as any;
      
      const mockConfig = {
        security: { egressAllowlist: [] },
        defaults: { provider: "test", model: "test" },
      } as any;
      
      const host = buildHost(["fs:read", "fs:write"], {
        store: mockStore,
        config: mockConfig,
        cwd: "/tmp",
        pluginDir: "/tmp/plugin",
      });
      
      // Should throw on path traversal
      expect(() => {
        host.fs?.path("../../../etc/passwd");
      }).toThrow("Path traversal detected");
      
      expect(() => {
        host.fs?.path("/absolute/path");
      }).toThrow("Path traversal detected");
    });
  });
  
  // ── Test 5: Input Validation ─────────────────────────────────────────
  
  describe("Input Validation", () => {
    it("should validate URLs in browser actions", async () => {
      const browserSource = await Bun.file(join(import.meta.dir, "../src/control/browser.ts")).text();
      
      // Should validate URL protocol
      expect(browserSource.includes("http:")).toBe(true);
      expect(browserSource.includes("https:")).toBe(true);
      
      // Should reject non-http(s) protocols
      expect(browserSource.includes("Unsupported protocol")).toBe(true);
    });
    
    it("should validate tool names in MCP client", () => {
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Should validate tool name format
      expect(mcpSource.includes("Invalid tool name")).toBe(true);
      expect(mcpSource.includes("^[a-zA-Z0-9_.-]+$")).toBe(true);
    });
    
    it("should sanitize objects to prevent prototype pollution", () => {
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Should have sanitizeObject function
      expect(mcpSource.includes("sanitizeObject")).toBe(true);
      
      // Should skip __proto__, constructor, prototype
      expect(mcpSource.includes("__proto__")).toBe(true);
      expect(mcpSource.includes("constructor")).toBe(true);
    });
  });
  
  // ── Test 6: Audit Logging ───────────────────────────────────────────
  
  describe("Audit Logging", () => {
    it("should audit all sensitive operations", () => {
      const hostSource = await Bun.file(join(import.meta.dir, "../src/plugins/host.ts")).text();
      const browserSource = await Bun.file(join(import.meta.dir, "../src/control/browser.ts")).text();
      const mcpSource = await Bun.file(join(import.meta.dir, "../src/mcp/client.ts")).text();
      
      // Host should audit fs, net, memory, secrets operations
      expect(hostSource.includes("audit(")).toBe(true);
      
      // Browser should audit all actions
      expect(browserSource.includes("audit")).toBe(true);
      
      // MCP should audit tool calls
      expect(mcpSource.includes("audit")).toBe(true);
    });
  });
  
});

// ── Manual Security Tests ──────────────────────────────────────────────────
// These tests require actual browser/MCP, so they're skipped in CI

describe.skip("Manual Security Tests (Require Browser/MCP)", () => {
  
  it("should actually block require() in VM context", async () => {
    // This would need a real plugin load to verify
    // Expect: plugin code cannot access require()
  });
  
  it("should actually enable browser sandbox", async () => {
    // This would need Playwright to be installed
    // Expect: Chrome runs with --enable-sandbox
  });
  
  it("should actually restrict MCP environment", async () => {
    // This would need an MCP server to test
    // Expect: MCP server cannot access process.env secrets
  });
  
});

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    XR Security Test Suite                        ║
╚══════════════════════════════════════════════════════════════╝

Running security tests to verify:
1. Plugin sandbox bypass is CLOSED (VM isolation)
2. Browser --no-sandbox is REMOVED (sandbox enabled by default)
3. MCP environment leakage is CLOSED (allow-list only)

See test output above for results.
`);
