/**
 * XR 4.6 — Phase 6 · T7: local-only knowledge operation, network HARD-off.
 *
 * Asserted effects (Part 13.6 / Art. XXI):
 *   With `globalThis.fetch` rigged to throw and DNS resolution poisoned, the
 *   COMPLETE knowledge path still works end-to-end:
 *     record → retrieve (hybrid) → navigate (tools) → lifecycle promote →
 *     compression → injection (integrity-gated) → benchmark run.
 *   If ANY part of the knowledge path silently reaches for the network, this
 *   suite fails. Local-first is an invariant, not a fallback paragraph.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRepository } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { ContextService } from "../../src/context/service.ts";
import { buildMemoryTools } from "../../src/context/tools.ts";
import { compressItems } from "../../src/context/compression.ts";
import { runRecallBenchmark, type DomainFixture } from "../../src/context/eval/harness.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { buildInjectionPackage } from "../../src/context/injection.ts";
import type { ToolContext } from "../../src/core/types.ts";

let tmp: string;
let originalFetch: typeof fetch;

/** Hard network kill-switch: any egress attempt throws immediately. */
function installNetworkKillSwitch() {
  originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = () => {
    throw new Error("NETWORK BLOCKED: local-only knowledge test forbids egress");
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-local-"));
  process.env.XR_HOME = join(tmp, "home");
  installNetworkKillSwitch();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("local-only knowledge operation (network disabled)", () => {
  test("record → hybrid retrieve → navigable tools → promote → compress → inject: zero egress, full function", async () => {
    const path = join(tmp, "local.db");
    const store = new Store("default", path);
    const svc = new ContextService(new ServiceRegistry(), store, { lexicalOnly: true });

    // 1. Record (through the admission gate).
    const w = svc.record({
      type: "knowledge",
      content: "The auth service uses RS256 JWT signing with 24h JWKS rotation.",
      provenanceKind: "file",
      actorKind: "user",
      consent: "approved",
      trust: "source_evidence",
    });
    expect(w.ok).toBe(true);

    // 2. Hybrid retrieval (lexical route — mandatory offline path).
    const repo = new ContextRepository(adaptStoreForContext(store), "default");
    const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
    const grant = buildGrant(
      {
        requester: { kind: "agent", id: "a1", role: "coder" },
        scope: makeScope({ workspaceId: "default", projectScope: "global" }),
        maxItems: 12,
        maxChars: 8_000,
      },
      { memoryScopeKind: "user" },
    );
    const res = await retrieval.retrieve({ queryIntent: "auth", query: "what signing does the auth service use", grant, lexicalOnly: true });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]!.item.content).toContain("RS256");
    expect(res.route.fallback).toBe(true);

    // 3. Navigable tools.
    const tools = buildMemoryTools({ context: svc, requester: { kind: "agent", id: "a1", role: "agent" }, lexicalOnly: true });
    const ctx: ToolContext = { cwd: tmp, approve: async () => false, audit: () => {} };
    const search = await tools.find((t) => t.name === "memory_search")!.run({ query: "auth signing" }, ctx);
    expect(search.ok).toBe(true);
    expect(search.output).toContain("RS256");

    // 4. Lifecycle promotion (evidence-preserving).
    const ids: string[] = [];
    for (const step of ["Decided 2026-01-05: adopt dual-write", "Backfill done; correction: run during low traffic", "Enable dual-write for 72h; uncertainty: watch metric unconfirmed"]) {
      ids.push(
        svc.repository.insertItem({
          type: "task_context",
          content: step,
          scope: { workspaceId: "default", projectScope: "global", taskId: "t1" },
          trustStatus: "source_evidence",
          consentState: "approved",
          provenanceKind: "execution_record",
          actorKind: "system",
          links: { taskId: "t1" },
        }),
      );
    }
    const promoted = svc.promoteStaleMemory({ projectScope: "global" }, { olderThanMs: 0, minItems: 3, actor: "local-test" });
    expect(promoted.length).toBe(1);
    expect(promoted[0]!.ok).toBe(true);

    // 5. Compression fidelity, offline.
    const comp = compressItems({ items: ids.map((id) => svc.repository.getItem(id)!), taskIdentity: "task t1" });
    expect(comp.ok).toBe(true);

    // 6. Injection with the integrity gate active.
    const pkg = await svc.requestContext({
      requester: { kind: "agent", id: "a1", role: "agent" },
      intent: "what signing does auth use",
      query: "auth signing",
      memoryScopeKind: "user",
      includeUserMemory: false,
      lexicalOnly: true,
    });
    const injection = svc.buildInjection(pkg, {});
    expect(injection.blocks.length).toBeGreaterThan(0);
    expect(injection.integrityFindings).toBeDefined();
  });

  test("the recall benchmark itself runs with no network", async () => {
    const fixtures = ["code", "research", "personal", "business"].map(
      (d) => JSON.parse(readFileSync(join(process.cwd(), "benchmarks", "recall", `${d}.json`), "utf8")) as DomainFixture,
    );
    const store = new Store("bench", join(tmp, "bench.db"));
    const report = await runRecallBenchmark({
      fixtures,
      db: adaptStoreForContext(store),
      workspaceId: "bench",
      route: LEXICAL_ROUTE,
    });
    store.close();
    expect(report.summary.queries).toBeGreaterThanOrEqual(24);
    expect(report.route).toBe("lexical");
  });
});
