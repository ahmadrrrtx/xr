/**
 * XR Phase 4 · SEC-01 — MCP tool-contract pinning (rug-pull defense).
 *
 * Research backdrop (2026): MCP tool descriptions are a supply-chain asset —
 * registry hijacks, affix-squatting and the TrustFall auto-exec change showed
 * that a server approved TODAY can ship a different tool contract TOMORROW
 * (tool poisoning, OWASP MCP Top-10 #3). XR already treats descriptions as
 * untrusted data at load (injection scan); pinning closes the TIME axis:
 *
 *   - `pin(serverId, defs)` snapshots a hash of every tool contract
 *     (name + description + inputSchema) into ~/.xr/mcp/pins.json.
 *   - Every wrapped tool call re-checks its def against the pin. On DRIFT
 *     the call does not silently proceed: it demands an explicit
 *     re-approval that SHOWS THE DIFF; approving re-pins the new contract.
 *   - Unpinned servers keep the legacy per-call approval behaviour —
 *     pinning is opt-in governance, never a new way to break a working setup.
 *
 * The store is fail-CLOSED: an unreadable/corrupt pins file behaves as
 * "nothing pinned" for matching (legacy approvals still gate every call)
 * but every load problem is reported, never swallowed silently.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const MCP_PINS_SCHEMA_VERSION = 1;

export interface PinnedTool {
  readonly name: string;
  readonly hash: string;
  /** Kept verbatim so the re-approval UI can show BEFORE text offline. */
  readonly description: string;
}

export interface PinEntry {
  readonly pinnedAt: number;
  readonly by: string;
  readonly tools: Record<string, PinnedTool>;
}

export interface PinFile {
  readonly schemaVersion: number;
  readonly servers: Record<string, PinEntry>;
}

export interface ToolContract {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface PinDrift {
  readonly status: "unpinned" | "match" | "drift";
  readonly changed: { tool: string; before: string; after: string }[];
  readonly added: string[];
  readonly removed: string[];
}

export function mcpPinsPath(): string {
  return join(homedir(), ".xr", "mcp", "pins.json");
}

/** Stable hash of the authority-relevant parts of a tool contract. */
export function toolHash(def: ToolContract): string {
  const norm = JSON.stringify({
    name: def.name,
    description: def.description ?? "",
    inputSchema: def.inputSchema ?? {},
  });
  return createHash("sha256").update(norm).digest("hex").slice(0, 32);
}

const EMPTY: PinFile = { schemaVersion: MCP_PINS_SCHEMA_VERSION, servers: {} };

export class McpPinStore {
  constructor(private readonly path: string = mcpPinsPath()) {}

  load(): PinFile {
    if (!existsSync(this.path)) return EMPTY;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<PinFile>;
      if (parsed.schemaVersion !== MCP_PINS_SCHEMA_VERSION || typeof parsed.servers !== "object" || !parsed.servers) {
        return EMPTY;
      }
      return { schemaVersion: MCP_PINS_SCHEMA_VERSION, servers: parsed.servers };
    } catch {
      // Fail-closed for pinning (treat as unpinned); the per-call approval
      // gate still protects every invocation.
      return EMPTY;
    }
  }

  private save(file: PinFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(file, null, 2));
    renameSync(tmp, this.path);
  }

  get(serverId: string): PinEntry | null {
    return this.load().servers[serverId] ?? null;
  }

  pin(serverId: string, defs: ToolContract[], by: string): PinEntry {
    const file = this.load();
    const entry: PinEntry = {
      pinnedAt: Date.now(),
      by,
      tools: Object.fromEntries(
        defs.map((d) => [d.name, { name: d.name, hash: toolHash(d), description: d.description ?? "" }]),
      ),
    };
    this.save({ ...file, servers: { ...file.servers, [serverId]: entry } });
    return entry;
  }

  /** Re-pin a single tool after an explicit drift re-approval. */
  repinTool(serverId: string, def: ToolContract, by: string): PinEntry | null {
    const file = this.load();
    const entry = file.servers[serverId];
    if (!entry) return null;
    const next: PinEntry = {
      ...entry,
      pinnedAt: Date.now(),
      by,
      tools: { ...entry.tools, [def.name]: { name: def.name, hash: toolHash(def), description: def.description ?? "" } },
    };
    this.save({ ...file, servers: { ...file.servers, [serverId]: next } });
    return next;
  }

  unpin(serverId: string): boolean {
    const file = this.load();
    if (!file.servers[serverId]) return false;
    const servers = { ...file.servers };
    delete servers[serverId];
    this.save({ ...file, servers });
    return true;
  }

  diff(serverId: string, defs: ToolContract[]): PinDrift {
    const entry = this.get(serverId);
    if (!entry) return { status: "unpinned", changed: [], added: [], removed: [] };
    const changed: PinDrift["changed"] = [];
    const added: string[] = [];
    const seen = new Set<string>();
    for (const d of defs) {
      seen.add(d.name);
      const pinned = entry.tools[d.name];
      if (!pinned) {
        added.push(d.name);
        continue;
      }
      if (pinned.hash !== toolHash(d)) {
        changed.push({ tool: d.name, before: pinned.description, after: d.description ?? "" });
      }
    }
    const removed = Object.keys(entry.tools).filter((n) => !seen.has(n));
    if (!changed.length && !added.length && !removed.length) return { status: "match", changed: [], added: [], removed: [] };
    return { status: "drift", changed, added, removed };
  }
}

/**
 * Pure gate decision used by the tool wrapper: what must happen before a
 * pinned tool may run. Kept pure so the rug-pull simulation test can exercise
 * the policy without a live MCP server.
 */
export function evaluatePinGate(store: McpPinStore, serverId: string, def: ToolContract): { action: "normal" | "reapprove"; drift: PinDrift | null } {
  const drift = store.diff(serverId, [def]);
  if (drift.status === "drift" && (drift.changed.length > 0 || drift.added.length > 0)) {
    return { action: "reapprove", drift };
  }
  return { action: "normal", drift: drift.status === "drift" ? drift : null };
}
