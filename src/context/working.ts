/**
 * Phase 09 — session memory and working memory.
 *
 * These are NOT durable stores. They never write to user_memory / context_items
 * unless a caller explicitly promotes a value through ContextService.record()
 * (which still runs the admission gate).
 *
 *   SESSION  — current conversation / execution turns. Dies with the session.
 *   WORKING  — bounded task state (objective, decisions, constraints, plan).
 *
 * Durable memory stays in MemoryStore / ContextService.
 * Procedural memory stays in SkillEngine (verification gates remain authoritative).
 */

import { boundText } from "./types.ts";

export const WORKING_MEMORY_BOUNDS = {
  maxItems: 32,
  maxChars: 8_000,
  maxItemChars: 1_200,
} as const;

export type WorkingKind =
  | "objective"
  | "decision"
  | "constraint"
  | "observation"
  | "plan"
  | "file"
  | "tool"
  | "note";

export interface WorkingItem {
  id: string;
  kind: WorkingKind;
  content: string;
  createdAt: number;
  updatedAt: number;
  /** Soft priority: higher survives compaction. */
  priority: number;
}

export interface SessionTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  at: number;
  name?: string;
}

export interface SessionSnapshot {
  sessionId: string;
  workspaceId: string;
  turns: SessionTurn[];
  chars: number;
}

/**
 * Bounded working set for the current task. Evicts lowest-priority oldest
 * items when over budget. Never persists.
 */
export class WorkingMemory {
  private readonly items = new Map<string, WorkingItem>();
  private seq = 0;

  constructor(
    private readonly bounds: { maxItems?: number; maxChars?: number } = {},
  ) {}

  get maxItems(): number {
    return this.bounds.maxItems ?? WORKING_MEMORY_BOUNDS.maxItems;
  }

  get maxChars(): number {
    return this.bounds.maxChars ?? WORKING_MEMORY_BOUNDS.maxChars;
  }

  put(kind: WorkingKind, content: string, opts: { id?: string; priority?: number; now?: number } = {}): WorkingItem {
    const now = opts.now ?? Date.now();
    const id = opts.id ?? `wm_${++this.seq}`;
    const item: WorkingItem = {
      id,
      kind,
      content: boundText(content.trim(), WORKING_MEMORY_BOUNDS.maxItemChars),
      createdAt: this.items.get(id)?.createdAt ?? now,
      updatedAt: now,
      priority: opts.priority ?? defaultPriority(kind),
    };
    this.items.set(id, item);
    this.enforceBudget();
    return this.items.get(id) ?? item;
  }

  get(id: string): WorkingItem | undefined {
    return this.items.get(id);
  }

  list(): WorkingItem[] {
    return [...this.items.values()].sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);
  }

  /** Highest-priority objective, if any. */
  objective(): WorkingItem | undefined {
    return this.list().find((i) => i.kind === "objective");
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  chars(): number {
    let n = 0;
    for (const i of this.items.values()) n += i.content.length;
    return n;
  }

  /**
   * Drop stale observations first, then lowest-priority notes, never the
   * current objective / decisions / constraints while anything else remains.
   */
  compact(): { dropped: string[] } {
    const dropped: string[] = [];
    const protectedKinds = new Set<WorkingKind>(["objective", "decision", "constraint"]);
    const victims = this.list()
      .filter((i) => !protectedKinds.has(i.kind))
      .sort((a, b) => a.priority - b.priority || a.updatedAt - b.updatedAt);
    while ((this.items.size > this.maxItems || this.chars() > this.maxChars) && victims.length) {
      const v = victims.shift()!;
      if (this.items.delete(v.id)) dropped.push(v.id);
    }
    return { dropped };
  }

  private enforceBudget(): void {
    if (this.items.size > this.maxItems || this.chars() > this.maxChars) {
      this.compact();
    }
  }
}

/**
 * Session memory: recent conversation turns. Not durable. Compaction folds
 * older turns into a short recap without touching durable stores.
 */
export class SessionMemory {
  private turns: SessionTurn[] = [];

  constructor(
    readonly sessionId: string,
    readonly workspaceId: string,
    private readonly maxTurns = 40,
  ) {}

  append(turn: Omit<SessionTurn, "at"> & { at?: number }): void {
    this.turns.push({
      role: turn.role,
      content: turn.content,
      at: turn.at ?? Date.now(),
      ...(turn.name ? { name: turn.name } : {}),
    });
    if (this.turns.length > this.maxTurns) {
      this.turns = this.turns.slice(-this.maxTurns);
    }
  }

  recent(n = 10): SessionTurn[] {
    return this.turns.slice(-Math.max(0, n));
  }

  snapshot(): SessionSnapshot {
    return {
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
      turns: [...this.turns],
      chars: this.turns.reduce((n, t) => n + t.content.length, 0),
    };
  }

  clear(): void {
    this.turns = [];
  }
}

function defaultPriority(kind: WorkingKind): number {
  switch (kind) {
    case "objective": return 100;
    case "constraint": return 90;
    case "decision": return 80;
    case "plan": return 70;
    case "tool": return 50;
    case "file": return 40;
    case "observation": return 20;
    case "note": return 10;
  }
}
