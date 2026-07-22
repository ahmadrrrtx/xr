import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const homes: string[] = [];

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

async function runDoctor(env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "xr-doctor-test-"));
  homes.push(home);
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "doctor", "--json"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XR_HOME: home, ...env },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code, json: JSON.parse(stdout) };
}

describe("xr doctor --json baseline contract", () => {
  test("emits schema version, version, environment, workspace, config, summary, and checks", async () => {
    const result = await runDoctor();
    expect(result.code).toBe(0);
    expect(result.json.schemaVersion).toBe(1);
    expect(result.json.version.version).toBe("3.1.6");
    expect(result.json.environment.bun).toBeString();
    expect(result.json.workspace.dbPath).toBeString();
    expect(result.json.config.secrets).toBeObject();
    expect(result.json.summary.ok).toBe(true);
    expect(Array.isArray(result.json.checks)).toBe(true);
    expect(result.json.checks.some((c: any) => c.id === "audit")).toBe(true);
  });

  test("does not leak configured provider secret values", async () => {
    const secret = "sk-phase0-do-not-print";
    const result = await runDoctor({ OPENAI_API_KEY: secret });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.json.config.secrets.OPENAI_API_KEY).toBe("set");
  });
});
