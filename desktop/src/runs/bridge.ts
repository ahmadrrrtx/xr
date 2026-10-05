/*
 * Runs bridge (Phase 11, brief §7) — wires the canonical runsStore to its
 * sources. Called once from the main-window AppShell.
 *
 *   1. brainStore → runsStore: every change to a `Run` (token tick, span
 *      end, approval wait, completion, kill) is projected to its summary.
 *      Same-process, synchronous, honest numbers — no event bus latency.
 *   2. Tauri `brain:run-update` (other windows' streams) and `run:cancelled`
 *      (Rust re-broadcast of a cancel) → runsStore / brainStore.
 *   3. One shared ticker: 500 ms while the Control Room is on screen,
 *      2 s off-screen while anything is in flight, idle otherwise.
 */
import type { BrainUpdate } from '@/brain/events';
import { isTauri } from '@/lib/tauri';
import { registerSummaryLookup } from '@/runs/registry';
import { useBrainStore } from '@/stores/brainStore';
import { useRunsStore } from '@/stores/runsStore';

let initialised = false;
let screenActive = false;
let timer: number | null = null;
let timerMs = 0;

function syncTicker(): void {
  const inFlight = useRunsStore.getState().inProgressCount > 0;
  const want = screenActive ? 500 : inFlight ? 2000 : 0;
  if (want === timerMs) return;
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  timerMs = want;
  if (want > 0) {
    timer = window.setInterval(() => useRunsStore.getState().tick(), want);
    useRunsStore.getState().tick();
  }
}

/** The Control Room tells the bridge when it mounts/unmounts. */
export function setRunsScreenActive(active: boolean): void {
  screenActive = active;
  syncTicker();
}

export function initRunsBridge(): void {
  if (initialised) return;
  initialised = true;

  registerSummaryLookup((id) => useRunsStore.getState().runs[id]);

  // 1. Initial sync + subscription (brainStore persists its recent runs).
  const project = (): void => {
    const runs = useBrainStore.getState().runs;
    for (const run of Object.values(runs))
      useRunsStore.getState().upsertFromBrain(run);
  };
  project();
  useBrainStore.subscribe((st, prev) => {
    if (st.runs === prev.runs) return;
    const rs = useRunsStore.getState();
    for (const id of Object.keys(st.runs)) {
      if (st.runs[id] !== prev.runs[id]) rs.upsertFromBrain(st.runs[id]);
    }
  });

  // 2. Cross-window events (shell only).
  if (isTauri()) {
    void import('@tauri-apps/api/event')
      .then(({ listen }) => {
        void listen<BrainUpdate>('brain:run-update', (e) => {
          useRunsStore.getState().applyBrainUpdate(e.payload);
        });
        void listen<{ ids: string[]; reason?: string | null }>(
          'run:cancelled',
          (e) => {
            const ids = e.payload?.ids ?? [];
            const brain = useBrainStore.getState();
            for (const id of ids) {
              const r = brain.runs[id];
              if (r && (r.status === 'running' || r.status === 'waiting')) {
                brain.stopRun(id, { silent: true });
              }
            }
            useRunsStore.getState().applyCancelled(ids);
          }
        );
      })
      .catch(() => {
        useRunsStore.setState({
          error:
            'Could not connect to XR run monitor. Restart XR or check logs.',
        });
      });
  }

  // 3. Ticker follows the in-flight count.
  useRunsStore.subscribe((st, prev) => {
    if (st.inProgressCount !== prev.inProgressCount) syncTicker();
  });
  syncTicker();
}
