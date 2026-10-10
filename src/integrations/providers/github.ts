/**
 * Phase 22 · Integrations — GitHub OAuth strategy (the one fully working OAuth connector in this phase).
 *
 * Facts this relies on (GitHub docs, checked 2026-10):
 *  - PKCE with code_challenge_method=S256 is supported and recommended. GitHub does
 *    not enforce it, so the client secret is still sent at token exchange. The
 *    secret therefore lives in the vault and is only used by the daemon.
 *  - Access tokens do not expire unless the app opts in. Requesting `offline_access`
 *    yields an expiring access token (8 h) plus a refresh token (about 6 months).
 *    Each refresh rotates the refresh token, so the new pair must be saved at once.
 *  - Errors often arrive as HTTP 200 with an `error` field. They are parsed here.
 *  - Revoking a grant needs client_id:client_secret as Basic auth and the access
 *    token in the body: DELETE /applications/{client_id}/grant.
 *
 * Redirect URI: `xr://oauth/callback`. This must be accepted when the user registers
 * the OAuth app. If GitHub rejects a custom scheme for the app, use the loopback
 * fallback and record that in the PR.
 */

export const GITHUB_CONNECTOR_ID = 'github';
export const OAUTH_REDIRECT_URI = 'xr://oauth/callback';
/** Scopes shown to the user. `offline_access` is requested for refresh but is not a user-facing permission. */
export const GITHUB_SCOPES = ['repo', 'read:org'] as const;
const GITHUB_REQUEST_SCOPES = [...GITHUB_SCOPES, 'offline_access'];

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ISO time after which the access token must be refreshed. Absent when the token does not expire. */
  expiresAt?: string;
  /** ISO time after which the refresh token is no longer valid. */
  refreshExpiresAt?: string;
  scope: string;
}

export class ProviderError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function buildGithubAuthorizeUrl(app: Pick<OAuthAppCredentials, 'clientId'>, state: string, challenge: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', GITHUB_REQUEST_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function toTokenSet(raw: RawTokenResponse, now: number): TokenSet {
  if (raw.error) {
    throw new ProviderError(raw.error_description ?? raw.error, raw.error);
  }
  if (!raw.access_token) {
    throw new ProviderError('GitHub returned no access token', 'no_access_token');
  }
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_in ? new Date(now + raw.expires_in * 1000).toISOString() : undefined,
    refreshExpiresAt: raw.refresh_token_expires_in ? new Date(now + raw.refresh_token_expires_in * 1000).toISOString() : undefined,
    scope: raw.scope ?? '',
  };
}

async function postToken(fetchImpl: FetchLike, body: Record<string, string>): Promise<RawTokenResponse> {
  const res = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  let raw: RawTokenResponse;
  try {
    raw = (await res.json()) as RawTokenResponse;
  } catch {
    throw new ProviderError(`GitHub token endpoint returned HTTP ${res.status}`, 'bad_response', res.status);
  }
  if (!res.ok && !raw.error) {
    throw new ProviderError(`GitHub token endpoint returned HTTP ${res.status}`, 'http_error', res.status);
  }
  return raw;
}

export async function exchangeGithubCode(
  app: OAuthAppCredentials,
  code: string,
  verifier: string,
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<TokenSet> {
  const raw = await postToken(fetchImpl, {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: verifier,
  });
  return toTokenSet(raw, now);
}

/** Refresh returns a NEW refresh token; the caller must persist it before using the access token. */
export async function refreshGithubToken(
  app: OAuthAppCredentials,
  refreshToken: string,
  fetchImpl: FetchLike,
  now = Date.now(),
): Promise<TokenSet> {
  const raw = await postToken(fetchImpl, {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  return toTokenSet(raw, now);
}

/** Best-effort grant revocation. Returns false on any failure; the caller still deletes local secrets. */
export async function revokeGithubGrant(
  app: OAuthAppCredentials,
  accessToken: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  try {
    const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');
    const res = await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(app.clientId)}/grant`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'XR-Desktop',
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}

export interface GithubAccount {
  id: number;
  login: string;
  name?: string;
}

/** Account probe. Throws ProviderError('unauthorized', 401) when the token is no longer valid. */
export async function probeGithubAccount(accessToken: string, fetchImpl: FetchLike): Promise<GithubAccount> {
  const res = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'XR-Desktop',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new ProviderError('GitHub rejected the access token', 'unauthorized', 401);
  if (!res.ok) throw new ProviderError(`GitHub returned HTTP ${res.status}`, 'http_error', res.status);
  const body = (await res.json()) as { id?: number; login?: string; name?: string | null };
  if (typeof body.login !== 'string' || typeof body.id !== 'number') {
    throw new ProviderError('GitHub returned an unexpected account response', 'bad_response', res.status);
  }
  return { id: body.id, login: body.login, name: body.name ?? undefined };
}

/** Plain-English scope copy for the settings popover. Only what the app actually asks for. */
export const GITHUB_SCOPE_COPY = {
  willAccess: [
    'Read and write your repositories, issues and pull requests (repo)',
    'Read your organization membership (read:org)',
  ],
  // Only claims that follow from the scopes XR requests: delete_repo and user:email are not requested.
  willNotAccess: [
    'Delete repositories (XR does not request delete_repo)',
    'Read your email address (XR does not request user:email)',
  ],
} as const;
