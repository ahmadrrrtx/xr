/**
 * Phase 18 · Research runs — operation contract entries (schemas live in
 * schemas-research.ts; spread
 * into the main registry in contract.ts; kept here so the registry stays
 * under the size gate without losing its single-map semantics).
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  OkResponse,
  ResearchRunStartRequest,
  ResearchRunStartResponse,
  ResearchRunResponse,
  ResearchRunEventFrame,
  ResearchPdfUploadResponse,
  ResearchSettingsResponse,
  ResearchSettingsPatchRequest,
  ResearchRememberResponse,
} from "./schemas.ts";

const base = { tag: "research", stability: "experimental" as const };
const RUN_ID = [{ name: "runId", description: "Run id from research.run.start." }];

export const RESEARCH_RUN_CONTRACT: Record<string, ApiOperationMeta> = {
  "research.run.start": {
    ...base,
    summary: "Start a full research run (plan → search → read → extract → synthesize) through the same engine as `xr research`; returns immediately with a run id to stream.",
    request: ResearchRunStartRequest,
    response: ResearchRunStartResponse,
  },
  "research.run.get": {
    ...base,
    summary: "Status of a research run (state, session id, result once finished).",
    template: "/api/research/run/{runId}",
    pathParams: RUN_ID,
    response: ResearchRunResponse,
  },
  "research.run.stream": {
    ...base,
    summary: "Stream a research run as Server-Sent Events: buffered replay, then live run_started · status · log · plan · search · sources · fetch · extract · contradictions · budget · run_completed | run_error · stream_end.",
    sse: true,
    template: "/api/research/run/{runId}/stream",
    pathParams: RUN_ID,
    response: ResearchRunEventFrame,
  },
  "research.run.cancel": {
    ...base,
    summary: "Cancel a research run — the abort reaches the in-flight model call and page fetch; the session persists as stopped (cancelled) with everything gathered so far.",
    template: "/api/research/run/{runId}/cancel",
    pathParams: RUN_ID,
    response: OkResponse,
  },
  "research.upload.pdf": {
    ...base,
    summary: "Extract text from an uploaded PDF (multipart field `file`, ≤ 20 MB) in memory — nothing is written to disk; attach the text to a run as a document.",
    response: ResearchPdfUploadResponse,
  },
  "research.settings.get": {
    ...base,
    summary: "Research network posture: whether the search host is allow-listed and whether research may fetch the public web.",
    response: ResearchSettingsResponse,
  },
  "research.settings.set": {
    ...base,
    summary: "Persist research.allowPublicWeb (the research-only public-web fetch path; the egress allow-list and SSRF guard still apply).",
    request: ResearchSettingsPatchRequest,
    response: ResearchSettingsResponse,
  },
  "research.remember": {
    ...base,
    summary: "Save a finished research finding to durable memory as model synthesis (provenance + per-source links); explicit, never automatic.",
    template: "/api/research/{id}/remember",
    pathParams: [{ name: "id", description: "Research session id." }],
    response: ResearchRememberResponse,
  },
};
