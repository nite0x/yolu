import {Fragment, useEffect, useState, type ComponentProps, type CSSProperties} from "react"
import {useAuiState} from "@assistant-ui/react"
import {cn} from "@/shared/lib/utils"

const highlighterURL = "/chat/highlight/code-highlight.js";
type HighlightedLines = Awaited<ReturnType<typeof import("./code-highlight").highlightCode>>;

export function CodePre({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre className={cn("aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed", className)} {...props} />
  );
}

export function CodeSource({ code, language, wrap }: { code: string; language: string; wrap: boolean }) {
  const running = useAuiState(state => state.part.status.type === "running");
  const [highlight, setHighlight] = useState<{ code: string; language: string; lines: HighlightedLines }>();
  useEffect(() => {
    // Render streaming output immediately and bound the work for large fences.
    if (running || !language || !code.trim() || code.length > 50_000) return;
    let active = true;
    void (async () => {
      try {
        const { highlightCode }: typeof import("./code-highlight") = await import(highlighterURL);
        if (!active) return;
        const lines = await highlightCode(code, language);
        if (active && lines) setHighlight({ code, language, lines });
      } catch {
        // The original source remains selectable and copyable.
      }
    })();
    return () => { active = false; };
  }, [code, language, running]);

  const lines = !running && highlight?.code === code && highlight.language === language ? highlight.lines : undefined;
  return (
    <CodePre data-wrap={wrap} tabIndex={wrap ? undefined : 0}>
      <code className={language ? `language-${language}` : undefined}>
        {lines ? lines.map((line, row) => (
          /* biome-ignore lint/suspicious/noArrayIndexKey: Syntax rows and tokens are stateless positions within one immutable highlighted source snapshot. */
          <Fragment key={row}>
            {row > 0 && "\n"}
            {line.map((token, index) => (
              /* biome-ignore lint/suspicious/noArrayIndexKey: Syntax rows and tokens are stateless positions within one immutable highlighted source snapshot. */
              <span key={index} className="aui-code-token" style={{
                "--code-token-light": token.variants.light?.color,
                "--code-token-dark": token.variants.dark?.color,
              } as CSSProperties}>{token.content}</span>
            ))}
          </Fragment>
        )) : code}
      </code>
    </CodePre>
  );
}
