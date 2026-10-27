/** Generic settings are not a credential vault, including the native JSON file. */
const SENSITIVE_KEY =
  /providerkeys|api[-_]?key|token|secret|password|passwd|credential/i;
const SECRET_FIELD =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer[_-]?token|token|secret|password|passwd|credential)$/i;
export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}
function looksEncoded(value: string): boolean {
  const first = value.trimStart()[0];
  return first === '{' || first === '[';
}
export function assertSafeSetting(key: string, value: unknown): void {
  const seen = new WeakSet<object>();
  const secretField = (v: unknown, depth = 0): boolean => {
    if (typeof v === 'string' && looksEncoded(v)) {
      try {
        return secretField(JSON.parse(v), depth + 1);
      } catch {
        return false;
      }
    }
    if (!v || typeof v !== 'object') return false;
    if (depth > 32 || seen.has(v)) return true;
    seen.add(v);
    return Object.entries(v).some(
      ([k, x]) => SECRET_FIELD.test(k) || secretField(x, depth + 1)
    );
  };
  if (isSensitiveSettingKey(key) || secretField(value))
    throw new Error(
      'Credentials cannot be saved in ordinary settings; use the engine secret broker.'
    );
}
/** Older onboarding wrote a whole choice, including apiKey, into this setting.
 * Preserve a valid selected model; never return or copy its credential. */
export function durableModelSelection(
  value: unknown,
  depth = 0
): string | null {
  if (depth > 8) return null;
  if (typeof value === 'string') {
    if (looksEncoded(value)) {
      try {
        return durableModelSelection(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    return value;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.model !== 'string' || !v.model.trim()) return null;
  const provider =
    v.source === 'local'
      ? 'ollama'
      : typeof v.providerId === 'string'
        ? v.providerId
        : undefined;
  return provider ? `${provider}/${v.model}` : null;
}
