/**
 * Phase 21 · Memory Explorer — operation contract entries (schemas live in
 * schemas-memory.ts; spread into the main registry in contract.ts). Kept in
 * its own file so the registry stays under the module size threshold.
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  MemoryCreateRequest,
  MemoryUpdateRequest,
  MemoryImportRequest,
  MemoryWriteResponse,
  MemoryGraphResponse,
  MemorySettingsRequest,
  MemorySettingsResponse,
  MemoryConsolidateRequest,
  MemoryScanRequest,
} from "./schemas-memory.ts";

const memory = { tag: "memory", stability: "experimental" as const };
const MEMORY_ID = [{ name: "id", description: "Memory entry id." }];

export const MEMORY_EXPLORER_CONTRACT: Record<string, ApiOperationMeta> = {
  "memory.create": {
    ...memory,
    summary: "Explicitly remember something (user-provenance write). Refused for do-not-remember matches; sensitive content needs acknowledgeSensitive.",
    template: "/api/memory",
    request: MemoryCreateRequest,
    response: MemoryWriteResponse,
  },
  "memory.update": {
    ...memory,
    summary: "Edit a memory's content, tags, importance or expiry. Exclusion and sensitivity checks apply to edits.",
    template: "/api/memory/{id}",
    pathParams: MEMORY_ID,
    request: MemoryUpdateRequest,
    response: MemoryWriteResponse,
  },
  "memory.export": {
    ...memory,
    summary: "Export this workspace's memory as an xr-memory JSON bundle (includes provenance).",
    template: "/api/memory/export",
  },
  "memory.import": {
    ...memory,
    summary: "Import an xr-memory bundle (merge, or replace with acknowledgeReplace). Sensitive entries are skipped, not imported.",
    template: "/api/memory/import",
    request: MemoryImportRequest,
  },
  "memory.settings.get": {
    ...memory,
    summary: "Memory settings. Auto-memory is reported off and cannot be enabled in this version.",
    template: "/api/memory/settings",
    response: MemorySettingsResponse,
  },
  "memory.settings.put": {
    ...memory,
    summary: "Update memory settings (show expired). Turning on auto-memory is refused with 409.",
    template: "/api/memory/settings",
    request: MemorySettingsRequest,
    response: MemorySettingsResponse,
  },
  "memory.consolidate": {
    ...memory,
    summary: "Plan (default) or apply (apply: true) consolidation of old, low-importance memories into a summary. Originals are superseded, not deleted.",
    template: "/api/memory/consolidate",
    request: MemoryConsolidateRequest,
  },
  "memory.scan": {
    ...memory,
    summary: "Scan text for sensitive patterns (card numbers, SSNs, API and private keys) without saving it.",
    template: "/api/memory/scan-sensitive",
    request: MemoryScanRequest,
  },
  "memory.graph": {
    ...memory,
    summary: "Heuristic entity graph over memories (people, projects, files, tools). Read-only.",
    template: "/api/memory/graph",
    response: MemoryGraphResponse,
  },
};
