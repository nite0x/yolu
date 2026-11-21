import {createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps} from "react";
import type {Root} from "mdast";
import {ChartNoAxesCombinedIcon, ChevronDownIcon} from "lucide-react";
import {uiText} from "../i18n";
import {Button} from "@/components/ui/button";

export const VisualizationContext = createContext<{session?: string; refs: ReadonlyMap<string, string>} | null>(null);

export function remarkVisualization() {
  return (tree: Root, file: {toString(): string}) => {
    const source = file.toString();
    if (!source.includes("visualize")) return;
    for (const node of tree.children) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (node.type !== "paragraph" || start === undefined || end === undefined) continue;
      const marker = /^visualize([^\r\n]{1,8192})$/.exec(source.slice(start, end).trim());
      if (!marker) continue;
      try {
        const value = JSON.parse(marker[1]);
        if (typeof value?.path !== "string" || !value.path) continue;
        node.data = {hName: "div", hProperties: {"data-visualization": value.path, "data-visualization-title": typeof value.title === "string" ? value.title.slice(0, 120) : undefined}};
        node.children = [];
      } catch { /* Invalid references remain ordinary text. */ }
    }
  };
}

export function VisualizationBlock({node: _node, ...props}: ComponentProps<"div"> & {node?: unknown; "data-visualization"?: string; "data-visualization-title"?: string}) {
  const path = props["data-visualization"];
  if (!path) return <div {...props} />;
  return <VisualizationCard key={path} path={path} title={props["data-visualization-title"]} />;
}

function VisualizationCard({path, title}: {path: string; title?: string}) {
  const context = useContext(VisualizationContext);
  const ref = context?.refs.get(path);
  const frame = useRef<HTMLIFrameElement>(null);
  const contentID = useId();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{height: number} | "unavailable">();
  const label = title || uiText("交互预览");
  const theme = document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light";
  const src = ref && context?.session ? `/session-visualization/${encodeURIComponent(context.session)}?ref=${encodeURIComponent(ref)}&theme=${theme}` : undefined;

  useEffect(() => {
    if (!open || !src) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== "null" || event.source !== frame.current?.contentWindow || event.data?.type !== "yolu-visualization") return;
      if (event.data.unavailable === true) setResult("unavailable");
      else if (typeof event.data.height === "number" && Number.isFinite(event.data.height)) {
        const height = Math.max(80, Math.min(1200, event.data.height));
        setResult(previous => typeof previous === "object" && previous.height === height ? previous : {height});
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [open, src]);

  return <div className="chat-visualization">
    <Button type="button" size="sm" variant="ghost" className="chat-visualization-trigger" aria-expanded={open} aria-controls={contentID}
      title={path.split(/[\\/]/).at(-1)} disabled={!src} onClick={() => {setResult(undefined); setOpen(!open);}}>
      <ChartNoAxesCombinedIcon aria-hidden="true" /><span>{label}</span><ChevronDownIcon aria-hidden="true" />
    </Button>
    {!src && <p>{uiText("交互预览不可用")}</p>}
    <div id={contentID} hidden={!open}>
      {open && src && result !== "unavailable" && <iframe ref={frame} title={label} src={src} sandbox="allow-scripts" referrerPolicy="no-referrer" height={result?.height || 460} />}
      {open && result === "unavailable" && <p role="status">{uiText("交互预览不可用")}</p>}
    </div>
  </div>;
}
