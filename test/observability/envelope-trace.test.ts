/**
 * XR Phase 8 · T2 — the canonical execution envelope emits GenAI spans:
 * an `execute_tool` span per capability execution with outcome status, and
 * helpers assert nesting is on the shared trace (server → envelope → tool).
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { ExecutionService } from "../../src/execution/service.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { IN_PROCESS_PLACEMENT, okObservation, failObservation } from "../../src/execution/adapters/common.ts";
import {
  resetObservability,
  setTelemetryConfig,
  defaultTelemetryConfig,
  resetTracerState,
  resetMetrics,
  onSpanRecorded,
  startSpan,
  withSpan,
  xrMetrics,
  GENAI,
  type SpanData,
} from "../../src/observability/index.ts";

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), "xr-env-trace-"));
  const db = new Database(join(dir, "t.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s),
  });
  const service = new ExecutionService({ repo: new ExecutionRepo(wrapped) });
  return {
    service,
    destroy: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

beforeEach(async () => {
  await resetObservability();
  setTelemetryConfig(defaultTelemetryConfig());
  resetTracerState();
  resetMetrics();
});

afterEach(async () => {
  await resetObservability();
});

test("envelope execution emits execute_tool span with ok outcome + capability metric", async () => {
  const h = makeService();
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));
  try {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "secret user task — read a file", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{\\\"path\\\":\\\"/tmp/a\\\"}",
      run: async () => okObservation("done"),
    });
    expect(rec.state).toBe("succeeded");

    const span = recorded.find((s) => s.name === "execute_tool read_file");
    expect(span).toBeDefined();
    expect(span!.attributes[GENAI.TOOL_NAME]).toBe("read_file");
    expect(span!.attributes[GENAI.OPERATION_NAME]).toBe("execute_tool");
    expect(span!.status).toBe("ok");
    // Intent/task text never leaks into the span (structural only).
    expect(JSON.stringify(span!)).not.toContain("secret user task");

    const cap = (xrMetrics.capabilityExec as unknown as { snapshot: () => Array<{ labels: Record<string, string> }> }).snapshot();
    expect(cap.some((e) => e.labels.kind === "core_tool" && e.labels.outcome === "succeeded")).toBe(true);
  } finally {
    h.destroy();
  }
});

test("envelope span nests under the ambient request trace", async () => {
  const h = makeService();
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));
  try {
    const root = startSpan("POST /api/v1/x", { kind: "server" });
    await withSpan(root, async () => {
      await h.service.execute({
        workspaceId: "ws",
        actor: { kind: "user", source: "api" },
        intent: { summary: "nested", origin: { kind: "api" } as never },
        capability: { kind: "mcp_tool", name: "github.search" },
        placement: IN_PROCESS_PLACEMENT,
        idempotency: "naturally_idempotent",
        inputSummary: "{}",
        run: async () => okObservation("ok"),
      });
    });
    root.end();
    const tool = recorded.find((s) => s.name === "execute_tool github.search");
    const server = recorded.find((s) => s.name === "POST /api/v1/x");
    expect(tool!.traceId).toBe(server!.traceId);
    expect(tool!.parentSpanId).toBe(server!.spanId);
  } finally {
    h.destroy();
  }
});

test("failed execution closes the span with error status", async () => {
  const h = makeService();
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));
  try {
    const rec = await h.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "boom", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "write_file" },
      placement: IN_PROCESS_PLACEMENT,
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      run: async () => failObservation("provider refused"),
    });
    expect(rec.state).toBe("failed");
    const span = recorded.find((s) => s.name === "execute_tool write_file");
    expect(span).toBeDefined();
    expect(span!.status).toBe("error");
  } finally {
    h.destroy();
  }
});
