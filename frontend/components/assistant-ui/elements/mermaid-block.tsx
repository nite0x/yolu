import { useAuiState } from "@assistant-ui/react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { Maximize2Icon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { uiText } from "../../../i18n";

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
    return <MermaidPreview key={code} src={diagram.url} />;
  }

  return <Pre><Code node={node} className={`language-${language}`}>{code}</Code></Pre>;
}

function MermaidPreview({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={uiText("放大 Mermaid 图表")}
          title={uiText("放大 Mermaid 图表")}
          className="group relative block w-full cursor-zoom-in rounded-b-xl border border-t-0 border-border/50 bg-white p-3.5 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <img className="mx-auto block h-auto max-w-full" src={src} alt="Mermaid" />
          <Maximize2Icon aria-hidden="true" className="absolute right-2 top-2 size-7 rounded-md border border-border bg-background p-1.5 text-foreground group-hover:bg-accent" />
        </button>
      </DialogTrigger>
      <DialogContent className="shadcn-scope h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0">
        <DialogTitle className="border-b border-border px-4 py-3 text-base">Mermaid</DialogTitle>
        <DialogDescription className="sr-only">{uiText("使用缩放按钮调整大小。放大后可拖动图表，也可用方向键滚动。")}</DialogDescription>
        {open && <MermaidViewport src={src} />}
      </DialogContent>
    </Dialog>
  );
}

const maxZoom = 8;

function MermaidViewport({ src }: { src: string }) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const previousZoom = useRef(1);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const ratio = zoom / previousZoom.current;
    previousZoom.current = zoom;
    const centerX = element.clientWidth / 2;
    const centerY = element.clientHeight / 2;
    element.scrollLeft = (element.scrollLeft + centerX) * ratio - centerX;
    element.scrollTop = (element.scrollTop + centerY) * ratio - centerY;
  }, [zoom]);

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
      <div
        ref={viewport}
        role="region"
        aria-label={uiText("Mermaid 图表预览")}
        tabIndex={0}
        className={`min-h-0 min-w-0 overflow-auto overscroll-contain bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${dragging ? "cursor-grabbing select-none" : zoom > 1 ? "cursor-grab" : ""}`}
        onPointerDown={(event) => {
          if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0) return;
          const element = event.currentTarget;
          const bounds = element.getBoundingClientRect();
          if (event.clientX >= bounds.left + element.clientWidth || event.clientY >= bounds.top + element.clientHeight) return;
          element.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX + element.scrollLeft, y: event.clientY + element.scrollTop };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          event.currentTarget.scrollLeft = drag.current.x - event.clientX;
          event.currentTarget.scrollTop = drag.current.y - event.clientY;
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          setDragging(false);
        }}
      >
        <img
          src={src}
          alt="Mermaid"
          draggable={false}
          className="block max-w-none select-none object-contain p-4"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-border p-2">
        <Button type="button" variant="outline" size="icon" aria-label={uiText("缩小")} title={uiText("缩小")} disabled={zoom === 1} onClick={() => setZoom((value) => Math.max(1, value / 1.5))}>
          <MinusIcon aria-hidden="true" />
        </Button>
        <output className="min-w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</output>
        <Button type="button" variant="outline" size="icon" aria-label={uiText("放大")} title={uiText("放大")} disabled={zoom === maxZoom} onClick={() => setZoom((value) => Math.min(maxZoom, value * 1.5))}>
          <PlusIcon aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" onClick={() => setZoom(1)}>{uiText("适应窗口")}</Button>
      </div>
    </div>
  );
}
