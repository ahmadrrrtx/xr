/** Safety-sensitive CLI inputs must be meaningful or rejected before execution. */
import { describe, expect, test } from "bun:test";
import { parseGlobalFlags, EXIT } from "../../../src/cli/flags.ts";
import { coderRequestError, runCoder, type CoderRequest } from "../../../src/cli/coder/index.ts";
import { Terminal } from "../../../src/cli/coder/tty.ts";
import type { AgentPort } from "../../../src/cli/coder/session.ts";

const request: CoderRequest = {
  prompt: "offline fixture", print: false, json: true, diffOnly: false,
  approveAll: false, noHistory: true, noColor: true, cwd: process.cwd(),
};

describe("strict parsed safety limits", () => {
  test("valid USD/token flags preserve their exact numeric values", () => {
    const f = parseGlobalFlags(["--budget=0.000001", "--max-tokens", "1234"]);
    expect(f.budget).toBe(0.000001);
    expect(f.maxTokens).toBe(1234);
    expect(f.errors).toBeUndefined();
  });

  for (const value of ["0", "-1", "NaN", "Infinity", "nonsense", "", "  "]) {
    test(`invalid USD limit ${JSON.stringify(value)} is not silently ignored`, () => {
      const f = parseGlobalFlags([`--budget=${value}`]);
      expect(f.errors?.length).toBeGreaterThan(0);
    });
  }
  for (const value of ["0", "-1", "1.5", "12junk", "Infinity", "1e30", ""]) {
    test(`invalid token ceiling ${JSON.stringify(value)} is not truncated/defaulted`, () => {
      const f = parseGlobalFlags([`--max-tokens=${value}`]);
      expect(f.errors?.length).toBeGreaterThan(0);
    });
  }
  for (const flag of ["--budget", "--max-tokens", "--resume", "--mode"]) {
    test(`${flag} without a value is a usage error`, () => {
      expect(parseGlobalFlags([flag]).errors?.length).toBeGreaterThan(0);
    });
  }
  test("non-engine execution modes are retained, never silently converted to agent", () => {
    const f = parseGlobalFlags(["--mode", "typo"]);
    expect(f.mode).toBeUndefined();
    expect(f.commandMode).toBe("typo");
    expect(coderRequestError({ mode: f.commandMode })).toContain("--mode requires");
  });
  for (const mode of ["minimal", "local", "byok", "hybrid", "full"]) {
    test(`installer mode ${mode} is left for the command, but rejected by the coder`, () => {
      const f = parseGlobalFlags([`--mode=${mode}`, "install"]);
      expect(f.args).toEqual(["install"]);
      expect(f.errors).toBeUndefined();
      expect(f.commandMode).toBe(mode);
      expect(coderRequestError({ mode: f.commandMode })).toContain("--mode requires");
    });
  }
  test("the last mode selection wins across global and command-local vocabularies", () => {
    const engine = parseGlobalFlags(["--mode", "minimal", "--mode", "AGENT"]);
    expect(engine.mode).toBe("agent");
    expect(engine.commandMode).toBeUndefined();
    const installer = parseGlobalFlags(["--mode", "plan", "--mode", "minimal"]);
    expect(installer.mode).toBeUndefined();
    expect(installer.commandMode).toBe("minimal");
  });
  test("safety boolean equality is explicit, including false", () => {
    expect(parseGlobalFlags(["--dry-run=true"]).dryRun).toBe(true);
    expect(parseGlobalFlags(["--dryRun=false"]).dryRun).toBe(false);
    expect(parseGlobalFlags(["--diff=true"]).diffOnly).toBe(true);
    expect(parseGlobalFlags(["--diff=false"]).diffOnly).toBe(false);
    expect(parseGlobalFlags(["--dry-run=maybe"]).errors?.length).toBeGreaterThan(0);
    expect(parseGlobalFlags(["--diff=maybe"]).errors?.length).toBeGreaterThan(0);
  });
  test("literal text following -- is not reparsed as options", () => {
    const f = parseGlobalFlags(["--", "--budget", "0", "--resume"]);
    expect(f.errors).toBeUndefined();
    expect(f.args).toEqual(["--budget", "0", "--resume"]);
  });
});

describe("programmatic coder entry preflight", () => {
  test("legacy engine modes still parse, but the coder refuses unsupported modes", () => {
    expect(parseGlobalFlags(["run", "--mode", "plan"]).mode).toBe("plan");
    expect(coderRequestError({ mode: "plan" })).toContain("not yet supported");
    expect(coderRequestError({ mode: "ask" })).toContain("-p");
    expect(coderRequestError({ mode: "agent" })).toBeUndefined();
  });

  const invalid: Array<Partial<CoderRequest>> = [
    { resume: "missing-session" }, { mode: "plan" }, { mode: "ask" },
    { budget: 0 }, { budget: Number.NaN }, { budget: Number.POSITIVE_INFINITY },
    { maxTokens: 0 }, { maxTokens: 1.5 },
  ];
  for (const options of invalid) {
    test(`rejects ${Object.keys(options).join(",")} before config/model/terminal activity`, async () => {
      let calls = 0;
      const agent: AgentPort = { async runTask() { calls++; throw new Error("must not run"); } };
      const code = await runCoder({ ...request, ...options, configPath: "/not-read-because-preflight-refuses/cli.json" }, { agent, term: new Terminal() });
      expect(code).toBe(EXIT.USAGE);
      expect(calls).toBe(0);
    });
  }
});
