/**
 * Phase 12 — shared vocabulary, slash catalog, and TUI parity gates.
 *
 * Surfaces may present these words; they must not invent a second status
 * model or advertise slash commands that have no backend.
 */
import { describe, expect, test } from "bun:test";
import {
  canonicalMode,
  modeLabel,
  streamStatusLabel,
  STREAM_STATUS_LABEL,
  summarizeToolArgs,
  isSourceTool,
  CANCELLATION_BUSY_LABEL,
  EMPTY_COPY,
  XR_IDENTITY,
} from "../../src/ui/ux-vocabulary.ts";
import { SLASH_COMMANDS, slashNamesFor, formatSlashHelp, CLI_ONLY_HINTS } from "../../src/ui/slash-catalog.ts";
import { SLASH_COMPLETE } from "../../src/interfaces/shell/slash.ts";
import { buildPaletteItems } from "../../src/interfaces/shell/palette.ts";
import { helpBindings } from "../../src/ui/primitives.ts";
import { stripAnsi } from "../../src/ui/ansi.ts";
import type { PaletteItem, ShellState } from "../../src/interfaces/shell/types.ts";

describe("Phase 12 · identity", () => {
  test("product name and tagline are XR's, never a provider's", () => {
    expect(XR_IDENTITY.name).toBe("XR");
    expect(XR_IDENTITY.tagline).toContain("Trust");
  });
});

describe("Phase 12 · modes", () => {
  test("canonicalMode maps dashboard labels onto runtime Mode", () => {
    expect(canonicalMode("Ask")).toBe("ask");
    expect(canonicalMode("PLAN")).toBe("plan");
    expect(canonicalMode("agent")).toBe("agent");
    expect(canonicalMode("Research")).toBe("ask"); // research is a flag, not a mode
    expect(canonicalMode(undefined)).toBe("ask");
  });
  test("modeLabel is title-case and matches TUI/GUI chips", () => {
    expect(modeLabel("ask")).toBe("Ask");
    expect(modeLabel("plan")).toBe("Plan");
    expect(modeLabel("agent")).toBe("Agent");
  });
});

describe("Phase 12 · stream status vocabulary", () => {
  test("never uses Loading… for a long-running turn", () => {
    for (const label of Object.values(STREAM_STATUS_LABEL)) {
      expect(label.toLowerCase()).not.toContain("loading");
    }
  });
  test("provider_selection / waiting_for_approval / cancelled are truthful", () => {
    expect(streamStatusLabel("provider_selection")).toBe("Selecting provider");
    expect(streamStatusLabel("waiting_for_approval")).toBe("Waiting for approval");
    expect(streamStatusLabel("cancelled")).toBe("Cancellation requested");
    expect(streamStatusLabel("searching_web")).toBe("Searching web");
  });
  test("cancellation copy does not claim the process has already stopped", () => {
    expect(CANCELLATION_BUSY_LABEL).toContain("waiting for checkpoint");
    expect(CANCELLATION_BUSY_LABEL.toLowerCase()).not.toContain("stopped");
  });
});

describe("Phase 12 · tool arg summary", () => {
  test("prefers path/url/query and never dumps the whole blob", () => {
    expect(summarizeToolArgs({ path: "src/daemon/routes/chat.routes.ts", extra: "x".repeat(400) }))
      .toBe("src/daemon/routes/chat.routes.ts");
    expect(summarizeToolArgs({ query: "latest bun runtime" })).toBe("latest bun runtime");
    const long = summarizeToolArgs({ blob: "y".repeat(200) }, 40);
    expect(long.length).toBeLessThanOrEqual(41);
  });
  test("source tools are classified without claiming research events on the chat contract", () => {
    expect(isSourceTool("web_search")).toBe(true);
    expect(isSourceTool("research_scrape")).toBe(true);
    expect(isSourceTool("read_file")).toBe(false);
  });
});

describe("Phase 12 · slash catalog is real-backends-only", () => {
  test("every catalog command names a backend", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.backend.length).toBeGreaterThan(3);
      expect(c.backend.toLowerCase()).not.toContain("fake");
      expect(c.backend.toLowerCase()).not.toContain("todo");
    }
  });
  test("compact is documented as CLI-engine-only, not a fake chat command", () => {
    expect(SLASH_COMMANDS.some((c) => c.name === "compact")).toBe(false);
    expect(CLI_ONLY_HINTS.some((h) => h.name === "compact")).toBe(true);
  });
  test("TUI tab-complete covers the catalog names it claims to dispatch", () => {
    const tui = slashNamesFor("tui");
    for (const name of tui) {
      expect(SLASH_COMPLETE).toContain(name);
    }
  });
  test("help text lists only catalog commands", () => {
    const help = formatSlashHelp("chat");
    expect(help).toContain("/status");
    expect(help).toContain("/model");
    expect(help).not.toContain("/sing");
  });
});

describe("Phase 12 · TUI palette is local metadata (no backend round-trip to open)", () => {
  test("palette items include interrupt, doctor, permissions, start-task", () => {
    const state = { provider: "ollama", model: "qwen2.5:7b", busy: false, overlay: "none" } as unknown as ShellState;
    const items: PaletteItem[] = buildPaletteItems(state, {
      setView: () => {},
      appendMessage: () => {},
      notify: () => {},
      runSecurityLab: async () => {},
      exportAudit: async () => {},
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("interrupt");
    expect(ids).toContain("doctor");
    expect(ids).toContain("permissions");
    expect(ids).toContain("start-task");
    expect(ids).toContain("model");
  });
});

describe("Phase 12 · empty-state copy teaches the next action", () => {
  test("empty copy is never 'No data.'", () => {
    for (const v of Object.values(EMPTY_COPY)) {
      expect(v.heading.toLowerCase()).not.toBe("no data.");
      expect(v.action.length).toBeGreaterThan(10);
    }
  });
});

describe("Phase 12 · help bindings keep Ctrl+K / Alt+P / Esc", () => {
  test("keyboard help still documents the shared shortcuts", () => {
    const body = stripAnsi(helpBindings(100).join("\n"));
    expect(body).toContain("Ctrl+K");
    expect(body).toContain("Alt+P");
    expect(body).toContain("Esc");
  });
});
