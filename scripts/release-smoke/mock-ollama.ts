#!/usr/bin/env bun
/**
 * XR Preview 1 — loopback "Ollama" mock (WS3 / T12, used by scripts (Windows CI
 * and local Linux alike), because a governed agent turn is otherwise impossible
 * without a provider key and real tokens.
 *
 * Why the ollama preset: it is keyless (authType "none"), local (so pricing is
 * $0 and no budget path is exercised by accident) and speaks the OpenAI chat
 * API. Pointing a fake server at 127.0.0.1:11434 therefore makes
 * `xr --provider ollama --model mock "<task>"` a complete, honest agent turn:
 * real planner loop, real tool registry, real approval gate, real sandbox
 * decision — with fake tokens.
 *
 * It is a TEST DOUBLE and says so in every reply. It never claims to be a
 * model, and it never fabricates a tool result: it asks for a tool, the runtime
 * decides, and the second turn only reports what the runtime told it.
 *
 *   usage: bun scripts/release-smoke/mock-ollama.ts [--port 11434] [--tool shell] [--cmd "whoami"]
 *          (prints "MOCK READY <port>" on stdout once listening)
 */
const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
const PORT = Number(flag("port", "11434"));
const TOOL = flag("tool", "shell");
const CMD = flag("cmd", "whoami");
const HOST = "127.0.0.1";

let turns = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/models")) {
      return json({ object: "list", data: [{ id: "mock", object: "model" }] });
    }
    if (!url.pathname.endsWith("/chat/completions")) {
      return json({ error: { message: `mock: no route ${url.pathname}` } }, 404);
    }
    const body = (await req.json().catch(() => ({}))) as {
      messages?: { role: string; content?: unknown; tool_calls?: unknown }[];
    };
    const messages = body.messages ?? [];
    const alreadyTookATool = messages.some((m) => m.role === "tool" || m.role === "function");
    turns++;

    const usage = { prompt_tokens: 64, completion_tokens: 16, total_tokens: 80 };

    // Turn 1: ask for ONE tool call. Turn 2+: report the runtime's verdict
    // verbatim — this mock never invents a result.
    if (!alreadyTookATool) {
      return json({
        id: `mock-${turns}`,
        object: "chat.completion",
        model: "mock",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: `call_${turns}`,
                  type: "function",
                  function: { name: TOOL, arguments: JSON.stringify({ cmd: CMD }) },
                },
              ],
            },
          },
        ],
        usage,
      });
    }

    const toolMsg = messages.filter((m) => m.role === "tool" || m.role === "function").at(-1);
    const observed =
      typeof toolMsg?.content === "string" ? toolMsg.content.slice(0, 800) : JSON.stringify(toolMsg?.content ?? null);
    return json({
      id: `mock-${turns}`,
      object: "chat.completion",
      model: "mock",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: `MOCK-REPORT tool=${TOOL} runtime-said=${observed}`,
          },
        },
      ],
      usage,
    });
  },
});

console.log(`MOCK READY ${server.port}`);
