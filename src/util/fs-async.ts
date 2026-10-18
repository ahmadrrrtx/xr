/**
 * XR — async filesystem helpers for daemon hot paths.
 * Prefer these over *Sync APIs inside request handlers and long-running scans.
 */
import { promises as fsp } from "node:fs";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return fsp.readFile(p, "utf8");
}

export async function readBytes(p: string): Promise<Uint8Array> {
  const buf = await fsp.readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function writeText(p: string, content: string, mode?: number): Promise<void> {
  await fsp.writeFile(p, content, mode != null ? { mode } : undefined);
}

export async function writeBytes(p: string, data: Uint8Array | Buffer): Promise<void> {
  await fsp.writeFile(p, data);
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export async function removePath(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
  await fsp.rm(p, { recursive: opts?.recursive ?? false, force: opts?.force ?? false });
}

export async function listDir(p: string): Promise<string[]> {
  return fsp.readdir(p);
}

export async function realpath(p: string): Promise<string> {
  return fsp.realpath(p);
}

export async function mkdtempPath(prefix: string): Promise<string> {
  return fsp.mkdtemp(prefix);
}
