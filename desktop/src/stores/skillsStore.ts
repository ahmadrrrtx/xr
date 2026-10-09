/*
 * Skills Store (Phase 20) — Zustand.
 *
 *   listing   merged marketplace + installed + MCP + plugins (engine truth)
 *   install   one install dialog state machine (install / update / from-url),
 *             progress driven by the engine's SSE job stream
 *   detail    one slide-over at a time
 *
 * No local fallbacks: when the engine is down the screen says so (agentsStore
 * convention). Quarantine state is engine-side — this store can only ask the
 * engine to promote, never clear it locally.
 */
import { toast } from 'sonner';
import { create } from 'zustand';

import { EngineDown } from '@/engine/transport';
import {
  describeEngineError,
  fetchMarketplace,
  inspect as inspectSkill,
  installFromUrl as apiInstallFromUrl,
  listMcp,
  listPlugins,
  mutatePermissions,
  promote as apiPromote,
  saveSettings,
  setEnabled,
  startInstall,
  streamInstall,
  syncMarketplace,
  uninstall as apiUninstall,
  addMcp as apiAddMcp,
  mcpHealth as apiMcpHealth,
  mcpPin as apiMcpPin,
  mcpPinDiff as apiMcpPinDiff,
  mcpUnpin as apiMcpUnpin,
  removeMcp as apiRemoveMcp,
  setMcpEnabled as apiSetMcpEnabled,
  setPluginPermissions as apiSetPluginPermissions,
  setPluginEnabled as apiSetPluginEnabled,
  type AddMcpInput,
  type InspectResponse,
  type PluginRow,
} from '@/skills/api';
import type {
  CategoryId,
  DependencyReport,
  FromUrlPreview,
  InstallEvent,
  InstallResultSummary,
  McpPinDrift,
  McpServer,
  PermissionReport,
  SkillRecord,
  SkillUpdate,
} from '@/skills/core';
import { filterByCategory, matchesQuery, QUARANTINE_COPY } from '@/skills/core';
import { auditSkill } from '@/skills/audit';

export type InstallMode = 'install' | 'update' | 'from-url';
export type InstallStep = 'form' | 'progress' | 'success' | 'error';

export interface InstallDialogState {
  open: boolean;
  mode: InstallMode;
  skillId: string | null;
  /** from-url flow source. */
  source: { url?: string; localPath?: string } | null;
  preview: FromUrlPreview | null;
  quarantineOn: boolean;
  advancedOpen: boolean;
  grantSafe: boolean;
  grantDangerous: Set<string>;
  pinContract: boolean;
  step: InstallStep;
  events: InstallEvent[];
  pct: number;
  activeStep: InstallEvent['step'] | null;
  error: string | null;
  result: InstallResultSummary | null;
  busy: boolean;
}

export interface AddMcpDialogState {
  open: boolean;
  name: string;
  id: string;
  transport: McpServer['transport'];
  command: string;
  args: string[];
  url: string;
  enableOnSave: boolean;
  busy: boolean;
  error: string | null;
  lastHealth: string | null;
}

interface SkillsState {
  // listing
  records: SkillRecord[];
  mcpServers: McpServer[];
  plugins: PluginRow[];
  updates: SkillUpdate[];
  featuredId: string | null;
  featuredFromRegistry: boolean;
  loading: boolean;
  error: string | null;
  offline: boolean;
  catalogNote: string | null;
  query: string;
  category: CategoryId;
  // detail
  selectedId: string | null;
  inspect: InspectResponse | null;
  inspectLoading: boolean;
  // dialogs
  install: InstallDialogState;
  addMcp: AddMcpDialogState;
  quickInstallOpen: boolean;
  railCollapsed: boolean;
  // derived helpers
  visible: () => SkillRecord[];
  counts: () => Record<CategoryId, number>;

  // actions
  load: (opts?: { sync?: boolean }) => Promise<void>;
  setQuery: (q: string) => void;
  selectCategory: (c: CategoryId) => void;
  openDetail: (id: string | null) => void;
  closeDetail: () => void;
  openInstall: (id: string, mode?: InstallMode) => void;
  openInstallFromUrl: () => void;
  closeInstall: () => void;
  setInstallField: (patch: Partial<InstallDialogState>) => void;
  toggleGrant: (scope: string) => void;
  confirmInstall: () => Promise<void>;
  retryInstall: () => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;
  promote: (id: string) => Promise<void>;
  grantPermissions: (id: string, grant: string[], revoke: string[]) => Promise<void>;
  saveSkillSettings: (id: string, values: Record<string, unknown>) => Promise<void>;
  setRailCollapsed: (v: boolean) => void;
  setQuickInstallOpen: (v: boolean) => void;
  // from-url
  setInstallSource: (source: { url?: string; localPath?: string }) => void;
  // MCP
  openAddMcp: () => void;
  closeAddMcp: () => void;
  setMcpField: (patch: Partial<AddMcpDialogState>) => void;
  submitAddMcp: () => Promise<void>;
  toggleMcp: (id: string, enabled: boolean) => Promise<void>;
  removeMcp: (id: string) => Promise<void>;
  pinMcp: (id: string) => Promise<void>;
  unpinMcp: (id: string) => Promise<void>;
  diffMcp: (id: string) => Promise<McpPinDrift | null>;
  // plugins
  togglePlugin: (id: string, enabled: boolean) => Promise<void>;
  grantPluginPermission: (id: string, scope: string, granted: boolean) => Promise<void>;
}

const EMPTY_INSTALL: InstallDialogState = {
  open: false,
  mode: 'install',
  skillId: null,
  source: null,
  preview: null,
  quarantineOn: true,
  advancedOpen: false,
  grantSafe: true,
  grantDangerous: new Set<string>(),
  pinContract: false,
  step: 'form',
  events: [],
  pct: 0,
  activeStep: null,
  error: null,
  result: null,
  busy: false,
};

const EMPTY_MCP: AddMcpDialogState = {
  open: false,
  name: '',
  id: '',
  transport: 'stdio',
  command: '',
  args: [],
  url: '',
  enableOnSave: true,
  busy: false,
  error: null,
  lastHealth: null,
};

const RAIL_KEY = 'xr.skills.rail';

function readRail(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

let loadSeq = 0;

export const useSkillsStore = create<SkillsState>((set, get) => ({
  records: [],
  mcpServers: [],
  plugins: [],
  updates: [],
  featuredId: null,
  featuredFromRegistry: false,
  loading: true,
  error: null,
  offline: false,
  catalogNote: null,
  query: '',
  category: 'featured',
  selectedId: null,
  inspect: null,
  inspectLoading: false,
  install: { ...EMPTY_INSTALL },
  addMcp: { ...EMPTY_MCP },
  quickInstallOpen: false,
  railCollapsed: readRail(),

  visible: () => {
    const st = get();
    const q = st.query.trim();
    const base = q ? st.records.filter((r) => matchesQuery(r, q)) : st.records;
    return filterByCategory(base, st.category);
  },

  counts: () => {
    const st = get();
    const out = {} as Record<CategoryId, number>;
    for (const def of [
      'featured',
      'installed',
      'updates',
      'developer',
      'productivity',
      'research',
      'creative',
      'browser',
      'files',
      'communication',
      'operations',
      'data',
      'memory',
      'agents',
      'security',
      'custom-mcp',
    ] as CategoryId[]) {
      out[def] = filterByCategory(st.records, def).length;
    }
    return out;
  },

  load: async (opts) => {
    const seq = ++loadSeq;
    set({ loading: get().records.length === 0, error: null });
    try {
      if (opts?.sync) await syncMarketplace();
      const [market, mcp, plugins] = await Promise.all([
        fetchMarketplace(),
        listMcp().catch(() => ({ servers: [] as McpServer[] })),
        listPlugins().catch(() => ({ summary: {}, plugins: [] as PluginRow[] })),
      ]);
      if (seq !== loadSeq) return;
      set({
        records: market.skills,
        updates: market.updates,
        featuredId: market.featuredId,
        featuredFromRegistry: market.featuredSource === 'registry',
        mcpServers: mcp.servers,
        plugins: plugins.plugins,
        loading: false,
        offline: false,
        error: null,
        catalogNote:
          market.registries.length === 0
            ? 'No online registry configured — showing bundled and installed skills.'
            : market.registries.every((r) => r.lastError)
              ? `Couldn't reach skill registry — showing cached catalog${market.registries[0]?.lastSyncAt ? ` from ${new Date(market.registries[0].lastSyncAt).toLocaleString()}` : ''}.`
              : null,
      });
    } catch (e) {
      if (seq !== loadSeq) return;
      const down = e instanceof EngineDown;
      set({
        loading: false,
        offline: down,
        error: down ? 'Offline — showing installed skills only. Check your connection or Shield egress settings.' : describeEngineError(e),
      });
    }
  },

  setQuery: (q) => set({ query: q }),

  selectCategory: (c) => {
    if (c === 'custom-mcp') {
      set({ category: 'installed', addMcp: { ...get().addMcp, open: true } });
      return;
    }
    set({ category: c });
  },

  openDetail: (id) => {
    if (!id) {
      set({ selectedId: null, inspect: null });
      return;
    }
    set({ selectedId: id, inspectLoading: true, inspect: null });
    void inspectSkill(id)
      .then((res) => {
        if (get().selectedId === id) set({ inspect: res, inspectLoading: false });
      })
      .catch((e) => {
        if (get().selectedId === id) set({ inspectLoading: false, error: describeEngineError(e) });
      });
  },

  closeDetail: () => set({ selectedId: null, inspect: null }),

  openInstall: (id, mode = 'install') => {
    set({
      install: {
        ...EMPTY_INSTALL,
        open: true,
        mode,
        skillId: id,
        // Quarantine default ON. Official skills may opt out; unsigned ones
        // cannot (the engine refuses too — this is just the UI default).
        quarantineOn: true,
        grantSafe: true,
        grantDangerous: new Set<string>(),
      },
    });
  },

  openInstallFromUrl: () => {
    set({
      install: {
        ...EMPTY_INSTALL,
        open: true,
        mode: 'from-url',
        skillId: null,
        source: null,
        preview: null,
        quarantineOn: true,
      },
    });
  },

  closeInstall: () => {
    const { busy } = get().install;
    if (busy) return; // let the stream settle; user can cancel via the abort in confirmInstall
    set({ install: { ...EMPTY_INSTALL } });
  },

  setInstallField: (patch) => set({ install: { ...get().install, ...patch } }),

  toggleGrant: (scope) => {
    const next = new Set(get().install.grantDangerous);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    set({ install: { ...get().install, grantDangerous: next } });
  },

  setInstallSource: (source) => {
    set({ install: { ...get().install, source, busy: true, error: null } });
    void apiInstallFromUrl(source)
      .then((preview) => {
        set({
          install: {
            ...get().install,
            preview,
            busy: false,
            quarantineOn: preview.decision.forced ? true : get().install.quarantineOn,
            skillId: preview.manifest?.id ?? null,
            error: preview.ok ? null : preview.errors.join('; ') || 'Could not read that source.',
          },
        });
      })
      .catch((e) => {
        set({ install: { ...get().install, busy: false, error: describeEngineError(e) } });
      });
  },

  confirmInstall: async () => {
    const st = get();
    const d = st.install;
    if (d.busy) return;
    let id = d.skillId ?? '';
    let registryId: string | undefined;
    let versionRange: string | undefined;

    if (d.mode === 'from-url') {
      if (!d.preview?.ok || !d.preview.manifest) {
        set({ install: { ...d, error: 'Validate a source first (URL or local path).' } });
        return;
      }
      id = d.preview.manifest.id;
    } else if (d.mode === 'update') {
      const update = st.updates.find((u) => u.id === d.skillId);
      if (update) {
        versionRange = update.latestVersion;
        registryId = update.registryId;
      }
    } else {
      const record = st.records.find((r) => r.id === d.skillId);
      registryId = record?.registryId ?? undefined;
    }

    const grants = [
      ...(d.grantSafe ? (st.records.find((r) => r.id === id)?.permissions ?? d.preview?.manifest?.permissions ?? []).filter((p) => !p.dangerous).map((p) => p.scope) : []),
      ...[...d.grantDangerous],
    ];

    set({
      install: {
        ...d,
        step: 'progress',
        busy: true,
        error: null,
        events: [],
        pct: 0,
        activeStep: 'download',
        result: null,
      },
    });

    const controller = new AbortController();
    try {
      const job = await startInstall({
        id,
        registryId,
        versionRange,
        ...(d.mode === 'from-url' ? { fromUrl: d.source?.url, localPath: d.source?.localPath } : {}),
        quarantine: d.quarantineOn,
        grantPermissions: grants,
        pin: d.pinContract,
      });
      await streamInstall(
        job.jobId,
        (e: InstallEvent) => {
          const cur = get().install;
          const events = [...cur.events, e];
          const pct = e.type === 'done' || e.type === 'error' ? 100 : e.pct;
          if (e.type === 'done') {
            set({
              install: { ...cur, events, pct, activeStep: 'ready', step: 'success', busy: false, result: e.result ?? null },
            });
            const rec = get().records.find((r) => r.id === (e.result?.skillId ?? id));
            auditSkill(
              d.mode === 'update' ? 'Skill update installed' : e.result?.quarantined ? 'Skill installed (quarantined)' : 'Skill installed',
              { id: e.result?.skillId ?? id, version: e.result?.version ?? undefined, publisher: rec?.publisher, signed: rec?.signed, permissions: rec?.permissions },
              { scopes: grants, note: `quarantine=${e.result?.quarantined ? 'on' : 'off'}${e.result?.quarantineReason ? ` (${e.result.quarantineReason})` : ''}` },
            );
            void get().load();
            if (e.result?.quarantined) toast.info(QUARANTINE_COPY.toast(e.result.skillId ?? id));
            else toast.success(`${e.result?.skillId ?? id} installed — available to agents now.`);
          } else if (e.type === 'error') {
            auditSkill('Skill install refused', { id: id || 'unknown' }, { decision: 'blocked', note: e.error ?? e.message });
            set({
              install: {
                ...cur,
                events,
                pct,
                activeStep: 'error',
                step: 'error',
                busy: false,
                error: e.error ?? e.message,
                result: e.result ?? null,
              },
            });
          } else {
            set({ install: { ...cur, events, pct, activeStep: e.step } });
          }
        },
        controller.signal,
      );
      // Stream closed without a terminal event (job vanished) — be honest.
      const fin = get().install;
      if (fin.busy && fin.step === 'progress') {
        set({ install: { ...fin, busy: false, step: 'error', error: 'Install stream ended unexpectedly.' } });
      }
    } catch (e) {
      const cur = get().install;
      if (controller.signal.aborted) {
        set({ install: { ...cur, busy: false, step: cur.result ? 'success' : 'form' } });
        return;
      }
      set({ install: { ...cur, busy: false, step: 'error', error: describeEngineError(e) } });
    }
  },

  retryInstall: async () => {
    set({ install: { ...get().install, step: 'form', error: null, events: [], pct: 0, result: null } });
    await get().confirmInstall();
  },

  uninstall: async (id) => {
    try {
      await apiUninstall(id);
      toast.success(`${id} uninstalled — files removed and permissions revoked.`);
      if (get().selectedId === id) get().closeDetail();
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  toggleEnabled: async (id) => {
    const record = get().records.find((r) => r.id === id);
    if (!record) return;
    const next = !record.enabled;
    // Optimistic, then reconciled by load().
    set({ records: get().records.map((r) => (r.id === id ? { ...r, enabled: next } : r)) });
    try {
      await setEnabled(id, next);
      await get().load();
    } catch (e) {
      set({ records: get().records.map((r) => (r.id === id ? { ...r, enabled: !next } : r)) });
      toast.error(describeEngineError(e));
    }
  },

  promote: async (id) => {
    try {
      const res = await apiPromote(id);
      toast.success(res.promoted ? QUARANTINE_COPY.promoted(id) : `${id} was already promoted.`);
      if (get().selectedId === id) get().openDetail(id);
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  grantPermissions: async (id, grant, revoke) => {
    try {
      await mutatePermissions(id, grant, revoke);
      if (get().selectedId === id) get().openDetail(id);
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
      // Undo optimistic toggles by reloading the report.
      if (get().selectedId === id) get().openDetail(id);
    }
  },

  saveSkillSettings: async (id, values) => {
    try {
      await saveSettings(id, values);
      toast.success(`Settings saved for ${id}.`);
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  setRailCollapsed: (v) => {
    try {
      window.localStorage.setItem(RAIL_KEY, v ? '1' : '0');
    } catch {
      /* persistence is best-effort */
    }
    set({ railCollapsed: v });
  },

  setQuickInstallOpen: (v) => set({ quickInstallOpen: v }),

  // ── MCP ──────────────────────────────────────────────────────────────────
  openAddMcp: () => set({ addMcp: { ...EMPTY_MCP, open: true } }),
  closeAddMcp: () => set({ addMcp: { ...EMPTY_MCP } }),
  setMcpField: (patch) => set({ addMcp: { ...get().addMcp, ...patch } }),

  submitAddMcp: async () => {
    const f = get().addMcp;
    const id = f.id.trim() || f.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) {
      set({ addMcp: { ...f, error: 'Give the server a name.' } });
      return;
    }
    if (f.transport === 'stdio' && !f.command.trim()) {
      set({ addMcp: { ...f, error: 'stdio transport needs a command.' } });
      return;
    }
    if (f.transport !== 'stdio' && !f.url.trim()) {
      set({ addMcp: { ...f, error: `${f.transport} transport needs a URL.` } });
      return;
    }
    set({ addMcp: { ...f, busy: true, error: null } });
    try {
      const input: AddMcpInput = {
        id,
        name: f.name.trim() || id,
        transport: f.transport,
        enabled: f.enableOnSave,
        ...(f.transport === 'stdio'
          ? { cmd: f.command.trim(), args: f.args.filter((a) => a.trim()) }
          : { url: f.url.trim() }),
      };
      await apiAddMcp(input);
      // The dialog closes as soon as the engine has registered the server. The
      // health probe runs in the background for this one server only: a stdio
      // server that never answers initialize can take ~15s to time out, and the
      // user should not wait on it.
      set({ addMcp: { ...EMPTY_MCP } });
      void get().load();
      if (!input.enabled) {
        // "Off means it is registered but not started": never probe (a probe starts the server).
        toast.success(`MCP server ${id} registered. It is off, so it has not been started.`);
        return;
      }
      toast.success(`MCP server ${id} added. Checking health…`);
      void (async () => {
        try {
          const { reports } = await apiMcpHealth({ id });
          const report = reports.find((r) => r.id === id);
          if (!report) toast.success(`MCP server ${id} added.`);
          else if (report.state === 'healthy') toast.success(`MCP server ${id} is healthy.`);
          else toast.error(`MCP server ${id} added, but it is not healthy: ${report.detail ?? report.state}`);
        } catch {
          toast.error(`MCP server ${id} added, but the health check could not run.`);
        } finally {
          void get().load();
        }
      })();
    } catch (e) {
      set({ addMcp: { ...get().addMcp, busy: false, error: describeEngineError(e) } });
    }
  },

  toggleMcp: async (id, enabled) => {
    try {
      await apiSetMcpEnabled(id, enabled);
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  removeMcp: async (id) => {
    try {
      await apiRemoveMcp(id);
      toast.success(`MCP server ${id} removed.`);
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  pinMcp: async (id) => {
    try {
      const res = await apiMcpPin(id);
      toast.success(`Contract pinned for ${id} (${res.pinnedTools} tools). Drift will require re-approval.`);
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  unpinMcp: async (id) => {
    try {
      await apiMcpUnpin(id);
      toast.success(`Contract unpinned for ${id}.`);
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  diffMcp: async (id) => {
    try {
      const res = await apiMcpPinDiff(id);
      return res.drift;
    } catch (e) {
      toast.error(describeEngineError(e));
      return null;
    }
  },

  // ── plugins ──────────────────────────────────────────────────────────────
  togglePlugin: async (id, enabled) => {
    try {
      const res = await apiSetPluginEnabled(id, enabled);
      if (res.ok === false) {
        toast.error(res.reason ?? 'The engine refused the change.');
        return;
      }
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },

  grantPluginPermission: async (id, scope, granted) => {
    try {
      const row = get().plugins.find((p) => p.id === id);
      if (!row) return;
      const current = (row.permissions ?? []).filter((p) => p.granted).map((p) => p.scope);
      const next = granted ? [...new Set([...current, scope])] : current.filter((s) => s !== scope);
      const res = await apiSetPluginPermissions(id, next);
      if (res.ok === false) {
        toast.error(res.reason ?? 'The engine refused the permission change.');
        return;
      }
      await get().load();
    } catch (e) {
      toast.error(describeEngineError(e));
    }
  },
}));

/** Permission report cache helper used by the detail slide-over. */
export type { InspectResponse, PluginRow };
export type { PermissionReport, DependencyReport };
