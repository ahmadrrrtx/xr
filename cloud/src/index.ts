/**
 * XR Cloud — process entrypoint.
 *
 * `Bun.serve` with two responsibilities: hand HTTP to Hono, and own the relay
 * WebSocket. The second one is why this file exists at all — a Hono handler
 * cannot take ownership of a socket, so the upgrade is negotiated here and the
 * authorization decision is delegated to `authorizeRelayConnection`, which is the
 * same function the HTTP relay routes use. One authorization path, two doors.
 *
 * Shutdown is deliberately ordered: stop accepting, close sockets, drain the rate
 * limiter, close the database. A SIGTERM from an orchestrator should not leave a
 * half-written audit transaction.
 */

import { createApp } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { loadEnv } from "./env.ts";
import { EnvError } from "./env.ts";
import { validateFrame, type RelaySocketData } from "./relay/hub.ts";
import { authorizeRelayConnection } from "./routes/relay.ts";

const env = (() => {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      // Print the full list rather than the first problem. An operator fixing
      // environment variables wants to do it once.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
})();

const { deps, log, shutdown } = await bootstrap(env);
const { hono } = createApp(deps);

const server = Bun.serve<RelaySocketData>({
  port: env.PORT,
  hostname: env.HOST,
  idleTimeout: 120,

  async fetch(request, srv) {
    const url = new URL(request.url);

    if (url.pathname === "/relay/ws") {
      return await handleRelayUpgrade(request, srv, url);
    }

    // Everything else is Hono. `c.env` carries the Bun server so
    // `middleware/security.ts` can read the peer address when TRUST_PROXY is off.
    return hono.fetch(request, { server: srv });
  },

  websocket: {
    // Frames are bounded before they are parsed; see relay/hub.ts.
    maxPayloadLength: 256 * 1024,
    idleTimeout: 120,
    perMessageDeflate: false,

    /**
     * The socket only exists here — `server.upgrade()` returns before Bun has
     * created it — so this is where a peer joins the hub. `ws.data` was set at
     * upgrade time by `handleRelayUpgrade`.
     */
    open(ws) {
      deps.relay.attach({
        peerId: ws.data.peerId,
        orgId: ws.data.orgId,
        userId: ws.data.userId,
        deviceId: ws.data.deviceId,
        room: ws.data.room,
        socket: ws,
      });
      ws.send(JSON.stringify({ type: "ready", room: ws.data.room, deviceId: ws.data.deviceId }));
    },

    async message(ws, raw) {
      const peer = deps.relay.find(ws.data.peerId);
      if (!peer) {
        ws.close(1011, "unknown peer");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "bad_frame", message: "Frames must be JSON." }));
        return;
      }

      const validated = validateFrame(parsed);
      if (!validated.ok) {
        ws.send(JSON.stringify({ type: "error", code: "bad_frame", message: validated.reason }));
        return;
      }

      const delivered = deps.relay.route(peer, validated.frame);
      log.debug({ peerId: peer.id, delivered }, "relay frame routed");
    },

    close(ws) {
      deps.relay.unregister(ws.data.peerId);
    },

    drain(ws) {
      // The queue is draining; reset the counter the hub uses for backpressure.
      ws.data.queued = 0;
    },
  },
});

async function handleRelayUpgrade(
  request: Request,
  srv: Bun.Server<RelaySocketData>,
  url: URL,
): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.replace(/^Bearer\s+/i, "").trim() ?? null;
  const token = bearer ?? url.searchParams.get("token");
  const deviceId = request.headers.get("x-xr-device-id") ?? url.searchParams.get("device_id");
  const roomSecret = url.searchParams.get("room_secret");

  const result = await authorizeRelayConnection(deps, token, deviceId, roomSecret);
  if (!result.ok) {
    log.warn({ code: result.code }, "relay connection refused");
    // Refuse with a JSON body rather than an upgrade. A WebSocket client gets a
    // readable reason instead of a bare close code.
    return Response.json(
      {
        error: {
          code: result.code,
          message: result.message,
          ...(result.repair ? { repair: result.repair } : {}),
        },
      },
      { status: result.status },
    );
  }

  // The id is minted before the upgrade because Bun copies `data` into the
  // socket at this moment, and `websocket.open` is where the hub gets the socket.
  const peerId = deps.relay.newPeerId();
  const upgraded = srv.upgrade(request, {
    data: {
      peerId,
      orgId: result.orgId,
      userId: result.userId,
      deviceId: result.deviceId,
      room: result.room,
      queued: 0,
    },
  });

  if (!upgraded) {
    return Response.json(
      { error: { code: "unavailable", message: "Could not upgrade to a WebSocket." } },
      { status: 500 },
    );
  }

  return new Response(null, { status: 101 });
}

log.info({ port: server.port, host: env.HOST }, "xr-cloud listening");

let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  try {
    await server.stop(true);
    await shutdown();
  } catch (error) {
    log.error({ detail: error instanceof Error ? error.message : String(error) }, "shutdown error");
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
