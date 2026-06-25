// Markdown renderer for assistant text blocks. react-markdown + remark-gfm,
// with fenced code routed to the highlighted CodeBlock and inline code styled.

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

interface MarkdownProps {
  text: string;
}

function extractText(children: unknown): string {
  if (children == null) return "";
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (typeof children === "object" && "props" in (children as Record<string, unknown>)) {
    const props = (children as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return String(children);
}

const components: Components = {
  code(props) {
    const { className, children } = props;
    const inline = !className;
    const match = /language-(\w+)/.exec(className || "");
    const raw = extractText(children).replace(/\n$/, "");
    if (inline && !raw.includes("\n")) {
      return <code className="md-inline-code">{children}</code>;
    }
    return <CodeBlock code={raw} language={match?.[1]} />;
  },
  a(props) {
    return (
      <a {...props} target="_blank" rel="noreferrer noopener">
        {props.children}
      </a>
    );
  },
  table(props) {
    return (
      <div className="md-table-wrap">
        <table>{props.children}</table>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: MarkdownProps) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
