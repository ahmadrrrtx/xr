/**
 * A1 F03: plugin fs capability. The plugin data directory is a root for the filesystem authority
 * (purpose "plugin"). Traversal, symlinks, hardlinks, special files and sensitive names are refused
 * by the authority; denials are fixed messages that never echo content.
 */
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { FilesystemError, withFilesystem } from "../security/filesystem.ts";

export const PLUGIN_FS_MAX = 10 * 1024 * 1024;
type Audit = (event: string, detail?: Record<string, unknown>) => void;

function relOk(rel: unknown, allowDot = false): string {
  if (typeof rel !== "string" || (!rel && !allowDot) || rel.length > 4096 || rel.includes("\0") || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new Error("invalid path");
  }
  return rel;
}

export function pluginFsRead(dataDir: string, rel: string, audit: Audit): string {
  relOk(rel);
  if (!existsSync(dataDir)) return "";
  try {
    return withFilesystem(dataDir, "plugin", (fs) => {
      const meta = fs.metadata(rel);
      if (meta.directory) throw new Error(`not a file: ${rel}`);
      if (meta.size > PLUGIN_FS_MAX) throw new Error(`file too large (max ${PLUGIN_FS_MAX}): ${rel}`);
      const snap = fs.readBytes(rel, PLUGIN_FS_MAX);
      audit("fs.read", { path: rel, size: snap.size });
      return snap.bytes.toString("utf8");
    });
  } catch (e) {
    if (e instanceof FilesystemError && e.code === "missing") return "";
    if (e instanceof Error && /^(not a file|file too large)/.test(e.message)) throw e;
    throw new Error(`fs.read denied: ${rel}`);
  }
}

export function pluginFsList(dataDir: string, rel: string, audit: Audit): string[] {
  if (rel !== ".") relOk(rel);
  if (!existsSync(dataDir)) return [];
  try {
    const names = withFilesystem(dataDir, "plugin", (fs) => fs.list(rel || ".", 600).map((e) => e.name));
    audit("fs.list", { path: rel });
    return names.filter((n) => !n.startsWith(".") && n !== "node_modules" && n !== "__pycache__");
  } catch (e) {
    if (e instanceof FilesystemError && e.code === "missing") return [];
    throw new Error(`fs.list denied: ${rel}`);
  }
}

export function pluginFsWrite(dataDir: string, rel: string, content: unknown, audit: Audit): void {
  relOk(rel);
  let text = typeof content === "string" ? content : String(content);
  if (text.length > PLUGIN_FS_MAX) throw new Error(`content too large (max ${PLUGIN_FS_MAX})`);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  try {
    withFilesystem(dataDir, "plugin", (fs) => {
      const op = fs.prepare(rel, "write", PLUGIN_FS_MAX);
      try { op.commit(text); } finally { op.close(); }
    });
  } catch {
    throw new Error(`fs.write denied: ${rel}`);
  }
  audit("fs.write", { path: rel, size: text.length });
  text = "";
}
