/**
 * XR Daemon — WhatsApp routes (Phase 26).
 *
 * Every route requires the daemon token, without exception: WhatsApp has no
 * webhook and no callback the daemon must accept unsigned. The QR stream is the
 * only streaming route here, and it is bearer-protected like the rest (the
 * desktop fetches it with the engine token).
 *
 *   GET  /api/whatsapp/status            → link, connection, contacts, settings
 *   POST /api/whatsapp/connect           → open the linked-device connection
 *   POST /api/whatsapp/disconnect        → { confirm: true } unlink and wipe creds
 *   POST /api/whatsapp/start             → same as connect (resume with creds)
 *   POST /api/whatsapp/stop              → close the socket, keep the link
 *   POST /api/whatsapp/pair              → open the QR window
 *   POST /api/whatsapp/pair/close        → close the QR window early
 *   POST /api/whatsapp/unpair            → { confirm: true } unlink and wipe creds
 *   POST /api/whatsapp/contacts/add      → { phone } allow one contact
 *   POST /api/whatsapp/contacts/remove   → { phone } revoke it
 *   POST /api/whatsapp/settings          → rate limit, cap, outbox switch, auto-start
 *   GET  /api/whatsapp/logs?tail=N       → redacted log tail (last four digits of any number)
 *   GET  /api/whatsapp/qr                → SSE: QR frames, then a terminal state
 *
 * Responses carry contact numbers because the dialog manages that list — the
 * same reasoning as Discord's pairing codes. They never carry credentials, and
 * logs/audits show last-four only.
 */
import { route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { WhatsAppManager } from "../../whatsapp/manager.ts";

function manager(state: DaemonState): WhatsAppManager | null {
  return state.whatsapp ?? null;
}

function unavailable(json: (d: unknown, s?: number) => Response): Response {
  return json({ error: "whatsapp is not available in this daemon" }, 503);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

export function whatsappRoutes(): DaemonRoute[] {
  return [
    route({
      id: "whatsapp.status",
      path: "/api/whatsapp/status",
      method: "GET",
      handle: async ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        return json(await w.status());
      },
    }),
    route({
      id: "whatsapp.connect",
      path: "/api/whatsapp/connect",
      method: "POST",
      handle: async ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const res = await w.start();
        if (!res.ok) return json({ ok: false, error: res.reason ?? "could not connect", status: await w.status() }, 400);
        return json({ ok: true, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.start",
      path: "/api/whatsapp/start",
      method: "POST",
      handle: async ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const res = await w.start();
        if (!res.ok) return json({ ok: false, error: res.reason ?? "could not start", status: await w.status() }, 400);
        return json({ ok: true, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.stop",
      path: "/api/whatsapp/stop",
      method: "POST",
      handle: async ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        await w.stop();
        return json({ ok: true, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.disconnect",
      path: "/api/whatsapp/disconnect",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const body = await readJson(req).catch((): Record<string, unknown> => ({}));
        if (body.confirm !== true) return json({ ok: false, error: "confirm: true is required to unlink this device" }, 400);
        const res = await w.unpair();
        return json({ ok: true, reason: res.reason, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.unpair",
      path: "/api/whatsapp/unpair",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const body = await readJson(req).catch((): Record<string, unknown> => ({}));
        if (body.confirm !== true) return json({ ok: false, error: "confirm: true is required to unlink this device" }, 400);
        const res = await w.unpair();
        return json({ ok: true, reason: res.reason, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.pair",
      path: "/api/whatsapp/pair",
      method: "POST",
      handle: async ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const res = await w.pair();
        if (!res.ok) return json({ ok: false, error: res.reason, status: await w.status() }, 400);
        return json({ ok: true, expiresAt: res.expiresAt, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.pair.close",
      path: "/api/whatsapp/pair/close",
      method: "POST",
      handle: ({ json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        w.closePairing();
        return json({ ok: true });
      },
    }),
    route({
      id: "whatsapp.contacts.add",
      path: "/api/whatsapp/contacts/add",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const body = await readJson(req);
        const res = w.addContact(String(body.phone ?? ""));
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, phone: res.phone, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.contacts.remove",
      path: "/api/whatsapp/contacts/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const body = await readJson(req);
        w.removeContact(String(body.phone ?? ""));
        return json({ ok: true, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.settings",
      path: "/api/whatsapp/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const body = await readJson(req);
        const res = await w.updateSettings({
          rateLimitPerMin: body.rateLimitPerMin as number | undefined,
          maxAttachmentBytes: body.maxAttachmentBytes as number | undefined,
          autoStart: body.autoStart as boolean | undefined,
          respondToOutbox: body.respondToOutbox as boolean | undefined,
        });
        if (!res.ok) return json({ ok: false, error: res.reason }, 400);
        return json({ ok: true, status: await w.status() });
      },
    }),
    route({
      id: "whatsapp.logs",
      path: "/api/whatsapp/logs",
      method: "GET",
      handle: ({ req, json, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const tail = Number(new URL(req.url).searchParams.get("tail") ?? "50");
        return json({ lines: w.tail(Number.isFinite(tail) ? tail : 50) });
      },
    }),
    route({
      id: "whatsapp.qr",
      path: "/api/whatsapp/qr",
      method: "GET",
      handle: ({ req, json, sse, state }) => {
        const w = manager(state);
        if (!w) return unavailable(json);
        const encoder = new TextEncoder();
        let close: () => void = () => {};
        const stream = new ReadableStream({
          start(controller) {
            let done = false;
            const send = (frame: unknown): void => {
              if (done) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
              } catch {
                done = true;
              }
            };
            const unsubscribe = w.qr.subscribe(send);
            // Keep-alive: SSE proxies drop idle connections.
            const ping = setInterval(() => send({ state: "ping", at: Date.now() }), 15_000);
            // The stream ends by itself when pairing is over and no terminal
            // frame was seen (a dialog that opened late still gets an answer).
            const guard = setInterval(() => {
              const terminal = w.qr.last();
              const finished = terminal?.state === "open" || terminal?.state === "timeout" || terminal?.state === "closed" || terminal?.state === "error";
              if (finished || !w.pairingOpen) end();
            }, 2000);
            const end = (): void => {
              if (done) return;
              done = true;
              clearInterval(ping);
              clearInterval(guard);
              unsubscribe();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            };
            close = end;
            req.signal?.addEventListener?.("abort", end);
          },
          cancel() {
            close();
          },
        });
        return sse(stream);
      },
    }),
  ];
}
