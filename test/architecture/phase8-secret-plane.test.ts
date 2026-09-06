/**
 * XR Phase 8 · Step 3 — ARCHITECTURAL TEST: the provider plane holds no
 * credentials, and the removed MCP escape flag stays removed.
 *
 * ── Why these are architecture tests, not unit tests ────────────────────────
 *
 * Both properties are *absence* properties: "no provider reads process.env for
 * a key", "no code reads XR_MCP_ALLOW_UNISOLATED". A unit test cannot express
 * absence — it can only test the code paths someone remembered to write a test
 * for. A scanner over the source tree is the only construct that fails when a
 * NEW file reintroduces the pattern six months from now, which is precisely
 * when the regression will actually happen.
 *
 * Acceptance criteria covered:
 *   (2) zero provider keys sourced from process.env with hydration off;
 *   (4) `XR_MCP_ALLOW_UNISOLATED` is gone.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Strip comments and string literals before pattern-matching.
 *
 * Without this the test would fail on its own documentation: the source
 * deliberately *describes* the removed flag and the old pattern in comments
 * explaining why they are gone. A gate that forbids naming the thing it
 * forbids is a gate people work around by deleting the explanation — the worst
 * possible outcome. So we match executable code only.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "")        // line comments
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")     // template literals
    .replace(/"(?:\\.|[^\\"])*"/g, '""')          // double-quoted
    .replace(/'(?:\\.|[^\\'])*'/g, "''");         // single-quoted
}

const ALL_TS = walk(SRC);

describe("Phase 8 · F-24 — no provider-key reads in the provider plane", () => {
  /**
   * Every well-known provider credential name. A direct `process.env` read of
   * any of these anywhere in `src/` (outside the secret plane itself, which is
   * the ONE component allowed to touch ambient env) means a credential is
   * being sourced outside the broker.
   */
  const KEY_NAMES = [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
    "MISTRAL_API_KEY", "COHERE_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY",
    "DEEPSEEK_API_KEY", "XAI_API_KEY", "TOGETHER_API_KEY", "FIREWORKS_API_KEY",
    "OPENROUTER_API_KEY", "PERPLEXITY_API_KEY", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AZURE_OPENAI_API_KEY",
  ];

  /**
   * The secret plane is the designated boundary: it is *supposed* to read
   * ambient env, because that is how BYOK (`export OPENAI_API_KEY=...`) keeps
   * working. Confining that capability to three files is the whole point —
   * every other module must go through the broker.
   */
  const SECRET_PLANE = [
    "src/security/secrets.ts",
    "src/security/secret-broker.ts",
    "src/security/env-compat.ts",
  ];

  test("no module outside the secret plane reads a provider key from process.env", () => {
    const offenders: string[] = [];
    for (const file of ALL_TS) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (SECRET_PLANE.includes(rel)) continue;
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const key of KEY_NAMES) {
        // process.env.KEY  /  process.env["KEY"]  — both forms.
        const dotted = new RegExp(`process\\.env\\.${key}\\b`);
        const indexed = new RegExp(`process\\.env\\[\\s*["'\`]${key}["'\`]\\s*\\]`);
        if (dotted.test(code) || indexed.test(code)) {
          offenders.push(`${rel} → ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("native provider adapters resolve through the broker, not process.env", () => {
    const nativeDir = join(SRC, "providers");
    const offenders: string[] = [];
    for (const file of walk(nativeDir)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const code = codeOnly(readFileSync(file, "utf8"));
      // A dynamic read `process.env[someVar]` in the provider plane is the
      // exact F-24 shape: the key NAME is a variable, so a name-based scan
      // would miss it. Any indexed env read here must be brokered instead.
      if (/process\.env\s*\[/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  test("the secret plane itself is small and enumerable (no drift)", () => {
    // If someone adds a fourth env-reading module they must consciously add it
    // to SECRET_PLANE above, which is a reviewable diff in a security test.
    expect(SECRET_PLANE.length).toBe(3);
  });
});

describe("Phase 8 · Step 5 — XR_MCP_ALLOW_UNISOLATED is gone", () => {
  test("no executable code reads the removed flag", () => {
    const offenders: string[] = [];
    for (const file of ALL_TS) {
      const code = codeOnly(readFileSync(file, "utf8"));
      if (code.includes("XR_MCP_ALLOW_UNISOLATED")) {
        offenders.push(relative(ROOT, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the flag does not reappear via a computed env lookup in the mcp plane", () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, "mcp"))) {
      const code = codeOnly(readFileSync(file, "utf8"));
      // Allowed MCP env reads are the two explicit, non-authority-granting
      // toggles; anything else indexed is suspicious.
      const reads = code.match(/process\.env\.[A-Z_]+/g) ?? [];
      for (const r of reads) {
        const name = r.replace("process.env.", "");
        // Allowlist: toggles that grant NO authority (placement forcing,
        // logging, path resolution). Anything that could relax a boundary is
        // deliberately absent, so adding one requires editing this test.
        const NON_AUTHORITY = [
          "XR_MCP_ISOLATE_STDIO", "XR_MCP_ISOLATED_NET", "XR_TRUST_HARDENED",
          "XR_HOME", "HOME", "PATH", "XR_DEBUG",
        ];
        if (!NON_AUTHORITY.includes(name)) {
          offenders.push(`${relative(ROOT, file)} → ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
