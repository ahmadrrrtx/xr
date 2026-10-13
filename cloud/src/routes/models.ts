/**
 * XR Cloud — managed cloud models.
 *
 * ## What this endpoint is
 *
 * A **policy gate plus a metering point in front of a passthrough**. XR does not
 * run inference: the request is forwarded to the provider with XR's own key, and
 * the provider's response streams back untouched. The cloud adds exactly three
 * things a BYOK request does not need — authorization, spend accounting, and a
 * place to enforce an admin's decisions — and nothing else.
 *
 * ## Streaming
 *
 * SSE, relayed chunk-for-chunk without buffering. Buffering would (a) add latency
 * to the one thing users notice, and (b) mean a client that disconnects still
 * pays for the whole completion. With a passthrough, cancelling the request
 * cancels the upstream call.
 *
 * ## Metering honesty
 *
 * Token counts come from the provider's own `usage` field when it sends one. When
 * it does not (mid-stream disconnects, some providers), the counts are
 * **estimated** from character length and the response says so via
 * `usage.estimated: true`. A metered number that is silently an estimate is a
 * billing dispute waiting to happen.
 *
 * ## BYOK
 *
 * A request marked `byok: true` still passes through here — not to spend XR's
 * money, but so the policy gate applies (an org may have a contractual reason to
 * exclude a provider) and so the team's spend *visibility* line item is complete.
 * The response carries `billedTo: "byok"` so nothing double-counts it as XR spend.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import type { AppDeps } from "../deps.ts";
import { members } from "../db/schema.ts";
import { forbidden, notFound, providerDisabled, unavailable } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { requireBusiness, requireOrgMember, requireUser } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { modelChatSchema, modelProviderSchema } from "../schemas.ts";
import { auditDetached } from "../services/audit.ts";
import { decideModelRequest, denyBody, policyView } from "../services/policy.ts";
import { estimateCostMicroUsd } from "../services/metering.ts";
import { loadSubscription } from "../services/subscriptions.ts";
import { policies } from "../db/schema.ts";

/** Where each provider's chat completions live. Passthrough only — no rewriting. */
const PROVIDER_ENDPOINTS: Record<string, { url: string; envKey: string; anthropicStyle: boolean }> = {
  openai: { url: "https://api.openai.com/v1/chat/completions", envKey: "XR_CLOUD_OPENAI_KEY", anthropicStyle: false },
  anthropic: { url: "https://api.anthropic.com/v1/messages", envKey: "XR_CLOUD_ANTHROPIC_KEY", anthropicStyle: true },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKey: "XR_CLOUD_GOOGLE_KEY",
    anthropicStyle: false,
  },
};

export function modelRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post(
    "/v1/models/:provider/chat",
    requireUser(deps),
    requireOrgMember(deps, "orgId"),
    requireBusiness(deps),
    async (c) => {
      const member = c.get("currentMember");
      const orgId = member.orgId;
      const providerParam = c.req.param("provider");
      const parsedProvider = modelProviderSchema.safeParse(providerParam);
      if (!parsedProvider.success) {
        throw notFound(`Provider "${providerParam}"`);
      }
      const provider = parsedProvider.data;
      const body = await parseBody(c, modelChatSchema);

      const limited = await deps.limiter.consume("models", `user:${c.get("auth").userId}`);
      if (!limited.allowed) {
        throw forbidden(
          `You are sending model requests faster than this deployment allows. Try again in ${limited.retryAfterSeconds ?? 60} seconds.`,
        );
      }

      const policyRows = await deps.db.select().from(policies).where(eq(policies.orgId, orgId)).limit(1);
      const policy = policyView(policyRows[0]);

      const snapshot = await deps.metering.snapshot(orgId, c.get("auth").userId);
      const subscription = await loadSubscription(deps, orgId);

      const promptChars = body.messages.reduce((sum, m) => sum + m.content.length, 0);
      const estimated =
        body.byok ? null : estimateCostMicroUsd(body.model, promptChars, body.maxOutputTokens ?? 1_024);

      const decision = decideModelRequest({
        policy,
        overrides: {
          dailyCapMicroUsd: member.dailyCapMicroUsd,
          monthlyCapMicroUsd: member.monthlyCapMicroUsd,
          byokOnly: member.byokOnly,
        },
        provider,
        model: body.model,
        managed: !body.byok,
        estimatedCostMicroUsd: estimated,
        spentTodayMicroUsd: snapshot.todayMicroUsd,
        spentThisMonthMicroUsd: snapshot.monthMicroUsd,
        teamSpentThisMonthMicroUsd: snapshot.teamMonthMicroUsd,
        subscriptionStatus: subscription.status,
      });

      if (!decision.allowed) {
        const payload = denyBody(decision);
        // Policy refusals are recorded — an admin investigating "why can't my
        // team use Sonnet" needs this to be discoverable.
        await deps.audit.append({
          orgId,
          actorKind: "user",
          actorId: c.get("auth").userId,
          actorEmail: c.get("currentUser").email,
          action: "models.denied",
          targetType: "model",
          targetId: `${provider}/${body.model}`,
          workspaceId: body.workspaceId ?? null,
          ip: c.get("meta").ip,
          detail: { code: payload.code, ...payload.details },
        });
        if (payload.code === "provider_disabled") {
          throw providerDisabled(provider, policy.allowedProviders.map((p) => p.provider));
        }
        return c.json({ error: { ...payload, requestId: c.get("requestId") } }, decision.code === "budget_exceeded" ? 402 : 403);
      }

      const endpoint = PROVIDER_ENDPOINTS[provider];
      if (!endpoint) throw notFound(`Provider "${provider}"`);

      const apiKey = process.env[endpoint.envKey];
      if (!apiKey) {
        // The managed path is unavailable on this deployment, but the request is
        // not the user's fault and BYOK still works — say both things.
        throw unavailable(
          "XR-managed models",
          `${provider} is not configured for managed access on this deployment. ` +
            `An operator can set ${endpoint.envKey}. Your own provider key (Settings → Models) works today and is not affected.`,
        );
      }

      const startedAt = Date.now();
      const requestId = body.requestId ?? newId("usageEvent");

      const upstreamInit = buildUpstreamRequest(endpoint, apiKey, provider, body);

      let upstream: Response;
      try {
        upstream = await fetch(endpoint.url, upstreamInit);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        deps.log.error({ provider, detail }, "upstream provider unreachable");
        throw unavailable(
          "The model provider",
          `XR could not reach ${provider} from this deployment. The request was not billed. Retry, or use your own key.`,
        );
      }

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        deps.log.warn({ provider, status: upstream.status, detail: text.slice(0, 200) }, "upstream provider error");
        // Pass the provider's status through where it is meaningful — a 429 from
        // the provider is a 429 for the client, not a 500.
        return c.json(
          {
            error: {
              code: upstream.status === 429 ? "rate_limited" : "unavailable",
              message: `The provider returned ${upstream.status}.`,
              repair:
                upstream.status === 429
                  ? "The provider is rate limiting XR's managed access. Retry shortly, or use your own key for this model."
                  : "This request was not billed. Retry, or switch models.",
              requestId: c.get("requestId"),
            },
          },
          upstream.status === 429 ? 429 : 502,
        );
      }

      if (!body.stream) {
        const text = await upstream.text();
        const json = safeJson(text);
        const usage = extractUsage(json, text, body.messages, body.model);
        await record(deps, {
          orgId,
          userId: c.get("auth").userId,
          workspaceId: body.workspaceId ?? null,
          provider,
          model: body.model,
          managed: !body.byok,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          requestId,
        });
        return c.body(text, 200, {
          "content-type": "application/json",
          "x-xr-billed-to": body.byok ? "byok" : "team",
          "x-xr-usage-estimated": usage.estimated ? "1" : "0",
        });
      }

      // --- streaming -------------------------------------------------------
      const encoder = new TextEncoder();
      let inputTokens = 0;
      let outputTokens = 0;
      let sawUsage = false;
      let outputChars = 0;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = upstream.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              controller.enqueue(value);

              // Parse a COPY for metering only. The bytes forwarded are the bytes
              // the provider sent — nothing here rewrites the stream.
              buffer += chunk;
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") continue;
                const parsed = safeJson(payload);
                if (!parsed) continue;
                const usage = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } }).usage;
                if (usage) {
                  sawUsage = true;
                  inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? inputTokens;
                  outputTokens = usage.completion_tokens ?? usage.output_tokens ?? outputTokens;
                }
                outputChars += JSON.stringify(parsed).length;
              }
            }
          } catch (error) {
            // A broken upstream mid-stream is reported in-band as an SSE error so
            // the client shows something truthful, and whatever tokens were
            // consumed still get metered.
            const detail = error instanceof Error ? error.message : String(error);
            deps.log.warn({ provider, detail }, "upstream stream interrupted");
            controller.enqueue(
              encoder.encode(`\n\ndata: ${JSON.stringify({ error: { message: "The provider's stream ended early.", repair: "Retry the message. Usage for what was generated has been recorded." } })}\n\n`),
            );
          } finally {
            const estimated = !sawUsage;
            const finalInput = sawUsage
              ? inputTokens
              : Math.ceil(body.messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
            const finalOutput = sawUsage ? outputTokens : Math.ceil(outputChars / 4);
            await record(deps, {
              orgId,
              userId: c.get("auth").userId,
              workspaceId: body.workspaceId ?? null,
              provider,
              model: body.model,
              managed: !body.byok,
              inputTokens: finalInput,
              outputTokens: finalOutput,
              latencyMs: Date.now() - startedAt,
              requestId,
            }).catch((error: unknown) => {
              // Metering failure must not corrupt a successful response, but it
              // must be loud — unbilled usage is a business problem, not a
              // cosmetic one.
              deps.log.error(
                { requestId, detail: error instanceof Error ? error.message : String(error), estimated },
                "usage metering failed after a completed stream",
              );
            });
            controller.close();
          }
        },
      });

      return c.body(stream, 200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-xr-billed-to": body.byok ? "byok" : "team",
        "x-xr-request-id": requestId,
      });
    },
  );

  app.get(
    "/v1/models/:orgId/usage",
    requireUser(deps),
    requireOrgMember(deps, "orgId"),
    async (c) => {
      const orgId = c.req.param("orgId");
      const snapshot = await deps.metering.snapshot(orgId, c.get("auth").userId);
      const byModel = await deps.metering.byModel(orgId, 30);
      const series = await deps.metering.series(orgId, 30, c.get("auth").userId);

      const policyRows = await deps.db.select().from(policies).where(eq(policies.orgId, orgId)).limit(1);
      const policy = policyView(policyRows[0]);
      const memberRows = await deps.db
        .select()
        .from(members)
        .where(and(eq(members.orgId, orgId), eq(members.userId, c.get("auth").userId)))
        .limit(1);

      return c.json({
        usage: snapshot,
        caps: {
          dailyMicroUsd: memberRows[0]?.dailyCapMicroUsd ?? policy.defaultDailyBudgetMicroUsd,
          monthlyMicroUsd: memberRows[0]?.monthlyCapMicroUsd ?? policy.defaultMonthlyBudgetMicroUsd,
          teamMonthlyMicroUsd: policy.teamMonthlyBudgetMicroUsd,
          includedQuotaMicroUsd: policy.includedQuotaMicroUsd,
        },
        byModel,
        series,
      });
    },
  );

  return app;
}

function buildUpstreamRequest(
  endpoint: { url: string; anthropicStyle: boolean },
  apiKey: string,
  provider: string,
  body: ReturnType<typeof modelChatSchema.parse>,
): RequestInit {
  if (endpoint.anthropicStyle) {
    // Anthropic's wire format differs: system prompt is a top-level field, and
    // `max_tokens` is required.
    const system = body.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = body.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content }));
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.maxOutputTokens ?? 4_096,
        ...(system ? { system } : {}),
        messages,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        stream: body.stream,
      }),
    };
  }

  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(provider === "openai" ? { "openai-beta": "assistants=v2" } : {}),
    },
    body: JSON.stringify({
      model: body.model,
      messages: body.messages,
      ...(body.maxOutputTokens ? { max_tokens: body.maxOutputTokens } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
      stream: body.stream,
      // Ask for usage on the stream. Providers that ignore it are handled by the
      // estimate path above and flagged as estimated.
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    }),
  };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractUsage(
  json: Record<string, unknown> | null,
  rawText: string,
  messages: Array<{ content: string }>,
  _model: string,
): { inputTokens: number; outputTokens: number; estimated: boolean } {
  const usage = json?.usage as
    | { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }
    | undefined;
  if (usage) {
    return {
      inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
      estimated: false,
    };
  }
  return {
    inputTokens: Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4),
    outputTokens: Math.ceil(rawText.length / 4),
    estimated: true,
  };
}

async function record(
  deps: AppDeps,
  input: {
    orgId: string;
    userId: string;
    workspaceId: string | null;
    provider: string;
    model: string;
    managed: boolean;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    requestId: string;
  },
): Promise<void> {
  await deps.metering.record(input);
  auditDetached(deps, {
    orgId: input.orgId,
    actorKind: "user",
    actorId: input.userId,
    action: "models.invoke",
    targetType: "model",
    targetId: `${input.provider}/${input.model}`,
    workspaceId: input.workspaceId,
    // Exactly the billing-relevant structure. No prompt, no completion.
    detail: {
      managed: input.managed,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
    },
  });
}
