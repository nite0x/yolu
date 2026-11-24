import { useAuiState } from "@assistant-ui/react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { useEffect, useState } from "react";

const rendererURL = "/chat/mermaid.js";

export function MermaidBlock({ code, language, node, components: { Pre, Code } }: SyntaxHighlighterProps) {
  const running = useAuiState((state) => state.part.status.type === "running");
  const [diagram, setDiagram] = useState<{ code: string; url: string }>();

  useEffect(() => {
    if (running || !code.trim()) return;
    let active = true;
    void (async () => {
      try {
        const { renderDiagram }: typeof import("./mermaid-renderer") = await import(rendererURL);
        if (!active) return;
        const url = await renderDiagram(code);
        if (active) setDiagram({ code, url });
      } catch {
        // Keep the copyable Markdown source available on parse or render failure.
      }
    })();
    return () => { active = false; };
  }, [code, running]);

  if (!running && diagram?.code === code) {
    return (
      <div className="border-border/50 overflow-x-auto rounded-b-xl border border-t-0 bg-white p-3.5">
        <img className="mx-auto block h-auto max-w-full" src={diagram.url} alt="Mermaid" />
      </div>
    );
  }

  return <Pre><Code node={node} className={`language-${language}`}>{code}</Code></Pre>;
}
