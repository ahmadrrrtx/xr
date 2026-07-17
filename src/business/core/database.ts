/**
 * XR Business OS — Database Manager
 * 
 * Integrates with XR's existing SQLite database.
 * Adds business tables without modifying existing XR tables.
 */

import { BUSINESS_SCHEMA_VERSION, BUSINESS_TABLES, BUSINESS_TABLE_NAMES } from './schema.ts';

export class BusinessDatabase {
  private db: any; // XR's existing Database instance
  private initialized = false;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Initialize business tables in existing XR database.
   * Safe to call multiple times (idempotent).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check current schema version
    const currentVersion = await this.getSchemaVersion();

    if (currentVersion < BUSINESS_SCHEMA_VERSION) {
      await this.migrate(currentVersion);
    }

    this.initialized = true;
  }

  /**
   * Get current business schema version.
   */
  async getSchemaVersion(): Promise<number> {
    try {
      const row = this.db.prepare(
        'SELECT version FROM biz_schema_version ORDER BY version DESC LIMIT 1'
      ).get();
      return row?.version ?? 0;
    } catch {
      // Table doesn't exist yet
      return 0;
    }
  }

  /**
   * Run migrations from current version to latest.
   */
  private async migrate(fromVersion: number): Promise<void> {
    const tx = this.db.transaction(() => {
      // Create all tables
      const statements = BUSINESS_TABLES
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const stmt of statements) {
        this.db.prepare(stmt).run();
      }

      // Record schema version
      this.db.prepare(
        'INSERT INTO biz_schema_version (version) VALUES (?)'
      ).run(BUSINESS_SCHEMA_VERSION);
    });

    tx();
  }

  /**
   * Check if business tables exist.
   */
  isInitialized(): boolean {
    try {
      this.db.prepare('SELECT 1 FROM biz_organizations LIMIT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get database statistics.
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const table of BUSINESS_TABLE_NAMES) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        stats[table] = row?.count ?? 0;
      } catch {
        stats[table] = 0;
      }
    }
    return stats;
  }

  /**
   * Get raw database instance for direct queries.
   */
  getDb(): any {
    return this.db;
  }

  /**
   * Run in transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Prepare a statement.
   */
  prepare(sql: string): any {
    return this.db.prepare(sql);
  }

  /**
   * Generate a unique ID.
   */
  static generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get current ISO timestamp.
   */
  static now(): string {
    return new Date().toISOString();
  }
}
