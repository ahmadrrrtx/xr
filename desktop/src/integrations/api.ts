/*
 * Integrations (Phase 22) — engine client. Every call goes through the paired
 * engine link (base …/api/v1). The engine decides what is connected, refreshed,
 * revoked or stored. The renderer shows what the engine returns and never sees a
 * token, key or client secret: none of those fields exist in these types.
 *
 * Routes (src/daemon/routes/integrations.routes.ts):
 *   GET    /integrations                       list (registry + connection state)
 *   GET    /integrations/:id                   one connector
 *   PUT    /integrations/:id/app               BYOK OAuth client id + secret
 *   POST   /integrations/:id/oauth/start       authorize URL (PKCE + state)
 *   POST   /integrations/oauth/complete        finish sign-in from xr://oauth/callback
 *   POST   /integrations/:id/connect           API-key connectors
 *   POST   /integrations/:id/sync              health probe
 *   POST   /integrations/:id/disconnect        revoke (best effort) + delete local token
 */
import { engineJson, enginePost, EngineHttpError } from '@/engine/transport';

export type IntegrationStatus = 'disconnected' | 'connected' | 'expired' | 'error';

export interface ConnectorConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select' | 'boolean';
  required: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

export interface IntegrationView {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  authType: 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'bot_token' | 'none';
  scopes: string[];
  capabilities: string[];
  configFields: ConnectorConfigField[];
  support: 'available' | 'coming_soon';
  status: IntegrationStatus;
  needsAppCredentials: boolean;
  hasAppCredentials: boolean;
  account: { login?: string; name?: string } | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  error: string | null;
  config: Record<string, unknown>;
  scopeCopy: { willAccess: string[]; willNotAccess: string[] } | null;
}

export interface ListResponse {
  ok: true;
  connectors: IntegrationView[];
}

export interface OneResponse {
  ok: true;
  connector: IntegrationView;
}

export interface StartOAuthResponse {
  ok: true;
  authorizeUrl: string;
  expiresInSeconds: number;
}

export interface DisconnectResponse {
  ok: true;
  revoked: boolean;
  connector: IntegrationView;
}

/** Engine error body. `code` drives the copy; `error` is the engine's sentence. */
export class IntegrationApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'IntegrationApiError';
  }
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EngineHttpError) {
      const body = err.body ?? {};
      const code = typeof body.code === 'string' ? body.code : 'request_failed';
      const message = typeof body.error === 'string' ? body.error : 'The engine could not complete that request.';
      throw new IntegrationApiError(message, code, err.status);
    }
    throw err;
  }
}

export function listIntegrations(): Promise<ListResponse> {
  return call(() => engineJson<ListResponse>('/integrations'));
}

export function saveAppCredentials(id: string, clientId: string, clientSecret: string): Promise<OneResponse> {
  return call(() =>
    engineJson<OneResponse>(`/integrations/${encodeURIComponent(id)}/app`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    }),
  );
}

export function startOAuth(id: string): Promise<StartOAuthResponse> {
  return call(() => enginePost<StartOAuthResponse>(`/integrations/${encodeURIComponent(id)}/oauth/start`, {}));
}

/** Finish a sign-in from the xr:// callback. A provider denial arrives as `error` and is reported as access_denied. */
export function completeOAuth(callback: { code?: string; state: string; error?: string }): Promise<OneResponse> {
  return call(() => enginePost<OneResponse>('/integrations/oauth/complete', callback));
}

export function connectApiKey(id: string, config: Record<string, string>): Promise<OneResponse> {
  return call(() => enginePost<OneResponse>(`/integrations/${encodeURIComponent(id)}/connect`, { config }));
}

export function syncIntegration(id: string): Promise<OneResponse> {
  return call(() => enginePost<OneResponse>(`/integrations/${encodeURIComponent(id)}/sync`, {}));
}

export function disconnectIntegration(id: string): Promise<DisconnectResponse> {
  return call(() => enginePost<DisconnectResponse>(`/integrations/${encodeURIComponent(id)}/disconnect`, {}));
}
