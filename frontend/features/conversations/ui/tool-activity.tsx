import {type PropsWithChildren} from "react"
import {useAuiState, type ToolCallMessagePartComponent} from "@assistant-ui/react"
import {BookOpenIcon, FilePenLineIcon, FolderSearchIcon, ImageIcon, LoaderCircleIcon, SearchIcon, TerminalIcon, WrenchIcon, XCircleIcon} from "lucide-react"
import {ToolFallback} from "../components/assistant-ui/elements/tool-fallback.aui"
import {ToolGroupContent, ToolGroupRoot, ToolGroupTrigger} from "../components/assistant-ui/elements/tool-group.aui"
import type {ThreadGroupPart} from "../components/assistant-ui/elements/thread.aui"
import {ChatToolImage} from "./media"
import {toolPresentation, toolGroupSummary} from "../model/tool-presentation"
import {uiText} from "@/shared/i18n"

export const toolIcons = {read:BookOpenIcon, explore:FolderSearchIcon, edit:FilePenLineIcon, command:TerminalIcon, search:SearchIcon, image:ImageIcon, tool:WrenchIcon};

export function ChatToolResult({result: value}: {result: unknown}) {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return <>
    {typeof result.output === "string" && <div className="aui-tool-fallback-result"><pre className="chat-tool-source" tabIndex={0} aria-label={uiText("操作输出")}>{result.output}</pre></div>}
    {(typeof result.exit_code === "number" || typeof result.duration_ms === "number") && <p className="chat-tool-metadata">
      {typeof result.exit_code === "number" && <span>{uiText("退出码 {0}", result.exit_code)}</span>}
      {typeof result.duration_ms === "number" && <span>{uiText("耗时 {0} 秒", Math.round(result.duration_ms / 100) / 10)}</span>}
    </p>}
  </>;
}

export function ChatToolGroup({group, children}: PropsWithChildren<{group: ThreadGroupPart}>) {
  const content = useAuiState(state => state.message.content);
  const parts = group.indices.flatMap(index => content[index]?.type === "tool-call" ? [content[index]] : []);
  const images = [...new Set(parts.flatMap(part => toolPresentation(part).images))];
  return <ToolGroupRoot variant="ghost">
    <ToolGroupTrigger count={parts.length} active={group.status.type === "running"} label={toolGroupSummary(parts)} />
    <ToolGroupContent>{children}</ToolGroupContent>
    {images.length > 0 && <div className="chat-tool-images" aria-label={uiText("已查看的图片")}>{images.map(source => <ChatToolImage key={source} source={source} />)}</div>}
  </ToolGroupRoot>;
}

export const ChatActivityTool: ToolCallMessagePartComponent = props => {
  if (typeof props.args.command !== "string" && typeof props.args.activity !== "string") return <ToolFallback {...props} />;
  const summary = toolPresentation(props);
  const Icon = summary.state === "running" ? LoaderCircleIcon : summary.state === "failed" ? XCircleIcon : toolIcons[summary.kind];
  const result = props.result && typeof props.result === "object" ? props.result as Record<string, unknown> : {};
  const command = typeof props.args.command === "string" ? props.args.command : undefined;
  const activity = typeof props.args.activity === "string" ? props.args.activity : undefined;
  const details = command || activity || typeof result.output === "string";
  const label = <><span>{summary.label}</span>{summary.detail && <> <span className="chat-tool-detail" title={summary.detail}>{summary.detail}</span></>}</>;
  if (!details) return <div className="chat-tool-static" data-state={summary.state}><Icon aria-hidden="true" /><span>{summary.label}</span></div>;
  return <ToolFallback.Root className="chat-tool-activity" data-state={summary.state}>
    <ToolFallback.Trigger className={summary.state === "failed" ? "text-xs text-destructive" : "text-xs"} toolName={props.toolName} status={props.status} responseDeliveryStatus={props.responseDeliveryStatus} icon={Icon} label={label} />
    <ToolFallback.Content>
      <ToolFallback.Error status={props.status} />
      <div className="aui-tool-fallback-args">
        {(command || activity) && <pre className="chat-tool-source">{command || activity}</pre>}
        {typeof props.args.cwd === "string" && <p className="chat-tool-metadata">{uiText("工作目录 ·")} {props.args.cwd}</p>}
      </div>
      <ChatToolResult result={props.result} />
    </ToolFallback.Content>
  </ToolFallback.Root>;
};
