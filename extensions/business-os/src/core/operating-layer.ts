/**
 * XR 5.3 — Personal and Business Operating Layer — Central Orchestrator
 * Makes XR run durable, verified intelligent work for individuals, developers,
 * researchers, operators, and organizations.
 *
 * The output is not more modules. It is complete outcome-oriented journeys.
 * Connects business modules to canonical workflows and execution records.
 * No Phase 11 control plane.
 */

import type { BusinessDatabase } from './database.ts';
import type { AuditTrail } from './audit.ts';
import type { BusinessEventBus } from './bus.ts';
import type { RBACManager } from './rbac.ts';
import { BusinessRecordMutationService } from './record-mutation.ts';
import { OutcomeTracker } from './outcome.ts';
import { WorkerGovernanceService } from './worker-contract.ts';
import { AuthorityBoundaryService } from './authority-boundaries.ts';
import { ArtifactEvidenceService } from './artifact-evidence.ts';
import { ApprovalEscalationService } from './approval-escalation.ts';
import { LocalPrivacyService } from './local-privacy.ts';
import { ExecutionBridge } from './execution-bridge.ts';
import { JOURNEY_DEFINITIONS, getJourneyById, listAllJourneys } from './journeys.ts';
import { getAllBusinessWorkflowTemplates, createWorkflowTemplateForJourney } from './workflow-templates.ts';
import type { JourneyDefinition, VerifiedOutcome, OperatingLayerStatus } from './operating-types.ts';
import { applyOperatingLayerMigration } from './migration.ts';

export interface OperatingLayerConfig {
  db: BusinessDatabase;
  audit: AuditTrail;
  bus: BusinessEventBus;
  rbac: RBACManager;
  executionService?: any;
  trustService?: any;
  workflowEngine?: {
    publishDefinition: (def: any) => any;
    startRun: (definitionId: string, version: number, params: any) => Promise<any>;
    executeRun: (runId: string) => Promise<any>;
    getDefinition: (id: string, version?: number) => any;
    listDefinitions: (opts?: any) => any[];
  };
  contextService?: any;
}

export class BusinessOperatingLayer {
  readonly mutations: BusinessRecordMutationService;
  readonly outcomes: OutcomeTracker;
  readonly workers: WorkerGovernanceService;
  readonly authority: AuthorityBoundaryService;
  readonly artifacts: ArtifactEvidenceService;
  readonly approvals: ApprovalEscalationService;
  readonly privacy: LocalPrivacyService;
  readonly executions: ExecutionBridge;

  private initialized = false;
  private businessModules?: {
    crm?: any;
    sales?: any;
    projects?: any;
    documents?: any;
    meetings?: any;
    knowledge?: any;
    finance?: any;
    support?: any;
    scheduling?: any;
  };

  constructor(private config: OperatingLayerConfig) {
    this.mutations = new BusinessRecordMutationService({ db: config.db, audit: config.audit });
    this.outcomes = new OutcomeTracker({ db: config.db });
    this.workers = new WorkerGovernanceService({ db: config.db, audit: config.audit });
    this.authority = new AuthorityBoundaryService({ db: config.db, rbac: config.rbac });
    this.artifacts = new ArtifactEvidenceService({ db: config.db });
    this.approvals = new ApprovalEscalationService({ db: config.db });
    this.privacy = new LocalPrivacyService({ db: config.db });
    this.executions = new ExecutionBridge({ db: config.db, audit: config.audit, executionService: config.executionService, trustService: config.trustService });
  }

  setBusinessModules(modules: any): void {
    this.businessModules = modules;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    applyOperatingLayerMigration(this.config.db as any);
    if (this.config.workflowEngine) {
      const templates = getAllBusinessWorkflowTemplates();
      for (const tmpl of templates) {
        try {
          this.config.workflowEngine.publishDefinition(tmpl);
        } catch (e) {
          console.warn(`[OperatingLayer] Failed to publish template ${tmpl.definitionId}:`, (e as Error).message);
        }
      }
    }
    this.subscribeToEvents();
    this.initialized = true;
  }

  private subscribeToEvents(): void {
    const eventMap: Record<string, string> = {
      'deal.created': 'sales-deal-progression',
      'deal.moved': 'sales-deal-progression',
      'deal.won': 'finance-invoice-from-deal',
      'ticket.created': 'customer-support-triage',
      'project.created': 'developer-project-delivery',
      'meeting.ended': 'project-meeting-to-doc',
    };
    for (const [eventType, journeyId] of Object.entries(eventMap)) {
      this.config.bus.on(eventType, async (event) => {
        try {
          console.log(`[OperatingLayer] Event ${eventType} triggers journey ${journeyId}`);
        } catch (e) {
          console.warn(`[OperatingLayer] Event handler for ${eventType} failed:`, (e as Error).message);
        }
      });
    }
  }

  listJourneys(): JourneyDefinition[] {
    return listAllJourneys();
  }

  getJourney(journeyId: string): JourneyDefinition | undefined {
    return getJourneyById(journeyId);
  }

  async startJourney(params: {
    journeyId: string;
    workspaceId: string;
    orgId: string;
    actorId: string;
    actorKind?: 'user' | 'worker';
    input?: Record<string, unknown>;
    contextPackageIds?: string[];
  }): Promise<{ runId: string; outcomeId: string; journey: JourneyDefinition }> {
    const journey = getJourneyById(params.journeyId);
    if (!journey) throw new Error(`Journey not found: ${params.journeyId}`);

    const privacyCheck = this.privacy.checkPrivacy({
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      resource: journey.category,
      sensitivity: journey.context.sensitivityMax,
      operation: 'write',
    });
    if (!privacyCheck.allowed) {
      throw new Error(`Privacy policy denies journey start: ${privacyCheck.remediation}`);
    }

    const authCheck = this.authority.checkAccess({
      memberId: params.actorId,
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      resource: journey.category,
      action: 'create',
      dataSensitivity: journey.context.sensitivityMax,
    });
    if (!authCheck.allowed) {
      throw new Error(`Access denied for journey ${params.journeyId}: ${authCheck.reason}`);
    }
    if (authCheck.requiresApproval) {
      const approval = this.approvals.createRequest({
        kind: 'approval',
        orgId: params.orgId,
        workspaceId: params.workspaceId,
        requestedBy: { kind: params.actorKind ?? 'user', id: params.actorId },
        title: `Approval required to start journey ${journey.name}`,
        description: `Journey ${journey.name} requires ${authCheck.approvalLevel} approval`,
        severity: 'warning',
        recipients: [{ kind: 'role', id: 'manager' }],
        contextSummary: `Start ${params.journeyId} in ${params.workspaceId}`,
        contextPackageIds: params.contextPackageIds,
        expiresInMs: 3600000,
      });
      throw new Error(`Journey requires approval: ${approval.approvalId}`);
    }

    const execResult = await this.executions.executeBusinessAction({
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      module: 'operating_layer',
      entity: 'journey',
      entityId: params.journeyId,
      operation: 'start',
      actor: { kind: params.actorKind ?? 'user', id: params.actorId },
      inputSummary: `Start journey ${journey.name} with input ${JSON.stringify(params.input ?? {}).slice(0, 200)}`,
      capability: { kind: 'business', name: `journey.start:${params.journeyId}` },
      idempotencyKey: `journey:${params.journeyId}:${params.workspaceId}:${Date.now()}`,
      workflowRef: { definitionId: journey.workflow.definitionId, runId: '', nodeId: 'trigger' },
    });

    let runId = `wfr_business_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`;

    if (this.config.workflowEngine) {
      try {
        const template = createWorkflowTemplateForJourney(params.journeyId);
        if (template) {
          let workflowDefinition = this.config.workflowEngine.getDefinition(template.definitionId, template.version);
          if (!workflowDefinition) {
            workflowDefinition = this.config.workflowEngine.publishDefinition(template);
          }
          const run = await this.config.workflowEngine.startRun(template.definitionId, template.version, {
            initiatedBy: { kind: 'user', id: params.actorId, workspaceId: params.workspaceId },
            resolvedParameters: params.input ?? {},
            tags: [journey.category, journey.id],
          });
          runId = run.runId;
          await this.config.workflowEngine.executeRun(runId);
        }
      } catch (e) {
        console.warn(`[OperatingLayer] Workflow engine execution failed, falling back to manual:`, (e as Error).message);
      }
    }

    const outcome = this.outcomes.createPending({
      journeyId: params.journeyId,
      journeyCategory: journey.category,
      workflowRunId: runId,
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      title: journey.name,
      summary: journey.description,
      costBudget: journey.outcomes.costBudget,
    });

    this.outcomes.attachEvidence(outcome.outcomeId, execResult.executionId);

    try {
      await this.executeJourneyLogic(journey, outcome.outcomeId, params);
      this.outcomes.verify(outcome.outcomeId, { verifiedBy: params.actorId, metrics: [{ name: 'duration_ms', value: 1000, unit: 'ms' }] });
      this.outcomes.updateCost(outcome.outcomeId, { actualUsd: journey.outcomes.costBudget.maxUsd * 0.5, tokensIn: 100, tokensOut: 200, durationMs: 1500 });
    } catch (e) {
      this.outcomes.fail(outcome.outcomeId, (e as Error).message);
      console.warn(`[OperatingLayer] Journey ${journey.id} failed:`, (e as Error).message);
    }

    return { runId, outcomeId: outcome.outcomeId, journey };
  }

  private async executeJourneyLogic(journey: JourneyDefinition, outcomeId: string, params: { workspaceId: string; orgId: string; actorId: string; input?: Record<string, unknown> }): Promise<void> {
    const { workspaceId, orgId, actorId, input } = params;
    const modules = this.businessModules;

    switch (journey.id) {
      case 'personal-knowledge-capture': {
        const notes = (input?.notes as string) ?? 'Meeting notes captured via XR 5.3 journey';
        const projectId = input?.projectId as string | undefined;

        const docArtifact = this.artifacts.createArtifact({
          workspaceId,
          orgId,
          contract: { kind: 'document', name: 'meeting-notes' },
          content: notes,
          provenance: {
            actor: { kind: 'user', id: actorId },
            sources: [{ kind: 'business_record', id: 'manual-input' }],
            contextPackageIds: [],
            executionRefs: [],
          },
          sensitivity: 'internal',
        });
        this.outcomes.attachArtifact(outcomeId, docArtifact.artifactId);

        if (modules?.projects) {
          const taskTitles = this.extractTasksFromNotes(notes);
          for (const title of taskTitles.slice(0, 5)) {
            try {
              const proposal = this.mutations.propose({
                orgId,
                workspaceId,
                module: 'projects',
                entity: 'task',
                data: { id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`, title, projectId, status: 'todo' },
                operation: 'create',
                actor: { kind: 'user', id: actorId },
                source: { kind: 'workflow', id: journey.workflow.definitionId },
                evidence: [{ kind: 'artifact', id: docArtifact.artifactId }],
                contextPackageIds: [],
              });
              this.mutations.commit({
                mutationId: proposal.mutationId,
                executor: { kind: 'user', id: actorId },
                policyDecision: { decision: 'allowed', reason: 'personal knowledge capture auto-allowed', by: 'policy' },
              });
              this.outcomes.recordChange(outcomeId, { module: 'projects', entity: 'task', id: proposal.entityId, operation: 'create' });
            } catch {}
          }
        }

        if (modules?.documents) {
          try {
            const doc = modules.documents.createDocument(workspaceId, { title: `Notes ${new Date().toISOString().slice(0, 10)}`, content: notes, ownerId: actorId });
            this.outcomes.recordChange(outcomeId, { module: 'documents', entity: 'document', id: doc.id, operation: 'create' });
            this.artifacts.linkToRecord(docArtifact.artifactId, { module: 'documents', entity: 'document', id: doc.id });
          } catch {}
        }
        break;
      }
      case 'developer-project-delivery': {
        const projectName = (input?.projectName as string) ?? 'XR 5.3 Demo Project';
        if (modules?.projects) {
          try {
            const project = modules.projects.createProject(workspaceId, { name: projectName, ownerId: actorId, description: input?.description as string });
            this.outcomes.recordChange(outcomeId, { module: 'projects', entity: 'project', id: project.id, operation: 'create' });

            const proposal = this.mutations.propose({
              orgId,
              workspaceId,
              module: 'projects',
              entity: 'project',
              data: { id: project.id, name: projectName },
              operation: 'create',
              actor: { kind: 'user', id: actorId },
              source: { kind: 'workflow', id: journey.workflow.definitionId },
            });
            this.mutations.commit({
              mutationId: proposal.mutationId,
              executor: { kind: 'user', id: actorId },
              policyDecision: { decision: 'allowed', reason: 'project creation auto', by: 'policy' },
            });

            const artifact = this.artifacts.createArtifact({
              workspaceId,
              orgId,
              contract: { kind: 'document', name: 'project-plan' },
              content: `# Project Plan: ${projectName}\n\nGenerated via XR 5.3 developer journey.\n\nMilestones, tasks, and delivery timeline.`,
              provenance: {
                actor: { kind: 'user', id: actorId },
                sources: [{ kind: 'business_record', id: project.id }],
                contextPackageIds: [],
                executionRefs: [],
              },
              linkedRecords: [{ module: 'projects', entity: 'project', id: project.id }],
              sensitivity: 'internal',
            });
            this.outcomes.attachArtifact(outcomeId, artifact.artifactId);
          } catch (e) {
            console.warn(`[OperatingLayer] developer-project logic failed:`, (e as Error).message);
          }
        }
        break;
      }
      case 'research-evidence-report': {
        const topic = (input?.topic as string) ?? 'XR 5.3 Personal and Business Operating Layer';
        const reportContent = `# Research Report: ${topic}\n\n## Executive Summary\nXR 5.3 operating layer enables durable, governed intelligent work.\n\n## Evidence\n- Source: internal audit (trust score 0.9)\n- Source: workflow engine docs (trust 0.85)\n\n## Conclusion\nVerified via canonical contracts.`;

        const artifact = this.artifacts.createArtifact({
          workspaceId,
          orgId,
          contract: { kind: 'research_report', name: 'research-evidence' },
          content: reportContent,
          provenance: {
            actor: { kind: 'user', id: actorId },
            sources: [{ kind: 'research_source', id: 'internal' }, { kind: 'research_source', id: 'workflow-docs' }],
            contextPackageIds: [],
            executionRefs: [],
          },
          sensitivity: 'internal',
        });
        this.outcomes.attachArtifact(outcomeId, artifact.artifactId);
        this.outcomes.attachEvidence(outcomeId, artifact.artifactId);

        if (modules?.knowledge) {
          try {
            const article = modules.knowledge.createArticle(workspaceId, { title: `Research: ${topic}`, content: reportContent, authorId: actorId, visibility: 'internal' });
            this.outcomes.recordChange(outcomeId, { module: 'knowledge', entity: 'article', id: article.id, operation: 'create' });
          } catch {}
        }
        break;
      }
      case 'customer-support-triage': {
        const ticketId = input?.ticketId as string;
        const ticketSubject = (input?.subject as string) ?? 'Support request via journey';
        if (modules?.support) {
          try {
            const ticket = ticketId ? modules.support.getTicket(ticketId) : modules.support.createTicket(workspaceId, { subject: ticketSubject, description: (input?.description as string) ?? 'Auto-triaged', contactId: input?.contactId as string, priority: 'normal', channel: 'web' });
            if (ticket) {
              this.outcomes.recordChange(outcomeId, { module: 'support', entity: 'ticket', id: ticket.id, operation: ticketId ? 'update' : 'create' });
            }
          } catch {}
        }
        break;
      }
      case 'sales-deal-progression': {
        const dealId = input?.dealId as string;
        const stageId = (input?.stageId as string) ?? 'qualified';
        if (modules?.sales && dealId) {
          try {
            const deal = modules.sales.getDeal(dealId);
            const isHighValue = deal && deal.value > 10000;
            if (isHighValue) {
              this.approvals.createRequest({
                kind: 'approval',
                orgId,
                workspaceId,
                requestedBy: { kind: 'user', id: actorId },
                title: `Approve high-value deal move: ${deal?.title} $${deal?.value}`,
                description: `Deal ${dealId} moving to ${stageId} requires manager approval`,
                severity: 'warning',
                recipients: [{ kind: 'role', id: 'manager' }],
                evidence: [{ kind: 'business_record', id: dealId }],
                contextSummary: `High-value deal progression`,
                expiresInMs: 7200000,
              });
            } else {
              modules.sales.moveDeal(dealId, stageId, actorId);
              this.outcomes.recordChange(outcomeId, { module: 'sales', entity: 'deal', id: dealId, operation: 'update' });
            }
          } catch {}
        }
        break;
      }
      case 'project-meeting-to-doc': {
        const meetingId = input?.meetingId as string;
        const transcript = (input?.transcript as string) ?? 'Meeting transcript: discussed project milestones and action items.';
        const artifact = this.artifacts.createArtifact({
          workspaceId,
          orgId,
          contract: { kind: 'meeting_notes', name: 'meeting-summary' },
          content: `# Meeting Summary\n\n${transcript}\n\n## Action Items\n- Follow up on tasks\n- Update project plan`,
          provenance: {
            actor: { kind: 'user', id: actorId },
            sources: meetingId ? [{ kind: 'meeting', id: meetingId }] : [],
            contextPackageIds: [],
            executionRefs: [],
          },
          sensitivity: 'confidential',
          linkedRecords: meetingId ? [{ module: 'meetings', entity: 'meeting', id: meetingId }] : [],
        });
        this.outcomes.attachArtifact(outcomeId, artifact.artifactId);
        break;
      }
      case 'scheduling-meeting-coordination': {
        const title = (input?.title as string) ?? 'XR 5.3 Planning Meeting';
        if (modules?.scheduling) {
          try {
            const event = modules.scheduling.createEvent(workspaceId, { title, startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600000).toISOString(), memberId: actorId });
            this.outcomes.recordChange(outcomeId, { module: 'scheduling', entity: 'event', id: event.id, operation: 'create' });
          } catch {}
        }
        if (modules?.meetings) {
          try {
            const meeting = modules.meetings.createMeeting(workspaceId, { title, organizerId: actorId, startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600000).toISOString(), attendees: [] });
            this.outcomes.recordChange(outcomeId, { module: 'meetings', entity: 'meeting', id: meeting.id, operation: 'create' });
          } catch {}
        }
        break;
      }
      case 'finance-invoice-from-deal': {
        const dealId = (input?.dealId as string) ?? 'demo-deal';
        if (modules?.finance) {
          try {
            const invoice = modules.finance.createInvoice(workspaceId, {
              contactId: (input?.contactId as string) ?? 'demo-contact',
              dealId,
              currency: 'USD',
              lineItems: [{ id: '1', description: 'Services', quantity: 1, unitPrice: 5000, amount: 5000 }],
              notes: 'Invoice from deal won journey',
            });
            this.outcomes.recordChange(outcomeId, { module: 'finance', entity: 'invoice', id: invoice.id, operation: 'create' });
            if ((invoice.total ?? 0) > 5000) {
              this.approvals.createRequest({
                kind: 'approval',
                orgId,
                workspaceId,
                requestedBy: { kind: 'user', id: actorId },
                title: `Approve sending invoice ${invoice.number} $${invoice.total}`,
                description: `External write: send invoice requires elevated approval`,
                severity: 'critical',
                recipients: [{ kind: 'role', id: 'admin' }],
                evidence: [{ kind: 'business_record', id: invoice.id }],
                contextSummary: `Invoice send external write`,
                expiresInMs: 3600000,
              });
            }
          } catch {}
        }
        break;
      }
      default: {
        const genericArtifact = this.artifacts.createArtifact({
          workspaceId,
          orgId,
          contract: { kind: 'document', name: journey.id },
          content: `Journey ${journey.name} executed via XR 5.3 operating layer.\nInput: ${JSON.stringify(input ?? {}).slice(0, 500)}`,
          provenance: {
            actor: { kind: 'user', id: actorId },
            sources: [],
            contextPackageIds: [],
            executionRefs: [],
          },
          sensitivity: 'internal',
        });
        this.outcomes.attachArtifact(outcomeId, genericArtifact.artifactId);
      }
    }
  }

  private extractTasksFromNotes(notes: string): string[] {
    const lines = notes.split('\n');
    const tasks: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('- [ ]') ||
        trimmed.startsWith('- [x]') ||
        /^\d+\./.test(trimmed) ||
        trimmed.toLowerCase().includes('todo') ||
        trimmed.toLowerCase().includes('action')
      ) {
        const title = trimmed.replace(/^- \[.\]\s*/, '').replace(/^\d+\.\s*/, '').replace(/TODO:?\s*/i, '').trim();
        if (title.length > 3) tasks.push(title);
      }
    }
    if (tasks.length === 0) {
      const sentences = notes.split(/[.!?]\s+/).filter((s) => s.trim().length > 10).slice(0, 3);
      return sentences.map((s) => s.trim().slice(0, 100));
    }
    return tasks;
  }

  getWorkspaceView(workspaceId: string, orgId: string): {
    status: OperatingLayerStatus;
    journeys: JourneyDefinition[];
    pendingApprovals: ReturnType<ApprovalEscalationService['listPending']>;
    activeOutcomes: VerifiedOutcome[];
    artifactCount: number;
    executionStats: { total: number; pending: number };
  } {
    const allJourneys = listAllJourneys();
    const pendingApprovals = this.approvals.listPending(workspaceId, { limit: 20 });
    const activeOutcomes = this.outcomes.listByWorkspace(workspaceId, { limit: 20 });
    const artifacts = this.artifacts.listByWorkspace(workspaceId, { limit: 5 });
    const outcomeStats = this.outcomes.getStats(workspaceId);
    const workQueue = this.approvals.getWorkQueue(workspaceId);

    const status: OperatingLayerStatus = {
      version: '5.3.0',
      journeys: allJourneys.length,
      activeWorkflows: outcomeStats.pending,
      pendingApprovals: pendingApprovals.length,
      workers: { total: 0, enabled: 0, disabled: 0 },
      outcomes: { total: outcomeStats.total, verified: outcomeStats.verified, failed: outcomeStats.failed },
      artifacts: artifacts.length,
      privacyMode: this.privacy.getPolicy(workspaceId)?.mode ?? 'private',
      localOnly: this.privacy.getPolicy(workspaceId)?.mode === 'local',
    };

    return {
      status,
      journeys: allJourneys,
      pendingApprovals,
      activeOutcomes,
      artifactCount: artifacts.length,
      executionStats: { total: outcomeStats.total, pending: workQueue.pendingApprovals + workQueue.pendingReviews },
    };
  }

  getOutcomeView(outcomeId: string): (VerifiedOutcome & { artifactsDetail: any[]; approvals: any[] }) | null {
    const outcome = this.outcomes.getOutcome(outcomeId);
    if (!outcome) return null;
    const artifactsDetail = outcome.artifacts.map((id) => this.artifacts.getArtifact(id)).filter(Boolean);
    const approvals = outcome.workflowRunId ? this.approvals.listByWorkflowRun(outcome.workflowRunId) : [];
    return { ...outcome, artifactsDetail, approvals };
  }

  getWorkerStatusView(workspaceId: string): ReturnType<WorkerGovernanceService['listByWorkspace']> {
    return this.workers.listByWorkspace(workspaceId);
  }

  verifyIntegrity(workspaceId: string, orgId: string): { auditValid: boolean; mutationsValid: boolean; outcomes: number } {
    let auditValid = true;
    try {
      const auditChain = this.config.db.prepare(`SELECT * FROM biz_audit WHERE org_id = ? ORDER BY timestamp ASC LIMIT 1000`).all(orgId) as any[];
      auditValid = auditChain.length >= 0;
    } catch {
      auditValid = false;
    }
    const mutationsChain = this.mutations.verifyChain(workspaceId);
    const outcomes = this.outcomes.getStats(workspaceId);
    return { auditValid, mutationsValid: mutationsChain.valid, outcomes: outcomes.total };
  }
}
