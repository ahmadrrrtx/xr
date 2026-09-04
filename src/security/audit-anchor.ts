/**
 * XR Phase 4 (Evidence Integrity, F-08) — optional remote audit anchor.
 *
 * The local Ed25519 head signature protects against silent rewrite by an
 * attacker who has the DATABASE but not the private key. It does NOT protect
 * against an attacker who exfiltrates the key too (full host compromise). The
 * anchor raises that bar: a signed checkpoint hash is pushed OUT to a sink the
 * operator controls, so forging history now requires the private key AND
 * write access to the anchor sink.
 *
 * Design guarantees (offline-first preserved):
 *   - DISABLED by default (`audit.anchor.enabled` false) — zero network traffic
 *     without explicit operator configuration.
 *   - EGRESS-GATED: an http(s) sink must be on the operator egress allowlist;
 *     the push goes through `guardedFetch`. An un-allow-listed or refused sink
 *     is AUDITED and SKIPPED — fail-SAFE (the run continues), never fail-stop.
 *   - NOT A DEPENDENCY: local `xr audit verify --crypto` works with no anchor.
 *   - REDACTED: the payload contains only a counter, entry hash, signature and
 *     public key — never audit CONTENT.
 *   - APPEND-ONLY: the sink receives immutable checkpoint records; verification
 *     confirms each anchor matches a real signed chain entry.
 *
 * Sink kinds:
 *   - https://host/path  → guardedFetch PUT (allowlist enforced)
 *   - file:///abs/path   → append a JSON line to a local anchor log
 *   - s3://bucket/key    → treated as an HTTPS PUT to a connector URL is NOT
 *                          performed directly (no SDK dependency / credentials
 *                          in scope); such sinks require a configured HTTPS
 *                          connector. We validate and clearly refuse otherwise.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import { guardedFetch } from "./egress-proxy.ts";
import { loadConfig } from "../config/config.ts";

export interface AnchorPushResult {
  ok: boolean;
  /** "file" | "https" | "skipped" | "blocked" | "error" */
  kind: "file" | "https" | "skipped" | "blocked" | "error";
  reason?: string;
  counter?: number;
  sink?: string;
}

/** The redacted checkpoint payload sent to a sink. No audit content. */
export interface AnchorPayload {
  xr: "xr-audit-anchor-v1";
  counter: number;
  entry_hash: string;
  entry_id: number;
  sig: string;
  pubkey: string;
  anchored_at: number;
}

export function sinkKind(sink: string): "file" | "https" | "s3" | "unknown" {
  if (sink.startsWith("file://")) return "file";
  if (sink.startsWith("https://") || sink.startsWith("http://")) return "https";
  if (sink.startsWith("s3://") || sink.startsWith("s3a://")) return "s3";
  return "unknown";
}

/**
 * Build the redacted checkpoint payload from the store's current signed head.
 * Returns null if the chain isn't keyed or has no signed head yet.
 */
export function buildAnchorPayload(store: WorkspaceStore): AnchorPayload | null {
  const head = store.headForAnchor();
  if (!head) return null;
  return {
    xr: "xr-audit-anchor-v1",
    counter: head.counter,
    entry_hash: head.entry_hash,
    entry_id: head.entry_id,
    sig: head.sig,
    pubkey: head.pubkey,
    anchored_at: Date.now(),
  };
}

async function pushFile(sink: string, payload: AnchorPayload): Promise<AnchorPushResult> {
  try {
    const path = sink.slice("file://".length);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(payload) + "\n", "utf8");
    return { ok: true, kind: "file", counter: payload.counter, sink };
  } catch (e) {
    return { ok: false, kind: "error", reason: `file sink failed: ${(e as Error).message}`, sink };
  }
}

async function pushHttps(
  sink: string,
  payload: AnchorPayload,
  store: WorkspaceStore,
  config: ReturnType<typeof loadConfig>["config"],
): Promise<AnchorPushResult> {
  const allowlist = (config.security.egressAllowlist ?? []).map((h) => h.trim().toLowerCase());
  const allowedHosts = (config.security.allowedHosts ?? []).map((h) => h.trim().toLowerCase());
  let url: URL;
  try {
    url = new URL(sink);
  } catch {
    return { ok: false, kind: "error", reason: `unparseable anchor sink URL: ${sink}`, sink };
  }
  const host = url.hostname.toLowerCase();
  const withPort = url.port ? `${host}:${url.port}` : host;
  // The anchor endpoint MUST be allow-listed by the operator. Mirror the egress
  // gate's exact matching (exact host, host:port, or domain-suffix entry) so the
  // pre-check and the gate never disagree.
  const onAllowlist =
    allowedHosts.includes(host) ||
    allowedHosts.includes(withPort) ||
    // An allowedHosts entry carrying a port (e.g. 127.0.0.1:11434) also
    // authorizes that exact host for the anchor's port after the gate re-checks
    // the precise pin — match by host here, then let guardedFetch enforce the
    // exact destination (it independently re-validates host:port).
    allowedHosts.some((entry) => entry.includes(":") && entry.split(":")[0] === host) ||
    allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!onAllowlist) {
    store.audit("audit.anchor_blocked", { sink, reason: "anchor sink not on egress allowlist" });
    return { ok: false, kind: "blocked", reason: `anchor sink ${host} is not egress-allow-listed; refusing and continuing`, sink };
  }
  const res = await guardedFetch(
    sink,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    {
      allowlist,
      allowedHosts,
      audit: (event, detail) => {
        // Record the egress decision for the anchor — append-only evidence.
        try {
          store.audit(event === "egress.allowed" ? "audit.anchor_egress_allowed" : "audit.anchor_blocked", {
            url: detail.url,
            reason: detail.reason,
          });
        } catch {
          /* never let auditing break the anchor push */
        }
      },
    },
  );
  if (res.blocked) {
    return { ok: false, kind: "blocked", reason: res.reason ?? "egress gate refused the anchor", sink };
  }
  if (!res.ok) {
    return { ok: false, kind: "error", reason: `anchor sink returned ${res.status ?? "?"}`, sink };
  }
  return { ok: true, kind: "https", counter: payload.counter, sink };
}

/**
 * Push ONE signed checkpoint to the configured anchor sink. Fail-SAFE: every
 * non-success path returns a structured result and (where possible) audits the
 * refusal — it never throws into the caller and never blocks the run.
 *
 * `opts.force` anchors even if the configured interval hasn't elapsed
 * (used by the on-exit path and the explicit CLI command).
 */
export async function pushAnchor(
  store: WorkspaceStore,
  opts: { config?: ReturnType<typeof loadConfig>["config"]; force?: boolean } = {},
): Promise<AnchorPushResult> {
  const cfg = opts.config ?? loadConfig().config;
  const anchorCfg = cfg.audit?.anchor;
  if (!anchorCfg?.enabled || !anchorCfg.sink) {
    return { ok: false, kind: "skipped", reason: "anchor disabled or no sink configured" };
  }
  if (!store.auditIsKeyed) {
    return { ok: false, kind: "skipped", reason: "audit chain not keyed yet" };
  }
  const payload = buildAnchorPayload(store);
  if (!payload) {
    return { ok: false, kind: "skipped", reason: "no signed head to anchor" };
  }

  const sink = anchorCfg.sink;
  const kind = sinkKind(sink);

  let result: AnchorPushResult;
  if (kind === "file") {
    result = await pushFile(sink, payload);
  } else if (kind === "https") {
    result = await pushHttps(sink, payload, store, cfg);
  } else if (kind === "s3") {
    // No SDK/credentials in scope; an s3 sink must be fronted by an HTTPS
    // connector. Refuse honestly rather than silently dropping.
    store.audit("audit.anchor_blocked", { sink, reason: "s3 sinks require an HTTPS connector URL (no SDK in scope)" });
    result = { ok: false, kind: "blocked", reason: "s3-style sinks require an HTTPS connector; configure an https:// sink", sink };
  } else {
    result = { ok: false, kind: "error", reason: `unsupported anchor sink scheme: ${sink}`, sink };
  }

  if (result.ok) {
    store.recordAnchor({
      counter: payload.counter,
      entry_hash: payload.entry_hash,
      entry_id: payload.entry_id,
      sig: payload.sig,
      pubkey: payload.pubkey,
      sink,
    });
    try {
      store.audit("audit.anchored", { counter: payload.counter, sink, kind: result.kind });
    } catch {
      /* best-effort evidence */
    }
  }
  return result;
}
