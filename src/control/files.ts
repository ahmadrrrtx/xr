import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canonicalAbsolute, FilesystemAuthority, FilesystemError, filesystemMessage, withFilesystem } from "../security/filesystem.ts";
import { AuthorityRegistry } from "../runtime/trust/authority.ts";
import { filesystemFromGrant } from "../runtime/trust/filesystem.ts";
import type { ActionResult } from "./types.ts";

/**
 * A1 F03: desktop control file actions go through the shared filesystem authority.
 *
 * Scope (decided in A1):
 * - Default desktop scope is the root `XR_FILES_ROOT` or the home directory. Paths inside it
 *   use the desktop purpose directly.
 * - Paths outside that root are refused unless the caller names a trusted registry grant
 *   (`grantId`). The grant must be registered, unexpired, unrevoked, bound to the desktop purpose
 *   and to its own root, and the path must be inside that root. A grant is minted only by trusted
 *   host code after its approval gate. Nothing in the model text can create one.
 * - Sensitive paths are denied by the authority's policy even inside a grant, unless the grant
 *   carries an explicit sensitive-read consent for that exact object.
 */

let grantRegistry: AuthorityRegistry | null = null;

/** Trusted host wiring: the daemon installs its Trust registry here. `null` removes it. */
export function setDesktopGrantRegistry(registry: AuthorityRegistry | null): void {
  grantRegistry = registry;
}

/** Resolved per call (not at module load) so the root cannot be fixed by whichever importer ran first. */
function sandboxRoot(): string {
  return process.env.XR_FILES_ROOT || homedir();
}

function normalize(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
}

const inside = (root: string, abs: string) => {
  const rel = relative(root, abs);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
};

/**
 * Run `fn` with an authority rooted where `path` is allowed to live, and with the path expressed
 * relative to that root. Throws FilesystemError("denied") when no scope covers it.
 */
function withDesktopFs<T>(path: string, grantId: string | undefined, fn: (fs: FilesystemAuthority, rel: string) => T): T {
  const root = sandboxRoot();
  // Relative paths are root-relative (the same meaning the authority always gave them).
  const expanded = normalize(path);
  const abs = canonicalAbsolute(isAbsolute(expanded) ? expanded : join(root, expanded));
  if (inside(canonicalAbsolute(root), abs)) {
    // The authority re-derives the root-relative form from the canonical absolute path.
    return withFilesystem(root, "desktop", (fs) => fn(fs, abs));
  }
  if (!grantId || !grantRegistry) throw new FilesystemError("denied");
  const grant = grantRegistry.get(grantId);
  if (!grant) throw new FilesystemError("denied");
  // The grant's own identity is the use identity: validity, revocation and expiry are still checked
  // inside filesystemFromGrant against the registry.
  const fs = filesystemFromGrant(grantRegistry, {
    grantId,
    actor: grant.actor,
    executionId: grant.executionId,
    workspaceId: grant.workspaceId,
    purpose: "desktop",
  });
  try {
    if (!inside(fs.root, abs)) throw new FilesystemError("denied");
    return fn(fs, abs);
  } finally {
    fs.close();
  }
}

function fail(prefix: string, e: unknown): ActionResult {
  return { ok: false, message: `${prefix}: ${filesystemMessage(e)}` };
}

export async function fileRead(path: string, grantId?: string): Promise<ActionResult> {
  try {
    const txt = withDesktopFs(path, grantId, (fs, rel) => fs.read(rel).content);
    return { ok: true, message: `read ${txt.length} chars from ${path}`, data: { text: txt.slice(0, 200_000) } };
  } catch (e) { return fail("read failed", e); }
}

export async function fileWrite(path: string, content: string, grantId?: string): Promise<ActionResult> {
  try {
    withDesktopFs(path, grantId, (fs, rel) => {
      const op = fs.prepare(rel, "write");
      try { op.commit(content); } finally { op.close(); }
    });
    return { ok: true, message: `wrote ${content.length} chars to ${path}` };
  } catch (e) { return fail("write failed", e); }
}

export async function fileList(path: string, grantId?: string): Promise<ActionResult> {
  try {
    const entries = withDesktopFs(path, grantId, (fs, rel) => fs.list(rel || "."));
    const out = entries.map((e) => (e.directory ? "[dir] " : "") + e.name).join("\n");
    return { ok: true, message: `${entries.length} entries in ${path}`, data: { list: out } };
  } catch (e) { return fail("list failed", e); }
}

export async function fileMkdir(path: string, grantId?: string): Promise<ActionResult> {
  try {
    withDesktopFs(path, grantId, (fs, rel) => fs.mkdir(rel));
    return { ok: true, message: `mkdir ${path}` };
  } catch (e) { return fail("mkdir failed", e); }
}

/** Move is not offered by the authority yet (no anchored cross-directory rename proof). Explicit refusal, not a silent unsafe rename. */
export async function fileMove(src: string, dest: string): Promise<ActionResult> {
  void src; void dest;
  return { ok: false, message: "move failed: unsupported under the filesystem authority" };
}

export async function fileDelete(path: string, grantId?: string): Promise<ActionResult> {
  try {
    withDesktopFs(path, grantId, (fs, rel) => {
      const op = fs.prepare(rel, "delete");
      try { op.commit(); } finally { op.close(); }
    });
    return { ok: true, message: `deleted ${path}` };
  } catch (e) { return fail("delete failed", e); }
}
