/**
 * XR — e2e black-box: custom-provider lifecycle (Phase 0, M-05).
 *
 * The full automation path, end to end, in REAL processes:
 *   providers add --id … --base-url … --model … --yes
 *     → providers list  (fresh process)
 *     → providers set <id>  (fresh process; model-switch state machine)
 *     → run --provider <id> (fresh process)
 * and the failure safety of the unattended path (missing flags ⇒ usage
 * error, exit 2, never a prompt — an unattended CI step must not hang).
 *
 * Green on HEAD. The behavior-capture assertion on the wire (stream field
 * sent to a provider whose declared capability defaults to streaming:false)
 * pins F-03; Phase 1 flips it to the strict form and streaming-matrix.test.ts
 * carries the kill proof.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startStubOpenAI, type StubOpenAIHandle } from "../helpers/stub-openai.ts";
import {
  runCli,
  expectExit,
  expectNoTimedOut,
  readConfig,
  removeHome,
  freshHome,
  assertStubClosed,
} from "./helpers.ts";

let stub: StubOpenAIHandle;

/** Spawn-heavy lane: per-test wall-clock budget above bun's 5s default. */
const T = 60_000;
const ID = "e2e-added";

beforeAll(async () => {
  stub = await startStubOpenAI({ scenario: "sse-ok" });
});

afterAll(async () => {
  await assertStubClosed(stub, "providers-lifecycle stub");
});

test("providers add --yes: unattended add writes the same config shape as interactive", async () => {
  const r = await runCli([
    "providers",
    "add",
    "--id",
    ID,
    "--base-url",
    `${stub.baseUrl}`,
    "--model",
    stub.model,
    "--label",
    "E2E Added Stub",
    "--yes",
  ]);
  expectNoTimedOut(r);
  expectExit(r, 0);
  expect(r.stdout).toContain(`Custom provider "${ID}" added.`);

  const config = readConfig(r.home);
  const custom = (config.providerEngine?.customProviders ?? []) as Array<Record<string, any>>;
  const ours = custom.find((c) => c.id === ID);
  expect(ours).toBeDefined();
  // Same fields the interactive addCustomProvider writes (M-05 parity claim).
  expect(ours!.label).toBe("E2E Added Stub");
  expect(ours!.baseUrl).toBe(stub.baseUrl);
  expect(ours!.defaultModel).toBe(stub.model);
  expect(ours!.apiKeyEnv).toBeUndefined();
  // zod defaults applied at save: capabilities must be a complete record
  // (this is the same record the interactive path produces).
  expect(ours!.capabilities).toMatchObject({ chat: true, streaming: false, toolUse: false });
});

test("providers add --yes with missing flags: exit 2 (usage), no prompt, no hang", async () => {
  const r = await runCli(["providers", "add", "--id", ID, "--yes"], { timeoutMs: 30_000 });
  expectNoTimedOut(r);
  expectExit(r, 2);
  expect(r.stderr + r.stdout).toContain("--base-url");
});

test("providers add --yes rejects invalid base URLs (validation never weakened)", async () => {
  const r = await runCli([
    "providers",
    "add",
    "--id",
    ID,
    "--base-url",
    "not a url",
    "--model",
    stub.model,
    "--yes",
  ]);
  expectNoTimedOut(r);
  expectExit(r, 2);
  expect(r.stderr + r.stdout).toContain("--base-url");
});

test("providers list shows the custom provider in a FRESH process", async () => {
  // Seed config via the real add path, then list in a new process.
  const home = freshHome();
  try {
    const add = await runCli(
      ["providers", "add", "--id", ID, "--base-url", `${stub.baseUrl}`, "--model", stub.model, "--label", "E2E Added Stub", "--yes"],
      { home },
    );
    expectExit(add, 0);

    const list = await runCli(["providers", "list"], { home });
    expectNoTimedOut(list);
    expectExit(list, 0);
    expect(list.stdout).toContain(ID);
    expect(list.stdout).toContain("E2E Added Stub");
  } finally {
    removeHome(home);
  }
}, T);

test("providers set <custom> + run --provider <custom> work in fresh processes", async () => {
  const home = freshHome();
  try {
    const add = await runCli(
      ["providers", "add", "--id", ID, "--base-url", `${stub.baseUrl}`, "--model", stub.model, "--yes"],
      { home },
    );
    expectExit(add, 0);

    // set runs the model-switch state machine incl. a canary probe → the
    // stub's GET /models must satisfy it (this is the M-05 path: CLI-driven).
    const set = await runCli(["providers", "set", ID], { home });
    expectNoTimedOut(set);
    expectExit(set, 0);

    const run = await runCli(["run", "Lifecycle hello", "--provider", ID], { home });
    expectNoTimedOut(run);
    expectExit(run, 0);
    expect(run.stdout).toContain("done in 1 step(s)");
    expect(run.stdout).toContain("Hello from stub");

    // F-03 (Phase 1): a custom provider whose record declares
    // capabilities.streaming === false (zod default) is NEVER sent stream:true.
    // The capability catalog is honoured on the hot path. Strict proof in
    // streaming-matrix.test.ts.
    const chat = stub.chatRequests();
    expect(chat.length).toBeGreaterThan(0);
    const last = chat[chat.length - 1]!;
    expect(last.streamField).toBe(false);
  } finally {
    removeHome(home);
  }
}, T);

test("providers add --key-env: value in env is stored securely; absent env is reported honestly", async () => {
  const home = freshHome();
  try {
    const withKey = await runCli(
      [
        "providers", "add",
        "--id", "keyed-stub",
        "--base-url", `${stub.baseUrl}`,
        "--model", stub.model,
        "--key-env", "STUB_TEST_KEY",
        "--yes",
      ],
      { home, env: { STUB_TEST_KEY: "sk-test-123456" } },
    );
    expectNoTimedOut(withKey);
    expectExit(withKey, 0);
    expect(withKey.stdout).toContain("Key saved securely");
    // The key value must never appear in CLI output (redaction contract).
    expect(withKey.stdout + withKey.stderr).not.toContain("sk-test-123456");

    const noKeyEnv = await runCli(
      [
        "providers", "add",
        "--id", "nokey-stub",
        "--base-url", `${stub.baseUrl}`,
        "--model", stub.model,
        "--key-env", "UNSET_VAR_XYZ",
        "--yes",
      ],
      { home },
    );
    expectExit(noKeyEnv, 0);
    expect(noKeyEnv.stdout).toContain("No value found in $UNSET_VAR_XYZ");
  } finally {
    removeHome(home);
  }
}, T);
