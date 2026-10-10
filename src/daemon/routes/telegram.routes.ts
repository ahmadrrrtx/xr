/**
 * XR Daemon — Telegram bot routes (Phase 24).
 *
 * All routes except the webhook require the daemon token, like every other
 * /api route. The webhook is the single exception: Telegram cannot send the
 * XR token, so it is authenticated by Telegram's secret_token header instead
 * (see TelegramManager.handleWebhook). Bodies never echo the bot token.
 *
 *   GET  /api/telegram/status          → live state, pairing, settings
 *   POST /api/telegram/connect         → { token } validate with getMe, store, start
 *   POST /api/telegram/disconnect      → { confirm: true } stop, remove token and pairings
 *   POST /api/telegram/start           → start polling or webhook
 *   POST /api/telegram/stop            → stop cleanly (keeps the token)
 *   POST /api/telegram/pair/open       → open the 10-minute pairing window
 *   POST /api/telegram/pair            → { code } confirm a code shown in Telegram
 *   POST /api/telegram/unpair          → { userId } remove a paired user
 *   POST /api/telegram/settings        → rate limit, attachment cap, webhook URL, auto-start
 *   GET  /api/telegram/logs?tail=N     → redacted log tail
 *   POST /api/telegram/webhook         → Telegram update (secret header required)
 */
import { route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { TelegramManager } from "../../telegram/manager.ts";

function manager(state: DaemonState): TelegramManager | null {
  return state.telegram ?? null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

export function telegramRoutes(): DaemonRoute[] {
  return [
    route({
      id: "telegram.status",
      path: "/api/telegram/status",
      method: "GET",
      handle: async ({ json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        return json(await tg.status());
      },
    }),
    route({
      id: "telegram.connect",
      path: "/api/telegram/connect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const body = await readJson(req);
        const res = await tg.connect(typeof body.token === "string" ? body.token : "");
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, bot: res.bot, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.disconnect",
      path: "/api/telegram/disconnect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const body = await readJson(req);
        if (body.confirm !== true) return json({ ok: false, error: "confirm: true is required to disconnect" }, 400);
        await tg.disconnect();
        return json({ ok: true, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.start",
      path: "/api/telegram/start",
      method: "POST",
      handle: async ({ json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const res = await tg.start();
        if (!res.ok) return json({ ok: false, error: res.reason ?? "start failed", status: await tg.status() }, 400);
        return json({ ok: true, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.stop",
      path: "/api/telegram/stop",
      method: "POST",
      handle: async ({ json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        await tg.stop();
        return json({ ok: true, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.pair.open",
      path: "/api/telegram/pair/open",
      method: "POST",
      handle: ({ json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        return json({ ok: true, ...tg.openPairing() });
      },
    }),
    route({
      id: "telegram.pair",
      path: "/api/telegram/pair",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const body = await readJson(req);
        const code = typeof body.code === "string" ? body.code.trim() : String(body.code ?? "").trim();
        if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "Enter the 6-digit code from Telegram." }, 400);
        const res = await tg.pair(code);
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, userId: res.userId, name: res.name, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.unpair",
      path: "/api/telegram/unpair",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const body = await readJson(req);
        const userId = Number(body.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) return json({ ok: false, error: "userId is required" }, 400);
        tg.unpair(userId);
        return json({ ok: true, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.settings",
      path: "/api/telegram/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const body = await readJson(req);
        const res = await tg.updateSettings({
          rateLimitPerMin: body.rateLimitPerMin as number | undefined,
          maxAttachmentBytes: body.maxAttachmentBytes as number | undefined,
          webhookUrl: body.webhookUrl === undefined ? undefined : (body.webhookUrl as string | null),
          autoStart: body.autoStart as boolean | undefined,
        });
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, status: await tg.status() });
      },
    }),
    route({
      id: "telegram.logs",
      path: "/api/telegram/logs",
      method: "GET",
      handle: ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "telegram is not available in this daemon" }, 503);
        const tail = Number(new URL(req.url).searchParams.get("tail") ?? "50");
        return json({ lines: tg.tail(Number.isFinite(tail) ? tail : 50) });
      },
    }),
    route({
      id: "telegram.webhook",
      path: "/api/telegram/webhook",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const tg = manager(state);
        if (!tg) return json({ error: "not found" }, 404);
        const update = await req.json().catch(() => null);
        if (!update) return json({ ok: false }, 400);
        const res = await tg.handleWebhook(req.headers.get("x-telegram-bot-api-secret-token"), update);
        return res.ok ? json({ ok: true }) : json({ ok: false }, 401);
      },
    }),
  ];
}
