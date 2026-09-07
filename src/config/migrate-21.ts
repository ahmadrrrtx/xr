/**
 * Config migration 20 → 21 (Phase 8).
 *
 * Lives outside config.ts so the waived giant does not grow.
 * Additive: unsigned plugins and silent headless Tier-2 fail closed.
 */
export function migrate20to21(raw: any): any {
  return {
    ...raw,
    version: 21,
    plugins: {
      enabled: true,
      requireTrust: true,
      deniedPermissions: [],
      ...raw.plugins,
      requireSigned: raw.plugins?.requireSigned ?? true,
    },
    approvals: {
      defaultTtlMs: 300_000,
      perSurface: {},
      ...raw.approvals,
      typedConfirm: raw.approvals?.typedConfirm ?? true,
    },
  };
}
