import type { Store } from "../state/workspace-store.ts";
import { planActions } from "../control/planner.ts";
import { approvals } from "../control/approvals.ts";
import { listPermissions, grantPermission, revokePermission } from "../control/permissions.ts";
import { loadConfig } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";


export async function handleControlApi(req: Request, url: URL, store: Store): Promise<Response | null> {
  if (url.pathname === "/api/control/status" && req.method === "GET") {
    const { detectCapabilitiesAsync } = await import("../control/adapter.ts");
    return Response.json({ caps: await detectCapabilitiesAsync(), permissions: listPermissions(), pending: approvals.list() });
  }
  if (url.pathname === "/api/control/plan" && req.method === "POST") {
    const body = (await req.json().catch(()=>({}))) as { task?: string };
    const task = body.task || "";
    const { config } = loadConfig();
    const provider = buildProvider(config, {});
    const planned = await planActions(provider, task, { store });
    return Response.json(planned);
  }
  if (url.pathname === "/api/control/approve" && req.method === "POST") {
    const { id, approved } = (await req.json().catch(()=>({}))) as { id?: string; approved?: boolean };
    const ok = approvals.answer(String(id), !!approved);
    return Response.json({ ok });
  }
  if (url.pathname === "/api/control/history" && req.method === "GET") {
    const rows = (store as any).all ? (store as any).all("SELECT * FROM audit_log WHERE event LIKE 'control.%' ORDER BY ts DESC LIMIT 120") : [];
    return Response.json({ rows });
  }
  if (url.pathname === "/api/control/permissions" && req.method === "GET") {
    return Response.json({ granted: listPermissions() });
  }
  return null;
}
