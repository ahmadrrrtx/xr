/*
 * Agents store (Phase 19) — the single store behind the Prebuilt and
 * My Agents tabs and the Chat `?agent=` hand-off.
 *
 *   prebuilt  = the engine's agent registry (`GET /agents` → agents[]
 *               with builtin:true), read-only, favourites in settings
 *   custom    = the user's versioned agent documents (builtin:false),
 *               CRUD through /agents/custom — the ENGINE validates and
 *               persists (~/.xr/agents/<id>.json); this store only mirrors
 *   editor    = one slide-over form at a time (create / edit / template)
 *
 * No local fallbacks: when the engine is down the lists say so.
 */
import { toast } from 'sonner';
import { create } from 'zustand';

import {
  createCustomAgent,
  deleteCustomAgent,
  describeEngineError,
  duplicateCustomAgent,
  fetchAgentsIndex,
  importCustomAgent,
  updateCustomAgent,
} from '@/agents/api';
import {
  AGENT_TEMPLATES,
  bindingFor,
  emptyAgentForm,
  exportDocument,
  exportFileName,
  formFromAgent,
  formFromSummary,
  parseImport,
  toInput,
  validateForm,
  type AgentForm,
  type AgentSummary,
  type ChatAgentBinding,
  type CustomAgent,
  type EngineTool,
  type FieldProblem,
  type RoleFamily,
} from '@/agents/core';
import { EngineDown } from '@/engine/transport';
import { useSettingsStore } from '@/stores/settingsStore';

export type EditorMode = 'create' | 'edit';

export interface AgentEditorState {
  open: boolean;
  mode: EditorMode;
  /** Custom agent being edited (edit mode). */
  id: string | null;
  /** Prebuilt source when duplicating a specialist. */
  basedOn: string | null;
  form: AgentForm;
  dirty: boolean;
  problems: FieldProblem[];
  saving: boolean;
  /** Markdown preview of the system prompt. */
  preview: boolean;
}

interface AgentsState {
  agents: AgentSummary[];
  tools: EngineTool[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  engineDown: boolean;

  query: string;
  family: RoleFamily | 'all';
  /** Read-only config slide-over (prebuilt "View config"). */
  configId: string | null;
  editor: AgentEditorState;
  /** Delete confirmation target (custom id). */
  confirmDeleteId: string | null;

  load: (opts?: { force?: boolean }) => Promise<void>;
  setQuery: (q: string) => void;
  setFamily: (f: RoleFamily | 'all') => void;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  openConfig: (id: string | null) => void;

  openCreate: (seed?: Partial<AgentForm>) => void;
  openTemplate: (templateId: string) => void;
  openEdit: (id: string) => void;
  openDuplicateFromPrebuilt: (id: string) => void;
  patchForm: (patch: Partial<AgentForm>) => void;
  togglePreview: () => void;
  closeEditor: (opts?: { force?: boolean }) => boolean;
  save: () => Promise<CustomAgent | null>;

  duplicate: (id: string) => Promise<void>;
  requestDelete: (id: string | null) => void;
  remove: (id: string) => Promise<boolean>;
  importFromText: (text: string) => Promise<CustomAgent | null>;
  exportAgent: (id: string) => Promise<void>;

  /** Agent by id (any kind), loading the index first if needed. */
  resolve: (id: string) => Promise<AgentSummary | null>;
  bindingFor: (id: string) => Promise<ChatAgentBinding | null>;
}

function closedEditor(): AgentEditorState {
  return { open: false, mode: 'create', id: null, basedOn: null, form: emptyAgentForm(), dirty: false, problems: [], saving: false, preview: false };
}

function upsert(list: AgentSummary[], agent: AgentSummary): AgentSummary[] {
  const i = list.findIndex((a) => a.id === agent.id);
  if (i === -1) return [...list, agent];
  const next = list.slice();
  next[i] = agent;
  return next;
}

/** Custom record → the same summary shape the index returns (mirrors toAgentDefinition). */
export function summaryFromCustom(c: CustomAgent): AgentSummary {
  return {
    id: c.id,
    role: c.role,
    label: c.name,
    description: c.description,
    version: String(c.version),
    enabledByDefault: true,
    capabilities: c.tools,
    permissions: {
      writeFiles: c.tools.includes('write_file'),
      shell: c.tools.includes('shell'),
      network: c.constitution.allowPublicWeb && (c.tools.includes('fetch_url') || c.tools.includes('web_search')),
      plugins: false,
      mcp: false,
      memoryRead: true,
      memoryWrite: c.constitution.memoryWrite,
      computerControl: false,
      secrets: false,
      destructiveExec: false,
    },
    toolScope: { mode: 'allowlist', tools: c.tools },
    memoryScope: { kind: c.constitution.memoryWrite ? 'project' : 'workflow', sharedWithSupervisor: true, maxEntries: 32 },
    providerScope: { ...(c.provider ? { provider: c.provider } : {}), ...(c.model ? { model: c.model } : {}) },
    builtin: false,
    custom: c,
  };
}

async function saveViaDialog(name: string, text: string): Promise<void> {
  try {
    const { isTauri } = await import('@/lib/tauri');
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({ defaultPath: name, filters: [{ name: 'XR agent', extensions: ['json'] }] });
      if (!path) return;
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, text);
      toast(`Exported ${name}`);
      return;
    }
  } catch {
    /* fall through to the browser download */
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  tools: [],
  loading: false,
  loaded: false,
  error: null,
  engineDown: false,
  query: '',
  family: 'all',
  configId: null,
  editor: closedEditor(),
  confirmDeleteId: null,

  load: async (opts) => {
    if (get().loading) return;
    if (get().loaded && !opts?.force) return;
    set({ loading: true, error: null });
    try {
      const idx = await fetchAgentsIndex();
      set({ agents: idx.agents, tools: idx.tools, loading: false, loaded: true, engineDown: false, error: null });
    } catch (e) {
      const down = e instanceof EngineDown;
      set({
        loading: false,
        loaded: true,
        engineDown: down,
        error: down ? 'The engine is not reachable. Agents load from it; nothing is cached.' : describeEngineError(e).message,
      });
    }
  },

  setQuery: (query) => set({ query }),
  setFamily: (family) => set({ family }),

  toggleFavorite: (id) => {
    const st = useSettingsStore.getState();
    const cur = st.settings.agents.favoriteAgents;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    st.update('agents', { favoriteAgents: next });
  },
  isFavorite: (id) => useSettingsStore.getState().settings.agents.favoriteAgents.includes(id),

  openConfig: (configId) => set({ configId }),

  openCreate: (seed) => {
    if (!get().closeEditor()) return;
    set({ editor: { ...closedEditor(), open: true, mode: 'create', form: { ...emptyAgentForm(), ...(seed ?? {}) } } });
  },

  openTemplate: (templateId) => {
    const t = AGENT_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    get().openCreate({ ...t.form, constitution: { ...t.form.constitution } });
  },

  openEdit: (id) => {
    const a = get().agents.find((x) => x.id === id);
    if (!a?.custom) return;
    if (!get().closeEditor()) return;
    set({ editor: { ...closedEditor(), open: true, mode: 'edit', id, form: formFromAgent(a.custom) } });
  },

  openDuplicateFromPrebuilt: (id) => {
    const a = get().agents.find((x) => x.id === id);
    if (!a) return;
    if (!get().closeEditor()) return;
    set({ editor: { ...closedEditor(), open: true, mode: 'create', basedOn: id, form: formFromSummary(a, get().tools), dirty: true } });
  },

  patchForm: (patch) => {
    const ed = get().editor;
    const form = { ...ed.form, ...patch };
    // Re-validate only the fields the user has already been told about.
    const shown = new Set(ed.problems.map((p) => p.path));
    const problems = ed.problems.length ? validateForm(form, get().tools).filter((p) => shown.has(p.path)) : [];
    set({ editor: { ...ed, form, dirty: true, problems } });
  },

  togglePreview: () => set((s) => ({ editor: { ...s.editor, preview: !s.editor.preview } })),

  closeEditor: (opts) => {
    const ed = get().editor;
    if (!ed.open) return true;
    if (ed.dirty && !opts?.force && !window.confirm('Discard unsaved changes to this agent?')) return false;
    set({ editor: closedEditor() });
    return true;
  },

  save: async () => {
    const ed = get().editor;
    const problems = validateForm(ed.form, get().tools);
    if (problems.length) {
      set({ editor: { ...ed, problems } });
      return null;
    }
    set({ editor: { ...ed, saving: true, problems: [] } });
    try {
      const input = { ...toInput(ed.form), ...(ed.basedOn ? { basedOn: ed.basedOn } : {}) };
      const agent = ed.mode === 'edit' && ed.id ? await updateCustomAgent(ed.id, input) : await createCustomAgent(input);
      set((s) => ({ agents: upsert(s.agents, summaryFromCustom(agent)), editor: closedEditor() }));
      toast(ed.mode === 'edit' ? `Saved ${agent.name} · v${agent.version}` : `Created ${agent.name}`);
      return agent;
    } catch (e) {
      const d = describeEngineError(e);
      set((s) => ({ editor: { ...s.editor, saving: false, problems: d.problems.length ? d.problems : [{ path: '', message: d.message }] } }));
      return null;
    }
  },

  duplicate: async (id) => {
    try {
      const agent = await duplicateCustomAgent(id);
      set((s) => ({ agents: upsert(s.agents, summaryFromCustom(agent)) }));
      toast(`Duplicated as ${agent.name}`);
    } catch (e) {
      toast.error(describeEngineError(e).message);
    }
  },

  requestDelete: (confirmDeleteId) => set({ confirmDeleteId }),

  remove: async (id) => {
    const a = get().agents.find((x) => x.id === id);
    try {
      await deleteCustomAgent(id);
      set((s) => ({
        agents: s.agents.filter((x) => x.id !== id),
        confirmDeleteId: null,
        configId: s.configId === id ? null : s.configId,
        editor: s.editor.id === id ? closedEditor() : s.editor,
      }));
      const favs = useSettingsStore.getState().settings.agents.favoriteAgents;
      if (favs.includes(id)) useSettingsStore.getState().update('agents', { favoriteAgents: favs.filter((x) => x !== id) });
      toast(`Deleted ${a?.label ?? 'agent'}`);
      return true;
    } catch (e) {
      toast.error(describeEngineError(e).message);
      set({ confirmDeleteId: null });
      return false;
    }
  },

  importFromText: async (text) => {
    const parsed = parseImport(text);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return null;
    }
    try {
      const agent = await importCustomAgent(parsed.doc);
      set((s) => ({ agents: upsert(s.agents, summaryFromCustom(agent)) }));
      toast(`Imported ${agent.name}`);
      return agent;
    } catch (e) {
      const d = describeEngineError(e);
      toast.error(d.problems.length ? `${d.message}: ${d.problems.map((p) => `${p.path} ${p.message}`).join('; ')}` : d.message);
      return null;
    }
  },

  exportAgent: async (id) => {
    const a = get().agents.find((x) => x.id === id);
    if (!a?.custom) return;
    await saveViaDialog(exportFileName(a.custom), exportDocument(a.custom));
  },

  resolve: async (id) => {
    if (!get().loaded) await get().load();
    return get().agents.find((a) => a.id === id) ?? null;
  },

  bindingFor: async (id) => {
    const a = await get().resolve(id);
    return a ? bindingFor(a) : null;
  },
}));

/* ── Selectors ────────────────────────────────────────────────────────── */

export function selectPrebuilt(s: AgentsState): AgentSummary[] {
  return s.agents.filter((a) => a.builtin);
}

export function selectCustom(s: AgentsState): AgentSummary[] {
  return s.agents.filter((a) => !a.builtin);
}
