import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { createRepoIntelligence, type RepoIntelligence } from "../../src/repo/index.ts";

export function tempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

export function openStore(workspaceId: string, dir: string): WorkspaceStore {
  return new WorkspaceStore(workspaceId, join(dir, `${workspaceId}.db`));
}

export async function indexTree(
  workspaceId: string,
  files: Record<string, string>,
): Promise<{ intel: RepoIntelligence; store: WorkspaceStore; root: string; home: string }> {
  const home = tempDir("xr-repo");
  const root = join(home, "proj");
  mkdirSync(root, { recursive: true });
  writeTree(root, files);
  process.env.XR_HOME = home;
  const store = openStore(workspaceId, home);
  const intel = createRepoIntelligence({ workspaceId, root, store });
  await intel.index({ force: true });
  return { intel, store, root, home };
}

export function cleanup(home: string, store?: WorkspaceStore): void {
  try {
    store?.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Minimal XR-shaped fixture used by golden coding tasks. */
export const GOLDEN_TREE: Record<string, string> = {
  "src/providers/gateway.ts": `
export class ProviderGateway {
  constructor(private readonly fallback: string) {}
  selectProvider(id: string): string {
    return id || this.fallback;
  }
  async withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try { return await primary(); } catch { return fallback(); }
  }
}
export function selectProvider(id: string): string { return id; }
`,
  "src/providers/openai-compat.ts": `
import { ProviderGateway } from "./gateway.ts";
export class OpenAICompat {
  constructor(private readonly gateway: ProviderGateway) {}
  async chat(): Promise<string> { return "ok"; }
}
`,
  "src/daemon/routes/chat.routes.ts": `
import { ProviderGateway } from "../../providers/gateway.ts";
export function createChatStream(gateway: ProviderGateway): void {
  gateway.selectProvider("primary");
}
export async function handleChat(): Promise<void> {}
`,
  "src/skills/marketplace-backend.ts": `
export function listMarketplace(): string[] { return []; }
export function installSkill(id: string): boolean { return Boolean(id); }
`,
  "src/daemon/routes/extensions.routes.ts": `
import { listMarketplace } from "../../skills/marketplace-backend.ts";
export function skillsApi(): string[] { return listMarketplace(); }
export function handleSkillsRoute(): void { skillsApi(); }
`,
  "src/daemon/routes/contract.ts": `
export const API_CONTRACT = { skills: "/api/v1/skills" };
`,
  "src/execution/checkpoint.ts": `
export function writeCheckpoint(runId: string): void { void runId; }
export function isSideEffectSafe(kind: string): boolean { return kind === "plan_recorded"; }
`,
  "src/execution/recovery.ts": `
import { writeCheckpoint } from "./checkpoint.ts";
export function recoverInterrupted(): void { writeCheckpoint("resume"); }
export function runStartupRecovery(): void { recoverInterrupted(); }
`,
  "src/mcp/manager.ts": `
export class McpManager {
  loadEnabled(): void {}
}
export function mcpTools(): string[] { return []; }
`,
  "src/mcp/allowlist.ts": `
export function isAllowed(server: string): boolean { return server !== "*"; }
export const DEFAULT_DENY = true;
`,
  "src/security/tool-output.ts": `
export function scanUntrusted(text: string): boolean { return /ignore previous/i.test(text); }
export function frameToolOutput(text: string): string { return text; }
`,
  "src/context/memory/rag.ts": `
export function retrieve(query: string): string[] { return [query]; }
export function indexProject(): number { return 0; }
`,
  "src/context/retrieval.ts": `
export class ContextRetrieval {
  retrieve(query: string): string { return query; }
}
export function hybridRetrieve(query: string): string { return query; }
`,
  "src/state/workspace-store.ts": `
export class WorkspaceStore {
  constructor(public readonly workspaceId: string) {}
}
`,
};
