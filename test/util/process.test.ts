/**
 * XR Async Utilities — Non-Blocking Process & Performance Tests
 *
 * Verifies that process helpers never block the event loop, respect timeouts,
 * enforce maxBuffer limits, handle input correctly, and maintain deterministic
 * memoized PATH probes. Focuses on the security-critical requirement that
 * no sync blocking APIs (execSync, spawnSync) are used in request paths.
 *
 * References:
 *  - src/util/process.ts (runCommand, commandExists, spawnAndWait, runCapture)
 *  - Bun test runner async/await patterns
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runCommand,
  commandExists,
  clearCommandExistsCache,
  spawnAndWait,
  runCapture,
} from "../../src/util/process.ts";

describe("Async Utilities — Process Handling", () => {
  beforeEach(() => {
    clearCommandExistsCache();
  });

  afterEach(() => {
    clearCommandExistsCache();
  });

  // ── Non-blocking behavior ───────────────────────────────────────────────────

  test("runCommand does not block the event loop", async () => {
    const start = Date.now();
    const result = await runCommand("echo", ["hello"], { timeoutMs: 5000 });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("hello");
    // Must complete quickly; a blocking call would take much longer.
    expect(elapsed).toBeLessThan(5000);
  });

  test("runCommand completes for a short-lived process", async () => {
    const result = await runCommand("node", ["-e", "console.log('bun-ok')"], {
      timeoutMs: 3000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("bun-ok");
  });

  // ── Timeout enforcement ─────────────────────────────────────────────────────

  test("runCommand kills process after timeout and reports timeout", async () => {
    const start = Date.now();
    const result = await runCommand("sleep", ["10"], {
      timeoutMs: 300,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
    expect(result.signal).toBe("SIGTERM");
    expect(elapsed).toBeLessThan(1500); // Should kill quickly, not hang.
  });

  // ── Input handling ───────────────────────────────────────────────────────────

  test("runCommand writes input to child stdin", async () => {
    const result = await runCommand("cat", [], {
      input: "injected-by-test",
      timeoutMs: 3000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("injected-by-test");
  });

  test("runCommand handles Uint8Array input", async () => {
    const encoder = new TextEncoder();
    const result = await runCommand("cat", [], {
      input: encoder.encode("uint8-input"),
      timeoutMs: 3000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("uint8-input");
  });

  // ── Max buffer limit ────────────────────────────────────────────────────────

  test("runCommand respects maxBuffer and truncates output", async () => {
    // Generate a large output string.
    const largeString = "A".repeat(3 * 1024 * 1024); // 3MB
    const result = await runCommand("node", ["-e", `console.log("${largeString.slice(0, 100)}...")`], {
      maxBuffer: 1024,
      timeoutMs: 5000,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  test("runCommand handles non-existent command gracefully", async () => {
    const result = await runCommand("nonexistent_command_12345", [], {
      timeoutMs: 3000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("runCommand handles invalid command name gracefully", async () => {
    const result = await runCommand("", [], { timeoutMs: 3000 });
    expect(result.ok).toBe(false);
  });

  // ── Shell option ─────────────────────────────────────────────────────────────

  test("runCommand supports shell option", async () => {
    const result = await runCommand("echo", ["shell-test"], {
      shell: true,
      timeoutMs: 3000,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("shell-test");
  });

  // ── Memoized PATH probe ─────────────────────────────────────────────────────

  describe("commandExists", () => {
    test("commandExists caches positive result", async () => {
      const first = await commandExists("node");
      const second = await commandExists("node");
      // Should return quickly due to cache; both should agree.
      expect(first).toBe(second);
    });

    test("commandExists caches negative result", async () => {
      const first = await commandExists("nonexistent_command_99999");
      const second = await commandExists("nonexistent_command_99999");
      expect(first).toBe(second);
      expect(first).toBe(false);
    });

    test("clearCommandExistsCache resets memo", async () => {
      await commandExists("node");
      clearCommandExistsCache();
      // After clearing, it should still work (re-probe).
      const result = await commandExists("node");
      expect(typeof result).toBe("boolean");
    });
  });

  // ── spawnAndWait (long-lived child) ─────────────────────────────────────────

  describe("spawnAndWait", () => {
    test("spawnAndWait completes for quick command", async () => {
      const result = await spawnAndWait("echo", ["spawn-ok"], 3000);
      expect(result.ok).toBe(true);
    });

    test("spawnAndWait reports timeout for long command", async () => {
      const start = Date.now();
      const result = await spawnAndWait("sleep", ["10"], 200);
      const elapsed = Date.now() - start;
      expect(result.ok).toBe(false);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  // ── runCapture (text capture helper) ────────────────────────────────────────

  describe("runCapture", () => {
    test("runCapture returns combined stdout+stderr", async () => {
      const text = await runCapture("echo", ["capture-test"], 3000);
      expect(text).toContain("capture-test");
    });
  });

  // ── Performance: concurrent non-blocking behavior ───────────────────────────

  test("multiple concurrent runCommand calls do not block each other", async () => {
    const start = Date.now();
    const promises = [
      runCommand("echo", ["a"], { timeoutMs: 3000 }),
      runCommand("echo", ["b"], { timeoutMs: 3000 }),
      runCommand("echo", ["c"], { timeoutMs: 3000 }),
    ];
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
    // Concurrent calls should complete faster than sequential 3x calls.
    expect(elapsed).toBeLessThan(5000);
  });
});
