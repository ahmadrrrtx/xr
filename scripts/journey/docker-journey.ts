#!/usr/bin/env bun
/**
 * XR-LAUNCH-011 — clean-machine journey for the Docker/GHCR image (Linux).
 *
 *   bun run scripts/journey/docker-journey.ts [--evidence out.json] [--class CI|LR]
 *
 *   build      `docker build` of the repo Dockerfile (what release.yml pushes to GHCR)
 *   package    the image exists locally; its id is recorded
 *   install    a named data volume (the image's XR_HOME=/data) is created
 *   launch     `--version` reports N; `serve` answers /api/v1/health through a
 *              loopback-only published port
 *   agent      a real task inside the container against the fixture provider
 *              (host network; the provider is on the host's loopback)
 *   update     de-scoped: a container is updated by pulling a new tag, there is
 *              no in-place update path to exercise
 *   uninstall  container, image and data volume removed; nothing left behind
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gitState, sh, tail, type JourneyEvidence, type StepName, type StepResult } from "./cli-journey.ts";
import { FIXTURE_CONTENT, FIXTURE_FILE, FIXTURE_MODEL, FIXTURE_PROVIDER, startFixtureProvider, writeFixtureConfig } from "./fixtures.ts";

const ROOT = resolve(import.meta.dir, "..", "..");

export async function runDockerJourney(evidenceClass: "CI" | "LR"): Promise<JourneyEvidence> {
  const N = (JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")) as { identity: { version: string } }).identity.version;
  const tag = `xr-journey:${process.pid}`, volume = `xr-journey-data-${process.pid}`, name = `xr-journey-${process.pid}`;
  const work = mkdtempSync(join(tmpdir(), "xr-docker-journey-"));
  const steps: StepResult[] = [];
  let failed = false;
  const step = async (s: StepName, fn: () => Promise<string>) => {
    const t0 = Date.now();
    if (failed) { steps.push({ step: s, status: "blocked", detail: "an earlier step failed", ms: 0 }); return; }
    try {
      steps.push({ step: s, status: "pass", detail: await fn(), ms: Date.now() - t0 });
    } catch (e) {
      failed = true;
      steps.push({ step: s, status: "fail", detail: (e as Error).message.slice(0, 900), ms: Date.now() - t0 });
    }
    const r = steps[steps.length - 1]!;
    console.log(`  ${r.status.padEnd(7)} ${s} (${r.ms} ms) — ${r.detail}`);
  };
  const need = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  console.log(`[docker-journey] v${N} · image ${tag}`);
  try {
    await step("build", async () => {
      const r = await sh(["docker", "build", "-t", tag, "."], { timeoutMs: 1_200_000 });
      need(r.status === 0, `docker build: ${tail(r.out)}`);
      return "docker build of ./Dockerfile";
    });
    await step("package", async () => {
      const r = await sh(["docker", "image", "inspect", "-f", "{{.Id}} {{.Size}}", tag]);
      need(r.status === 0, `image inspect: ${tail(r.out)}`);
      return `image ${r.out.trim()}`;
    });
    await step("install", async () => {
      const r = await sh(["docker", "volume", "create", volume]);
      need(r.status === 0, `volume create: ${tail(r.out)}`);
      return `data volume ${volume}`;
    });
    await step("launch", async () => {
      const v = await sh(["docker", "run", "--rm", "-v", `${volume}:/data`, tag, "--version"]);
      need(v.status === 0 && v.out.includes(N), `--version: ${tail(v.out, 200)}`);
      // XR-LAUNCH-020: real write_file → read_file through the glibc-backed authority.
      const f = await sh(["docker", "run", "--rm", "--entrypoint", "bun", tag, "run", "scripts/container-file-smoke.ts"]);
      need(f.status === 0 && f.out.includes('"pass":true'), `container file-tool smoke: ${tail(f.out, 400)}`);
      const d = await sh(["docker", "run", "-d", "--name", name, "-v", `${volume}:/data`, "-p", "127.0.0.1::7842", tag]);
      need(d.status === 0, `docker run -d: ${tail(d.out)}`);
      const port = (await sh(["docker", "port", name, "7842/tcp"])).out.trim().split(/\r?\n/)[0]?.split(":").pop();
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2000) })).ok) return `--version ${N}; file tools OK; serve healthy on 127.0.0.1:${port}`;
        } catch {
          /* booting */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`serve never answered /api/v1/health: ${tail((await sh(["docker", "logs", name])).out)}`);
    });
    await sh(["docker", "rm", "-f", name]);
    await step("agent", async () => {
      const provider = await startFixtureProvider();
      try {
        const data = join(work, "data"), ws = join(work, "ws");
        mkdirSync(ws, { recursive: true });
        writeFixtureConfig(data, provider.url);
        // Run as the host user (the common `--user $(id -u):$(id -g)` pattern for
        // a bind-mounted workspace): as root, the proof file came back root-owned
        // and unreadable to the runner (EACCES). XR_HOME=/data is host-owned.
        const asHost = process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`, "-e", "HOME=/tmp"] : [];
        const r = await sh(["docker", "run", "--rm", ...asHost, "--network", "host", "-e", "XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER=1", "-e", "CI=1", "-e", "NO_COLOR=1", "-v", `${data}:/data`, "-v", `${ws}:/ws`, tag, "--cwd", "/ws", "--provider", FIXTURE_PROVIDER, "--model", FIXTURE_MODEL, "--json", "Write the journey proof file."], { timeoutMs: 180_000 });
        const proof = join(ws, FIXTURE_FILE);
        need(existsSync(proof) && readFileSync(proof, "utf8") === FIXTURE_CONTENT, `proof file not written in the container (exit ${r.status}): ${tail(r.out)}`);
        need(r.status === 0, `container exit ${r.status}: ${tail(r.out)}`);
        return "write_file applied inside the container against the fixture provider";
      } finally {
        await provider.close();
      }
    });
    steps.push(failed
      ? { step: "update", status: "blocked", detail: "an earlier step failed", ms: 0 }
      : { step: "update", status: "descoped", detail: "containers are updated by pulling a new tag (data persists in the volume); no in-place update path exists", ms: 0 });
    await step("uninstall", async () => {
      await sh(["docker", "rm", "-f", name]);
      const a = await sh(["docker", "rmi", "-f", tag]);
      const b = await sh(["docker", "volume", "rm", volume]);
      need(a.status === 0 && b.status === 0, `rmi/volume rm: ${tail(a.out + b.out)}`);
      need((await sh(["docker", "image", "inspect", tag])).status !== 0, "image still present");
      need((await sh(["docker", "volume", "inspect", volume])).status !== 0, "volume still present");
      return "container, image and data volume removed";
    });
  } finally {
    await sh(["docker", "rm", "-f", name]);
    // Files the container wrote into bind mounts are root-owned: remove them from inside.
    await sh(["docker", "run", "--rm", "-v", `${work}:/w`, "--entrypoint", "sh", "oven/bun:1.4.2-slim", "-c", "rm -rf /w/*"]);
    rmSync(work, { recursive: true, force: true });
  }
  const { commit, dirty } = await gitState();
  return {
    schema: 1, kind: "docker-journey", channel: "image", target: `docker-linux-${process.arch}`, os: process.platform, arch: process.arch,
    version: N, nextVersion: "", evidenceClass, commit, dirty,
    runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    runner: process.env.ImageOS ? `${process.env.ImageOS}/${process.env.ImageVersion ?? ""}` : "local",
    at: new Date().toISOString(), steps,
    result: steps.every((s) => s.status === "pass" || s.status === "descoped") ? "pass" : "fail",
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const ev = await runDockerJourney((get("--class") ?? (process.env.GITHUB_ACTIONS ? "CI" : "LR")) as "CI" | "LR");
  const out = get("--evidence");
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(ev, null, 2) + "\n"); }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Docker journey · ${ev.result.toUpperCase()}`, "", "| step | status | detail |", "|---|---|---|", ...ev.steps.map((s) => `| ${s.step} | ${s.status} | ${s.detail.replace(/\|/g, "/")} |`), ""].join("\n") + "\n");
  }
  console.log(JSON.stringify(ev));
  process.exit(ev.result === "pass" ? 0 : 1);
}
