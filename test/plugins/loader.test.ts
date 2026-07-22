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
  describePlugin,
} from "../../src/plugins/loader.ts";
import { loadConfig } from "../../src/config/config.ts";
import { Store } from "../../src/state/workspace-store.ts";

// ── Runtime guard: bun <1.3 cannot execute the VM sandbox ───────────────────
// bun 1.2.x's node:vm implementation segfaults (SIGILL, exit 132) when the
// plugin sandbox runs — the panic kills the ENTIRE `bun test` process, hiding
// every other file's result (this is what took CI down). Fixed in bun ≥1.3,
// which is also the repo's pinned toolchain (packageManager: bun@1.3.14).
// On an old local bun, VM-executing tests are SKIPPED so the run stays
// informative; static-analysis tests (validatePlugin / hashing) still run.
const VM_RUNTIME_SAFE = (() => {
  const parts = (typeof Bun !== "undefined" && Bun.version ? Bun.version : "0.0.0")
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
  const [maj, min] = [parts[0] ?? 0, parts[1] ?? 0];
  return maj > 1 || (maj === 1 && min >= 3);
})();
const vmTest = (VM_RUNTIME_SAFE ? test : test.skip) as typeof test;

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
    try {
      writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "bad-count" }));
      // Create 501 small files to exceed the file count limit. This can be
      // slower on Windows antivirus-scanned temp directories, so the test has
      // an explicit timeout below.
      for (let i = 0; i < 501; i++) {
        writeFileSync(join(dir, `file-${i}.txt`), `content ${i}`);
      }
      const result = validatePlugin(dir);
      expect(result.errors.some((e) => e.includes("too many files"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

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

  vmTest("loadPlugin: valid plugin loads and activates", async () => {
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

  vmTest("loadPlugin: rejects plugin with wrong entry hash (untrusted)", async () => {
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

  vmTest("loadPlugin: rejects plugin with wrong tree hash (untrusted)", async () => {
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

  vmTest("loadPlugin: rejects incompatible plugin (fail-fast)", async () => {
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

  vmTest("loadPlugin: plugin VM isolates process/eval access", async () => {
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

  vmTest("loadPlugin: contributions sanitized (invalid names removed)", async () => {
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

/**
 * 0.4 Plugin Sandbox Hardening — RUNTIME escape suppression.
 *
 * The tests above mostly exercise the static scan. The tests below bypass
 * the static scan deliberately (computed expressions the regexes cannot
 * match) to prove the VM runtime itself is the primary security boundary:
 * blocked globals, blocked constructor-chain escapes, frozen prototypes,
 * and a require() that only resolves relative files inside the plugin root.
 *
 * Convention: each probe plugin reports an `outcome` string through a tool
 * run. "escaped"/"polluted"/"leaked" would mean the sandbox FAILED.
 */
describe("Plugin Loader — 0.4 VM Runtime Hardening", () => {
  /** Writes a probe plugin whose activate() measures one sandbox property. */
  function probePluginDir(parent: string, id: string, probeBody: string): string {
    const dir = mkdtempSync(join(parent, `probe-${id}-`));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id }));
    writeFileSync(
      join(dir, "index.ts"),
      `export async function activate(host) {
         let outcome = "untested";
         ${probeBody}
         return {
           tools: [{
             name: "probe",
             description: "sandbox probe",
             requiresApproval: false,
             run() { return { ok: true, output: outcome }; },
           }],
         };
       }
       export default activate;`,
    );
    return dir;
  }

  async function runProbe(dir: string): Promise<string> {
    const result = await loadPlugin(dir, {
      store: new Store(join(TEST_TMP, `db-probe-${Math.random().toString(36).slice(2)}.db`)),
      config: loadConfig().config,
      cwd: dir,
      granted: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`probe plugin failed to load: ${(result as any).reason}`);
    const tool = result.contributions.tools?.find((t: any) => t.name === "probe");
    expect(tool).toBeDefined();
    const out = await tool!.run({});
    expect(out.ok).toBe(true);
    return String(out.output);
  }

  vmTest("constructor-chain escape ({}).constructor.constructor is neutralized", async () => {
    const dir = probePluginDir(
      TEST_TMP,
      "ctor-chain",
      `try {
         const Fn = ({} as any).constructor.constructor;
         if (!Fn) {
           outcome = "blocked:no-constructor";
         } else {
           const proc = Fn("return (typeof process !== 'undefined') ? process : null")();
           outcome = proc && proc.env ? "escaped" : "blocked:no-process";
         }
       } catch (e: any) {
         outcome = "blocked:" + String(e && e.message ? e.message : e).slice(0, 80);
       }`,
    );
    const output = await runProbe(dir);
    expect(output).not.toBe("escaped");
    expect(output.startsWith("blocked")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  vmTest("prototype pollution via Object.prototype fails inside the sandbox", async () => {
    const dir = probePluginDir(
      TEST_TMP,
      "proto-pollution",
      `try {
         (Object.prototype as any).__xrPolluted = 1;
         outcome = ({} as any).__xrPolluted === 1 ? "polluted" : "clean";
       } catch (e: any) {
         // Frozen prototype → strict-mode TypeError or silent rejection are both safe.
         outcome = "clean";
       }`,
    );
    const output = await runProbe(dir);
    expect(output).toBe("clean");
    // Critical: the pollution must not leak into the HOST realm either.
    expect(({} as any).__xrPolluted).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  vmTest("require() with a computed (non-literal) specifier is blocked at runtime", async () => {
    const dir = probePluginDir(
      TEST_TMP,
      "computed-require",
      `try {
         // Bypasses the static scan (regexes only match literal specifiers).
         const mod = ["node", "fs"].join(":");
         const fs = (require as any)(mod);
         outcome = fs ? "escaped" : "blocked:empty";
       } catch (e: any) {
         outcome = "blocked:" + String(e && e.message ? e.message : e).slice(0, 80);
       }`,
    );
    const output = await runProbe(dir);
    expect(output).not.toBe("escaped");
    expect(output).toContain("blocked");
    expect(output).toContain("bare specifiers are not allowed");
    rmSync(dir, { recursive: true, force: true });
  });

  vmTest("globalThis access with a dynamic key cannot reach process", async () => {
    const dir = probePluginDir(
      TEST_TMP,
      "dynamic-global",
      `try {
         // Bypasses the static scan (literal globalThis["process"] is caught).
         const key = ["pro", "cess"].join("");
         const p = (globalThis as any)[key];
         outcome = p && p.env ? "leaked" : "undefined";
       } catch (e: any) {
         outcome = "undefined";
       }`,
    );
    const output = await runProbe(dir);
    expect(output).toBe("undefined");
    rmSync(dir, { recursive: true, force: true });
  });

  vmTest("plugin cannot overwrite or detect blocked globals on the sandbox", async () => {
    const dir = probePluginDir(
      TEST_TMP,
      "global-tamper",
      `try {
         (globalThis as any).process = { fake: true };
       } catch {}
       try {
         const still = (globalThis as any).process;
         const visible = ("pro" + "cess") in globalThis;
         outcome = still === undefined && !visible ? "sealed" : "tampered";
       } catch (e: any) {
         outcome = "sealed";
       }`,
    );
    const output = await runProbe(dir);
    expect(output).toBe("sealed");
    rmSync(dir, { recursive: true, force: true });
  });

  vmTest("relative multi-file requires work inside the sandbox (happy path)", async () => {
    const dir = mkdtempSync(join(TEST_TMP, "probe-multifile-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "multifile" }));
    writeFileSync(
      join(dir, "helper.ts"),
      `export const greeting = "xr-multifile-ok";
       export const data = { nested: true };`,
    );
    writeFileSync(
      join(dir, "index.ts"),
      `import { greeting, data } from "./helper.ts";
       export async function activate(host) {
         return {
           tools: [{
             name: "probe",
             description: "multifile probe",
             requiresApproval: false,
             run() { return { ok: true, output: greeting + (data.nested ? "+nested" : "") }; },
           }],
         };
       }
       export default activate;`,
    );
    const output = await (async () => {
      const result = await loadPlugin(dir, {
        store: new Store(join(TEST_TMP, "db-multifile.db")),
        config: loadConfig().config,
        cwd: dir,
        granted: [],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error((result as any).reason);
      const tool = result.contributions.tools?.find((t: any) => t.name === "probe");
      const out = await tool!.run({});
      return String(out.output);
    })();
    expect(output).toBe("xr-multifile-ok+nested");
    rmSync(dir, { recursive: true, force: true });
  });

  test("validatePlugin on a non-existent directory fails honestly", () => {
    const result = validatePlugin(join(TEST_TMP, "definitely-missing-plugin"));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not a directory"))).toBe(true);
  });

  test("hashPluginTree and hashPluginTreeAsync agree on the same tree", async () => {
    const dir = safePluginDir(TEST_TMP, "tree-consistency", { manifest: { id: "tree-consistency" } });
    const syncHash = hashPluginTree(dir);
    const asyncHash = await hashPluginTreeAsync(dir);
    expect(syncHash).toBeDefined();
    expect(asyncHash).toBe(syncHash);
    rmSync(dir, { recursive: true, force: true });
  });

  test("describePlugin marks a broken plugin as status 'error'", () => {
    const dir = mkdtempSync(join(TEST_TMP, "describe-broken-"));
    writeFileSync(join(dir, "xr-plugin.json"), safeManifest(dir, { id: "describe-broken", entrypoint: "missing.ts" }));
    const record = describePlugin(dir, true, [], Date.now(), Date.now());
    expect(record).not.toBeNull();
    expect(record!.status.kind).toBe("error");
    expect(record!.reason ?? "").toContain("entrypoint");
    rmSync(dir, { recursive: true, force: true });
  });
});
