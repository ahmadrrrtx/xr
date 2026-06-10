/**
 * XR — Cost Store
 * Manages cost events and budget configuration.
 */

import { BaseStore } from "../store.ts";

export interface CostEvent {
  id: number;
  session_id: string | null;
  provider: string | null;
  model: string;
  in_tokens: number;
  out_tokens: number;
  usd: number;
  created_at: number;
}

export interface BudgetConfig {
  monthly_cap: number;
  daily_cap: number | null;
  warnings_enabled: boolean;
  auto_fallback: boolean;
}

export class CostStore extends BaseStore {
  constructor() {
    super();
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS cost_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        provider TEXT,
        model TEXT NOT NULL,
        in_tokens INTEGER NOT NULL,
        out_tokens INTEGER NOT NULL,
        usd REAL NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budget_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        monthly_cap REAL NOT NULL,
        daily_cap REAL,
        warnings_enabled INTEGER NOT NULL DEFAULT 1,
        auto_fallback INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);
  }

  recordCost(
    sessionId: string,
    provider: string,
    model: string,
    inTokens: number,
    outTokens: number,
    usd: number,
  ): void {
    this.db
      .query(
        `INSERT INTO cost_events (session_id,provider,model,in_tokens,out_tokens,usd,created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(sessionId, provider, model, inTokens, outTokens, usd, Date.now());
  }

  getBudgetConfig(): BudgetConfig | null {
    const row = this.db.query<{ monthly_cap: number; daily_cap: number | null; warnings_enabled: number; auto_fallback: number }, []>(
      `SELECT * FROM budget_config WHERE id = 1`,
    ).get();
    if (!row) return null;
    return {
      monthly_cap: row.monthly_cap,
      daily_cap: row.daily_cap,
      warnings_enabled: Boolean(row.warnings_enabled),
      auto_fallback: Boolean(row.auto_fallback),
    };
  }

  setBudgetConfig(config: Partial<BudgetConfig> & { monthly_cap?: number }): void {
    const current = this.getBudgetConfig();
    if (!current) {
      this.db.query(
        `INSERT INTO budget_config (id, monthly_cap, daily_cap, warnings_enabled, auto_fallback, created_at) VALUES (1, ?, ?, ?, ?, ?)`,
      ).run(
        config.monthly_cap ?? 0,
        config.daily_cap ?? null,
        config.warnings_enabled ?? 1,
        config.auto_fallback ?? 1,
        Date.now()
      );
    } else {
      this.db.query(
        `UPDATE budget_config SET monthly_cap=?, daily_cap=?, warnings_enabled=?, auto_fallback=?, created_at=? WHERE id=1`,
      ).run(
        config.monthly_cap ?? current.monthly_cap,
        config.daily_cap ?? current.daily_cap,
        config.warnings_enabled !== undefined ? (config.warnings_enabled ? 1 : 0) : current.warnings_enabled ? 1 : 0,
        config.auto_fallback !== undefined ? (config.auto_fallback ? 1 : 0) : current.auto_fallback ? 1 : 0,
        Date.now()
      );
    }
  }

  getSpendForPeriod(startMs: number): number {
    const row = this.db.query<{ total: number }, [number]>(
      `SELECT COALESCE(SUM(usd), 0) total FROM cost_events WHERE created_at >= ?`,
    ).get(startMs);
    return row?.total ?? 0;
  }

  costSummary(): {
    totalUsd: number;
    totalTokens: number;
    byModel: Array<{ model: string; usd: number; tokens: number }>;
    recent: Array<{ usd: number; tokens: number; at: number }>;
  } {
    const tot = this.db
      .query<{ usd: number; intok: number; outtok: number }, []>(
        `SELECT COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens),0) intok, COALESCE(SUM(out_tokens),0) outtok FROM cost_events`,
      )
      .get();
    const byModel = this.db
      .query<{ model: string; usd: number; tokens: number }, []>(
        `SELECT model, COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens+out_tokens),0) tokens FROM cost_events GROUP BY model ORDER BY usd DESC`,
      )
      .all();
    const recent = this.db
      .query<{ usd: number; tokens: number; at: number }, []>(
        `SELECT usd, (in_tokens+out_tokens) tokens, created_at at FROM cost_events ORDER BY id DESC LIMIT 30`,
      )
      .all();
    return {
      totalUsd: tot?.usd ?? 0,
      totalTokens: (tot?.intok ?? 0) + (tot?.outtok ?? 0),
      byModel,
      recent,
    };
  }

  clearCosts(): void {
    this.db.query(`DELETE FROM cost_events`).run();
  }
}
