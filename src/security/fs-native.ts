/**
 * Handle-relative filesystem primitives for the shared authority.
 *
 * One backend per platform, selected at load time. Every backend exposes the same anchored
 * operations: open one object relative to a retained directory handle, list a directory handle,
 * make/unlink/rename relative to retained parents. Paths are never re-resolved from the root for
 * the object itself.
 *
 *   linux x64/arm64  openat2(RESOLVE_BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV) in one kernel lookup;
 *                    content reopen through the authority's own /proc/self/fd entry.
 *   darwin 11+       openat(O_NOFOLLOW_ANY) per call (no symlink in ANY component); the object is
 *                    opened with the access it needs; directory listing via fdopendir/readdir.
 *   win32            ntdll NtCreateFile with a RootDirectory handle and OBJ_DONT_REPARSE, walked one
 *                    component at a time; rename/delete via NtSetInformationFile / delete-on-close.
 *
 * Other platforms fail closed with `unsupported`. Nothing here is a realpath fallback.
 * These backends are verified only on their own platform's CI (see docs/implementation/stage-a/a1).
 */
import { dlopen, FFIType, ptr, toArrayBuffer, CString, type Pointer } from "bun:ffi";
import { readdirSync, closeSync } from "node:fs";

export class FilesystemError extends Error {
  constructor(readonly code: "denied" | "missing" | "stale" | "limit" | "unsupported" | "escape" | "binary" = "denied") {
    super(code === "escape" ? "path escapes the project root" : `filesystem ${code}`);
    this.name = "FilesystemError";
  }
}

/** Logical open flags. Numeric values are the Linux ones; each backend translates them. */
export const FD_FLAGS = { PATH: 0x200000, DIRECTORY: 0x10000, NOFOLLOW: 0x20000, CLOEXEC: 0x80000, NONBLOCK: 0x800, CREATE: 0x40, EXCLUSIVE: 0x80 } as const;

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

function linuxOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  const n = str(name);
  // BENEATH | NO_XDEV | NO_SYMLINKS | NO_MAGICLINKS. Root acquisition may cross mounts on the
  // host-selected canonical path, but not follow links.
  const how = new BigUint64Array([BigInt(flags | FD_FLAGS.CLOEXEC | FD_FLAGS.NOFOLLOW), BigInt(mode), BigInt(rootAcquisition ? 0x06 : 0x0f)]);
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
  // ENOENT 2 → missing; ELOOP 62 / ENOTDIR 20 / EXDEV 18 / EACCES 13 / EPERM 1 → denied (links, mounts, perms).
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

const NT = {
  OBJ_CASE_INSENSITIVE: 0x40, OBJ_DONT_REPARSE: 0x1000,
  FILE_GENERIC_READ: 0x120089, FILE_GENERIC_WRITE: 0x120116, DELETE: 0x10000, SYNCHRONIZE: 0x100000, READ_ATTRIBUTES: 0x80,
  FILE_OPEN: 1, FILE_CREATE: 2, FILE_OPEN_IF: 3,
  FILE_DIRECTORY_FILE: 0x1, FILE_NON_DIRECTORY_FILE: 0x40, FILE_SYNCHRONOUS_IO_NONALERT: 0x20, FILE_OPEN_REPARSE_POINT: 0x200000, FILE_DELETE_ON_CLOSE: 0x1000,
  FILE_SHARE_ALL: 7, FILE_ATTRIBUTE_NORMAL: 0x80,
  FILE_RENAME_INFORMATION: 10, FILE_ID_BOTH_DIR_INFORMATION: 37,
  STATUS_NO_MORE_FILES: 0x80000006,
};
let winLib: ReturnType<typeof loadWin> | undefined;
function loadWin() {
  if (platform !== "win32" || arch !== "x64") unsupported();
  try {
    const ntdll = dlopen("ntdll.dll", {
      NtCreateFile: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtClose: { args: [FFIType.i64], returns: FFIType.i32 },
      NtQueryDirectoryFile: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtSetInformationFile: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
    });
    const crt = dlopen("ucrtbase.dll", {
      _open_osfhandle: { args: [FFIType.i64, FFIType.i32], returns: FFIType.i32 },
      _get_osfhandle: { args: [FFIType.i32], returns: FFIType.i64 },
      _dup: { args: [FFIType.i32], returns: FFIType.i32 },
    });
    const k32 = dlopen("kernel32.dll", {
      CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64 },
    });
    return { nt: ntdll.symbols, crt: crt.symbols, k32: k32.symbols };
  } catch { unsupported(); }
}
const win = () => winLib ??= loadWin();

/** NTSTATUS → fixed policy code. Raw NTSTATUS text is never returned. */
function ntError(status: number): FilesystemError {
  const s = status >>> 0;
  if (s === 0xc0000034 || s === 0xc000003a) return new FilesystemError("missing");           // OBJECT_NAME/PATH_NOT_FOUND
  if (s === 0xc0000035) return new FilesystemError("stale");                                  // NAME_COLLISION (exclusive create)
  if (s === 0xc000050b) return new FilesystemError("denied");                                 // REPARSE_POINT_ENCOUNTERED (link)
  if (s === 0xc0000101) return new FilesystemError("denied");                                 // DIRECTORY_NOT_EMPTY
  if (s === 0xc0000022 || s === 0xc0000103 || s === 0xc00000ba) return new FilesystemError("denied");
  return new FilesystemError("denied");
}

function ntStatus(r: number): void { if ((r >>> 0) !== 0) throw ntError(r); }

/** UNICODE_STRING + backing buffer, kept alive by the caller for the duration of the call. */
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

/** Create/open one component relative to `rootHandle` (0 = absolute, not used here). */
function ntCreate(rootHandle: number, name: string, access: number, disposition: number, options: number): number {
  const { us, data } = unicode(name);
  const oa = objectAttributes(rootHandle, us, NT.OBJ_CASE_INSENSITIVE | NT.OBJ_DONT_REPARSE);
  const iosb = Buffer.alloc(16);
  const out = Buffer.alloc(8);
  // `data` backs the UNICODE_STRING pointer and must stay alive across the call.
  const status = win().nt.NtCreateFile(ptr(out), access, ptr(oa), ptr(iosb), null, NT.FILE_ATTRIBUTE_NORMAL, NT.FILE_SHARE_ALL, disposition, options, null, 0);
  ntStatus(status);
  void data;
  return Number(out.readBigUInt64LE(0));
}

function winHandleOf(fd: number): number {
  const h = Number(win().crt._get_osfhandle(fd));
  if (h === -1 || h === 0) throw new FilesystemError("denied");
  return h;
}

function crtFdOf(handle: number, flags: number): number {
  const fd = win().crt._open_osfhandle(handle, flags);
  if (fd < 0) { win().nt.NtClose(handle); throw new FilesystemError("denied"); }
  return fd;
}

/** Walk one component at a time from the retained handle. Intermediate reparse points are refused. */
function winOpen(dir: number, name: string, flags: number, rootAcquisition: boolean): number {
  const parts = name.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new FilesystemError("escape");
  const wantWrite = (flags & 3) !== 0 && !(flags & FD_FLAGS.PATH);
  const isDir = (flags & FD_FLAGS.DIRECTORY) !== 0;
  if (rootAcquisition) {
    const path = Buffer.from(name + "\0", "utf16le");
    // FILE_SHARE_ALL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS (directories) — root only.
    const h = Number(win().k32.CreateFileW(ptr(path), NT.FILE_GENERIC_READ, NT.FILE_SHARE_ALL, null, 3, 0x02000000, null));
    if (h === -1 || h === 0) throw new FilesystemError("denied");
    return crtFdOf(h, 0);
  }
  if (parts.length === 0) { const d = win().crt._dup(dir); if (d < 0) throw new FilesystemError("denied"); return d; }
  let current = winHandleOf(dir);
  let owned = false;
  try {
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const access = last && !wantWrite ? NT.FILE_GENERIC_READ : NT.FILE_GENERIC_READ | (wantWrite || !last ? NT.FILE_GENERIC_WRITE : 0) | NT.DELETE;
      const disposition = last && (flags & FD_FLAGS.CREATE) ? ((flags & FD_FLAGS.EXCLUSIVE) ? NT.FILE_CREATE : NT.FILE_OPEN_IF) : NT.FILE_OPEN;
      const options = (last ? (isDir ? NT.FILE_DIRECTORY_FILE : NT.FILE_NON_DIRECTORY_FILE) : NT.FILE_DIRECTORY_FILE) | NT.FILE_SYNCHRONOUS_IO_NONALERT;
      let next: number;
      try {
        next = ntCreate(current, parts[i]!, access, disposition, options);
      } catch (e) {
        // Directories opened read-only when write rights are not granted: retry read-only for traversal.
        if (!last && e instanceof FilesystemError && e.code === "denied") next = ntCreate(current, parts[i]!, NT.FILE_GENERIC_READ, disposition, options);
        else throw e;
      }
      if (owned) win().nt.NtClose(current);
      current = next;
      owned = true;
    }
    const finalHandle = current;
    owned = false; // ownership transfers to the CRT fd below
    return crtFdOf(finalHandle, wantWrite ? 2 : 0);
  } catch (e) {
    if (owned) win().nt.NtClose(current);
    throw e;
  }
}

function winList(fd: number): string[] {
  const handle = winHandleOf(fd);
  const names: string[] = [];
  const buf = Buffer.alloc(64 * 1024);
  const iosb = Buffer.alloc(16);
  let restart = 1;
  for (;;) {
    const status = win().nt.NtQueryDirectoryFile(handle, null, null, null, ptr(iosb), ptr(buf), buf.length, NT.FILE_ID_BOTH_DIR_INFORMATION, 0, null, restart);
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
  const parent = winHandleOf(dir);
  const access = NT.DELETE | NT.SYNCHRONIZE | NT.READ_ATTRIBUTES;
  const options = NT.FILE_OPEN_REPARSE_POINT | NT.FILE_SYNCHRONOUS_IO_NONALERT | NT.FILE_DELETE_ON_CLOSE | (directory ? NT.FILE_DIRECTORY_FILE : NT.FILE_NON_DIRECTORY_FILE);
  const h = ntCreate(parent, name, access, NT.FILE_OPEN, options);
  win().nt.NtClose(h); // delete-on-close fires here
}

function winRename(fromDir: number, fromName: string, toDir: number, toName: string): void {
  const src = ntCreate(winHandleOf(fromDir), fromName, NT.DELETE | NT.SYNCHRONIZE | NT.READ_ATTRIBUTES, NT.FILE_OPEN, NT.FILE_OPEN_REPARSE_POINT | NT.FILE_SYNCHRONOUS_IO_NONALERT);
  try {
    const data = Buffer.from(toName, "utf16le");
    const info = Buffer.alloc(20 + data.length);
    info.writeUInt8(0, 0);                                          // ReplaceIfExists = FALSE (exclusive)
    info.writeBigUInt64LE(BigInt(winHandleOf(toDir)), 8);            // RootDirectory
    info.writeUInt32LE(data.length, 16);                             // FileNameLength
    data.copy(info, 20);
    const iosb = Buffer.alloc(16);
    ntStatus(win().nt.NtSetInformationFile(src, ptr(iosb), ptr(info), info.length, NT.FILE_RENAME_INFORMATION));
  } finally {
    win().nt.NtClose(src);
  }
}

function winMkdir(dir: number, name: string): void {
  const h = ntCreate(winHandleOf(dir), name, NT.FILE_GENERIC_READ | NT.FILE_GENERIC_WRITE, NT.FILE_CREATE, NT.FILE_DIRECTORY_FILE | NT.FILE_SYNCHRONOUS_IO_NONALERT);
  win().nt.NtClose(h);
}

// ───────────────────────────── Dispatch ───────────────────────────────────

/** Open one anchored object. Returns an fd usable for fstat and (when opened writable) for I/O. */
export function anchoredOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  if (platform === "linux") return linuxOpen(dir, name, flags, mode, rootAcquisition);
  if (platform === "darwin") return darwinOpen(dir, name, flags, mode, rootAcquisition);
  if (platform === "win32") return winOpen(dir, name, flags, rootAcquisition);
  return unsupported();
}

/**
 * A descriptor for reading/writing the SAME object the classification fd refers to.
 * Linux reopens the authority's own fd through /proc. Darwin and Windows duplicate the fd
 * (reads) or reopen anchored (writes, see `writableSameObject`).
 */
export function descriptorIo(fd: number, writable: boolean): number {
  if (platform === "linux") return linuxReopen(fd, writable);
  if (writable) throw new FilesystemError("denied"); // callers use writableSameObject on these platforms
  if (platform === "darwin") {
    const d = darwin().symbols.dup(fd);
    if (d < 0) darwinFailure();
    return d;
  }
  if (platform === "win32") {
    const d = win().crt._dup(fd);
    if (d < 0) throw new FilesystemError("denied");
    return d;
  }
  return unsupported();
}

/**
 * Writable descriptor for an EXISTING object the authority classified as `fd` under `parentFd/leaf`.
 * Linux: reopen the approved fd. Darwin/Windows: reopen anchored at the same parent, then require the
 * object identity (dev/ino) to match the classified fd, so a swapped object is refused.
 */
export function writableSameObject(parentFd: number, leaf: string, fd: number, objectIdOf: (f: number) => string): number {
  if (platform === "linux") return linuxReopen(fd, true);
  const io = anchoredOpen(parentFd, leaf, 1 | FD_FLAGS.NONBLOCK, 0);
  try {
    if (objectIdOf(io) !== objectIdOf(fd)) throw new FilesystemError("stale");
  } catch (e) { closeSync(io); throw e; }
  return io;
}

/** Entry names of a directory handle (sorted, without "." and ".."). */
export function listFd(fd: number): string[] {
  if (platform === "linux") return readdirSync(`/proc/self/fd/${fd}`).sort();
  if (platform === "darwin") return darwinList(fd);
  if (platform === "win32") return winList(fd);
  return unsupported();
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
