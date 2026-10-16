/** Fresh-process local embedding trace. Synthetic fixture paths only; no cloud provider. */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const temp = mkdtempSync(join(tmpdir(), "a1-rag-process-"));
process.env.XR_HOME = join(temp, "home");
delete process.env.XR_EMBED_URL;
delete process.env.XR_EMBED_RUNTIME;
delete process.env.XR_EMBED_MODEL;
const requests: unknown[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== "/api/embeddings") return new Response("unexpected route", { status: 404 });
    requests.push(await req.json());
    return Response.json({ embedding: [1, 0, 1, 0] });
  },
});
try {
  const root = join(temp, "workspace"), outside = join(temp, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, "safe.test.ts"), "export const SAFE_INDEX_CONTROL = 17;\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "synthetic-fixture" } }));
  writeFileSync(join(root, ".env.local"), "A1_RAG_SECRET_CANARY");
  writeFileSync(join(outside, "secret.ts"), "A1_RAG_OUTSIDE_CANARY");
  symlinkSync(join(outside, "secret.ts"), join(root, "linked.ts"));
  symlinkSync(outside, join(root, "linked-directory"));
  linkSync(join(outside, "secret.ts"), join(root, "hardlink.ts"));
  const { loadConfig, saveConfig } = await import("../../src/config/config.ts");
  const { config } = loadConfig();
  config.localModels.runtime = "ollama";
  config.localModels.runtimes.ollama = { baseUrl: `http://127.0.0.1:${server.port}` };
  saveConfig(config);
  const { fingerprint, indexProject } = await import("../../src/context/memory/rag.ts");
  const { Store } = await import("../../src/state/workspace-store.ts");
  const store = new Store(join(temp, "rag.db"));
  try {
    const fp = fingerprint(root), count = await indexProject(store, root, "synthetic-project");
    const chunks = store.allChunks("synthetic-project").map(row => ({ path: row.path, text: row.text }));
    console.log(JSON.stringify({ fp, count, chunks, embeddingRequests: requests }));
  } finally { store.close(); }
} finally {
  server.stop(true);
  rmSync(temp, { recursive: true, force: true });
}
