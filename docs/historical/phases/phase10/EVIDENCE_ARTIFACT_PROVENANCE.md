# XR 5.3 — Evidence / Artifact / Provenance — Context/Artifact Contracts

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Requirement

Documents, research reports, meeting notes, communications, analytics, records, and generated outputs must use existing context/artifact/provenance contracts. Do not create disconnected business output formats.

## Contracts Reused

- `WorkflowArtifact` from workflow/types: { artifactId, nodeId, contract, location, contentHash, createdAt }
- `ArtifactContract` kind/name
- `EvidenceRef` { kind, id, hash?, url? } where kind = context_item|research_source|document|execution_record|business_record|artifact|meeting|contact|deal
- `BusinessArtifact` (wraps WorkflowArtifact with provenance, linkedRecords, sensitivity)
- Context tiers: instructions, data, quarantine with trust, freshness, consent, provenance

## Implementation

`src/business/core/artifact-evidence.ts` — ArtifactEvidenceService:

- `createArtifact({ workspaceId, orgId, workflowRunId, nodeId, contract, content, location?, provenance, linkedRecords?, sensitivity? })` → hashes content SHA-256, persists to `biz_artifacts`, content preview 1000 chars, provenance JSON includes actor, sources, contextPackageIds, executionRefs, workflowRef, createdAt.
- `linkToRecord(artifactId, record)` — links artifact to business record
- `getArtifact`, `listByWorkspace`, `listByWorkflowRun`
- `createEvidenceRef(kind, id, content?)` → hashes content
- `verifyArtifact(artifactId, content)` → SHA-256 compare
- `getProvenance(artifactId)`

Storage: `biz_artifacts` table: artifact_id, workspace_id, org_id, workflow_run_id, node_id, contract_kind, contract_name, location, content_hash, provenance JSON, linked_records JSON, sensitivity, content_preview, created_at. Indexes workspace, run, kind.

## Artifact Kinds

- document: meeting notes, project plan, agenda
- research_report: evidence-linked report with citations, trust scores
- meeting_notes: summary from transcript, sensitivity confidential, provenance meeting transcript
- communication: message/notification with channels
- analytics: dashboard widget, report config, evidence underlying invoices/deals
- record_snapshot: previous value snapshot for reversibility

## Document/Meeting/Knowledge Integration

- Documents module: `createDocument` now also creates artifact via ArtifactEvidenceService (operating layer executes: create doc artifact with provenance manual-input or meetingId, then doc record)
- Meetings: meeting ended → transcript artifact restricted sensitivity, summary doc artifact evidenceRefs transcript artifactId, linked to meeting record, tasks
- Knowledge: research report artifact → KB article record linked, evidence sourceIds preserved
- Research engine: `finalReport` saved as artifact with contract research_report, location file path or hash, provenance sources array trust scores
- Communications: message artifacts with channels, provenance linking ticket/deal
- Analytics: dashboard/report as artifact with evidence refs to invoices/deals

All artifact content hashed, tamper-evident, provenance includes actor, sources, context packages, execution refs, workflow ref.

## Evidence Linkage Example

```ts
const artifact = artifacts.createArtifact({
  workspaceId, orgId,
  contract: { kind: 'research_report', name: 'research-evidence' },
  content: reportContent,
  provenance: {
    actor: { kind: 'user', id: actorId },
    sources: [{ kind: 'research_source', id: 'source-1' }],
    contextPackageIds: [ctxPkgId],
    executionRefs: [execId],
    workflowRef: { definitionId, runId }
  },
  linkedRecords: [{ module: 'knowledge', entity: 'article', id: articleId }],
  sensitivity: 'internal'
});

outcomes.attachArtifact(outcomeId, artifact.artifactId);
outcomes.attachEvidence(outcomeId, artifact.artifactId);
mutations.propose({ evidence: [{ kind: 'artifact', id: artifact.artifactId }], contextPackageIds: [...] });
```

## Verification

- `verifyArtifact` checks hash
- Audit includes evidenceRefs, contentHash, provenance
- Outcome view shows artifactsDetail with hash, sensitivity, provenance

## Privacy

Sensitivity levels: public, internal, confidential, restricted. Context policy filters by sensitivityMax, masks fields. Meeting transcripts restricted, never injected into cloud models without approval.

## Testing

- Artifact creation with provenance
- Link to record
- Verify hash
- List by workspace / workflow run
- Evidence ref creation
