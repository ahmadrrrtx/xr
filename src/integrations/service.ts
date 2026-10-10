/**
 * Phase 22 · Integrations — orchestration.
 *
 * ConnectorRegistry supplies the definitions. CredentialVault holds every secret.
 * ConnectionStore holds non-secret state. This service combines them and applies
 * the rules: state checked once, refresh before expiry, nothing persisted until a
 * probe succeeds, and no secret in an audit record. Route handlers only translate
 * HTTP to these calls.
 */

import type { CredentialVault } from './credentials.ts';
import type { ConnectorConfigField, ConnectorRegistry } from './registry.ts';
import { ConnectionStore, type AccountSummary, type ConnectionRecord } from './connector-store.ts';
import { PendingOAuthStore, createPkcePair } from './oauth-state.ts';
import { INTEGRATIONS_ORG_ID } from './vault-adapter.ts';
import { connectorForTokenEnv } from './mcp-bridge.ts';
import {
  GITHUB_CONNECTOR_ID,
  GITHUB_SCOPE_COPY,
  ProviderError,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  probeGithubAccount,
  refreshGithubToken,
  revokeGithubGrant,
  type FetchLike,
  type OAuthAppCredentials,
  type TokenSet,
} from './providers/github.ts';
import { probeCoolify, validateInstanceUrl } from './providers/api-key.ts';

export const COOLIFY_CONNECTOR_ID = 'coolify';
/** Refresh when the access token has less than this left. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;
const SUPPORTED = new Set([GITHUB_CONNECTOR_ID, COOLIFY_CONNECTOR_ID]);

export type IntegrationStatus = 'disconnected' | 'connected' | 'expired' | 'error';

export interface IntegrationView {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  authType: string;
  scopes: string[];
  capabilities: string[];
  configFields: ConnectorConfigField[];
  /** `available`: this build can connect it. `coming_soon`: rendered, not connectable yet. */
  support: 'available' | 'coming_soon';
  status: IntegrationStatus;
  /** OAuth connectors need a client ID and secret before Connect works (BYOK). */
  needsAppCredentials: boolean;
  hasAppCredentials: boolean;
  account: AccountSummary | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  error: string | null;
  config: Record<string, unknown>;
  scopeCopy: { willAccess: string[]; willNotAccess: string[] } | null;
}

export class IntegrationError extends Error {
  constructor(message: string, readonly code: string, readonly httpStatus = 400) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export interface IntegrationServiceOptions {
  registry: ConnectorRegistry;
  vault: CredentialVault;
  connections: ConnectionStore;
  workspaceId: string;
  pending?: PendingOAuthStore;
  fetch?: FetchLike;
  now?: () => number;
  audit?: (event: string, detail: Record<string, unknown>) => void;
  env?: Record<string, string | undefined>;
}

interface TokenRecord {
  kind: 'oauth' | 'api_key';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  scope?: string;
  apiKey?: string;
}

const vaultKey = (connectorId: string) => `integration:${connectorId}`;
const appKey = (connectorId: string) => `integration:${connectorId}:app`;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{4,80}$/;

export class IntegrationService {
  private readonly pending: PendingOAuthStore;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly opts: IntegrationServiceOptions) {
    this.pending = opts.pending ?? new PendingOAuthStore(undefined, opts.now);
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
  }

  // ── reads ────────────────────────────────────────────────────────────────

  list(): IntegrationView[] {
    return this.opts.registry.list().map((def) => this.view(def.id));
  }

  view(connectorId: string): IntegrationView {
    const def = this.opts.registry.get(connectorId);
    if (!def) throw new IntegrationError(`Unknown integration "${connectorId}"`, 'not_found', 404);
    const record = this.record(connectorId);
    const supported = SUPPORTED.has(connectorId);
    const needsAppCredentials = def.authType === 'oauth2' && supported;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      icon: def.icon,
      authType: def.authType,
      scopes: def.scopes ? [...def.scopes] : [],
      capabilities: [...def.capabilities],
      configFields: def.configFields.map((f) => ({ ...f })),
      support: supported ? 'available' : 'coming_soon',
      status: record?.status ?? 'disconnected',
      needsAppCredentials,
      hasAppCredentials: needsAppCredentials ? this.appCredentials(connectorId) !== null : false,
      account: record?.account ?? null,
      connectedAt: record?.connectedAt ?? null,
      lastSyncAt: record?.lastSyncAt ?? null,
      error: record?.error ?? null,
      config: record?.config ?? {},
      scopeCopy: connectorId === GITHUB_CONNECTOR_ID ? { willAccess: [...GITHUB_SCOPE_COPY.willAccess], willNotAccess: [...GITHUB_SCOPE_COPY.willNotAccess] } : null,
    };
  }

  // ── BYOK OAuth app credentials ───────────────────────────────────────────

  saveAppCredentials(connectorId: string, input: { clientId: string; clientSecret: string }): IntegrationView {
    this.requireOAuth(connectorId);
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!CLIENT_ID_RE.test(clientId)) throw new IntegrationError('Client ID looks wrong. Copy it from the provider\'s OAuth app page.', 'invalid_client_id');
    if (clientSecret.length < 8 || clientSecret.length > 200 || /\s/.test(clientSecret)) {
      throw new IntegrationError('Client secret looks wrong. Copy it again from the provider.', 'invalid_client_secret');
    }
    this.putRecord(appKey(connectorId), 'oauth-app', { clientId, clientSecret });
    this.audit('integration.app_credentials.saved', { connectorId });
    return this.view(connectorId);
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  startOAuth(connectorId: string): { authorizeUrl: string; expiresInSeconds: number } {
    this.requireOAuth(connectorId);
    const app = this.appCredentials(connectorId, 'oauth_start');
    if (!app) throw new IntegrationError('Add a client ID and secret for this app first.', 'setup_required', 409);
    const { verifier, challenge } = createPkcePair();
    const state = this.pending.begin(connectorId, verifier);
    this.audit('integration.oauth.start', { connectorId });
    return { authorizeUrl: buildGithubAuthorizeUrl(app, state, challenge), expiresInSeconds: 600 };
  }

  /** Called by the deep-link callback. The state, not the connector id, selects the sign-in. */
  async completeOAuth(input: { code: string; state: string }): Promise<IntegrationView> {
    const pending = this.pending.take(input.state);
    if (!pending) {
      this.audit('integration.oauth.rejected', { reason: 'state_invalid' });
      throw new IntegrationError('This sign-in session is no longer valid. Start again from the Integrations screen.', 'state_invalid', 400);
    }
    const app = this.appCredentials(pending.connectorId, 'oauth_exchange');
    if (!app) throw new IntegrationError('The OAuth app credentials were removed. Add them again and retry.', 'setup_required', 409);

    let tokens: TokenSet;
    try {
      tokens = await exchangeGithubCode(app, input.code, pending.verifier, this.fetchImpl, this.now());
    } catch (err) {
      this.audit('integration.oauth.failed', { connectorId: pending.connectorId, reason: errorCode(err) });
      throw new IntegrationError(`Sign-in failed: ${errorMessage(err)}`, 'exchange_failed', 502);
    }

    let account: AccountSummary;
    try {
      const probe = await probeGithubAccount(tokens.accessToken, this.fetchImpl);
      account = { login: probe.login, name: probe.name };
    } catch (err) {
      this.audit('integration.oauth.failed', { connectorId: pending.connectorId, reason: 'probe_failed' });
      throw new IntegrationError(`Signed in, but the account check failed: ${errorMessage(err)}`, 'probe_failed', 502);
    }

    const at = new Date(this.now()).toISOString();
    this.storeToken(pending.connectorId, {
      kind: 'oauth',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      scope: tokens.scope,
    });
    this.writeRecord(pending.connectorId, { status: 'connected', config: {}, account, connectedAt: at, lastSyncAt: at, error: null });
    this.audit('integration.connect', { connectorId: pending.connectorId, method: 'oauth2', account: account.login });
    return this.view(pending.connectorId);
  }

  /** The user cancelled at the provider. Consume the pending state so it cannot be used later. */
  cancelOAuth(state: string): never {
    const pending = this.pending.take(state);
    this.audit('integration.oauth.denied', { connectorId: pending?.connectorId ?? null });
    throw new IntegrationError('You denied access. Retry when ready.', 'access_denied', 400);
  }

  /**
   * Returns a usable access token, refreshing first when it is close to expiry. The
   * rotated refresh token is written to the vault before the new access token is
   * used. A rejected refresh marks the connection `expired` (re-auth needed). It is
   * never retried in a loop.
   */
  async getAccessToken(connectorId: string): Promise<string> {
    this.requireConnected(connectorId);
    const token = this.readToken(connectorId, 'token_use');
    if (!token?.accessToken) {
      this.writeRecord(connectorId, { status: 'expired', error: 'Sign-in is missing. Sign in again.' });
      throw new IntegrationError('Sign-in is missing. Sign in again.', 'reauth_required', 401);
    }
    const expiresAt = token.expiresAt ? Date.parse(token.expiresAt) : Number.POSITIVE_INFINITY;
    if (expiresAt - this.now() > REFRESH_SKEW_MS) return token.accessToken;

    const app = this.appCredentials(connectorId, 'token_refresh');
    if (!token.refreshToken || !app) {
      this.writeRecord(connectorId, { status: 'expired', error: 'Sign-in expired. Sign in again.' });
      throw new IntegrationError('Sign-in expired. Sign in again.', 'reauth_required', 401);
    }
    try {
      const fresh = await refreshGithubToken(app, token.refreshToken, this.fetchImpl, this.now());
      this.storeToken(connectorId, {
        ...token,
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken ?? token.refreshToken,
        expiresAt: fresh.expiresAt,
        refreshExpiresAt: fresh.refreshExpiresAt,
        scope: fresh.scope,
      });
      this.audit('integration.token.refreshed', { connectorId });
      return fresh.accessToken;
    } catch (err) {
      if (err instanceof ProviderError && (err.code === 'bad_refresh_token' || err.code === 'invalid_grant')) {
        this.writeRecord(connectorId, { status: 'expired', error: 'Sign-in expired. Sign in again.' });
        this.audit('integration.token.expired', { connectorId });
        throw new IntegrationError('Sign-in expired. Sign in again.', 'reauth_required', 401);
      }
      throw new IntegrationError(`Couldn't refresh the sign-in: ${errorMessage(err)}`, 'refresh_failed', 502);
    }
  }

  // ── API key connectors ───────────────────────────────────────────────────

  async connectApiKey(connectorId: string, config: Record<string, unknown>): Promise<IntegrationView> {
    const def = this.opts.registry.get(connectorId);
    if (!def) throw new IntegrationError(`Unknown integration "${connectorId}"`, 'not_found', 404);
    if (def.authType !== 'api_key') throw new IntegrationError(`${def.name} does not use an API key.`, 'wrong_auth_type');
    if (connectorId !== COOLIFY_CONNECTOR_ID) {
      throw new IntegrationError(`${def.name} is not available in this build yet.`, 'coming_soon', 409);
    }

    const plain: Record<string, string> = {};
    for (const field of def.configFields) {
      const raw = config[field.key];
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (field.required && !value) throw new IntegrationError(`${field.label} is required.`, 'missing_field');
      if (value) plain[field.key] = value;
    }
    let url: string;
    try {
      url = validateInstanceUrl(plain.url ?? '').toString().replace(/\/$/, '');
    } catch (err) {
      throw new IntegrationError(errorMessage(err), errorCode(err) === 'error' ? 'invalid_url' : errorCode(err));
    }
    const apiKey = plain.apiKey ?? '';

    let teamName: string | undefined;
    try {
      ({ teamName } = await probeCoolify(url, apiKey, this.fetchImpl));
    } catch (err) {
      this.audit('integration.connect.failed', { connectorId, reason: errorCode(err) });
      throw new IntegrationError(errorMessage(err), errorCode(err) === 'unauthorized' ? 'unauthorized' : 'probe_failed', 502);
    }

    const at = new Date(this.now()).toISOString();
    this.storeToken(connectorId, { kind: 'api_key', apiKey });
    this.writeRecord(connectorId, {
      status: 'connected',
      config: { url },
      account: teamName ? { name: teamName } : null,
      connectedAt: at,
      lastSyncAt: at,
      error: null,
    });
    this.audit('integration.connect', { connectorId, method: 'api_key' });
    return this.view(connectorId);
  }

  // ── sync, disconnect ─────────────────────────────────────────────────────

  /** Sync = health probe. It updates the account, last-sync time, and status. */
  async sync(connectorId: string): Promise<IntegrationView> {
    this.requireConnected(connectorId);
    const at = new Date(this.now()).toISOString();
    try {
      if (connectorId === GITHUB_CONNECTOR_ID) {
        const token = await this.getAccessToken(connectorId);
        const probe = await probeGithubAccount(token, this.fetchImpl);
        this.writeRecord(connectorId, { status: 'connected', account: { login: probe.login, name: probe.name }, lastSyncAt: at, error: null });
      } else if (connectorId === COOLIFY_CONNECTOR_ID) {
        const token = this.readToken(connectorId, 'sync');
        const url = String(this.record(connectorId)?.config.url ?? '');
        const probe = await probeCoolify(url, token?.apiKey ?? '', this.fetchImpl);
        this.writeRecord(connectorId, { status: 'connected', account: probe.teamName ? { name: probe.teamName } : null, lastSyncAt: at, error: null });
      }
      this.audit('integration.sync', { connectorId, ok: true });
    } catch (err) {
      if (err instanceof IntegrationError && err.code === 'reauth_required') throw err;
      const unauthorized = err instanceof ProviderError && err.code === 'unauthorized';
      if (unauthorized) {
        this.writeRecord(connectorId, { status: 'expired', error: 'The provider rejected the sign-in. Sign in again.' });
      } else {
        this.writeRecord(connectorId, { error: `Couldn't reach the provider: ${errorMessage(err)}` });
      }
      this.audit('integration.sync', { connectorId, ok: false, reason: errorCode(err) });
      throw new IntegrationError(errorMessage(err), unauthorized ? 'unauthorized' : 'sync_failed', 502);
    }
    return this.view(connectorId);
  }

  /** Revokes the grant (best effort) and deletes the local token. The BYOK app credentials are kept for reconnecting. */
  async disconnect(connectorId: string): Promise<{ ok: true; revoked: boolean; view: IntegrationView }> {
    if (!this.opts.registry.get(connectorId)) {
      throw new IntegrationError(`Unknown integration "${connectorId}"`, 'not_found', 404);
    }
    let revoked = false;
    const token = this.readToken(connectorId, 'revoke');
    if (connectorId === GITHUB_CONNECTOR_ID && token?.accessToken) {
      const app = this.appCredentials(connectorId, 'revoke');
      if (app) revoked = await revokeGithubGrant(app, token.accessToken, this.fetchImpl);
    }
    const existing = this.opts.vault.getByConnector(INTEGRATIONS_ORG_ID, vaultKey(connectorId));
    if (existing) this.opts.vault.delete(existing.id);
    this.opts.connections.remove(this.opts.workspaceId, connectorId);
    this.audit('integration.disconnect', { connectorId, revoked });
    return { ok: true, revoked, view: this.view(connectorId) };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private requireOAuth(connectorId: string): void {
    const def = this.opts.registry.get(connectorId);
    if (!def) throw new IntegrationError(`Unknown integration "${connectorId}"`, 'not_found', 404);
    if (def.authType !== 'oauth2') throw new IntegrationError(`${def.name} does not use OAuth.`, 'wrong_auth_type');
    if (connectorId !== GITHUB_CONNECTOR_ID) throw new IntegrationError(`${def.name} is not available in this build yet.`, 'coming_soon', 409);
  }

  private requireConnected(connectorId: string): ConnectionRecord {
    const record = this.record(connectorId);
    if (!record || record.status === 'disconnected') {
      throw new IntegrationError('This integration is not connected.', 'not_connected', 409);
    }
    return record;
  }

  private record(connectorId: string): ConnectionRecord | null {
    return this.opts.connections.get(this.opts.workspaceId, connectorId);
  }

  private writeRecord(connectorId: string, patch: Partial<Omit<ConnectionRecord, 'workspaceId' | 'connectorId' | 'updatedAt' | 'credentialId'>>): void {
    const current = this.record(connectorId);
    this.opts.connections.upsert({
      workspaceId: this.opts.workspaceId,
      connectorId,
      status: patch.status ?? current?.status ?? 'disconnected',
      config: patch.config ?? current?.config ?? {},
      // Always the live vault row, so a re-created token never leaves a stale pointer.
      credentialId: this.vaultRecordId(vaultKey(connectorId)),
      account: patch.account !== undefined ? patch.account : current?.account ?? null,
      connectedAt: patch.connectedAt !== undefined ? patch.connectedAt : current?.connectedAt ?? null,
      lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : current?.lastSyncAt ?? null,
      error: patch.error !== undefined ? patch.error : current?.error ?? null,
      updatedAt: new Date(this.now()).toISOString(),
    });
  }

  private vaultRecordId(key: string): string | null {
    return this.opts.vault.getByConnector(INTEGRATIONS_ORG_ID, key)?.id ?? null;
  }

  /** Upsert one vault row per key. The vault's getByConnector returns the first match, so there is exactly one per key. */
  private putRecord(key: string, name: string, credentials: Record<string, unknown>): void {
    const existing = this.opts.vault.getByConnector(INTEGRATIONS_ORG_ID, key);
    if (existing) this.opts.vault.update(existing.id, credentials);
    else this.opts.vault.store(INTEGRATIONS_ORG_ID, { connectorId: key, name, credentials });
  }

  /**
   * Memory-only. The secret broker calls this when an MCP client needs the bearer
   * for an integration's server. Returns a token only while the connector is
   * connected, and audits every read. The token is never returned to a route,
   * logged, or stored outside the vault.
   */
  mcpTokenFor(envName: string): string | undefined {
    const connectorId = connectorForTokenEnv(envName);
    if (!connectorId) return undefined;
    const record = this.record(connectorId);
    if (!record || record.status !== 'connected') return undefined;
    const token = this.readToken(connectorId)?.accessToken;
    if (!token) return undefined;
    this.audit('integration.credential.read', { connectorId, purpose: 'mcp' });
    return token;
  }

  private storeToken(connectorId: string, token: TokenRecord): void {
    this.putRecord(vaultKey(connectorId), token.kind === 'oauth' ? 'oauth-token' : 'api-key', { ...token });
  }

  /** `purpose` is set only where the secret is used. Presence checks pass nothing and are not audited. */
  private readToken(connectorId: string, purpose?: string): TokenRecord | null {
    const row = this.opts.vault.getByConnector(INTEGRATIONS_ORG_ID, vaultKey(connectorId));
    if (!row) return null;
    if (purpose) this.audit('integration.credential.read', { connectorId, purpose });
    return row.credentials as unknown as TokenRecord;
  }

  private appCredentials(connectorId: string, purpose?: string): OAuthAppCredentials | null {
    const found = this.findAppCredentials(connectorId);
    if (found && purpose) this.audit('integration.credential.read', { connectorId, purpose, kind: 'oauth_app' });
    return found;
  }

  private findAppCredentials(connectorId: string): OAuthAppCredentials | null {
    const row = this.opts.vault.getByConnector(INTEGRATIONS_ORG_ID, appKey(connectorId));
    if (row) {
      const c = row.credentials as { clientId?: string; clientSecret?: string };
      if (c.clientId && c.clientSecret) return { clientId: c.clientId, clientSecret: c.clientSecret };
    }
    // Developer or CI override. Still never written to disk by XR.
    const env = this.opts.env ?? process.env;
    const prefix = `XR_OAUTH_${connectorId.toUpperCase()}`;
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private audit(event: string, detail: Record<string, unknown>): void {
    this.opts.audit?.(event, detail);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'unknown error';
}

function errorCode(err: unknown): string {
  if (err instanceof ProviderError || err instanceof IntegrationError) return err.code;
  return 'error';
}
