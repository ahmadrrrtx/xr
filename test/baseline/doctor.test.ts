import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const homes: string[] = [];

async function rmrfWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code ?? '') || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

afterAll(async () => {
  for (const home of homes) await rmrfWithRetry(home);
});

function parseDoctorJson(stdout: string, stderr: string): any {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `doctor --json did not emit parseable JSON on stdout: ${(error as Error).message}\n` +
        `stdout:\n${stdout.slice(0, 1200)}\n` +
        `stderr:\n${stderr.slice(0, 1200)}`,
    );
  }
}

async function runDoctor(env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "xr-doctor-test-"));
  homes.push(home);
  const proc = Bun.spawn([process.execPath, "run", "src/index.ts", "doctor", "--json"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XR_HOME: home, ...env },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code, json: parseDoctorJson(stdout, stderr) };
}

describe("xr doctor --json baseline contract", () => {
  if (process.platform === "win32") {
    // Windows Git Bash/Defender can make full CLI subprocess health probes
    // exceed Bun's test watchdog. Windows is documented as not verified for
    // XR 3.1.6; Linux CI still exercises the full doctor JSON contract.
    test.skip("emits schema version, version, environment, workspace, config, summary, and checks", () => {});
    test.skip("does not leak configured provider secret values", () => {});
    return;
  }

  test("emits schema version, version, environment, workspace, config, summary, and checks", async () => {
    const result = await runDoctor();
    expect(result.code).toBe(0);
    expect(result.json.schemaVersion).toBe(1);
    expect(result.json.version.version).toBe("4.0.0");
    expect(result.json.environment.bun).toBeString();
    expect(result.json.workspace.dbPath).toBeString();
    expect(result.json.config.secrets).toBeObject();
    expect(result.json.summary.ok).toBe(true);
    expect(Array.isArray(result.json.checks)).toBe(true);
    expect(result.json.checks.some((c: any) => c.id === "audit")).toBe(true);
  }, 30_000);

  test("does not leak configured provider secret values", async () => {
    const secret = "sk-phase0-do-not-print";
    const result = await runDoctor({ OPENAI_API_KEY: secret });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.json.config.secrets.OPENAI_API_KEY).toBe("set");
  }, 30_000);
});
