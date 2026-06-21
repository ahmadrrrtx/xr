import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve, relative } from "node:path";
import type { ActionResult } from "./types.ts";

const SANDBOX_ROOT = process.env.XR_FILES_ROOT || homedir();

function safePath(p: string): { ok: true; abs: string } | { ok: false; msg: string } {
  const abs = resolve(p.startsWith("~") ? p.replace(/^~/, homedir()) : p);
  const rel = relative(SANDBOX_ROOT, abs);
  if (rel.startsWith("..") || abs === SANDBOX_ROOT.replace(/\/$/, "") ? false : false) {}
  // allow outside HOME, but caller must approve – we just normalize here
  if (rel.startsWith("..")) return { ok: true, abs }; // allowed with approval gate upstream
  return { ok: true, abs };
}

export async function fileRead(path: string): Promise<ActionResult> {
  const s = safePath(path); if(!s.ok) return { ok:false, message:s.msg };
  try { const txt = await fs.readFile(s.abs, "utf8"); return { ok:true, message:`read ${txt.length} chars from ${path}`, data:{ text: txt.slice(0,200_000)} }; }
  catch(e){ return { ok:false, message:`read failed: ${(e as Error).message}` };}
}
export async function fileWrite(path: string, content: string): Promise<ActionResult> {
  const s = safePath(path); if(!s.ok) return { ok:false, message:s.msg };
  try { await fs.writeFile(s.abs, content, "utf8"); return { ok:true, message:`wrote ${content.length} chars to ${path}` }; }
  catch(e){ return { ok:false, message:`write failed: ${(e as Error).message}` };}
}
export async function fileList(path: string): Promise<ActionResult> {
  const s = safePath(path); if(!s.ok) return { ok:false, message:s.msg };
  try { const entries = await fs.readdir(s.abs, { withFileTypes:true }); const out = entries.map(e=> (e.isDirectory()?"[dir] ":"")+e.name).join("\n"); return { ok:true, message:`${entries.length} entries in ${path}`, data:{ list: out }};}
  catch(e){ return { ok:false, message:`list failed: ${(e as Error).message}` };}
}
export async function fileMkdir(path: string): Promise<ActionResult> {
  const s = safePath(path); if(!s.ok) return { ok:false, message:s.msg };
  try { await fs.mkdir(s.abs, { recursive:true }); return { ok:true, message:`mkdir ${path}` };}
  catch(e){ return { ok:false, message:`mkdir failed: ${(e as Error).message}` };}
}
export async function fileMove(src: string, dest: string): Promise<ActionResult> {
  const a = safePath(src); const b = safePath(dest);
  if(!a.ok) return { ok:false, message:a.msg }; if(!b.ok) return { ok:false, message:b.msg };
  try { await fs.rename(a.abs, b.abs); return { ok:true, message:`moved ${src} → ${dest}` };}
  catch(e){ return { ok:false, message:`move failed: ${(e as Error).message}` };}
}
export async function fileDelete(path: string): Promise<ActionResult> {
  const s = safePath(path); if(!s.ok) return { ok:false, message:s.msg };
  try { await fs.rm(s.abs, { recursive:true, force:false }); return { ok:true, message:`deleted ${path}` };}
  catch(e){ return { ok:false, message:`delete failed: ${(e as Error).message}` };}
}
