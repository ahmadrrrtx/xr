/**
 * XR-REL-02 — `POST /api/v1/models/pull` is a REAL pull.
 *
 * The onboarding download step used to fabricate its progress (a 6-second
 * timer over a made-up 2.1 GB total) and call the Tauri command directly,
 * bypassing the engine, because the engine had no pull route at all. This
 * test drives the route against a fake Ollama that speaks the real NDJSON
 * `/api/pull` protocol and pins the three honesty properties:
 *
 *   · every byte count rendered by the desktop comes from the runtime;
 *   · a runtime error is forwarded, never swallowed into a fake success;
 *   · `done` requires the runtime to actually LIST the model afterwards — a
 *     "success" frame alone is not proof it was installed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeHandler } from "../../src/daemon/server.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { loadConfig, saveConfig } from "../../src/config/config.ts";
import { invalidateRuntimeCache } from "../../src/local/runtimes.ts";

const TOKEN = "pull-token";
const RUNTIME_PORT = 39141;

type Mode = "ok" | "runtime-error" | "success-without-model";
let mode: Mode = "ok";
let installed: string[] = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          models: installed.map((name) => ({
            name,
            size: 1_000_000,
            modified_at: new Date().toISOString(),
          })),
        })
      );
      return;
    }
    if (req.url === "/api/pull" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const { name } = JSON.parse(raw || "{}") as { name?: string };
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const frames: unknown[] = [
          { status: "pulling manifest" },
          { status: "pulling 4f7b2a", digest: "sha256:aaa", total: 1000, completed: 250 },
          { status: "pulling 4f7b2a", digest: "sha256:aaa", total: 1000, completed: 800 },
        ];
        if (mode === "runtime-error") {
          frames.push({ error: "pull model manifest: file does not exist" });
        } else if (mode === "success-without-model") {
          frames.push({ status: "success" }); // claims success, never installs
        } else {
          frames.push({ status: "verifying sha256 digest" }, { status: "success" });
          if (name) installed.push(name);
        }
        for (const f of frames) res.write(`${JSON.stringify(f)}\n`);
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(RUNTIME_PORT, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fresh(baseUrl = `http://127.0.0.1:${RUNTIME_PORT}/v1`) {
  const tmp = mkdtempSync(join(tmpdir(), "xr-pull-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const cfg = loadConfig().config;
  cfg.localModels.runtime = "ollama";
  (cfg.localModels as Record<string, unknown>).runtimes = { ollama: { baseUrl } };
  saveConfig(cfg);
  invalidateRuntimeCache();
  return { h: makeHandler(store, TOKEN) };
}

const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1:7842${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Parse the `data:` frames our SSE helper emits. */
function frames(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("")
    )
    .filter((d) => d.length > 0 && d !== "[DONE]")
    .map((d) => JSON.parse(d) as Record<string, unknown>);
}

describe("XR-REL-02 — models.pull streams the runtime's own progress", () => {
  test("a successful pull forwards real byte counts and only then reports done", async () => {
    mode = "ok";
    installed = [];
    const { h } = fresh();
    const res = await h(post("/api/v1/models/pull", { runtime: "ollama", model: "qwen2.5:0.5b" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    const f = frames(await res.text());

    const pulling = f.filter((x) => x.status === "pulling" && typeof x.completed === "number");
    expect(pulling.length).toBeGreaterThan(0);
    // The runtime's numbers, verbatim.
    expect(pulling.some((x) => x.completed === 250 && x.total === 1000)).toBe(true);
    // pct is derived from the runtime's total, never invented.
    for (const p of pulling) expect(p.pct).toBeCloseTo((p.completed as number) / 1000, 5);
    // No fabricated 2.1 GB pull size from the old simulator.
    expect(f.some((x) => x.total === 2_100_000_000)).toBe(false);
    // Verifying layers are surfaced as such.
    expect(f.some((x) => x.status === "verifying")).toBe(true);
    // Done implies installed.
    const done = f.filter((x) => x.status === "done");
    expect(done).toHaveLength(1);
    expect(done[0]?.installed).toBe(true);
    expect(installed).toContain("qwen2.5:0.5b");
  });

  test("a runtime error frame becomes an error, not a fake success", async () => {
    mode = "runtime-error";
    installed = [];
    const { h } = fresh();
    const res = await h(post("/api/v1/models/pull", { runtime: "ollama", model: "nope:1b" }));
    const f = frames(await res.text());
    expect(f.some((x) => x.status === "done")).toBe(false);
    const err = f.find((x) => x.status === "error");
    expect(err).toBeDefined();
    expect(String(err?.detail)).toContain("does not exist");
  });

  test("a success frame without an installed model is reported as a failure", async () => {
    mode = "success-without-model";
    installed = [];
    const { h } = fresh();
    const res = await h(post("/api/v1/models/pull", { runtime: "ollama", model: "ghost:1b" }));
    const f = frames(await res.text());
    expect(f.some((x) => x.status === "done")).toBe(false);
    const err = f.find((x) => x.status === "error");
    expect(String(err?.detail)).toContain("not in its model list");
  });

  test("an unsafe model id never reaches the runtime", async () => {
    mode = "ok";
    const { h } = fresh();
    for (const model of ["../../etc/passwd", "bad id with spaces", ""]) {
      const res = await h(post("/api/v1/models/pull", { runtime: "ollama", model }));
      expect(res.status).toBe(400);
    }
  });

  test("an unreachable runtime is a 409 with a reason (no hanging spinner)", async () => {
    mode = "ok";
    const { h } = fresh("http://127.0.0.1:39998/v1");
    const res = await h(post("/api/v1/models/pull", { runtime: "ollama", model: "qwen2.5:0.5b" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string; runtimeUnavailable?: boolean };
    expect(body.runtimeUnavailable).toBe(true);
    expect(String(body.error)).toContain("not reachable");
  });

  test("a hosted provider is refused — there is nothing to pull", async () => {
    mode = "ok";
    const { h } = fresh();
    const res = await h(post("/api/v1/models/pull", { runtime: "openai", model: "gpt-x" }));
    expect(res.status).toBe(400);
  });
});
