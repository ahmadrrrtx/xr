/**
 * Phase 03 · T3.24 — ONE execution path (critical test).
 *
 * The architecture invariant this phase must prove:
 *
 *   CLI   → AgentService.runTask()
 *   daemon→ AgentService.runTask()
 *
 * i.e. there is ONE agent execution kernel, and the daemon chat is a frontend
 * over it — never a second agent loop. This test fails the moment daemon chat
 * starts calling provider.chat()/buildProvider() directly again.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Remove block + line comments and string-literals that merely document calls. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/`[^`]*`/g, "") // template literals
    .replace(/"[^"\n]*"/g, ""); // double-quoted strings
}

test("daemon chat routes through AgentService, never provider.chat() directly", () => {
  const chat = codeOnly(read("src/daemon/routes/chat.routes.ts"));
  const executor = codeOnly(read("src/daemon/agent-executor.ts"));

  // The chat path must NOT orchestrate a provider directly.
  expect(chat).not.toMatch(/provider\.chat\(/);
  expect(chat).not.toMatch(/buildProvider\(/);
  expect(chat).not.toMatch(/provider\.stream\(/);

  // It MUST route through the canonical AgentService boundary.
  expect(chat).toMatch(/runHeld\(/);
  expect(chat).toMatch(/acquireLane\(/);
  expect(executor).toMatch(/Tokens\.Agent/);
  expect(executor).toMatch(/agent\.runTask\(/);
});

test("no provider.chat()/buildProvider() remains in the chat or agent-executor modules", () => {
  const chat = codeOnly(read("src/daemon/routes/chat.routes.ts"));
  const exec = codeOnly(read("src/daemon/agent-executor.ts"));
  for (const s of [chat, exec]) {
    expect(s).not.toMatch(/\.chat\(/);
    expect(s).not.toMatch(/buildProvider\(/);
  }
});

test("daemon workspace switch uses the canonical XRApp.switchWorkspace, not inline lifecycle", () => {
  const prov = codeOnly(read("src/daemon/routes/providers.routes.ts"));
  // The canonical method must be called.
  expect(prov).toMatch(/executor\.switchWorkspace\(/);
  // No inline workspace lifecycle bypass remains in the switch handler.
  expect(prov).not.toMatch(/previousStore\.close\(/);
  expect(prov).not.toMatch(/workspaceManager\.setActiveId\(/);
  expect(prov).not.toMatch(/workspaceManager\.getStore\(/);
});

test("provider health is served by the shared ProviderHealthChecker", () => {
  const prov = codeOnly(read("src/daemon/routes/providers.routes.ts"));
  // Phase 04 — providers.list must use the shared cached health engine via gateway
  // which internally uses checkProviderHealthCached bounded cached deduped.
  const usesSharedHealth = /checkProviderHealthCached\(/.test(prov) || /providerGateway\.health/.test(prov) || /providerGateway\.healthAll/.test(prov);
  expect(usesSharedHealth).toBeTrue();
});

test("surface identity: daemon records itself as the canonical daemon surface", () => {
  // Raw source (string literals preserved) — the daemon surface identity.
  const raw = read("src/daemon/agent-executor.ts");
  expect(raw).toMatch(/surface: SurfaceId = opts\.surface \?\? "daemon"/);
});
