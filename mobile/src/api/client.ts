import type {
  Approval,
  Budget,
  ChatMessage,
  ChatSummary,
  DaemonMeta,
  ModelInfo,
} from '../types';

/**
 * Daemon API client.
 *
 * Every call is same-origin with `credentials: 'include'`. There is no bearer
 * token in localStorage anywhere in this app — auth rides in the HttpOnly,
 * Secure, SameSite session cookie the daemon sets at pairing time.
 *
 * The only origins this app ever contacts are:
 *   1. the user's own daemon (same origin as the page), and
 *   2. the browser's push service, driven by the Web Push API itself.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 401 with a revoked/expired session — the app must return to pairing. */
  get unpaired(): boolean {
    return this.status === 401;
  }

  /** 403 from the mobile endpoint gate — surfaced as "not available on mobile". */
  get blocked(): boolean {
    return this.status === 403;
  }
}

export interface StreamEvent {
  type: 'token' | 'tool' | 'done' | 'error' | 'meta';
  text?: string | undefined;
  name?: string | undefined;
  message?: string | undefined;
  messageId?: string | undefined;
}

const BASE = '';

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (cause) {
    // Network down / wrong WiFi / daemon asleep.
    throw new ApiError(0, 'offline', 'offline');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = undefined;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>)['error'])
        : res.statusText || 'Request failed';
    throw new ApiError(res.status, detail);
  }
  return payload as T;
}

/* ------------------------------------------------------------------- meta --- */

export const api = {
  meta: (): Promise<DaemonMeta> => request<DaemonMeta>('/api/meta/version'),

  certFingerprint: (): Promise<{ fingerprint: string }> =>
    request<{ fingerprint: string }>('/api/mobile/cert-fingerprint'),

  models: (): Promise<{ models: ModelInfo[] }> =>
    request<{ models: ModelInfo[] }>('/api/v1/models'),

  budget: (): Promise<Budget> => request<Budget>('/api/v1/budget'),

  /* --------------------------------------------------------------- chats --- */

  chats: (limit = 50): Promise<{ chats: ChatSummary[] }> =>
    request<{ chats: ChatSummary[] }>(`/api/v1/chats?limit=${limit}`),

  messages: (chatId: string, limit = 200): Promise<{ messages: ChatMessage[] }> =>
    request<{ messages: ChatMessage[] }>(
      `/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`,
    ),

  newChat: (title?: string): Promise<{ id: string; title: string }> =>
    request<{ id: string; title: string }>('/api/v1/chats', { method: 'POST', json: { title } }),

  /* ----------------------------------------------------------- approvals --- */

  approvals: (status: 'pending' | 'resolved' | 'all' = 'pending'): Promise<{ approvals: Approval[] }> =>
    request<{ approvals: Approval[] }>(`/api/v1/approvals?status=${status}`),

  approval: (id: string): Promise<Approval> =>
    request<Approval>(`/api/v1/approvals/${encodeURIComponent(id)}`),

  decide: (id: string, decision: 'approve' | 'deny'): Promise<{ ok: true }> =>
    request<{ ok: true }>(`/api/v1/approvals/${encodeURIComponent(id)}`, {
      method: 'POST',
      json: { decision },
    }),

  /* --------------------------------------------------------------- voice --- */

  transcribe: async (blob: Blob, mime: string): Promise<{ transcript: string }> => {
    const form = new FormData();
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', blob, `voice.${ext}`);
    return request<{ transcript: string }>('/api/v1/voice/transcribe', {
      method: 'POST',
      body: form,
    });
  },

  /* ---------------------------------------------------------------- push --- */

  vapidKey: (): Promise<{ publicKey: string }> =>
    request<{ publicKey: string }>('/api/mobile/push/vapid-pubkey'),

  pushSubscribe: (subscription: unknown, pushKey: string): Promise<{ ok: true }> =>
    request<{ ok: true }>('/api/mobile/push/subscribe', {
      method: 'POST',
      json: { subscription, pushKey },
    }),

  pushUnsubscribe: (): Promise<{ ok: true }> =>
    request<{ ok: true }>('/api/mobile/push/subscribe', { method: 'DELETE' }),

  pushTest: (): Promise<{ ok: true }> =>
    request<{ ok: true }>('/api/mobile/push/test', { method: 'POST', json: {} }),

  /* -------------------------------------------------------------- pairing --- */

  pair: (args: {
    code: string;
    deviceName: string;
    pushKey: string;
    pushSubscription?: unknown;
  }): Promise<{ ok: true; deviceId: string; deviceName: string }> =>
    request<{ ok: true; deviceId: string; deviceName: string }>('/api/mobile/pair', {
      method: 'POST',
      json: args,
    }),

  unpair: (): Promise<{ ok: true }> =>
    request<{ ok: true }>('/api/mobile/session', { method: 'DELETE' }),
};

/* --------------------------------------------------------------------- SSE --- */

/**
 * Parse an SSE body into XR stream events.
 *
 * Frame shape is the same as desktop:
 *   event: token \n data: {"text":"..."} \n\n
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseFrame(frame);
        if (event) yield event;
      }
    }
    // Flush a trailing frame without the blank line.
    const tail = parseFrame(buffer.trim());
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  if (frame.length === 0 || frame.startsWith(':')) return null;
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;

  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return { type: 'done' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'token', text: raw };
  }
  if (parsed === null || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  switch (eventName) {
    case 'token':
    case 'delta':
      return { type: 'token', text: String(obj['text'] ?? obj['delta'] ?? '') };
    case 'tool':
      return { type: 'tool', name: String(obj['name'] ?? 'tool') };
    case 'error':
      return { type: 'error', message: String(obj['message'] ?? 'Stream failed') };
    case 'done':
      return { type: 'done', messageId: obj['messageId'] ? String(obj['messageId']) : undefined };
    case 'meta':
      return { type: 'meta', messageId: obj['messageId'] ? String(obj['messageId']) : undefined };
    default:
      return obj['type'] ? ({ type: String(obj['type']), ...obj } as StreamEvent) : null;
  }
}

/**
 * Send a chat message and stream the reply.
 * `signal` cancels both the request and the stream (Stop button).
 */
export async function* streamChat(args: {
  chatId: string;
  content: string;
  model?: string | undefined;
  signal?: AbortSignal | undefined;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${BASE}/api/v1/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      chatId: args.chatId,
      content: args.content,
      ...(args.model ? { model: args.model } : {}),
    }),
    signal: args.signal,
  });

  if (res.status === 401) throw new ApiError(401, 'Session expired');
  if (res.status === 403) throw new ApiError(403, 'Not available on mobile');
  if (!res.ok || !res.body) throw new ApiError(res.status, `Chat failed (${res.status})`);

  yield* parseSSE(res.body);
}

/** True when the failure is "we can't see the daemon", not "the daemon said no". */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.code === 'offline');
}
