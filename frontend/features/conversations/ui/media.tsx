import {uiText} from "@/shared/i18n"
import {createContext, useContext, useEffect, useMemo, useState, type ImgHTMLAttributes, type PropsWithChildren} from "react"
import type {ImageMessagePartComponent} from "@assistant-ui/react"
import {MarkdownText} from "../components/assistant-ui/elements/markdown-text"
import {Image} from "../components/assistant-ui/elements/image"
import type {ChatController} from "../runtime/controller"
import type {Entry} from "../model/messages"
import {ChatFileProvider, ChatMarkdownLink, ChatInlineCode} from "./file-preview"
import {chatURLTransform} from "../model/links"
import {VisualizationBlock, VisualizationContext, remarkDirectiveMarkers, remarkVisualization} from "./visualization"

type Media = {refs: Map<string, string>; load: (ref: string) => Promise<string>};
const MediaContext = createContext<Media | null>(null);
export function ChatMediaProvider({controller, entries, children}: PropsWithChildren<{controller: ChatController; entries: Entry[]}>) {
  const refs = useMemo(() => new Map(entries.flatMap(e => Object.entries(e.local_images || {}))), [entries]);
  const session = controller.getSnapshot().session?.id;
  const visualizations = useMemo(() => ({session, refs: new Map(entries.flatMap(e => Object.entries(e.visualizations || {})))}), [entries, session]);
  const load = useMemo(() => {
    const pending = new Map<string, Promise<string>>();
    return (ref: string) => {
      if (!pending.has(ref)) {
        const session = controller.getSnapshot().session?.id;
        const request = controller.options.request<{data_url: string}>(`/api/sessions/${encodeURIComponent(session || "")}/image?ref=${encodeURIComponent(ref)}`).then(data => {
          if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(data.data_url)) throw new Error(uiText("图片格式不受支持"));
          return data.data_url;
        }).catch(error => {pending.delete(ref); throw error;});
        if (pending.size >= 64) { const oldest = pending.keys().next(); if (!oldest.done) pending.delete(oldest.value); }
        pending.set(ref, request);
      }
      const request = pending.get(ref);
      if (!request) throw new Error("Missing image request");
      return request;
    };
  }, [controller]);
  const value = useMemo(() => ({refs, load}), [refs, load]);
  return <MediaContext.Provider value={value}><VisualizationContext.Provider value={visualizations}><ChatFileProvider controller={controller}>{children}</ChatFileProvider></VisualizationContext.Provider></MediaContext.Provider>;
}
function useLocalImage(source: string) {
  const media = useContext(MediaContext);
  let decoded = source; try {decoded = decodeURI(source);} catch { /* Keep the literal source. */ }
  const ref = media?.refs.get(source) || media?.refs.get(decoded);
  const load = media?.load;
  const [loaded, setLoaded] = useState<{ref?: string; image?: string; error?: boolean}>({});
  useEffect(() => {
    if (!ref || !load) return;
    let current = true;
    void load(ref).then(image => {if (current) setLoaded({ref, image});}, () => {if (current) setLoaded({ref, error: true});});
    return () => {current = false;};
  }, [ref, load]);
  return {ref, ...(loaded.ref === ref ? loaded : {})};
}
function ChatMarkdownImage({src, alt, title}: ImgHTMLAttributes<HTMLImageElement>) {
  const source = typeof src === "string" ? src : "";
  const local = source.startsWith("/") || /^[a-z]:[\\/]/i.test(source);
  const loaded = useLocalImage(source);
  if (!local) return <img src={source || undefined} alt={alt} title={title} className="max-w-full rounded-lg" loading="lazy" />;
  if (loaded.error || !loaded.ref) return <span className="chat-image-unavailable text-xs text-muted-foreground">{alt || uiText("图片")}{" "}{uiText("· 图片不存在、已移动或暂不可读取")}</span>;
  if (!loaded.image) return <span className="text-xs text-muted-foreground" role="status">{uiText("正在加载")}{alt || uiText("图片")}…</span>;
  return <img src={loaded.image} alt={alt} title={title} className="chat-history-image max-w-full rounded-lg" loading="lazy" />;
}
const markdownComponents = {img: ChatMarkdownImage, a: ChatMarkdownLink, code: ChatInlineCode, div: VisualizationBlock};
const chatRemarkPlugins = [remarkVisualization, remarkDirectiveMarkers];
export function ChatMessageText() {return <MarkdownText components={markdownComponents} urlTransform={chatURLTransform} remarkPlugins={chatRemarkPlugins} />;}
export const ChatUserImage: ImageMessagePartComponent = props => {
  const loaded = useLocalImage(props.image);
  if (/^data:image\//.test(props.image)) return <Image {...props} />;
  if (loaded.error) return <span className="text-xs text-muted-foreground">{uiText("图片不存在或已移动")}</span>;
  return loaded.image ? <Image {...props} image={loaded.image} /> : <span className="text-xs text-muted-foreground">{uiText("正在加载图片…")}</span>;
};

export function ChatToolImage({source}: {source: string}) {
  const loaded = useLocalImage(source);
  const image = source.startsWith("data:image/") ? source : loaded.image;
  if (loaded.error || !image && !loaded.ref) return <span className="chat-tool-metadata">{uiText("图片不存在或已移动")}</span>;
  if (!image) return <span className="chat-tool-metadata" role="status">{uiText("正在加载图片…")}</span>;
  return <Image.Root size="sm" className="chat-tool-image"><Image.Zoom src={image} alt={uiText("已查看的图片")}><Image.Preview src={image} alt={uiText("已查看的图片")} fit="contain" ratio="4:3" /></Image.Zoom></Image.Root>;
}
