/** Content revisions catch other windows AND config/CLI edits without a second
 * authority or a revision file. Diagnostic timestamps are not user intent. */
import { createHash } from 'node:crypto';
import { defaultVoiceSettings, type VoiceSettings } from './types.ts';
function canonical(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const intent = ({ revision: _r, lastTestResult: _t, lastUsedAt: _u, ...settings }: VoiceSettings) => canonical(settings);
export function voiceSettingsRevision(settings: VoiceSettings): string {
  const value = intent(settings);
  return value === intent(defaultVoiceSettings()) ? 'initial' : createHash('sha256').update(value).digest('hex');
}
export class VoiceSettingsConflict extends Error {
  constructor(readonly revision: string) { super('Voice settings changed elsewhere. Review the latest settings and retry.'); }
}
