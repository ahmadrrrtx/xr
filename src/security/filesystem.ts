/** Shared operation-owning file authority. See docs/implementation/stage-a/a1/DESIGN.md.
 * Paths are proposals, never capabilities. All content I/O is through retained FDs.
 */
import { realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Canonical absolute spelling: realpath of the deepest existing ancestor, plus the not-yet-existing tail.
 * Handles macOS /var -> /private/var and Windows 8.3 short names (RUNNER~1) for absolute inputs. Only a
 * path string is produced; every object is still re-checked by the anchored open.
 */
export function canonicalAbsolute(abs: string): string {
  const full = resolve(abs);
  let cur = full;
  const rest: string[] = [];
  for (;;) {
    try { return rest.length ? join(realpathSync(cur), ...rest) : realpathSync(cur); }
    catch {
      const parent = dirname(cur);
      if (parent === cur) return full;
      rest.unshift(basename(cur));
      cur = parent;
    }
  }
}
import { isSecretPath } from "./guard.ts";
import { anchoredOpen, anchoredMkdir, anchoredRename, anchoredUnlink, descriptorIo, writableSameObject, listFd, fdStat, fdRead, fdWrite, fdTruncate, fdClose, type FdStat, FD_FLAGS, FilesystemError } from "./fs-native.ts";
export { FilesystemError } from "./fs-native.ts";

const MAX_BYTES = 10 * 1024 * 1024, MAX_DEPTH = 32, MAX_ENTRIES = 10_000; // aligned with the plugin fs cap (10 MB)
export type FilePurpose = "model-tool" | "context" | "preview" | "daemon" | "desktop" | "index" | "plugin";
/** Passed by the trusted Trust adapter only. It is never parsed from model/HTTP args. */
export interface FilesystemLease {
  readonly grantId: string;
  readonly actor: string;
  readonly purpose: FilePurpose;
  readonly generation: string;
  readonly deniedPaths: readonly string[];
  current(): boolean;
  permits(path: string, operation: "read" | "write" | "list", objectId: string): boolean;
  permitsSensitiveRead(path: string, objectId: string): boolean;
}
export interface FileMetadata {
  path: string; name: string; directory: boolean; size: number; mtimeMs: number; objectId: string;
}
export interface FileSnapshot { content: string; bytes: Buffer; size: number; mtimeMs: number; identity: string; path: string; }
const objectId = (st: FdStat) => `${st.dev}:${st.ino}`;
const version = (st: FdStat) => `${objectId(st)}:${st.ctimeMs}:${st.mtimeMs}:${st.size}:${st.nlink}`;
export function filesystemMessage(e: unknown): string {
  return e instanceof FilesystemError ? e.message : "filesystem denied";
}

export class FilesystemAuthority {
  readonly root: string;
  readonly id = randomUUID();
  readonly rootIdentity: string;
  private readonly rootFd: number;
  private readonly suppliedRoot: string;
  private closed = false;
  // Every object must live on the root's device: O_NOFOLLOW_ANY (darwin) does not stop mount crossings.
  private readonly rootDev: number = -1;
  constructor(root: string, readonly purpose: FilePurpose = "model-tool", private readonly lease?: FilesystemLease) {
    try {
      this.suppliedRoot = resolve(root);
      this.root = realpathSync(this.suppliedRoot);
      this.rootFd = anchoredOpen(-100, this.root, FD_FLAGS.PATH | FD_FLAGS.DIRECTORY, 0, true);
      this.rootIdentity = objectId(fdStat(this.rootFd));
      this.rootDev = fdStat(this.rootFd).dev;
    } catch (e) { throw e instanceof FilesystemError ? e : new FilesystemError(); }
  }
  close(): void { if (!this.closed) { this.closed = true; fdClose(this.rootFd); } }
  private active(): void {
    if (this.closed || (this.lease && (this.lease.purpose !== this.purpose || !this.lease.current()))) throw new FilesystemError("stale");
  }
  /** Canonical root identity + denied policy survive handoff; NOT a mount authorization. */
  descriptor() {
    this.active();
    return Object.freeze({ version: 1 as const, id: this.id, root: this.root, rootIdentity: this.rootIdentity,
      purpose: this.purpose, actor: this.lease?.actor ?? "workspace", grantId: this.lease?.grantId ?? null,
      grantGeneration: this.lease?.generation ?? null, deniedPaths: [...(this.lease?.deniedPaths ?? [])],
      deniedPathPolicyId: createHash("sha256").update(JSON.stringify(["guard-sensitive-v2", this.lease?.deniedPaths ?? []])).digest("hex"),
      sensitivePolicy: "guard-sensitive-v2", symlinks: "deny" as const, hardlinks: "deny" as const, mountCrossings: "deny" as const });
  }
  private path(input: string): string {
    this.active();
    if (typeof input !== "string" || !input || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) throw new FilesystemError();
    let p: string;
    if (isAbsolute(input)) {
      // Absolute inputs (drive letters, backslashes, 8.3 names) are canonicalised first, then must land inside the root.
      p = relative(this.root, canonicalAbsolute(input)).split(sep).join("/");
    } else {
      if (/\\/.test(input) || /^[A-Za-z]:/.test(input) || /^\/\//.test(input)) throw new FilesystemError();
      p = input;
    }
    const parts = p.split("/");
    if (parts.includes("..")) throw new FilesystemError("escape");
    if (parts.length > MAX_DEPTH) throw new FilesystemError("limit");
    if (isAbsolute(p)) throw new FilesystemError("escape");
    return p.split("/").filter(x => x && x !== ".").join("/") || ".";
  }
  private check(p: string, op: "read" | "write" | "list", id: string): void {
    this.active();
    const absolute = resolve(this.root, p);
    if (this.lease && !this.lease.permits(absolute, op, id)) throw new FilesystemError();
    if (op === "read" && (isSecretPath(p) || isSecretPath(absolute)) && !this.lease?.permitsSensitiveRead(absolute, id)) throw new FilesystemError("denied", "secret-path");
  }
  private open(p: string, directory = false): number {
    this.active();
    const fd = anchoredOpen(this.rootFd, p, FD_FLAGS.PATH | (directory ? FD_FLAGS.DIRECTORY : 0));
    const st = fdStat(fd);
    if (st.dev !== this.rootDev) { fdClose(fd); throw new FilesystemError(); }
    // O_PATH inspects type/link count without opening devices/FIFOs for I/O.
    if ((!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink !== 1)) { fdClose(fd); throw new FilesystemError(); }
    return fd;
  }
  private snapshotFd(fd: number, p: string, limit: number, binary = false): FileSnapshot {
    const st = fdStat(fd);
    if (!st.isFile() || st.nlink !== 1) throw new FilesystemError();
    this.check(p, "read", objectId(st));
    if (st.size > limit || limit > MAX_BYTES) throw new FilesystemError("limit");
    const io = descriptorIo(fd, false);
    try {
      if (version(fdStat(io)) !== version(st)) throw new FilesystemError("stale");
      const buffer = Buffer.alloc(Math.min(limit + 1, st.size + 1));
      let n = 0;
      while (n < buffer.length) { const count = fdRead(io, buffer, n, buffer.length - n, n); if (!count) break; n += count; }
      if (n > limit) throw new FilesystemError("limit");
      if (version(fdStat(io)) !== version(st) || version(fdStat(fd)) !== version(st)) throw new FilesystemError("stale");
      const bytes = buffer.subarray(0, n);
      if (!binary && bytes.includes(0)) throw new FilesystemError("binary");
      return { content: binary ? "" : bytes.toString("utf8"), bytes, size: n, mtimeMs: st.mtimeMs, path: p,
        identity: `${version(st)}:${createHash("sha256").update(bytes).digest("hex")}` };
    } finally { fdClose(io); }
  }
  read(input: string, limit = 1_000_000): FileSnapshot {
    const p = this.path(input), fd = this.open(p);
    try { return this.snapshotFd(fd, p, limit); } finally { fdClose(fd); }
  }
  readBytes(input: string, limit = 1_000_000): Omit<FileSnapshot, "content"> {
    const p = this.path(input), fd = this.open(p);
    try { const { content: _, ...snapshot } = this.snapshotFd(fd, p, limit, true); return snapshot; }
    finally { fdClose(fd); }
  }
  metadata(input: string): FileMetadata {
    const p = this.path(input), fd = this.open(p);
    try {
      const st = fdStat(fd);
      // Metadata is also a grant-controlled candidate: a permitted directory
      // listing must not reveal entries that the same lease explicitly blocks.
      if (this.lease) this.check(p, st.isDirectory() ? "list" : "read", objectId(st));
      return { path: p, name: p.split("/").pop()!, directory: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs, objectId: objectId(st) };
    }
    finally { fdClose(fd); }
  }
  list(input = ".", cap = 600): FileMetadata[] {
    const p = this.path(input), fd = this.open(p, true);
    try {
      this.check(p, "list", objectId(fdStat(fd)));
      // The proc path names our own retained directory descriptor, not a user path.
      const names = listFd(fd);
      if (names.length > MAX_ENTRIES) throw new FilesystemError("limit");
      const entries: FileMetadata[] = [];
      for (const name of names) {
        if (entries.length >= Math.min(cap, MAX_ENTRIES)) break;
        const child = p === "." ? name : `${p}/${name}`;
        if (isSecretPath(child) || isSecretPath(resolve(this.root, child))) continue;
        try { entries.push(this.metadata(child)); } catch { /* unsafe entries are not candidates */ }
      }
      return entries;
    } finally { fdClose(fd); }
  }
  walk(input = ".", skip = new Set<string>(), cap = MAX_ENTRIES): FileMetadata[] {
    const first = this.metadata(input);
    if (!first.directory) { this.check(first.path, "read", first.objectId); return [first]; }
    const queue = [first.path], out: FileMetadata[] = [];
    let visited = 0;
    while (queue.length && out.length < cap) {
      if (++visited > MAX_ENTRIES) throw new FilesystemError("limit");
      const dir = queue.shift()!;
      if (dir.split("/").length >= MAX_DEPTH) continue;
      for (const entry of this.list(dir, MAX_ENTRIES)) {
        if (skip.has(entry.name)) continue;
        if (entry.directory) queue.push(entry.path); else out.push(entry);
        if (out.length >= Math.min(cap, MAX_ENTRIES)) break;
      }
    }
    return out;
  }
  /** Pre-read and retain authority across an asynchronous approval. Never return a safe path. */
  prepare(input: string, operation: "write" | "delete", limit = 1_000_000): PreparedFileOperation {
    const p = this.path(input);
    if (p === ".") throw new FilesystemError();
    const pieces = p.split("/"), leaf = pieces.pop()!;
    const missing: string[] = [];
    let parent = pieces.join("/") || ".", parentFd: number;
    for (;;) {
      try { parentFd = this.open(parent, true); break; }
      catch (e) {
        if (operation !== "write" || parent === "." || !(e instanceof FilesystemError && e.code === "missing")) throw e;
        missing.unshift(pieces.pop()!);
        parent = pieces.join("/") || ".";
      }
    }
    const parentIdentity = objectId(fdStat(parentFd));
    let fd: number | undefined;
    try {
      try { fd = this.open(p); } catch (e) { if (!(e instanceof FilesystemError && e.code === "missing" && operation === "write")) throw e; }
      const st = fd === undefined ? undefined : fdStat(fd);
      if (st && !st.isFile()) throw new FilesystemError();
      this.check(p, "write", st ? objectId(st) : "missing");
      const sensitive = isSecretPath(p) || isSecretPath(resolve(this.root, p));
      // Edit consent is not read consent. Existing secret bytes are withheld.
      const snapshot = fd === undefined || sensitive ? undefined : this.snapshotFd(fd, p, limit);
      const stamp = st ? version(st) : "missing";
      const identity = Object.freeze({ ...this.descriptor(), operation, path: p, parentIdentity, missingParents: [...missing], target: stamp, sensitive });
      let finished = false;
      const close = () => { if (!finished) { finished = true; if (fd !== undefined) fdClose(fd); fdClose(parentFd); } };
      const validate = () => {
        this.active();
        this.check(p, "write", st ? objectId(st) : "missing");
        if (finished) throw new FilesystemError("stale");
        const currentParent = this.open(parent, true);
        try { if (objectId(fdStat(currentParent)) !== parentIdentity) throw new FilesystemError("stale"); } finally { fdClose(currentParent); }
        if (missing.length) {
          let appeared: number | undefined;
          try { appeared = this.open(parent === "." ? missing[0]! : `${parent}/${missing[0]}`, true); }
          catch (e) { if (!(e instanceof FilesystemError && e.code === "missing")) throw new FilesystemError("stale"); }
          finally { if (appeared !== undefined) fdClose(appeared); }
          if (appeared !== undefined) throw new FilesystemError("stale");
        }
        let current: number | undefined;
        try { current = this.open(p); }
        catch (e) { if (!(e instanceof FilesystemError && e.code === "missing" && fd === undefined)) throw new FilesystemError("stale"); }
        if (current !== undefined) {
          try { if (version(fdStat(current)) !== stamp) throw new FilesystemError("stale"); } finally { fdClose(current); }
        }
        if (fd !== undefined && version(fdStat(fd)) !== stamp) throw new FilesystemError("stale");
      };
      return {
        path: p, identity, oldContent: snapshot?.content ?? "", existed: fd !== undefined, sensitive,
        mtimeMs: st?.mtimeMs, close, validate,
        commit: (content?: string) => {
          validate();
          if (operation === "delete") { anchoredUnlink(parentFd, leaf); return; }
          if (typeof content !== "string" || Buffer.byteLength(content) > limit) throw new FilesystemError("limit");
          let io: number;
          if (fd === undefined) {
            const made: number[] = [];
            let destination = parentFd;
            try {
              for (const name of missing) {
                anchoredMkdir(destination, name);
                destination = anchoredOpen(destination, name, FD_FLAGS.PATH | FD_FLAGS.DIRECTORY);
                made.push(destination);
              }
              io = anchoredOpen(destination, leaf, 1 | FD_FLAGS.CREATE | FD_FLAGS.EXCLUSIVE | FD_FLAGS.NONBLOCK, 0o600);
            } finally { for (const directory of made.reverse()) fdClose(directory); }
          } else io = writableSameObject(parentFd, leaf, fd, (f) => objectId(fdStat(f))); // approved inode, identity-checked
          try {
            const now = fdStat(io);
            if (!now.isFile() || now.nlink !== 1 || (fd !== undefined && version(now) !== stamp)) throw new FilesystemError("stale");
            const b = Buffer.from(content);
            let written = 0;
            while (written < b.length) { const n = fdWrite(io, b, written, b.length - written, written); if (!n) throw new FilesystemError(); written += n; }
            fdTruncate(io, b.length);
          } finally { fdClose(io); }
        },
      };
    } catch (e) { if (fd !== undefined) fdClose(fd); fdClose(parentFd); throw e; }
  }
  /** Preflight only: would read() be authorized for this regular file? Performs no content I/O. */
  canRead(input: string): boolean {
    try {
      const p = this.path(input), fd = this.open(p);
      try {
        const st = fdStat(fd);
        if (!st.isFile() || st.nlink !== 1) return false;
        this.check(p, "read", objectId(st));
        return true;
      } finally { fdClose(fd); }
    } catch { return false; }
  }
  /** Bounded preview read (first `limit` bytes). Same identity, sensitive and hardlink checks as read(). */
  readPrefix(input: string, limit: number): { bytes: Buffer; size: number; mtimeMs: number; truncated: boolean } {
    const p = this.path(input), fd = this.open(p);
    try {
      const st = fdStat(fd);
      if (!st.isFile() || st.nlink !== 1) throw new FilesystemError();
      this.check(p, "read", objectId(st));
      if (limit > MAX_BYTES) throw new FilesystemError("limit");
      const want = Math.min(limit, st.size);
      const io = descriptorIo(fd, false);
      try {
        const buffer = Buffer.alloc(want);
        let n = 0;
        while (n < want) { const c = fdRead(io, buffer, n, want - n, n); if (!c) break; n += c; }
        if (version(fdStat(io)) !== version(st) || version(fdStat(fd)) !== version(st)) throw new FilesystemError("stale");
        return { bytes: buffer.subarray(0, n), size: st.size, mtimeMs: st.mtimeMs, truncated: st.size > limit };
      } finally { fdClose(io); }
    } finally { fdClose(fd); }
  }
  /** Approval-bound creation. Refuses existing targets, escaping ancestors and special files. */
  prepareCreate(input: string, kind: "file" | "folder"): PreparedFileOperation & { existed: boolean } {
    const p = this.path(input);
    if (p === ".") throw new FilesystemError();
    if (kind === "file") {
      const op = this.prepare(p, "write");
      if (op.existed) { op.close(); throw new FilesystemError("stale"); }
      const innerCommit = op.commit;
      // Capture the original commit BEFORE overriding it (a self-reference here recurses forever).
      return Object.assign(op, { existed: false, commit: () => innerCommit("") });
    }
    this.assertAbsent(p);
    const parent = splitParent(p).parent;
    const pfd = this.open(parent, true);
    const parentIdentity = objectId(fdStat(pfd));
    fdClose(pfd);
    return {
      path: p, identity: Object.freeze({ ...this.descriptor(), operation: "create-folder", path: p, parentIdentity }), oldContent: "",
      existed: false, sensitive: false, mtimeMs: undefined, close: () => undefined,
      validate: () => { this.assertAbsent(p); },
      commit: () => { this.assertAbsent(p); this.mkdir(p); },
    };
  }
  private assertAbsent(p: string): void {
    let fd: number | undefined;
    try { fd = this.open(p); } catch (e) {
      if (e instanceof FilesystemError && e.code === "missing") return;
      throw e;
    }
    fdClose(fd);
    throw new FilesystemError("stale");
  }
  /**
   * Approval-bound rename inside one root. Sensitive sources (or directories containing any
   * sensitive entry) are refused: moving them would make protected bytes readable under a new name.
   * The destination must be absent; missing destination parents are created component-relative.
   * Residual: the moved object is re-verified after renameat; a mismatch is renamed back and reported stale.
   */
  prepareRename(from: string, to: string): PreparedFileOperation & { existed: boolean } {
    const a = this.path(from), b = this.path(to);
    if (a === "." || b === "." || a === b || b.startsWith(a + "/")) throw new FilesystemError();
    const srcFd = this.open(a);
    const srcSt = fdStat(srcFd);
    fdClose(srcFd);
    const srcId = objectId(srcSt);
    this.check(a, "write", srcId);
    if (isSecretPath(a) || isSecretPath(resolve(this.root, a)) || (srcSt.isDirectory() && this.sensitiveDescendant(a, 0))) throw new FilesystemError("denied", "secret-path");
    this.assertAbsent(b);
    const sp = splitParent(a), dp = splitParent(b);
    const identity = Object.freeze({ ...this.descriptor(), operation: "rename", path: a, target: b, sourceObject: srcId });
    return {
      path: a, identity, oldContent: "", existed: true, sensitive: false, mtimeMs: undefined, close: () => undefined,
      validate: () => { this.check(a, "write", srcId); this.assertAbsent(b); },
      commit: () => {
        this.active();
        const again = this.open(a);
        try { if (objectId(fdStat(again)) !== srcId) throw new FilesystemError("stale"); } finally { fdClose(again); }
        this.assertAbsent(b);
        if (dp.parent !== ".") this.mkdir(dp.parent);
        const srcParent = this.open(sp.parent, true), dstParent = this.open(dp.parent, true);
        try { anchoredRename(srcParent, sp.leaf, dstParent, dp.leaf); }
        finally { fdClose(srcParent); fdClose(dstParent); }
        const moved = this.open(b);
        let ok = false;
        try { ok = objectId(fdStat(moved)) === srcId; } finally { fdClose(moved); }
        if (!ok) {
          const d2 = this.open(dp.parent, true), s2 = this.open(sp.parent, true);
          try { anchoredRename(d2, dp.leaf, s2, sp.leaf); } finally { fdClose(d2); fdClose(s2); }
          throw new FilesystemError("stale");
        }
      },
    };
  }
  private sensitiveDescendant(p: string, depth: number): boolean {
    if (depth > MAX_DEPTH) throw new FilesystemError("limit");
    const dfd = this.open(p, true);
    let names: string[];
    try { names = listFd(dfd); } finally { fdClose(dfd); }
    if (names.length > MAX_ENTRIES) throw new FilesystemError("limit");
    for (const name of names) {
      const child = `${p}/${name}`;
      if (isSecretPath(child) || isSecretPath(resolve(this.root, child))) return true;
      const cfd = this.open(child);
      let directory = false;
      try { directory = fdStat(cfd).isDirectory(); } finally { fdClose(cfd); }
      if (directory && this.sensitiveDescendant(child, depth + 1)) return true;
    }
    return false;
  }
  /** Every entry under `p` must be a regular file or directory (no links/special files). Throws before any deletion. */
  private scanRemovable(p: string, depth: number, budget: { n: number; files: number }): void {
    if (depth > MAX_DEPTH) throw new FilesystemError("limit");
    const dfd = this.open(p, true);
    let names: string[];
    try { names = listFd(dfd); } finally { fdClose(dfd); }
    for (const name of names) {
      if (++budget.n > MAX_ENTRIES) throw new FilesystemError("limit");
      const child = `${p}/${name}`;
      const cfd = this.open(child);
      let directory = false;
      try { directory = fdStat(cfd).isDirectory(); } finally { fdClose(cfd); }
      if (directory) this.scanRemovable(child, depth + 1, budget); else budget.files += 1;
    }
  }
  private removeTree(p: string): void {
    const dfd = this.open(p, true);
    let names: string[];
    try { names = listFd(dfd); } finally { fdClose(dfd); }
    for (const name of names) {
      const child = `${p}/${name}`;
      const cfd = this.open(child);
      let directory = false;
      try { directory = fdStat(cfd).isDirectory(); } finally { fdClose(cfd); }
      if (directory) this.removeTree(child);
      const pfd = this.open(p, true);
      try { anchoredUnlink(pfd, name, directory); } finally { fdClose(pfd); }
    }
  }
  /** Approval-bound removal. Directories only when `recursive`; the whole tree is scanned before any unlink. */
  prepareRemove(input: string, recursive: boolean): PreparedFileOperation & { existed: boolean; files: number } {
    const p = this.path(input);
    if (p === ".") throw new FilesystemError();
    const fd = this.open(p);
    const st = fdStat(fd);
    fdClose(fd);
    if (st.isDirectory() && !recursive) throw new FilesystemError();
    const id = objectId(st);
    this.check(p, "write", id);
    const sp = splitParent(p);
    const assertSame = () => {
      const again = this.open(p);
      try { if (objectId(fdStat(again)) !== id) throw new FilesystemError("stale"); } finally { fdClose(again); }
    };
    const scan = () => { const budget = { n: 0, files: 0 }; if (st.isDirectory()) this.scanRemovable(p, 0, budget); return budget.files; };
    const files = scan() + (st.isDirectory() ? 0 : 1);
    return {
      path: p, identity: Object.freeze({ ...this.descriptor(), operation: "delete", path: p, target: id, recursive }),
      oldContent: "", existed: true, sensitive: false, mtimeMs: st.mtimeMs, close: () => undefined, files,
      validate: () => { assertSame(); scan(); },
      commit: () => {
        assertSame(); scan();
        if (st.isDirectory()) this.removeTree(p);
        const pfd = this.open(sp.parent, true);
        try { anchoredUnlink(pfd, sp.leaf, st.isDirectory()); } finally { fdClose(pfd); }
      },
    };
  }
  /** Directory creation is component-relative; unsafe aliases are never followed. */
  mkdir(input: string): void {
    const p = this.path(input), parts = p.split("/");
    let rel = ".";
    for (const name of parts) {
      const next = rel === "." ? name : `${rel}/${name}`;
      const parent = this.open(rel, true);
      try {
        this.check(next, "write", "missing");
        let found: number | undefined;
        try { found = this.open(next, true); }
        catch (e) { if (!(e instanceof FilesystemError && e.code === "missing")) throw e; anchoredMkdir(parent, name); }
        finally { if (found !== undefined) fdClose(found); }
      } finally { fdClose(parent); }
      rel = next;
    }
  }
}
export type FilesystemDescriptor = ReturnType<FilesystemAuthority["descriptor"]>;

/** For synchronous, bounded operations only; do not return an async operation. */
export function withFilesystem<T>(root: string, purpose: FilePurpose, run: (fs: FilesystemAuthority) => T): T {
  const fs = new FilesystemAuthority(root, purpose);
  try { return run(fs); } finally { fs.close(); }
}

export interface PreparedFileOperation {
  readonly path: string;
  readonly identity: Readonly<Record<string, unknown>>;
  readonly oldContent: string;
  readonly existed: boolean;
  readonly sensitive: boolean;
  readonly mtimeMs?: number;
  validate(): void;
  commit(content?: string): void;
  close(): void;
}
/** Synchronous bounded loader for implicit/model content, never internal config. */
export function readWorkspaceText(root: string, path: string, purpose: FilePurpose = "context", limit = 1_000_000): string {
  const fs = new FilesystemAuthority(root, purpose);
  try { return fs.read(path, limit).content; } finally { fs.close(); }
}

function splitParent(p: string): { parent: string; leaf: string } {
  const pieces = p.split("/");
  const leaf = pieces.pop()!;
  return { parent: pieces.join("/") || ".", leaf };
}
