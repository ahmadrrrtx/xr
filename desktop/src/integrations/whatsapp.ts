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
import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface QrFrame {
  state: Exclude<QrState, 'idle' | 'streaming'> | 'ping';
  png?: string;
  expiresAt?: number;
  reason?: string;
}

/**
 * Subscribe to the engine's QR stream while `active`.
 *
 * The stream is plain SSE over the engine's authenticated fetch (not the
 * browser EventSource, which cannot send the bearer token). Reconnects are the
 * caller's business: the dialog opens it when it mints a code and closes it
 * when the link succeeds or the user walks away.
 */
export function useWhatsAppQr(active: boolean): {
  state: QrState;
  png: string | null;
  reason: string | null;
  frames: number;
} {
  const [state, setState] = useState<QrState>('idle');
  const [png, setPng] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const frames = useRef(0);

  const reset = useCallback(() => {
    setPng(null);
    setReason(null);
    frames.current = 0;
  }, []);

  useEffect(() => {
    if (!active) {
      setState('idle');
      reset();
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setState('streaming');

    const run = async (): Promise<void> => {
      let res: Response;
      try {
        res = await engineFetch('/whatsapp/qr', { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
      } catch (e) {
        if (alive) {
          setState('error');
          setReason(e instanceof EngineDown ? 'XR is not reachable right now.' : 'Could not open the pairing stream.');
        }
        return;
      }
      if (!res.ok || !res.body) {
        if (alive) {
          setState('error');
          setReason(res.status === 401 ? 'The engine refused the pairing stream.' : 'Could not open the pairing stream.');
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
            let frame: QrFrame;
            try {
              frame = JSON.parse(line.slice(6)) as QrFrame;
            } catch {
              continue;
            }
            if (!alive) return;
            if (frame.state === 'ping') continue;
            frames.current += 1;
            if (frame.state === 'qr' && frame.png) {
              setPng(frame.png);
              setState('qr');
            } else if (frame.state === 'open') {
              setPng(null);
              setState('open');
            } else if (frame.state === 'timeout' || frame.state === 'closed' || frame.state === 'error') {
              setPng(null);
              setState(frame.state);
              setReason(frame.reason ?? null);
              return;
            }
          }
        }
        if (alive) setState((s) => (s === 'qr' || s === 'streaming' ? 'closed' : s));
      } catch {
        if (alive) setState('closed');
      }
    };

    void run();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [active, reset]);

  return { state, png, reason, frames: frames.current };
}
