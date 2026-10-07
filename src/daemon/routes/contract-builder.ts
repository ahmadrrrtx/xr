/**
 * Phase 17 · Builder — operation contract entries (spread into the main
 * registry in contract.ts; kept here so the registry stays under the size
 * gate without losing its single-map semantics).
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  BuilderApplyDiffRequest,
  BuilderDevServerResponse,
  BuilderDevServerStartRequest,
  BuilderDevServerStopResponse,
  BuilderDiagnosticsRequest,
  BuilderDiagnosticsResponse,
  BuilderFileCreateRequest,
  BuilderFileDeleteRequest,
  BuilderFileReadRequest,
  BuilderFileReadResponse,
  BuilderFileRenameRequest,
  BuilderFileWriteRequest,
  BuilderGitResponse,
  BuilderMutationEvent,
  BuilderProjectEvent,
  BuilderProjectOpenRequest,
  BuilderProjectResponse,
  BuilderProjectsListResponse,
  BuilderTreeResponse,
  BuilderUndoRequest,
} from "./schemas.ts";

const ID = [{ name: "projectId", description: "Project id from builder.projects.open." }];
const T = (tail: string) => `/api/builder/projects/{projectId}/${tail}`;
const base = { tag: "builder", stability: "experimental" as const };

export const BUILDER_CONTRACT: Record<string, ApiOperationMeta> = {
  "builder.projects.open": {
    ...base,
    summary: "Register/open an absolute folder as a Builder project (validated, realpath'd, audited) → stable id for every other Builder route.",
    request: BuilderProjectOpenRequest,
    response: BuilderProjectResponse,
  },
  "builder.projects.list": { ...base, summary: "Projects this daemon has open.", response: BuilderProjectsListResponse },
  "builder.tree": {
    ...base,
    summary: "Project tree (heavy folders listed, not descended; 4 000-entry cap) with git badges and branch.",
    template: T("tree"),
    pathParams: ID,
    response: BuilderTreeResponse,
  },
  "builder.file.read": {
    ...base,
    summary: "Read a text file inside the project (?path=, 512 KB cap, binary detected).",
    template: T("file"),
    pathParams: ID,
    request: BuilderFileReadRequest,
    response: BuilderFileReadResponse,
  },
  "builder.file.write": {
    ...base,
    summary: "Save a file — SSE: approval_required (write_file, per-project scope) → applied | denied; stale mtime answers 409 first.",
    template: T("file/write"),
    pathParams: ID,
    request: BuilderFileWriteRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.file.create": {
    ...base,
    summary: "Create an empty file or a folder — SSE consent stream (create_file | mkdir).",
    template: T("file/create"),
    pathParams: ID,
    request: BuilderFileCreateRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.file.rename": {
    ...base,
    summary: "Rename/move inside the project — SSE consent stream (rename_file).",
    template: T("file/rename"),
    pathParams: ID,
    request: BuilderFileRenameRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.file.delete": {
    ...base,
    summary: "Delete a file or folder (recursive, stated in the approval) — SSE consent stream (delete_file).",
    template: T("file/delete"),
    pathParams: ID,
    request: BuilderFileDeleteRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.applyDiff": {
    ...base,
    summary: "Apply selected hunks of a unified diff — dry-run first (conflicts → 409, nobody asked), then SSE consent stream (patch) with a backup for undo.",
    template: T("apply-diff"),
    pathParams: ID,
    request: BuilderApplyDiffRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.undo": {
    ...base,
    summary: "Restore the backup an apply-diff made — SSE consent stream (write_file).",
    template: T("undo"),
    pathParams: ID,
    request: BuilderUndoRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.git": { ...base, summary: "Branch, dirty flag and per-path badges for the project.", template: T("git"), pathParams: ID, response: BuilderGitResponse },
  "builder.diagnostics": {
    ...base,
    summary: "Syntax diagnostics from the PROJECT's own TypeScript (transpileModule); {available:false} when it is not installed.",
    template: T("diagnostics"),
    pathParams: ID,
    request: BuilderDiagnosticsRequest,
    response: BuilderDiagnosticsResponse,
  },
  "builder.devServer.status": {
    ...base,
    summary: "Detected dev command (vite/next/cra/node/cargo/django/flask/static), live status and the recent log tail.",
    template: T("dev-server"),
    pathParams: ID,
    response: BuilderDevServerResponse,
  },
  "builder.devServer.start": {
    ...base,
    summary: "Start the dev server — deterministic policy gate, then SSE consent stream (shell; static sites: serve_static) → applied{status}.",
    template: T("dev-server/start"),
    pathParams: ID,
    request: BuilderDevServerStartRequest,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.devServer.stop": { ...base, summary: "Stop the project's dev server (SIGTERM → 2 s → SIGKILL).", template: T("dev-server/stop"), pathParams: ID, response: BuilderDevServerStopResponse },
  "builder.devServer.install": {
    ...base,
    summary: "Install dependencies with the lockfile's package manager — SSE consent stream (shell); output streams on the events feed.",
    template: T("dev-server/install"),
    pathParams: ID,
    response: BuilderMutationEvent,
    sse: true,
  },
  "builder.events": {
    ...base,
    summary: "Live feed (SSE): dev-server log/ready/exit/status and debounced fs:changed batches from a recursive watcher.",
    template: T("events"),
    pathParams: ID,
    response: BuilderProjectEvent,
    sse: true,
  },
};
