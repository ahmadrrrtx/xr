/**
 * XR Daemon — Discord bot routes (Phase 26).
 *
 * Every route requires the daemon token, like all /api routes. Discord is
 * reached over the gateway (outbound WebSocket), so there is no inbound
 * webhook. Bodies never echo the bot token.
 *
 *   GET  /api/discord/status              → connection, pairing, allowed channels, invite URL
 *   POST /api/discord/connect             → { token } validate with /users/@me, store, start
 *   POST /api/discord/disconnect          → { confirm: true } stop, remove token, pairings and channels
 *   POST /api/discord/start               → start the bot with the stored token
 *   POST /api/discord/stop                → stop cleanly (keeps the token)
 *   POST /api/discord/pair/open           → { kind?: "dm" | "channel" } → one-time 6-digit code (10 min)
 *   POST /api/discord/unpair              → { userId } remove a paired user
 *   POST /api/discord/channels/remove     → { channelId } remove an allowed channel
 *   POST /api/discord/settings            → { autoStart } start with the daemon
 *   GET  /api/discord/logs?tail=N         → redacted log tail
 */
import { route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { DiscordManager } from "../../discord/manager.ts";

const UNAVAILABLE = { error: "discord is not available in this daemon" };

function manager(state: DaemonState): DiscordManager | null {
  return state.discord ?? null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

export function discordRoutes(): DaemonRoute[] {
  return [
    route({
      id: "discord.status",
      path: "/api/discord/status",
      method: "GET",
      handle: async ({ json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        return json(await dc.status());
      },
    }),
    route({
      id: "discord.connect",
      path: "/api/discord/connect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        const res = await dc.connect(typeof body.token === "string" ? body.token : "");
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, bot: res.bot, status: await dc.status() });
      },
    }),
    route({
      id: "discord.disconnect",
      path: "/api/discord/disconnect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        if (body.confirm !== true) return json({ ok: false, error: "confirm: true is required to disconnect" }, 400);
        await dc.disconnect();
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.start",
      path: "/api/discord/start",
      method: "POST",
      handle: async ({ json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const res = await dc.start();
        if (!res.ok) return json({ ok: false, error: res.reason ?? "start failed", status: await dc.status() }, 400);
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.stop",
      path: "/api/discord/stop",
      method: "POST",
      handle: async ({ json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        await dc.stop();
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.pair.open",
      path: "/api/discord/pair/open",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        const kind = body.kind === "channel" ? "channel" : "dm";
        return json({ ok: true, kind, ...dc.openPairing(kind) });
      },
    }),
    route({
      id: "discord.unpair",
      path: "/api/discord/unpair",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        const userId = typeof body.userId === "string" ? body.userId.trim() : String(body.userId ?? "").trim();
        if (!/^\d{5,25}$/.test(userId)) return json({ ok: false, error: "userId is required" }, 400);
        dc.unpair(userId);
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.channels.remove",
      path: "/api/discord/channels/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
        if (!/^\d{5,25}$/.test(channelId)) return json({ ok: false, error: "channelId is required" }, 400);
        dc.removeChannel(channelId);
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.settings",
      path: "/api/discord/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const body = await readJson(req);
        if (typeof body.autoStart !== "boolean") return json({ ok: false, error: "autoStart must be true or false" }, 400);
        dc.setAutoStart(body.autoStart);
        return json({ ok: true, status: await dc.status() });
      },
    }),
    route({
      id: "discord.logs",
      path: "/api/discord/logs",
      method: "GET",
      handle: ({ req, json, state }) => {
        const dc = manager(state);
        if (!dc) return json(UNAVAILABLE, 503);
        const tail = Number(new URL(req.url).searchParams.get("tail") ?? "50");
        return json({ lines: dc.tail(Number.isFinite(tail) ? tail : 50) });
      },
    }),
  ];
}
