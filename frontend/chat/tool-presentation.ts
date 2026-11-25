import {uiText} from "../i18n";

export interface ToolRecord {
  type?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  status?: {type: string; reason?: string};
}
export type ToolKind = "read" | "explore" | "edit" | "command" | "search" | "image" | "tool";
const names = () => ({read:uiText("读取文件"), explore:uiText("浏览文件"), edit:uiText("编辑文件"), command:uiText("运行命令"), search:uiText("搜索"), image:uiText("查看图片"), tool:uiText("调用工具")});
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;

export function toolPresentation(part: ToolRecord) {
  const args = part.args || {};
  const result = part.result && typeof part.result === "object" ? part.result as Record<string, unknown> : {};
  const state = part.isError || result.status === "failed" || typeof result.exit_code === "number" && result.exit_code !== 0 || part.status?.type === "incomplete" && part.status.reason !== "cancelled" ? "failed"
    : part.status?.reason === "cancelled" || result.status === "interrupted" ? "cancelled"
    : result.status === "inProgress" || part.status?.type === "running" ? "running"
    : result.status === "completed" ? "completed" : "unknown";
  let kind: ToolKind = "tool";
  let detail = "";
  const images = Array.isArray(args.images) ? args.images.filter((image): image is string => typeof image === "string") : [];
  if (typeof args.changes === "string") {
    kind = "edit";
    const files = Array.isArray(args.files) ? args.files : [];
    detail = files.flatMap(file => file && typeof file.path === "string" ? [fileName(file.path)] : []).join(" · ");
  } else if (typeof args.command === "string") {
    kind = "command";
    const actions = Array.isArray(args.actions) ? args.actions : [];
    const categories = actions.map(action => action?.type);
    if (categories.length && categories.every(type => type === "read")) kind = "read";
    else if (categories.length && categories.every(type => ["read", "search", "listFiles"].includes(type))) kind = "explore";
    // Older history can lack native action descriptions. Classify only a
    // simple command; shell pipelines and compound scripts stay commands.
    else if (!categories.length && !/[;&|<>`\r\n]|\$\(/.test(args.command)) {
      const executable = args.command.trim().split(/\s/, 1)[0].split(/[\\/]/).at(-1);
      if (["cat", "head", "tail", "sed", "Get-Content"].includes(executable || "")) kind = "read";
      if (["ls", "find", "rg", "grep", "Get-ChildItem", "Select-String"].includes(executable || "")) kind = "explore";
    }
    detail = actions.flatMap(action => typeof action?.path === "string" ? [fileName(action.path)] : []).join(" · ") || args.command.trim().split(/\r?\n/, 1)[0];
  } else if (args.activity_type === "imageView" || /^(?:查看图片|imageView|(?:functions\.)?view_image)$/.test(part.toolName || "")) {
    kind = "image";
    detail = typeof args.activity === "string" ? fileName(args.activity) : "";
  } else if (args.activity_type === "webSearch" || part.toolName === "网页搜索") {
    kind = "search";
    detail = typeof args.activity === "string" ? args.activity : "";
  } else if (typeof args.activity === "string") {
    detail = args.activity;
  }
  const action = kind !== "tool" ? names()[kind] : args.activity_type === "plan" || part.toolName === "计划" ? uiText("更新计划")
    : args.activity_type === "contextCompaction" || part.toolName === "上下文整理" ? uiText("整理上下文")
    : part.toolName ? uiText("调用 {0}", part.toolName) : names().tool;
  const label = state === "running" ? uiText("正在{0}", action) : state === "completed" ? uiText("已{0}", action)
    : state === "failed" ? uiText("{0}失败", action) : state === "cancelled" ? uiText("已取消{0}", action) : action;
  return {kind, label, detail, images, state};
}

export function toolGroupSummary(parts: readonly ToolRecord[]) {
  const counts = new Map<ToolKind, number>();
  let failed = 0;
  for (const part of parts) {
    const summary = toolPresentation(part);
    counts.set(summary.kind, (counts.get(summary.kind) || 0) + 1);
    if (summary.state === "failed") failed++;
  }
  const labels = names();
  const text = [...counts].map(([kind, count]) => uiText("{0} {1} 次", labels[kind], count));
  if (failed) text.push(uiText("{0} 项失败", failed));
  return text.join(" · ");
}
