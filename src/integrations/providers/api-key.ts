/**
 * Phase 22 · Integrations — API-key connectors (Coolify is the one with a live probe in this phase).
 *
 * A connector with no probe here cannot be connected: we will not store a key we
 * cannot check. The UI shows those connectors as "Coming soon".
 */

import { ProviderError, type FetchLike } from './github.ts';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Self-hosted instances are normal for Coolify, so any host is allowed. HTTPS is
 * required for remote hosts, so the key is never sent in clear text. Plain HTTP
 * is allowed only for loopback.
 */
export function validateInstanceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProviderError('Enter a full URL, for example https://coolify.example.com', 'invalid_url');
  }
  if (url.username || url.password) {
    throw new ProviderError('Remove the username and password from the URL. Use the API key field instead.', 'invalid_url');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new ProviderError('The instance URL must use https:// (http:// is allowed only for localhost).', 'insecure_url');
  }
  url.hash = '';
  url.search = '';
  return url;
}

export interface CoolifyProbeResult {
  teamName?: string;
}

/** Coolify: GET {base}/api/v1/teams/current with a bearer token. 401 means the key is wrong. */
export async function probeCoolify(baseUrl: string, apiKey: string, fetchImpl: FetchLike): Promise<CoolifyProbeResult> {
  const base = validateInstanceUrl(baseUrl);
  const endpoint = new URL('/api/v1/teams/current', base);
  const res = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Coolify rejected the API key', 'unauthorized', res.status);
  }
  if (!res.ok) throw new ProviderError(`Coolify returned HTTP ${res.status}`, 'http_error', res.status);
  let body: { name?: unknown } = {};
  try {
    body = (await res.json()) as { name?: unknown };
  } catch {
    throw new ProviderError('Coolify returned an unexpected response', 'bad_response', res.status);
  }
  return { teamName: typeof body.name === 'string' ? body.name : undefined };
}
