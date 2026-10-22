/**
 * XR-LAUNCH-011 — deterministic fixtures for the clean-machine journey.
 *
 *   startFixtureProvider()  an OpenAI-compatible endpoint on 127.0.0.1 that
 *                           answers the first chat turn with ONE write_file
 *                           tool call and every later turn with a done
 *                           envelope. No model, no network, no key.
 *   startFixtureServer()    a static file server for a scratch release
 *                           directory, plus two synthetic indexes:
 *                             GET /releases.json   GitHub-releases shape
 *                             GET /<pkg-escaped>    npm packument
 *
 * Both bind 127.0.0.1 on an ephemeral port and record every request. They
 * exist for scripts/journey/*.ts and the provider-canary fixture leg; they
 * are never part of the shipped product.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, normalize, sep } from "node:path";
import type { AddressInfo } from "node:net";

export const FIXTURE_MODEL = "journey-model";
export const FIXTURE_FILE = "journey-proof.txt";
export const FIXTURE_PROVIDER = "journey-fixture";
export const FIXTURE_CONTENT = "written by the XR journey fixture\n";

export interface Running {
  port: number;
  url: string;
  requests: string[];
  close(): Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function closer(server: Server): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/** Deterministic agent provider: turn 1 → write_file tool call, turn 2+ → done. */
export async function startFixtureProvider(): Promise<Running> {
  const requests: string[] = [];
  let chatTurns = 0;
  const server = createServer(async (req, res) => {
    const text = await body(req);
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/models")) {
      res.end(JSON.stringify({ object: "list", data: [{ id: FIXTURE_MODEL, object: "model" }] }));
      return;
    }
    if (!req.url?.endsWith("/chat/completions")) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    let wantsStream = false;
    try {
      wantsStream = JSON.parse(text).stream === true;
    } catch {
      /* non-JSON body: answer non-streaming */
    }
    chatTurns += 1;
    const first = chatTurns === 1;
    const message = first
      ? {
          role: "assistant",
          content: "Writing the journey proof file.",
          tool_calls: [
            {
              id: "journey-call-1",
              type: "function",
              function: { name: "write_file", arguments: JSON.stringify({ path: FIXTURE_FILE, content: FIXTURE_CONTENT }) },
            },
          ],
        }
      : { role: "assistant", content: JSON.stringify({ message: "Journey task complete.", tool_calls: [], done: true }) };
    const usage = { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 };
    if (wantsStream) {
      res.setHeader("content-type", "text/event-stream");
      const delta = first
        ? { role: "assistant", content: message.content, tool_calls: (message as { tool_calls: unknown[] }).tool_calls.map((c, index) => ({ index, ...(c as object) })) }
        : { role: "assistant", content: message.content };
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }], usage })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.end(JSON.stringify({ id: `journey-${chatTurns}`, object: "chat.completion", model: FIXTURE_MODEL, choices: [{ index: 0, message, finish_reason: first ? "tool_calls" : "stop" }], usage }));
  });
  const port = await listen(server);
  server.unref();
  return { port, url: `http://127.0.0.1:${port}/v1`, requests, close: closer(server) };
}

export interface ReleaseSpec {
  /** version without the leading v */
  version: string;
  prerelease?: boolean;
}

export interface NpmSpec {
  name: string;
  /** version → absolute path of the packed tarball */
  tarballs: Record<string, string>;
  latest: string;
}

/**
 * Static server rooted at `root` (layout: root/v<version>/<asset>), plus the
 * synthetic GitHub-releases index and npm packument described above.
 */
export async function startFixtureServer(opts: { root: string; releases?: ReleaseSpec[]; npm?: NpmSpec }): Promise<Running> {
  const requests: string[] = [];
  let base = "";
  const manifests: Record<string, Record<string, Record<string, string>>> = {};
  for (const [v, file] of Object.entries(opts.npm?.tarballs ?? {})) {
    // cwd + bare file name: Git-for-Windows' GNU tar reads `C:\…` as host:path.
    const p = spawnSync("tar", ["-xzOf", basename(file), "package/package.json"], { encoding: "utf8", cwd: dirname(file) });
    if (p.status !== 0) throw new Error(`cannot read package.json from ${file}: ${p.stderr}`);
    manifests[v] = JSON.parse(p.stdout);
  }
  const serveFile = (res: ServerResponse, file: string) => {
    res.setHeader("content-length", String(statSync(file).size));
    res.setHeader("content-type", "application/octet-stream");
    createReadStream(file).pipe(res);
  };
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    requests.push(`${req.method} ${url}`);
    if (url === "/releases.json") {
      const list = (opts.releases ?? []).map((r) => {
        const dir = join(opts.root, `v${r.version}`);
        const assets = existsSync(dir) ? readFileSync(join(dir, "SHA256SUMS"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => ({ name: l.split(/\s+\*?/)[1] })) : [];
        return { tag_name: `v${r.version}`, draft: false, prerelease: r.prerelease === true, assets: [...assets, { name: "SHA256SUMS" }] };
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(list));
      return;
    }
    if (opts.npm && (url === `/${opts.npm.name}` || url === `/${opts.npm.name.replace("/", "%2f")}` || url === `/${opts.npm.name.replace("/", "%2F")}`)) {
      const versions: Record<string, unknown> = {};
      for (const [v, file] of Object.entries(opts.npm.tarballs)) {
        const bytes = readFileSync(file);
        const pkgFile = `${opts.npm.name.split("/").pop()}-${v}.tgz`;
        // npm resolves dependencies from the packument, not the tarball: copy the
        // tarball's own manifest fields in, or the install has no node_modules.
        const pj = manifests[v] ?? {};
        versions[v] = {
          name: opts.npm.name,
          version: v,
          bin: pj.bin ?? { xr: "bin/xr" },
          dependencies: pj.dependencies ?? {},
          optionalDependencies: pj.optionalDependencies ?? {},
          engines: pj.engines ?? {},
          dist: {
            tarball: `${base}/-/tarballs/${v}/${pkgFile}`,
            shasum: createHash("sha1").update(bytes).digest("hex"),
            integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
          },
        };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ name: opts.npm.name, "dist-tags": { latest: opts.npm.latest }, versions }));
      return;
    }
    const tar = /^\/-\/tarballs\/([^/]+)\/[^/]+\.tgz$/.exec(url);
    if (opts.npm && tar && opts.npm.tarballs[tar[1]!]) {
      serveFile(res, opts.npm.tarballs[tar[1]!]!);
      return;
    }
    const file = normalize(join(opts.root, url));
    if (file.startsWith(normalize(opts.root) + sep) && existsSync(file) && statSync(file).isFile()) {
      serveFile(res, file);
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  const port = await listen(server);
  server.unref();
  base = `http://127.0.0.1:${port}`;
  return { port, url: base, requests, close: closer(server) };
}

/**
 * Point an XR data home at the fixture provider (merging any config the
 * installer's setup wrote) and allow file edits, so `xr "<task>"` runs the
 * deterministic write_file turn unattended.
 */
export function writeFixtureConfig(dataHome: string, providerUrl: string): void {
  mkdirSync(dataHome, { recursive: true });
  const cfgPath = join(dataHome, "config.json");
  const prior = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  writeFileSync(cfgPath, JSON.stringify({
    ...prior,
    version: prior.version ?? 22,
    defaults: { ...(prior.defaults ?? {}), provider: FIXTURE_PROVIDER, model: FIXTURE_MODEL },
    memory: { ...(prior.memory ?? {}), enabled: false },
    providerEngine: {
      ...(prior.providerEngine ?? {}),
      routingStrategy: "primary",
      customProviders: [{ id: FIXTURE_PROVIDER, label: "Journey fixture (loopback)", baseUrl: providerUrl, defaultModel: FIXTURE_MODEL, capabilities: { chat: true, streaming: false, toolUse: true, functionCalling: true } }],
    },
  }, null, 2));
  writeFileSync(join(dataHome, "cli.json"), JSON.stringify({ provider: FIXTURE_PROVIDER, model: FIXTURE_MODEL, permissions: { allow: ["edit:*"], deny: [] } }));
}
