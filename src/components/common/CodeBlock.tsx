// Syntax-highlighted code block with a copy button. Uses highlight.js core in
// a memoized, defensive way (auto-detect when no language given).

import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import { Icon } from "./Icon";
import { useCopy } from "./useCopy";
import { registerLanguages } from "./hljsLanguages";

registerLanguages(hljs);

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, copy] = useCopy();

  const { html, lang } = useMemo(() => {
    const source = code.replace(/\n$/, "");
    try {
      if (language && hljs.getLanguage(language)) {
        const r = hljs.highlight(source, { language, ignoreIllegals: true });
        return { html: r.value, lang: language };
      }
      const r = hljs.highlightAuto(source);
      return { html: r.value, lang: r.language ?? language ?? "" };
    } catch {
      return { html: escapeHtml(source), lang: language ?? "" };
    }
  }, [code, language]);

  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span className="code-block__lang">{lang || "text"}</span>
        <button
          className="code-block__copy"
          onClick={() => copy(code)}
          title="Copy code"
          type="button"
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-block__pre">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
