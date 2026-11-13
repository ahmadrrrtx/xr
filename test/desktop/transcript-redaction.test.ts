import { expect, test } from "bun:test";
import { transcriptFilename, transcriptMarkdown } from "../../desktop/src/lib/transcript.ts";
import type { ChatMessage } from "../../desktop/src/lib/chat-db.ts";

const key = "sk-faketranscript-ABCD1234567890";
const opaque = "opaque-fixture-secret-987654";
const bearer = "fixture-ABCDEF0123456789+/==";
const outputSecret = "opaque-output-secret-76543";

test("desktop export masks synthetic keys in title, message, tool input and JSON output", () => {
  const messages: ChatMessage[] = [{
    id: "message-1", sessionId: "s", role: "assistant", content: `hello ${key}`,
    createdAt: 1_750_000_000_000,
    metadata: { segments: [{ type: "text", text: `hello ${key}` }, { type: "tool", index: 0 }] },
    toolCalls: [{ id: "tool-1", tool: "lookup", summary: `found ${key}`, category: "tool", status: "done", input: { nested: { password: opaque } }, output: JSON.stringify({ response: { apiKey: outputSecret }, message: `Bearer ${bearer}`, note: "Ordinary 127.0.0.1 and a@example.org" }) }],
  }];
  const text = transcriptMarkdown(`demo ${key}`, messages);
  for (const secret of [key, opaque, outputSecret, bearer, "ABCD1234567890", "ABCDEF0123456789"]) expect(text).not.toContain(secret);
  expect(text).toContain("Ordinary 127.0.0.1 and a@example.org");
  expect(text).toContain("review before sharing");
});


test("private-key block is redacted before the tool-output line limit", () => {
  const pem = `-----BEGIN PRIVATE KEY-----\n${"synthetic-fixture-line\n".repeat(45)}-----END PRIVATE KEY-----`;
  const messages: ChatMessage[] = [{
    id: "m", sessionId: "s", role: "assistant", content: "", createdAt: 1_750_000_000_000,
    metadata: { segments: [{ type: "tool", index: 0 }] },
    toolCalls: [{ id: "t", tool: "read", summary: "result", category: "tool", status: "done", output: `${pem}\nvisible after block` }],
  }];
  const text = transcriptMarkdown("test", messages);
  expect(text).not.toContain("synthetic-fixture-line");
  expect(text).toContain("visible after block");
  expect(text).toContain("⟨redacted:pem⟩");
});


test("suggested filename redacts recognized credentials before slugging", () => {
  const name = transcriptFilename(`demo ${key} Bearer ${bearer}`);
  expect(name).toBe("demo-redacted-redacted.md");
  expect(name).not.toContain("abcd1234567890");
  expect(transcriptFilename("Project notes")).toBe("project-notes.md");
});
