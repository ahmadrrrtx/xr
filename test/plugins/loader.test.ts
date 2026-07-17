/**
 * XR Plugin Loader — Security Isolation & Integrity Tests
 *
 * Verifies that the hardened plugin loader preserves VM isolation,
 * detects malicious static patterns, enforces hash pinning, and rejects
 * bypass attempts (path traversal, symlink injection, oversized payloads,
 * incompatible ABI, and untrusted modifications).
 *
 * References:
 *  - loader.ts VM isolation architecture (codeGeneration: false, no process/Bun)
 *  - manifest.ts strict permission policy and containment checks
 *  - Bun test runner (describe/test/expect/beforeEach/afterEach)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validatePlugin,
  validatePluginAsync,
  hashEntrypoint,
  hashEntrypointAsync,
  hashPluginTree,
  hashPluginTreeAsync,
  loadPlugin,
} from "../../src/plugins/loader.ts";
import { loadConfig } from "../../src/config/config.ts";
import { Store } from "../../src/state/db.ts";

// Ensure XR_HOME exists before any config/store initialization.
const TEST_TMP = mkdtempSync(join(tmpdir(), "xr-loader-test-"));
process.env.XR_HOME = join(TEST_TMP, "home");
mkdirSync(process.env.XR_HOME, { recursive: true });

function safeManifest(dir: string, overrides: Record<string, unknown> = {}): string {
  const manifest = {
    schemaVersion: 1,
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    type: "tool" as const,
    entrypoint: "index.ts",
    permissions: [],
    compatibility: "*",
    apiVersion: 1,
    ...overrides,
  };
  return JSON.stringify(manifest, null, 2);
}

function safePluginDir(parent: string, id: string, overrides?: { body?: string; manifest?: Record<string, unknown> }): string {
  const dir = mkdtempSync(join(parent, `plugin-${id}-`));
  const manifestOverrides = overrides?.manifest ?? {};
  writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, manifestOverrides));
  const body =
    overrides?.body ??
    `export async function activate(host) {
       return {
         commands: [{ name: "hello", run() { host.log("hello"); } }],
         tools: [{ name: "echo", description: "echo", requiresApproval: false, run(args) { return { ok: true, output: args.message || "" }; } }],
       };
     }
     export default activate;`;
  writeFileSync(join(dir, "index.ts"), body);
  return dir;
}

function isolationPluginDir(parent: string): string {
  const dir = mkdtempSync(join(parent, "plugin-isolation-"));
  writeFileSync(
    join(dir, "xr-plugin.json"),
    safeManifest(dir, { id: "isolation-test", permissions: [] }),
  );
  // This plugin attempts to access forbidden APIs inside its VM context.
  // The VM isolates it, so process and eval should be blocked or undefined.
  writeFileSync(
    join(dir, "index.ts"),
    `export async function activate(host) {
       let leaked = "none";
       try {
         // process should be undefined in sandbox
         const p = (globalThis as any).process;
         if (p && p.env) {
           leaked = p.env.API_KEY || "undefined-env";
         } else {
           leaked = "no-process";
         }
       } catch (e: any) {
         leaked = "blocked:" + (e.message || String(e));
       }
       return {
         tools: [
           {
             name: "isolation-test",
             description: "Isolation verification",
             requiresApproval: false,
             run() {
               return { ok: true, output: leaked };
             },
           },
         ],
       };
     }
     export default activate;`,
  );
  return dir;
}

describe("Plugin Loader — Security Isolation", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(TEST_TMP, `work-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failures */
    }
  });

  // ── Static scan: disallowed imports ───────────────────────────────────────

  test("validatePlugin detects disallowed import: node:child_process", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-import-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-cp" }));
    writeFileSync(join(dir, "index.ts"), `import { spawn } from "node:child_process"; export default function() {};`);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("disallowed import"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin detects disallowed import: node:fs", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-fs-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-fs" }));
    writeFileSync(join(dir, "index.ts"), `const fs = require("node:fs"); export default function() {};`);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("disallowed import"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Static scan: dangerous patterns ───────────────────────────────────────

  test("validatePlugin detects direct process.env access", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-env-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-env" }));
    writeFileSync(join(dir, "index.ts"), `export default function() { console.log(process.env.SECRET); }`);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("process.env"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin detects eval() pattern", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-eval-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-eval" }));
    writeFileSync(join(dir, "index.ts"), `export default function() { eval("1+1"); }`);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("eval") || e.includes("dynamic"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin detects Bun.spawn access pattern", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-bun-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-bun" }));
    writeFileSync(join(dir, "index.ts"), `export default function() { Bun.spawn(["echo"]); }`);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("Bun") || e.includes("direct Bun host"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Path containment & traversal ────────────────────────────────────────────

  test("validatePlugin blocks entrypoint escaping plugin root", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-traversal-"));
    writeFileSync(
      join(dir, "xr-plugin.json"),
      safeManifest(dir, { id: "bad-trav", entrypoint: "../escape.ts" }),
    );
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("escapes") || e.includes("entrypoint"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin blocks absolute entrypoint paths", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-abs-"));
    writeFileSync(
      join(dir, "xr-plugin.json"),
      safeManifest(dir, { id: "bad-abs", entrypoint: "/etc/passwd" }),
    );
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Symlink defense (defense-in-depth) ─────────────────────────────────────

  test("validatePlugin detects symlinks in plugin package", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-symlink-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-sym" }));
    writeFileSync(join(dir, "index.ts"), `export default function() {};`);
    try {
      // Create a symlink inside the plugin directory (may fail in some CI environments).
      const linkPath = join(dir, "symlink-test");
      // Using a relative symlink to a file inside the plugin.
      try {
        require("node:fs").symlinkSync("index.ts", linkPath);
      } catch {
        // If symlinks are not supported, skip this assertion but keep the test structure.
        return;
      }
      const result = validatePlugin(dir);
      expect(result.errors.some((e) => e.includes("symlink"))).toBe(true);
      rmSync(linkPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Size limits ─────────────────────────────────────────────────────────────

  test("validatePlugin detects oversized plugin package (>10MB)", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-size-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-size" }));
    // Create a file just above the 10MB limit (10 * 1024 * 1024).
    const largeFile = join(dir, "large.bin");
    const buf = Buffer.alloc(11 * 1024 * 1024, "x");
    writeFileSync(largeFile, buf);
    const result = validatePlugin(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("too large"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin detects too many files (>500)", () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-count-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-count" }));
    // Create 501 small files to exceed the file count limit.
    for (let i = 0; i < 501; i++) {
      writeFileSync(join(dir, `file-${i}.txt`), `content ${i}`);
    }
    const result = validatePlugin(dir);
    expect(result.errors.some((e) => e.includes("too many files"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Hash integrity ──────────────────────────────────────────────────────────

  test("hashEntrypoint detects file modification", () => {
    const dir = safePluginDir(TEST_TMP, "hash-test", { manifest: { id: "hash-test" } });
    const manifest = JSON.parse(readFileSync(join(dir, "xr-plugin.json"), "utf8"));
    const firstHash = hashEntrypoint(dir, manifest);
    expect(typeof firstHash).toBe("string");
    expect(firstHash!.length).toBe(64); // sha256 hex length

    appendFileSync(join(dir, "index.ts"), "\n// tampered\n");
    const secondHash = hashEntrypoint(dir, manifest);
    expect(secondHash).not.toBe(firstHash);
    rmSync(dir, { recursive: true, force: true });
  });

  test("hashPluginTree detects tree modification", () => {
    const dir = safePluginDir(TEST_TMP, "tree-test", { manifest: { id: "tree-test" } });
    const firstHash = hashPluginTree(dir);
    expect(typeof firstHash).toBe("string");

    writeFileSync(join(dir, "extra.txt"), "new file content");
    const secondHash = hashPluginTree(dir);
    expect(secondHash).not.toBe(firstHash);
    rmSync(dir, { recursive: true, force: true });
  });

  test("hashEntrypointAsync produces consistent result", async () => {
    const dir = safePluginDir(TEST_TMP, "async-hash", { manifest: { id: "async-hash" } });
    const manifest = JSON.parse(readFileSync(join(dir, "xr-plugin.json"), "utf8"));
    const firstHash = await hashEntrypointAsync(dir, manifest);
    const secondHash = await hashEntrypointAsync(dir, manifest);
    expect(firstHash).toBe(secondHash);
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Load lifecycle — security guarantees ───────────────────────────────────

  test("loadPlugin: valid plugin loads and activates", async () => {
    const dir = safePluginDir(TEST_TMP, "valid-load", { manifest: { id: "valid-load" } });
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-valid.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("valid-load");
      expect(result.contributions).toBeDefined();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPlugin: rejects plugin with wrong entry hash (untrusted)", async () => {
    const dir = safePluginDir(TEST_TMP, "untrusted", { manifest: { id: "untrusted" } });
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-untrusted.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
      expectedHash: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(result.ok).toBe(false);
    expect((result as any).kind).toBe("untrusted");
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPlugin: rejects plugin with wrong tree hash (untrusted)", async () => {
    const dir = safePluginDir(TEST_TMP, "untrusted-tree", { manifest: { id: "untrusted-tree" } });
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-untrusted-tree.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
      expectedTreeHash: "badtreeroot",
    });
    expect(result.ok).toBe(false);
    expect((result as any).kind).toBe("untrusted");
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPlugin: rejects incompatible plugin (fail-fast)", async () => {
    const dir = safePluginDir(TEST_TMP, "incompatible", {
      manifest: { id: "incompatible", compatibility: ">=99.0.0" },
    });
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-incompatible.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
    });
    expect(result.ok).toBe(false);
    expect((result as any).kind).toBe("incompatible");
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPlugin: plugin VM isolates process/eval access", async () => {
    const dir = isolationPluginDir(TEST_TMP);
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-isolation.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const isolationTool = result.contributions.tools?.find(
        (t: any) => t.name === "isolation-test",
      );
      expect(isolationTool).toBeDefined();
      // The plugin runs inside VM isolation. If process were accessible,
      // the output would contain secrets. We verify the output shows isolation.
      const runResult = await isolationTool!.run({});
      expect(runResult.ok).toBe(true);
      // The plugin should report that process is blocked or missing.
      expect(
        runResult.output.includes("no-process") ||
          runResult.output.includes("blocked"),
      ).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadPlugin: contributions sanitized (invalid names removed)", async () => {
    const dir = mkdtempSync(join(TEST_TMP, "bad-contrib-"));
    writeFileSync(
      join(dir, "xr-plugin.json"),
      safeManifest(dir, { id: "bad-contrib" }),
    );
    // Plugin that tries to inject malicious tool/command names.
    writeFileSync(
      join(dir, "index.ts"),
      `export async function activate() {
         return {
           commands: [
             { name: "valid-cmd", run() {} },
             { name: "invalid!!!", run() {} },
             { name: "", run() {} },
           ],
           tools: [
             { name: "good", description: "good", run() { return { ok: true, output: "" }; } },
             { name: "bad<name>", description: "bad", run() { return { ok: true, output: "" }; } },
           ],
         };
       }
       export default activate;`,
    );
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, "db-bad-contrib.db")),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const commandNames = result.contributions.commands?.map((c: any) => c.name) ?? [];
      expect(commandNames).toContain("valid-cmd");
      expect(commandNames).not.toContain("invalid!!!");
      expect(commandNames).not.toContain("");

      const toolNames = result.contributions.tools?.map((t: any) => t.name) ?? [];
      expect(toolNames).toContain("good");
      expect(toolNames).not.toContain("bad<name>");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Async validation consistency ────────────────────────────────────────────

  test("validatePluginAsync produces same errors as validatePlugin for invalid plugin", async () => {
    const dir = mkdtempSync(join(TEST_TMP, "async-compare-"));
    writeFileSync(
      join(dir, "xr-plugin.json"),
      safeManifest(dir, { id: "async-comp", entrypoint: "missing.ts" }),
    );
    const syncResult = validatePlugin(dir);
    const asyncResult = await validatePluginAsync(dir);
    expect(asyncResult.ok).toBe(syncResult.ok);
    expect(asyncResult.errors.sort()).toEqual(syncResult.errors.sort());
    rmSync(dir, { recursive: true, force: true });
  });

  test("describePlugin returns record with correct security status", () => {
    const dir = safePluginDir(TEST_TMP, "describe-test", { manifest: { id: "describe-test" } });
    const record = describePlugin(dir, false, ["fs:read"], Date.now(), Date.now());
    expect(record).not.toBeNull();
    expect(record!.id).toBe("describe-test");
    expect(record!.enabled).toBe(false);
    expect(record!.status.kind).toBe("disabled");
    rmSync(dir, { recursive: true, force: true });
  });
});
