# XR 5.3 — Local and Private Operation — Privacy Matrix

## Requirement (Spec 6.7)

Sensitive business/personal journeys must operate locally/private where current providers/integrations support it. Cloud transfer requires existing policy/consent.

## Privacy Modes

- **Local:** All execution, context, intelligence routing stays local. No cloud provider calls unless explicitly allowed. Intelligence router policy local-only, context retrieval filtered local, no external integrations auto-triggered.
- **Private:** Local + no external writes without elevated approval. Sensitive data (HR salary, meeting transcript, PII) marked restricted, never injected into cloud models. Context injection masks PII.
- **Hybrid:** Allows cloud routing with policy/consent, but sensitive fields still private. Existing policy/consent mechanism used.

## Data Sensitivity Levels

- public 0: blog posts, public KB
- internal 1: project plans, tasks, non-sensitive docs
- confidential 2: contacts PII (email, phone), invoices, deals, calendar, meetings notes
- restricted 3: HR salary, SSN, meeting transcript, credentials, worker conversations containing business data

## Default Rules per Mode

Local mode:

- `*: restricted deny` (no cloud transfer)

Private mode (default):

- employees restricted deny credentials, mask salary, ssn
- time_off confidential require_approval
- meetings confidential require_approval mask transcript
- contacts confidential require_approval mask email phone
- invoices confidential require_approval
- biz_credentials restricted deny
- * internal require_approval (conservative)

Hybrid:

- employees restricted require_approval mask salary
- biz_credentials restricted deny
- * internal allow

## Enforcement

`src/business/core/local-privacy.ts` LocalPrivacyService:

- `ensurePolicy(orgId, workspaceId, mode)` → creates default if missing, persists to `biz_privacy_policies`
- `getPolicy(workspaceId)`
- `checkPrivacy({ workspaceId, orgId, resource, sensitivity, operation: read|write|external_write|model_inference|integration_sync, target: { provider?, model?, integrationId?, isCloud? } })` → returns { allowed, policy allow|require_approval|require_consent|deny, requiresApproval, requiresConsent, remediation, redactedFields?, localOnly }
- `enforceContextScope({ workspaceId, sensitivityMax, requestedTier, containsSensitive })` → allowed, filtered, reason
- `isCloudProvider(provider)` → heuristics local vs cloud

Examples:

- Local mode + cloud provider → denied, remediation "Local mode: cloud model inference blocked. Use local provider."
- Private mode + restricted + external_write → denied, remediation "Private mode: restricted data cannot be transferred"
- Private + confidential + cloud → require_approval
- * + allow → allowed

Context scope enforcement before retrieval/injection: if requested tier data contains restricted but max allowed internal, filtered.

## Intelligence Router Integration

Use existing `intelligence/router.ts` with policy:

- local-only: rejects cloud
- local-first: prefers local without keys
- cost-constrained: prefers free/local

Business layer calls `buildProviderWithDecision` with policy from workspace privacy.

## Integrations/Credentials

- External writes require policy check + approval
- If workspace private and integration connector cloud (Salesforce, etc), requires elevated approval + consent flag in `biz_privacy_policies`
- Trust/credential contracts: task_scoped refs, not raw secrets in prompts. CredentialVault encrypts.

## Audit

Sensitive data masked in audit metadata, but hash chain preserved. Provenance includes sensitivity flag.

## CLI / Daemon

- `xr business privacy --workspace ws1` shows policy
- Daemon `GET /api/business/privacy/:workspaceId` returns policy
- Dashboard shows privacy mode badge local/private/hybrid and localOnly flag

## Testing

- Privacy policy enforcement local vs private vs hybrid
- Restricted data never leaves local
- Confidential requires approval for cloud
- Local mode blocks cloud provider
- Context leakage prevented via sensitivity check
- See `test/business/operating-layer.test.ts` Local/Private Operation section
