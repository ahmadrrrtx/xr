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

import { route, type DaemonRoute } from './router.ts';

export function businessRoutes(): DaemonRoute[] {
  return [
    route({
      id: 'business.status.get',
      path: '/api/business/status',
      method: 'GET',
      handle: async (ctx: any) => {
        const business = (ctx as any).state?.store ? null : (ctx as any).registry?.resolve?.((() => { try { const { Tokens } = require('../../core/tokens.ts'); return Tokens.Business; } catch { return null; } })());
        // Fallback: try registry from global
        const reg = (ctx as any).registry || (ctx as any).state?.registry;
        let biz: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          biz = reg?.resolve?.(Tokens.Business) ?? (ctx as any).registry?.resolve?.(Tokens.Business);
        } catch {}
        if (!biz?.operatingLayer) {
          // Try direct from ctx as earlier pattern uses registry via closure?
          try {
            const { Tokens } = await import('../../core/tokens.ts');
            biz = (ctx as any).registry?.resolve?.(Tokens.Business) ?? biz;
          } catch {}
        }
        // Simpler: use global registry if available via ctx
        const businessService = (() => {
          try {
            // @ts-ignore - dynamic resolve
            return (ctx as any).registry?.resolve ? (ctx as any).registry.resolve((globalThis as any).__XR_TOKENS__?.Business) : null;
          } catch { return null; }
        })();

        // Actually most routes use registry resolve pattern like other routes: get from state?
        // We'll attempt to get BusinessOS from registry if available
        let businessOS: any = biz ?? businessService;
        if (!businessOS) {
          // Try alternative: import Tokens and resolve via ctx.registry which is passed in DaemonRouteContext extended?
          // In current router, DaemonRouteContext doesn't have registry, but we can try state
          // For robustness, we try to find BusinessOS via global app registry if injected
          // If still null, we return degraded status with journeys list static
          const { JOURNEY_DEFINITIONS } = await import(/* @vite-ignore */ new URL('../../../extensions/business-os/src/core/journeys.ts', import.meta.url).href);
          return ctx.json({ status: { version: '5.3.0', journeys: JOURNEY_DEFINITIONS.length, activeWorkflows: 0, pendingApprovals: 0 }, journeys: JOURNEY_DEFINITIONS });
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
      handle: async (ctx) => {
        const { JOURNEY_DEFINITIONS } = await import(/* @vite-ignore */ new URL('../../../extensions/business-os/src/core/journeys.ts', import.meta.url).href);
        return ctx.json({ journeys: JOURNEY_DEFINITIONS, count: JOURNEY_DEFINITIONS.length });
      },
    }),
    route({
      id: 'business.journeys.start',
      prefix: '/api/business/journeys/',
      method: 'POST',
      handle: async (ctx: any) => {
        // Path: /api/business/journeys/:journeyId/start
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/journeys\/([^\/]+)\/start$/);
        if (!match) return null;
        const journeyId = match[1];
        let body: any = {};
        try { body = ctx.body ? await ctx.req?.json?.() ?? ctx.body : {}; } catch { body = {}; }
        if (!body || Object.keys(body).length === 0) {
          try { const txt = await ctx.req?.text?.(); body = txt ? JSON.parse(txt) : {}; } catch {}
        }
        const workspaceId = body.workspaceId ?? ctx.url.searchParams.get('workspaceId') ?? 'default';
        const orgId = body.orgId ?? ctx.url.searchParams.get('orgId') ?? 'default';
        const actorId = body.actorId ?? 'daemon-user';

        // Try to get business service via registry if present in ctx.state
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}

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
      handle: async (ctx: any) => {
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/outcomes\/([^\/]+)$/);
        if (!match) return null;
        const outcomeId = match[1];
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/approvals\/([^\/]+)\/decide$/);
        if (!match) return null;
        const approvalId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch { body = {}; }
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        // Avoid matching /disable /enable
        if (path.endsWith('/disable') || path.endsWith('/enable')) return null;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)$/);
        if (!match) return null;
        const workerId = match[1];
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)\/disable$/);
        if (!match) return null;
        const workerId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch {}
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/workers\/([^\/]+)\/enable$/);
        if (!match) return null;
        const workerId = match[1];
        let body: any = {};
        try { body = await ctx.req?.json?.(); } catch {}
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
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
      handle: async (ctx: any) => {
        const path = ctx.path as string;
        const match = path.match(/^\/api\/business\/privacy\/([^\/]+)$/);
        if (!match) return null;
        const workspaceId = match[1];
        let businessOS: any = null;
        try {
          const { Tokens } = await import('../../core/tokens.ts');
          const reg = (ctx as any).registry ?? (ctx as any).state?.registry;
          businessOS = reg?.resolve?.(Tokens.Business);
        } catch {}
        if (!businessOS?.privacy) return ctx.json({ policy: null });
        const policy = businessOS.privacy.getPolicy(workspaceId);
        return ctx.json({ policy });
      },
    }),
  ];
}
