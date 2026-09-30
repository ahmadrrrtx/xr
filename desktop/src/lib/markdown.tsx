/*
 * Markdown renderer (Phase 4) — react-markdown + remark-gfm, XR-typography
 * components. Code fences render through <CodeBlock> (shiki, lazy); HTML in
 * messages stays escaped (react-markdown never passes raw HTML through).
 * Citations render as cyan superscripts (source panel lands in Phase 18).
 */
import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { CodeBlock } from '@/screens/Chat/components/CodeBlock';

function Citation({ n }: { n: string }) {
  return (
    <sup>
      <button
        type="button"
        className="text-accent hover:underline px-0.5 text-[11px] font-semibold"
        onClick={() =>
          toast('Source linking coming in the Research phase', {
            description: 'Citations will open the source panel (Phase 18).',
          })
        }
      >
        [{n}]
      </button>
    </sup>
  );
}

/** Pull `[1]`-style trailing citations out of text into superscript chips. */
function TextWithCitations({ children }: { children?: React.ReactNode }) {
  if (typeof children !== 'string') return <>{children}</>;
  const parts = children.split(/(\[\d{1,2}\])/g);
  if (parts.length === 1) return <>{children}</>;
  return (
    <>
      {parts.map((p, i) =>
        /^\[\d{1,2}\]$/.test(p) ? <Citation key={i} n={p.slice(1, -1)} /> : p,
      )}
    </>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  return (
    <div className="text-[15px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-4 mb-2 text-[22px] leading-tight font-bold" {...p} />,
          h2: (p) => <h2 className="mt-3 mb-2 text-[18px] leading-tight font-bold" {...p} />,
          h3: (p) => <h3 className="mt-3 mb-1 text-[16px] font-semibold" {...p} />,
          // h4–h6 stay bold text — chat stays tidy (DESIGN-SYSTEM type scale).
          h4: (p) => <p className="mt-3 mb-1 text-[15px] font-bold" {...p} />,
          h5: (p) => <p className="mt-3 mb-1 text-[15px] font-bold" {...p} />,
          h6: (p) => <p className="mt-3 mb-1 text-[15px] font-bold" {...p} />,
          p: (p) => (
            <p className="mb-2 last:mb-0">
              <TextWithCitations>{p.children}</TextWithCitations>
            </p>
          ),
          a: (p) => (
            <a
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer noopener"
              {...p}
            />
          ),
          ul: (p) => <ul className="mb-2 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="mb-2 list-decimal space-y-1 pl-5" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="my-2 border-l-[3px] pl-3 italic"
              style={{ borderColor: 'var(--accent-dim)', color: 'var(--text-secondary)' }}
              {...p}
            />
          ),
          hr: () => <hr className="border-border-subtle my-3" />,
          code: (props) => {
            const { className, children } = props as {
              className?: string;
              children?: React.ReactNode;
            };
            // Only INLINE code reaches this override — block fences are
            // intercepted by `pre` below (react-markdown v10 dropped `inline`).
            void className;
            const raw = String(children ?? '').replace(/\n$/, '');
            return (
              <code className="bg-black/40 px-1.5 py-0.5 font-mono text-[13px] text-accent rounded">
                {raw}
              </code>
            );
          },
          pre: (props) => {
            const child = React.Children.toArray(props.children)[0];
            if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
              const { className, children } = child.props;
              const match = /language-(\S+)/.exec(className ?? '');
              const raw = String(children ?? '').replace(/\n$/, '');
              return <CodeBlock code={raw} langTag={match?.[1] ?? ''} />;
            }
            return <pre className="my-3" {...props} />;
          },
          table: (p) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          th: (p) => (
            <th
              className="bg-bg-raised border-border-subtle p-2 text-left font-semibold"
              {...p}
            />
          ),
          td: (p) => <td className="border-border-subtle p-2 align-top" {...p} />,
          // Task lists: disabled checkboxes, left-aligned (gfm adds input[type=checkbox]).
          input: (p) =>
            p.type === 'checkbox' ? (
              <input
                {...p}
                disabled
                className="accent-accent mr-1.5 align-middle"
                aria-label="task item"
              />
            ) : null,
          strong: (p) => <strong className="font-semibold" {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
