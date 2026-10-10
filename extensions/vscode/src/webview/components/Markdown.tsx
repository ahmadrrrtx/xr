import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "../../shared/markdown";
import { post } from "../vscode";
import { CodeBlock } from "./CodeBlock";

/** Renders chat markdown as React elements. Nothing here uses innerHTML. */
export function Markdown({ source, actions }: { source: string; actions: boolean }) {
  const blocks = parseMarkdown(source);
  return (
    <Fragment>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} actions={actions} />
      ))}
    </Fragment>
  );
}

function BlockView({ block, actions }: { block: Block; actions: boolean }) {
  switch (block.type) {
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} open={block.open} actions={actions} />;
    case "heading": {
      const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      return <Tag className="md-heading">{renderInlines(block.children)}</Tag>;
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlines(item)}</li>
          ))}
        </Tag>
      );
    }
    case "paragraph":
      return <p className="md-p">{renderInlines(block.children)}</p>;
  }
}

function renderInlines(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => <InlineView key={i} node={n} />);
}

function InlineView({ node }: { node: Inline }) {
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "code":
      return <code className="inline-code">{node.text}</code>;
    case "strong":
      return <strong>{renderInlines(node.children)}</strong>;
    case "em":
      return <em>{renderInlines(node.children)}</em>;
    case "link":
      return (
        <a
          className="md-link"
          href={node.href}
          onClick={(e) => {
            e.preventDefault();
            post({ type: "openLink", href: node.href });
          }}
        >
          {renderInlines(node.children)}
        </a>
      );
    case "fileref":
      return (
        <button
          type="button"
          className="fileref"
          title={`Open ${node.path} at line ${node.line}`}
          onClick={() => post({ type: "openFile", path: node.path, line: node.line })}
        >
          {node.path}:{node.line}
        </button>
      );
  }
}
