/** XR 2.1A — local dashboard Skill Runtime API (Phase 20 — Skills Store). */
import { SkillService } from "../services/skill-service.ts";
import { installJobs, type InstallEvent } from "../skills/install-jobs.ts";
import { QUARANTINE_COPY } from "../skills/quarantine.ts";
import type { SkillPermissionScope } from "../skills/schema.ts";
import { sseResponse } from "./routes/router.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

interface UnifiedRecordLike {
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    longDescription?: string;
    categories: string[];
    tags: string[];
    publisher: string;
    homepage?: string;
    repository?: string;
    icon?: string;
    permissions: Array<{ scope: string; reason: string; optional: boolean; dangerous: boolean; paths: string[]; domains: string[] }>;
    dependencies: Array<{ kind: string; id: string; version?: string; optional: boolean; reason?: string }>;
    contributions: {
      commands: unknown[];
      voiceIntents: unknown[];
      workflows: unknown[];
      slashCommands?: unknown[];
      chatActions?: unknown[];
    };
    activation: { phrases: string[]; slashCommands: string[]; auto: boolean; intents?: string[]; fileGlobs?: string[] };
    settings: Array<{ key: string; title: string; description: string; type: string; required: boolean; default?: unknown; options: string[] }>;
    verification: { level: string; checksum?: string; signature?: string; reviewedBy?: string; reviewedAt?: string };
    skillType?: string;
  };
  dir: string;
  kind: string;
  source: string;
  enabled: boolean;
  installed: boolean;
  health: string;
  errors: string[];
  warnings: string[];
  skillType: string;
}

/** One catalog scan per request (never per row) — `get()` rescans the catalog. */
type CatalogIndex = Map<string, { rating: { average: number; count: number }; downloads: number; runs: number; favorite: boolean }>;
function catalogIndex(service: SkillService): CatalogIndex {
  const out: CatalogIndex = new Map();
  for (const e of service.catalog()) {
    out.set(e.manifest.id, { rating: e.rating, downloads: e.downloads, runs: e.runs, favorite: e.favorite });
  }
  return out;
}

function publicRecord(service: SkillService, record: UnifiedRecordLike, index: CatalogIndex, withSettings = false) {
  const id = record.manifest.id;
  const entry = index.get(id);
  const installation = service.installation(id);
  const quarantine = service.quarantineInfo(id);
  const m = record.manifest;
  return {
    id,
    name: m.name,
    version: m.version,
    description: m.description,
    longDescription: m.longDescription ?? null,
    categories: m.categories,
    tags: m.tags,
    publisher: m.publisher,
    verification: m.verification.level,
    signed: Boolean(m.verification.signature),
    signingKeyId: null as string | null,
    homepage: m.homepage ?? null,
    repository: m.repository ?? null,
    kind: record.kind,
    skillType: record.skillType ?? m.skillType ?? null,
    source: record.source,
    enabled: record.enabled,
    installed: record.installed,
    health: record.health,
    permissions: m.permissions,
    dependencies: m.dependencies,
    commands: m.contributions.commands,
    slashCommands: m.contributions.slashCommands ?? [],
    voiceIntents: m.contributions.voiceIntents,
    workflows: m.contributions.workflows,
    activation: m.activation,
    settings: m.settings,
    rating: entry?.rating ?? { average: 0, count: 0 },
    downloads: entry?.downloads ?? 0,
    runs: entry?.runs ?? 0,
    favorite: entry?.favorite ?? false,
    pinned: installation?.pinned ?? false,
    grantedPermissions: installation?.grantedPermissions ?? [],
    installedAt: installation?.installedAt ?? null,
    updatedAt: installation?.updatedAt ?? null,
    sourceUrl: installation?.sourceUrl ?? null,
    quarantine,
    settingsValues: withSettings ? service.readSettings(id) : null,
    errors: record.errors,
    warnings: record.warnings,
    updateAvailable: false,
  };
}

type PublicRecord = ReturnType<typeof publicRecord>;

/** Offline fallback: first official bundled skill, deterministic (name order). */
function fallbackFeatured(rows: PublicRecord[]): string | null {
  const official = rows
    .filter((r) => r.source === "bundled" && (r.verification === "official" || r.verification === "verified"))
    .sort((a, b) => a.name.localeCompare(b.name));
  return official[0]?.id ?? rows.find((r) => r.source === "bundled")?.id ?? null;
}

function validScopes(raw: unknown): SkillPermissionScope[] {
  return Array.isArray(raw) ? raw.filter((s): s is SkillPermissionScope => typeof s === "string" && s.length > 0 && s.length <= 64) : [];
}

/**
 * Skills sub-API adapter.
 *
 * `path` is the CANONICAL route path (`/api/skills/...`) resolved by the
 * mount layer in routes/index.ts — NOT `url.pathname`, which still carries
 * the external transport prefix (`/api/v1/...`) for versioned requests.
 * Matching on `url.pathname` here is what made every `/api/v1/skills*`
 * request fall through to a 404 (Phase 02). `url` remains the source of
 * query parameters only.
 */
export async function handleSkillsApi(req: Request, url: URL, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/skills")) return null;
  const service = new SkillService();

  // ── listing ──────────────────────────────────────────────────────────────
  if (path === "/api/skills" && req.method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    const category = url.searchParams.get("category")?.trim();
    const installedOnly = url.searchParams.get("installed") === "1";
    let rows = q ? service.searchUnified(q, 80) : service.listUnified();
    if (category) rows = rows.filter((r) => r.manifest.categories.includes(category as never));
    if (installedOnly) rows = rows.filter((r) => r.installed);
    const index = catalogIndex(service);
    return json({ health: service.runtimeHealth(), skills: rows.map((r) => publicRecord(service, r as UnifiedRecordLike, index)) });
  }

  if (path === "/api/skills/pins" && req.method === "GET") {
    return json({ pins: service.pinStates() });
  }

  if (path === "/api/skills/pin" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { id?: string; pinned?: boolean };
    if (!body.id) return json({ error: "expected { id, pinned }" }, 400);
    const ok = service.pinSkill(body.id, Boolean(body.pinned));
    return json({ ok, id: body.id, pinned: Boolean(body.pinned) }, ok ? 200 : 404);
  }

  if (path === "/api/skills/health" && req.method === "GET") {
    return json(service.runtimeHealth());
  }

  if (path === "/api/skills/quarantine-copy" && req.method === "GET") {
    return json(QUARANTINE_COPY);
  }

  // ── marketplace ──────────────────────────────────────────────────────────
  if (path === "/api/skills/marketplace" && req.method === "GET") {
    const q = url.searchParams.get("q")?.trim() ?? "";
    const index = catalogIndex(service);
    const local = (q ? service.searchUnified(q, 120) : service.listUnified()).map((r) => publicRecord(service, r as UnifiedRecordLike, index));
    let online: PublicRecord[] = [];
    try {
      online = q ? service.searchOnline(q).slice(0, 60).map((row) => {
        const installed = Boolean(service.inspectUnified(row.version.id));
        const base = publicRecord(service, {
          manifest: row.version.manifest as UnifiedRecordLike["manifest"],
          dir: "",
          kind: "online-skill",
          source: row.registry.id,
          enabled: false,
          installed,
          health: "healthy",
          errors: [],
          warnings: [],
          skillType: (row.version.manifest.skillType ?? "executable") as string,
        } as UnifiedRecordLike, index);
        return {
          ...base,
          publisher: row.version.publisherId,
          verification: row.version.manifest.verification.level,
          downloads: row.version.downloads ?? 0,
          updatedAt: row.version.publishedAt,
          changelog: row.version.changelog ?? null,
          yanked: Boolean(row.version.yanked),
          registryId: row.registry.id,
          packageSha256: row.version.packageSha256 ?? null,
          signed: Boolean(row.version.signature),
          signingKeyId: row.version.signingKeyId ?? null,
        };
      }) : [];
    } catch {}
    let updates: Awaited<ReturnType<SkillService["checkUpdates"]>> = [];
    try { updates = await service.checkUpdates(); } catch {}
    const byId = new Map<string, PublicRecord & Record<string, unknown>>();
    for (const row of online) byId.set(row.id, row as PublicRecord & Record<string, unknown>);
    for (const row of local) byId.set(row.id, { ...(byId.get(row.id) ?? {}), ...row, installed: true } as PublicRecord & Record<string, unknown>);
    const updateIds = new Set(updates.map((u) => u.id));
    const skills = [...byId.values()].map((row) => ({ ...row, updateAvailable: updateIds.has(row.id) }));
    const health = service.runtimeHealth();
    const featured = new Set(service.featuredSkillIds());
    const featuredId = featured.size ? [...featured][0] : fallbackFeatured(local);
    return json({
      health,
      registries: service.listRegistries(),
      updates,
      featuredId,
      featuredSource: featured.size ? "registry" : "bundled",
      quarantineCopy: QUARANTINE_COPY,
      stats: {
        installed: skills.filter((s) => s.installed).length,
        verified: skills.filter((s) => ["official", "verified"].includes(s.verification)).length,
        updates: updates.length,
      },
      skills,
    });
  }

  if (path === "/api/skills/marketplace/sync" && req.method === "POST") {
    return json({ results: await service.syncRegistries() });
  }

  if (path === "/api/skills/marketplace/updates" && req.method === "GET") {
    return json({ updates: await service.checkUpdates() });
  }

  if (path === "/api/skills/marketplace/install" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { id?: string; registryId?: string; versionRange?: string };
    if (!body.id) return json({ error: "expected { id }" }, 400);
    return json(await service.installOnline(body.id, { registryId: body.registryId, versionRange: body.versionRange }));
  }

  // ── install jobs (Phase 20: quarantine-first, SSE progress) ─────────────
  if (path === "/api/skills/install" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      registryId?: string;
      versionRange?: string;
      fromUrl?: string;
      localPath?: string;
      quarantine?: boolean;
      grantPermissions?: string[];
      enable?: boolean;
      pin?: boolean;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id && !body.fromUrl && !body.localPath) return json({ error: "expected { id } or { fromUrl | localPath }" }, 400);
    const jobId = `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const job = installJobs.create(jobId, id || body.fromUrl || body.localPath || "unknown");
    const quarantine = body.quarantine !== false; // default ON (quarantine-first)
    const grants = validScopes(body.grantPermissions);
    // Fire and forget; the stream reports every step.
    void (async () => {
      try {
        const result = await service.installWithProgress(
          {
            id: id || (body.localPath ?? body.fromUrl ?? ""),
            registryId: body.registryId,
            versionRange: body.versionRange,
            fromUrl: body.fromUrl,
            localPath: body.localPath,
            quarantine,
            grantPermissions: grants,
            enable: body.enable ?? true,
            pin: body.pin ?? false,
          },
          (e) => job.emit({ type: "step", jobId, step: e.step, pct: e.pct, message: e.message, at: Date.now() }),
        );
        if (result.ok) {
          job.emit({ type: "done", jobId, step: "ready", pct: 100, message: "Installed.", result, at: Date.now() });
        } else {
          const error = result.errors.join("; ") || "install failed";
          job.emit({ type: "error", jobId, step: "error", pct: 100, message: error, error, result, at: Date.now() });
        }
      } catch (e) {
        const error = (e as Error).message;
        job.emit({ type: "error", jobId, step: "error", pct: 100, message: error, error, at: Date.now() });
      }
    })();
    return json({ jobId, skillId: id, quarantine, quarantineEnforced: quarantine }, 202);
  }

  {
    const streamMatch = path.match(/^\/api\/skills\/install\/([^/]+)(?:\/(stream))?$/);
    if (streamMatch && req.method === "GET") {
      const jobId = decodeURIComponent(streamMatch[1]);
      const job = installJobs.get(jobId);
      if (!job) return json({ error: "install job not found" }, 404);
      if (!streamMatch[2]) return json(installJobs.status(jobId));
      const encoder = new TextEncoder();
      let unsubscribe: (() => void) | null = null;
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: InstallEvent) => {
            if (closed) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };
          const finish = () => {
            if (closed) return;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            closed = true;
            unsubscribe?.();
            if (keepalive) clearInterval(keepalive);
            controller.close();
          };
          // Subscribe BEFORE replay (identity de-dup — same as research runs).
          const seen = new Set<InstallEvent>();
          unsubscribe = job.subscribe((e) => {
            if (seen.has(e)) return;
            seen.add(e);
            send(e);
            if (e.type === "done" || e.type === "error") finish();
          });
          for (const e of installJobs.status(jobId)?.events ?? []) {
            if (seen.has(e)) continue;
            seen.add(e);
            send(e);
          }
          if (job.done) {
            finish();
            return;
          }
          keepalive = setInterval(() => {
            if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
          }, 5000);
        },
        cancel() {
          closed = true;
          unsubscribe?.();
          if (keepalive) clearInterval(keepalive);
        },
      });
      return sseResponse(stream);
    }
  }

  if (path === "/api/skills/install-from-url" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { url?: string; localPath?: string };
    const source = (body.localPath ?? body.url ?? "").trim();
    if (!source) return json({ error: "expected { url } or { localPath }" }, 400);
    const preview = await service.previewSource(source);
    return json(preview, preview.ok ? 200 : 422);
  }

  // ── per-skill actions ────────────────────────────────────────────────────
  const m = path.match(/^\/api\/skills\/([^/]+)(?:\/(enable|disable|remove|uninstall|inspect|permissions|dependencies|promote|settings))?$/);
  if (!m) return json({ error: "unknown skills API route" }, 404);
  const id = decodeURIComponent(m[1]);
  const action = m[2] ?? "inspect";

  if (action === "inspect" && req.method === "GET") {
    const record = service.inspectUnified(id);
    if (!record) return json({ error: "skill not found" }, 404);
    return json({
      skill: publicRecord(service, record as UnifiedRecordLike, catalogIndex(service), true),
      permissions: service.permissionReport(record.manifest.id),
      dependencies: service.dependencyReport(record.manifest.id),
      quarantineCopy: QUARANTINE_COPY,
    });
  }

  if (action === "permissions" && req.method === "GET") {
    const report = service.permissionReport(id);
    if (!report) return json({ error: "skill not found" }, 404);
    return json(report);
  }

  if (action === "permissions" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { grant?: string[]; revoke?: string[] };
    const grant = validScopes(body.grant);
    const revoke = validScopes(body.revoke);
    let out: Record<string, unknown> = {};
    if (revoke.length) {
      const r = service.revokePermissions(id, revoke);
      if (!r.ok) return json({ error: r.reason ?? "revoke failed" }, 400);
      out = { ...out, revoked: revoke, granted: r.granted };
    }
    if (grant.length) {
      const r = service.grantPermissions(id, grant);
      if (!r.ok) return json({ error: r.reason ?? "grant failed" }, 400);
      out = { ...out, granted: r.granted, parkedInQuarantine: r.parked };
    }
    return json({ ok: true, ...out, report: service.permissionReport(id), quarantine: service.quarantineInfo(id) });
  }

  if (action === "promote" && req.method === "POST") {
    const result = service.promote(id);
    if (!result.ok) return json({ error: result.reason ?? "promote failed" }, 400);
    return json({ ok: true, id, promoted: result.promoted, grantedPermissions: result.grantedPermissions ?? [], quarantine: service.quarantineInfo(id) });
  }

  if (action === "settings" && req.method === "GET") {
    return json({ id, values: service.readSettings(id) });
  }

  if (action === "settings" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
    const saved = service.saveSettings(id, body.settings ?? {});
    if (!saved.ok) return json({ error: saved.reason ?? "settings rejected" }, 400);
    return json({ ok: true, id, values: saved.saved });
  }

  if (action === "dependencies" && req.method === "GET") {
    return json(service.dependencyReport(id));
  }

  if (action === "enable" && req.method === "POST") return json({ ok: service.enable(id) });
  if (action === "disable" && req.method === "POST") return json({ ok: service.disable(id) });
  if ((action === "remove" && req.method === "DELETE") || (action === "uninstall" && req.method === "POST")) {
    return json({ ok: service.remove(id), id });
  }

  return json({ error: "method not allowed" }, 405);
}
