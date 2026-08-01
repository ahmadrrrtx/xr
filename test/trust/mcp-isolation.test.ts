import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  buildIsolatedStdioSpawn,
  decideMcpStdioPlacement,
  detectBwrap,
  mcpServerRisk,
} from "../../src/runtime/trust/isolated-spawn.ts";
import { McpClient } from "../../src/mcp/client.ts";

const NS_AVAILABLE = await detectBwrap();
let W: string;
let hostSecret: string;
const HOST_SECRET = `MCP_HOST_SECRET_${randomUUID().replace(/-/g, "")}`;

beforeAll(() => {
  W = mkdtempSync(join(tmpdir(), "xr-mcp-iso-"));
  hostSecret = join(tmpdir(), `xr-mcp-iso-secret-${randomUUID().slice(0, 8)}.txt`); // outside W, under tmpfs /tmp
  writeFileSync(hostSecret, HOST_SECRET);
});

afterAll(() => {
  try { rmSync(W, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(hostSecret, { force: true }); } catch { /* noop */ }
});

describe("XR 4.2 MCP stdio placement decision (pure)", () => {
  const F = { isolateStdio: false, allowNet: false, allowUnisolated: false };
  test("high-risk + sandbox → isolated", () => {
    expect(decideMcpStdioPlacement("high", true, F)).toBe("isolated");
  });
  test("high-risk + no sandbox + no ack → BLOCKED (fail closed)", () => {
    expect(decideMcpStdioPlacement("high", false, F)).toBe("blocked");
  });
  test("high-risk + no sandbox + explicit ack (hardened OFF) → confined (warned)", () => {
    expect(decideMcpStdioPlacement("high", false, { ...F, allowUnisolated: true }, false)).toBe("confined");
  });
  // Phase 4 · T1 — hardened mode (default): the unisolated escape hatch is
  // refused even with an explicit ack; fail-closed is not negotiable.
  test("high-risk + no sandbox + explicit ack (hardened ON) → BLOCKED", () => {
    expect(decideMcpStdioPlacement("high", false, { ...F, allowUnisolated: true }, true)).toBe("blocked");
  });
  test("low-risk + sandbox + force → isolated; otherwise confined", () => {
    expect(decideMcpStdioPlacement("low", true, { ...F, isolateStdio: true })).toBe("isolated");
    expect(decideMcpStdioPlacement("low", true, F)).toBe("confined");
    expect(decideMcpStdioPlacement("low", false, F)).toBe("confined");
  });
});

describe("XR 4.2 MCP server risk classification", () => {
  test("stdio + apiKeyEnv → high", () => {
    expect(mcpServerRisk({ transport: "stdio", apiKeyEnv: "MY_KEY" })).toBe("high");
  });
  test("stdio + sensitive env key → high", () => {
    expect(mcpServerRisk({ transport: "stdio", env: { API_TOKEN: "x" } })).toBe("high");
  });
  test("stdio plain → low; http with key → low (network client, egress-gated elsewhere)", () => {
    expect(mcpServerRisk({ transport: "stdio" })).toBe("low");
    expect(mcpServerRisk({ transport: "http", apiKeyEnv: "K" })).toBe("low");
  });
});

describe("XR 4.2 isolated stdio spawn (real boundary)", () => {
  test("buildIsolatedStdioSpawn produces a confined bwrap argv", async () => {
    if (!NS_AVAILABLE) return;
    const spec = await buildIsolatedStdioSpawn("myserver", ["--flag"], { MY_ENV: "v" }, { writableRoot: W });
    expect(spec).not.toBeNull();
    expect(spec!.argv[0]).toBe("bwrap");
    expect(spec!.argv).toContain("--unshare-net"); // no network by default
    expect(spec!.argv).toContain("--setenv");
    const i = spec!.argv.indexOf("--");
    expect(spec!.argv.slice(i + 1)).toEqual(["myserver", "--flag"]);
    // with allowNet, the net namespace is shared
    const specNet = await buildIsolatedStdioSpawn("s", [], {}, { writableRoot: W, allowNet: true });
    expect(specNet!.argv).not.toContain("--unshare-net");
  });

  test("a spawned isolated stdio process is confined (host secret absent, no network) and passes stdio through", async () => {
    if (!NS_AVAILABLE) return;
    const script = `cat ${hostSecret} 2>/dev/null || echo NO_HOST_SECRET; (exec 3<>/dev/tcp/1.1.1.1/443) 2>/dev/null && echo NET_OK || echo NET_BLOCKED; read line; echo "ECHO:$line"`;
    const spec = await buildIsolatedStdioSpawn("sh", ["-c", script], {}, { writableRoot: W });
    expect(spec).not.toBeNull();
    const child = spawn(spec!.argv[0], spec!.argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: spec!.outerEnv });
    let out = "";
    child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
    await new Promise((r) => setTimeout(r, 300));
    child.stdin!.write("ping\n");
    await new Promise((r) => setTimeout(r, 400));
    try { child.kill("SIGKILL"); } catch { /* noop */ }
    expect(out).toContain("NO_HOST_SECRET");
    expect(out).not.toContain(HOST_SECRET);
    expect(out).toContain("NET_BLOCKED");
    expect(out).toContain("ECHO:ping"); // stdio passes through the sandbox
  });

  test("a high-risk MCP stdio server connects INSIDE the sandbox (isIsolated=true)", async () => {
    if (!NS_AVAILABLE) return;
    // A minimal inline JSON-RPC server that answers `initialize` (extracts the id).
    // Passed as argv (sh -c <script>), so it needs no file binding inside the sandbox.
    const script =
      "read req; id=$(printf '%s' \"$req\" | grep -o '\"id\":[0-9]*' | grep -o '[0-9]*'); " +
      "printf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"capabilities\":{\"tools\":{}}}}\\n' \"$id\"";
    process.env.XR_TEST_MCP_KEY = "test-key-value-123";
    const client = new McpClient({
      id: "s",
      transport: "stdio",
      command: "sh",
      args: ["-c", script],
      apiKeyEnv: "XR_TEST_MCP_KEY", // makes it high-risk → isolated
    } as any);
    const caps = await client.connect();
    expect(client.isIsolated).toBe(true);
    expect(caps).toBeDefined();
    await client.disconnect();
    delete process.env.XR_TEST_MCP_KEY;
  });
});
