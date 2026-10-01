/*
 * XR — pre-paint theme initialization.
 *
 * Runs synchronously before the React bundle so the correct theme's CSS custom
 * properties are active on first paint (no flash of the default theme).
 * Kept as a separate same-origin file to satisfy CSP `script-src 'self'`.
 *
 * Phase 8: resolves the `system` preference via prefers-color-scheme and
 * migrates legacy Phase-1 values (dark/light/void).
 */
(function () {
  var FALLBACK = 'xr-native';
  var VALID = ['xr-native', 'graphite', 'midnight', 'paper', 'arctic', 'system'];
  var LEGACY = { dark: 'xr-native', light: 'arctic', void: 'xr-native' };

  function resolve(value) {
    if (!value) return FALLBACK;
    if (LEGACY[value]) value = LEGACY[value];
    if (VALID.indexOf(value) === -1) return FALLBACK;
    if (value === 'system') {
      try {
        value = window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'arctic'
          : 'xr-native';
      } catch (err) {
        value = 'xr-native';
      }
    }
    return value;
  }

  try {
    var stored = window.localStorage.getItem('xr.theme');
    document.documentElement.dataset.theme = resolve(stored);
  } catch (err) {
    document.documentElement.dataset.theme = FALLBACK;
  }
})();
