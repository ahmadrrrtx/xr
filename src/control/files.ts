import { homedir } from "node:os";
import { filesystemMessage, withFilesystem } from "../security/filesystem.ts";
import type { ActionResult } from "./types.ts";

/**
 * A1 F03: desktop control file actions go through the shared filesystem authority.
 * Paths are root-bound (no implicit outside-root access), sensitive paths are denied by
 * guard policy, and symlink/hardlink/special-file handling is the authority's, not ours.
 */
/** Resolved per call (not at module load) so the root cannot be fixed by whichever importer ran first. */
function sandboxRoot(): string {
  return process.env.XR_FILES_ROOT || homedir();
}

function normalize(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
}

function fail(prefix: string, e: unknown): ActionResult {
  return { ok: false, message: `${prefix}: ${filesystemMessage(e)}` };
}

export async function fileRead(path: string): Promise<ActionResult> {
  try {
    const txt = withFilesystem(sandboxRoot(), "desktop", (fs) => fs.read(normalize(path)).content);
    return { ok: true, message: `read ${txt.length} chars from ${path}`, data: { text: txt.slice(0, 200_000) } };
  } catch (e) { return fail("read failed", e); }
}

export async function fileWrite(path: string, content: string): Promise<ActionResult> {
  try {
    withFilesystem(sandboxRoot(), "desktop", (fs) => {
      const op = fs.prepare(normalize(path), "write");
      try { op.commit(content); } finally { op.close(); }
    });
    return { ok: true, message: `wrote ${content.length} chars to ${path}` };
  } catch (e) { return fail("write failed", e); }
}

export async function fileList(path: string): Promise<ActionResult> {
  try {
    const entries = withFilesystem(sandboxRoot(), "desktop", (fs) => fs.list(normalize(path) || "."));
    const out = entries.map((e) => (e.directory ? "[dir] " : "") + e.name).join("\n");
    return { ok: true, message: `${entries.length} entries in ${path}`, data: { list: out } };
  } catch (e) { return fail("list failed", e); }
}

export async function fileMkdir(path: string): Promise<ActionResult> {
  try {
    withFilesystem(sandboxRoot(), "desktop", (fs) => fs.mkdir(normalize(path)));
    return { ok: true, message: `mkdir ${path}` };
  } catch (e) { return fail("mkdir failed", e); }
}

/** Move is not offered by the authority yet (no anchored cross-directory rename proof). Explicit refusal, not a silent unsafe rename. */
export async function fileMove(src: string, dest: string): Promise<ActionResult> {
  void src; void dest;
  return { ok: false, message: "move failed: unsupported under the filesystem authority" };
}

export async function fileDelete(path: string): Promise<ActionResult> {
  try {
    withFilesystem(sandboxRoot(), "desktop", (fs) => {
      const op = fs.prepare(normalize(path), "delete");
      try { op.commit(); } finally { op.close(); }
    });
    return { ok: true, message: `deleted ${path}` };
  } catch (e) { return fail("delete failed", e); }
}

