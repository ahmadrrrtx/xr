/**
 * XR Business OS — OAuth Flow Manager
 * 
 * Handles OAuth2 authorization code flows for integrations.
 * All credentials stored encrypted. Users own their credentials.
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthToken {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  expires_at?: string;
  scope?: string;
}

export interface OAuthState {
  id: string;
  connectorId: string;
  workspaceId: string;
  memberId: string;
  codeVerifier?: string; // PKCE
  redirectAfter?: string;
  createdAt: string;
}

export class OAuthManager {
  private states = new Map<string, OAuthState>();

  /**
   * Start OAuth flow — generate authorization URL.
   */
  startFlow(params: {
    connectorId: string;
    workspaceId: string;
    memberId: string;
    config: OAuthConfig;
    usePKCE?: boolean;
  }): { url: string; state: string } {
    const stateId = crypto.randomUUID();

    const state: OAuthState = {
      id: stateId,
      connectorId: params.connectorId,
      workspaceId: params.workspaceId,
      memberId: params.memberId,
      createdAt: new Date().toISOString(),
    };

    this.states.set(stateId, state);

    const url = new URL(params.config.authorizationUrl);
    url.searchParams.set('client_id', params.config.clientId);
    url.searchParams.set('redirect_uri', params.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.config.scopes.join(' '));
    url.searchParams.set('state', stateId);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    return { url: url.toString(), state: stateId };
  }

  /**
   * Handle OAuth callback — exchange code for token.
   */
  async handleCallback(params: {
    code: string;
    state: string;
    config: OAuthConfig;
  }): Promise<{ token: OAuthToken; state: OAuthState }> {
    const state = this.states.get(params.state);
    if (!state) throw new Error('Invalid or expired OAuth state');

    // Clean up state
    this.states.delete(params.state);

    // Exchange code for token
    const response = await fetch(params.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: params.config.redirectUri,
        client_id: params.config.clientId,
        client_secret: params.config.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const token: OAuthToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type ?? 'Bearer',
      expires_in: data.expires_in,
      expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
      scope: data.scope,
    };

    return { token, state };
  }

  /**
   * Refresh an expired token.
   */
  async refreshToken(params: {
    refreshToken: string;
    config: OAuthConfig;
  }): Promise<OAuthToken> {
    const response = await fetch(params.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: params.refreshToken,
        client_id: params.config.clientId,
        client_secret: params.config.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json() as any;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? params.refreshToken,
      token_type: data.token_type ?? 'Bearer',
      expires_in: data.expires_in,
      expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
    };
  }

  /**
   * Clean up expired states.
   */
  cleanup(): void {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    for (const [id, state] of this.states.entries()) {
      if (state.createdAt < fiveMinutesAgo) {
        this.states.delete(id);
      }
    }
  }
}
