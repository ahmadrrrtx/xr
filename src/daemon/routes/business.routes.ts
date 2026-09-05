/**
 * XR 5.3 — Business Operating Layer — Daemon Routes
 * Provides outcome-centered views:
 * - work queues
 * - active workflows
 * - AI worker status
 * - approvals/escalations
 * - records changed
 * - evidence/artifacts
 * - cost/time
 * - failures/recovery
 * - audit/provenance
 *
 * No Phase 11 cloud control plane.
 */

import { route, type DaemonRoute, type DaemonRouteContext } from './router.ts';
import type { BusinessOsView } from '../../core/business-l0.ts';

/**
 * Business-service resolution (A-6 seam — one narrowing point, one comment).
 *
 * The daemon serve path (`makeHandler` in server.ts) does NOT braid the kernel
 * service registry into DaemonState, so in the standalone dashboard these
 * routes resolve to null and answer with honest 503/empty payloads — the same
 * behavior as before this tightening. A host process that attaches a registry
 * (embedded serve, tests) is honored, checked on the context first, then on
 * state — the carriers the previous scattered `as any` sites consulted.
 */
async function resolveBusinessOS(ctx: DaemonRouteContext): Promise<BusinessOsView | null> {
  let token: unknown;
  try {
    const { Tokens } = await import('../../core/tokens.ts');
    token = Tokens.Business;
  } catch {
    return null;
  }
  const carriers: Array<{ registry?: { resolve?: (t: unknown) => unknown } | null } | null | undefined> = [
    ctx as unknown as { registry?: { resolve?: (t: unknown) => unknown } | null },
    ctx.state as { registry?: { resolve?: (t: unknown) => unknown } | null },
  ];
  for (const carrier of carriers) {
    try {
      const resolved = carrier?.registry?.resolve?.(token);
      if (resolved) return resolved as BusinessOsView;
    } catch { /* try the next carrier */ }
  }
  return null;
}

/**
 * Journey catalogue resolution (Phase 5 · ADR-0028).
 *
 * Until Phase 5 these routes imported the journey definitions *directly from
 * the extension source tree* at request time. That was a genuine runtime edge
 * from core into an extracted package hiding behind a dynamic import: once the
 * extension left the repo, GET /api/business/journeys would have thrown a
 * module-not-found 500 instead of the honest empty answer the rest of this
 * file is careful to give.
 *
 * The catalogue is now read from the extension when it is actually loaded and
 * answers an empty list when it is not — the same degraded-but-honest contract
 * every other route here already honours. An empty catalogue with count 0
 * truthfully says "no journeys are installed", which is exactly the state of a
 * core-only install (Cmdt 2 — never report an effect that did not happen).
 */
interface JourneyCatalogue { readonly id?: string; readonly name?: string }

async function resolveJourneys(ctx: DaemonRouteContext): Promise<JourneyCatalogue[]> {
  const businessOS = await resolveBusinessOS(ctx);
  if (!businessOS) return [];
  const holder = businessOS as unknown as { journeys?: { list?: () => JourneyCatalogue[] } };
  try {
    const list = holder.journeys?.list?.();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function businessRoutes(): DaemonRoute[] {
  return [
    route({
      id: 'business.status.get',
      path: '/api/business/status',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS) {
          // Extension not served in this process: degraded-but-honest status.
          // Core ships no journey catalogue of its own (ADR-0028), so the
          // honest answer is an empty one rather than a 500.
          return ctx.json({ status: { version: '5.3.0', journeys: 0, activeWorkflows: 0, pendingApprovals: 0, extension: 'not-installed' }, journeys: [] });
        }

        const orgId = (ctx.url.searchParams.get('orgId') ?? 'default');
        const workspaceId = (ctx.url.searchParams.get('workspaceId') ?? 'default');
        try {
          const view = businessOS.operatingLayer.getWorkspaceView(workspaceId, orgId);
          return ctx.json(view);
        } catch (e) {
          return ctx.json({ error: (e as Error).message }, 500);
        }
      },
    }),
    route({
      id: 'business.journeys.list',
      path: '/api/business/journeys',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const journeys = await resolveJourneys(ctx);
        return ctx.json({ journeys, count: journeys.length });
      },
    }),
    route({
      id: 'business.journeys.start',
      prefix: '/api/business/journeys/',
      method: 'POST',
      handle: async (ctx: DaemonRouteContext) => {
        // Path: /api/business/journeys/:journeyId/start
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/journeys\/([^\/]+)\/start$/);
        if (!match) return null;
        const journeyId = match[1];
        let body: any = {};
        try { body = await ctx.req.json(); } catch { body = {}; }
        if (!body || Object.keys(body).length === 0) {
          try { const txt = await ctx.req?.text?.(); body = txt ? JSON.parse(txt) : {}; } catch {}
        }
        const workspaceId = body.workspaceId ?? ctx.url.searchParams.get('workspaceId') ?? 'default';
        const orgId = body.orgId ?? ctx.url.searchParams.get('orgId') ?? 'default';
        const actorId = body.actorId ?? 'daemon-user';

        // Try to get business service via registry if present in ctx.state
        const businessOS = await resolveBusinessOS(ctx);

        if (!businessOS?.operatingLayer) {
          return ctx.json({ error: 'Business OS not initialized or journey execution requires workspace context', journeyId, workspaceId }, 503);
        }

        try {
          const result = await businessOS.operatingLayer.startJourney({ journeyId, workspaceId, orgId, actorId, input: body.input });
          return ctx.json(result, 201);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('approval')) {
            return ctx.json({ error: msg, requiresApproval: true }, 202);
          }
          return ctx.json({ error: msg }, 400);
        }
      },
    }),
    route({
      id: 'business.outcomes.list',
      path: '/api/business/outcomes',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.outcomes) {
          return ctx.json({ outcomes: [], stats: { total: 0, verified: 0, failed: 0, pending: 0 } });
        }
        const workspaceId = ctx.url.searchParams.get('workspaceId') ?? 'default';
        const outcomes = businessOS.outcomes.listByWorkspace(workspaceId, { limit: 50 });
        const stats = businessOS.outcomes.getStats(workspaceId);
        return ctx.json({ outcomes, stats });
      },
    }),
    route({
      id: 'business.outcomes.get',
      prefix: '/api/business/outcomes/',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/outcomes\/([^\/]+)$/);
        if (!match) return null;
        const outcomeId = match[1];
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.operatingLayer) return ctx.json({ error: 'Business OS not initialized' }, 503);
        const view = businessOS.operatingLayer.getOutcomeView(outcomeId);
        if (!view) return ctx.json({ error: 'Outcome not found' }, 404);
        return ctx.json(view);
      },
    }),
    route({
      id: 'business.approvals.list',
      path: '/api/business/approvals',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.approvals) return ctx.json({ pending: [], workQueue: { pendingApprovals: 0, pendingReviews: 0, criticalCount: 0, grouped: {} } });
        const workspaceId = ctx.url.searchParams.get('workspaceId') ?? 'default';
        const pending = businessOS.approvals.listPending(workspaceId, { limit: 100 });
        const workQueue = businessOS.approvals.getWorkQueue(workspaceId);
        return ctx.json({ pending, workQueue });
      },
    }),
    route({
      id: 'business.approvals.decide',
      prefix: '/api/business/approvals/',
      method: 'POST',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/approvals\/([^\/]+)\/decide$/);
        if (!match) return null;
        const approvalId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch { body = {}; }
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.approvals) return ctx.json({ error: 'Business OS not initialized' }, 503);
        try {
          const result = businessOS.approvals.decide(approvalId, {
            decidedBy: body.decidedBy ?? 'admin',
            outcome: body.outcome ?? 'approved',
            comment: body.comment,
          });
          return ctx.json(result);
        } catch (e) {
          return ctx.json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: 'business.artifacts.list',
      path: '/api/business/artifacts',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.artifacts) return ctx.json({ artifacts: [], count: 0 });
        const workspaceId = ctx.url.searchParams.get('workspaceId') ?? 'default';
        const artifacts = businessOS.artifacts.listByWorkspace(workspaceId, { limit: 50 });
        return ctx.json({ artifacts, count: artifacts.length });
      },
    }),
    route({
      id: 'business.workers.list',
      path: '/api/business/workers',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.workerGovernance) return ctx.json({ workers: [], inspections: [] });
        const workspaceId = ctx.url.searchParams.get('workspaceId') ?? 'default';
        const workers = businessOS.workerGovernance.listByWorkspace(workspaceId);
        const inspections = workers.map((w: any) => businessOS.workerGovernance.inspect(w.workerId)).filter(Boolean);
        return ctx.json({ workers, inspections });
      },
    }),
    route({
      id: 'business.workers.get',
      prefix: '/api/business/workers/',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        // Avoid matching /disable /enable
        if (path.endsWith('/disable') || path.endsWith('/enable')) return null;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)$/);
        if (!match) return null;
        const workerId = match[1];
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.workerGovernance) return ctx.json({ error: 'Business OS not initialized' }, 503);
        const inspection = businessOS.workerGovernance.inspect(workerId);
        if (!inspection) return ctx.json({ error: 'Worker not found' }, 404);
        return ctx.json(inspection);
      },
    }),
    route({
      id: 'business.workers.disable',
      prefix: '/api/business/workers/',
      method: 'POST',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)\/disable$/);
        if (!match) return null;
        const workerId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch {}
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.workerGovernance) return ctx.json({ error: 'Business OS not initialized' }, 503);
        try {
          const result = businessOS.workerGovernance.setEnabled(workerId, false, { actorId: body.actorId ?? 'admin', reason: body.reason ?? 'disabled via API' });
          return ctx.json(result);
        } catch (e) {
          return ctx.json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: 'business.workers.enable',
      prefix: '/api/business/workers/',
      method: 'POST',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)\/enable$/);
        if (!match) return null;
        const workerId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch {}
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.workerGovernance) return ctx.json({ error: 'Business OS not initialized' }, 503);
        try {
          const result = businessOS.workerGovernance.setEnabled(workerId, true, { actorId: body.actorId ?? 'admin' });
          return ctx.json(result);
        } catch (e) {
          return ctx.json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: 'business.mutations.list',
      path: '/api/business/mutations',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.recordMutations) return ctx.json({ mutations: [], count: 0 });
        const workspaceId = ctx.url.searchParams.get('workspaceId') ?? 'default';
        const mutations = businessOS.recordMutations.listByWorkspace(workspaceId, { limit: 50 });
        return ctx.json({ mutations, count: mutations.length });
      },
    }),
    route({
      id: 'business.privacy.get',
      prefix: '/api/business/privacy/',
      method: 'GET',
      handle: async (ctx: DaemonRouteContext) => {
        const path = ctx.path;
        const match = path.match(/^\/api\/business\/privacy\/([^\/]+)$/);
        if (!match) return null;
        const workspaceId = match[1];
        const businessOS = await resolveBusinessOS(ctx);
        if (!businessOS?.privacy) return ctx.json({ policy: null });
        const policy = businessOS.privacy.getPolicy(workspaceId);
        return ctx.json({ policy });
      },
    }),
  ];
}
