/**
 * XR — shared SQLite store base.
 *
 * The specialized stores in src/state/stores/* depend on this file.  It keeps
 * database opening, WAL mode and close semantics in one place.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { XR_HOME } from "../config/config.ts";

export class BaseStore {
  protected readonly db: Database;

  constructor(path = join(XR_HOME, "xr.db")) {
    if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  protected exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
