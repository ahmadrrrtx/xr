/** All custom header VALUES are credentials, regardless of their name. Config
 * holds only engine-generated endpoint-bound references, never an alternate
 * plaintext secret store. Legacy values are sealed by ConfigService init. */
import { createHash } from 'node:crypto';
import { setSecretAsync } from '../security/secrets.ts';
import { secretBrokerSync } from '../security/secret-broker.ts';
const PREFIX = 'secret://';
const FORBIDDEN = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'proxy-authorization', 'upgrade', 'te', 'trailer']);
export function customSecretName(id: string, baseUrl: string, purpose: string): string {
  return `XR_CUSTOM_${createHash('sha256').update(`${id}\n${baseUrl.replace(/\/+$/, '')}\n${purpose.toLowerCase()}`).digest('hex').slice(0, 32).toUpperCase()}`;
}
function entries(headers: Record<string, string> = {}): Array<[string, string]> {
  const out: Array<[string, string]> = []; const seen = new Set<string>();
  if (Object.keys(headers).length > 24) throw new Error('At most 24 custom headers are allowed');
  for (const [raw, value] of Object.entries(headers)) {
    const name = raw.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || FORBIDDEN.has(name) || seen.has(name) ||
        typeof value !== 'string' || !value || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error('Invalid, duplicate or forbidden custom header');
    seen.add(name); out.push([name, value]);
  }
  return out;
}
export function assertHeaderReferences(id: string, baseUrl: string, headers?: Record<string, string>): void {
  for (const [name, value] of entries(headers))
    if (value !== PREFIX + customSecretName(id, baseUrl, `header:${name}`))
      throw new Error('Unsealed or differently scoped custom headers. Re-enter them through provider setup and rotate previously plaintext credentials.');
}
export async function sealCustomHeaders(id: string, baseUrl: string, headers: Record<string, string> = {}): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const validated = entries(headers); // validate EVERY header before any secret write
  for (const [name, value] of validated) {
    const key = customSecretName(id, baseUrl, `header:${name}`);
    if (value.startsWith(PREFIX)) {
      if (value !== PREFIX + key) throw new Error('Custom header reference belongs to a different endpoint');
    } else { try { await setSecretAsync(key, value); } catch { throw new Error('Custom header credential storage failed; configuration was not published.'); } }
    result[name] = PREFIX + key;
  }
  return result;
}
export function resolveCustomHeaders(id: string, baseUrl: string, headers?: Record<string, string>): Record<string, string> {
  assertHeaderReferences(id, baseUrl, headers);
  const out: Record<string, string> = {};
  for (const [name, reference] of entries(headers)) {
    const value = secretBrokerSync(reference.slice(PREFIX.length));
    if (!value) throw new Error('Custom header credential is unavailable; re-enter it through provider setup.');
    out[name] = value;
  }
  return out;
}
export async function sealConfiguredHeaders(config: { providerEngine?: { customProviders?: Array<{ id: string; baseUrl: string; headers?: Record<string, string> }> } }): Promise<boolean> {
  let changed = false;
  for (const custom of config.providerEngine?.customProviders ?? []) {
    if (Object.values(custom.headers ?? {}).some(v => !v.startsWith(PREFIX))) {
      custom.headers = await sealCustomHeaders(custom.id, custom.baseUrl, custom.headers);
      changed = true;
    } else assertHeaderReferences(custom.id, custom.baseUrl, custom.headers);
  }
  return changed;
}
