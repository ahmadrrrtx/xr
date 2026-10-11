/**
 * Local mock of the Discord REST API (v10) and gateway, for tests only.
 *
 * It records every REST call so tests can assert on what XR sent, and it can
 * push gateway dispatches (MESSAGE_CREATE, INTERACTION_CREATE) into the live
 * connection. It never leaves 127.0.0.1 and holds no real credentials.
 */
export const MOCK_BOT_ID = "1558728414045929595";
export const MOCK_APP_ID = "1558728414045929595";
export const MOCK_GUILD_ID = "2000000000000000001";

export interface MockCall {
  method: string;
  path: string;
  body: any;
  auth: string | null;
}

export interface MockDiscord {
  url: string;
  port: number;
  calls: MockCall[];
  /** Gateway IDENTIFY frames received. */
  identifies: number;
  /** Gateway sockets opened so far. */
  connections: number;
  /** Push a gateway dispatch to every connected client. */
  dispatch(t: string, d: unknown): void;
  /** Close every gateway socket with a code. */
  closeGateway(code: number): void;
  /** Return 429 once for the first request whose path matches. */
  rateLimitOnce(match: RegExp, retryAfterSec: number): void;
  stop(): void;
  reset(): void;
}

export function startMockDiscord(): MockDiscord {
  // Set after the server starts. Handlers read this instead of the server
  // object, which avoids a self-referencing initializer.
  let listenPort = 0;
  const calls: MockCall[] = [];
  const sockets = new Set<{ send(s: string): void; close(code?: number): void }>();
  let identifies = 0;
  let seq = 1;
  let msgCounter = 5000;
  let limit: { match: RegExp; retryAfter: number } | null = null;
  let connections = 0;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/gateway") {
        if (srv.upgrade(req)) return undefined;
        return new Response("upgrade required", { status: 426 });
      }
      const path = url.pathname.replace(/^\/api\/v10/, "");
      const body: any = req.method === "GET" ? null : await req.json().catch(() => null);
      const auth = req.headers.get("authorization");
      calls.push({ method: req.method, path, body, auth });

      if (limit && limit.match.test(path)) {
        const retry = limit.retryAfter;
        limit = null;
        return Response.json({ message: "You are being rate limited.", retry_after: retry, global: false }, { status: 429 });
      }

      if (req.method === "GET" && path === "/users/@me") {
        // The fake token "invalid" is the only one this mock rejects.
        if (!auth || auth === "Bot invalid") return Response.json({ message: "401: Unauthorized" }, { status: 401 });
        return Response.json({ id: MOCK_BOT_ID, username: "XR", bot: true });
      }
      if (req.method === "GET" && path === "/gateway/bot") {
        return Response.json({ url: `ws://127.0.0.1:${listenPort}/gateway`, shards: 1 });
      }
      if (req.method === "PUT" && /^\/applications\/[^/]+\/commands$/.test(path)) {
        return Response.json(body ?? []);
      }
      if (req.method === "POST" && /^\/channels\/[^/]+\/messages$/.test(path)) {
        msgCounter += 1;
        return Response.json({ id: String(msgCounter), channel_id: path.split("/")[2], content: body?.content ?? "" });
      }
      if (req.method === "PATCH" && /^\/channels\/[^/]+\/messages\/[^/]+$/.test(path)) {
        return Response.json({ id: path.split("/")[4], content: body?.content ?? "" });
      }
      if (req.method === "POST" && /^\/channels\/[^/]+\/typing$/.test(path)) {
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST" && /^\/interactions\/[^/]+\/[^/]+\/callback$/.test(path)) {
        return new Response(null, { status: 204 });
      }
      if (req.method === "PATCH" && /^\/webhooks\/[^/]+\/[^/]+\/messages\/@original$/.test(path)) {
        return Response.json({ id: "original", content: body?.content ?? "" });
      }
      if (req.method === "POST" && /^\/webhooks\/[^/]+\/[^/]+$/.test(path)) {
        msgCounter += 1;
        return Response.json({ id: String(msgCounter), content: body?.content ?? "" });
      }
      return Response.json({ message: "404: Not Found", path }, { status: 404 });
    },
    websocket: {
      open(ws) {
        connections += 1;
        sockets.add(ws as never);
        ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }));
      },
      message(ws, raw) {
        let frame: { op: number };
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (frame.op === 2) {
          identifies += 1;
          ws.send(
            JSON.stringify({
              op: 0,
              t: "READY",
              s: seq++,
              d: {
                v: 10,
                user: { id: MOCK_BOT_ID, username: "XR", bot: true },
                session_id: "session-test",
                resume_gateway_url: `ws://127.0.0.1:${listenPort}/gateway`,
                guilds: [{ id: MOCK_GUILD_ID }],
                application: { id: MOCK_APP_ID },
              },
            }),
          );
        }
        if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
      },
      close(ws) {
        sockets.delete(ws as never);
      },
    },
  });

  listenPort = server.port ?? 0;
  return {
    url: `http://127.0.0.1:${listenPort}`,
    get port() {
      return listenPort;
    },
    calls,
    get identifies() {
      return identifies;
    },
    get connections() {
      return connections;
    },
    dispatch(t, d) {
      const frame = JSON.stringify({ op: 0, t, s: seq++, d });
      for (const s of sockets) s.send(frame);
    },
    closeGateway(code) {
      for (const s of sockets) s.close(code);
    },
    rateLimitOnce(match, retryAfterSec) {
      limit = { match, retryAfter: retryAfterSec };
    },
    stop() {
      for (const s of sockets) s.close(1000);
      server.stop(true);
    },
    reset() {
      calls.length = 0;
    },
  };
}

/** Realistic DM message payload (no guild_id). */
export function dmMessage(opts: { id: string; channelId: string; userId: string; content: string }) {
  return {
    id: opts.id,
    channel_id: opts.channelId,
    content: opts.content,
    author: { id: opts.userId, username: "owner", bot: false },
    attachments: [],
  };
}

/** Realistic guild message payload. */
export function guildMessage(opts: { id: string; channelId: string; userId: string; content: string; mentions?: string[] }) {
  return {
    id: opts.id,
    channel_id: opts.channelId,
    guild_id: MOCK_GUILD_ID,
    content: opts.content,
    author: { id: opts.userId, username: "owner", bot: false },
    mentions: (opts.mentions ?? []).map((id) => ({ id, username: "XR" })),
    attachments: [],
  };
}
