/**
 * XR Daemon — Discord bot routes (Phase 26).
 *
 * Every route requires the daemon token, exactly like the Telegram routes —
 * with one deliberate exception: `POST /api/discord/webhook` is authenticated
 * by Discord's Ed25519 signature (see DiscordManager.handleWebhook and
 * src/discord/verify.ts), because Discord cannot send the XR token. Gateway
 * mode, the default, never uses it.
 *
 * Responses never contain the bot token, raw gateway frames, or another
 * surface's data. Pairing codes ARE returned from `/pair/open`: the dialog has
 * to display the code the user types into Discord, and the API is local and
 * bearer-protected. They are single-use and expire with the window.
 *
 *   GET  /api/discord/status            → live state, gateway, pairing, settings
 *   POST /api/discord/connect           → { token } validate, store, start
 *   POST /api/discord/disconnect        → { confirm: true } stop, drop token + pairings
 *   POST /api/discord/start             → open the gateway
 *   POST /api/discord/stop              → close the gateway (keeps the token)
 *   POST /api/discord/pair/open         → mint a code for the dialog
 *   POST /api/discord/pair/close        → close the pairing window
 *   POST /api/discord/unpair            → { userId } remove a paired user
 *   GET  /api/discord/guilds            → servers the bot is in (channel picker)
 *   GET  /api/discord/channels?guildId= → text channels in one server
 *   POST /api/discord/channels/add      → { guildId, channelId } allow a channel
 *   POST /api/discord/channels/remove   → { guildId, channelId } remove it again
 *   POST /api/discord/settings          → rate limit, caps, webhook, dev guild, auto-start
 *   GET  /api/discord/logs?tail=N       → redacted log tail
 *   POST /api/discord/webhook           → signed interaction (no bearer token)
 */
import { route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { DiscordManager } from "../../discord/manager.ts";

function manager(state: DaemonState): DiscordManager | null {
  return state.discord ?? null;
}

function unavailable(json: (d: unknown, s?: number) => Response): Response {
  return json({ error: "discord is not available in this daemon" }, 503);
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
        const d = manager(state);
        if (!d) return unavailable(json);
        return json(await d.status());
      },
    }),
    route({
      id: "discord.connect",
      path: "/api/discord/connect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        const res = await d.connect(typeof body.token === "string" ? body.token : "");
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, bot: res.bot, inviteUrl: res.inviteUrl, status: await d.status() });
      },
    }),
    route({
      id: "discord.disconnect",
      path: "/api/discord/disconnect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        if (body.confirm !== true) return json({ ok: false, error: "confirm: true is required to disconnect" }, 400);
        await d.disconnect();
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.start",
      path: "/api/discord/start",
      method: "POST",
      handle: async ({ json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const res = await d.start();
        if (!res.ok) return json({ ok: false, error: res.reason ?? "start failed", status: await d.status() }, 400);
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.stop",
      path: "/api/discord/stop",
      method: "POST",
      handle: async ({ json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        await d.stop();
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.pair.open",
      path: "/api/discord/pair/open",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req).catch((): Record<string, unknown> => ({}));
        const kind = body.kind === "channel" ? "channel" : "user";
        const opened = d.openPairing(kind);
        return json({ ok: true, ...opened });
      },
    }),
    route({
      id: "discord.pair.close",
      path: "/api/discord/pair/close",
      method: "POST",
      handle: ({ json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        d.closePairing();
        return json({ ok: true });
      },
    }),
    route({
      id: "discord.unpair",
      path: "/api/discord/unpair",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        const userId = String(body.userId ?? "").trim();
        if (!/^\d{5,25}$/.test(userId)) return json({ ok: false, error: "userId is required" }, 400);
        d.unpair(userId);
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.guilds",
      path: "/api/discord/guilds",
      method: "GET",
      handle: async ({ json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        try {
          return json({ guilds: await d.listGuilds() });
        } catch (err) {
          return json({ ok: false, error: (err as Error).message }, 400);
        }
      },
    }),
    route({
      id: "discord.channels",
      path: "/api/discord/channels",
      method: "GET",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const guildId = new URL(req.url).searchParams.get("guildId") ?? "";
        if (!/^\d{5,25}$/.test(guildId)) return json({ ok: false, error: "guildId is required" }, 400);
        try {
          const channels = await d.listChannels(guildId);
          return json({ channels: channels.map((c) => ({ id: c.id, name: c.name ?? c.id })) });
        } catch (err) {
          return json({ ok: false, error: (err as Error).message }, 400);
        }
      },
    }),
    route({
      id: "discord.channels.add",
      path: "/api/discord/channels/add",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        const res = d.addChannel({ guildId: String(body.guildId ?? ""), channelId: String(body.channelId ?? "") });
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.channels.remove",
      path: "/api/discord/channels/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        d.removeChannel({ guildId: String(body.guildId ?? ""), channelId: String(body.channelId ?? "") });
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.settings",
      path: "/api/discord/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const body = await readJson(req);
        const res = await d.updateSettings({
          rateLimitPerMin: body.rateLimitPerMin as number | undefined,
          maxAttachmentBytes: body.maxAttachmentBytes as number | undefined,
          autoStart: body.autoStart as boolean | undefined,
          webhookUrl: body.webhookUrl === undefined ? undefined : (body.webhookUrl as string | null),
          devGuildId: body.devGuildId === undefined ? undefined : (body.devGuildId as string | null),
        });
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, status: await d.status() });
      },
    }),
    route({
      id: "discord.logs",
      path: "/api/discord/logs",
      method: "GET",
      handle: ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return unavailable(json);
        const tail = Number(new URL(req.url).searchParams.get("tail") ?? "50");
        return json({ lines: d.tail(Number.isFinite(tail) ? tail : 50) });
      },
    }),
    route({
      id: "discord.webhook",
      path: "/api/discord/webhook",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const d = manager(state);
        if (!d) return json({ error: "not found" }, 404);
        const raw = await req.text().catch(() => "");
        if (!raw) return json({ error: "empty body" }, 400);
        const res = await d.handleWebhook(
          { signature: req.headers.get("x-signature-ed25519"), timestamp: req.headers.get("x-signature-timestamp") },
          raw,
        );
        return json(res.body, res.status);
      },
    }),
  ];
}
