/**
 * XR — Skill Store
 * Manages the repository of learned and preloaded skills.
 */

import { BaseStore } from "../store.ts";

export interface Skill {
  id: string;
  version: number;
  source: "preloaded" | "learned";
  why: string | null;
  active: number;
  created_at: number;
}

export interface Baseline {
  id: string;
  skill_id: string;
  skill_version: number;
  steps_json: string;
  verifier_json: string;
  frozen_at: number;
}

export class SkillStore extends BaseStore {
  constructor() {
    super();
    this.migrate();
  }

  private migrate(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT NOT NULL,
        why TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE TABLE IF NOT EXISTS frozen_baselines (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        skill_version INTEGER NOT NULL,
        steps_json TEXT NOT NULL,
        verifier_json TEXT NOT NULL,
        frozen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS regression_cases (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        baseline_id TEXT NOT NULL,
        verifier_json TEXT NOT NULL,
        last_status TEXT,
        last_run_at INTEGER
      );
    `);
  }

  latestSkillVersion(skillId: string): number {
    return (
      this.db
        .query<{ v: number }, [string]>(
          `SELECT COALESCE(MAX(version),0) v FROM skills WHERE id=?`,
        )
        .get(skillId)?.v ?? 0
    );
  }

  insertSkill(
    id: string,
    version: number,
    source: "preloaded" | "learned",
    why: string | null,
  ): void {
    this.db
      .query(
        `INSERT INTO skills (id,version,source,why,active,created_at) VALUES (?,?,?,?,1,?)`,
      )
      .run(id, version, source, why, Date.now());
  }

  setActiveSkillVersion(id: string, version: number): void {
    this.db.query(`UPDATE skills SET active=0 WHERE id=?`).run(id);
    this.db.query(`UPDATE skills SET active=1 WHERE id=? AND version=?`).run(id, version);
  }

  freezeBaseline(
    baselineId: string,
    skillId: string,
    skillVersion: number,
    stepsJson: string,
    verifierJson: string,
  ): void {
    this.db
      .query(
        `INSERT INTO frozen_baselines (id,skill_id,skill_version,steps_json,verifier_json,frozen_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(baselineId, skillId, skillVersion, stepsJson, verifierJson, Date.now());
  }

  addRegressionCase(
    id: string,
    skillId: string,
    baselineId: string,
    verifierJson: string,
  ): void {
    this.db
      .query(
        `INSERT INTO regression_cases (id,skill_id,baseline_id,verifier_json) VALUES (?,?,?,?)`,
      )
      .run(id, skillId, baselineId, verifierJson);
  }

  regressionCasesFor(
    skillId: string,
  ): Array<{ id: string; baseline_id: string; verifier_json: string }> {
    return this.db
      .query<{ id: string; baseline_id: string; verifier_json: string }, [string]>(
        `SELECT id,baseline_id,verifier_json FROM regression_cases WHERE skill_id=?`,
      )
      .all(skillId);
  }

  markRegression(id: string, status: "pass" | "fail"): void {
    this.db
      .query(`UPDATE regression_cases SET last_status=?, last_run_at=? WHERE id=?`)
      .run(status, Date.now(), id);
  }

  frozenBaseline(id: string): { steps_json: string; verifier_json: string } | null {
    return (
      this.db
        .query<{ steps_json: string; verifier_json: string }, [string]>(
          `SELECT steps_json,verifier_json FROM frozen_baselines WHERE id=?`,
        )
        .get(id) ?? null
    );
  }

  count(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM skills`)
        .get()?.c ?? 0
    );
  }

  frozenCount(): number {
    return (
      this.db
        .query<{ c: number }, []>(`SELECT COUNT(*) c FROM frozen_baselines`)
        .get()?.c ?? 0
    );
  }
}
