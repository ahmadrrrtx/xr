/** XR 2.1A — local dashboard Skill Runtime API. */
import { SkillService } from "../services/skill-service.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function publicRecord(record: ReturnType<SkillService["listUnified"]>[number]) {
  return {
    id: record.manifest.id,
    name: record.manifest.name,
    version: record.manifest.version,
    description: record.manifest.description,
    categories: record.manifest.categories,
    tags: record.manifest.tags,
    publisher: record.manifest.publisher,
    verification: record.manifest.verification.level,
    kind: record.kind,
    source: record.source,
    enabled: record.enabled,
    installed: record.installed,
    health: record.health,
    permissions: record.manifest.permissions,
    dependencies: record.manifest.dependencies,
    commands: record.manifest.contributions.commands,
    voiceIntents: record.manifest.contributions.voiceIntents,
    workflows: record.manifest.contributions.workflows,
    errors: record.errors,
    warnings: record.warnings,
  };
}

export async function handleSkillsApi(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/skills")) return null;
  const service = new SkillService();

  if (url.pathname === "/api/skills" && req.method === "GET") {
    const q = url.searchParams.get("q")?.trim();
    const rows = q ? service.searchUnified(q, 80) : service.listUnified();
    return json({ health: service.runtimeHealth(), skills: rows.map(publicRecord) });
  }

  if (url.pathname === "/api/skills/health" && req.method === "GET") {
    return json(service.runtimeHealth());
  }

  const m = url.pathname.match(/^\/api\/skills\/([^/]+)(?:\/(enable|disable|remove|inspect|permissions|dependencies))?$/);
  if (!m) return json({ error: "unknown skills API route" }, 404);
  const id = decodeURIComponent(m[1]);
  const action = m[2] ?? "inspect";

  if (action === "inspect" && req.method === "GET") {
    const record = service.inspectUnified(id);
    if (!record) return json({ error: "skill not found" }, 404);
    return json({ skill: publicRecord(record), permissions: service.permissionReport(record.manifest.id), dependencies: service.dependencyReport(record.manifest.id) });
  }

  if (action === "permissions" && req.method === "GET") {
    const report = service.permissionReport(id);
    if (!report) return json({ error: "skill not found" }, 404);
    return json(report);
  }

  if (action === "dependencies" && req.method === "GET") {
    return json(service.dependencyReport(id));
  }

  if (action === "enable" && req.method === "POST") return json({ ok: service.enable(id) });
  if (action === "disable" && req.method === "POST") return json({ ok: service.disable(id) });
  if (action === "remove" && req.method === "DELETE") return json({ ok: service.remove(id) });

  return json({ error: "method not allowed" }, 405);
}
