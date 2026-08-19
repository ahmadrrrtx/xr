/**
 * XR Phase 11 — Repo Intelligence config.
 *
 * Deliberately NOT added to `src/config/config.ts` (size-waived). Defaults
 * plus env overrides keep the kill switch and token budget available without
 * a second configuration religion.
 *
 *   XR_REPO_DISABLED=1          hard off
 *   XR_REPO_MAP_TOKENS=1024     token budget (512..4096)
 *   XR_REPO_MAX_FILES=20000     scan cap
 */

export const DEFAULT_REPO_MAP_TOKENS = 1024;
export const MIN_REPO_MAP_TOKENS = 256;
export const MAX_REPO_MAP_TOKENS = 4096;
export const DEFAULT_REPO_MAX_FILES = 20_000;
export const DEFAULT_REPO_MAX_FILE_BYTES = 512_000;
export const DEFAULT_REPO_MAX_FILE_CONTEXT_LINES = 80;

export interface RepoIntelligenceConfig {
  enabled: boolean;
  mapTokens: number;
  maxFiles: number;
  maxFileBytes: number;
  maxFileContextLines: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function loadRepoConfig(): RepoIntelligenceConfig {
  const disabled = process.env.XR_REPO_DISABLED === "1";
  return {
    enabled: !disabled,
    mapTokens: intEnv("XR_REPO_MAP_TOKENS", DEFAULT_REPO_MAP_TOKENS, MIN_REPO_MAP_TOKENS, MAX_REPO_MAP_TOKENS),
    maxFiles: intEnv("XR_REPO_MAX_FILES", DEFAULT_REPO_MAX_FILES, 16, 200_000),
    maxFileBytes: intEnv("XR_REPO_MAX_FILE_BYTES", DEFAULT_REPO_MAX_FILE_BYTES, 4_096, 4_000_000),
    maxFileContextLines: intEnv("XR_REPO_MAX_CONTEXT_LINES", DEFAULT_REPO_MAX_FILE_CONTEXT_LINES, 8, 400),
  };
}

export function isRepoIntelligenceEnabled(): boolean {
  return loadRepoConfig().enabled;
}
