/**
 * Phase 14 — the desktop's engine wire, pure parts:
 *   · SSE framing (`data:` payloads, keepalive comments, split chunks, [DONE])
 *   · envelope decoding (providers that stream `{"message": "…"}` as tokens)
 * Relative imports — same convention as the other desktop tests (no path alias).
 */
import { describe, expect, test } from "bun:test";

import { createSseParser, parseSseLine, parseSseLines } from "../../desktop/src/engine/sse.ts";
import { EnvelopeDecoder, decodeJsonStringPrefix, visibleText } from "../../desktop/src/engine/envelope.ts";

describe("SSE parser — the engine's data: framing", () => {
  test("data payloads are returned, comments and blank lines are not", () => {
    const text = [": keepalive", "", 'data: {"type":"token","text":"hi"}', "", "data: [DONE]", ""].join("\n");
    expect(parseSseLines(text)).toEqual(['{"type":"token","text":"hi"}', "[DONE]"]);
  });

  test("a frame split across two network chunks is reassembled", () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"tok')).toEqual([]);
    expect(p.push('en","text":"a"}\n\ndata: {"type"')).toEqual(['{"type":"token","text":"a"}']);
    expect(p.push(':"done"}\n')).toEqual(['{"type":"done"}']);
    expect(p.end()).toEqual([]);
  });

  test("a trailing line without a newline is flushed at end()", () => {
    const p = createSseParser();
    expect(p.push("data: [DONE]")).toEqual([]);
    expect(p.end()).toEqual(["[DONE]"]);
  });

  test("CRLF line endings and the optional space after the colon are tolerated", () => {
    expect(parseSseLines("data:{\"a\":1}\r\n\r\ndata: x\r\n")).toEqual(['{"a":1}', "x"]);
  });

  test("event:/id:/retry: fields the engine never sends are ignored, not mistaken for data", () => {
    expect(parseSseLine("event: token")).toBeNull();
    expect(parseSseLine("id: 7")).toBeNull();
    expect(parseSseLine("retry: 1000")).toBeNull();
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine(": keepalive")).toBeNull();
  });
});

describe("Envelope decoder — raw `{\"message\": …}` tokens become visible prose progressively", () => {
  test("plain prose passes through untouched", () => {
    expect(visibleText("Hello there")).toBe("Hello there");
    expect(visibleText("  leading space kept")).toBe("  leading space kept");
  });

  test("an envelope reveals only the message body, token by token", () => {
    const d = new EnvelopeDecoder();
    expect(d.push('{"mess')).toBe("");
    expect(d.push('age": "Hel')).toBe("Hel");
    expect(d.push('lo\\nworld')).toBe("Hello\nworld");
    expect(d.push('"}')).toBe("Hello\nworld");
    expect(d.isEnvelope).toBe(true);
  });

  test("JSON escapes are decoded and an incomplete escape waits for the next token", () => {
    expect(decodeJsonStringPrefix('a\\"b\\\\c\\u00e9d"rest')).toBe('a"b\\céd');
    expect(decodeJsonStringPrefix("tail\\")).toBe("tail");
    expect(decodeJsonStringPrefix("x\\u00")).toBe("x");
  });

  test("prose that merely starts with a brace is not treated as an envelope", () => {
    const prose = "{braces} are fine in markdown";
    expect(visibleText(prose)).toBe(prose);
    const d = new EnvelopeDecoder();
    d.push(prose);
    expect(d.isEnvelope).toBe(false);
  });
});

// ── Mappers (engine shapes → desktop shapes) ────────────────────────────────
// wire.ts is the dependency-free mapper module (no desktop/node_modules needed here).
import { describeTool, resolveEngineModel, toApprovalRequest } from "../../desktop/src/engine/wire.ts";

describe("approval_required → ApprovalRequest (same id, engine resource, honest risk)", () => {
  test("keeps the engine id so the decision posts back to the right request", () => {
    const r = toApprovalRequest(
      { id: "ap_abc", tool: "write_file", reason: "model says so", args: { path: "notes/a.txt" }, riskTier: "medium", ttlMs: 300_000 },
      123,
    );
    expect(r.id).toBe("ap_abc");
    expect(r.skillId).toBe("write_file");
    expect(r.action).toBe("Write a file");
    expect(r.resource).toBe("notes/a.txt");
    expect(r.risk).toBe("medium");
    expect(r.justification).toBe("model says so");
    expect(r.createdAt).toBe(123);
  });

  test("Phase 17: a Builder scope becomes the rule resource (per project, not per path); new tools are named", () => {
    const r = toApprovalRequest({ id: "ap_s", tool: "patch", reason: "Apply 2 hunks to src/app.ts — Builder", args: { path: "src/app.ts", scope: "my-app (Builder)", hunks: 2 }, riskTier: "medium", ttlMs: 1 });
    expect(r.resource).toBe("my-app (Builder)");
    expect(r.action).toBe("Apply a diff");
    expect(r.justification).toContain("src/app.ts");
    expect(toApprovalRequest({ id: "ap_m", tool: "mkdir", reason: "", args: { path: "src/new" }, ttlMs: 1 }).action).toBe("Create a folder");
    expect(toApprovalRequest({ id: "ap_r", tool: "rename_file", reason: "", args: { path: "a", to: "b" }, ttlMs: 1 }).resource).toBe("a");
    expect(toApprovalRequest({ id: "ap_st", tool: "serve_static", reason: "", args: { path: ".", scope: "site (Builder)" }, riskTier: "low", ttlMs: 1 }).risk).toBe("low");
  });

  test("Phase 19: workflow human checks are human-only (no policy auto-approve, no remember rules); tools are not", () => {
    const h = toApprovalRequest({ id: "ap_h", tool: "workflow.human_approval", reason: "Ship it?", args: {}, riskTier: "low", ttlMs: 1 });
    expect(h.humanOnly).toBe(true);
    expect(h.action).toBe("Approve a workflow step");
    expect(toApprovalRequest({ id: "ap_rv", tool: "workflow.human_review", reason: "", args: {}, ttlMs: 1 }).humanOnly).toBe(true);
    expect(toApprovalRequest({ id: "ap_t", tool: "shell", reason: "", args: { cmd: "ls" }, ttlMs: 1 }).humanOnly).toBeUndefined();
  });

  test("shell commands surface the command as the resource; an unknown tool is humanised, not dropped", () => {
    expect(toApprovalRequest({ id: "ap_1", tool: "shell", reason: "", args: { command: "rm -rf build" }, ttlMs: 1 }).resource).toBe("rm -rf build");
    const odd = toApprovalRequest({ id: "ap_2", tool: "deploy_rocket", reason: "", args: {}, ttlMs: 1 });
    expect(odd.action.toLowerCase()).toContain("deploy");
    expect(odd.justification).toContain("deploy_rocket");
  });
});

describe("model ids and tool cards", () => {
  test("a bare Ollama tag resolves to the ollama provider; `provider/model` splits; cloud ids keep their provider", () => {
    expect(resolveEngineModel("qwen2.5:0.5b")).toEqual({ provider: "ollama", model: "qwen2.5:0.5b" });
    expect(resolveEngineModel("groq/llama-3.3-70b")).toEqual({ provider: "groq", model: "llama-3.3-70b" });
    expect(resolveEngineModel("gpt-4o-mini")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(resolveEngineModel("  ")).toEqual({});
  });

  test("tool cards summarise by category from the engine's call args", () => {
    expect(describeTool("shell", { command: "ls -la" })).toEqual({ summary: "$ ls -la", category: "shell" });
    expect(describeTool("read_file", { path: "README.md" })).toEqual({ summary: "read_file README.md", category: "file" });
    expect(describeTool("http_request", { url: "https://example.com" })).toEqual({ summary: "http_request https://example.com", category: "network" });
    expect(describeTool("mystery", undefined)).toEqual({ summary: "mystery", category: "tool" });
  });
});
