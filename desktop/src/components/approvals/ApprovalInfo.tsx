/*
 * Approval info rows (Phase 7) — the modal's body sections, one component
 * each (SCREEN-BRIEFS OV-4): skill, action, resource, collapsible preview,
 * risk chip, justification quote. Pure presentation — state lives in
 * ApprovalModal.
 */
import { ChevronDown, FileEdit, Globe, Mail, Quote, ShieldCheck, Terminal, Workflow, Wrench } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  RISK_COPY,
  type ApprovalRequest,
  type ApprovalRisk,
} from '@/lib/approvalCore';
import { cn } from '@/lib/utils';

/** skillIcon key → lucide component (ToolCallCard's map, approval-flavored). */
const SKILL_ICONS: Record<string, typeof Mail> = {
  mail: Mail,
  gmail: Mail,
  email: Mail,
  'file-edit': FileEdit,
  file: FileEdit,
  write_file: FileEdit,
  terminal: Terminal,
  shell: Terminal,
  globe: Globe,
  web: Globe,
  workflow: Workflow,
};

function SkillIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = SKILL_ICONS[icon] ?? Wrench;
  return (
    <Icon aria-hidden="true" strokeWidth={1.5} className={className} size={16} />
  );
}

/** Shared info-card shell. */
function InfoCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border-subtle bg-bg-raised/60 rounded-lg border p-3',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Skill row: icon, name + version, verified badge when official. */
export function SkillRow({ req }: { req: ApprovalRequest }) {
  return (
    <InfoCard className="flex items-center gap-3">
      <span className="bg-accent/10 text-accent flex size-7 shrink-0 items-center justify-center rounded-md">
        <SkillIcon icon={req.skillIcon} />
      </span>
      <span className="text-text-primary min-w-0 flex-1 truncate text-[13px] font-semibold">
        {req.skillName} <span className="text-text-tertiary font-mono text-[11px]">{req.skillVersion}</span>
      </span>
      <Badge className="border-accent/40 bg-accent/10 text-accent gap-1 text-[10px]">
        <ShieldCheck size={10} strokeWidth={1.5} aria-hidden="true" />
        verified
      </Badge>
    </InfoCard>
  );
}

/** Action row: bold, with the acting icon. */
export function ActionRow({ req }: { req: ApprovalRequest }) {
  return (
    <InfoCard className="flex items-center gap-3">
      <span className="text-text-secondary shrink-0">
        <SkillIcon icon={req.skillIcon} />
      </span>
      <span className="text-text-primary text-[18px] font-bold">
        {req.action}
      </span>
    </InfoCard>
  );
}

/** Resource / subject rows — monospace for addresses and paths. */
export function ResourceRow({ req }: { req: ApprovalRequest }) {
  if (!req.resource && !req.subject) return null;
  return (
    <InfoCard className="flex flex-col gap-1">
      {req.resource && (
        <div className="flex items-baseline gap-2">
          <span className="text-text-tertiary text-[11px] tracking-wide uppercase">
            To
          </span>
          <span className="text-text-secondary font-mono text-[13px]">
            {req.resource}
          </span>
        </div>
      )}
      {req.subject && (
        <div className="flex items-baseline gap-2">
          <span className="text-text-tertiary text-[11px] tracking-wide uppercase">
            Subject
          </span>
          <span className="text-text-secondary truncate text-[13px]">
            {req.subject}
          </span>
        </div>
      )}
    </InfoCard>
  );
}

/** Collapsible body preview — collapsed by default (sensitive content). */
export function BodyPreviewRow({ req }: { req: ApprovalRequest }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  if (!req.bodyPreview) return null;
  return (
    <InfoCard className="py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:text-text-primary text-text-secondary flex w-full items-center gap-2 py-0.5 text-left text-[12px] transition-colors"
      >
        <ChevronDown
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
          className="shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        />
        {expanded ? 'Hide details' : 'Show details'}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <pre className="text-text-tertiary mt-2 max-h-[160px] overflow-y-auto font-mono text-[12px] leading-5 whitespace-pre-wrap">
              <code className="italic">{req.bodyPreview}</code>
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </InfoCard>
  );
}

const RISK_CLASS: Record<ApprovalRisk, string> = {
  low: 'border-success/40 bg-success/15 text-success',
  medium: 'border-warning/40 bg-warning/15 text-warning',
  high: 'border-danger/40 bg-danger/15 text-danger',
};

/** Risk chip + the one-line human explanation. */
export function RiskRow({ req }: { req: ApprovalRequest }) {
  const copy = RISK_COPY[req.risk];
  return (
    <InfoCard className="flex flex-wrap items-center gap-2.5">
      <Badge className={cn('text-[11px] font-semibold', RISK_CLASS[req.risk])}>
        ⚠ {copy.label}
      </Badge>
      <span className="text-text-secondary min-w-0 flex-1 text-[12px]">
        {copy.explanation}
      </span>
    </InfoCard>
  );
}

/** The agent's justification, quoted. */
export function JustificationRow({ req }: { req: ApprovalRequest }) {
  return (
    <InfoCard className="flex items-start gap-2.5">
      <Quote
        aria-hidden="true"
        size={14}
        strokeWidth={1.5}
        className="text-text-tertiary mt-0.5 shrink-0"
      />
      <p className="text-text-secondary text-[13px] leading-5 italic">
        {req.justification}
      </p>
    </InfoCard>
  );
}
