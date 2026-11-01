/**
 * XR-LAUNCH-026 — desktop FRONTEND coverage (the engine side already had 340
 * tests; the renderer had none). Store-level, under bun, with a minimal DOM
 * shim:
 *   · Runs store: the production empty state (XR-LAUNCH-009) — an offline
 *     engine shows NO fabricated history, real engine runs still appear.
 *   · Settings store: hydrate/merge/persist/remote-sync semantics.
 *   · Chat store: per-session mode + agent binding persistence, attachments,
 *     the offline queue, the screen-reader announcement.
 *   · Deep links (XR-LAUNCH-013): the xr://oauth/callback listener registered
 *     at app root (App.tsx) — only well-formed callbacks reach the store, the
 *     listener never stacks, and it no-ops outside Tauri.
 */
import { storage, setTauri } from "./helpers/dom-shim.ts";
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { useBuilderStore } from "../../desktop/src/stores/builderStore.ts";
import { useRunsStore } from "../../desktop/src/stores/runsStore.ts";
import { useEngineStore } from "../../desktop/src/stores/engineStore.ts";
import { useBrainStore } from "../../desktop/src/stores/brainStore.ts";
import { DEFAULT_SETTINGS, SETTINGS_KEY, useSettingsStore } from "../../desktop/src/stores/settingsStore.ts";
import { attachmentText, lastAssistantAnnouncement, modeFor, useChatStore, workspaceContextText } from "../../desktop/src/stores/chatStore.ts";

const runsInitial = useRunsStore.getState();
beforeEach(() => {
  storage.clear();
  setTauri(false);
  useRunsStore.setState({ ...runsInitial, runs: {}, loaded: false, loading: false, error: null }, true);
});

describe("runs store — production empty state (XR-LAUNCH-009)", () => {
  test("engine offline: no scripted history, an honest empty list", async () => {
    useEngineStore.setState({ status: "down" } as never);
    await useRunsStore.getState().load();
    const s = useRunsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.loading).toBe(false);
    expect(Object.keys(s.runs)).toEqual([]);
    expect(s.inProgressCount).toBe(0);
  });

  test("engine starting: still empty (the seed is DEV-only, not an offline fallback)", async () => {
    useEngineStore.setState({ status: "starting" } as never);
    await useRunsStore.getState().load();
    expect(Object.keys(useRunsStore.getState().runs)).toEqual([]);
  });

  test("the bundled build has no seed path: import.meta.env.DEV is not truthy under test", () => {
    // The store guards the seed with import.meta.env.DEV (literal false in a
    // production vite build); the CI bundle grep asserts the seed strings are
    // absent from the shipped chunk. Here we only pin the runtime condition.
    expect(Boolean((import.meta as { env?: Record<string, unknown> }).env?.DEV)).toBe(false);
  });

  test("real engine runs from the brain store are listed, nothing else", async () => {
    useEngineStore.setState({ status: "up" } as never);
    const run = {
      id: "eng-run-1", source: "engine", title: "Fix the flaky test", status: "complete", agent: "Main",
      model: "fixture-model", startedAt: Date.now() - 5_000, endedAt: Date.now(), tokensIn: 10, tokensOut: 20, costUsd: 0,
      steps: [], spans: [], events: [],
    };
    const prev = useBrainStore.getState().runs;
    useBrainStore.setState({ runs: { ...prev, [run.id]: run } } as never);
    try {
      await useRunsStore.getState().load();
      const ids = Object.keys(useRunsStore.getState().runs);
      expect(ids).toContain("eng-run-1");
      expect(ids.every((id) => !id.startsWith("mock-"))).toBe(true);
    } finally {
      useBrainStore.setState({ runs: prev } as never);
    }
  });
});

describe("settings store", () => {
  test("hydrates from storage, merging unknown/partial payloads over defaults", async () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ appearance: { density: "compact" }, bogusGroup: { x: 1 } }));
    await useSettingsStore.getState().load();
    const s = useSettingsStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.settings.appearance.density).toBe("compact");
    expect(s.settings.appearance.fontSize).toBe(DEFAULT_SETTINGS.appearance.fontSize);
    expect((s.settings as unknown as Record<string, unknown>).bogusGroup).toBeUndefined();
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  test("a corrupt payload falls back to defaults instead of crashing boot", async () => {
    storage.setItem(SETTINGS_KEY, "{not json");
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  test("a local write persists and bumps the saved indicator; a remote apply does not", () => {
    useSettingsStore.setState({ lastChangedAt: null });
    useSettingsStore.getState().setPath("appearance.density", "spacious");
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!).appearance.density).toBe("spacious");
    const stamp = useSettingsStore.getState().lastChangedAt;
    expect(typeof stamp).toBe("number");

    useSettingsStore.setState({ lastChangedAt: null });
    useSettingsStore.getState().applyRemote("appearance", { density: "compact" });
    expect(useSettingsStore.getState().settings.appearance.density).toBe("compact");
    expect(useSettingsStore.getState().lastChangedAt).toBeNull();
    useSettingsStore.getState().applyRemote("notAGroup", { x: 1 });
    expect((useSettingsStore.getState().settings as unknown as Record<string, unknown>).notAGroup).toBeUndefined();
  });

  test("resetAll restores every default", () => {
    useSettingsStore.getState().update("appearance", { density: "compact" });
    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("chat store", () => {
  test("mode is per session, remembered, and becomes the default for new chats", () => {
    expect(modeFor("s1")).toBe("agent");
    useChatStore.getState().setMode("s1", "plan");
    expect(modeFor("s1")).toBe("plan");
    expect(modeFor("fresh")).toBe("plan");
    expect(useChatStore.getState().modes.s1).toBe("plan");
    storage.setItem("xr.chat.mode.s2", "rm -rf");
    expect(modeFor("s2")).toBe("plan"); // garbage is ignored, falls back to the default
  });

  test("agent binding survives a reload and can be cleared", () => {
    const agent = { id: "a1", label: "Reviewer", emoji: "R", builtin: false, systemPrompt: "Review diffs.", tools: ["read_file"] };
    useChatStore.getState().bindAgent("s1", agent);
    useChatStore.setState({ agents: {} }); // simulate a reload: memory gone, storage kept
    expect(useChatStore.getState().agentFor("s1")).toEqual(agent);
    useChatStore.getState().bindAgent("s1", null);
    useChatStore.setState({ agents: {} });
    expect(useChatStore.getState().agentFor("s1")).toBeNull();
    storage.setItem("xr.chat.agent.s3", "{\"id\":1}");
    expect(useChatStore.getState().agentFor("s3")).toBeNull();
  });

  test("attachments add/remove/clear; only text attachments reach the prompt", () => {
    const st = useChatStore.getState();
    st.clearAttachments();
    st.addAttachment({ id: "f1", name: "a.txt", size: 2, text: "hi" } as never);
    st.addAttachment({ id: "f2", name: "b.png", size: 9 } as never);
    expect(useChatStore.getState().attachments.map((a) => a.id)).toEqual(["f1", "f2"]);
    expect(attachmentText(useChatStore.getState().attachments)).toBe("\n\n--- Attached file: a.txt ---\nhi\n--- end of a.txt ---");
    st.removeAttachment("f1");
    expect(useChatStore.getState().attachments.map((a) => a.id)).toEqual(["f2"]);
    st.clearAttachments();
    expect(useChatStore.getState().attachments).toEqual([]);
  });

  test("going online with nothing queued is a no-op; cancel while idle is safe", async () => {
    useChatStore.setState({ queuedIds: [], stream: null });
    useChatStore.getState().setOnline(false);
    expect(useChatStore.getState().online).toBe(false);
    useChatStore.getState().setOnline(true);
    await useChatStore.getState().flushQueued();
    expect(useChatStore.getState().queuedIds).toEqual([]);
    expect(() => useChatStore.getState().cancelGeneration()).not.toThrow();
  });

  test("workspace context and the aria-live announcement", () => {
    expect(workspaceContextText({ id: "w", name: "xr", path: "/src/xr" })).toContain('"xr" located at /src/xr');
    const msgs = [
      { id: "1", role: "user", content: "q" },
      { id: "2", role: "assistant", content: "x".repeat(400) },
      { id: "3", role: "user", content: "again" },
    ] as never;
    expect(lastAssistantAnnouncement(msgs)).toBe("x".repeat(300));
    expect(lastAssistantAnnouncement([] as never)).toBe("");
  });
});

describe("deep links — xr://oauth/callback listener (XR-LAUNCH-013)", () => {
  type Handler = (urls: string[]) => void;
  const handlers: Handler[] = [];
  let launchUrls: string[] | null = null;
  mock.module("@tauri-apps/plugin-deep-link", () => ({
    onOpenUrl: async (h: Handler) => { handlers.push(h); return () => {}; },
    getCurrent: async () => launchUrls,
  }));
  // A fresh module instance per scenario (the listener is once-per-session).
  let n = 0;
  const fresh = async () => (await import(`../../desktop/src/integrations/oauthCallback.ts?case=${++n}`)) as typeof import("../../desktop/src/integrations/oauthCallback.ts");

  test("outside Tauri it registers nothing", async () => {
    handlers.length = 0;
    const m = await fresh();
    await m.registerOAuthCallbackListener(() => {});
    expect(handlers).toHaveLength(0);
  });

  test("only well-formed callbacks reach the handler; it never stacks", async () => {
    handlers.length = 0;
    setTauri(true);
    const m = await fresh();
    const seen: unknown[] = [];
    await m.registerOAuthCallbackListener((cb) => seen.push(cb));
    await m.registerOAuthCallbackListener((cb) => seen.push(cb)); // app re-render / reload
    expect(handlers).toHaveLength(1);
    handlers[0]!([
      "xr://oauth/callback?code=abc&state=s1",
      "xr://oauth/callback/?error=access_denied&state=s2",
      "https://evil.example/oauth/callback?code=x&state=y", // wrong scheme
      "xr://other/callback?code=x&state=y", // wrong host
      "xr://oauth/callback?code=abc", // no state
      `xr://oauth/callback?code=${"c".repeat(600)}&state=s`, // oversized code
      "not a url",
    ]);
    expect(seen).toEqual([
      { kind: "success", code: "abc", state: "s1" },
      { kind: "denied", state: "s2" },
    ]);
  });

  test("cold start: the launch URL is delivered once, even if it also arrives as an event", async () => {
    handlers.length = 0;
    setTauri(true);
    launchUrls = ["xr://oauth/callback?code=cold&state=s9"];
    const m = await fresh();
    const seen: unknown[] = [];
    await m.registerOAuthCallbackListener((cb) => seen.push(cb));
    expect(seen).toEqual([{ kind: "success", code: "cold", state: "s9" }]);
    // The single-instance forward of the same URL must not run the exchange twice.
    handlers[0]!(["xr://oauth/callback?code=cold&state=s9", "xr://oauth/callback?code=warm&state=s10"]);
    expect(seen).toEqual([
      { kind: "success", code: "cold", state: "s9" },
      { kind: "success", code: "warm", state: "s10" },
    ]);
    launchUrls = null;
  });
});

// UI-redesign 2026-10-29 · Phase 5 hardening — the Builder workbench layout
// (preview pane, bottom panel tab/open state) persists through the durable
// write-through layer, so a reload restores the exact workbench.
describe("builder workbench persistence", () => {
  const K = {
    preview: "xr.builder.preview.visible",
    bottomTab: "xr.builder.bottom.tab",
    bottomVisible: "xr.builder.bottom.visible",
  };

  beforeEach(() => {
    storage.clear();
    useBuilderStore.setState({ previewVisible: false, terminalVisible: false, bottomTab: "terminal", bottomH: 240 });
  });

  test("togglePreview/toggleTerminal/setBottomTab write through to durable storage", () => {
    const st = useBuilderStore.getState();
    st.togglePreview(true);
    st.toggleTerminal(true);
    st.setBottomTab("tests");

    expect(storage.getItem(K.preview)).toBe("true");
    expect(storage.getItem(K.bottomVisible)).toBe("true");
    expect(storage.getItem(K.bottomTab)).toBe('"tests"');

    const s = useBuilderStore.getState();
    expect(s.previewVisible).toBe(true);
    expect(s.terminalVisible).toBe(true);
    expect(s.bottomTab).toBe("tests");
  });

  test("toggleTerminal(true) lands on the terminal tab even when another tab was active", () => {
    useBuilderStore.getState().setBottomTab("problems");
    useBuilderStore.getState().toggleTerminal(true);
    expect(useBuilderStore.getState().bottomTab).toBe("terminal");
  });

  test("resetLayout restores the default workbench and writes it through", () => {
    const st = useBuilderStore.getState();
    st.togglePreview(true);
    st.toggleTerminal(true);
    st.setBottomTab("tests");
    st.setBottomH(400);

    st.resetLayout();

    expect(storage.getItem(K.preview)).toBe("false");
    expect(storage.getItem(K.bottomTab)).toBe('"terminal"');
    expect(storage.getItem(K.bottomVisible)).toBe("false");
    expect(storage.getItem("xr.builder.panes.bottom")).toBe("240");

    const s = useBuilderStore.getState();
    expect(s.previewVisible).toBe(false);
    expect(s.terminalVisible).toBe(false);
    expect(s.bottomTab).toBe("terminal");
    expect(s.bottomH).toBe(240);
  });

  test("setBottomH clamps below the minimum panel height", () => {
    useBuilderStore.getState().setBottomH(40);
    expect(useBuilderStore.getState().bottomH).toBe(120);
  });
});
