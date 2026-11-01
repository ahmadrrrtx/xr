/**
 * XR-P01 — engine contract, readiness and recovery truth (desktop side).
 *
 * Store-level under bun with the DOM shim and a scripted `fetch`: every
 * readiness claim is driven by an observed probe result, exactly as the
 * runtime consumes it. No timers are awaited (elapsed time is injected),
 * no network is touched, no native surface is claimed.
 */
import { storage, setTauri } from "./helpers/dom-shim.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import {
  EngineDown,
  compareVersions,
  engineFetch,
  evaluateEngineContract,
  resetEngineLink,
  type HandshakeOutcome,
} from "../../desktop/src/engine/transport.ts";
import {
  ENGINE_BOOT_DEADLINE_MS,
  engineVersion,
  isEngineUsable,
  nextEngineState,
  useEngineStore,
} from "../../desktop/src/stores/engineStore.ts";
import {
  DIAGNOSTICS_FIELDS,
  buildEngineDiagnostics,
  collectEngineDiagnostics,
  redactDiagnosticText,
} from "../../desktop/src/engine/diagnostics.ts";

const engineInitial = useEngineStore.getState();

type FetchScript = (url: string, init?: RequestInit) => Promise<Response>;
let script: FetchScript = async () => new Response("{}", { status: 404 });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Health always answers {ok, ts}; identity comes from `meta` (200) or 401. */
function withMeta(meta: unknown, metaStatus = 200): FetchScript {
  return async (url) => {
    if (url.includes("/health")) return json({ ok: true, ts: 1 });
    if (url.includes("/meta/version")) return json(meta, metaStatus);
    return json({}); // providers/catalog loads are not under test here
  };
}

const OK_META = {
  version: "1.1.1-rc.1",
  host: "http://127.0.0.1:9",
  lan: false,
  deviceName: "XR desktop",
  contractVersion: 1,
  minDesktopVersion: "0.2.0",
  schemaVersion: 12,
  capabilities: ["health.get", "meta.version.get"],
};

beforeEach(() => {
  storage.clear();
  setTauri(false);
  resetEngineLink();
  useEngineStore.setState({ ...engineInitial }, true);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    script(String(input), init)) as typeof fetch;
});

describe("XR-P01 · evaluateEngineContract (pure negotiation)", () => {
  test("matching contract → ok, carrying observed identity", () => {
    const o = evaluateEngineContract(OK_META, "0.2.0");
    expect(o.kind).toBe("ok");
    if (o.kind === "ok") {
      expect(o.contractVersion).toBe(1);
      expect(o.engineVersion).toBe("1.1.1-rc.1");
      expect(o.schemaVersion).toBe(12);
      expect(o.capabilities).toContain("meta.version.get");
    }
  });

  test("no contractVersion field → legacy (never inferred from package version)", () => {
    const { contractVersion: _drop, ...legacy } = OK_META;
    const o = evaluateEngineContract(legacy, "0.2.0");
    expect(o.kind).toBe("legacy");
  });

  test("older / newer contract → typed incompatibilities", () => {
    const old = evaluateEngineContract({ ...OK_META, contractVersion: 0 }, "0.2.0");
    expect(old.kind).toBe("incompatible");
    if (old.kind === "incompatible") expect(old.reason).toBe("contract-too-old");
    const newer = evaluateEngineContract({ ...OK_META, contractVersion: 2 }, "0.2.0");
    expect(newer.kind).toBe("incompatible");
    if (newer.kind === "incompatible") expect(newer.reason).toBe("contract-too-new");
  });

  test("engine floor above this desktop → desktop-too-old", () => {
    const o = evaluateEngineContract({ ...OK_META, minDesktopVersion: "9.9.9" }, "0.2.0");
    expect(o.kind).toBe("incompatible");
    if (o.kind === "incompatible") expect(o.reason).toBe("desktop-too-old");
  });

  test("malformed contractVersion → missing-contract-version (fail closed)", () => {
    const o = evaluateEngineContract({ ...OK_META, contractVersion: "v1" }, "0.2.0");
    expect(o.kind).toBe("incompatible");
    if (o.kind === "incompatible") expect(o.reason).toBe("missing-contract-version");
  });

  test("compareVersions is deterministic and prerelease-insensitive", () => {
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.1.1-rc.1", "1.1.0")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("XR-P01 · nextEngineState (the single transition function)", () => {
  const okHs: HandshakeOutcome = evaluateEngineContract(OK_META, "0.2.0");
  const legacyHs: HandshakeOutcome = evaluateEngineContract(
    { version: "0.9.0" },
    "0.2.0",
  );

  test("all five states are reachable from observed inputs", () => {
    expect(nextEngineState({ outcome: "pending" }, 0, null).status).toBe("starting");
    expect(nextEngineState({ outcome: "ok" }, 0, okHs).status).toBe("ready");
    expect(nextEngineState({ outcome: "ok" }, 0, legacyHs).status).toBe("degraded");
    expect(nextEngineState({ outcome: "unreachable" }, 0, okHs).status).toBe("disconnected");
    expect(nextEngineState({ outcome: "unauthorized" }, 0, null)).toEqual({
      status: "failed",
      failureReason: "unauthorized",
    });
    expect(nextEngineState({ outcome: "incompatible" }, 0, null).failureReason).toBe("incompatible");
    expect(nextEngineState({ outcome: "crashed" }, 0, null).failureReason).toBe("crashed");
  });

  test("no ready/degraded without an observed handshake", () => {
    // A 200 from the open probe alone is only ever `starting`.
    expect(nextEngineState({ outcome: "ok" }, 0, null).status).toBe("starting");
    expect(nextEngineState({ outcome: "pending" }, 0, null).status).toBe("starting");
  });

  test("bounded boot: silent past the deadline ⇒ failed(timeout), never infinite starting", () => {
    expect(nextEngineState({ outcome: "pending" }, ENGINE_BOOT_DEADLINE_MS - 1, null).status).toBe("starting");
    expect(nextEngineState({ outcome: "pending" }, ENGINE_BOOT_DEADLINE_MS, null)).toEqual({
      status: "failed",
      failureReason: "timeout",
    });
    expect(nextEngineState({ outcome: "timeout" }, ENGINE_BOOT_DEADLINE_MS + 1, null).failureReason).toBe("timeout");
  });

  test("401 is its own failure, not a crash", () => {
    const a = nextEngineState({ outcome: "unauthorized" }, 0, null);
    const c = nextEngineState({ outcome: "crashed" }, 0, null);
    expect(a.failureReason).toBe("unauthorized");
    expect(c.failureReason).toBe("crashed");
    expect(a.failureReason).not.toBe(c.failureReason);
  });
});

describe("XR-P01 · engineStore.refresh (probe-driven)", () => {
  test("matching contract ⇒ ready; version comes from the handshake, not /health", async () => {
    script = withMeta(OK_META);
    const up = await useEngineStore.getState().refresh();
    const s = useEngineStore.getState();
    expect(up).toBe(true);
    expect(s.status).toBe("ready");
    expect(s.failureReason).toBeNull();
    expect(engineVersion()).toBe("1.1.1-rc.1");
    expect(s.health).toEqual({ ok: true, ts: 1 }); // exactly what the engine sends
  });

  test("legacy engine ⇒ degraded with an actionable message, never ready", async () => {
    const { contractVersion: _drop, ...legacy } = OK_META;
    script = withMeta(legacy);
    await useEngineStore.getState().refresh();
    const s = useEngineStore.getState();
    expect(s.status).toBe("degraded");
    expect(s.status).not.toBe("ready");
    expect(isEngineUsable(s.status)).toBe(true);
    expect(s.lastError).toContain("does not report a contract version");
    expect(s.lastError).toContain("update the engine");
  });

  test("older and newer contracts ⇒ failed(incompatible), typed detail preserved", async () => {
    script = withMeta({ ...OK_META, contractVersion: 0 });
    await useEngineStore.getState().refresh();
    let s = useEngineStore.getState();
    expect(s.status).toBe("failed");
    expect(s.failureReason).toBe("incompatible");
    expect(s.lastError).toContain("older than this desktop supports");

    resetEngineLink();
    useEngineStore.setState({ ...engineInitial }, true);
    script = withMeta({ ...OK_META, contractVersion: 99 });
    await useEngineStore.getState().refresh();
    s = useEngineStore.getState();
    expect(s.status).toBe("failed");
    expect(s.failureReason).toBe("incompatible");
    expect(s.lastError).toContain("newer than this desktop supports");
  });

  test("401 on the gated handshake ⇒ failed(unauthorized), distinct from crash/down", async () => {
    script = withMeta({ error: "unauthorized" }, 401);
    await useEngineStore.getState().refresh();
    const s = useEngineStore.getState();
    expect(s.status).toBe("failed");
    expect(s.failureReason).toBe("unauthorized");
  });

  test("unreachable: boot window stays starting, then disconnected (bounded)", async () => {
    script = async () => {
      throw new TypeError("fetch failed");
    };
    await useEngineStore.getState().refresh();
    expect(useEngineStore.getState().status).toBe("starting");
    expect(useEngineStore.getState().failures).toBe(1);
    useEngineStore.setState({
      attemptStartedAt: Date.now() - ENGINE_BOOT_DEADLINE_MS - 1,
    });
    await useEngineStore.getState().refresh();
    expect(useEngineStore.getState().status).toBe("disconnected");
  });

  test("a probe that never returns ⇒ failed(timeout) once the deadline passes", async () => {
    script = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    await useEngineStore.getState().refresh();
    expect(useEngineStore.getState().status).toBe("starting");
    useEngineStore.setState({
      attemptStartedAt: Date.now() - ENGINE_BOOT_DEADLINE_MS - 1,
    });
    await useEngineStore.getState().refresh();
    const s = useEngineStore.getState();
    expect(s.status).toBe("failed");
    expect(s.failureReason).toBe("timeout");
    // The tail field exists for the banner/diagnostics; outside Tauri it is
    // honestly empty (collectEngineDiagnostics reports the source).
    expect(Array.isArray(s.stderrTail)).toBe(true);
  });

  test("timeout is a distinct transport kind, and caller aborts stay raw", async () => {
    expect(new EngineDown("timeout").kind).toBe("timeout");
    expect(new EngineDown("timeout").message).not.toBe(new EngineDown("unreachable").message);
    script = async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json({ ok: true, ts: 1 });
    };
    const ctl = new AbortController();
    ctl.abort();
    await expect(engineFetch("/health", { signal: ctl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("XR-P01 · diagnostics bundle (allow-list + redaction specimen)", () => {
  const SPECIMEN_SECRETS = [
    "SPECIMEN_BEARER_123",
    "SPECIMEN_TOKEN_456",
    "SPECIMEN_KEY_789",
    "sk-SPECIMENSECRET0",
    "a".repeat(48), // daemon-token shape
  ];

  test("planted credentials never survive; allow-list is exact", () => {
    const out = buildEngineDiagnostics({
      generatedAt: "2026-11-02T00:00:00.000Z",
      appVersion: "0.2.0",
      engineVersion: "1.1.1-rc.1",
      contractVersion: "1",
      status: "failed",
      failureReason: "timeout",
      endpointVia: "sidecar",
      endpointPort: 49777,
      endpointReason: null,
      consecutiveFailures: 3,
      lastError: `Authorization: Bearer ${SPECIMEN_SECRETS[0]}`,
      stderrSource: "sidecar-stderr",
      stderrTail: [
        `dashboard http://127.0.0.1:49777/?token=${SPECIMEN_SECRETS[1]}`,
        `api_key=${SPECIMEN_SECRETS[2]} rejected`,
        `provider said ${SPECIMEN_SECRETS[3]} invalid`,
        `session ${SPECIMEN_SECRETS[4]} started`,
        "ordinary engine line survives verbatim",
      ],
    });
    for (const secret of SPECIMEN_SECRETS) expect(out).not.toContain(secret);
    expect(out).toContain("<redacted>");
    expect(out).toContain("ordinary engine line survives verbatim");
    expect(out).toContain("readiness: failed(timeout)");
    // The exported allow-list is the whole field universe of the bundle.
    const labels = out
      .split("\n")
      .slice(1, 12)
      .map((l) => l.split(":")[0]);
    expect(labels).toEqual([
      "generatedAt",
      "appVersion",
      "engineVersion",
      "contractVersion",
      "readiness",
      "endpointVia",
      "endpointPort",
      "endpointReason",
      "consecutiveFailures",
      "lastError",
      "stderrSource",
    ]);
    expect([...DIAGNOSTICS_FIELDS]).toContain("stderrTail");
    // Even a hostile cast-smuggled field cannot enter the construction.
    const hostile = buildEngineDiagnostics({
      generatedAt: "t",
      appVersion: "0.2.0",
      engineVersion: null,
      contractVersion: "not observed",
      status: "disconnected",
      failureReason: null,
      endpointVia: null,
      endpointPort: null,
      endpointReason: null,
      consecutiveFailures: 0,
      lastError: null,
      stderrSource: "not-available-outside-tauri",
      stderrTail: [],
      token: "SMUGGLED",
    } as never);
    expect(hostile).not.toContain("SMUGGLED");
  });

  test("redactDiagnosticText handles each credential shape", () => {
    expect(redactDiagnosticText("Bearer abc.def")).toBe("Bearer <redacted>");
    expect(redactDiagnosticText("GET /x?token=zzz HTTP")).toBe("GET /x?token=<redacted> HTTP");
    expect(redactDiagnosticText("plain line")).toBe("plain line");
  });

  test("outside Tauri the bundle says so honestly (no fake tail)", async () => {
    useEngineStore.setState({ status: "failed", failureReason: "crashed", failures: 2 });
    const out = await collectEngineDiagnostics();
    expect(out).toContain("stderrSource: not-available-outside-tauri");
    expect(out).toContain("readiness: failed(crashed)");
  });
});

