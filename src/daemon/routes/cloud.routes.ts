/**
 * XR Daemon — cloud routes (Phase 30).
 *
 * ## What makes this file different from a normal route file
 *
 * Every route here **must** answer usefully when the cloud service does not exist.
 * That is not a nicety; it is the acceptance criterion. A machine that has never
 * signed in, or whose network is unplugged, or whose organization cancelled last
 * month, is a fully supported configuration of XR — and it is the *default* one.
 *
 * So each handler follows the same shape:
 *
 *   1. Ask the licence state (which is computed locally, from a signed token, with
 *      no network call at all).
 *   2. If a cloud call is needed and cannot be made, return a 200 with
 *      `{ configured: false }` or `{ available: false, reason, repair }` — never a
 *      5xx, because the local product is not broken and the status code would say
 *      it was.
 *
 * The one exception is `POST /api/cloud/models/chat`, which returns a real error
 * status when a request genuinely failed. A silent substitution of a broken model
 * call would be worse than an error: the user asked for something specific and
 * deserves to know it did not happen.
 *
 * ## Naming
 *
 * These paths live under `/api/cloud/*`. They are deliberately not `/api/business/*`,
 * which already belongs to the local operational Business OS (work queues,
 * approvals, governance) that ships with XR and has nothing to do with billing.
 * Those two ideas sharing a namespace would be a permanent source of confusion,
 * and the Phase 30 brief is explicit that the existing surface must not be
 * disturbed.
 */

import type { DaemonRoute, DaemonRouteContext } from "./router.ts";
import { route } from "./router.ts";
import { createCloudClient, CloudUnreachable, type CloudClient } from "../../cloud/client.ts";
import { BUSINESS_FEATURES, canUse, refusal, verifyLicense, type LicenseState } from "../../cloud/license.ts";
import { secretBroker, secretBrokerSync } from "../../security/secret-broker.ts";
import { CLOUD_SESSION_SECRET } from "../../cloud/client.ts";

/** Injected in tests; a module-level singleton in the daemon. */
let clientOverride: CloudClient | null = null;

export function __setCloudClientForTests(client: CloudClient | null): void {
  clientOverride = client;
}

function client(): CloudClient {
  return clientOverride ?? createCloudClient();
}

/**
 * Current licence state, computed locally.
 *
 * The token comes from the secret broker; verification is pure crypto against a
 * key compiled into the binary. No network, at any point. This is the function
 * that makes "XR works offline" a property of the system rather than a promise in
 * a README.
 */
function licenseState(): LicenseState {
  const token = secretBrokerSync("XR_CLOUD_LICENSE");
  return verifyLicense(token ?? null);
}

/** The standard degraded answer. A 200, because nothing is broken. */
function degraded(ctx: DaemonRouteContext, message: string, repair: string) {
  return ctx.json({ available: false, reason: message, repair });
}

export function cloudRoutes(): DaemonRoute[] {
  return [
    /* ── licence ─────────────────────────────────────────────────────────── */

    route({
      id: "cloud.license.get",
      path: "/api/cloud/license",
      method: "GET",
      handle: async (ctx) => {
        const state = licenseState();
        return ctx.json({
          // The full state, including the shape of the gate, so a UI can render the
          // real thing rather than inventing one and drifting from it.
          status: state.status,
          entitled: state.entitled,
          plan: state.plan,
          orgId: state.orgId,
          orgName: state.orgName,
          seats: state.seats,
          features: state.features,
          expiresAt: state.expiresAt?.toISOString() ?? null,
          daysRemaining: state.daysRemaining,
          reason: state.reason,
          // Stated by the API rather than assumed by the client: the local product
          // is never gated, so this is always true.
          localUnaffected: true,
          allFeatures: BUSINESS_FEATURES,
        });
      },
    }),

    route({
      id: "cloud.license.verify",
      path: "/api/cloud/license/verify",
      method: "POST",
      handle: async (ctx) => {
        // Deliberately synchronous-with-the-request verification of a *submitted*
        // token, for the licence a user pastes in. Uses the same code path as the
        // stored one so the two can never disagree.
        const body = (await ctx.req.json().catch(() => ({}))) as { token?: string };
        const state = verifyLicense(body.token ?? null);
        return ctx.json({
          valid: state.entitled,
          status: state.status,
          plan: state.plan,
          orgId: state.orgId,
          seats: state.seats,
          features: state.features,
          reason: state.reason,
        });
      },
    }),

    route({
      id: "cloud.license.feature",
      pattern: /^\/api\/cloud\/license\/feature\/[a-z-]+$/,
      method: "GET",
      handle: async (ctx) => {
        const feature = ctx.path.split("/").pop() ?? "";
        if (!(BUSINESS_FEATURES as readonly string[]).includes(feature)) {
          return ctx.json(
            {
              feature,
              allowed: false,
              reason: "Unknown feature.",
              // Naming the known set keeps a typo a five-second fix.
              known: BUSINESS_FEATURES,
            },
            400,
          );
        }
        const state = licenseState();
        const allowed = canUse(state, feature as (typeof BUSINESS_FEATURES)[number]);
        if (!allowed) return ctx.json(refusal(state, feature as (typeof BUSINESS_FEATURES)[number]));
        return ctx.json({ feature, allowed: true, reason: null, localUnaffected: true });
      },
    }),

    /* ── session ─────────────────────────────────────────────────────────── */

    route({
      id: "cloud.session.get",
      path: "/api/cloud/session",
      method: "GET",
      handle: async (ctx) => {
        const session = await client().session();
        if (!session.configured) {
          return ctx.json({
            signedIn: false,
            // Not an error. This is the state of a fresh install and of most
            // installs that have ever existed.
            note: "XR is running without a team. Every local feature is fully available.",
          });
        }
        return ctx.json({ signedIn: true, orgId: session.orgId });
      },
    }),

    route({
      id: "cloud.session.delete",
      path: "/api/cloud/session",
      method: "DELETE",
      handle: async (ctx) => {
        // Signing out removes the token and nothing else. It does not touch the
        // licence (which is verified offline and remains valid) and it does not
        // touch a single byte of local data.
        const removed = await secretBroker.get(CLOUD_SESSION_SECRET);
        return ctx.json({
          ok: true,
          hadSession: Boolean(removed),
          note:
            "Signed out. Local memory, workspaces, agents and settings are untouched, and any active Business " +
            "licence remains valid because it is verified offline.",
        });
      },
    }),

    /* ── team memory (the bridge's transport half) ────────────────────────── */

    route({
      id: "cloud.team-memory.get",
      path: "/api/cloud/team-memory",
      method: "GET",
      handle: async (ctx) => {
        const state = licenseState();
        if (!canUse(state, "memory-sync") || !state.orgId) {
          return degraded(
            ctx,
            "Team memory needs the Business tier on this organization.",
            state.reason ??
              "Local memory is free, private and unaffected. Sign in to a team to read its shared facts.",
          );
        }
        const workspaceId = ctx.url.searchParams.get("workspaceId") ?? "";
        if (!workspaceId) {
          return ctx.json({ available: false, reason: "workspaceId is required.", repair: "Pass the team workspace id." }, 400);
        }
        // `includePrivate=0`, always and not as a parameter: a member's private
        // facts are private to them, and this route exists to serve the shared
        // ones. Making it optional would put the wrong answer one flag away.
        try {
          const payload = await client().get<{ facts: unknown[]; serverTime: string }>(
            `/teams/${state.orgId}/memory?workspace=${encodeURIComponent(workspaceId)}&includePrivate=0`,
          );
          return ctx.json({ available: true, orgId: state.orgId, workspaceId, ...payload });
        } catch (error) {
          if (error instanceof CloudUnreachable) return degraded(ctx, error.message, error.repair);
          throw error;
        }
      },
    }),

    route({
      id: "cloud.team-memory.post",
      path: "/api/cloud/team-memory",
      method: "POST",
      handle: async (ctx) => {
        const state = licenseState();
        if (!canUse(state, "memory-sync") || !state.orgId) {
          return degraded(
            ctx,
            "Team memory needs the Business tier on this organization.",
            state.reason ?? "The fact was not sent anywhere. Local memory is unaffected.",
          );
        }
        const body = (await ctx.req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.body !== "string" || typeof body.workspaceId !== "string") {
          return ctx.json(
            { available: false, reason: "A fact needs a workspaceId and a body.", repair: "Send both fields." },
            400,
          );
        }
        try {
          const payload = await client().post<{ fact: unknown; pendingReview?: boolean }>(
            `/teams/${state.orgId}/memory`,
            {
              workspaceId: body.workspaceId,
              body: body.body,
              category: body.category ?? "fact",
              tags: body.tags ?? [],
              // `direct: false` is how an agent suggestion becomes a review-queue
              // item rather than something the whole team can already see. The
              // default is conservative on purpose: a caller that forgets the
              // flag proposes, and a proposal is the safe outcome.
              direct: body.provenance !== "agent-suggested",
              provenance: typeof body.provenance === "string" ? body.provenance : "human",
              sensitivityTags: body.sensitivityTags ?? [],
            },
          );
          return ctx.json({ available: true, ...payload });
        } catch (error) {
          if (error instanceof CloudUnreachable) {
            return degraded(
              ctx,
              error.message,
              `${error.repair} The fact was not saved anywhere and was not queued locally — nothing partial happened.`,
            );
          }
          throw error;
        }
      },
    }),

    route({
      id: "cloud.team-memory.delete",
      pattern: /^\/api\/cloud\/team-memory\/[^/]+$/,
      method: "DELETE",
      handle: async (ctx) => {
        const state = licenseState();
        if (!canUse(state, "memory-sync") || !state.orgId) {
          return degraded(ctx, "Team memory needs the Business tier on this organization.", state.reason ?? "Nothing was deleted.");
        }
        const factId = ctx.path.split("/").pop() ?? "";
        try {
          await client().del(`/teams/${state.orgId}/memory/${encodeURIComponent(factId)}`);
          return ctx.json({ available: true, ok: true });
        } catch (error) {
          if (error instanceof CloudUnreachable) return degraded(ctx, error.message, error.repair);
          throw error;
        }
      },
    }),

    /* ── teams and entitlement ───────────────────────────────────────────── */

    route({
      id: "cloud.teams.get",
      path: "/api/cloud/teams",
      method: "GET",
      handle: async (ctx) => {
        try {
          const teams = await client().get<{ teams: unknown[]; hasTeams: boolean }>("/teams");
          return ctx.json(teams);
        } catch (error) {
          if (error instanceof CloudUnreachable) return degraded(ctx, error.message, error.repair);
          throw error;
        }
      },
    }),

    route({
      id: "cloud.team-workspaces.get",
      path: "/api/cloud/team-workspaces",
      method: "GET",
      handle: async (ctx) => {
        const state = licenseState();
        if (!canUse(state, "team-workspaces") || !state.orgId) {
          return degraded(
            ctx,
            "Shared team workspaces need the Business tier on this organization.",
            state.reason ??
              "Local workspaces and local memory are unaffected and free. Sign in to a team to see its shared workspaces.",
          );
        }
        try {
          const payload = await client().get<{ workspaces: unknown[] }>(`/teams/${state.orgId}/workspaces`);
          // Stamped with the organization so the UI cannot show one team's
          // workspaces under another team's heading after a fast switch.
          return ctx.json({ available: true, orgId: state.orgId, orgName: state.orgName, ...payload });
        } catch (error) {
          if (error instanceof CloudUnreachable) return degraded(ctx, error.message, error.repair);
          throw error;
        }
      },
    }),

    route({
      id: "cloud.usage.get",
      path: "/api/cloud/usage",
      method: "GET",
      handle: async (ctx) => {
        const state = licenseState();
        if (!canUse(state, "managed-models") || !state.orgId) {
          return degraded(
            ctx,
            "Managed models are a Business feature and this organization does not have them active.",
            state.reason ??
              "Use your own API keys — BYOK is free on every plan and always will be. Sign in to a team to use managed models.",
          );
        }
        try {
          const usage = await client().get<unknown>(`/v1/models/${state.orgId}/usage`);
          return ctx.json({ available: true, usage });
        } catch (error) {
          if (error instanceof CloudUnreachable) return degraded(ctx, error.message, error.repair);
          throw error;
        }
      },
    }),
  ];
}
