/**
 * XR Phase 11 — Repository Intelligence public surface.
 */

export * from "./types.ts";
export { loadRepoConfig, isRepoIntelligenceEnabled, DEFAULT_REPO_MAP_TOKENS } from "./config.ts";
export { countTokens, tokenizeQuery, TOKEN_ESTIMATOR_ID } from "./tokens.ts";
export { supportedLanguageIds, structuralLanguageIds, languageForPath } from "./languages.ts";
export { parseSource, treeSitterStatus } from "./parser/index.ts";
export { scanRepository } from "./scanner.ts";
export { RepoStore, ensureRepoSchema, REPO_SCHEMA_SQL } from "./store.ts";
export { indexRepository, indexStatus } from "./indexer.ts";
export { rankFiles, pageRank } from "./ranking.ts";
export { generateRepoMap } from "./repo-map.ts";
export { searchRepo } from "./search.ts";
export { RepoIntelligence, createRepoIntelligence } from "./service.ts";
export { buildRepoCandidates, isRepositoryFact, isResearchFact } from "./context.ts";
export { REPO_TOOLS } from "./tools.ts";
export { resolveDependencies } from "./dependencies.ts";
export { readGitSnapshot, readDiff } from "./git.ts";
export { loadIgnore, DEFAULT_SKIP_DIRS } from "./ignore.ts";
export { resolveInsideRoot, scopedStat } from "./scope.ts";
