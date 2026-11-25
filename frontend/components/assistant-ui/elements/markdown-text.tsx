"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  type MarkdownTextPrimitiveProps,
  type SyntaxHighlighterProps,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";
import type { Element, Root } from "hast";
import { createContext, type FC, type ReactNode, memo, useContext, useMemo, useRef, useState } from "react";
import { type TextMessagePartProps, useAuiState } from "@assistant-ui/react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { uiText } from "../../../i18n";
import { MermaidBlock } from "./mermaid-block";

type MarkdownTextProps = Partial<TextMessagePartProps> & {
  components?: Parameters<typeof memoizeMarkdownComponents>[0];
  componentsByLanguage?: MarkdownTextPrimitiveProps["componentsByLanguage"];
  urlTransform?: MarkdownTextPrimitiveProps["urlTransform"];
  remarkPlugins?: MarkdownTextPrimitiveProps["remarkPlugins"];
};

const MarkdownPreviewContext = createContext<Pick<MarkdownTextPrimitiveProps, "components" | "urlTransform">>({});
const markdownBlock = { CodeHeader: () => null, SyntaxHighlighter: MarkdownCodeBlock };
const gfmPlugins = [remarkGfm];
const previewRehypePlugins = [() => preserveDocumentBreaks];

function preserveDocumentBreaks({ children }: Root | Element) {
  // API documents often use inline <br> in table cells. Keep those breaks
  // while leaving other raw HTML to the renderer's skipHtml behavior.
  for (const [index, node] of children.entries()) {
    if (node.type === "raw" && /^<br\s*\/?>$/i.test(node.value)) {
      children[index] = { type: "element", tagName: "br", properties: {}, children: [] };
    } else if (node.type === "element") {
      preserveDocumentBreaks(node);
    }
  }
}

const useShallowStable = <T extends Record<string, unknown> | undefined>(
  value: T,
): T => {
  const ref = useRef(value);
  if (value !== ref.current) {
    const prev = ref.current;
    const stable =
      value !== undefined &&
      prev !== undefined &&
      Object.keys(prev).length === Object.keys(value).length &&
      Object.keys(value).every((key) => prev[key] === value[key]);
    if (!stable) ref.current = value;
  }
  return ref.current;
};

const MarkdownTextImpl: FC<MarkdownTextProps> = ({
  components,
  componentsByLanguage,
  urlTransform,
  remarkPlugins,
}) => {
  const stableComponents = useShallowStable(components);
  const stableComponentsByLanguage = useShallowStable(componentsByLanguage);
  const markdownComponents = useMemo(() => {
    if (!stableComponents) return defaultComponents;
    return {
      ...defaultComponents,
      ...memoizeMarkdownComponents(stableComponents),
    };
  }, [stableComponents]);
  const languageComponents = useMemo(() => ({
    mermaid: { SyntaxHighlighter: MermaidBlock },
    md: markdownBlock,
    markdown: markdownBlock,
    ...stableComponentsByLanguage,
  }), [stableComponentsByLanguage]);
  const plugins = useMemo(() => [remarkGfm, ...(remarkPlugins || [])], [remarkPlugins]);
  const previewOptions = useMemo(() => {
    const { CodeHeader, SyntaxHighlighter, code, pre, ...components } = markdownComponents;
    return { components: { ...components, pre: MarkdownPreviewPre }, urlTransform };
  }, [markdownComponents, urlTransform]);

  return (
    <MarkdownPreviewContext.Provider value={previewOptions}>
      <MarkdownTextPrimitive
        remarkPlugins={plugins}
        className="aui-md"
        components={markdownComponents}
        componentsByLanguage={languageComponents}
        urlTransform={urlTransform}
        defer
      />
    </MarkdownPreviewContext.Provider>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps & { children?: ReactNode }> = ({ language, code, children }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
      <span className="aui-code-header-language text-muted-foreground font-medium lowercase">
        {language}
      </span>
      <div className="flex items-center gap-2">
        {children}
        <TooltipIconButton type="button" tooltip={uiText("复制")} onClick={onCopy}>
          {!isCopied && (
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          )}
          {isCopied && (
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          )}
        </TooltipIconButton>
      </div>
    </div>
  );
};

function MarkdownCodeBlock({ code, language, components: { Pre, Code } }: SyntaxHighlighterProps) {
  const running = useAuiState((state) => state.part.status.type === "running");
  const [view, setView] = useState<"source" | "preview">();
  const preview = view ? view === "preview" : !running;
  const options = useContext(MarkdownPreviewContext);

  return (
    <>
      <CodeHeader language={language} code={code}>
        <div role="group" aria-label={uiText("Markdown 显示方式")} className="flex items-center gap-1">
          <Button type="button" variant={preview ? "ghost" : "secondary"} size="xs" aria-pressed={!preview} onClick={() => setView("source")}>{uiText("源码")}</Button>
          <Button type="button" variant={preview ? "secondary" : "ghost"} size="xs" aria-pressed={preview} onClick={() => setView("preview")}>{uiText("预览")}</Button>
        </div>
      </CodeHeader>
      {preview ? (
        <div className="aui-md-preview min-w-0 overflow-x-auto rounded-b-xl border border-t-0 border-border/50 bg-background p-3.5 [overflow-wrap:anywhere]">
          <ReactMarkdown {...options} remarkPlugins={gfmPlugins} rehypePlugins={previewRehypePlugins} skipHtml>{code}</ReactMarkdown>
        </div>
      ) : <Pre><Code>{code}</Code></Pre>}
    </>
  );
}

const MarkdownPre: NonNullable<MarkdownTextPrimitiveProps["components"]>["pre"] = ({ className, node: _node, ...props }) => (
  <pre
    className={cn(
      "aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-b-xl border p-3.5 text-[13px] leading-relaxed",
      className,
    )}
    {...props}
  />
);

const MarkdownPreviewPre: typeof MarkdownPre = ({ className, ...props }) => (
  <MarkdownPre className={cn("my-3 rounded-lg", className)} {...props} />
);

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-primary hover:text-primary/80 underline decoration-primary/40 hover:decoration-primary underline-offset-3 transition-colors",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr border-muted-foreground/20 my-3", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="aui-md-table-wrapper my-3 overflow-x-auto">
      <table
        className={cn(
          "aui-md-table w-full border-separate border-spacing-0",
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-relaxed", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn("aui-md-strong font-semibold", className)}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => <MarkdownPre className={cn("border-t-0", className)} {...props} />,
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});

