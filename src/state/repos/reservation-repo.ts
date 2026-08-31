/**
 * XR Phase 2 · F-12 — ReservationRepo.
 *
 * The persistence half of the Governor v1 admission primitive. `admit()`
 * performs check-and-reserve inside ONE serialized `BEGIN IMMEDIATE`
 * transaction (the WorkspaceStore write gate), so the race between two
 * processes reading the spend and both passing the cap is impossible by
 * construction: the single SQLite writer serializes admissions and each
 * admission sees every earlier writer's reservation.
 *
 * Lifecycle of a reservation:
 *   admit()      → row(status='active')  — counts against the caps
 *   commit()     → row(status='settled') — settled with ACTUAL usage
 *   release()    → row(status='released')— cancelled/denied, no usage
 *   TTL sweep    → row(status='expired') — uncommitted past the TTL
 *                (runs at store open = startup recovery, and at the head
 *                 of every admit = in-flight recovery)
 */

import type { WorkspaceStore } from "../workspace-store.ts";

export interface ReservationCaps {
  monthlyCapUsd: number | null;
  dailyCapUsd: number | null;
  taskUsdCap: number | null;
  taskTokenCap: number | null;
}

export type AdmissionResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: string; suggestLocal: boolean };

/**
 * The interface CostGovernor consumes. Kept as an interface (not the concrete
 * class) so the governor stays usable in store-less contexts — the admission
 * layer is optional, the per-task in-memory ceilings never are.
 */
export interface ReservationStoreLike {
  admit(envId: string, estUsd: number, estTokens: number, caps: ReservationCaps): AdmissionResult;
  commit(reservationId: string, actualUsd: number, actualTokens: number): void;
  release(reservationId: string): void;
  releaseForEnv(envId: string): void;
  activeTotals(): { usd: number; tokens: number };
}

export class ReservationRepo implements ReservationStoreLike {
  constructor(public readonly store: WorkspaceStore) {}

  admit(envId: string, estUsd: number, estTokens: number, caps: ReservationCaps): AdmissionResult {
    return this.store.reservationAdmit(envId, estUsd, estTokens, {
      monthlyCapUsd: caps.monthlyCapUsd,
      dailyCapUsd: caps.dailyCapUsd,
      taskUsdCap: caps.taskUsdCap,
      taskTokenCap: caps.taskTokenCap,
    });
  }

  commit(reservationId: string, actualUsd: number, actualTokens: number): void {
    this.store.reservationCommit(reservationId, actualUsd, actualTokens);
  }

  release(reservationId: string): void {
    this.store.reservationRelease(reservationId);
  }

  releaseForEnv(envId: string): void {
    this.store.reservationReleaseForEnv(envId);
  }

  activeTotals(): { usd: number; tokens: number } {
    return this.store.reservationActiveTotals();
  }
}
