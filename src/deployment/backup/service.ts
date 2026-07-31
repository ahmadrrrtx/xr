/**
 * XR 6.0 — Backup and Disaster Recovery Service (Phase 1 · T13)
 *
 * REAL durability, never simulated:
 *   - With a `store` attached, `createBackup()` takes a crash-consistent
 *     single-file snapshot (`VACUUM INTO` under the write gate), records real
 *     per-component row counts, real byte sizes, and a real SHA-256 of the
 *     snapshot file, and persists the manifest next to the snapshot so
 *     backups survive process restarts.
 *   - `restore()` first snapshots the current state (pre-restore safety),
 *     replaces the database from the backup, reopens the store, and verifies
 *     the audit chain (an intact chain is the restore acceptance check).
 *   - Store-less mode (used by tooling/tests only) records metadata only —
 *     it is NOT a durability guarantee and is labelled as such.
 *
 * Per Constitution Commandment 2 ("no simulated durability"), the real
 * backup/restore path is the one that ships; metadata-only mode is explicit
 * about being metadata-only.
 */

import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DeploymentProfileKind,
  RetentionPolicy,
} from "../types.ts";
import type { WorkspaceStore } from "../../state/workspace-store.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface BackupManifest {
  readonly backupId: string;
  readonly createdAt: number;
  readonly profile: DeploymentProfileKind;
  readonly version: string;
  readonly components: readonly BackupComponent[];
  readonly totalSizeBytes: number;
  readonly integrityHash: string;
  readonly encrypted: boolean;
  /** Phase 1: true when a real snapshot file exists for this backup. */
  readonly snapshot?: boolean;
  readonly metadata: Record<string, string>;
}

export interface BackupComponent {
  readonly kind: BackupComponentKind;
  readonly recordCount: number;
  readonly sizeBytes: number;
  readonly earliestRecord: number;
  readonly latestRecord: number;
}

export type BackupComponentKind =
  | "execution_records"
  | "workflow_states"
  | "checkpoints"
  | "audit_records"
  | "artifacts_metadata"
  | "workspace_config"
  | "memory_records"
  | "user_preferences"
  | "policy_records";

export interface BackupResult {
  readonly ok: boolean;
  readonly backupId?: string;
  readonly manifest?: BackupManifest;
  readonly error?: string;
  readonly durationMs: number;
}

export interface RestoreResult {
  readonly ok: boolean;
  readonly recordsRestored: number;
  readonly componentsRestored: readonly BackupComponentKind[];
  readonly chainValid?: boolean;
  readonly error?: string;
  readonly durationMs: number;
  readonly warnings: readonly string[];
}

export interface ExportResult {
  readonly ok: boolean;
  readonly exportPath?: string;
  readonly recordCount: number;
  readonly error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Backup Service
// ═══════════════════════════════════════════════════════════════════════════

export interface BackupServiceDeps {
  /** Where to store backups (snapshots + manifests). */
  backupRoot: string;
  /** Current deployment profile. */
  profile: DeploymentProfileKind;
  /** The live workspace store. When present, backups are REAL snapshots. */
  store?: WorkspaceStore;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
  /** Retention policy (defaults applied in cleanupOldBackups). */
  retention?: RetentionPolicy;
}

/** Component kind → backing SQLite table (0 rows when absent). */
const COMPONENT_TABLES: Record<BackupComponentKind, string | null> = {
  execution_records: "execution_records",
  workflow_states: "agent_workflows",
  checkpoints: "execution_checkpoints",
  audit_records: "audit_log",
  artifacts_metadata: null,
  workspace_config: null,
  memory_records: "user_memory",
  user_preferences: "session_summaries",
  policy_records: null,
};

function countRows(store: WorkspaceStore, table: string | null): number {
  if (!table) return 0;
  try {
    const row = store.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number } | null;
    return row?.c ?? 0;
  } catch {
    return 0; // table not present in this schema version
  }
}

export class BackupService {
  private readonly deps: BackupServiceDeps;
  private readonly backups = new Map<string, BackupManifest>();

  constructor(deps: BackupServiceDeps) {
    this.deps = deps;
    // Rehydrate manifests persisted by earlier processes (real mode only).
    if (existsSync(deps.backupRoot)) {
      for (const f of readdirSync(deps.backupRoot)) {
        if (!f.endsWith(".manifest.json")) continue;
        try {
          const m = JSON.parse(readFileSync(join(deps.backupRoot, f), "utf8")) as BackupManifest;
          this.backups.set(m.backupId, m);
        } catch {
          /* corrupt manifest — ignore */
        }
      }
    }
  }

  private manifestPath(backupId: string): string {
    return join(this.deps.backupRoot, `${backupId}.manifest.json`);
  }

  private snapshotPath(backupId: string): string {
    return join(this.deps.backupRoot, `${backupId}.db`);
  }

  private persistManifest(m: BackupManifest): void {
    if (!this.deps.store) return; // metadata-only mode keeps an in-memory registry
    mkdirSync(this.deps.backupRoot, { recursive: true });
    writeFileSync(this.manifestPath(m.backupId), JSON.stringify(m, null, 2), "utf8");
  }

  // ── Create Backup ────────────────────────────────────────────────────

  /**
   * Create a local backup. With a store attached this is a REAL
   * crash-consistent snapshot (VACUUM INTO) + real manifest + SHA-256.
   */
  async createBackup(options: {
    components?: BackupComponentKind[];
    encrypted?: boolean;
    label?: string;
  } = {}): Promise<BackupResult> {
    const startTime = Date.now();
    const backupId = `backup_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    const requestedComponents = options.components ?? [
      "execution_records",
      "workflow_states",
      "checkpoints",
      "audit_records",
      "artifacts_metadata",
      "workspace_config",
      "memory_records",
      "user_preferences",
      "policy_records",
    ];

    let snapshot = false;
    let totalSizeBytes = 0;
    let integrityHash = "";
    let components: BackupComponent[] = [];

    if (this.deps.store) {
      mkdirSync(this.deps.backupRoot, { recursive: true });
      const dest = this.snapshotPath(backupId);
      const snap = this.deps.store.createBackup(dest);
      if (!snap.ok) {
        return { ok: false, error: `snapshot failed`, durationMs: Date.now() - startTime };
      }
      snapshot = true;
      totalSizeBytes = snap.size;
      integrityHash = `sha256:${snap.sha256}`;

      components = requestedComponents.map((kind) => {
        const table = COMPONENT_TABLES[kind];
        let recordCount = 0;
        let earliest = 0;
        let latest = 0;
        if (table && this.deps.store) {
          recordCount = countRows(this.deps.store, table);
          try {
            const e = this.deps.store
              .prepare(`SELECT MIN(created_at) m, MAX(created_at) x FROM ${table}`)
              .get() as { m: number | null; x: number | null } | null;
            earliest = e?.m ?? 0;
            latest = e?.x ?? 0;
          } catch {
            /* ignore */
          }
        }
        return { kind, recordCount, sizeBytes: 0, earliestRecord: earliest, latestRecord: latest };
      });
    } else {
      components = requestedComponents.map((kind) => ({
        kind,
        recordCount: 0,
        sizeBytes: 0,
        earliestRecord: startTime,
        latestRecord: startTime,
      }));
    }

    const manifest: BackupManifest = {
      backupId,
      createdAt: startTime,
      profile: this.deps.profile,
      version: "xr-7.0.1",
      components,
      totalSizeBytes,
      integrityHash,
      encrypted: options.encrypted ?? false,
      snapshot,
      metadata: {
        label: options.label ?? "",
        created_by: "backup_service",
        mode: this.deps.store ? "snapshot" : "metadata-only",
      },
    };

    this.backups.set(backupId, manifest);
    this.persistManifest(manifest);

    this.deps.audit?.("backup.created", {
      backupId,
      profile: this.deps.profile,
      components: components.length,
      encrypted: manifest.encrypted,
      snapshot,
      integrityHash,
    });

    return {
      ok: true,
      backupId,
      manifest,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Restore ──────────────────────────────────────────────────────────

  /**
   * Restore from a backup. Preserves current state as a pre-restore backup.
   * With a store attached this performs a REAL file restore and verifies the
   * audit chain as the acceptance check. Never silently loses state.
   */
  async restore(backupId: string): Promise<RestoreResult> {
    const startTime = Date.now();
    const manifest = this.backups.get(backupId);

    if (!manifest) {
      return {
        ok: false,
        recordsRestored: 0,
        componentsRestored: [],
        error: `Backup ${backupId} not found`,
        durationMs: Date.now() - startTime,
        warnings: [],
      };
    }

    // Create a pre-restore backup for safety (real snapshot when possible).
    const preRestore = await this.createBackup({
      label: `pre-restore-${backupId}`,
    });
    if (!preRestore.ok) {
      return {
        ok: false,
        recordsRestored: 0,
        componentsRestored: [],
        error: "Failed to create pre-restore backup",
        durationMs: Date.now() - startTime,
        warnings: [],
      };
    }

    const warnings: string[] = [];
    if (manifest.profile !== this.deps.profile) {
      warnings.push(
        `Backup profile (${manifest.profile}) differs from current (${this.deps.profile})`,
      );
    }

    // Real restore path.
    if (this.deps.store) {
      const snap = this.snapshotPath(backupId);
      if (!manifest.snapshot || !existsSync(snap)) {
        return {
          ok: false,
          recordsRestored: 0,
          componentsRestored: [],
          error: `Backup ${backupId} has no snapshot file`,
          durationMs: Date.now() - startTime,
          warnings,
        };
      }
      const restored = this.deps.store.restoreFrom(snap);
      this.deps.audit?.("backup.restored", {
        backupId,
        preRestoreBackupId: preRestore.backupId,
        components: manifest.components.length,
        chainValid: restored.chainValid,
        warnings: warnings.length,
      });
      return {
        ok: restored.ok,
        recordsRestored: manifest.components.reduce((sum, c) => sum + c.recordCount, 0),
        componentsRestored: manifest.components.map((c) => c.kind),
        chainValid: restored.chainValid,
        durationMs: Date.now() - startTime,
        warnings,
      };
    }

    // Metadata-only mode (tooling): nothing to restore.
    this.deps.audit?.("backup.restored", {
      backupId,
      preRestoreBackupId: preRestore.backupId,
      components: manifest.components.length,
      warnings: warnings.length,
    });
    return {
      ok: true,
      recordsRestored: 0,
      componentsRestored: manifest.components.map((c) => c.kind),
      durationMs: Date.now() - startTime,
      warnings,
    };
  }

  // ── Export ────────────────────────────────────────────────────────────

  /**
   * Export workspace data for migration or external use. Real JSON export of
   * the audit chain, execution records, and durable memory.
   */
  async exportData(options: {
    components?: BackupComponentKind[];
    format?: "json" | "tar.gz";
    outputPath?: string;
  } = {}): Promise<ExportResult> {
    const outputPath =
      options.outputPath ?? `${this.deps.backupRoot}/export-${Date.now()}.json`;
    if (!this.deps.store) {
      writeFileSync(outputPath, JSON.stringify({ exported: false, reason: "no store attached" }, null, 2), "utf8");
      return { ok: true, exportPath: outputPath, recordCount: 0 };
    }
    const store = this.deps.store;
    const data: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      auditChainValid: store.verifyChain().valid,
      audit: store.auditChainRange({ limit: 100_000 }),
      executions: store
        .prepare("SELECT run_id, state, outcome_kind, created_at, record_json FROM execution_records ORDER BY created_at DESC LIMIT 100000")
        .all() as unknown[],
      memory: store
        .prepare("SELECT id, category, content, scope, source, created_at, updated_at FROM user_memory ORDER BY updated_at DESC LIMIT 100000")
        .all() as unknown[],
    };
    writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
    const count =
      (data.audit as unknown[]).length +
      (data.executions as unknown[]).length +
      (data.memory as unknown[]).length;
    return { ok: true, exportPath: outputPath, recordCount: count };
  }

  // ── Backup Management ────────────────────────────────────────────────

  listBackups(): BackupManifest[] {
    return Array.from(this.backups.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getBackup(backupId: string): BackupManifest | undefined {
    return this.backups.get(backupId);
  }

  deleteBackup(backupId: string): boolean {
    const manifest = this.backups.get(backupId);
    if (!manifest) return false;

    this.backups.delete(backupId);
    for (const f of [this.manifestPath(backupId), this.snapshotPath(backupId)]) {
      try {
        rmSync(f, { force: true });
      } catch {
        /* best-effort */
      }
    }
    this.deps.audit?.("backup.deleted", { backupId });
    return true;
  }

  /**
   * Clean up old backups according to retention policy (deletes files too).
   */
  cleanupOldBackups(retainCount: number = 5): number {
    const sorted = this.listBackups();
    if (sorted.length <= retainCount) return 0;

    const toDelete = sorted.slice(retainCount);
    for (const backup of toDelete) {
      this.deleteBackup(backup.backupId);
    }

    this.deps.audit?.("backup.cleanup", { deleted: toDelete.length });
    return toDelete.length;
  }

  /** SHA-256 of a backup's snapshot file (operator verification). */
  verifyBackup(backupId: string): { ok: boolean; sha256: string; size: number } {
    const m = this.backups.get(backupId);
    const snap = this.snapshotPath(backupId);
    if (!m || !existsSync(snap)) return { ok: false, sha256: "", size: 0 };
    const buf = readFileSync(snap);
    const sha256 = `sha256:${createHash("sha256").update(buf).digest("hex")}`;
    return { ok: sha256 === m.integrityHash, sha256, size: buf.length };
  }
}
