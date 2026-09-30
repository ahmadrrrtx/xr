/*
 * XR — pre-paint theme initialization.
 *
 * Runs synchronously before the React bundle so the correct theme's CSS custom
 * properties are active on first paint (no flash of the default theme).
 * Kept as a separate same-origin file to satisfy CSP `script-src 'self'`.
 */
(function () {
  var FALLBACK = 'xr-native';
  var VALID = ['xr-native', 'graphite', 'midnight', 'paper', 'arctic'];
  try {
    var stored = window.localStorage.getItem('xr.theme');
    document.documentElement.dataset.theme =
      stored && VALID.indexOf(stored) !== -1 ? stored : FALLBACK;
  } catch (err) {
    document.documentElement.dataset.theme = FALLBACK;
  }
})();
