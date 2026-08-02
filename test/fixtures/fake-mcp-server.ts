/**
 * XR test fixture — minimal MCP stdio server for allowlist/isolation tests.
 * Speaks just enough JSON-RPC (2025-06-18) to satisfy initialize +
 * tools/list, so McpClient.connect() completes fast.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, terminal: false });

function respond(id: number, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

rl.on("line", (line) => {
  let msg: { id?: number; method?: string };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    respond(msg.id as number, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-mcp", version: "1.0.0" },
    });
  } else if (msg.method === "tools/list") {
    respond(msg.id as number, {
      tools: [
        { name: "echo", description: "echo back the input", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
      ],
    });
  } else if (msg.method === "resources/list") {
    respond(msg.id as number, { resources: [] });
  } else if (msg.method === "prompts/list") {
    respond(msg.id as number, { prompts: [] });
  } else if (msg.method === "ping") {
    respond(msg.id as number, {});
  }
  // notifications/initialized etc. get no response (spec).
});

// Keep the process alive until stdin closes.
