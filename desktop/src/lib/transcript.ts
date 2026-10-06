/*
 * Chat transcript → Markdown (Phase 14 "Export"). Pure; unit-testable.
 */
import { modelInfo } from '@/budget/models';
import type { ChatMessage } from '@/lib/chat-db';

/** Markdown transcript — what a user would paste elsewhere. */
export function transcriptMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title}`, ''];
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
        lines.push(seg.text.trim(), '');
      } else {
        const t = m.toolCalls?.[seg.index];
        if (!t) continue;
        lines.push(`> **Tool:** \`${t.tool}\` — ${t.summary} (${t.denied ? 'denied' : t.blocked ? 'blocked' : t.status})`);
        if (t.input !== undefined) lines.push('> ```json', ...JSON.stringify(t.input, null, 2).split('\n').map((l) => `> ${l}`), '> ```');
        if (t.output) lines.push('>', ...t.output.split('\n').slice(0, 40).map((l) => `> ${l}`));
        lines.push('');
      }
    }
    if (m.metadata?.model) lines.push(`<sub>${modelInfo(m.metadata.model).name}${m.metadata.usage ? ` · ${m.metadata.usage.inTokens + m.metadata.usage.outTokens} tokens` : ''}</sub>`, '');
  }
  return lines.join('\n').trim() + '\n';
}

