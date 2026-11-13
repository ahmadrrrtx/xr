/**
 * Model + provider-endpoint schemas (XR-REL-02, XR-REL-06).
 *
 * Split out of `schemas.ts` when it crossed the 800-line gate; same convention
 * as `schemas-memory.ts` / `schemas-agents.ts` — re-exported from `schemas.ts`
 * so every existing import path keeps working.
 */
import { z } from "zod/v4";

export const LocalRouting = z.enum(["local-only", "hybrid", "cloud-first"]);

export const ModelsSelectRequest = z.looseObject({
  runtime: z.string().optional().describe("Local runtime id (e.g. ollama, lmstudio)."),
  model: z.string().optional(),
  routing: LocalRouting.optional(),
});

export const ModelsTestRequest = z.looseObject({ runtime: z.string().optional(), model: z.string().optional() });

/** XR-REL-02 — `model` is required: this downloads bytes, so it may not infer a target. */
export const ModelsPullRequest = z.looseObject({ runtime: z.string().optional(), model: z.string().min(1) });

/** XR-REL-06 — `id` is derived when omitted; the URL is SSRF-guarded before saving. */
export const CustomProviderAddRequest = z.looseObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "id must be lowercase letters, digits, '.' '_' or '-'")
    .optional(),
  label: z.string().min(1).max(120).optional(),
  baseUrl: z.string().min(1).max(2048),
  defaultModel: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(8192).optional(),
  apiKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "apiKeyEnv must look like AN_ENV_VAR")
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const CustomProviderRemoveRequest = z.looseObject({ id: z.string().min(1).max(64) });
