/** The interactive coding banner must use the canonical release identity. */
import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { CORE_VERSION } from "../../../src/core/version.ts";
import { runCoder } from "../../../src/cli/coder/index.ts";
import type { AgentPort } from "../../../src/cli/coder/session.ts";
import { Terminal } from "../../../src/cli/coder/tty.ts";

test("interactive coder banner matches the version command's release identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-coder-banner-"));
  const config = join(dir, "cli.json");
  writeFileSync(config, JSON.stringify({ provider: "ollama", model: "qwen2.5:7b" }));
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.defineProperty(input, "isTTY", { value: true, configurable: true });
  input.setRawMode = () => input;
  const terminal = new Terminal(input);
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  const output: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  let calls = 0;
  const agent: AgentPort = { async runTask() { calls++; throw new Error("no task should run"); } };
  const timer = setTimeout(() => input.write("\x04"), 30); // Ctrl+D exits the real REPL reader.
  try {
    const exit = await runCoder({
      print: false, json: false, diffOnly: false, approveAll: false,
      noHistory: true, noColor: true, cwd: dir, configPath: config,
    }, { agent, term: terminal });
    expect(exit).toBe(0);
    expect(calls).toBe(0);
    expect(output.join("")).toContain(`xr v${CORE_VERSION} · coding agent`);
  } finally {
    clearTimeout(timer);
    terminal.stop();
    input.destroy();
    write.mockRestore();
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
