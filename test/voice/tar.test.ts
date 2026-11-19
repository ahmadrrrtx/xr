/**
 * B12 — the runtime tarball extractor (src/voice/tar.ts), offline fixtures.
 *
 *   • pax (`x`) path/size records, GNU `L` long names and base-256 sizes are
 *     honoured (the old parser misnamed, truncated or stopped on them);
 *   • extraction is async (gunzip on the threadpool, async writes);
 *   • LOCK-IN, kept exactly from the old extractor: `..` paths, symlinks and
 *     hardlinks are never written, wherever the name came from.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractNpmTarball } from "../../src/voice/models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xr-voice-tar-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const enc = (s: string) => new TextEncoder().encode(s);

function header(name: string, size: number, type: string, opts: { base256?: boolean; prefix?: string; linkname?: string } = {}): Uint8Array {
  const h = new Uint8Array(512);
  const put = (off: number, s: string) => { const b = enc(s); h.set(b.subarray(0, Math.min(b.length, 512 - off)), off); };
  put(0, name.slice(0, 100));
  put(100, "0000644\0"); put(108, "0000000\0"); put(116, "0000000\0");
  if (opts.base256) {
    h[124] = 0x80;
    let n = size;
    for (let i = 135; i > 124; i--) { h[i] = n % 256; n = Math.floor(n / 256); }
  } else put(124, size.toString(8).padStart(11, "0") + "\0");
  put(136, "00000000000\0");
  put(156, type);
  if (opts.linkname) put(157, opts.linkname);
  put(257, "ustar\0"); put(263, "00");
  if (opts.prefix) put(345, opts.prefix);
  put(148, "        ");
  let sum = 0;
  for (const b of h) sum += b;
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

const pad = (body: Uint8Array) => { const p = new Uint8Array(Math.ceil(body.length / 512) * 512); p.set(body); return p; };

function paxBody(records: Record<string, string>): Uint8Array {
  let out = "";
  for (const [k, v] of Object.entries(records)) {
    const rest = ` ${k}=${v}\n`;
    const restBytes = Buffer.byteLength(rest);
    let len = restBytes + 1;
    while (String(len).length + restBytes !== len) len = String(len).length + restBytes;
    out += `${len}${rest}`;
  }
  return enc(out);
}

type Part = { h: Uint8Array; body?: Uint8Array };
const file = (name: string, text: string, opts: Parameters<typeof header>[3] = {}): Part => ({ h: header(name, enc(text).length, "0", opts), body: enc(text) });

function writeTgz(parts: Part[]): string {
  const chunks = parts.flatMap((p) => [p.h, pad(p.body ?? new Uint8Array(0))]);
  const total = chunks.reduce((n, c) => n + c.length, 0) + 1024;
  const tar = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { tar.set(c, off); off += c.length; }
  const p = join(dir, "pkg.tgz");
  writeFileSync(p, gzipSync(tar));
  return p;
}

const walk = (d: string): string[] => existsSync(d) ? readdirSync(d).flatMap((e) => statSync(join(d, e)).isDirectory() ? walk(join(d, e)).map((x) => `${e}/${x}`) : [e]) : [];

describe("B12 — extended headers", () => {
  const longRel = `lib/${"deep-directory-name/".repeat(6)}sherpa-onnx-wasm-nodejs.wasm`; // > 100 chars

  test("is async: returns a Promise (gunzip and writes stay off the event loop)", async () => {
    const tgz = writeTgz([file("package/index.js", "x")]);
    const ret = extractNpmTarball(tgz, join(dir, "out"));
    expect(ret).toBeInstanceOf(Promise);
    expect(await ret).toBe(1);
  });

  test("a pax `path` record names the next entry", async () => {
    const pax = paxBody({ path: `package/${longRel}` });
    const global = paxBody({ comment: "0123abcd" }); // git-archive style global header: consumed, never applied
    const tgz = writeTgz([{ h: header("pax_global_header", global.length, "g"), body: global }, { h: header("PaxHeader/x", pax.length, "x"), body: pax }, file(`package/${longRel}`.slice(0, 100), "WASM"), file("package/after.js", "after")]);
    const out = join(dir, "out");
    expect(await extractNpmTarball(tgz, out)).toBe(2);
    expect(readFileSync(join(out, longRel), "utf8")).toBe("WASM");
    expect(readFileSync(join(out, "after.js"), "utf8")).toBe("after");
  });

  test("a GNU `L` long name names the next entry", async () => {
    const name = enc(`package/${longRel}\0`);
    const tgz = writeTgz([{ h: header("././@LongLink", name.length, "L"), body: name }, file(`package/${longRel}`.slice(0, 100), "LONG"), file("package/after.js", "after")]);
    const out = join(dir, "out");
    expect(await extractNpmTarball(tgz, out)).toBe(2);
    expect(readFileSync(join(out, longRel), "utf8")).toBe("LONG");
    expect(readFileSync(join(out, "after.js"), "utf8")).toBe("after");
  });

  test("a base-256 size field is decoded, and the next entry stays aligned", async () => {
    const body = enc("B".repeat(700));
    const tgz = writeTgz([{ h: header("package/big.bin", body.length, "0", { base256: true }), body }, file("package/after.js", "after")]);
    const out = join(dir, "out");
    expect(await extractNpmTarball(tgz, out)).toBe(2);
    expect(readFileSync(join(out, "big.bin"), "utf8")).toBe("B".repeat(700));
    expect(readFileSync(join(out, "after.js"), "utf8")).toBe("after");
  });

  test("a pax `size` record overrides the header size", async () => {
    const body = enc("0123456789");
    const pax = paxBody({ size: "10" });
    const tgz = writeTgz([{ h: header("PaxHeader/s", pax.length, "x"), body: pax }, { h: header("package/sized.bin", 0, "0"), body }, file("package/after.js", "after")]);
    const out = join(dir, "out");
    expect(await extractNpmTarball(tgz, out)).toBe(2);
    expect(readFileSync(join(out, "sized.bin"), "utf8")).toBe("0123456789");
    expect(readFileSync(join(out, "after.js"), "utf8")).toBe("after");
  });

  test("a size that runs past the archive is refused instead of writing a truncated file", async () => {
    const h = header("package/huge.wasm", 1 << 20, "0");
    const tgz = writeTgz([{ h, body: enc("short") }]);
    await expect(extractNpmTarball(tgz, join(dir, "out"))).rejects.toThrow("corrupt tarball");
  });
});

describe("LOCK-IN — traversal, symlink and hardlink entries are never written", () => {
  test("`..` in a plain or ustar-prefixed name is skipped", async () => {
    const tgz = writeTgz([
      file("package/../evil.js", "evil"),
      file("../evil2.js", "evil", { prefix: "package/a/.." }),
      file("package/a/../../evil3.js", "evil"),
      file("package/ok.js", "ok"),
    ]);
    const out = join(dir, "nested", "out");
    expect(await extractNpmTarball(tgz, out)).toBe(1);
    expect(walk(out)).toEqual(["ok.js"]);
    expect(walk(join(dir, "nested")).filter((p) => !p.startsWith("out/"))).toEqual([]);
    expect(existsSync(join(dir, "evil.js"))).toBe(false);
  });

  test("`..` arriving through a pax path or a GNU long name is skipped too", async () => {
    const paxEvil = paxBody({ path: "package/../../pax-evil.js" });
    const gnuEvil = enc("package/a/../../gnu-evil.js\0");
    const tgz = writeTgz([
      { h: header("PaxHeader/e", paxEvil.length, "x"), body: paxEvil },
      file("package/pax-evil.js", "evil"),
      { h: header("././@LongLink", gnuEvil.length, "L"), body: gnuEvil },
      file("package/gnu-evil.js", "evil"),
      file("package/ok.js", "ok"),
    ]);
    const out = join(dir, "nested", "out");
    expect(await extractNpmTarball(tgz, out)).toBe(1);
    expect(walk(out)).toEqual(["ok.js"]);
    expect(existsSync(join(dir, "pax-evil.js")) || existsSync(join(dir, "gnu-evil.js"))).toBe(false);
  });

  test("symlinks, hardlinks and other non-regular types are skipped", async () => {
    const tgz = writeTgz([
      { h: header("package/link", 0, "2", { linkname: "/etc/passwd" }) },
      { h: header("package/hard", 0, "1", { linkname: "package/ok.js" }) },
      { h: header("package/fifo", 0, "6") },
      { h: header("package/dir/", 0, "5") },
      file("package/ok.js", "ok"),
    ]);
    const out = join(dir, "out");
    expect(await extractNpmTarball(tgz, out)).toBe(1);
    expect(walk(out)).toEqual(["ok.js"]);
  });
});
