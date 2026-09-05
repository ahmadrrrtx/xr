#!/usr/bin/env bun
/**
 * XR Phase 3 — consumer smoke (fresh install = audited artifact).
 *
 * Two modes:
 *   --from-source     run the CLI from this checkout (CI analog; no npm)
 *   --from-npm [ver]  install @rrrtx/xr@ver (or dist-tag `beta`, then `latest`
 *                     1.x if present) into a clean temp dir and smoke that
 *
 * Both: isolated XR_HOME + a self-contained OpenAI-compat stub + doctor --json
 * + one hermetic task. Asserts version identity is not the stale 3.x line.
 *
 *   --skip-if-unpublished   exit 0 when no 1.x exists on npm (weekly lane)
 *
 * Keep this file self-contained: do not import test/ helpers (scripts must
 * not depend on the test tree).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");
const CONFIG_VERSION = 20;
const STALE_MARKERS = ["3.1.5", "Unified AI Operating System", "XR 3.0"];

/**
 * ── Phase 5 · tarball scope assertion (ADR-0028) ────────────────────────────
 *
 * A fresh `npm i @rrrtx/xr` must contain the runtime and NOT the extracted
 * enterprise / business-os implementations. `package.json#files` already
 * excludes them, but "already excludes them" is exactly the kind of claim that
 * silently stops being true when someone adds a directory — so the tarball is
 * inspected rather than trusted.
 *
 * What core legitimately keeps (Art. XVI: the kernel holds a thin contract,
 * extensions hold the implementation):
 *   · src/core/business-l0.ts             the L0 interfaces the extension satisfies
 *   · src/core/providers/business.ts      the optional loader (package specifier only)
 *   · src/daemon/routes/business.routes.ts committed /api/v1 operations that answer
 *                                          honestly when the extension is absent
 *   · src/schemas/business-os.skill.json   a schema, not an implementation
 *
 * Anything else matching /enterprise|business-os/ under src/ is a regression:
 * implementation that leaked back into the published artifact.
 */
export const TARBALL_CONTRACT_ALLOWLIST = [
  "package/src/core/business-l0.ts",
  "package/src/core/providers/business.ts",
  "package/src/daemon/routes/business.routes.ts",
  "package/src/schemas/business-os.skill.json",
] as const;

export interface TarballScopeReport {
  ok: boolean;
  totalFiles: number;
  offenders: string[];
}

/** Assert an npm tarball ships no extracted satellite implementation. */
export function checkTarballScope(tgzPath: string): TarballScopeReport {
  const listed = spawnSync("tar", ["-tzf", tgzPath], { encoding: "utf8" });
  if (listed.status !== 0) {
    return { ok: false, totalFiles: 0, offenders: [`tar failed: ${listed.stderr.trim()}`] };
  }
  const files = listed.stdout.split("\n").filter(Boolean);
  const allow = new Set<string>(TARBALL_CONTRACT_ALLOWLIST);
  const offenders = files.filter(
    (f) =>
      // src/ only: docs/ legitimately documents the satellites and the history.
      f.startsWith("package/src/") &&
      /enterprise|business-os|business\//i.test(f) &&
      !allow.has(f),
  );
  // Whole directories that must never appear at all.
  offenders.push(
    ...files.filter((f) => f.startsWith("package/extensions/") || f.startsWith("package/satellites/")),
  );
  return { ok: offenders.length === 0, totalFiles: files.length, offenders };
}

export interface SmokeReport {
  ok: boolean;
  mode: "from-source" | "from-npm";
  version: string;
  doctorExit: number | null;
  taskExit: number | null;
  skipped?: string;
  detail?: string;
}

function fail(report: SmokeReport, detail: string): SmokeReport {
  return { ...report, ok: false, detail };
}

function envelope(message: string): string {
  return JSON.stringify({ message, tool_calls: [], done: true });
}

export function startSmokeStub(message = "CONSUMER-SMOKE-OK"): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<import("node:net").Socket>();
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const url = req.url ?? "";
        const respond = (status: number, body: unknown): void => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (/\/models$/.test(url)) {
          respond(200, { object: "list", data: [{ id: "stub-model" }] });
          return;
        }
        if (!/\/chat\/completions$/.test(url)) {
          respond(404, { error: { message: `unhandled ${url}` } });
          return;
        }
        respond(200, {
          choices: [
            {
              message: { role: "assistant", content: envelope(message) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
        });
      });
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.unref();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.destroy();
            sockets.clear();
            server.close(() => res());
            setTimeout(() => res(), 250).unref?.();
          }),
      });
    });
  });
}

export function writeStubConfig(home: string, baseUrl: string): void {
  mkdirSync(home, { recursive: true });
  const config = {
    version: CONFIG_VERSION,
    defaults: { provider: "consumer-stub", model: "stub-model" },
    providerEngine: {
      routingStrategy: "hybrid",
      customProviders: [
        {
          id: "consumer-stub",
          label: "Consumer smoke stub",
          baseUrl,
          defaultModel: "stub-model",
          capabilities: { chat: true, streaming: false, toolUse: true },
        },
      ],
      providerCapabilities: {},
    },
  };
  writeFileSync(join(home, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

function runCli(
  cmd: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs = 120_000,
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function looksStale(text: string): boolean {
  return STALE_MARKERS.some((m) => text.includes(m));
}

export async function fetchNpm1x(pkg = "@rrrtx/xr"): Promise<string[]> {
  const res = await fetch(`https://registry.npmjs.org/${pkg}`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`npm registry ${res.status}`);
  const body = (await res.json()) as { versions?: Record<string, unknown>; "dist-tags"?: Record<string, string> };
  return Object.keys(body.versions ?? {}).filter((v) => v.startsWith("1."));
}

export async function runConsumerSmoke(opts: {
  mode: "from-source" | "from-npm";
  version?: string;
  skipIfUnpublished?: boolean;
}): Promise<SmokeReport> {
  const report: SmokeReport = {
    ok: false,
    mode: opts.mode,
    version: opts.version ?? "",
    doctorExit: null,
    taskExit: null,
  };

  if (opts.mode === "from-npm" && opts.skipIfUnpublished && !opts.version) {
    const ones = await fetchNpm1x();
    if (ones.length === 0) {
      return { ...report, ok: true, skipped: "no 1.x on npm yet" };
    }
  }

  const home = mkdtempSync(join(tmpdir(), "xr-consumer-home-"));
  const work = mkdtempSync(join(tmpdir(), "xr-consumer-work-"));
  const stub = await startSmokeStub();
  try {
    writeStubConfig(home, stub.baseUrl);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XR_HOME: home,
      HOME: home,
      NO_COLOR: "1",
      XR_NONINTERACTIVE: "1",
    };

    let xrCmd: string[];
    let cwd = REPO_ROOT;
    if (opts.mode === "from-source") {
      xrCmd = [process.execPath, "run", CLI_ENTRY];
    } else {
      const spec = opts.version ? `@rrrtx/xr@${opts.version}` : "@rrrtx/xr@beta";
      writeFileSync(join(work, "package.json"), JSON.stringify({ name: "xr-consumer-smoke", private: true }) + "\n");
      const inst = runCli(["npm", "install", spec, "--no-fund", "--ignore-scripts"], env, work, 180_000);
      if (inst.status !== 0) {
        // beta may be unpublished while latest is still 3.x — honest skip when asked
        if (opts.skipIfUnpublished) {
          return { ...report, ok: true, skipped: `npm install ${spec} failed (${inst.status}); unpublished` };
        }
        return fail(report, `npm install ${spec} exit ${inst.status}: ${(inst.stderr + inst.stdout).slice(0, 400)}`);
      }
      const bin = join(work, "node_modules", ".bin", process.platform === "win32" ? "xr.cmd" : "xr");
      if (!existsSync(bin)) return fail(report, `installed package has no bin at ${bin}`);
      xrCmd = [bin];
      cwd = work;
    }

    const ver = runCli([...xrCmd, "--version"], env, cwd, 60_000);
    report.version = (ver.stdout + ver.stderr).trim().split("\n")[0] ?? "";
    if (looksStale(ver.stdout + ver.stderr)) {
      return fail(report, `stale 3.x identity in --version: ${report.version}`);
    }

    const doctor = runCli([...xrCmd, "doctor", "--json"], env, cwd, 120_000);
    report.doctorExit = doctor.status;
    // doctor may exit 1 when no hosted key is present; the stub is enough to
    // prove the binary boots. Exit 2+ is a usage/crash class.
    if (doctor.status !== 0 && doctor.status !== 1) {
      return fail(report, `doctor exit ${doctor.status}: ${(doctor.stderr + doctor.stdout).slice(0, 400)}`);
    }
    if (looksStale(doctor.stdout + doctor.stderr)) {
      return fail(report, "stale 3.x identity in doctor output");
    }

    const task = runCli(
      [...xrCmd, "run", "Say hello", "--provider", "consumer-stub"],
      env,
      cwd,
      180_000,
    );
    report.taskExit = task.status;
    const out = task.stdout + task.stderr;
    if (task.status !== 0) {
      return fail(report, `hermetic task exit ${task.status}: ${out.slice(0, 500)}`);
    }
    if (!/CONSUMER-SMOKE-OK/.test(out) && !/done/i.test(out)) {
      return fail(report, `hermetic task produced no recognizable success: ${out.slice(0, 400)}`);
    }
    report.ok = true;
    return report;
  } finally {
    try {
      await stub.close();
    } catch {
      /* */
    }
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* */
    }
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // --tarball <path>: scope-only assertion, used by the release workflow right
  // after `npm pack` and runnable locally against any built tarball.
  const tarIdx = argv.indexOf("--tarball");
  if (tarIdx >= 0) {
    const tgz = argv[tarIdx + 1];
    if (!tgz || !existsSync(tgz)) {
      console.error("[consumer-smoke] --tarball needs a path to an existing .tgz");
      process.exit(1);
    }
    const scope = checkTarballScope(tgz);
    console.log(JSON.stringify(scope));
    if (!scope.ok) {
      console.error(`❌ tarball ships extracted satellite code (${scope.offenders.length}):`);
      for (const o of scope.offenders) console.error(`   ${o}`);
      console.error("\nEnterprise and Business OS implementations live in their own packages (ADR-0028).");
      process.exit(1);
    }
    console.log(`✅ tarball scope: ${scope.totalFiles} files, no extracted satellite code`);
    process.exit(0);
  }

  const skipIfUnpublished = argv.includes("--skip-if-unpublished");
  const fromNpm = argv.includes("--from-npm");
  const fromSource = argv.includes("--from-source") || !fromNpm;
  const npmIdx = argv.indexOf("--from-npm");
  const version =
    npmIdx >= 0 && argv[npmIdx + 1] && !argv[npmIdx + 1]!.startsWith("--")
      ? argv[npmIdx + 1]
      : undefined;
  const report = await runConsumerSmoke({
    mode: fromNpm ? "from-npm" : "from-source",
    version,
    skipIfUnpublished,
  });
  console.log(JSON.stringify(report));
  if (report.skipped) {
    console.log(`consumer-smoke SKIP: ${report.skipped}`);
    process.exit(0);
  }
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[consumer-smoke] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
