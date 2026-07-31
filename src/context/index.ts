/**
 * XR 4.5 — Knowledge and Context OS public surface.
 *
 * One import site for every consumer:
 *   import { ContextService, buildGrant, ... } from "../context/index.ts";
 */

export * from "./types.ts";

export {
  buildGrant,
  denyAllGrant,
  authorize,
  authorizeWrite,
  makeScope,
  sameWorkspace,
  tierCeilingFor,
  tiersForMemoryScopeKind,
  type AuthDecision,
  type GrantRequest,
} from "./policy.ts";

export {
  scanForPoisoning,
  admitContextWrite,
  detectConflicts,
  conflictPenalty,
  maskSecrets,
  maskExternalPaths,
  type AdmissionDecision,
  type AdmissionRequest,
  type ConflictFinding,
  type PoisonScan,
} from "./poison.ts";

export { ContextRepository, adaptStoreForContext, buildItem, type ContextDb } from "./repository.ts";

export {
  routeModelClass,
  embedWithRoute,
  deterministicRerank,
  LEXICAL_ROUTE,
  type EmbeddingRoute,
  type RerankCandidate,
  type RerankResult,
} from "./embedding.ts";

export {
  ContextRetrieval,
  type ExternalCandidate,
  type RetrievalRequest,
  type RetrievalResult,
} from "./retrieval.ts";

export { ContextAssembler, type AssembleRequest } from "./assembler.ts";

export {
  buildInjectionPackage,
  channelFor,
  wrapUntrusted,
  verifyInjectionSafety,
  QUARANTINE_OPEN,
  QUARANTINE_CLOSE,
  CHANNEL_PREAMBLE,
  type InjectionOptions,
} from "./injection.ts";

export {
  compressItems,
  compressMessages,
  DEFAULT_REQUIRED_INVARIANTS,
  type CompressionInput,
  type MessageLike,
} from "./compression.ts";

export {
  ProvenanceService,
  provenanceFromResearchSource,
  provenanceFromExecution,
  provenanceFromFile,
  type EvidenceLink,
} from "./provenance.ts";

export {
  ContextInspection,
  residualDisclosure,
  CONSENT_EXPLANATIONS,
  TRUST_LABELS,
  type ItemInspection,
} from "./inspection.ts";

export {
  ContextService,
  type ContextServiceOptions,
  type RecordContextOptions,
  type RecordResult,
  type RequestContextOptions,
} from "./service.ts";

export {
  memoryEntryToContextItem,
  contextTypeToMemoryCategory,
  LEGACY_SOURCE_MAP,
} from "./memory-adapter.ts";

/**
 * Phase 2 · T5 — the memory engine, now owned by the context layer.
 *
 * `src/context/memory/` is retired; these live at `context/memory/*`. They remain
 * exported because the legacy `user_memory` table is still the system of
 * record for pre-Phase-2 rows (a lossless migration must not delete the
 * source), and the agent's recall path reads through this engine.
 */
export {
  MemoryStore,
  projectScopeFromCwd,
  summarizeConversation,
  type AddInput,
  type AddResult,
  type CaptureOutcome,
  type MemoryHealth,
} from "./memory/store.ts";

export {
  MEMORY_CATEGORIES,
  MEMORY_SOURCES,
  GLOBAL_SCOPE,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryExport,
  type MemorySource,
  type RecallHit,
} from "./memory/types.ts";
