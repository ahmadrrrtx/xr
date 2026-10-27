/**
 * Handle-relative filesystem primitives for the shared authority.
 *
 * One backend per platform, selected at load time. Every backend exposes the same anchored
 * operations: open one object relative to a retained directory, list a directory, make/unlink/rename
 * relative to retained parents, and do descriptor I/O (stat, read, write, truncate, close, dup).
 * Object paths are never re-resolved from the root once an object has been anchored.
 *
 *   linux x64/arm64  openat2(RESOLVE_BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV) in one kernel lookup;
 *                    descriptors are ordinary Node fds; content reopen through /proc/self/fd.
 *   darwin 11+       openat(O_NOFOLLOW_ANY) per call; descriptors are ordinary Node fds; listing
 *                    through fdopendir/readdir.
 *   win32 x64/arm64  ntdll NtCreateFile with a RootDirectory handle and OBJ_DONT_REPARSE, walked one
 *                    component at a time. Descriptors are raw kernel32 HANDLEs (NOT CRT fds: Bun's own
 *                    runtime cannot fstat or read a CRT fd minted through a separate ucrtbase). All I/O
 *                    is GetFileInformationByHandle / ReadFile / WriteFile / SetEndOfFile / DuplicateHandle.
 *
 * Other platforms fail closed with `unsupported`. Nothing here is a realpath fallback.
 */
import { dlopen, FFIType, ptr, toArrayBuffer, CString, type Pointer } from "bun:ffi";
import { readdirSync, closeSync, fstatSync, readSync, writeSync, ftruncateSync } from "node:fs";

export class FilesystemError extends Error {
  /** `detail` refines a denial for reason codes (XR-LAUNCH-024); the message is unchanged. */
  constructor(readonly code: "denied" | "missing" | "stale" | "limit" | "unsupported" | "escape" | "binary" = "denied", readonly detail?: "secret-path") {
    super(code === "escape" ? "path escapes the project root" : `filesystem ${code}`);
    this.name = "FilesystemError";
  }
}

/** Logical open flags. Numeric values are the Linux ones; each backend translates them. */
export const FD_FLAGS = { PATH: 0x200000, DIRECTORY: 0x10000, NOFOLLOW: 0x20000, CLOEXEC: 0x80000, NONBLOCK: 0x800, CREATE: 0x40, EXCLUSIVE: 0x80 } as const;

/** The subset of fs.Stats the authority reads. Node's Stats satisfies it on Linux and macOS. */
export interface FdStat {
  readonly dev: number;
  readonly ino: number;
  readonly nlink: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

const platform = process.platform;
const arch = process.arch;

function unsupported(): never {
  throw new FilesystemError("unsupported");
}

// ───────────────────────────── Linux ──────────────────────────────────────

const CSTRING = FFIType.ptr;
let linuxLib: ReturnType<typeof loadLinux> | undefined;
function loadLinux() {
  if (platform !== "linux" || !["x64", "arm64"].includes(arch)) unsupported();
  try {
    return dlopen("libc.so.6", {
      syscall: { args: [FFIType.i64, FFIType.i32, CSTRING, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      open: { args: [CSTRING, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      mkdirat: { args: [FFIType.i32, CSTRING, FFIType.u32], returns: FFIType.i32 },
      unlinkat: { args: [FFIType.i32, CSTRING, FFIType.i32], returns: FFIType.i32 },
      renameat: { args: [FFIType.i32, CSTRING, FFIType.i32, CSTRING], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr },
    });
  } catch { unsupported(); }
}
const linux = () => linuxLib ??= loadLinux();
const str = (s: string) => Buffer.from(s + "\0");

function linuxFailure(): never {
  const loc = linux().symbols.__errno_location();
  const errno = loc ? new DataView(toArrayBuffer(loc, 0, 4)).getInt32(0, true) : 0;
  throw new FilesystemError(errno === 2 ? "missing" : [38, 22, 7].includes(errno) ? "unsupported" : "denied");
}

/** Translate our logical flags to the Linux openat2 ABI, and always deny following links.
 * Linux arm64 overrides the generic/x64 O_DIRECTORY and O_NOFOLLOW bits in
 * arch/arm64/include/uapi/asm/fcntl.h; the x64 values instead mean O_DIRECT
 * and O_LARGEFILE on arm64. Passing them raw makes O_PATH opens fail EINVAL.
 * Other architectures remain unsupported rather than guessing their ABI.
 */
export function linuxOpenFlags(flags: number, targetArch: string): number {
  const native = targetArch === "x64" ? { directory: 0x10000, nofollow: 0x20000 }
    : targetArch === "arm64" ? { directory: 0x4000, nofollow: 0x8000 }
    : unsupported();
  const common = flags & ~(FD_FLAGS.DIRECTORY | FD_FLAGS.NOFOLLOW);
  return common | FD_FLAGS.CLOEXEC | native.nofollow | (flags & FD_FLAGS.DIRECTORY ? native.directory : 0);
}

function linuxOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  const n = str(name);
  // BENEATH | NO_XDEV | NO_SYMLINKS | NO_MAGICLINKS. Root acquisition may cross mounts on the
  // host-selected canonical path, but not follow links.
  const how = new BigUint64Array([BigInt(linuxOpenFlags(flags, arch)), BigInt(mode), BigInt(rootAcquisition ? 0x06 : 0x0f)]);
  const fd = Number(linux().symbols.syscall(437, dir, ptr(n), ptr(how), 24));
  if (fd < 0) linuxFailure();
  return fd;
}

function linuxReopen(fd: number, writable: boolean): number {
  const p = str(`/proc/self/fd/${fd}`);
  const opened = linux().symbols.open(ptr(p), (writable ? 1 : 0) | FD_FLAGS.CLOEXEC | FD_FLAGS.NONBLOCK, 0);
  if (opened < 0) linuxFailure();
  return opened;
}

// ───────────────────────────── Darwin ─────────────────────────────────────

const O = { RDONLY: 0, WRONLY: 1, RDWR: 2, NONBLOCK: 0x4, DIRECTORY: 0x100000, CREAT: 0x200, EXCL: 0x800, CLOEXEC: 0x1000000, NOFOLLOW_ANY: 0x20000000 };
let darwinLib: ReturnType<typeof loadDarwin> | undefined;
function loadDarwin() {
  if (platform !== "darwin" || !["x64", "arm64"].includes(arch)) unsupported();
  try {
    return dlopen("libSystem.B.dylib", {
      openat: { args: [FFIType.i32, CSTRING, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      mkdirat: { args: [FFIType.i32, CSTRING, FFIType.u32], returns: FFIType.i32 },
      unlinkat: { args: [FFIType.i32, CSTRING, FFIType.i32], returns: FFIType.i32 },
      renameat: { args: [FFIType.i32, CSTRING, FFIType.i32, CSTRING], returns: FFIType.i32 },
      fchmod: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
      dup: { args: [FFIType.i32], returns: FFIType.i32 },
      fdopendir: { args: [FFIType.i32], returns: FFIType.ptr },
      readdir: { args: [FFIType.ptr], returns: FFIType.ptr },
      closedir: { args: [FFIType.ptr], returns: FFIType.i32 },
      __error: { args: [], returns: FFIType.ptr },
    });
  } catch { unsupported(); }
}
const darwin = () => darwinLib ??= loadDarwin();
const AT_FDCWD_DARWIN = -2;
const AT_REMOVEDIR = 0x80;

function darwinFailure(): never {
  const loc = darwin().symbols.__error();
  const errno = loc ? new DataView(toArrayBuffer(loc, 0, 4)).getInt32(0, true) : 0;
  // ENOENT 2 → missing; EEXIST 17 → stale; EINVAL/ENOSYS → unsupported; everything else (ELOOP, EXDEV, EACCES) → denied.
  throw new FilesystemError(errno === 2 ? "missing" : errno === 17 ? "stale" : errno === 22 || errno === 78 ? "unsupported" : "denied");
}

function darwinOpenFlags(flags: number): number {
  let acc = flags & 3;
  if (flags & FD_FLAGS.PATH) acc = O.RDONLY; // classify without any write access
  let f = acc | O.NONBLOCK | O.CLOEXEC | O.NOFOLLOW_ANY;
  if (flags & FD_FLAGS.DIRECTORY) f |= O.DIRECTORY;
  if (flags & FD_FLAGS.CREATE) f |= O.CREAT;
  if (flags & FD_FLAGS.EXCLUSIVE) f |= O.EXCL;
  return f;
}

function darwinOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  if (name.split(/[\\/]+/).some((p) => p === "..")) throw new FilesystemError("escape");
  const d = rootAcquisition ? AT_FDCWD_DARWIN : dir;
  const n = str(name);
  const fd = darwin().symbols.openat(d, ptr(n), darwinOpenFlags(flags) & ~(rootAcquisition ? O.NOFOLLOW_ANY : 0), mode);
  if (fd < 0) darwinFailure();
  // The variadic mode is not trusted on every ABI: enforce it explicitly when a file is created.
  if (flags & FD_FLAGS.CREATE && darwin().symbols.fchmod(fd, mode) !== 0) { darwin().symbols.close(fd); darwinFailure(); }
  return fd;
}

function darwinList(fd: number): string[] {
  const dfd = darwin().symbols.dup(fd);
  if (dfd < 0) darwinFailure();
  const dir = darwin().symbols.fdopendir(dfd);
  if (!dir) { darwin().symbols.close(dfd); darwinFailure(); }
  const names: string[] = [];
  try {
    for (;;) {
      const entry = darwin().symbols.readdir(dir);
      if (!entry) break;
      // struct dirent (64-bit inode): d_ino(8) d_seekoff(8) d_reclen(2) d_namlen(2) d_type(1) d_name[] at 21
      names.push(new CString((entry + 21) as unknown as Pointer).toString());
    }
  } finally {
    darwin().symbols.closedir(dir); // also closes dfd
  }
  return names.filter((n) => n !== "." && n !== "..").sort();
}

// ───────────────────────────── Windows ────────────────────────────────────
// Descriptors on win32 are raw HANDLE values. Bun's runtime cannot use CRT fds minted elsewhere.

const NT = {
  OBJ_CASE_INSENSITIVE: 0x40, OBJ_DONT_REPARSE: 0x1000,
  FILE_GENERIC_READ: 0x120089, FILE_GENERIC_WRITE: 0x120116, DELETE: 0x10000, SYNCHRONIZE: 0x100000, READ_ATTRIBUTES: 0x80,
  FILE_OPEN: 1, FILE_CREATE: 2, FILE_OPEN_IF: 3,
  FILE_DIRECTORY_FILE: 0x1, FILE_NON_DIRECTORY_FILE: 0x40, FILE_SYNCHRONOUS_IO_NONALERT: 0x20, FILE_OPEN_REPARSE_POINT: 0x200000, FILE_DELETE_ON_CLOSE: 0x1000,
  FILE_SHARE_ALL: 7, FILE_ATTRIBUTE_NORMAL: 0x80,
  FILE_RENAME_INFORMATION: 10, FILE_ID_BOTH_DIR_INFORMATION: 37,
  STATUS_NO_MORE_FILES: 0x80000006,
  ATTR_DIRECTORY: 0x10, ATTR_REPARSE: 0x400,
  ERROR_HANDLE_EOF: 38,
  DUPLICATE_SAME_ACCESS: 2,
  OPEN_EXISTING: 3, FILE_FLAG_BACKUP_SEMANTICS: 0x02000000, FILE_BEGIN: 0,
};
let winLib: ReturnType<typeof loadWin> | undefined;
function loadWin() {
  // XR-LAUNCH-005 (decision D4): arm64 Windows is LLP64 like x64, so every
  // structure below (UNICODE_STRING, OBJECT_ATTRIBUTES, IO_STATUS_BLOCK,
  // OVERLAPPED, BY_HANDLE_FILE_INFORMATION, FILE_*_INFORMATION) has the same
  // size and offsets, and ntdll/kernel32 export the same entry points. arm64 is
  // NOT hardware-verified in this repository: `winSelfTest` runs once per
  // process and a failure makes the authority report `unsupported` (fail
  // closed) instead of guessing.
  if (platform !== "win32" || !["x64", "arm64"].includes(arch)) unsupported();
  try {
    const nt = dlopen("ntdll.dll", {
      NtCreateFile: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtClose: { args: [FFIType.i64], returns: FFIType.i32 },
      NtQueryDirectoryFile: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtSetInformationFile: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
    }).symbols;
    const k32 = dlopen("kernel32.dll", {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
      GetFileInformationByHandle: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
      ReadFile: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      WriteFile: { args: [FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      SetFilePointerEx: { args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      SetEndOfFile: { args: [FFIType.i64], returns: FFIType.i32 },
      DuplicateHandle: { args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      GetCurrentProcess: { args: [], returns: FFIType.i64 },
      GetLastError: { args: [], returns: FFIType.u32 },
    }).symbols;
    winSelfTest(nt, k32);
    return { nt, k32 };
  } catch { unsupported(); }
}
const win = () => winLib ??= loadWin();

/**
 * Prove the FFI round-trip before trusting it, using the same call shapes the
 * authority uses: open %SystemRoot% by path (root acquisition), open
 * "System32" anchored at that handle (NtCreateFile + RootDirectory +
 * OBJ_DONT_REPARSE), open %SystemRoot%\System32 by path, and require both
 * System32 handles to name the same directory. Any mismatch or error → throw
 * (→ `unsupported`).
 */
function winSelfTest(
  nt: { NtCreateFile: (...a: never[]) => number; NtClose: (h: number) => number },
  k32: { CreateFileW: (...a: never[]) => number | bigint; GetFileInformationByHandle: (h: number, p: Pointer) => number },
): void {
  const sysRoot = process.env.SystemRoot ?? "C:\\Windows";
  const byPath = (p: string): number => {
    const buf = Buffer.from(p + "\0", "utf16le");
    const h = Number((k32.CreateFileW as (...a: unknown[]) => number | bigint)(ptr(buf), NT.FILE_GENERIC_READ, NT.FILE_SHARE_ALL, null, NT.OPEN_EXISTING, NT.FILE_FLAG_BACKUP_SEMANTICS, null));
    if (h === -1 || h === 0) throw new Error("self-test: CreateFileW failed");
    return h;
  };
  const handles: number[] = [];
  try {
    const root = byPath(sysRoot);
    handles.push(root);
    const h = byPath(sysRoot + "\\System32");
    handles.push(h);
    const { us, data } = unicode("System32");
    const oa = objectAttributes(root, us, NT.OBJ_CASE_INSENSITIVE | NT.OBJ_DONT_REPARSE);
    const iosb = Buffer.alloc(16);
    const out = Buffer.alloc(8);
    const status = (nt.NtCreateFile as (...a: unknown[]) => number)(ptr(out), NT.FILE_GENERIC_READ, ptr(oa), ptr(iosb), null, NT.FILE_ATTRIBUTE_NORMAL, NT.FILE_SHARE_ALL, NT.FILE_OPEN, NT.FILE_DIRECTORY_FILE | NT.FILE_SYNCHRONOUS_IO_NONALERT, null, 0);
    void data;
    if ((status >>> 0) !== 0) throw new Error("self-test: NtCreateFile failed");
    const h2 = Number(out.readBigUInt64LE(0));
    handles.push(h2);
    const a = Buffer.alloc(52);
    const b = Buffer.alloc(52);
    if (!k32.GetFileInformationByHandle(h, ptr(a)) || !k32.GetFileInformationByHandle(h2, ptr(b))) throw new Error("self-test: no file info");
    // dwVolumeSerialNumber @28, nFileIndexHigh @44, nFileIndexLow @48; attributes @0 must say directory.
    const id = (x: Buffer) => `${x.readUInt32LE(28)}:${x.readUInt32LE(44)}:${x.readUInt32LE(48)}`;
    if (id(a) !== id(b) || (a.readUInt32LE(0) & NT.ATTR_DIRECTORY) === 0) throw new Error("self-test: identity mismatch");
  } finally {
    for (const x of handles) nt.NtClose(x);
  }
}

/** NTSTATUS → fixed policy code. Raw NTSTATUS text is never returned. */
function ntError(status: number): FilesystemError {
  const s = status >>> 0;
  if (s === 0xc0000034 || s === 0xc000003a) return new FilesystemError("missing");           // OBJECT_NAME/PATH_NOT_FOUND
  if (s === 0xc0000035) return new FilesystemError("stale");                                  // NAME_COLLISION (exclusive create)
  return new FilesystemError("denied");                                                       // reparse/link, access, non-empty dir, anything else
}

function ntStatus(r: number): void { if ((r >>> 0) !== 0) throw ntError(r); }

/** UNICODE_STRING + backing buffer. The caller keeps `data` alive across the call. */
function unicode(name: string): { us: Buffer; data: Buffer } {
  const data = Buffer.from(name, "utf16le");
  const us = Buffer.alloc(16);
  us.writeUInt16LE(data.length, 0);
  us.writeUInt16LE(data.length + 2, 2);
  us.writeBigUInt64LE(BigInt(ptr(data)), 8);
  return { us, data };
}

function objectAttributes(rootHandle: number, us: Buffer, attrs: number): Buffer {
  const oa = Buffer.alloc(48);
  oa.writeUInt32LE(48, 0);
  oa.writeBigUInt64LE(BigInt(rootHandle), 8);
  oa.writeBigUInt64LE(BigInt(ptr(us)), 16);
  oa.writeUInt32LE(attrs, 24);
  return oa;
}

/** Create/open one component relative to `rootHandle`. Returns a HANDLE. */
function ntCreate(rootHandle: number, name: string, access: number, disposition: number, options: number): number {
  const { us, data } = unicode(name);
  const oa = objectAttributes(rootHandle, us, NT.OBJ_CASE_INSENSITIVE | NT.OBJ_DONT_REPARSE);
  const iosb = Buffer.alloc(16);
  const out = Buffer.alloc(8);
  const status = win().nt.NtCreateFile(ptr(out), access, ptr(oa), ptr(iosb), null, NT.FILE_ATTRIBUTE_NORMAL, NT.FILE_SHARE_ALL, disposition, options, null, 0);
  ntStatus(status);
  void data;
  return Number(out.readBigUInt64LE(0));
}

function winClose(h: number): void { win().nt.NtClose(h); }

function winFileInfo(h: number): Buffer {
  const info = Buffer.alloc(52); // BY_HANDLE_FILE_INFORMATION
  if (!win().k32.GetFileInformationByHandle(h, ptr(info))) throw new FilesystemError("denied");
  return info;
}

const FILETIME_EPOCH_MS = 11644473600000;
function filetimeMs(buf: Buffer, off: number): number {
  const t = buf.readBigUInt64LE(off);            // 100-ns intervals since 1601-01-01
  return Number(t / 10000n) - FILETIME_EPOCH_MS;
}

/** Walk one component at a time from the retained handle. Reparse points are refused by OBJ_DONT_REPARSE. */
function winOpen(dir: number, name: string, flags: number, rootAcquisition: boolean): number {
  const parts = name.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new FilesystemError("escape");
  const wantWrite = (flags & 3) !== 0 && !(flags & FD_FLAGS.PATH);
  const isDir = (flags & FD_FLAGS.DIRECTORY) !== 0;
  if (rootAcquisition) {
    const path = Buffer.from(name + "\0", "utf16le");
    const h = Number(win().k32.CreateFileW(ptr(path), NT.FILE_GENERIC_READ, NT.FILE_SHARE_ALL, null, NT.OPEN_EXISTING, NT.FILE_FLAG_BACKUP_SEMANTICS, null));
    if (h === -1 || h === 0) throw new FilesystemError("denied");
    return h;
  }
  if (parts.length === 0) return winDup(dir);
  let current = dir;
  let owned = false;
  try {
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      // Directories are opened with write rights too, so creation and deletion below them work; if the
      // ACL refuses write rights on an intermediate directory, traversal falls back to read-only.
      const access = last && !wantWrite ? NT.FILE_GENERIC_READ : NT.FILE_GENERIC_READ | NT.FILE_GENERIC_WRITE | NT.DELETE;
      const disposition = last && (flags & FD_FLAGS.CREATE) ? ((flags & FD_FLAGS.EXCLUSIVE) ? NT.FILE_CREATE : NT.FILE_OPEN_IF) : NT.FILE_OPEN;
      // Like O_PATH on Linux: the final object's type is not restricted unless the caller asks for a directory;
      // the authority inspects the type itself (regular files only for content).
      const options = (last ? (isDir ? NT.FILE_DIRECTORY_FILE : 0) : NT.FILE_DIRECTORY_FILE) | NT.FILE_SYNCHRONOUS_IO_NONALERT;
      let next: number;
      try {
        next = ntCreate(current, parts[i]!, access, disposition, options);
      } catch (e) {
        if (!last && e instanceof FilesystemError && e.code === "denied") next = ntCreate(current, parts[i]!, NT.FILE_GENERIC_READ, disposition, options);
        else throw e;
      }
      if (owned) winClose(current);
      current = next;
      owned = true;
    }
    owned = false; // the final handle is the result
    return current;
  } catch (e) {
    if (owned) winClose(current);
    throw e;
  }
}

function winDup(h: number): number {
  const out = Buffer.alloc(8);
  const self = win().k32.GetCurrentProcess();
  if (!win().k32.DuplicateHandle(self, h, self, ptr(out), 0, 0, NT.DUPLICATE_SAME_ACCESS)) throw new FilesystemError("denied");
  return Number(out.readBigUInt64LE(0));
}

function winStat(h: number): FdStat {
  const info = winFileInfo(h);
  const attrs = info.readUInt32LE(0);
  const mtime = filetimeMs(info, 20);
  const size = info.readUInt32LE(36) + info.readUInt32LE(32) * 2 ** 32;
  const ino = info.readUInt32LE(48) + info.readUInt32LE(44) * 2 ** 32;
  return {
    dev: info.readUInt32LE(28),
    ino,
    nlink: info.readUInt32LE(40),
    size,
    mtimeMs: mtime,
    ctimeMs: mtime,
    isDirectory: () => (attrs & NT.ATTR_DIRECTORY) !== 0,
    isFile: () => (attrs & NT.ATTR_DIRECTORY) === 0 && (attrs & NT.ATTR_REPARSE) === 0,
  };
}

function winRead(h: number, buffer: Buffer, offset: number, length: number, position: number): number {
  const ov = Buffer.alloc(32);
  // OVERLAPPED (x64): Internal(8) InternalHigh(8) Offset(4)@16 OffsetHigh(4)@20 hEvent(8)
  ov.writeUInt32LE(position % 2 ** 32, 16);
  ov.writeUInt32LE(Math.floor(position / 2 ** 32), 20);
  const done = Buffer.alloc(4);
  if (!win().k32.ReadFile(h, ptr(buffer) + offset, length, ptr(done), ptr(ov))) {
    if (win().k32.GetLastError() === NT.ERROR_HANDLE_EOF) return 0;
    throw new FilesystemError("denied");
  }
  return done.readUInt32LE(0);
}

function winWrite(h: number, buffer: Buffer, offset: number, length: number, position: number): number {
  const ov = Buffer.alloc(32);
  // OVERLAPPED (x64): Internal(8) InternalHigh(8) Offset(4)@16 OffsetHigh(4)@20 hEvent(8)
  ov.writeUInt32LE(position % 2 ** 32, 16);
  ov.writeUInt32LE(Math.floor(position / 2 ** 32), 20);
  const done = Buffer.alloc(4);
  if (!win().k32.WriteFile(h, ptr(buffer) + offset, length, ptr(done), ptr(ov))) throw new FilesystemError("denied");
  return done.readUInt32LE(0);
}

function winTruncate(h: number, length: number): void {
  if (!win().k32.SetFilePointerEx(h, length, null, NT.FILE_BEGIN) || !win().k32.SetEndOfFile(h)) throw new FilesystemError("denied");
}

function winList(h: number): string[] {
  const names: string[] = [];
  const buf = Buffer.alloc(64 * 1024);
  const iosb = Buffer.alloc(16);
  let restart = 1;
  for (;;) {
    const status = win().nt.NtQueryDirectoryFile(h, null, null, null, ptr(iosb), ptr(buf), buf.length, NT.FILE_ID_BOTH_DIR_INFORMATION, 0, null, restart);
    restart = 0;
    if ((status >>> 0) === NT.STATUS_NO_MORE_FILES) break;
    ntStatus(status);
    let off = 0;
    for (;;) {
      const next = buf.readUInt32LE(off);
      const nameLen = buf.readUInt32LE(off + 60);
      const name = buf.toString("utf16le", off + 104, off + 104 + nameLen);
      if (name !== "." && name !== "..") names.push(name);
      if (!next) break;
      off += next;
    }
  }
  return names.sort();
}

function winUnlink(dir: number, name: string, directory: boolean): void {
  const access = NT.DELETE | NT.SYNCHRONIZE | NT.READ_ATTRIBUTES;
  const options = NT.FILE_OPEN_REPARSE_POINT | NT.FILE_SYNCHRONOUS_IO_NONALERT | NT.FILE_DELETE_ON_CLOSE | (directory ? NT.FILE_DIRECTORY_FILE : NT.FILE_NON_DIRECTORY_FILE);
  const h = ntCreate(dir, name, access, NT.FILE_OPEN, options);
  winClose(h); // delete-on-close fires here
}

function winRename(fromDir: number, fromName: string, toDir: number, toName: string): void {
  const src = ntCreate(fromDir, fromName, NT.DELETE | NT.SYNCHRONIZE | NT.READ_ATTRIBUTES, NT.FILE_OPEN, NT.FILE_OPEN_REPARSE_POINT | NT.FILE_SYNCHRONOUS_IO_NONALERT);
  try {
    const data = Buffer.from(toName, "utf16le");
    const info = Buffer.alloc(20 + data.length);   // FILE_RENAME_INFORMATION
    info.writeUInt8(0, 0);                          // ReplaceIfExists = FALSE (exclusive)
    info.writeBigUInt64LE(BigInt(toDir), 8);        // RootDirectory
    info.writeUInt32LE(data.length, 16);            // FileNameLength
    data.copy(info, 20);
    const iosb = Buffer.alloc(16);
    ntStatus(win().nt.NtSetInformationFile(src, ptr(iosb), ptr(info), info.length, NT.FILE_RENAME_INFORMATION));
  } finally {
    winClose(src);
  }
}

function winMkdir(dir: number, name: string): void {
  const h = ntCreate(dir, name, NT.FILE_GENERIC_READ | NT.FILE_GENERIC_WRITE, NT.FILE_CREATE, NT.FILE_DIRECTORY_FILE | NT.FILE_SYNCHRONOUS_IO_NONALERT);
  winClose(h);
}

// ───────────────────────────── Dispatch ───────────────────────────────────

/** Open one anchored object. Returns a descriptor usable for the fd helpers below. */
export function anchoredOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  if (platform === "linux") return linuxOpen(dir, name, flags, mode, rootAcquisition);
  if (platform === "darwin") return darwinOpen(dir, name, flags, mode, rootAcquisition);
  if (platform === "win32") return winOpen(dir, name, flags, rootAcquisition);
  return unsupported();
}

/** A second descriptor for the same object (reads). */
export function descriptorIo(fd: number, writable: boolean): number {
  if (platform === "linux") return linuxReopen(fd, writable);
  if (writable) throw new FilesystemError("denied"); // callers use writableSameObject on these platforms
  if (platform === "darwin") {
    const d = darwin().symbols.dup(fd);
    if (d < 0) darwinFailure();
    return d;
  }
  if (platform === "win32") return winDup(fd);
  return unsupported();
}

/**
 * Writable descriptor for an EXISTING object the authority classified as `fd` under `parentFd/leaf`.
 * Linux: reopen the approved fd. Darwin/Windows: reopen anchored at the same parent, then require the
 * object identity to match the classified fd, so a swapped object is refused.
 */
export function writableSameObject(parentFd: number, leaf: string, fd: number, objectIdOf: (f: number) => string): number {
  if (platform === "linux") return linuxReopen(fd, true);
  const io = anchoredOpen(parentFd, leaf, 1 | FD_FLAGS.NONBLOCK, 0);
  try {
    if (objectIdOf(io) !== objectIdOf(fd)) throw new FilesystemError("stale");
  } catch (e) { fdClose(io); throw e; }
  return io;
}

/** Entry names of a directory descriptor (sorted, without "." and ".."). */
export function listFd(fd: number): string[] {
  if (platform === "linux") return readdirSync(`/proc/self/fd/${fd}`).sort();
  if (platform === "darwin") return darwinList(fd);
  if (platform === "win32") return winList(fd);
  return unsupported();
}

/** Stat a descriptor (the object it refers to, not a path). */
export function fdStat(fd: number): FdStat {
  if (platform === "win32") return winStat(fd);
  return fstatSync(fd);
}

/** Positional read, like fs.readSync(fd, buffer, offset, length, position). */
export function fdRead(fd: number, buffer: Buffer, offset: number, length: number, position: number): number {
  if (platform === "win32") return winRead(fd, buffer, offset, length, position);
  return readSync(fd, buffer, offset, length, position);
}

/** Positional write, like fs.writeSync(fd, buffer, offset, length, position). */
export function fdWrite(fd: number, buffer: Buffer, offset: number, length: number, position: number): number {
  if (platform === "win32") return winWrite(fd, buffer, offset, length, position);
  return writeSync(fd, buffer, offset, length, position);
}

export function fdTruncate(fd: number, length: number): void {
  if (platform === "win32") return winTruncate(fd, length);
  ftruncateSync(fd, length);
}

export function fdClose(fd: number): void {
  if (platform === "win32") return winClose(fd);
  closeSync(fd);
}

/** Whole-object read through a descriptor (tests and small helpers). */
export function fdReadAll(fd: number): Buffer {
  const size = fdStat(fd).size;
  const buf = Buffer.alloc(size);
  let n = 0;
  while (n < size) { const c = fdRead(fd, buf, n, size - n, n); if (!c) break; n += c; }
  return buf.subarray(0, n);
}

export function anchoredMkdir(dir: number, name: string): void {
  if (platform === "linux") { if (linux().symbols.mkdirat(dir, ptr(str(name)), 0o700) !== 0) linuxFailure(); return; }
  if (platform === "darwin") { if (darwin().symbols.mkdirat(dir, ptr(str(name)), 0o700) !== 0) darwinFailure(); return; }
  if (platform === "win32") { winMkdir(dir, name); return; }
  unsupported();
}

export function anchoredUnlink(dir: number, name: string, directory = false): void {
  if (platform === "linux") { if (linux().symbols.unlinkat(dir, ptr(str(name)), directory ? 0x200 : 0) !== 0) linuxFailure(); return; }
  if (platform === "darwin") { if (darwin().symbols.unlinkat(dir, ptr(str(name)), directory ? AT_REMOVEDIR : 0) !== 0) darwinFailure(); return; }
  if (platform === "win32") { winUnlink(dir, name, directory); return; }
  unsupported();
}

export function anchoredRename(from: number, name: string, to: number, target: string): void {
  if (platform === "linux") { if (linux().symbols.renameat(from, ptr(str(name)), to, ptr(str(target))) !== 0) linuxFailure(); return; }
  if (platform === "darwin") { if (darwin().symbols.renameat(from, ptr(str(name)), to, ptr(str(target))) !== 0) darwinFailure(); return; }
  if (platform === "win32") { winRename(from, name, to, target); return; }
  unsupported();
}

/** Which platform the native layer is wired for (used by guarantee reporting and tests). */
export const NATIVE_BACKEND = platform === "linux" ? "linux-openat2" : platform === "darwin" ? "darwin-openat-nofollow-any" : platform === "win32" ? "win32-ntcreatefile" : "unsupported";
