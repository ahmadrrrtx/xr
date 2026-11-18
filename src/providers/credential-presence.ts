/** Synchronous configured-credential presence, never authentication/health.
 * Listing must not invoke AWS CLI, metadata endpoints or a provider request. */
import type { ProviderPreset } from './presets.ts';
import { secretBrokerSync } from '../security/secret-broker.ts';
import { resolveCustomHeaders } from './header-secrets.ts';
export interface CredentialPresence { required: boolean; available: boolean; envName?: string }
export function configuredCredentialStatus(
  preset: ProviderPreset | undefined,
  read: (name: string) => string | undefined = secretBrokerSync,
): CredentialPresence {
  if (!preset) return { required: false, available: false };
  if (preset.authType === 'aws') {
    // No single apiKeyEnv does NOT mean keyless. Role/CLI availability is
    // unknown without an explicit probe; a declared role/path is not proof.
    return { required: true, available: !!(read('AWS_ACCESS_KEY_ID') && read('AWS_SECRET_ACCESS_KEY')) };
  }
  if (preset.kind === 'custom' && Object.keys(preset.headers ?? {}).length) {
    try { resolveCustomHeaders(preset.id, preset.baseUrl!, preset.headers); }
    catch { return { required: true, available: false }; }
    if (!preset.apiKeyEnv) return { required: true, available: true };
  }
  if (!preset.apiKeyEnv) return { required: false, available: true };
  return { required: true, available: Boolean(read(preset.apiKeyEnv)), envName: preset.apiKeyEnv };
}
