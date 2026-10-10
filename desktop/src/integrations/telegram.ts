/*
 * Telegram (Phase 24) — engine client and status hook. The engine owns the bot
 * token (SecretBroker) and the pairing book. The renderer sends the token once,
 * at connect time, and never gets it back: no response type here carries it.
 *
 * Routes (src/daemon/routes/telegram.routes.ts), under the engine base:
 *   GET  /telegram/status        POST /telegram/connect     POST /telegram/disconnect
 *   POST /telegram/start         POST /telegram/stop        POST /telegram/pair/open
 *   POST /telegram/pair          POST /telegram/unpair      POST /telegram/settings
 *   GET  /telegram/logs?tail=N
 */
import { useEffect, useState } from 'react';
import { engineJson, enginePost, EngineHttpError } from '@/engine/transport';

export type TelegramLabel = 'Not set up' | 'Connected' | 'Running' | 'Stopped' | 'Error';

export interface TelegramPendingPairing {
  userId: number;
  name: string;
  username: string | null;
  expiresAt: number;
}

export interface TelegramStatus {
  label: TelegramLabel;
  polling: boolean;
  mode: 'polling' | 'webhook';
  bot: { id: number; username: string; name: string } | null;
  tokenSource: 'environment' | 'keychain' | 'none';
  enabled: boolean;
  autoStart: boolean;
  pairing: { open: boolean; closesAt: number | null; pending: TelegramPendingPairing[] };
  pairedUsers: Array<{ userId: number; source: 'paired' | 'environment' }>;
  settings: { rateLimitPerMin: number; maxAttachmentBytes: number; webhookUrl: string | null };
  envOverrides: { token: boolean; allowed: boolean };
  lastError: string | null;
  startedAt: number | null;
}

export interface TelegramLogLine {
  at: number;
  level: string;
  line: string;
}

export class TelegramApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EngineHttpError) {
      const body = err.body ?? {};
      const message = typeof body.error === 'string' ? body.error : 'The engine could not complete that request.';
      throw new TelegramApiError(message, err.status);
    }
    throw err;
  }
}

export function getTelegramStatus(): Promise<TelegramStatus> {
  return call(() => engineJson<TelegramStatus>('/telegram/status'));
}

/** Validates the token with Telegram, stores it in the OS keychain, and starts the bot. */
export function connectTelegram(token: string): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/connect', { token }));
}

export function disconnectTelegram(): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/disconnect', { confirm: true }));
}

export function startTelegram(): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/start', {}));
}

export function stopTelegram(): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/stop', {}));
}

export function openTelegramPairing(): Promise<{ ok: true; closesAt: number }> {
  return call(() => enginePost<{ ok: true; closesAt: number }>('/telegram/pair/open', {}));
}

/** Confirm the 6-digit code the user read from their Telegram chat. */
export function confirmTelegramPairing(code: string): Promise<{ ok: true; name: string; userId: number; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; name: string; userId: number; status: TelegramStatus }>('/telegram/pair', { code }));
}

export function unpairTelegramUser(userId: number): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/unpair', { userId }));
}

export function updateTelegramSettings(patch: {
  rateLimitPerMin?: number;
  maxAttachmentBytes?: number;
  webhookUrl?: string | null;
  autoStart?: boolean;
}): Promise<{ ok: true; status: TelegramStatus }> {
  return call(() => enginePost<{ ok: true; status: TelegramStatus }>('/telegram/settings', patch));
}

export function getTelegramLogs(tail = 50): Promise<{ lines: TelegramLogLine[] }> {
  return call(() => engineJson<{ lines: TelegramLogLine[] }>(`/telegram/logs?tail=${tail}`));
}

/** Maps the Telegram label onto the generic card states the Integrations grid already draws. */
export function telegramCardStatus(label: TelegramLabel): 'connected' | 'disconnected' | 'error' {
  if (label === 'Connected' || label === 'Running') return 'connected';
  if (label === 'Error') return 'error';
  return 'disconnected';
}

/** Polls the status while mounted. Keeps the last good value on a transient failure. */
export function useTelegramStatus(intervalMs = 4000): { status: TelegramStatus | null; error: string | null; refresh: () => void } {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () =>
      getTelegramStatus()
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
