// Temporary CI probe: exercises the native FS primitives directly and prints raw results.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = (...a: unknown[]) => console.log("[probe]", ...a);
out("platform", process.platform, process.arch, "bun", Bun.version);

const base = mkdtempSync(join(tmpdir(), "probe-"));
const root = join(base, "root");
mkdirSync(root);
writeFileSync(join(root, "ok.txt"), "HELLO");

if (process.platform === "win32") {
  try {
    const k32 = dlopen("kernel32.dll", {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
      GetLastError: { args: [], returns: FFIType.u32 },
    }).symbols;
    const crt = dlopen("ucrtbase.dll", {
      _open_osfhandle: { args: [FFIType.i64, FFIType.i32], returns: FFIType.i32 },
      _get_osfhandle: { args: [FFIType.i32], returns: FFIType.i64 },
      _dup: { args: [FFIType.i32], returns: FFIType.i32 },
    }).symbols;
    out("dlopen kernel32/ucrtbase ok");
    const path = Buffer.from(root + "\0", "utf16le");
    const h = Number(k32.CreateFileW(ptr(path), 0x120089, 7, null, 3, 0x02000000, null));
    out("CreateFileW handle", h, "lastError", k32.GetLastError());
    const fd = crt._open_osfhandle(h, 0);
    out("_open_osfhandle fd", fd);
    out("_get_osfhandle back", Number(crt._get_osfhandle(fd)));
  } catch (e) { out("kernel/crt FAILED", String(e)); }
  try {
    const nt = dlopen("ntdll.dll", {
      NtCreateFile: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtClose: { args: [FFIType.i64], returns: FFIType.i32 },
    }).symbols;
    out("dlopen ntdll ok");
    // Relative open of ok.txt through a retained root directory handle.
    const k32 = dlopen("kernel32.dll", { CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 } }).symbols;
    const rootH = Number(k32.CreateFileW(ptr(Buffer.from(root + "\0", "utf16le")), 0x120089, 7, null, 3, 0x02000000, null));
    const name = Buffer.from("ok.txt", "utf16le");
    const us = Buffer.alloc(16);
    us.writeUInt16LE(name.length, 0); us.writeUInt16LE(name.length + 2, 2); us.writeBigUInt64LE(BigInt(ptr(name)), 8);
    const oa = Buffer.alloc(48);
    oa.writeUInt32LE(48, 0); oa.writeBigUInt64LE(BigInt(rootH), 8); oa.writeBigUInt64LE(BigInt(ptr(us)), 16); oa.writeUInt32LE(0x40 | 0x1000, 24);
    const iosb = Buffer.alloc(16); const outH = Buffer.alloc(8);
    const st = nt.NtCreateFile(ptr(outH), 0x120089, ptr(oa), ptr(iosb), null, 0x80, 7, 1, 0x20 | 0x40, null, 0);
    out("NtCreateFile relative status", (st >>> 0).toString(16), "handle", Number(outH.readBigUInt64LE(0)));
    // Also: the same with a fresh NTSTATUS-friendly absolute name
    out("ok.txt readable via fs:", readFileSync(join(root, "ok.txt"), "utf8"));
  } catch (e) { out("ntdll FAILED", String(e)); }
}

// Exercise the real module and print the mapped error codes.
try {
  process.env.XR_FILES_ROOT = root;
  const native = await import("../src/security/fs-native.ts");
  out("backend", native.NATIVE_BACKEND);
  const rootFd = native.anchoredOpen(-100, root, native.FD_FLAGS.PATH | native.FD_FLAGS.DIRECTORY, 0, true);
  out("module root fd", rootFd);
  const f = native.anchoredOpen(rootFd, "ok.txt", native.FD_FLAGS.PATH);
  out("module file fd", f);
} catch (e) { out("module FAILED", String(e), (e as Error).message); }

// Authority-level read, with device identities of the root and the file.
try {
  const { FilesystemAuthority } = await import("../src/security/filesystem.ts");
  const { fstatSync, closeSync } = await import("node:fs");
  const native = await import("../src/security/fs-native.ts");
  const rfd = native.anchoredOpen(-100, root, native.FD_FLAGS.PATH | native.FD_FLAGS.DIRECTORY, 0, true);
  const ffd = native.anchoredOpen(rfd, "ok.txt", native.FD_FLAGS.PATH);
  const sr = fstatSync(rfd), sf = fstatSync(ffd);
  out("dev root", sr.dev, "dev file", sf.dev, "ino", sr.ino, sf.ino, "isFile", sf.isFile(), "nlink", sf.nlink);
  closeSync(ffd); closeSync(rfd);
  const fs = new FilesystemAuthority(root);
  out("authority root", fs.root);
  try { out("authority read content", JSON.stringify(fs.read("ok.txt").content)); }
  catch (e) { out("authority read FAILED code", (e as { code?: string }).code, String(e)); }
  fs.close();
} catch (e) { out("authority section FAILED", String(e)); }
