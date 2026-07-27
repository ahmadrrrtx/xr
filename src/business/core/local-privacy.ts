/**
 * XR 5.3 — Local/Private Operation — Sensitive business/personal journeys
 * must operate locally/private where current providers/integrations support it.
 * Cloud transfer requires existing policy/consent.
 *
 * Integrates with intelligence router local-only policy + context policy.
 */

import type { BusinessDatabase } from './database.ts';
import type { PrivacyPolicy, DataSensitivity, PrivacyMode, CloudTransferPolicy } from './operating-types.ts';

export interface PrivacyDeps {
  db: BusinessDatabase;
}

export interface PrivacyCheckParams {
  workspaceId: string;
  orgId: string;
  resource: string; // e.g. contacts, invoices, employees
  sensitivity: DataSensitivity;
  operation: 'read' | 'write' | 'external_write' | 'model_inference' | 'integration_sync';
  target?: {
    provider?: string;
    model?: string;
    integrationId?: string;
    isCloud?: boolean;
  };
}

export interface PrivacyCheckResult {
  allowed: boolean;
  policy: CloudTransferPolicy;
  requiresApproval: boolean;
  requiresConsent: boolean;
  remediation?: string;
  redactedFields?: string[];
  localOnly: boolean;
}

export class LocalPrivacyService {
  constructor(private deps: PrivacyDeps) {}

  /**
   * Ensure privacy policy exists for workspace, or create default.
   */
  ensurePolicy(orgId: string, workspaceId: string, mode: PrivacyMode = 'private'): PrivacyPolicy {
    const existing = this.getPolicy(workspaceId);
    if (existing) return existing;

    const policyId = `priv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`;
    const now = new Date().toISOString();

    const policy: PrivacyPolicy = {
      policyId,
      orgId,
      workspaceId,
      mode,
      rules: this.defaultRules(mode),
      createdAt: now,
      updatedAt: now,
    };

    this.persistPolicy(policy);
    return policy;
  }

  getPolicy(workspaceId: string): PrivacyPolicy | null {
    try {
      const row = this.deps.db.prepare(`SELECT * FROM biz_privacy_policies WHERE workspace_id = ?`).get(workspaceId) as any;
      if (!row) return null;
      return this.rowToPolicy(row);
    } catch {
      return null;
    }
  }

  /**
   * Check if operation is allowed under privacy policy.
   */
  checkPrivacy(params: PrivacyCheckParams): PrivacyCheckResult {
    const policy = this.getPolicy(params.workspaceId) ?? this.ensurePolicy(params.orgId, params.workspaceId, 'private');

    // Find matching rule
    const rule = policy.rules.find(r => r.resource === params.resource || r.resource === '*') ??
      { resource: '*', sensitivity: 'internal' as DataSensitivity, transferPolicy: 'require_approval' as CloudTransferPolicy, requiresApproval: true };

    // Mode enforcement
    if (policy.mode === 'local') {
      if (params.target?.isCloud) {
        return {
          allowed: false,
          policy: 'deny',
          requiresApproval: false,
          requiresConsent: false,
          remediation: 'Workspace is in local mode — cloud transfer denied. Switch to hybrid with approval.',
          localOnly: true,
        };
      }
      // Even if not cloud flagged, model inference to cloud denied
      if (params.operation === 'model_inference' && params.target?.provider && this.isCloudProvider(params.target.provider)) {
        return {
          allowed: false,
          policy: 'deny',
          requiresApproval: false,
          requiresConsent: false,
          remediation: 'Local mode: cloud model inference blocked. Use local provider.',
          localOnly: true,
        };
      }
    }

    if (policy.mode === 'private') {
      // Restricted data never leaves local
      if (params.sensitivity === 'restricted') {
        if (params.target?.isCloud || (params.target?.provider && this.isCloudProvider(params.target.provider)) || params.operation === 'external_write' || params.operation === 'integration_sync') {
          return {
            allowed: false,
            policy: 'deny',
            requiresApproval: false,
            requiresConsent: false,
            remediation: 'Private mode: restricted data cannot be transferred to cloud or external systems.',
            localOnly: true,
            redactedFields: rule ? (rule as any).maskFields : undefined,
          };
        }
      }

      // Confidential also requires approval for cloud
      if (params.sensitivity === 'confidential' && params.target?.isCloud) {
        return {
          allowed: true,
          policy: 'require_approval',
          requiresApproval: true,
          requiresConsent: false,
          remediation: 'Confidential data cloud transfer requires approval.',
          localOnly: false,
        };
      }
    }

    // Transfer policy from rule
    switch (rule.transferPolicy) {
      case 'deny':
        if (params.operation === 'external_write' || params.operation === 'integration_sync' || params.target?.isCloud) {
          return { allowed: false, policy: 'deny', requiresApproval: false, requiresConsent: false, remediation: `Policy denies transfer for ${params.resource}`, localOnly: true };
        }
        return { allowed: true, policy: 'allow', requiresApproval: false, requiresConsent: false, localOnly: false };
      case 'require_approval':
        if (params.operation === 'external_write' || params.target?.isCloud || params.sensitivity === 'confidential' || params.sensitivity === 'restricted') {
          return { allowed: true, policy: 'require_approval', requiresApproval: true, requiresConsent: false, remediation: `Requires approval for ${params.resource} ${params.operation}`, localOnly: false, redactedFields: (rule as any).maskFields };
        }
        return { allowed: true, policy: 'allow', requiresApproval: false, requiresConsent: false, localOnly: false };
      case 'require_consent':
        return { allowed: true, policy: 'require_consent', requiresApproval: false, requiresConsent: true, remediation: `Requires consent for ${params.resource}`, localOnly: false };
      case 'allow':
      default:
        return { allowed: true, policy: 'allow', requiresApproval: false, requiresConsent: false, localOnly: false };
    }
  }

  /**
   * Enforce context scope before retrieval/injection.
   */
  enforceContextScope(params: {
    workspaceId: string;
    sensitivityMax: DataSensitivity;
    requestedTier: 'instructions' | 'data' | 'quarantine';
    containsSensitive: boolean;
  }): { allowed: boolean; filtered: boolean; reason?: string } {
    const sensitivityOrder: Record<DataSensitivity, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };
    const requestedMax = sensitivityOrder[params.sensitivityMax] ?? 1;

    if (params.containsSensitive) {
      // If requested tier is data and contains restricted, ensure sensitivityMax allows restricted
      if (params.requestedTier === 'data' && requestedMax < sensitivityOrder['restricted']) {
        return { allowed: false, filtered: true, reason: `Data contains restricted sensitivity but max allowed is ${params.sensitivityMax}` };
      }
    }

    return { allowed: true, filtered: false };
  }

  /**
   * Check if provider is cloud.
   */
  isCloudProvider(provider: string): boolean {
    const cloudProviders = ['openai', 'anthropic', 'google', 'mistral', 'cohere', 'bedrock', 'azure', 'openai-compat'];
    // Local providers: ollama, local, llama.cpp etc.
    const localProviders = ['ollama', 'local', 'llamacpp', 'kobold', 'lmstudio'];
    if (localProviders.includes(provider.toLowerCase())) return false;
    if (cloudProviders.includes(provider.toLowerCase())) return true;
    // Default heuristic: if contains local, not cloud
    if (provider.toLowerCase().includes('local') || provider.toLowerCase().includes('ollama')) return false;
    return true; // conservative: assume cloud
  }

  private defaultRules(mode: PrivacyMode): PrivacyPolicy['rules'] {
    if (mode === 'local') {
      return [
        { resource: '*', sensitivity: 'restricted', transferPolicy: 'deny', requiresApproval: false, maskFields: [] },
      ];
    }
    if (mode === 'private') {
      return [
        { resource: 'employees', sensitivity: 'restricted', transferPolicy: 'deny', requiresApproval: false, maskFields: ['salary', 'ssn'] },
        { resource: 'time_off', sensitivity: 'confidential', transferPolicy: 'require_approval', requiresApproval: true },
        { resource: 'meetings', sensitivity: 'confidential', transferPolicy: 'require_approval', requiresApproval: true, maskFields: ['transcript'] },
        { resource: 'contacts', sensitivity: 'confidential', transferPolicy: 'require_approval', requiresApproval: true, maskFields: ['email', 'phone'] },
        { resource: 'invoices', sensitivity: 'confidential', transferPolicy: 'require_approval', requiresApproval: true },
        { resource: 'biz_credentials', sensitivity: 'restricted', transferPolicy: 'deny', requiresApproval: false },
        { resource: '*', sensitivity: 'internal', transferPolicy: 'require_approval', requiresApproval: false },
      ];
    }
    // hybrid
    return [
      { resource: 'employees', sensitivity: 'restricted', transferPolicy: 'require_approval', requiresApproval: true, maskFields: ['salary'] },
      { resource: 'biz_credentials', sensitivity: 'restricted', transferPolicy: 'deny', requiresApproval: false },
      { resource: '*', sensitivity: 'internal', transferPolicy: 'allow', requiresApproval: false },
    ];
  }

  private persistPolicy(policy: PrivacyPolicy): void {
    try {
      this.deps.db.prepare(`
        INSERT OR REPLACE INTO biz_privacy_policies
        (policy_id, org_id, workspace_id, mode, rules, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        policy.policyId,
        policy.orgId,
        policy.workspaceId,
        policy.mode,
        JSON.stringify(policy.rules),
        policy.createdAt,
        policy.updatedAt
      );
    } catch (e) {
      console.warn(`[PrivacyService] persist failed:`, (e as Error).message);
    }
  }

  private rowToPolicy(row: any): PrivacyPolicy {
    return {
      policyId: row.policy_id,
      orgId: row.org_id,
      workspaceId: row.workspace_id,
      mode: row.mode,
      rules: row.rules ? JSON.parse(row.rules) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
