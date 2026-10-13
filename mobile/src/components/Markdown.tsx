import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface MarkdownProps {
  children: string;
}

/**
 * Chat markdown. Code blocks are highlighted with the tiny in-repo highlighter
 * (shiki would blow the mobile budget) and scroll horizontally rather than
 * wrapping, so diffs stay readable on a phone.
 */
export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children: codeChildren }: { className?: string; children?: ReactNode }) {
            const text = String(codeChildren ?? '');
            const isBlock = /language-/.test(className ?? '') || text.includes('\n');
            if (!isBlock) {
              return <code style={{ color: 'var(--accent)' }}>{codeChildren}</code>;
            }
            const lang = /language-([\w+-]+)/.exec(className ?? '')?.[1];
            return <CodeBlock code={text.replace(/\n+$/, '')} lang={lang} />;
          },
          pre({ children: preChildren }: { children?: ReactNode }) {
            return <>{preChildren}</>;
          },
          a({ href, children: linkChildren }: { href?: string; children?: ReactNode }) {
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {linkChildren}
              </a>
            );
          },
          table({ children: tableChildren }: { children?: ReactNode }) {
            return (
              <div className="scroll-x-quiet">
                <table>{tableChildren}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
