import { expect, test } from 'bun:test';
import { configuredCredentialStatus } from '../../src/providers/credential-presence';
import { descriptorFromPreset, modelsFromPreset } from '../../src/intelligence/capability';
import { PRESETS } from '../../src/providers/presets';

for (const keys of [{}, { AWS_ACCESS_KEY_ID: 'fixture-access' }, { AWS_SECRET_ACCESS_KEY: 'fixture-secret' }]) {
  test(`AWS credential presence fails closed for ${Object.keys(keys).join(',') || 'no credentials'}`, () => {
    const values = keys as Record<string, string>;
    const result = configuredCredentialStatus(PRESETS.bedrock, name => values[name]);
    expect(result).toEqual({ required: true, available: false });
    expect(descriptorFromPreset(PRESETS.bedrock, result.available).auth.credentialAvailable).toBe(false);
    expect(modelsFromPreset(PRESETS.bedrock, result.available).every(m => m.credentialAvailable === false)).toBe(true);
  });
}

test('AWS broker pair is only configured presence; no secret value or health is fabricated', () => {
  const result = configuredCredentialStatus(PRESETS.bedrock, () => 'fixture-not-a-real-AWS-credential');
  expect(result).toEqual({ required: true, available: true });
  expect(JSON.stringify(result)).not.toContain('fixture');
  const provider = descriptorFromPreset(PRESETS.bedrock, result.available);
  expect(provider.auth.type).toBe('aws');
  expect(provider.health).toBeUndefined();
  expect(modelsFromPreset(PRESETS.bedrock, result.available).every(m => m.evidence?.reachable === 'unknown')).toBe(true);
});

test('local/keyless, keyed, unknown and unavailable custom-header cases stay honest', () => {
  expect(configuredCredentialStatus(PRESETS.ollama, () => undefined)).toEqual({ required: false, available: true });
  expect(configuredCredentialStatus(undefined, () => undefined).available).toBe(false);
  expect(configuredCredentialStatus(PRESETS.openai, () => undefined)).toEqual({ required: true, available: false, envName: 'OPENAI_API_KEY' });
  expect(configuredCredentialStatus({ ...PRESETS.openai, kind: 'custom', apiKeyEnv: undefined,
    headers: { 'x-auth': 'unsealed-is-not-a-stored-secret' } }, () => undefined).available).toBe(false);
});
