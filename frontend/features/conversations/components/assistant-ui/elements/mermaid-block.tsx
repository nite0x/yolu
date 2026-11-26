import {useAuiState} from "@assistant-ui/react"
import type {SyntaxHighlighterProps} from "@assistant-ui/react-markdown"
import {Maximize2Icon, MinusIcon, PlusIcon} from "lucide-react"
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react"

import {Button} from "@/shared/ui/primitives/button"
import {Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger} from "@/shared/ui/primitives/dialog"
import {uiText} from "@/shared/i18n"

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
        <DialogDescription className="sr-only">{uiText("双指捏合或使用按钮缩放。放大后可拖动图表，也可用方向键滚动。")}</DialogDescription>
        {open && <MermaidViewport src={src} />}
      </DialogContent>
    </Dialog>
  );
}

const maxZoom = 8;
type Point = { x: number; y: number };
type ZoomPosition = { anchor: Point; point: Point };
type Pinch = { zoom: number; distance: number; anchor: Point };
type TrackpadGesture = Event & { scale: number; clientX: number; clientY: number };

function pinchGeometry([first, second]: Point[]) {
  return {
    point: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  };
}

function MermaidViewport({ src }: { src: string }) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLElement>(null);
  const renderedZoom = useRef(1);
  const requestedZoom = useRef(1);
  const position = useRef<ZoomPosition | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);

  const localPoint = useCallback((x?: number, y?: number): Point => {
    const element = viewport.current;
    if (!element) return {x: 0, y: 0};
    const bounds = element.getBoundingClientRect();
    return {
      x: x === undefined ? element.clientWidth / 2 : x - bounds.left,
      y: y === undefined ? element.clientHeight / 2 : y - bounds.top,
    };
  }, []);

  const contentPoint = useCallback((point: Point): Point => {
    const element = viewport.current;
    if (!element) return point;
    return { x: (element.scrollLeft + point.x) / renderedZoom.current, y: (element.scrollTop + point.y) / renderedZoom.current };
  }, []);

  const zoomAt = useCallback((value: number, point = localPoint(), anchor = contentPoint(point)) => {
    const next = Math.min(maxZoom, Math.max(1, value));
    requestedZoom.current = next;
    position.current = { point, anchor };
    if (next === renderedZoom.current && viewport.current) {
      viewport.current.scrollLeft = anchor.x * next - point.x;
      viewport.current.scrollTop = anchor.y * next - point.y;
    }
    setZoom(next);
  }, [contentPoint, localPoint]);

  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    const element = viewport.current;
    const target = position.current;
    if (!element || !target) return;
    element.scrollLeft = target.anchor.x * zoom - target.point.x;
    element.scrollTop = target.anchor.y * zoom - target.point.y;
  }, [zoom]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let gesture: { zoom: number; anchor: Point } | null = null;
    const wheel = (event: WheelEvent) => {
      // Chromium exposes trackpad pinch as a wheel event with Ctrl set.
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (gesture) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      zoomAt(requestedZoom.current * Math.exp(-delta * .012), localPoint(event.clientX, event.clientY));
    };
    const gestureStart = (event: Event) => {
      const touch = event as TrackpadGesture;
      event.preventDefault();
      if (touches.current.size) return;
      gesture = { zoom: requestedZoom.current, anchor: contentPoint(localPoint(touch.clientX, touch.clientY)) };
    };
    const gestureChange = (event: Event) => {
      const touch = event as TrackpadGesture;
      event.preventDefault();
      if (gesture && Number.isFinite(touch.scale)) zoomAt(gesture.zoom * touch.scale, localPoint(touch.clientX, touch.clientY), gesture.anchor);
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      gesture = null;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    // Safari and WKWebView can report trackpad pinch as a native gesture.
    element.addEventListener("gesturestart", gestureStart);
    element.addEventListener("gesturechange", gestureChange);
    element.addEventListener("gestureend", gestureEnd);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
      element.removeEventListener("gestureend", gestureEnd);
    };
  }, [contentPoint, localPoint, zoomAt]);

  return (
    <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The named diagram viewport needs focus for keyboard scrolling and zoom navigation. */}
      <section tabIndex={0}
        ref={viewport}
        aria-label={uiText("Mermaid 图表预览")}
        className={`min-h-0 min-w-0 touch-none overflow-auto overscroll-contain bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${dragging ? "cursor-grabbing select-none" : zoom > 1 ? "cursor-grab" : ""}`}
        onPointerDown={event => {
          if (event.pointerType === "touch") {
            if (touches.current.size >= 2) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            touches.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
            if (touches.current.size === 2) {
              const { point, distance } = pinchGeometry([...touches.current.values()]);
              pinch.current = { zoom: requestedZoom.current, distance: Math.max(1, distance), anchor: contentPoint(point) };
            }
            return;
          }
          if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0) return;
          const element = event.currentTarget;
          const bounds = element.getBoundingClientRect();
          if (event.clientX >= bounds.left + element.clientWidth || event.clientY >= bounds.top + element.clientHeight) return;
          element.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX + element.scrollLeft, y: event.clientY + element.scrollTop };
          setDragging(true);
        }}
        onPointerMove={event => {
          const previous = touches.current.get(event.pointerId);
          if (previous) {
            const point = localPoint(event.clientX, event.clientY);
            touches.current.set(event.pointerId, point);
            const origin = pinch.current;
            if (origin && touches.current.size === 2) {
              const current = pinchGeometry([...touches.current.values()]);
              zoomAt(origin.zoom * current.distance / origin.distance, current.point, origin.anchor);
            } else {
              event.currentTarget.scrollLeft += previous.x - point.x;
              event.currentTarget.scrollTop += previous.y - point.y;
            }
            return;
          }
          if (drag.current?.pointer !== event.pointerId) return;
          event.currentTarget.scrollLeft = drag.current.x - event.clientX;
          event.currentTarget.scrollTop = drag.current.y - event.clientY;
        }}
        onLostPointerCapture={event => {
          if (touches.current.delete(event.pointerId)) pinch.current = null;
          if (drag.current?.pointer === event.pointerId) {
            drag.current = null;
            setDragging(false);
          }
        }}
      >
        <img
          src={src}
          alt="Mermaid"
          draggable={false}
          className="block max-w-none select-none object-contain p-4"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        />
      </section>
      <div className="flex items-center justify-center gap-2 border-t border-border p-2">
        <Button type="button" variant="outline" size="icon" aria-label={uiText("缩小")} title={uiText("缩小")} disabled={zoom === 1} onClick={() => zoomAt(zoom / 1.5)}>
          <MinusIcon aria-hidden="true" />
        </Button>
        <output className="min-w-12 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</output>
        <Button type="button" variant="outline" size="icon" aria-label={uiText("放大")} title={uiText("放大")} disabled={zoom === maxZoom} onClick={() => zoomAt(zoom * 1.5)}>
          <PlusIcon aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" onClick={() => zoomAt(1)}>{uiText("适应窗口")}</Button>
      </div>
    </div>
  );
}
