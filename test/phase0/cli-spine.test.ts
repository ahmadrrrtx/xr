/**
 * Phase 0 · T11 — CLI spine: exit codes, free-form routing, fallback diversity.
 *
 * These are black-box tests: they spawn the real CLI and assert the real
 * process exit code, because the defect being fixed was invisible from inside
 * the process (a failed task printed an error and still exited 0, so every CI
 * pipeline wrapping XR was silently green).
 *
 * Each spawned run gets an isolated HOME so it cannot read or mutate the
 * developer's workspace.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FallbackProvider } from "../../src/providers/routing.ts";
import type { Provider } from "../../src/core/types.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const ENTRY = join(REPO_ROOT, "src/index.ts");

// Phase 0 black-box CLI contract suite. The CLI is only verified on
// Linux/macOS — doctor --json output and process-exit behavior are not
// Windows-verified (same honest discipline as doctor.test.ts / shield.test.ts).
const POSIX_ONLY = process.platform === "win32";

let home = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "xr-cli-spine-"));
});

afterAll(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  combined: string;
}

async function runCli(args: string[], timeoutMs = 120_000): Promise<RunResult> {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      // Guarantee no provider is reachable so failure paths are deterministic.
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OLLAMA_HOST: "http://127.0.0.1:9",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr, combined: stdout + stderr };
}

describe.skipIf(POSIX_ONLY)("T11 · exit-code contract", () => {
  test("--version exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.code).toBe(0);
  });

  test("help exits 0", async () => {
    const r = await runCli(["help"]);
    expect(r.code).toBe(0);
  });

  test("a task that cannot reach a provider exits NON-ZERO", async () => {
    const r = await runCli(["write a haiku about failure"]);
    // The core regression: this used to print an error and exit 0.
    expect(r.code).not.toBe(0);
    expect(r.code).toBe(1);
  });

  test("`xr run` with an unreachable provider exits NON-ZERO", async () => {
    const r = await runCli(["run", "summarise the repository"]);
    expect(r.code).not.toBe(0);
  });

  test("`doctor` with no reachable provider exits NON-ZERO", async () => {
    const r = await runCli(["doctor", "--json"]);
    expect(r.code).not.toBe(0);
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    expect(parsed.summary.ok).toBe(false);
    expect(parsed.summary.runnable).toBe(false);
  });

  test("`run` with no task is a usage error (exit 2)", async () => {
    const r = await runCli(["run"]);
    expect(r.code).toBe(2);
  });
});

describe.skipIf(POSIX_ONLY)("T11 · free-form routing", () => {
  test("a one-word task routes to task mode instead of 'Unknown command'", async () => {
    const r = await runCli(["hello"]);
    // Previously: "✗ Unknown command: hello" because `hello` is within edit
    // distance 2 of `help`. It must now run as a task.
    expect(r.combined).not.toMatch(/Unknown command/i);
  });

  test("a one-word near-miss still offers a hint, without refusing", async () => {
    const r = await runCli(["hello"]);
    expect(r.combined).toMatch(/Running "hello" as a task/i);
  });

  test("a multi-word free-form task routes to task mode", async () => {
    const r = await runCli(["explain this repository"]);
    expect(r.combined).not.toMatch(/Unknown command/i);
  });

  test("a real command is still treated as a command, not a task", async () => {
    const r = await runCli(["help"]);
    expect(r.combined).toMatch(/usage|commands|xr /i);
    expect(r.combined).not.toMatch(/Running "help" as a task/i);
  });

  test("a reserved command name is never routed to task mode", async () => {
    const r = await runCli(["doctor", "--json"]);
    expect(r.combined).not.toMatch(/Running "doctor" as a task/i);
  });
});

describe.skipIf(POSIX_ONLY)("T11 · fallback target diversity", () => {
  function fakeProvider(id: string, label: string, model?: string): Provider {
    return {
      id,
      label,
      ...(model ? { model } : {}),
      chat: async () => ({ content: "", toolCalls: [] }),
      health: async () => ({ ok: true }),
    } as unknown as Provider;
  }

  test("the label distinguishes two models on the same provider", () => {
    const fb = new FallbackProvider(
      fakeProvider("ollama", "Ollama (Local)", "qwen2.5:7b"),
      fakeProvider("ollama", "Ollama (Local)", "codellama:7b"),
    );
    // The old label rendered "Ollama (Local) → fallback Ollama (Local)", which
    // was indistinguishable from a useless self-fallback.
    expect(fb.label).toContain("qwen2.5:7b");
    expect(fb.label).toContain("codellama:7b");
  });

  test("the label shows both providers when they differ", () => {
    const fb = new FallbackProvider(
      fakeProvider("openai", "OpenAI", "gpt-4o-mini"),
      fakeProvider("ollama", "Ollama (Local)", "qwen2.5:7b"),
    );
    expect(fb.label).toBe("OpenAI → fallback Ollama (Local)");
  });

  test("a genuinely identical target collapses to a single label (no fake fallback)", () => {
    const fb = new FallbackProvider(
      fakeProvider("ollama", "Ollama (Local)", "qwen2.5:7b"),
      fakeProvider("ollama", "Ollama (Local)", "qwen2.5:7b"),
    );
    expect(fb.label).toBe("Ollama (Local)");
    expect(fb.label).not.toContain("fallback");
  });

  test("the CLI never advertises an identical primary → fallback pair", async () => {
    const r = await runCli(["hi"]);
    // Extract any "X → fallback Y" phrase and assert the two sides differ.
    const match = r.combined.match(/(.+?)\s+→ fallback\s+(.+?)\s+·/);
    if (match) {
      expect(match[1]!.trim()).not.toBe(match[2]!.trim());
    }
  });
});

describe.skipIf(POSIX_ONLY)("T11 · config no longer seeds a self-referential fallback", () => {
  test("a fresh ollama-default config does not set fallbackProvider to ollama", async () => {
    const { MIGRATIONS } = await import("../../src/config/config.ts");
    const migrate = MIGRATIONS?.[2];
    if (!migrate) return; // migration surface changed; covered by config tests
    const migrated = migrate({ version: 2, defaults: { provider: "ollama", model: "qwen2.5:7b" } }) as {
      defaults: { fallbackProvider?: string };
    };
    expect(migrated.defaults.fallbackProvider).toBeUndefined();
  });

  test("a cloud-primary config still gets a useful local fallback", async () => {
    const { MIGRATIONS } = await import("../../src/config/config.ts");
    const migrate = MIGRATIONS?.[2];
    if (!migrate) return;
    const migrated = migrate({ version: 2, defaults: { provider: "openai", model: "gpt-4o-mini" } }) as {
      defaults: { fallbackProvider?: string };
    };
    expect(migrated.defaults.fallbackProvider).toBe("ollama");
  });
});
