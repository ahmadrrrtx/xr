/*
 * Discord (Phase 26) — engine client and status hook.
 *
 * The engine owns the bot token (SecretBroker), the gateway and the pairing
 * book. The renderer sends the token once, at connect time, and never gets it
 * back: no response type here carries it.
 *
 * Routes (src/daemon/routes/discord.routes.ts), under the engine base:
 *   GET  /discord/status            POST /discord/connect      POST /discord/disconnect
 *   POST /discord/start             POST /discord/stop         POST /discord/pair/open
 *   POST /discord/pair/close        POST /discord/unpair       GET  /discord/guilds
 *   GET  /discord/channels          POST /discord/channels/add POST /discord/channels/remove
 *   POST /discord/settings          GET  /discord/logs?tail=N
 */
import { useEffect, useState } from 'react';
import { engineJson, enginePost, EngineHttpError } from '@/engine/transport';

export type DiscordConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';

export interface DiscordGuild {
  id: string;
  name: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
}

export interface DiscordStatus {
  label: string;
  enabled: boolean;
  autoStart: boolean;
  bot: { id: string; name: string; username?: string } | null;
  tokenSource: 'environment' | 'keychain' | 'none';
  /** Gateway + webhook facts; `mode` is which one is in use. */
  connection: { mode: 'gateway' | 'webhook'; status: DiscordConnectionStatus; detail: string | null };
  inviteUrl: string | null;
  pairing: { open: boolean; closesAt: number | null; codes: Array<{ kind: 'user' | 'channel'; code: string; expiresAt: number }> };
  pairedUsers: Array<{ userId: string; label: string | null; source: 'paired' | 'environment' }>;
  allowedChannels: Array<{ guildId: string; channelId: string; label: string | null }>;
  settings: {
    rateLimitPerMin: number;
    maxAttachmentBytes: number;
    webhookUrl: string | null;
    devGuildId: string | null;
  };
  /** The privileged intent the user must switch on in the Developer Portal. */
  intents: { messageContent: boolean; required: string[] };
  lastError: string | null;
  startedAt: number | null;
  /** Anything the engine wants the dialog to say in plain words. */
  notice?: string;
}

export interface DiscordLogLine {
  at: number;
  level: string;
  line: string;
}

export class DiscordApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EngineHttpError) {
      const body = err.body ?? {};
      const message = typeof body.error === 'string' ? body.error : 'The engine could not complete that request.';
      throw new DiscordApiError(message, err.status);
    }
    throw err;
  }
}

export function getDiscordStatus(): Promise<DiscordStatus> {
  return call(() => engineJson<DiscordStatus>('/discord/status'));
}

/** Validates the token with Discord, stores it in the OS keychain, and connects. */
export function connectDiscord(token: string): Promise<{ ok: true; status: DiscordStatus; inviteUrl: string | null }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus; inviteUrl: string | null }>('/discord/connect', { token }));
}

export function disconnectDiscord(): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/disconnect', { confirm: true }));
}

export function startDiscord(): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/start', {}));
}

export function stopDiscord(): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/stop', {}));
}

/** Mint a 6-digit code: `kind: 'user'` → `/xr pair`, `'channel'` → `/xr pairchannel`. */
export function openDiscordPairing(kind: 'user' | 'channel' = 'user'): Promise<{ ok: true; code: string | null; expiresAt: number; closesAt: number }> {
  return call(() => enginePost<{ ok: true; code: string | null; expiresAt: number; closesAt: number }>('/discord/pair/open', { kind }));
}

export function closeDiscordPairing(): Promise<{ ok: true }> {
  return call(() => enginePost<{ ok: true }>('/discord/pair/close', {}));
}

export function unpairDiscordUser(userId: string): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/unpair', { userId }));
}

export function listDiscordGuilds(): Promise<{ guilds: DiscordGuild[] }> {
  return call(() => engineJson<{ guilds: DiscordGuild[] }>('/discord/guilds'));
}

export function listDiscordChannels(guildId: string): Promise<{ channels: DiscordChannel[] }> {
  return call(() => engineJson<{ channels: DiscordChannel[] }>(`/discord/channels?guildId=${encodeURIComponent(guildId)}`));
}

export function addDiscordChannel(guildId: string, channelId: string): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/channels/add', { guildId, channelId }));
}

export function removeDiscordChannel(guildId: string, channelId: string): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/channels/remove', { guildId, channelId }));
}

export function updateDiscordSettings(patch: {
  rateLimitPerMin?: number;
  maxAttachmentBytes?: number;
  webhookUrl?: string | null;
  devGuildId?: string | null;
  autoStart?: boolean;
}): Promise<{ ok: true; status: DiscordStatus }> {
  return call(() => enginePost<{ ok: true; status: DiscordStatus }>('/discord/settings', patch));
}

export function getDiscordLogs(tail = 50): Promise<{ lines: DiscordLogLine[] }> {
  return call(() => engineJson<{ lines: DiscordLogLine[] }>(`/discord/logs?tail=${tail}`));
}

/**
 * Maps the engine's connection facts onto the card states the Integrations grid
 * already draws — the same mapping Telegram uses (see core.ts deriveCardState).
 */
export function discordCardStatus(status: DiscordStatus | null): 'connected' | 'disconnected' | 'error' {
  if (!status || status.tokenSource === 'none') return 'disconnected';
  if (status.connection.status === 'error') return 'error';
  if (status.connection.status === 'connected' || status.enabled) return 'connected';
  return 'disconnected';
}

/**
 * The status dot the Integrations screen draws. Green = answering, yellow =
 * configured but not answering, red = the engine reported a failure.
 */
export function discordDot(status: DiscordStatus | null): 'green' | 'yellow' | 'red' {
  if (!status || status.tokenSource === 'none') return 'red';
  if (status.connection.status === 'error') return 'red';
  if (status.connection.status === 'connected') return 'green';
  return 'yellow';
}

/** Polls the status while mounted. Keeps the last good value on a transient failure. */
export function useDiscordStatus(intervalMs = 4000): { status: DiscordStatus | null; error: string | null; refresh: () => void } {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () =>
      getDiscordStatus()
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
