# XR 6.1 — Policy and Authority Guide

**Audience:** organization administrators, workspace administrators, and developers integrating with XR policy.
**Modules:** `src/enterprise/policy/`, `src/enterprise/authority/`

---

## 1. The rule that matters most

> **Organization policy can restrict what an AI may do. It can never hide what the AI did, what policy applied, what data was in scope, or that an incident affected a user.**

If you remember one thing from this guide, remember that. It is enforced in code, not by convention.

---

## 2. Policy layers

| Layer | Who authors it | Privilege | Specificity |
|---|---|---|---|
| `platform_default` | XR itself | 5 | 0 |
| `deployment` | Deployment operator | 4 | 1 |
| `organization` | Organization admins | 3 | 2 |
| `workspace` | Workspace admins | 2 | 3 |
| `user_task` | The user, per task | 1 | 4 |
| `capability` | A capability, about itself | 0 | 5 |

- **Privilege** decides who may *write* a layer. A workspace admin cannot author an organization rule.
- **Specificity** decides which value wins for ordinary preferences.

```bash
xr enterprise policy layers
```

---

## 3. How a value is chosen

### 3.1 User-visibility invariants → always `true`

| Key | Guarantee |
|---|---|
| `showApprovalRequests` | Users see approval requests involving their work. |
| `showPolicyEffects` | Users see which policy restricted an action. |
| `showDataScope` | Users see what data an action can read or write. |
| `showActionProvenance` | Users see which actor or capability acted. |
| `showCapabilityTrust` | Users see trust, signature, and quarantine state. |
| `showIncidentImpact` | Users see incidents affecting their workspace. |

Any rule setting one of these to `false` is **rejected at authoring time** and recorded as a `critical` override attempt. This holds at every layer, including `platform_default`.

```bash
$ xr enterprise policy set showApprovalRequests=false --layer organization --reason "reduce friction"
✗ Rule 'showApprovalRequests' attempts to suppress a user-visibility invariant
  and cannot be included in a bundle.
  rejected: showApprovalRequests at organization —
    User-visibility invariants cannot be disabled. This rule was rejected at authoring time.
```

### 3.2 Safety-relevant keys → most restrictive wins

| Key | Stricter direction |
|---|---|
| `minRiskTier` | higher tier (more isolated) |
| `requireApprovalAbove` | **lower** threshold (more approvals) |
| `allowNetworkEgress` | `false` |
| `allowFilesystemWrite` | `false` |
| `allowProcessSpawn` | `false` |
| `allowRemotePlacement` | `false` |
| `allowUnsignedCapabilities` | `false` |
| `allowUncertifiedCapabilities` | `false` |

A **more privileged layer cannot loosen a stricter lower layer.** If a workspace forbids filesystem writes, the organization cannot re-enable them. The attempt is recorded as a `warning`.

### 3.3 Everything else → most specific wins

Ordinary preferences (model choice, verbosity, theme) follow normal precedence: `capability` > `user_task` > `workspace` > `organization` > `deployment` > `platform_default`.

---

## 4. Working with policy

### Inspect

```bash
xr enterprise policy show                          # effective policy + trace
xr enterprise policy show --org acme --workspace eng
xr enterprise policy explain allowNetworkEgress    # why one key resolved
xr enterprise policy show --json                   # full resolution object
```

```
$ xr enterprise policy explain allowNetworkEgress
allowNetworkEgress = false (most restrictive, from organization)
  → organization: false — applied: most restrictive value
    platform_default: true — not applied: weaker than effective value
```

### Set

A `--reason` is **mandatory**. It is shown to every user the rule affects.

```bash
xr enterprise policy set allowNetworkEgress=false \
  --layer organization \
  --reason "No outbound network without a reviewed exception (SEC-114)."
```

### Bundles and rollback

Policy ships as versioned, hashed, reversible bundles.

```bash
xr enterprise policy bundles --org acme
xr enterprise policy rollback pb_0faa2c42 --reason "Blocked a legitimate workflow."
```

Rollback re-validates the target bundle. It may undo administrative changes; it can never reinstate a bundle that violates a safety invariant.

### Programmatic

```ts
import { resolvePolicy, createEffectivePolicy, policyRule } from "@rrrtx/xr/enterprise";

const resolution = resolvePolicy(rules, { organizationId: "acme", workspaceId: "eng" });
const policy = createEffectivePolicy(resolution);

policy.getBoolean("allowNetworkEgress", true);  // false
policy.userVisibleEffects();                    // what the user must be shown
resolution.rejectedOverrides;                   // every weakening attempt
```

---

## 5. Delegated authority

XR does **not** introduce a new identity system. Subjects reference existing ids:

| Subject kind | `subjectId` source |
|---|---|
| `user` | business `Member.id` or Phase 11 `RemoteIdentity.identityId` |
| `service` | `RemoteIdentity.identityId` |
| `ai_worker` | business `AIWorker.id` |
| `workspace` | `Workspace.id` |

### Delegating to an AI worker

```ts
const result = services.authority.delegate({
  delegator: { kind: "user", subjectId: "member_alice", organizationId: "acme" },
  delegate:  { kind: "ai_worker", subjectId: "worker_sales", organizationId: "acme" },
  requestedScopes: ["crm:read", "crm:update", "email:send"],
  requestedMaxRiskTier: "tier1_restricted",
  delegatorAuthority: rootAuthority({
    subject: { kind: "user", subjectId: "member_alice" },
    scopes: ["crm:read", "crm:update"],          // note: no email:send
    maxRiskTier: "tier2_isolated",
  }),
  expiresAt: Date.now() + 30 * 86_400_000,
  reason: "Automate CRM follow-ups for Q3.",
  requiresApprovalFor: ["crm:update"],
});

result.delegation.scopes;          // ["crm:read", "crm:update"]  ← subset only
result.validation.deniedScopes;    // ["email:send"]              ← stripped, not granted
```

**Guarantees:**
- Requested scopes not held by the delegator are **stripped**, never granted.
- The risk ceiling is `min(requested, delegator's)` — it only narrows down a chain.
- Chain depth is bounded at 4.
- Cross-organization delegation is refused.
- Scopes support one trailing wildcard: `crm:*` holds `crm:read`.

### Checking authority

```bash
xr enterprise authority list --delegate worker_sales
xr enterprise authority effective worker_sales
```

```ts
const decision = services.authority.authorize(worker, "crm:update", "tier1_restricted", policy);
// { allowed: true, requiresApproval: true, reason: "Allowed, but explicit human approval is required." }
```

### Policy narrows authority — visibly

```ts
const eff = services.authority.effectiveAuthority(worker, policy);
eff.scopes;              // net:egress removed
eff.restrictedByPolicy;  // [{ scope: "net:egress", reason: "Network egress is disabled by policy (allowNetworkEgress=false)." }]
```

The reason is always populated. A user asking "why couldn't the agent do X?" always gets an answer.

### Revocation

Revocation is immediate and **cascades** to every descendant delegation.

```bash
xr enterprise authority revoke del_abc123 --reason "Worker credentials rotated."
```

```
✓ Revoked 3 delegation(s) (including cascaded sub-delegations).
```

Use `suspend` / `reinstate` for reversible containment during an investigation.

### Access reviews

Delegations carry a review due date (default 90 days) and become `pending_review` when overdue.

```bash
xr enterprise authority reviews
```

```ts
services.authority.review({
  delegationId,
  reviewedBy: "member_alice",
  outcome: "reduced",              // affirmed | reduced | revoked | deferred
  notes: "Email scope no longer needed.",
  scopesAfter: ["crm:read"],
});
```

A review may only **reduce** scope. Attempting to expand is silently filtered — verified by test.

> Access reviews are an **operational** control (AC-06). XR surfaces the queue; your organization must actually perform them.

---

## 6. Common recipes

**Lock a workspace to local-only, isolated execution**

```bash
xr enterprise policy set allowRemotePlacement=false --layer workspace --reason "Regulated data (DPA-7)."
xr enterprise policy set minRiskTier=tier2_isolated --layer workspace --reason "Regulated data (DPA-7)."
```

**Require approval for anything above trivial risk**

```bash
xr enterprise policy set requireApprovalAbove=tier0_in_process --layer organization \
  --reason "Human approval for any non-trivial action."
```

**Require signed, certified capabilities only**

```bash
xr enterprise policy set allowUnsignedCapabilities=false --layer organization --reason "Supply-chain policy."
xr enterprise policy set allowUncertifiedCapabilities=false --layer organization --reason "Supply-chain policy."
```

**Give an AI worker read-only authority with a short lifetime**

```ts
services.authority.delegate({
  delegator: alice,
  delegate: readOnlyWorker,
  requestedScopes: ["crm:read", "docs:read"],
  requestedMaxRiskTier: "tier0_in_process",
  delegatorAuthority: rootAuthority({ subject: alice, scopes: ["crm:*", "docs:*"], maxRiskTier: "tier2_isolated" }),
  expiresAt: Date.now() + 86_400_000,   // 24 hours
  reason: "Read-only reporting run.",
  canSubDelegate: false,
});
```

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Rule must include a reason" | Reasons are mandatory; users see them. | Add `--reason`. |
| "insufficient privilege" | Authoring above your layer. | Author at your own layer or below. |
| Rule accepted but not in effect | A stricter layer wins. | `xr enterprise policy explain <key>` shows which layer won. |
| Delegation granted fewer scopes | Delegator did not hold them. | Check `validation.deniedScopes`; grant the delegator first. |
| Worker suddenly has no authority | Parent delegation revoked, or expired. | `xr enterprise authority list` shows state. |
| Visibility rule rejected | By design — non-overridable. | Restrict the *action* instead of hiding it. |

---

## 8. What is enforced vs. what is process

| Guarantee | Assurance |
|---|---|
| Most-restrictive resolution | **technical** — `policy/engine.ts`, tested |
| Visibility invariants | **technical** — tested at every layer |
| Override attempts recorded | **technical** — tested |
| Subset delegation | **technical** — tested |
| Cascading revocation | **technical** — tested |
| Access reviews actually happen | **operational** — your process |
| Reasons are meaningful | **operational** — XR requires a reason, not a *good* one |
