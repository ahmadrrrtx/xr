/**
 * XR Phase 9 — trigger table access on the unified workspace store.
 *
 * Fire history lives in the audit chain (no separate fires table). Spend is
 * denormalised onto the row so `xr triggers list` can show budget use without
 * scanning the whole cost log.
 */
import { randomUUID } from "node:crypto";
import type { WorkspaceStore } from "../workspace-store.ts";
import type { Trigger, TriggerInput } from "../../automation/trigger-spec.ts";

function rowToTrigger(r: Record<string, unknown>): Trigger {
  const spec = JSON.parse(String(r.spec ?? "{}"));
  const budget = JSON.parse(String(r.budget ?? "{}"));
  const quiet = r.quiet_hours ? JSON.parse(String(r.quiet_hours)) : undefined;
  return {
    id: String(r.id),
    kind: r.kind as Trigger["kind"],
    spec,
    taskTemplate: String(r.task_template),
    budget,
    approvalMode: (r.approval_mode as Trigger["approvalMode"]) ?? "inherit",
    quietHours: quiet,
    enabled: Number(r.enabled) === 1,
    consentRef: String(r.consent_ref),
    createdAt: Number(r.created_at),
    lastFiredAt: r.last_fired_at == null ? undefined : Number(r.last_fired_at),
    lastEnvelopeId: r.last_envelope_id == null ? undefined : String(r.last_envelope_id),
    spentUsd: Number(r.spent_usd ?? 0),
    spentTokens: Number(r.spent_tokens ?? 0),
  };
}

export class TriggerRepo {
  constructor(private readonly store: WorkspaceStore) {}

  private ready(): boolean {
    try {
      const row = this.store
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='triggers'`)
        .get();
      return Boolean(row);
    } catch {
      return false;
    }
  }

  insert(input: TriggerInput & { createdAt?: number }): Trigger {
    const id = input.id ?? `tr_${randomUUID().slice(0, 12)}`;
    const createdAt = input.createdAt ?? Date.now();
    const trigger: Trigger = {
      ...input,
      id,
      approvalMode: input.approvalMode ?? "inherit",
      enabled: input.enabled ?? true,
      createdAt,
      spentUsd: 0,
      spentTokens: 0,
    };
    this.store.write(() => {
      this.store
        .prepare(
          `INSERT INTO triggers
            (id, kind, spec, task_template, budget, approval_mode, quiet_hours,
             enabled, consent_ref, created_at, spent_usd, spent_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        )
        .run(
          trigger.id,
          trigger.kind,
          JSON.stringify(trigger.spec),
          trigger.taskTemplate,
          JSON.stringify(trigger.budget),
          trigger.approvalMode,
          trigger.quietHours ? JSON.stringify(trigger.quietHours) : null,
          trigger.enabled ? 1 : 0,
          trigger.consentRef,
          trigger.createdAt,
        );
    });
    return trigger;
  }

  get(id: string): Trigger | null {
    if (!this.ready()) return null;
    const row = this.store.prepare(`SELECT * FROM triggers WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToTrigger(row) : null;
  }

  list(): Trigger[] {
    if (!this.ready()) return [];
    const rows = this.store.prepare(`SELECT * FROM triggers ORDER BY created_at ASC`).all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToTrigger);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.ready()) return false;
    return this.store.write(() => {
      const r = this.store.prepare(`UPDATE triggers SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
      return Number((r as { changes?: number }).changes ?? 0) > 0;
    });
  }

  recordFire(
    id: string,
    fire: { at: number; envelopeId: string; spentUsd?: number; spentTokens?: number },
  ): void {
    if (!this.ready()) return;
    this.store.write(() => {
      this.store
        .prepare(
          `UPDATE triggers
             SET last_fired_at = ?, last_envelope_id = ?,
                 spent_usd = spent_usd + ?, spent_tokens = spent_tokens + ?
           WHERE id = ?`,
        )
        .run(fire.at, fire.envelopeId, fire.spentUsd ?? 0, fire.spentTokens ?? 0, id);
    });
  }

  delete(id: string): boolean {
    if (!this.ready()) return false;
    return this.store.write(() => {
      const r = this.store.prepare(`DELETE FROM triggers WHERE id = ?`).run(id);
      return Number((r as { changes?: number }).changes ?? 0) > 0;
    });
  }
}
