import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CustomAgentStore,
  CustomAgentValidationError,
  isCustomAgentId,
  toAgentDefinition,
  validateCustomAgentInput,
} from "../../src/agents/custom-store.ts";

const root = mkdtempSync(join(tmpdir(), "xr-custom-agents-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const KNOWN = ["read_file", "write_file", "list_dir", "shell", "fetch_url", "web_search", "check_package"];
const PROMPT = "You review pull requests for correctness, clarity and risk. Be terse.";

function fresh(now?: () => number) {
  return new CustomAgentStore({ dir: mkdtempSync(join(root, "s-")), knownTools: KNOWN, ...(now ? { now } : {}) });
}

describe("custom agent validation", () => {
  test("rejects missing name, short prompt, unknown tools, out-of-range budget and destructiveApproval=false", () => {
    const res = validateCustomAgentInput(
      { name: "", systemPrompt: "too short", tools: ["read_file", "rm_rf"], budget: { perRunUsd: 9 }, constitution: { destructiveApproval: false } },
      KNOWN,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.problems.map((p) => p.path).sort()).toEqual(["budget.perRunUsd", "constitution.destructiveApproval", "name", "systemPrompt", "tools"]);
  });

  test("accepts a minimal agent and normalises tools/budget", () => {
    const res = validateCustomAgentInput({ name: "  Reviewer ", systemPrompt: PROMPT, tools: ["read_file", "read_file"], budget: { perRunUsd: "0.256" } }, KNOWN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe("Reviewer");
    expect(res.value.tools).toEqual(["read_file"]);
    expect(res.value.budget?.perRunUsd).toBe(0.26);
  });
});

describe("CustomAgentStore", () => {
  test("create → list → get → update (version bump) → delete, persisted as one JSON file per agent", () => {
    let t = 1_000;
    const store = fresh(() => t++);
    const a = store.create({ name: "PR reviewer", systemPrompt: PROMPT, tools: ["read_file"], emoji: "🔍" });
    expect(isCustomAgentId(a.id)).toBe(true);
    expect(a.version).toBe(1);
    expect(a.constitution.destructiveApproval).toBe(true);
    expect(a.constitution.askBeforeShell).toBe(true);
    expect(readdirSync(store.directory)).toEqual([`${a.id}.json`]);

    const b = store.update(a.id, { description: "Reviews PRs", tools: ["read_file", "list_dir"] });
    expect(b.version).toBe(2);
    expect(b.description).toBe("Reviews PRs");
    expect(b.tools).toEqual(["read_file", "list_dir"]);
    expect(b.systemPrompt).toBe(PROMPT); // untouched fields survive a partial update
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt);

    const onDisk = JSON.parse(readFileSync(join(store.directory, `${a.id}.json`), "utf8"));
    expect(onDisk.schemaVersion).toBe("xr-5.0.0/agent-v1");
    expect(onDisk.version).toBe(2);

    expect(store.list().map((x) => x.id)).toEqual([a.id]);
    expect(store.get(a.id)?.version).toBe(2);
    expect(store.remove(a.id)).toBe(true);
    expect(store.remove(a.id)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  test("update with invalid data throws field problems and leaves the file untouched", () => {
    const store = fresh();
    const a = store.create({ name: "Writer", systemPrompt: PROMPT });
    expect(() => store.update(a.id, { tools: ["nope"] })).toThrow(CustomAgentValidationError);
    expect(store.get(a.id)?.version).toBe(1);
  });

  test("import keeps a free well-formed id, re-mints a taken one, and ignores server-owned fields", () => {
    const store = fresh();
    const doc = { id: "custom-imported-abc123", name: "Imported", systemPrompt: PROMPT, version: 42, createdAt: 1, tools: ["web_search"] };
    const first = store.import(doc);
    expect(first.id).toBe("custom-imported-abc123");
    expect(first.version).toBe(1);
    const second = store.import(doc);
    expect(second.id).not.toBe(first.id);
    expect(store.list()).toHaveLength(2);
  });

  test("hand-edited files with unknown tools or a foreign schema are ignored, not loaded", () => {
    const store = fresh();
    writeFileSync(join(store.directory, "custom-bad-1.json"), JSON.stringify({ schemaVersion: "xr-5.0.0/agent-v1", id: "custom-bad-1", name: "Bad", systemPrompt: PROMPT, tools: ["rm_rf"] }));
    writeFileSync(join(store.directory, "custom-bad-2.json"), JSON.stringify({ schemaVersion: "other", id: "custom-bad-2", name: "Bad", systemPrompt: PROMPT }));
    writeFileSync(join(store.directory, "notes.txt"), "x");
    expect(store.list()).toEqual([]);
  });

  test("projects onto AgentDefinition with permissions derived from tools and constitution", () => {
    const store = fresh();
    const a = store.create({ name: "Ops", systemPrompt: PROMPT, tools: ["shell", "fetch_url"], role: "devops", model: "gpt-4o-mini", constitution: { allowPublicWeb: true, memoryWrite: true } });
    const def = toAgentDefinition(a);
    expect(def.builtin).toBe(false);
    expect(def.role).toBe("devops");
    expect(def.toolScope).toEqual({ mode: "allowlist", tools: ["shell", "fetch_url"] });
    expect(def.permissions.shell).toBe(true);
    expect(def.permissions.writeFiles).toBe(false);
    expect(def.permissions.network).toBe(true);
    expect(def.permissions.memoryWrite).toBe(true);
    expect(def.permissions.destructiveExec).toBe(false);
    expect(def.providerScope.model).toBe("gpt-4o-mini");
  });
});
