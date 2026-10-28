/**
 * Phase 1 (V1 matrix D-04/D-05) — Workspaces screen core, store-level, under
 * bun with the DOM shim (same convention as frontend-stores.test.ts):
 *   · pure palette logic: filter (all/pinned/recent/git + search),
 *     order (pinned first, then recency, then name), filter counts,
 *     optimistic patches (withPatch);
 *   · multi-select state machine: enter/toggle/range-select-all/exit,
 *     focus tracking;
 *   · the WorkspaceLanding run-attachment contract (extracted pure helper
 *     `landingRuns`): by workspaceId OR by name for seeded history,
 *     non-archived, newest first, capped at five.
 */
import { storage, setTauri } from "./helpers/dom-shim.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  filterCounts,
  filterWorkspaces,
  orderWorkspaces,
  useWorkspaceStore,
  withPatch,
  type WorkspaceFilter,
} from "../../desktop/src/stores/workspaceStore.ts";
import { landingRuns } from "../../desktop/src/screens/WorkspaceLanding.tsx";
import type { Workspace } from "../../desktop/src/workspaces/types.ts";

const NOW = 1_700_000_000_000;

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "alpha",
    slug: "alpha",
    path: "/tmp/alpha",
    kind: "local",
    icon: null,
    stack: ["bun"],
    pinned: false,
    lastOpenedAt: NOW - 1000,
    createdAt: NOW - 9999,
    updatedAt: NOW - 9999,
    windowBounds: null,
    pathExists: true,
    ...over,
  };
}

const set = [
  ws({ id: "a", name: "alpha", path: "/tmp/alpha", pinned: true, lastOpenedAt: NOW - 10, stack: ["bun"] }),
  ws({ id: "b", name: "beta", path: "/tmp/beta", lastOpenedAt: NOW - 20, stack: ["node"] }),
  ws({ id: "c", name: "gamma", path: "/src/gamma", kind: "git", lastOpenedAt: null, stack: [] }),
  ws({ id: "d", name: "delta", path: "/src/delta", lastOpenedAt: NOW - 8 * 24 * 60 * 60 * 1000, stack: ["python"] }), // 8 days old
];

const initial = useWorkspaceStore.getState();
beforeEach(() => {
  storage.clear();
  setTauri(false);
  useWorkspaceStore.setState({ ...initial }, true);
});

describe("workspaces pure core — filter/order/counts/patch", () => {
  test("all/pinned/git filters + recent 7-day window", () => {
    expect(filterWorkspaces(set, "all", "", NOW).map((w) => w.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterWorkspaces(set, "pinned", "", NOW).map((w) => w.id)).toEqual(["a"]);
    expect(filterWorkspaces(set, "git", "", NOW).map((w) => w.id)).toEqual(["c"]);
    // recent: within 7 days AND lastOpenedAt !== null — delta (8d) and gamma (never) drop.
    expect(filterWorkspaces(set, "recent", "", NOW).map((w) => w.id)).toEqual(["a", "b"]);
  });

  test("search matches name, path and stack (case-insensitive)", () => {
    expect(filterWorkspaces(set, "all", "GAMMA", NOW).map((w) => w.id)).toEqual(["c"]);
    expect(filterWorkspaces(set, "all", "/tmp/alpha", NOW).map((w) => w.id)).toEqual(["a"]);
    expect(filterWorkspaces(set, "all", "bun", NOW).map((w) => w.id)).toEqual(["a"]);
    expect(filterWorkspaces(set, "all", "nope", NOW)).toEqual([]);
  });

  test("order: pinned first, then most recent, then name", () => {
    const unordered = [set[3], set[2], set[1], set[0]];
    // never-opened (lastOpenedAt null → 0) sorts LAST, below the 8-day-old row
    expect(orderWorkspaces(unordered).map((w) => w.id)).toEqual(["a", "b", "d", "c"]);
    // tie on pinned+recency → alphabetical name
    const tie = [ws({ id: "z", name: "zeta", pinned: true, lastOpenedAt: 5 }), ws({ id: "y", name: "yara", pinned: true, lastOpenedAt: 5 })];
    expect(orderWorkspaces(tie).map((w) => w.id)).toEqual(["y", "z"]);
  });

  test("filterCounts matches the filters it feeds", () => {
    expect(filterCounts(set, NOW)).toEqual({ all: 4, pinned: 1, recent: 2, git: 1 });
  });

  test("withPatch applies optimistically to exactly one row", () => {
    const next = withPatch(set, "b", { pinned: true });
    expect(next.find((w) => w.id === "b")?.pinned).toBe(true);
    expect(next.find((w) => w.id === "a")?.pinned).toBe(true); // untouched
    expect(withPatch(set, "missing", { pinned: true })).toEqual(set);
  });
});

describe("workspaces store — multi-select state machine", () => {
  test("enter without id starts empty; toggle accumulates; selectAll replaces", () => {
    const st = useWorkspaceStore.getState();
    st.enterMultiSelect();
    expect(useWorkspaceStore.getState().multiSelect).toBe(true);
    expect(useWorkspaceStore.getState().selectedIds).toEqual([]);

    st.toggleSelected("a");
    st.toggleSelected("b");
    expect(useWorkspaceStore.getState().selectedIds).toEqual(["a", "b"]);
    st.toggleSelected("a"); // off again
    expect(useWorkspaceStore.getState().selectedIds).toEqual(["b"]);

    st.selectAll(["c", "d"]);
    expect(useWorkspaceStore.getState().selectedIds).toEqual(["c", "d"]);

    st.focusId("c");
    expect(useWorkspaceStore.getState().focusedId).toBe("c");
  });

  test("exit clears selection and focus", () => {
    const st = useWorkspaceStore.getState();
    st.enterMultiSelect("a");
    st.focusId("a");
    st.exitMultiSelect();
    const after = useWorkspaceStore.getState();
    expect(after.multiSelect).toBe(false);
    expect(after.selectedIds).toEqual([]);
  });

  test("filter/search setters drive the palette", () => {
    const st = useWorkspaceStore.getState();
    st.setFilter("git");
    st.setSearch("gam");
    st.setViewMode("list");
    const after = useWorkspaceStore.getState();
    expect(after.filter satisfies WorkspaceFilter).toBe("git");
    expect(after.search).toBe("gam");
    expect(after.viewMode).toBe("list");
  });
});

describe("WorkspaceLanding — run attachment contract (landingRuns)", () => {
  const base = { id: "r0", archived: false, startedAt: 100, workspaceId: "w1", workspace: "Alpha" };
  const runs: Record<string, Parameters<typeof landingRuns>[0][string]> = {
    byId: { ...base, startedAt: 50 },
    byName: { ...base, id: "r1", startedAt: 40, workspaceId: "other-ws", workspace: "Alpha" }, // seeded history
    other: { ...base, id: "r2", startedAt: 30, workspaceId: "other-ws", workspace: "Elsewhere" },
    archived: { ...base, id: "r3", startedAt: 60, workspaceId: "w1", archived: true },
    old1: { ...base, id: "r4", startedAt: 20 },
    old2: { ...base, id: "r5", startedAt: 10 },
    old3: { ...base, id: "r6", startedAt: 5 },
    old4: { ...base, id: "r7", startedAt: 2 },
    old5: { ...base, id: "r8", startedAt: 1 },
  };

  test("matches by id or lowercase name; skips archived; newest first; capped at 5", () => {
    const ws1 = ws({ id: "w1", name: "Alpha" });
    const out = landingRuns(runs, ws1);
    // byId(50) + byName(40) + old1..old3 (20,10,5) — archived(60) excluded, old4(2)+old5(1) over the cap
    expect(out.map((r) => r.id)).toEqual(["r0", "r1", "r4", "r5", "r6"]);
    expect(out.length).toBe(5);
  });

  test("no matching runs → empty (no fabricated history)", () => {
    expect(landingRuns(runs, ws({ id: "nope", name: "nothing" }))).toEqual([]);
  });
});
