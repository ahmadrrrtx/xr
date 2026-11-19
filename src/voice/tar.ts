/**
 * B12 — npm tarball extraction off the event loop: gunzip on the threadpool,
 * async writes (fs.promises loops short writes). Understands the ustar prefix,
 * pax `x` path/size records, GNU `L` long names and base-256 sizes. Kept
 * EXACTLY from the old extractor (regression-tested): only regular files (`0`/
 * NUL) are written — symlinks, hardlinks and every other type are skipped — any
 * path containing `..` is skipped, and the first segment (`package/`) is
 * stripped. A resolved-path containment check is added on top.
 */
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const gunzipAsync = promisify(gunzip);
type Pax = { path?: string; size?: number };

/** Extract `package/*` from an npm tgz into `dest`; resolves with the number of files written. */
export async function extractNpmTarball(tgzPath: string, dest: string): Promise<number> {
  const tar = new Uint8Array(await gunzipAsync(await readFile(tgzPath)));
  const root = resolve(dest);
  let off = 0;
  let written = 0;
  let pax: Pax = {};
  let longName: string | undefined;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const type = String.fromCharCode(header[156] ?? 48);
    const meta = "xgLK".includes(type);
    const size = meta ? numField(header, 124, 12) : (pax.size ?? numField(header, 124, 12));
    off += 512;
    if (!Number.isSafeInteger(size) || size < 0 || off + size > tar.length) throw new Error(`corrupt tarball: bad entry size at offset ${off - 512}`);
    const body = tar.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (type === "x") pax = parsePax(body);
    else if (type === "L") longName = cstr(body, 0, body.length);
    if (meta) continue; // `g` (global, e.g. git's commit comment) and `K` (link target) are consumed, never applied
    const prefix = cstr(header, 345, 155);
    const full = pax.path ?? longName ?? (prefix ? `${prefix}/${cstr(header, 0, 100)}` : cstr(header, 0, 100));
    pax = {};
    longName = undefined;
    const rel = full.split("/").slice(1).join("/");
    if ((type === "0" || type === "\0") && rel && !rel.includes("..")) {
      const out = join(root, rel);
      if (!out.startsWith(root + sep)) continue;
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, body);
      written++;
    }
  }
  return written;
}

/** Octal text, or GNU base-256 when the high bit of the first byte is set (negative is invalid). */
function numField(h: Uint8Array, start: number, len: number): number {
  const first = h[start] ?? 0;
  if (!(first & 0x80)) return parseInt(cstr(h, start, len).trim() || "0", 8);
  if (first & 0x40) return Number.NaN;
  let n = first & 0x3f;
  for (let i = 1; i < len; i++) n = n * 256 + (h[start + i] ?? 0);
  return n;
}

/** pax records: "<len> <key>=<value>\n", where <len> counts the whole record. */
function parsePax(buf: Uint8Array): Pax {
  const out: Pax = {};
  for (let i = 0; i < buf.length;) {
    let sp = i;
    while (sp < buf.length && buf[sp] !== 0x20) sp++;
    const len = Number(Buffer.from(buf.subarray(i, sp)).toString("latin1"));
    if (!Number.isSafeInteger(len) || len <= sp - i || i + len > buf.length) break;
    const rec = Buffer.from(buf.subarray(sp + 1, i + len - 1)).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0 && rec.slice(0, eq) === "path") out.path = rec.slice(eq + 1);
    else if (eq > 0 && rec.slice(0, eq) === "size") out.size = Number(rec.slice(eq + 1));
    i += len;
  }
  return out;
}

function cstr(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && buf[end] !== 0) end++;
  return Buffer.from(buf.subarray(start, end)).toString("utf8");
}
