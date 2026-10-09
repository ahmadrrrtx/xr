/**
 * Phase 21 — zod schemas for the Memory Explorer endpoints. Re-exported from
 * schemas.ts; the contract lives in contract-memory.ts.
 */
import { z } from "zod/v4";

export const MEMORY_CATEGORY_VALUES = ["preference", "project", "workflow", "fact", "exclusion"] as const;

/** POST /api/memory — an explicit "remember this" from the user. */
export const MemoryCreateRequest = z.looseObject({
  content: z.string().min(1).max(2000),
  category: z.enum(MEMORY_CATEGORY_VALUES).optional(),
  scope: z.string().max(200).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  /** Days until expiry; omitted or null = never expires. */
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
  /** Set after the user has seen a sensitive-content warning and chosen to save anyway. */
  acknowledgeSensitive: z.boolean().optional(),
});

/** PATCH /api/memory/{id} — partial edit. */
export const MemoryUpdateRequest = z.looseObject({
  content: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
  acknowledgeSensitive: z.boolean().optional(),
});

/** POST /api/memory/import — an `xr-memory` bundle from GET /api/memory/export. */
export const MemoryImportRequest = z.looseObject({
  bundle: z.looseObject({ format: z.literal("xr-memory"), entries: z.array(z.unknown()) }),
  mode: z.enum(["merge", "replace"]).optional(),
  /** Required (true) for mode "replace": the UI shows the destructive warning first. */
  acknowledgeReplace: z.boolean().optional(),
});

/** GET/PUT /api/memory/settings. Auto-memory is reported off and cannot be turned on in this version. */
export const MemorySettingsRequest = z.looseObject({
  showExpired: z.boolean().optional(),
  autoMemory: z.boolean().optional(),
});

export const MemorySettingsResponse = z.looseObject({
  autoMemory: z.literal("off"),
  autoMemoryAvailable: z.literal(false),
  showExpired: z.boolean(),
});

/** POST /api/memory/consolidate — plan by default; apply only when apply is true. */
export const MemoryConsolidateRequest = z.looseObject({
  apply: z.boolean().optional(),
  olderThanDays: z.number().int().min(1).max(3650).optional(),
  maxImportance: z.number().int().min(1).max(5).optional(),
  scope: z.string().max(200).optional(),
});

/** POST /api/memory/scan-sensitive — read-only scan of text the user is about to save. */
export const MemoryScanRequest = z.looseObject({
  content: z.string().min(1).max(2000),
});

export const MemoryWriteResponse = z.looseObject({
  ok: z.boolean(),
  entry: z.unknown().optional(),
  reason: z.string().optional(),
});

export const MemoryGraphResponse = z.looseObject({
  method: z.literal("heuristic"),
  root: z.literal("me"),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  truncated: z.boolean(),
});
