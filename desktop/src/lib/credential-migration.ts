/** Actual migration logic, parameterized only for storage ports. A successful
 * return requires write/save/read-back acknowledgment, not an empty fallback. */
import { assertSafeSetting, durableModelSelection } from './persistent-safety';
export interface LegacyNativeStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}
export interface LegacyBrowserStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}
function containsLegacyCredential(value: unknown): boolean {
  try {
    assertSafeSetting('xr.model.default', value);
    return false;
  } catch {
    return true;
  }
}
function hasLegacyMap(value: unknown): boolean {
  return Boolean(
    value && (typeof value !== 'object' || Object.keys(value).length)
  );
}
export async function purgeCredentialCopies(
  native: LegacyNativeStore | null,
  browser: LegacyBrowserStore,
  nativeRequired = false
): Promise<boolean> {
  if (nativeRequired && !native)
    throw new Error(
      'Native settings store unavailable; legacy credential cleanup could not be confirmed. Retry before completing setup.'
    );
  let found = false;
  const key = 'xr.providerKeys',
    modelKey = 'xr.model.default';
  if (native) {
    const legacy = await native.get<unknown>(key),
      model = await native.get<unknown>(modelKey);
    found = hasLegacyMap(legacy) || containsLegacyCredential(model);
    if (legacy !== null && legacy !== undefined) await native.set(key, null);
    if (model !== null && model !== undefined)
      await native.set(modelKey, durableModelSelection(model));
    await native.save();
    if (hasLegacyMap(await native.get(key)))
      throw new Error(
        'Native credential cleanup was not retained; setup was not completed.'
      );
    assertSafeSetting(modelKey, await native.get(modelKey));
  }
  // No swallowed access/quota/readback errors: the caller must not report a
  // successful deletion while another installation/browser copy remains here.
  if (browser.getItem(key)) found = true;
  browser.removeItem(key);
  const raw = browser.getItem(modelKey);
  if (raw !== null) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    found = containsLegacyCredential(value) || found;
    browser.setItem(modelKey, JSON.stringify(durableModelSelection(value)));
  }
  if (browser.getItem(key) !== null)
    throw new Error(
      'Browser credential cleanup was not retained; setup was not completed.'
    );
  const readback = browser.getItem(modelKey);
  if (readback !== null) assertSafeSetting(modelKey, readback);
  return found;
}
