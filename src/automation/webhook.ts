/**
 * XR — outbound webhooks. POST task results / cost / security events to any URL
 * (Slack, Discord, Notion, your own dashboard). Egress-gated like every other
 * network call — XR can't POST to an unapproved domain.
 */
import { hostAllowed } from "../tools/egress.ts";

export interface WebhookResult {
  ok: boolean;
  status?: number;
  detail?: string;
}

export async function sendWebhook(
  url: string,
  payload: Record<string, unknown>,
  egressAllowlist: string[],
  f: typeof fetch = fetch,
): Promise<WebhookResult> {
  if (egressAllowlist.length === 0 || !hostAllowed(url, egressAllowlist)) {
    return { ok: false, detail: "egress blocked: webhook host not in allow-list" };
  }
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "xr", at: new Date().toISOString(), ...payload }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
