/**
 * XR Phase 1 — WriteGate: the single-writer authority for one SQLite
 * connection (T1/T2/T3).
 *
 * Every mutating statement that runs through the workspace store's connection
 * is executed inside a serialized `BEGIN IMMEDIATE … COMMIT` transaction:
 *
 *   • `IMMEDIATE` acquires the write lock up front, so a read-then-write
 *     sequence can never deadlock or hit the classic "cannot upgrade" busy
 *     failure; cross-process writers serialize at the database level.
 *   • `busy_timeout` (set at open, 5000 ms) makes a contended writer wait
 *     instead of failing with SQLITE_BUSY; a residual busy failure — raised
 *     at BEGIN, at a statement, or at COMMIT — rolls the transaction back and
 *     retries it whole with bounded, jittered exponential backoff (8 retries,
 *     50 ms base ×2ⁿ capped at 2 s, ±50 % jitter).
 *   • A broken audit chain makes appends fail CLOSED (the caller gets a
 *     clear error and a repair path) rather than silently extending a
 *     corrupted chain.
 *   • `executedOutsideTxn` counts any mutating statement that ran while no
 *     write transaction was open — the encoded single-writer invariant that
 *     the T3 property test asserts is zero.
 *
 * The gate also hosts the deterministic crash-injection hook used by the
 * Phase 1 crash matrix (T4). It is inert unless `XR_CRASH_AT_WRITE` is set —
 * production runs never set it.
 */

import type { Statement } from "bun:sqlite";
import { Database } from "bun:sqlite";

/** Thrown when the audit hash chain is corrupted and appends are refused. */
export class AuditChainCorruptedError extends Error {
  constructor(public readonly brokenAt: number, hint = "") {
    super(
      `audit chain is corrupted at entry ${brokenAt} — refusing to extend a broken chain. ` +
        `Run \`xr audit verify\` to confirm and \`xr audit repair --yes\` to truncate suspect entries and re-seed.` +
        (hint ? ` ${hint}` : ""),
    );
    this.name = "AuditChainCorruptedError";
  }
}

/** Thrown when a write cannot complete after bounded retries. */
export class WriteGateBusyError extends Error {
  constructor(public readonly cause: unknown, attempts: number) {
    super(`write did not commit after ${attempts} retries: ${String((cause as Error)?.message ?? cause)}`);
    this.name = "WriteGateBusyError";
  }
}

/** First-keyword classifier: which statements must run inside the write gate. */
const WRITE_PREFIX =
  /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|VACUUM|REINDEX|ANALYZE|ATTACH|DETACH)\b/i;
/** Statements that must run OUTSIDE a transaction (or are clearly reads). */
const NON_WRITE_PREFIX =
  /^\s*(?:PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SELECT|WITH|VALUES|EXPLAIN)\b/i;

export function isWriteStatement(sql: string): boolean {
  if (NON_WRITE_PREFIX.test(sql)) return false;
  return WRITE_PREFIX.test(sql) || true; // conservative: unknown statements are treated as writes
}

/** Synchronous bounded sleep (SQLite ops are synchronous; do not yield). */
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function syncSleep(ms: number): void {
  try {
    Atomics.wait(sleepBuffer, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

function isBusy(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return m.includes("database is locked") || m.includes("SQLITE_BUSY") || m.includes("busy");
}

function killSelf(point: string): never {
  // Deterministic crash injection (T4). Only reachable when the env var is set.
  console.error(`[crash-point] killed by XR_CRASH_AT_WRITE=${point}`);
  process.kill(process.pid, "SIGKILL");
  throw new Error("unreachable");
}

type CrashDirective =
  | { kind: "none" }
  | { kind: "after-begin" }
  | { kind: "before-commit" }
  | { kind: "count"; n: number };

function parseCrashDirective(raw: string | undefined): CrashDirective {
  if (!raw) return { kind: "none" };
  if (raw === "after-begin") return { kind: "after-begin" };
  if (raw === "before-commit") return { kind: "before-commit" };
  const m = /^count:(\d+)$/.exec(raw);
  if (m) return { kind: "count", n: Number(m[1]) };
  return { kind: "none" };
}

export interface WriteGateOptions {
  /** Upper bound on busy retries after busy_timeout is exhausted. */
  maxBusyRetries?: number;
  /** Base backoff ms (multiplied by attempt, jittered). */
  backoffBaseMs?: number;
}

/**
 * The ONE sanctioned way to open a raw SQLite connection in XR. Applies the
 * Phase-1 safe-concurrency PRAGMA set (WAL, synchronous=NORMAL,
 * busy_timeout=5000, foreign_keys=ON, wal_autocheckpoint=1000).
 * All other code must go through WorkspaceStore (the single writer).
 *
 * Order matters: `busy_timeout` is set BEFORE `journal_mode=WAL` because
 * switching to WAL takes a brief exclusive lock and must wait for other
 * connections under contention — with the default busy_timeout (0) that
 * switch fails instantly with SQLITE_BUSY.
 */
export function openDatabase(path: string, opts: { create?: boolean; readonly?: boolean } = {}): Database {
  // A contended OPEN is the one un-gated path that can still surface a raw
  // SQLITE_BUSY ("database is locked") in SQLite — e.g. `journal_mode = WAL`
  // needs a brief exclusive lock, and under a CPU-starved cross-process writer
  // the 5000 ms busy_timeout can be outlasted. The WriteGate only exists AFTER
  // this function returns, so it cannot absorb this class of failure. Retry the
  // whole open+PRAGMA sequence with bounded jittered backoff (same contract as
  // WriteGate.run); any non-busy error (corrupt file, permission) still throws
  // immediately, and a half-open connection is closed before retrying so no
  // leaked file handle is left behind.
  const maxAttempts = 8;
  for (let attempt = 0; ; ) {
    let db: Database | null = null;
    try {
      db = new Database(path, { create: opts.create ?? true, readonly: opts.readonly ?? false });
      db.exec("PRAGMA busy_timeout = 5000;");
      if (!opts.readonly) db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = NORMAL;");
      db.exec("PRAGMA foreign_keys = ON;");
      if (!opts.readonly) db.exec("PRAGMA wal_autocheckpoint = 1000;");
      return db;
    } catch (e) {
      try {
        db?.close();
      } catch {
        /* never opened far enough to close */
      }
      if (isBusy(e) && attempt < maxAttempts) {
        attempt += 1;
        const exponential = Math.min(50 * 2 ** (attempt - 1), 2000);
        syncSleep((exponential * (0.5 + Math.random())) | 0);
        continue;
      }
      throw e;
    }
  }
}

export class WriteGate {
  /** Number of mutating statements that executed outside a write transaction. */
  executedOutsideTxn = 0;
  private inWrite = false;
  private readonly maxBusyRetries: number;
  private readonly backoffBaseMs: number;

  constructor(
    private readonly raw: Database,
    opts: WriteGateOptions = {},
  ) {
    this.maxBusyRetries = opts.maxBusyRetries ?? 8;
    this.backoffBaseMs = opts.backoffBaseMs ?? 50;
  }

  get rawDb(): Database {
    return this.raw;
  }

  /**
   * Bun quirk (observed in Phase 1): a statement created with `db.prepare()`
   * keeps the underlying file open even after `db.close()` unless it is
   * finalized first. Track prepared statements here and finalize them on
   * close/restore so the file lock is genuinely released.
   */
  private readonly prepared = new Set<Statement>();
  trackPrepared(stmt: Statement): void {
    this.prepared.add(stmt);
  }
  /** Finalize every tracked prepared statement (call before db.close()). */
  finalizeAll(): void {
    for (const stmt of this.prepared) {
      try {
        stmt.finalize();
      } catch {
        /* already finalized */
      }
    }
    this.prepared.clear();
  }

  /**
   * Run `fn` inside one serialized IMMEDIATE write transaction.
   * Re-entrant: nested calls join the open transaction.
   */
  run<T>(fn: () => T): T {
    if (this.inWrite) return fn();
    const crash = parseCrashDirective(process.env.XR_CRASH_AT_WRITE);
    let attempts = 0;
    for (;;) {
      let began = false;
      try {
        this.raw.exec("BEGIN IMMEDIATE");
        began = true;
        this.inWrite = true;
        if (crash.kind === "after-begin") killSelf("after-begin");
        const result = fn();
        if (crash.kind === "before-commit") killSelf("before-commit");
        if (crash.kind === "count" && crash.n === this.writeCount) killSelf(`count:${crash.n}`);
        this.raw.exec("COMMIT");
        this.writeCount += 1;
        return result;
      } catch (e) {
        // Undo any partial transaction before deciding what happens next —
        // except after a crash-injection kill, where the connection is gone.
        if (began && crash.kind === "none") {
          try {
            this.raw.exec("ROLLBACK");
          } catch {
            /* connection may be gone after a kill */
          }
        }
        // A busy failure can surface at BEGIN, at a statement, or at COMMIT
        // (in WAL the commit itself takes the write lock, and a CPU-starved
        // lock holder can outlast busy_timeout). The whole transaction is
        // deterministic, so ROLLBACK + retry replays it against fresh state
        // with no partial effects. ONLY busy is retried — constraint or logic
        // errors must throw immediately, never be replayed.
        if (isBusy(e)) {
          if (attempts < this.maxBusyRetries) {
            attempts += 1;
            syncSleep(this.backoffDelay(attempts));
            continue;
          }
          throw new WriteGateBusyError(e, attempts + 1);
        }
        throw e;
      } finally {
        this.inWrite = false;
      }
    }
  }

  /** Jittered exponential backoff: base×2ⁿ capped at 2 s, ±50 % jitter. */
  private backoffDelay(attempt: number): number {
    const exponential = Math.min(this.backoffBaseMs * 2 ** (attempt - 1), 2000);
    return (exponential * (0.5 + Math.random())) | 0;
  }

  /** Total committed write transactions on this connection (crash-injection targeting). */
  get committedWriteCount(): number {
    return this.writeCount;
  }
  private writeCount = 0;

  /** Record that a mutating statement ran outside the gate (invariant break). */
  markUnsafeWrite(): void {
    this.executedOutsideTxn += 1;
  }

  /** Execute a statement, gating mutations (sql is the statement's source). */
  runStatement(stmt: Statement, params: unknown[], sql: string): unknown {
    if (!isWriteStatement(sql)) {
      return stmt.run(...params);
    }
    return this.run(() => stmt.run(...params));
  }

  /** Execute a raw SQL blob, gating mutations (first statement decides). */
  exec(sql: string): unknown {
    if (!isWriteStatement(sql)) {
      return this.raw.exec(sql);
    }
    return this.run(() => this.raw.exec(sql));
  }
}

/** Wrap a Statement so `run` is gated (reads pass through). */
export function gateStatement(stmt: Statement, gate: WriteGate, sql: string): Statement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return (...params: unknown[]) => gate.runStatement(target, params, sql);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * Wrap a Database so `query`, `prepare`, and `exec` all route mutations
 * through the gate. This makes the connection itself the single writer: any
 * mutating statement executed through the store's connection is serialized
 * and transactional by construction (T3).
 */
export function gateConnection(db: Database, gate: WriteGate): Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "prepare") {
        return (sql: string, ...rest: unknown[]) => {
          // Method call on `target` keeps the `this` binding.
          const stmt = (prop === "prepare"
            ? (target as unknown as { prepare(s: string, ...a: unknown[]): Statement }).prepare(sql, ...rest)
            : (target as unknown as { query(s: string, ...a: unknown[]): Statement }).query(sql, ...rest));
          if (prop === "prepare") gate.trackPrepared(stmt);
          return gateStatement(stmt, gate, sql);
        };
      }
      if (prop === "exec") {
        return (sql: string) => gate.exec(sql);
      }
      if (prop === "transaction") {
        // Superseded by the gate; code must use WriteGate.run. Fail loudly so
        // a legacy caller cannot open an un-serialized DEFERRED transaction.
        throw new Error(
          "db.transaction() is disabled by the Phase 1 single-writer invariant — use WriteGate.run() / store.write() instead",
        );
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
