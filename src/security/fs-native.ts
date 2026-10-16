/** Linux handle-relative filesystem primitive. No path-check/open fallback.
 * This is NOT a portable support claim: unsupported kernels/ABIs fail closed.
 */
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";

export class FilesystemError extends Error {
  constructor(readonly code: "denied" | "missing" | "stale" | "limit" | "unsupported" | "escape" | "binary" = "denied") {
    super(code === "escape" ? "path escapes the project root" : `filesystem ${code}`);
    this.name = "FilesystemError";
  }
}
export const FD_FLAGS = { PATH: 0x200000, DIRECTORY: 0x10000, NOFOLLOW: 0x20000, CLOEXEC: 0x80000, NONBLOCK: 0x800, CREATE: 0x40, EXCLUSIVE: 0x80 } as const;
const CSTRING = FFIType.ptr;
function load() {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) throw new FilesystemError("unsupported");
  try {
    return dlopen("libc.so.6", {
      syscall: { args: [FFIType.i64, FFIType.i32, CSTRING, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      open: { args: [CSTRING, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
      mkdirat: { args: [FFIType.i32, CSTRING, FFIType.u32], returns: FFIType.i32 },
      unlinkat: { args: [FFIType.i32, CSTRING, FFIType.i32], returns: FFIType.i32 },
      renameat: { args: [FFIType.i32, CSTRING, FFIType.i32, CSTRING], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr },
    });
  } catch { throw new FilesystemError("unsupported"); }
}
let library: ReturnType<typeof load> | undefined;
const libc = () => library ??= load();
const str = (s: string) => Buffer.from(s + "\0");
function failure(): never {
  const loc = libc().symbols.__errno_location();
  const errno = loc ? new DataView(toArrayBuffer(loc, 0, 4)).getInt32(0, true) : 0;
  throw new FilesystemError(errno === 2 ? "missing" : [38, 22, 7].includes(errno) ? "unsupported" : "denied");
}
/** openat2 resolves the WHOLE path under the descriptor in a single kernel lookup. */
export function anchoredOpen(dir: number, name: string, flags: number, mode = 0, rootAcquisition = false): number {
  const n = str(name);
  // BENEATH | NO_XDEV | NO_SYMLINKS | NO_MAGICLINKS. Root acquisition may
  // cross mounts on the host-selected canonical path, but not follow links.
  const how = new BigUint64Array([BigInt(flags | FD_FLAGS.CLOEXEC | FD_FLAGS.NOFOLLOW), BigInt(mode), BigInt(rootAcquisition ? 0x06 : 0x0f)]);
  const fd = Number(libc().symbols.syscall(437, dir, ptr(n), ptr(how), 24));
  if (fd < 0) failure();
  return fd;
}
/** Only the authority's OWN O_PATH descriptor may be reopened here. Never model paths. */
export function descriptorIo(fd: number, writable: boolean): number {
  const p = str(`/proc/self/fd/${fd}`);
  const opened = libc().symbols.open(ptr(p), (writable ? 1 : 0) | FD_FLAGS.CLOEXEC | FD_FLAGS.NONBLOCK, 0);
  if (opened < 0) failure();
  return opened;
}
export function anchoredMkdir(dir: number, name: string): void {
  const p = str(name);
  if (libc().symbols.mkdirat(dir, ptr(p), 0o700) !== 0) failure();
}
export function anchoredUnlink(dir: number, name: string, directory = false): void {
  const p = str(name);
  if (libc().symbols.unlinkat(dir, ptr(p), directory ? 0x200 : 0) !== 0) failure();
}
export function anchoredRename(from: number, name: string, to: number, target: string): void {
  const p = str(name), q = str(target);
  if (libc().symbols.renameat(from, ptr(p), to, ptr(q)) !== 0) failure();
}
