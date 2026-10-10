import { useMemo, useState, type ReactNode } from "react";
import { highlightToHtml } from "../highlight";
import { post } from "../vscode";

/**
 * A fenced code block with Copy, Apply and Diff actions. Highlight.js returns
 * HTML; that HTML is parsed into an inert document and rebuilt as React nodes,
 * so only `<span class="hljs-…">` wrappers and text ever reach the DOM.
 */
export function CodeBlock({
  lang,
  code,
  open,
  actions,
}: {
  lang: string;
  code: string;
  open: boolean;
  actions: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => {
    const html = highlightToHtml(code, lang);
    return html ? htmlToNodes(html) : null;
  }, [code, lang]);

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || "text"}</span>
        <span className="code-actions">
          <button
            type="button"
            className="chip-btn"
            aria-label="Copy code"
            onClick={() => {
              post({ type: "copy", code });
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {actions && !open && (
            <>
              <button
                type="button"
                className="chip-btn"
                aria-label="Apply code to the editor"
                onClick={() => post({ type: "apply", code, language: lang })}
              >
                Apply
              </button>
              <button
                type="button"
                className="chip-btn"
                aria-label="Show diff against the editor"
                onClick={() => post({ type: "diff", code, language: lang })}
              >
                Diff
              </button>
            </>
          )}
        </span>
      </div>
      <pre className="code-body">
        <code>{highlighted ?? code}</code>
      </pre>
    </div>
  );
}

function htmlToNodes(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes: ReactNode[] = [];
  doc.body.childNodes.forEach((child, i) => nodes.push(domToNode(child, i)));
  return nodes;
}

function domToNode(node: ChildNode, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const children: ReactNode[] = [];
  el.childNodes.forEach((c, i) => children.push(domToNode(c, i)));
  if (el.tagName === "SPAN") {
    return (
      <span key={key} className={el.getAttribute("class") ?? undefined}>
        {children}
      </span>
    );
  }
  return <span key={key}>{children}</span>;
}
