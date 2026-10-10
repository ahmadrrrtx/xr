/**
 * Phase 23 — the approval gate's decision order, driven with fake keys (no TTY, no engine).
 */
import { describe, expect, test } from "bun:test";
import { ApprovalGate, kindOf } from "../../../src/cli/coder/approvals.ts";
import { Sink } from "../../../src/cli/coder/sink.ts";
import type { KeyInput } from "../../../src/cli/coder/key-input.ts";
import type { ApprovalRequest } from "../../../src/core/types.ts";

/**
 * Keys that answer prompts from a scripted list. Like the real dispatcher, a key that
 * is not offered is ignored (not consumed as an answer). Running out of script throws
 * and sets `exhausted`, so a test can tell "waited for a key" from "got a decision".
 */
function fakeKeys(answers: string[] | null) {
  const queue = [...(answers ?? [])];
  const state = { exhausted: false };
  const keys = {
    available: answers !== null,
    state,
    async readKey(allowed: readonly string[]) {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) {
          state.exhausted = true;
          throw new Error("no more scripted keys");
        }
        if (allowed.includes(next)) return next;
      }
    },
    start() {},
    stop() {},
    setConsumer() {
      return null;
    },
    setInterceptor() {
      return null;
    },
  };
  // A structural fake: KeyInput is a class with private state, so it is cast here on purpose.
  return keys as unknown as KeyInput & { state: { exhausted: boolean } };
}

function gate(opts: { keys?: string[] | null; approveAll?: boolean; diffOnly?: boolean }) {
  const audits: Array<[string, Record<string, unknown>]> = [];
  const sink = new Sink("plain", false);
  const keys = fakeKeys(opts.keys ?? null);
  const g = new ApprovalGate({
    sink,
    keys: keys as never,
    approveAll: opts.approveAll ?? false,
    diffOnly: opts.diffOnly ?? false,
    cwd: process.cwd(),
    audit: (event, detail) => audits.push([event, detail]),
  });
  return { g, audits, keys };
}

const edit = (path = "src/x.ts", content = "export const x = 1;\n"): ApprovalRequest =>
  ({ tool: "write_file", args: { path, content }, reason: `edit ${path}` }) as unknown as ApprovalRequest;
const shell = (cmd: string): ApprovalRequest => ({ tool: "shell", args: { cmd }, reason: `run: ${cmd}`, preview: cmd }) as unknown as ApprovalRequest;

describe("approval kinds", () => {
  test("tools map to kinds", () => {
    expect(kindOf("write_file")).toBe("edit");
    expect(kindOf("delete_file")).toBe("delete");
    expect(kindOf("shell")).toBe("shell");
    expect(kindOf("read_file")).toBe("other");
  });
});

describe("decision order", () => {
  test("diff mode records the proposal and never approves", async () => {
    const { g } = gate({ diffOnly: true, approveAll: true });
    expect(await g.decide(edit())).toBe(false);
    expect(g.proposals.length).toBe(1);
    expect((g.proposals[0] as { path: string }).path).toBe("src/x.ts");
    expect(await g.decide(shell("ls"))).toBe(false);
    expect(g.proposals.length).toBe(2);
  });

  test("no terminal means denied, with an audit entry", async () => {
    const { g, audits } = gate({ keys: null });
    expect(await g.decide(edit())).toBe(false);
    expect(g.denied).toBe(1);
    expect(audits.some(([e]) => e === "cli.approval.denied")).toBe(true);
  });

  test("--approve-all approves ordinary edits and commands", async () => {
    const { g, audits } = gate({ keys: null, approveAll: true });
    expect(await g.decide(edit())).toBe(true);
    expect(await g.decide(shell("bun test"))).toBe(true);
    expect(g.approvedWrites).toEqual(["src/x.ts"]);
    expect(g.approvedShell).toEqual(["bun test"]);
    expect(audits.filter(([e]) => e === "cli.approval.auto").length).toBe(2);
  });

  test("--approve-all never approves a dangerous command without a human", async () => {
    const { g } = gate({ keys: null, approveAll: true });
    expect(await g.decide(shell("sudo rm /etc/hosts"))).toBe(false);
  });

  test("dangerous command with a terminal prompts, even under --approve-all", async () => {
    const { g } = gate({ keys: ["y"], approveAll: true });
    expect(await g.decide(shell("sudo ls /root"))).toBe(true);
  });

  test("dangerous prompt offers no session-wide 'a' (the key is ignored, the next answer wins)", async () => {
    const { g } = gate({ keys: ["a", "n"] });
    expect(await g.decide(shell("sudo ls /root"))).toBe(false);
    expect(g.sessionGrants.has("shell")).toBe(false);
  });
});

describe("human prompt", () => {
  test("y approves once", async () => {
    const { g } = gate({ keys: ["y"] });
    expect(await g.decide(edit())).toBe(true);
    expect(g.sessionGrants.size).toBe(0);
  });

  test("n denies", async () => {
    const { g } = gate({ keys: ["n"] });
    expect(await g.decide(edit())).toBe(false);
    expect(g.denied).toBe(1);
  });

  test("a grants the kind for the rest of the session", async () => {
    const { g } = gate({ keys: ["a"] });
    expect(await g.decide(shell("bun test"))).toBe(true);
    expect(g.sessionGrants.has("shell")).toBe(true);
    // The next shell is approved without asking (no scripted key left: a prompt would throw).
    expect(await g.decide(shell("bun build"))).toBe(true);
    expect(g.approvedShell).toEqual(["bun test", "bun build"]);
  });

  test("d shows the full view and then waits for a decision", async () => {
    const { g } = gate({ keys: ["d", "n"] });
    expect(await g.decide(edit())).toBe(false);
  });

  test("k on a shell cancels the turn (kill)", async () => {
    let killed = false;
    const sink = new Sink("plain", false);
    const g = new ApprovalGate({
      sink,
      keys: fakeKeys(["k"]),
      approveAll: false,
      diffOnly: false,
      cwd: process.cwd(),
      audit: () => {},
      onKill: () => {
        killed = true;
      },
    });
    expect(await g.decide(shell("bun test"))).toBe(false);
    expect(killed).toBe(true);
  });

  test("a key that is not offered for this prompt is ignored", async () => {
    // Offered for edits: y n a d v. "k" (shell-only) must not decide, so "y" does.
    const { g } = gate({ keys: ["k", "y"] });
    expect(await g.decide(edit())).toBe(true);
  });

  test("every refusal is recorded with its tool, target, and reason", async () => {
    // No keys (non-interactive): an edit is refused and recorded.
    const a = gate({ keys: null });
    expect(await a.g.decide(edit())).toBe(false);
    expect(a.g.denials).toEqual([
      expect.objectContaining({ tool: "write_file", kind: "edit", reason: "non-interactive" }),
    ]);
    // --diff: refused as a preview, and recorded.
    const b = gate({ keys: ["y"], diffOnly: true });
    expect(await b.g.decide(shell("ls"))).toBe(false);
    expect(b.g.denials[0]).toEqual(expect.objectContaining({ kind: "shell", target: "ls", reason: "diff-only" }));
    // The user declines at the prompt: recorded as user-declined.
    const c = gate({ keys: ["n"] });
    expect(await c.g.decide(edit())).toBe(false);
    expect(c.g.denials.at(-1)?.reason).toBe("user-declined");
  });

  test("approved actions are not recorded as denials", async () => {
    const { g } = gate({ approveAll: true });
    expect(await g.decide(edit())).toBe(true);
    expect(g.denials).toEqual([]);
  });
});
