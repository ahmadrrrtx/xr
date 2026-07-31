/**
 * XR 5.3 — Business Workflow Templates — Canonical workflow definitions
 * for each journey using WorkflowDefinition types. Versioned, integrity-hashed,
 * published via WorkflowEngine. No visual editor.
 *
 * Each template maps to journey definitions.
 */

import type { WorkflowDefinition } from '../../execution/workflow/types.ts';
import { JOURNEY_DEFINITIONS } from './journeys.ts';

export function createWorkflowTemplateForJourney(journeyId: string): WorkflowDefinition | null {
  const journey = JOURNEY_DEFINITIONS.find(j => j.id === journeyId);
  if (!journey) return null;

  // Map journey workflow spec nodes to canonical WorkflowNode types
  const nodes = journey.workflow.nodes.map((n, idx) => {
    const deps = idx === 0 ? [] : [journey.workflow.nodes[idx - 1].id];
    // Special handling for entry
    const entryDeps = idx === 0 ? [] : deps;

    const base = {
      id: n.id,
      name: n.name,
      description: `${journey.name} - ${n.name}`,
      dependencies: entryDeps,
      retry: { maxAttempts: n.kind === 'agentic' ? 2 : 1, backoffMs: 1000, backoffMultiplier: 2 },
      timeout: { maxMs: 30000, perAttemptMs: 15000 },
      cost: { estimatedUsd: journey.outcomes.costBudget.maxUsd / journey.workflow.nodes.length },
      tags: [journey.category, journeyId],
      contentHash: '',
    };

    switch (n.kind) {
      case 'trigger':
        return {
          ...base,
          kind: 'trigger' as const,
          triggerKind: journey.trigger.kind,
          eventType: journey.trigger.eventType,
          intentPattern: journey.trigger.intentPattern,
          inputSchema: {},
        };
      case 'deterministic':
        return {
          ...base,
          kind: 'deterministic' as const,
          handler: `${journeyId}.${n.id}`,
          deterministic: true,
          inputMapping: {},
          outputMapping: {},
        };
      case 'agentic':
        return {
          ...base,
          kind: 'agentic' as const,
          agentRole: 'researcher',
          instruction: `Execute ${n.name} for journey ${journey.name}`,
          providerScope: { routingPolicy: journey.context.locality === 'local' ? 'local-only' : journey.context.locality === 'private' ? 'local-first' : 'cost-constrained' },
          toolScope: { mode: 'allowlist', tools: ['memory-recall', 'context-retrieval'] },
          contextTiers: journey.context.tiers,
          includeUserMemory: journey.context.includeUserMemory,
          budget: { maxUsd: journey.outcomes.costBudget.maxUsd / 2, maxTokens: journey.outcomes.costBudget.maxTokens, maxSteps: 8 },
        };
      case 'human_approval':
        return {
          ...base,
          kind: 'human_approval' as const,
          approvalKind: 'approval' as const,
          title: n.name,
          description: `Approval required for ${n.name} in ${journey.name}`,
          severity: 'warning' as const,
          channels: ['dashboard', 'cli'] as any,
          recipients: [{ kind: 'role', id: 'manager' }],
          evidenceRequired: true,
          expiresInMs: 2 * 60 * 60 * 1000,
        };
      case 'human_review':
        return {
          ...base,
          kind: 'human_review' as const,
          reviewKind: 'review' as const,
          title: n.name,
          description: `Review required for ${n.name}`,
          severity: 'info' as const,
          channels: ['dashboard', 'cli'] as any,
          recipients: [{ kind: 'user', id: 'owner' }],
          evidenceRequired: true,
          expiresInMs: 24 * 60 * 60 * 1000,
        };
      case 'business_record':
        return {
          ...base,
          kind: 'business_record' as const,
          module: journey.category,
          operation: 'create' as const,
          entity: n.id.includes('task') ? 'task' : n.id.includes('meeting') ? 'meeting' : n.id.includes('invoice') ? 'invoice' : n.id.includes('deal') ? 'deal' : 'record',
          data: {},
          reversible: true,
        };
      case 'tool_action':
        return {
          ...base,
          kind: 'tool_action' as const,
          tool: n.id.includes('invoice') ? 'finance.send_invoice' : n.id.includes('task') ? 'business.tasks.create' : 'business.generic',
          capability: { kind: 'business', name: n.id },
          inputs: {},
          riskTier: n.id.includes('invoice') ? 'tier2' : 'tier0',
        };
      case 'notification':
        return {
          ...base,
          kind: 'notification' as const,
          channels: ['dashboard', 'cli'] as any,
          severity: 'info' as const,
          message: `Notification for ${n.name}`,
          recipients: [{ kind: 'role', id: 'member' }],
        };
      case 'artifact_output':
        return {
          ...base,
          kind: 'artifact_output' as const,
          contract: { kind: 'document', name: `${journeyId}-${n.id}` },
          location: `artifacts/${journeyId}/${n.id}`,
          contentHash: '',
        };
      case 'branch':
        return {
          ...base,
          kind: 'branch' as const,
          condition: { expression: 'value > threshold' },
          trueBranch: [],
          falseBranch: [],
        };
      case 'completion':
        return {
          ...base,
          kind: 'completion' as const,
          outcome: 'success' as const,
          message: `${journey.name} completed successfully`,
        };
      default:
        return {
          ...base,
          kind: 'deterministic' as const,
          handler: `${journeyId}.${n.id}`,
          deterministic: true,
          inputMapping: {},
          outputMapping: {},
        };
    }
  });

  const entryNodeIds = nodes.length > 0 ? [nodes[0].id] : [];

  // Compute content hash (simple FNV-1a as in workflow/types)
  const canonical = JSON.stringify({
    definitionId: journey.workflow.definitionId,
    version: journey.workflow.version,
    nodes: nodes.map((n: any) => ({ id: n.id, kind: n.kind })),
    entryNodeIds,
  });
  let h = 2166136261 >>> 0;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const contentHash = h.toString(16).padStart(8, '0');

  const definition: WorkflowDefinition = {
    definitionId: journey.workflow.definitionId,
    version: journey.workflow.version,
    name: journey.name,
    description: journey.description,
    nodes: nodes as any,
    entryNodeIds,
    active: true,
    tags: [journey.category, journey.id],
    createdAt: Date.now(),
    publishedAt: Date.now(),
    contentHash,
  } as any;

  return definition;
}

export function getAllBusinessWorkflowTemplates(): WorkflowDefinition[] {
  return JOURNEY_DEFINITIONS.map(j => createWorkflowTemplateForJourney(j.id)).filter(Boolean) as WorkflowDefinition[];
}

export function getTemplateByDefinitionId(definitionId: string): WorkflowDefinition | null {
  const journey = JOURNEY_DEFINITIONS.find(j => j.workflow.definitionId === definitionId);
  if (!journey) return null;
  return createWorkflowTemplateForJourney(journey.id);
}
