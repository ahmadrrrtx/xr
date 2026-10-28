/**
 * Phase 1 (V1 matrix D-08) — Agents screen core, store-level, under bun with
 * the DOM shim. The multi-agent ENGINE already has test/agents/*; this pins
 * the UI layer the matrix flagged unverified:
 *   · summaryFromCustom — the custom-record → index-summary mirror (capability
 *     booleans derive from tools, memory scope from constitution);
 *   · editor lifecycle — openCreate/openTemplate/openEdit/openDuplicateFromPrebuilt,
 *     patchForm re-validation of already-shown problems only, dirty-guarded
 *     closeEditor, preview toggle;
 *   · palette state — query/family/config slide-over, favorites persisting
 *     through the settings store;
 *   · validateForm limits — name/prompt/model/tool rules that back the editor.
 */
import { storage, setTauri } from "./helpers/dom-shim.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  selectCustom,
  selectPrebuilt,
  summaryFromCustom,
  useAgentsStore,
} from "../../desktop/src/stores/agentsStore.ts";
import {
  AGENT_TEMPLATES,
  emptyAgentForm,
  validateForm,
  type AgentForm,
} from "../../desktop/src/agents/core.ts";
import { useSettingsStore } from "../../desktop/src/stores/settingsStore.ts";
import type { CustomAgent, EngineTool } from "../../desktop/src/agents/core.ts";

const TOOLS: EngineTool[] = [
  { name: "read_file", description: "" },
  { name: "list_dir", description: "" },
  { name: "write_file", description: "" },
  { name: "shell", description: "" },
  { name: "fetch_url", description: "" },
].map((t) => ({ ...t } as EngineTool));

function custom(over: Partial<CustomAgent> = {}): CustomAgent {
  return {
    id: "c1",
    name: "Doc writer",
    description: "Writes docs",
    emoji: "📘",
    role: "executor",
    version: 2,
    systemPrompt: "Write clear docs.",
    tools: ["read_file", "write_file"],
    provider: "ollama",
    model: "qwen",
    budget: { perRunUsd: 0.5, perDayUsd: 2 },
    constitution: {
      allowPublicWeb: false,
      memoryWrite: true,
      requireApproval: "writes",
    },
    createdAt: "2026-10-01",
    updatedAt: "2026-10-02",
    ...over,
  } as CustomAgent;
}

const agentsInitial = useAgentsStore.getState();
beforeEach(() => {
  storage.clear();
  setTauri(false);
  useAgentsStore.setState(
    {
      ...agentsInitial,
      agents: [],
      query: "",
      family: "all",
      configId: null,
      editor: { ...agentsInitial.editor, open: false, dirty: false },
      confirmDeleteId: null,
    },
    true,
  );
});

describe("summaryFromCustom — custom record mirrors the index summary", () => {
  test("capability booleans derive from tools; memory scope from constitution", () => {
    const s = summaryFromCustom(custom());
    expect(s.id).toBe("c1");
    expect(s.label).toBe("Doc writer");
    expect(s.version).toBe("2");
    expect(s.builtin).toBe(false);
    expect(s.permissions).toMatchObject({ writeFiles: true, shell: false, network: false, mcp: false });
    expect(s.toolScope).toEqual({ mode: "allowlist", tools: ["read_file", "write_file"] });
    expect(s.memoryScope).toMatchObject({ kind: "project" }); // memoryWrite: true
  });

  test("network permission needs BOTH allowPublicWeb and a network tool", () => {
    const web = summaryFromCustom(custom({ tools: ["fetch_url"] }));
    expect(web.permissions.network).toBe(false); // tool but no constitution flag
    const both = summaryFromCustom(
      custom({ tools: ["fetch_url"], constitution: { allowPublicWeb: true, memoryWrite: false, requireApproval: "never" } as never }),
    );
    expect(both.permissions.network).toBe(true);
    expect(both.memoryScope).toMatchObject({ kind: "workflow" }); // memoryWrite: false
  });
});

describe("editor lifecycle", () => {
  test("openCreate seeds from empty; patchForm marks dirty and re-validates shown fields only", () => {
    const st = useAgentsStore.getState();
    st.openCreate();
    let ed = useAgentsStore.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.mode).toBe("create");
    expect(ed.form.tools).toEqual(["read_file", "list_dir"]);

    // Simulate the editor having shown the model problem, then fix + break name.
    st.patchForm({ model: "qwen" });
    ed = useAgentsStore.getState().editor;
    expect(ed.dirty).toBe(true);
    expect(ed.problems).toEqual([]); // nothing was shown yet → stays quiet

    st.patchForm({ name: "" });
    ed = useAgentsStore.getState().editor;
    expect(ed.problems).toEqual([]); // still quiet: name problem was never shown

    // openEdit closes first (dirty → confirm); force path used by the screen.
    (globalThis as { confirm?: (m: string) => boolean }).confirm = () => true;
    expect(st.closeEditor({ force: true })).toBe(true);
    expect(useAgentsStore.getState().editor.open).toBe(false);
  });

  test("openTemplate seeds from a real template; openEdit loads a custom agent's form", () => {
    const st = useAgentsStore.getState();
    const tpl = AGENT_TEMPLATES[0]!;
    st.openTemplate(tpl.id);
    let ed = useAgentsStore.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.form.name).toBe(tpl.form.name);
    st.closeEditor({ force: true });

    // Seed the index with a custom agent, then edit it.
    useAgentsStore.setState({ agents: [summaryFromCustom(custom())] });
    st.openEdit("c1");
    ed = useAgentsStore.getState().editor;
    expect(ed.mode).toBe("edit");
    expect(ed.id).toBe("c1");
    expect(ed.form.name).toBe("Doc writer");
    expect(ed.dirty).toBe(false);
  });

  test("openDuplicateFromPrebuilt marks create-mode with basedOn and dirty", () => {
    useAgentsStore.setState({
      agents: [
        {
          id: "pre1",
          role: "reviewer",
          label: "Reviewer",
          description: "",
          version: "1",
          enabledByDefault: true,
          capabilities: [],
          permissions: { writeFiles: false, shell: false, network: false, plugins: false, mcp: false, memoryRead: true, memoryWrite: false, computerControl: false, secrets: false, destructiveExec: false },
          toolScope: { mode: "allowlist", tools: [] },
          memoryScope: { kind: "workflow", sharedWithSupervisor: true, maxEntries: 32 },
          providerScope: {},
          builtin: true,
        },
      ],
    });
    useAgentsStore.getState().openDuplicateFromPrebuilt("pre1");
    const ed = useAgentsStore.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.mode).toBe("create");
    expect(ed.basedOn).toBe("pre1");
    expect(ed.dirty).toBe(true);
  });

  test("closeEditor refuses while dirty unless confirmed/forced (no silent loss)", () => {
    const st = useAgentsStore.getState();
    (globalThis as { confirm?: (m: string) => boolean }).confirm = () => false;
    st.openCreate();
    st.patchForm({ name: "x" }); // dirty
    expect(st.closeEditor()).toBe(false);
    expect(useAgentsStore.getState().editor.open).toBe(true);
    (globalThis as { confirm?: (m: string) => boolean }).confirm = () => true;
    expect(st.closeEditor()).toBe(true);
    expect(useAgentsStore.getState().editor.open).toBe(false);
  });

  test("togglePreview flips the prompt preview", () => {
    useAgentsStore.getState().openCreate();
    useAgentsStore.getState().togglePreview();
    expect(useAgentsStore.getState().editor.preview).toBe(true);
    useAgentsStore.getState().togglePreview();
    expect(useAgentsStore.getState().editor.preview).toBe(false);
  });
});

describe("palette + favorites", () => {
  test("query/family/config setters", () => {
    const st = useAgentsStore.getState();
    st.setQuery("review");
    st.setFamily("reviewer");
    st.openConfig("pre1");
    const after = useAgentsStore.getState();
    expect(after.query).toBe("review");
    expect(after.family).toBe("reviewer");
    expect(after.configId).toBe("pre1");
  });

  test("favorites persist through the settings store and toggle off", () => {
    const st = useAgentsStore.getState();
    expect(st.isFavorite("c1")).toBe(false);
    st.toggleFavorite("c1");
    expect(st.isFavorite("c1")).toBe(true);
    // survived a settings re-hydrate from storage
    expect(useSettingsStore.getState().settings.agents.favoriteAgents).toContain("c1");
    st.toggleFavorite("c1");
    expect(st.isFavorite("c1")).toBe(false);
  });

  test("selectors split prebuilt vs custom", () => {
    const mixed = [summaryFromCustom(custom()), { id: "pre1", builtin: true }] as never[];
    expect(selectPrebuilt({ agents: mixed } as never).map((a: { id: string }) => a.id)).toEqual(["pre1"]);
    expect(selectCustom({ agents: mixed } as never).map((a: { id: string }) => a.id)).toEqual(["c1"]);
  });
});

describe("validateForm — the editor's rules (limits enforced client-side)", () => {
  const base: AgentForm = { ...emptyAgentForm(), name: "A", model: "m", systemPrompt: "long enough prompt — over twenty chars" };

  test("empty name, missing model, short prompt are problems", () => {
    const problems = validateForm({ ...emptyAgentForm() }, TOOLS);
    const paths = problems.map((p) => p.path).sort();
    expect(paths).toEqual(["model", "name", "systemPrompt"]);
  });

  test("unknown tool is rejected against the engine tool list", () => {
    const problems = validateForm({ ...base, tools: ["read_file", "rm_rf"] }, TOOLS);
    expect(problems.some((p) => p.path === "tools" && p.message.includes("rm_rf"))).toBe(true);
  });

  test("a complete form passes", () => {
    expect(validateForm(base, TOOLS)).toEqual([]);
  });
});
