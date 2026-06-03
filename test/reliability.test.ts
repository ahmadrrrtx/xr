/**
 * XR — Phase 2 reliability tests: grammar builder + auto-repair + profiles.
 */
import { test, expect } from "bun:test";
import { buildEnvelopeGBNF } from "../src/reliability/grammar.ts";
import { repairToTurn } from "../src/reliability/repair.ts";
import { profileFor } from "../src/reliability/profiles.ts";

test("GBNF grammar includes the envelope root and tool name enum", () => {
  const g = buildEnvelopeGBNF(["read_file", "write_file"]);
  expect(g).toContain("root");
  expect(g).toContain("tool_calls");
  expect(g).toContain("read_file");
  expect(g).toContain("write_file");
  expect(g).toContain("boolean");
});

test("GBNF grammar with no tools still valid", () => {
  const g = buildEnvelopeGBNF([]);
  expect(g).toContain("root");
  expect(g).toContain("toolname");
});

test("repair: clean JSON", () => {
  const t = repairToTurn('{"message":"hi","tool_calls":[],"done":true}');
  expect(t.message).toBe("hi");
  expect(t.done).toBe(true);
  expect(t.toolCalls.length).toBe(0);
});

test("repair: fenced JSON", () => {
  const t = repairToTurn('```json\n{"message":"x","tool_calls":[{"tool":"read_file","args":{"path":"a"}}],"done":false}\n```');
  expect(t.toolCalls.length).toBe(1);
  expect(t.toolCalls[0].tool).toBe("read_file");
  expect((t.toolCalls[0].args as any).path).toBe("a");
});

test("repair: trailing commas + surrounding prose", () => {
  const t = repairToTurn('Sure! {"message":"ok","tool_calls":[],"done":true,} done.');
  expect(t.message).toBe("ok");
  expect(t.done).toBe(true);
});

test("repair: smart quotes", () => {
  const t = repairToTurn('{\u201Cmessage\u201D:\u201Chello\u201D,\u201Ctool_calls\u201D:[],\u201Cdone\u201D:true}');
  expect(t.message).toBe("hello");
});

test("repair: garbage falls back to a safe done turn", () => {
  const t = repairToTurn("the model said something weird with no json");
  expect(t.done).toBe(true);
  expect(t.toolCalls.length).toBe(0);
});

test("repair: malformed tool_calls are filtered", () => {
  const t = repairToTurn('{"message":"m","tool_calls":[{"nope":1},{"tool":"read_file","args":{}}],"done":false}');
  expect(t.toolCalls.length).toBe(1);
  expect(t.toolCalls[0].tool).toBe("read_file");
});

test("profile: local ollama uses grammar", () => {
  expect(profileFor("ollama", "qwen2.5:7b").structure).toBe("grammar");
});

test("profile: gemma disables thinking", () => {
  expect(profileFor("ollama", "gemma3:4b").disableThinking).toBe(true);
});

test("profile: groq uses json mode", () => {
  expect(profileFor("groq", "llama-3.3-70b").structure).toBe("json_mode");
});
