/** Synthetic-only real CLI/provider fixture. No execution or authority substitution. */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { auditRows, freshHome, removeHome, runCli, writeConfig } from "../e2e-blackbox/helpers.ts";

export async function a1Fixture(tool: string, args: Record<string, unknown>) {
  const home = freshHome(), cwd = join(home, "workspace"), outside = join(home, "outside");
  mkdirSync(cwd); mkdirSync(outside);
  const secret = `A1_SYNTHETIC_${randomUUID()}`;
  const requests: Array<{ messages?: unknown; tools?: unknown; [key: string]: unknown }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", b => chunks.push(Buffer.from(b)));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) { res.end(JSON.stringify({ data: [{ id: "stub-model" }] })); return; }
      if (!req.url?.endsWith("/chat/completions")) { res.statusCode = 404; res.end("{}"); return; }
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      const first = requests.length === 1;
      res.end(JSON.stringify({ choices: [{ message: first
        ? { role: "assistant", content: "Synthetic operation.", tool_calls: [{ id: "a1-call", type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }
        : { role: "assistant", content: JSON.stringify({ message: "Synthetic completion.", tool_calls: [], done: true }) },
        finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const port = (server.address() as import("node:net").AddressInfo).port;
  writeConfig(home, {
    version: 22, defaults: { provider: "a1-loopback", model: "stub-model" },
    budget: { perTaskUsd: 0.5, perTaskTokens: 250_000 }, memory: { enabled: false },
    providerEngine: { routingStrategy: "primary", customProviders: [{ id: "a1-loopback", label: "Synthetic local fixture", baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: "stub-model", capabilities: { chat: true, streaming: false, toolUse: true, functionCalling: true } }], providerCapabilities: {"a1-loopback":{models:{"stub-model":{cost:{inPerMTok:1,outPerMTok:1,known:true,source:"synthetic A1 fixture; no provider billing"}}}}} },
    security: { egressAllowlist: [], hardened: true },
  });
  const permissions = (deny: string[] = []) => writeFileSync(join(home, "cli.json"), JSON.stringify({ provider: "a1-loopback", model: "stub-model", permissions: { allow: ["edit:*", "shell:*"], deny } }));
  permissions();
  return {
    home, cwd, outside, secret, requests, permissions,
    run: (flags: string[] = [], prompt = "Synthetic offline operation", env: Record<string, string> = {}) => runCli(["--cwd", cwd, "--provider", "a1-loopback", "--model", "stub-model", "--json", ...flags, prompt], { home, env: { XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER: "1", CI: "1", ...env }, timeoutMs: 30_000 }),
    disclosure: (output = "") => JSON.stringify(requests).includes(secret) || output.includes(secret) || JSON.stringify(auditRows(home)).includes(secret),
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      removeHome(home);
    },
  };
}
