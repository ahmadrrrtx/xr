/**
 * XR 5.1 — Filesystem environment provider.
 *
 * Adds what the raw file executor cannot know: pre-image capture for
 * compensatable writes/mkdirs, workspace scoping visibility, and honest
 * cleanup notes. Destructive deletes remain irreversible and are never
 * compensated (that would be a false claim).
 */
import { withFilesystem, FilesystemError } from "../../../security/filesystem.ts";
import { isAbsolute, relative, resolve } from "node:path";
import type { Action } from "../../../control/types.ts";

export interface PreImage {
  kind: "file_content" | "directory_created" | "move_source";
  path: string;
  content?: string; // captured for small files only (≤ 1 MiB)
  note: string;
}

const MAX_PREIMAGE_BYTES = 1024 * 1024;

/**
 * Capture a pre-image for compensation BEFORE a file write/mkdir executes.
 * Returns null for actions that need no pre-image (read/list) or cannot have
 * one (delete is irreversible by contract and is never compensated).
 */
export async function capturePreImage(action: Action, workspaceRoot: string): Promise<PreImage | null> {
  if (action.type !== "file") return null;
  if (action.op === "write") {
    try {
      const snapshot = withFilesystem(workspaceRoot, "preview", fs => fs.read(action.path, MAX_PREIMAGE_BYTES));
      return { kind: "file_content", path: action.path, content: snapshot.content, note: `pre-image of existing file (${snapshot.size} bytes)` };
    } catch (e) {
      if (e instanceof FilesystemError && e.code === "missing") return { kind: "file_content", path: action.path, note: "file did not exist — compensation removes the written file" };
      // A rejected read is not evidence of absence and must not turn into destructive compensation.
      return null;
    }
  }
  if (action.op === "mkdir") {
    return { kind: "directory_created", path: action.path, note: "compensation removes the created directory (must be empty)" };
  }
  if (action.op === "move") {
    return { kind: "move_source", path: action.path, note: `compensation moves ${action.targetPath ?? "?"} back to ${action.path}` };
  }
  return null;
}

/** Describe the compensation step for a captured pre-image (never executed silently). */
export function describeCompensation(pre: PreImage): string {
  switch (pre.kind) {
    case "file_content":
      return pre.content != null ? `restore previous content of ${pre.path}` : `remove ${pre.path} (it did not exist before)`;
    case "directory_created":
      return `remove directory ${pre.path} if empty`;
    case "move_source":
      return `move the entry back to ${pre.path}`;
  }
}

/** Restrict a path notionally to the workspace for reporting (enforcement stays in files.ts). */
export function isInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const abs = resolve(workspaceRoot, path);
  const root = resolve(workspaceRoot);
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
