# XR 5.3 — Organization and Role Boundaries — RBAC / Data Scope

## Entities (reuse existing RBAC/business foundations, no second identity system)

- **User:** `biz_members.userId` maps to XR workspace user. Single identity.
- **Organization:** Top-level tenant, owns workspaces, members, audit chain per org. `biz_organizations`.
- **Workspace/Project:** Isolation unit. `biz_workspaces` with settings: `privacyMode: local|private|hybrid`, `allowedProviders`, `modules`, `aiWorkersEnabled`. Unit of data isolation.
- **Role:** owner, admin, manager, member, viewer, guest. Defaults preserved, plus custom permissions.
- **AI Worker:** Authority profile per workspace, delegated authority limited to workspaceIds. Cannot exceed deployer's effective permissions.
- **Delegated Authority:** `resolveEffectiveWorkerAuthority(deployerMemberId, workerProfile, workspaceId)` = intersection deployer ∩ worker declared.
- **Record/Data Scope:** Each query filtered by orgId+workspaceId via `AuthorityBoundaryService.enforceScope`. Cross-workspace denied unless explicitly org-read and RBAC passes and privacy allows.
- **Approval Authority:** owner/admin can approve elevated, manager standard for workspace modules, member can approve review for own tasks, viewer cannot approve.
- **Audit Visibility:** owner/admin full, manager workspace, member own+non-sensitive, viewer limited, guest none. Private data (HR salary) only owner/admin/HR manager.

## Implementation

- `src/business/core/authority-boundaries.ts`: `checkAccess`, `checkWorkerAuthority`, `checkApprovalAuthority`, `getAuditVisibility`, `resolveDelegatedAuthority`.
- Integrates with `trust/authority.ts` effective authority.
- Uses existing BusinessDatabase joins, not new identity.
- Sensitivity levels: public 0, internal 1, confidential 2, restricted 3.

## Data Scope Enforcement

```ts
const check = authority.checkAccess({ memberId, workspaceId, orgId, resource: 'invoices', action: 'read', dataSensitivity: 'confidential' });
if (!check.allowed) throw...
if (check.requiresApproval) create approval...
```

Cross-workspace:

```ts
if (!profile.dataAccess.crossWorkspace && !profile.organization.workspaceIds.includes(workspaceId)) denied
```

## Privacy Integration

HR employees, meeting transcripts, credentials marked restricted/confidential. Private mode denies cloud transfer. See LOCAL_PRIVATE_PRIVACY.md.

## Testing

- Unauthorized access denied tests
- Cross-workspace leakage tests
- Approval authority tests
- Audit visibility per role
- Worker delegated authority cannot exceed deployer
