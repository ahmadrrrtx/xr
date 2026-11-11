/*
 * Chat transcript → Markdown (Phase 14 "Export"). Pure; unit-testable.
 */
import { modelInfo } from '@/budget/models';
import { redactCredentialContent, redactCredentialString, redactCredentialValue } from '../../../src/observability/redaction';
import type { ChatMessage } from '@/lib/chat-db';

/** Suggested filename must not reintroduce credentials from the chat title. */
export function transcriptFilename(title: string): string {
  const safe = redactCredentialString(title).replace(/⟨redacted:[^⟩]+⟩/g, 'redacted');
  return `${safe.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'chat'}.md`;
}

/** Markdown transcript — what a user would paste elsewhere. */
export function transcriptMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, '', '_Known credential patterns and fields are redacted; review before sharing. Other sensitive information may remain._', ''];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? 'You' : 'XR';
    const when = new Date(m.createdAt).toISOString();
    lines.push(`## ${who} · ${when}`, '');
    if (m.metadata?.budget?.kind === 'blocked') {
      lines.push(`_Blocked by the budget governor: ${m.metadata.budget.reason ?? 'limit reached'}_`, '');
      continue;
    }
    if (m.metadata?.error && !m.content) {
      lines.push(`_Failed: ${m.metadata.error.message}_`, '');
      continue;
    }
    const segs = m.metadata?.segments ?? [{ type: 'text' as const, text: m.content }];
    for (const seg of segs) {
      if (seg.type === 'text') {
        lines.push(redactCredentialContent(seg.text.trim()), '');
      } else {
        const t = m.toolCalls?.[seg.index];
        if (!t) continue;
        lines.push(`> **Tool:** \`${t.tool}\` — ${t.summary} (${t.denied ? 'denied' : t.blocked ? 'blocked' : t.status})`);
        if (t.input !== undefined) lines.push('> ```json', ...JSON.stringify(redactCredentialValue(t.input), null, 2).split('\n').map((l) => `> ${l}`), '> ```');
        if (t.output) lines.push('>', ...redactCredentialContent(t.output).split('\n').slice(0, 40).map((l) => `> ${l}`));
        lines.push('');
      }
    }
    if (m.metadata?.model) lines.push(`<sub>${modelInfo(m.metadata.model).name}${m.metadata.usage ? ` · ${m.metadata.usage.inTokens + m.metadata.usage.outTokens} tokens` : ''}</sub>`, '');
  }
  return redactCredentialString(lines.join('\n').trim()) + '\n';
}

