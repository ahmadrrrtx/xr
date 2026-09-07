/**
 * XR Phase 8 — architecture census:
 *   XR802  no side-effecting dispatch without grant verification
 *   XR803  zero provider-key process.env reads in the provider plane
 *   XR805  XR_MCP_ALLOW_UNISOLATED gone from src/
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({
  path: relative(ROOT, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf8"),
}));

describe("XR805 XR_MCP_ALLOW_UNISOLATED removed from src/", () => {
  test("no src file mentions the env hatch", () => {
    const hits = files.filter((f) => f.text.includes("XR_MCP_ALLOW_UNISOLATED"));
    expect(hits.map((h) => h.path)).toEqual([]);
  });
});

describe("XR802 grant choke point", () => {
  test("agent loop dispatches via runAuthorized, not tool.run", () => {
    const agent = files.find((f) => f.path === "src/core/agent.ts")!;
    expect(agent.text).toContain("runAuthorized(");
    expect(agent.text).not.toMatch(/await tool\.run\(/);
  });

  test("capability executor dispatches via runAuthorized", () => {
    const exec = files.find((f) => f.path === "src/capabilities/executor.ts")!;
    expect(exec.text).toContain("runAuthorized(");
  });

  test("MCP wrappers bindGrant before side effects", () => {
    const client = files.find((f) => f.path === "src/mcp/client.ts")!;
    expect(client.text).toContain("bindGrant(");
    expect(client.text.match(/bindGrant\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  test("plugin adaptTool bindGrant before side effects", () => {
    const mgr = files.find((f) => f.path === "src/plugins/manager.ts")!;
    expect(mgr.text).toContain("bindGrant(");
  });
});

describe("XR803 provider keys are not read from process.env in the provider plane", () => {
  const KEY_ENVS = [
    "GROQ_API_KEY",
    "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "MISTRAL_API_KEY",
    "COHERE_API_KEY",
    "TOGETHER_API_KEY",
    "OPENROUTER_API_KEY",
    "CEREBRAS_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "XAI_API_KEY",
    "PERPLEXITY_API_KEY",
    "FIREWORKS_API_KEY",
    "SAMBANOVA_API_KEY",
    "HF_API_KEY",
    "FIRECRAWL_API_KEY",
  ];

  test("src/providers does not index process.env for provider key names", () => {
    const providerFiles = files.filter((f) => f.path.startsWith("src/providers/"));
    const hits: string[] = [];
    for (const f of providerFiles) {
      for (const name of KEY_ENVS) {
        // Direct reads: process.env.NAME or process.env["NAME"] / process.env[name]
        const re = new RegExp(`process\\.env(?:\\.${name}|\\[[\\'\\"]${name}[\\'\\"]\\])`);
        if (re.test(f.text)) hits.push(`${f.path}:${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
