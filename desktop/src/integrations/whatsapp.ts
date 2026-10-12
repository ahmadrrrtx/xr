/*
 * WhatsApp (Phase 26) — engine client, status hook, and the QR stream.
 *
 * The engine owns the linked-device credentials (sealed file) and the socket.
 * Nothing here ever sees a credential; the only secret-ish thing this file
 * handles is the pairing QR, which is meant to be displayed.
 *
 * Routes (src/daemon/routes/whatsapp.routes.ts), under the engine base:
 *   GET  /whatsapp/status           POST /whatsapp/connect      POST /whatsapp/start
 *   POST /whatsapp/stop             POST /whatsapp/disconnect   POST /whatsapp/unpair
 *   POST /whatsapp/pair             POST /whatsapp/pair/close   GET  /whatsapp/qr   (SSE)
 *   POST /whatsapp/contacts/add     POST /whatsapp/contacts/remove
 *   POST /whatsapp/settings         GET  /whatsapp/logs?tail=N
 *
 * The QR is a stream, not a request: WhatsApp rotates the code every ~20 s, so
 * the dialog subscribes and redraws. Frames are PNG data URLs rendered by the
 * engine, and the stream ends with a terminal state (`open`, `timeout`,
 * `closed`, `error`).
 */
import { useEffect, useState } from 'react';
import { engineFetch, engineJson, enginePost, EngineDown, EngineHttpError } from '@/engine/transport';

export type WhatsAppConnectionStatus = 'idle' | 'connecting' | 'qr' | 'open' | 'reconnecting' | 'unpaired' | 'error';

export interface WhatsAppContact {
  phone: string;
  masked: string;
  label: string | null;
}

export interface WhatsAppStatus {
  enabled: boolean;
  autoStart: boolean;
  linked: boolean;
  linkedAs: string | null;
  linkedAt: number | null;
  connection: { status: WhatsAppConnectionStatus; lastCloseCode: number | null; reason: string | null; linkedAs: string | null };
  qr: { active: boolean; expiresAt: number | null; frames: number };
  /** Full numbers: this list is the management view, drawn behind the daemon token. */
  contacts: WhatsAppContact[];
  outbox: Array<{ phone: string; masked: string }>;
  respondToOutbox: boolean;
  settings: { rateLimitPerMin: number; maxAttachmentBytes: number; selfJid: string | null };
  chats: Record<string, { model?: string; budgetUsd?: number }>;
  creds: { linked: boolean; updatedAt: number | null; keyCount: number; bytes: number };
  /** How many history payloads XR declined — proof it did not read your archive. */
  historyDropped: number;
  /** The unofficial-client disclosure, worded once by the engine. */
  notice: string;
}

export interface WhatsAppLogLine {
  at: number;
  level: string;
  line: string;
}

export class WhatsAppApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EngineHttpError) {
      const body = err.body ?? {};
      const message = typeof body.error === 'string' ? body.error : 'The engine could not complete that request.';
      throw new WhatsAppApiError(message, err.status);
    }
    throw err;
  }
}

export function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  return call(() => engineJson<WhatsAppStatus>('/whatsapp/status'));
}

export function connectWhatsApp(): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/connect', {}));
}

export function startWhatsApp(): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/start', {}));
}

export function stopWhatsApp(): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/stop', {}));
}

/** Unlink the device (this also asks WhatsApp to log out, best effort). */
export function disconnectWhatsApp(): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/disconnect', { confirm: true }));
}

export function unpairWhatsApp(): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/unpair', { confirm: true }));
}

export function openWhatsAppPairing(): Promise<{ ok: true; expiresAt: number; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; expiresAt: number; status: WhatsAppStatus }>('/whatsapp/pair', {}));
}

export function closeWhatsAppPairing(): Promise<{ ok: true }> {
  return call(() => enginePost<{ ok: true }>('/whatsapp/pair/close', {}));
}

export function addWhatsAppContact(phone: string): Promise<{ ok: true; phone: string; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; phone: string; status: WhatsAppStatus }>('/whatsapp/contacts/add', { phone }));
}

export function removeWhatsAppContact(phone: string): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/contacts/remove', { phone }));
}

export function updateWhatsAppSettings(patch: {
  rateLimitPerMin?: number;
  maxAttachmentBytes?: number;
  autoStart?: boolean;
  respondToOutbox?: boolean;
}): Promise<{ ok: true; status: WhatsAppStatus }> {
  return call(() => enginePost<{ ok: true; status: WhatsAppStatus }>('/whatsapp/settings', patch));
}

export function getWhatsAppLogs(tail = 50): Promise<{ lines: WhatsAppLogLine[] }> {
  return call(() => engineJson<{ lines: WhatsAppLogLine[] }>(`/whatsapp/logs?tail=${tail}`));
}

/** Card state for the Integrations grid, mirroring the Telegram mapping. */
export function whatsappCardStatus(status: WhatsAppStatus | null): 'connected' | 'disconnected' | 'error' {
  if (!status || !status.linked) return 'disconnected';
  if (status.connection.status === 'error') return 'error';
  return status.connection.status === 'open' ? 'connected' : 'disconnected';
}

/** Green = linked and answering, yellow = linked but not answering, red = broken. */
export function whatsappDot(status: WhatsAppStatus | null): 'green' | 'yellow' | 'red' {
  if (!status) return 'red';
  if (!status.linked || status.connection.status === 'error' || status.connection.status === 'unpaired') return 'red';
  return status.connection.status === 'open' ? 'green' : 'yellow';
}

export function useWhatsAppStatus(intervalMs = 4000): { status: WhatsAppStatus | null; error: string | null; refresh: () => void } {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () =>
      getWhatsAppStatus()
        .then((s) => {
          if (alive) {
            setStatus(s);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : 'Could not reach XR.');
        });
    void run();
    const timer = setInterval(() => void run(), intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs, tick]);
  return { status, error, refresh: () => setTick((t) => t + 1) };
}

export type QrState = 'idle' | 'streaming' | 'qr' | 'open' | 'timeout' | 'closed' | 'error';

interface QrFrame {
  state: 'qr' | 'open' | 'timeout' | 'closed' | 'error' | 'ping';
  png?: string;
  expiresAt?: number;
  reason?: string;
}

export interface QrView {
  state: QrState;
  png: string | null;
  reason: string | null;
  /** When the code currently on screen stops being valid, if the engine said. */
  expiresAt: number | null;
}

const QR_IDLE: QrView = { state: 'idle', png: null, reason: null, expiresAt: null };

/**
 * Subscribe to the engine's QR stream while `active`.
 *
 * The stream is plain SSE over the engine's authenticated fetch (not the
 * browser EventSource, which cannot send the bearer token). Every `setState`
 * happens inside the async reader — never synchronously in the effect body —
 * so a re-render is never triggered from the effect itself, and an inactive
 * hook returns `idle` without touching state at all.
 */
export function useWhatsAppQr(active: boolean): QrView {
  const [frame, setFrame] = useState<QrView | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let alive = true;

    const read = async (): Promise<void> => {
      let res: Response;
      try {
        res = await engineFetch('/whatsapp/qr', { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      } catch (e) {
        if (alive) {
          setFrame({
            state: 'error',
            png: null,
            reason: e instanceof EngineDown ? 'XR is not reachable right now.' : 'Could not open the pairing stream.',
            expiresAt: null,
          });
        }
        return;
      }
      if (!res.ok || !res.body) {
        if (alive) {
          setFrame({
            state: 'error',
            png: null,
            reason: res.status === 401 ? 'The engine refused the pairing stream.' : 'Could not open the pairing stream.',
            expiresAt: null,
          });
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Frames are separated by a blank line; each is `data: {json}`.
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let next: QrFrame;
            try {
              next = JSON.parse(line.slice(6)) as QrFrame;
            } catch {
              continue;
            }
            if (!alive || next.state === 'ping') continue;
            if (next.state === 'qr' && next.png) {
              setFrame({ state: 'qr', png: next.png, reason: null, expiresAt: next.expiresAt ?? null });
            } else if (next.state === 'open') {
              setFrame({ state: 'open', png: null, reason: null, expiresAt: null });
            } else {
              setFrame({ state: next.state, png: null, reason: next.reason ?? null, expiresAt: null });
              return;
            }
          }
        }
        if (alive) setFrame((f) => (f && (f.state === 'qr' || f.state === 'streaming') ? { ...f, state: 'closed', png: null } : f));
      } catch {
        if (alive) setFrame({ state: 'closed', png: null, reason: null, expiresAt: null });
      }
    };

    void read();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [active]);

  if (!active) return QR_IDLE;
  // Between subscribing and the first frame there is a state to show: streaming.
  return frame ?? { state: 'streaming', png: null, reason: null, expiresAt: null };
}
