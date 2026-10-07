/**
 * Phase 18 — zod schemas for the research run routes (start/get/stream/cancel,
 * PDF upload, settings, remember). Re-exported from schemas.ts so the client
 * generator can name them; the contract lives in contract-research.ts.
 */
import { z } from "zod/v4";

export const ResearchRunDocument = z.looseObject({
  name: z.string().min(1).max(160).describe("Display name (PDF file name or workspace-relative path)."),
  text: z.string().min(1).max(600_000).describe("Extracted text; joins the run as a fetched `local` source."),
  kind: z.enum(["pdf", "local"]).default("local"),
});

export const ResearchRunStartRequest = z.looseObject({
  query: z.string().min(1).max(2000).describe("What to research. URLs inside the text are fetched directly."),
  depth: z.enum(["quick", "deep", "thorough"]).default("deep").describe("Engine budget tier (DEPTH_BUDGETS)."),
  mode: z.enum(["quick", "deep", "thorough", "compare", "factcheck", "briefing"]).optional(),
  allowPublicWeb: z.boolean().optional().describe("Per-run opt-OUT only: false disables public-web fetches even when config allows them; true never widens config."),
  provider: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  documents: z.array(ResearchRunDocument).max(20).optional(),
});

export const ResearchRunStartResponse = z.looseObject({
  runId: z.string(),
  state: z.string(),
  provider: z.string(),
  model: z.string(),
  searchAvailable: z.boolean(),
  publicWeb: z.boolean(),
  depth: z.string(),
  mode: z.string(),
  documents: z.number().int(),
});

export const ResearchRunResponse = z.looseObject({
  run: z.looseObject({
    id: z.string(),
    state: z.enum(["queued", "running", "done", "stopped", "cancelled", "error"]),
    topic: z.string(),
    sessionId: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    cancelRequested: z.boolean(),
  }),
});

/** One SSE frame of a run stream (discriminated on `type`; see src/research/run-events.ts). */
export const ResearchRunEventFrame = z.looseObject({
  type: z.enum(["run_started", "status", "log", "plan", "search", "sources", "fetch", "extract", "contradictions", "budget", "run_completed", "run_error", "stream_end"]),
  runId: z.string(),
});

export const ResearchPdfUploadResponse = z.looseObject({
  name: z.string(),
  bytes: z.number().int(),
  pages: z.number().int(),
  pagesRead: z.number().int(),
  chars: z.number().int(),
  text: z.string(),
  truncated: z.boolean(),
});

export const ResearchSettingsResponse = z.looseObject({
  allowPublicWeb: z.boolean(),
  searchAvailable: z.boolean(),
  searchHost: z.string(),
  egressAllowlist: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
});

export const ResearchSettingsPatchRequest = z.looseObject({
  allowPublicWeb: z.boolean().describe("Persisted to config.research.allowPublicWeb (research-only public-web fetch path)."),
});

export const ResearchRememberResponse = z.looseObject({
  ok: z.boolean(),
  memoryId: z.string().nullable().optional(),
  duplicate: z.boolean().optional(),
  linkedSources: z.number().int().optional(),
  reason: z.string().optional(),
});
