/**
 * B17 — is a SQLite database still open anywhere? SQLite cannot take a WAL database out of WAL mode while
 * any other connection, in any process (this one included), holds it open, and the operating system drops
 * those locks when a process dies. The probe is therefore crash-proof and needs no side files. When it
 * succeeds it has switched an unheld database out of WAL mode, which is harmless for a database about to be
 * deleted (the next open restores WAL); when it refuses, nothing changed.
 */
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { openDatabase } from "./write-gate.ts"; // the one sanctioned raw-connection factory (single-writer invariant)

export function databaseIdle(dbPath: string): boolean {
  if (!existsSync(dbPath)) return true;
  let db: Database | undefined;
  try {
    db = openDatabase(dbPath); // existence checked above, so this never creates a file
    db.exec("PRAGMA busy_timeout = 0");
    const row = db.query("PRAGMA journal_mode = DELETE").get() as { journal_mode?: string } | null;
    return String(row?.journal_mode).toLowerCase() === "delete";
  } catch {
    return false; // "database is locked": another connection holds it
  } finally {
    db?.close();
  }
}
