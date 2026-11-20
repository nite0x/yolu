import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ArrowUpRight, Check, Circle, LoaderCircle, X, ChevronDown, FolderGit2, Folder, GitBranch, Layers, Search, Server, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { uiText, uiLocale } from "../i18n";
import { statusLabels } from "../workspace/shared";
import {
  GlobalAssistantController,
  type AssistantActivity,
  type AssistantPlan,
  type AssistantResource,
} from "./global-assistant-controller";

const AssistantControllerContext = createContext<GlobalAssistantController | null>(null);
export const AssistantActionsProvider = AssistantControllerContext.Provider;

// The cards own their disclosure state. An outer tool-group disclosure would
// hide pending confirmation buttons inside the conversation.
export function AssistantActionGroup({children}: PropsWithChildren) {
  return <>{children}</>;
}

export const AssistantActionTool: ToolCallMessagePartComponent = ({args}) => {
  const controller = useContext(AssistantControllerContext);
  if (!controller || typeof args.run_id !== "string") return null;
  return <AssistantActions controller={controller} runID={args.run_id} />;
};

function capabilityLabel(capability: string) {
  const labels: Record<string, string> = {
    "app.getContext": uiText("当前上下文"),
    "project.list": uiText("查询项目"),
    "project.get": uiText("项目详情"),
    "project.register": uiText("登记项目"),
    "workspace.list": uiText("查询工作区"),
    "workspace.get": uiText("工作区详情"),
    "workspace.create": uiText("创建工作区"),
    "workspace.attachProject": uiText("添加参与项目"),
    "git.status": uiText("Git 状态"),
    "git.worktree.list": uiText("工作目录"),
    "conversation.list": uiText("查询对话"),
    "conversation.open": uiText("打开对话"),
    "conversation.start_codex": uiText("启动 Codex 对话"),
    "app.navigate": uiText("打开资源"),
    project_scan: uiText("扫描目录"),
    app_get_context: uiText("当前上下文"),
    workspace_attach_project: uiText("添加参与项目"),
    git_worktree_list: uiText("工作目录"),
    environment_list: uiText("执行环境"),
    assistant_plan_status: uiText("操作计划状态"),
  };
  return labels[capability] || labels[capability.replaceAll("_", ".")] || capability;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: uiText("等待计划确认"),
    running: uiText("执行中"),
    cancelling: uiText("正在停止…"),
    succeeded: uiText("已完成"),
    completed: uiText("已完成"),
    partial: uiText("部分完成"),
    failed: uiText("执行失败"),
    cancelled: uiText("已取消"),
    conflict: uiText("需要重新确认"),
    unknown: uiText("待核实"),
  };
  return labels[status] || status;
}

function resourceKind(kind: AssistantResource["kind"]) {
  return kind === "workspace" ? uiText("工作区") : kind === "project" ? uiText("项目") : uiText("对话");
}

function ResourceList({
  resources,
  controller,
  choose = false,
}: {
  resources?: AssistantResource[];
  controller: GlobalAssistantController;
  choose?: boolean;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!resources?.length) return null;
  return (
    <ul className="assistant-resource-list" aria-label={choose ? uiText("选择资源") : uiText("相关资源")}>
      {resources.map((resource) => (
        <li key={JSON.stringify([resource.environment_id, resource.kind, resource.id])} className="assistant-resource">
          <span className="assistant-resource-icon">{resource.kind === "project" ? <FolderGit2 aria-hidden="true" /> : <Layers aria-hidden="true" />}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={resource.name}>{resource.name}</p>
            <p className="text-xs text-muted-foreground">{resourceKind(resource.kind)} · {resource.environment_id}</p>
            {resource.path && <p className="truncate font-mono text-xs text-muted-foreground" title={resource.path}>{resource.path}</p>}
          </div>
          {choose ? (
            <Button type="button" size="sm" variant="outline" disabled={controller.readOnly || controller.busy || state.submitting} onClick={() => controller.chooseResource(resource)}>
              {uiText("选择")}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={!!state.navigating || !controller.options.openResource} aria-label={uiText("打开{0}：{1}", resourceKind(resource.kind), resource.name)} onClick={() => void controller.openResource(resource)}>
              {uiText("打开")}<ArrowUpRight aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function reviewLabel(key: string) {
  const labels: Record<string, string> = {
    input: uiText("请求内容"),
    name: uiText("名称"),
    slug: uiText("目录标识"),
    description: uiText("开发目标"),
    environment_id: uiText("执行环境"),
    path: uiText("路径"),
    root: uiText("工作区根目录"),
    directory: uiText("工作目录"),
    project: uiText("项目"),
    projects: uiText("参与项目"),
    project_id: uiText("项目标识"),
    project_ids: uiText("参与项目标识"),
    project_name: uiText("项目名称"),
    primary_project_id: uiText("主项目标识"),
    common_dir: uiText("仓库公共目录"),
    folder: uiText("目录名称"),
    workspace: uiText("工作区记录"),
    workspace_id: uiText("工作区标识"),
    members: uiText("参与项目"),
    mode: uiText("目录模式"),
    base_ref: uiText("来源引用"),
    base_commit: uiText("基线提交"),
    branch: uiText("目标分支"),
    head: uiText("当前提交"),
    commit: uiText("提交"),
    state: uiText("状态"),
    error: uiText("错误"),
    id: uiText("标识"),
    has_directory: uiText("创建工作区目录"),
    existing: uiText("现有资源"),
    warnings: uiText("提示"),
    fingerprint: uiText("状态校验值"),
    operation: uiText("操作详情"),
    codex: uiText("启动 Codex 对话"),
    first_instruction: uiText("首条指令"),
    additional_directories: uiText("额外工作目录"),
    settings: uiText("设置"),
    model: uiText("模型"),
    permission: uiText("权限"),
    added: uiText("新增参与项目"),
    items: uiText("查询结果"),
    created_at: uiText("创建时间"),
    updated_at: uiText("更新时间"),
    context_warning: uiText("上下文生成提示"),
    worktrees: uiText("工作目录"),
    worktree: uiText("工作目录"),
    has_master: uiText("默认分支可用"),
    status_updated_at: uiText("状态更新时间"),
    refreshing: uiText("正在刷新"),
    bare: uiText("裸仓库"),
    detached: uiText("游离 HEAD"),
    locked: uiText("已锁定"),
    prunable: uiText("待清理"),
    missing: uiText("目录缺失"),
    dirty: uiText("变更文件数"),
    ahead: uiText("领先提交数"),
    behind: uiText("落后提交数"),
    compare_available: uiText("可比较分支"),
    comparison_ref: uiText("比较引用"),
    upstream: uiText("跟踪分支"),
    sync_available: uiText("同步状态可用"),
    sync_ahead: uiText("待推送提交数"),
    sync_behind: uiText("待拉取提交数"),
    merge_head: uiText("合并目标"),
    conflicts: uiText("冲突文件"),
    workspaces: uiText("关联工作区"),
    workspace_name: uiText("工作区名称"),
    expected_branch: uiText("预期分支"),
    status: uiText("状态"),
    capability: uiText("应用能力"),
    resources: uiText("相关资源"),
    error_code: uiText("错误代码"),
    selection: uiText("当前选择"),
    environments: uiText("执行环境"),
    connected: uiText("已连接"),
    project_count: uiText("项目数量"),
    cwd: uiText("工作目录"),
    archived: uiText("已归档"),
  };
  return labels[key] || key.replaceAll("_", " ");
}

function ReviewFields({ value, field }: {value: unknown; field?: string}) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? uiText("是") : uiText("否")}</span>;
  if (typeof value !== "object") {
    const modes: Record<string, string> = {new: uiText("新分支工作目录"), existing: uiText("已有分支工作目录"), project: uiText("复用项目目录"), worktree: uiText("复用工作目录")};
    const labels = field === "mode" ? modes : field === "state" ? statusLabels : {};
    const text = field === "status" ? statusLabel(String(value)) : field === "capability" ? capabilityLabel(String(value)) : labels[String(value)] || String(value);
    return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</span>;
  }
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="border-l pl-3"><ReviewFields value={item} /></li>)}</ul>;
  return (
    <dl className="min-w-0 space-y-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className={item !== null && typeof item === "object" ? "space-y-2" : "grid min-w-0 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-3"}>
          <dt className="text-muted-foreground">{reviewLabel(key)}</dt>
          <dd className="min-w-0"><ReviewFields value={item} field={key} /></dd>
        </div>
      ))}
    </dl>
  );
}

function PlanReview({plan, operation, target}: {plan: AssistantPlan; operation: Record<string, unknown>; target?: Record<string, unknown>}) {
  if (!target) return <ReviewFields value={Object.keys(plan.review || {}).length ? plan.review : plan.arguments} />;
  const members = (operation.added || target.members) as Record<string, unknown>[] | undefined;
  const codex = operation.codex as {
    first_instruction: string;
    cwd: string;
    additional_directories?: string[];
    settings?: {model?: string; permission?: string};
  } | undefined;
  const permissionLabels: Record<string, string> = {
    ask: uiText("请求批准"),
    auto: uiText("帮我批准"),
    full: uiText("完全访问权限"),
  };
  return <div className="assistant-plan-review">
    {typeof target.description === "string" && target.description && <p className="assistant-plan-description">{target.description}</p>}
    {typeof target.path === "string" && target.path && <div className="assistant-plan-location">
      <Folder aria-hidden="true" />
      <div><span>{uiText("工作目录")}</span><code>{target.path}</code></div>
    </div>}
    {typeof target.branch === "string" && target.branch && !members?.length && <div className="assistant-plan-branch"><GitBranch aria-hidden="true" /><span>{uiText("目标分支")}</span><code>{target.branch}</code></div>}
    {members?.length ? <section className="assistant-plan-projects" aria-label={operation.added ? uiText("新增参与项目") : uiText("参与项目")}>
      <h3>{operation.added ? uiText("新增参与项目") : uiText("参与项目")}</h3>
      <ul className="assistant-plan-members">{members.map((member, index) => <li key={String(member.project_id || index)}>
        <div className="assistant-plan-member-heading">
          <FolderGit2 aria-hidden="true" />
          <strong>{String(member.project_name || member.project_id || "")}</strong>
          <Badge variant="secondary"><ReviewFields value={member.mode} field="mode" /></Badge>
        </div>
        <dl className="assistant-plan-member-facts">
          {typeof member.path === "string" && member.path && <div className="assistant-plan-member-path"><dt>{uiText("工作目录")}</dt><dd><code>{member.path}</code></dd></div>}
          {typeof member.branch === "string" && member.branch && <div><dt>{uiText("目标分支")}</dt><dd><GitBranch aria-hidden="true" /><code>{member.branch}</code></dd></div>}
          {typeof member.base_ref === "string" && member.base_ref && <div><dt>{uiText("来源引用")}</dt><dd><code>{member.base_ref}</code></dd></div>}
        </dl>
      </li>)}</ul>
    </section> : null}
    {codex && <section className="assistant-plan-projects" aria-label={uiText("启动 Codex 对话")}>
      <h3>{uiText("工作目录就绪后启动 Codex")}</h3>
      <dl className="space-y-2">
        <div><dt>{uiText("首条指令")}</dt><dd className="assistant-plan-description">{codex.first_instruction}</dd></div>
        <div><dt>{uiText("主工作目录")}</dt><dd><code className="[overflow-wrap:anywhere]">{codex.cwd}</code></dd></div>
        {!!codex.additional_directories?.length && <div>
          <dt>{uiText("额外工作目录")}</dt>
          <dd><ul>{codex.additional_directories.map((path) => <li key={path}><code className="[overflow-wrap:anywhere]">{path}</code></li>)}</ul></dd>
        </div>}
        <div><dt>{uiText("模型")}</dt><dd>{codex.settings?.model || uiText("沿用 Codex 默认模型")}</dd></div>
        <div><dt>{uiText("权限")}</dt><dd>{permissionLabels[codex.settings?.permission || ""] || uiText("沿用 Codex 默认权限")}</dd></div>
      </dl>
    </section>}
    <details className="assistant-action-details"><summary><ChevronDown aria-hidden="true" />{uiText("完整计划")}</summary><div><p className="mb-3 text-muted-foreground">{uiText("执行环境 {0} · 计划版本 {1}", plan.environment_id, plan.revision)}</p><ReviewFields value={plan.review} /></div></details>
  </div>;
}

function ActivityResult({activity, controller}: {activity: AssistantActivity; controller: GlobalAssistantController}) {
  const result = activity.result || {};
  const error = typeof result.error === "string" ? result.error : result.error?.message;
  const refreshed = result.refreshed_at && new Date(result.refreshed_at);
  return (
    <details className="assistant-activity" open={!!(result.choices?.length || error || result.errors?.length) || undefined}>
      <summary><Search aria-hidden="true" /><span>{capabilityLabel(activity.capability)}</span><span className="assistant-activity-status">{statusLabel(activity.status)}</span><ChevronDown className="assistant-disclosure-icon" aria-hidden="true" /></summary>
      <div className="assistant-activity-content">
        {result.message && <p>{uiText(result.message)}</p>}
        {error && <p role="alert" className="text-destructive">{uiText(error)}</p>}
        {typeof result.error === "object" && result.error.details?.map((detail, index) => <p key={index} role="alert" className="text-destructive">{uiText(detail)}</p>)}
        <ResourceList resources={result.resources} controller={controller} />
        <ResourceList resources={result.choices} controller={controller} choose />
        {result.data !== undefined && (result.resources?.length || result.choices?.length ? <details className="assistant-action-details"><summary><ChevronDown aria-hidden="true" />{uiText("查询详情")}</summary><div><ReviewFields value={result.data} /></div></details> : <ReviewFields value={result.data} />)}
        {result.errors?.map((error, index) => <p key={index} role="alert" className="text-destructive">{error.environment_id && `${error.environment_id} · `}{uiText(error.message || error.error || "")}</p>)}
        {refreshed && !Number.isNaN(refreshed.getTime()) && <p className="text-xs text-muted-foreground">{uiText("查询时间 {0}", refreshed.toLocaleString(uiLocale()))}</p>}
        {result.next_cursor !== undefined && result.next_cursor !== "" && result.next_cursor !== 0 && <p className="text-xs text-muted-foreground">{uiText("还有更多结果，可以继续请求下一页。")}</p>}
      </div>
    </details>
  );
}

function ExecutionDetails({value}: {value: unknown}) {
  if (value === null || value === undefined) return null;
  const result = typeof value === "object" ? value as Record<string, unknown> : {};
  const members = Array.isArray(result.members) ? result.members as Record<string, unknown>[] : [];
  return <div className="mt-2 space-y-2">
    {typeof result.context_warning === "string" && result.context_warning && <p role="status">{uiText(result.context_warning)}</p>}
    {members.filter((member) => typeof member.error === "string" && member.error).map((member, index) => <p key={String(member.project_id || index)} role="alert" className="break-words text-destructive">{String(member.project_name || member.project_id || "")} · {uiText(String(member.error))}</p>)}
    <details className="assistant-action-details"><summary><ChevronDown aria-hidden="true" />{uiText("执行结果")}</summary><div><ReviewFields value={value} /></div></details>
  </div>;
}

function PlanCard({plan, controller}: {plan: AssistantPlan; controller: GlobalAssistantController}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const active = ["pending", "running", "cancelling", "unknown", "partial", "conflict"].includes(plan.status);
  const deciding = !!state.deciding[plan.id];
  const error = state.decisionErrors[plan.id] || plan.error;
  const operation = (plan.review?.operation || plan.review || {}) as Record<string, unknown>;
  const target = (operation.workspace || operation.project) as Record<string, unknown> | undefined;
  const name = target?.name || plan.arguments?.name;
  const working = ["running", "cancelling"].includes(plan.status);
  const needsAttention = ["failed", "partial", "conflict", "unknown"].includes(plan.status);
  const StatusIcon = working ? LoaderCircle : needsAttention ? AlertCircle : ["succeeded", "completed"].includes(plan.status) ? Check : Circle;
  const hasActions = ["pending", "running", "unknown"].includes(plan.status);
  return (
    <details open={active || undefined} className="assistant-plan" data-assistant-plan={plan.id} data-status={plan.status}>
      <summary className="assistant-plan-header">
        <span className="assistant-plan-icon">{plan.capability.replaceAll("_", ".") === "project.register" ? <FolderGit2 aria-hidden="true" /> : <Layers aria-hidden="true" />}</span>
        <span className="assistant-plan-title">{typeof name === "string" && name ? <><span>{capabilityLabel(plan.capability)}</span><strong>{name}</strong></> : <strong>{capabilityLabel(plan.capability)}</strong>}</span>
        <Badge variant="secondary" className="assistant-plan-status"><StatusIcon aria-hidden="true" className={working ? "animate-spin motion-reduce:animate-none" : undefined} />{statusLabel(plan.status)}</Badge>
        <ChevronDown className="assistant-disclosure-icon" aria-hidden="true" />
      </summary>
      <div className="assistant-plan-body">
        <PlanReview plan={plan} operation={operation} target={target} />
        {plan.status !== "pending" && plan.steps?.length > 0 && <ol className="assistant-plan-steps" aria-label={uiText("执行进度")} aria-live="polite">
          {plan.steps.map((step) => <li key={step.id} className="flex gap-2">
            {step.status === "running" ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : ["succeeded", "completed"].includes(step.status) ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : step.status === "failed" ? <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <Circle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><p>{capabilityLabel(step.label)} · {statusLabel(step.status)}</p>{step.error && <p className="break-words text-destructive">{uiText(step.error)}</p>}<ExecutionDetails value={step.result} /></div>
          </li>)}
        </ol>}
        {error && <Alert variant="destructive"><AlertDescription>{uiText(error)}</AlertDescription></Alert>}
        {plan.status === "conflict" && <p>{uiText("项目、路径或分支已变化，请让助手重新生成计划。")}</p>}
        {plan.status === "unknown" && <p>{uiText("执行结果需要核实。可检查已创建的资源并刷新结果。")}</p>}
        {plan.status === "partial" && !operation.codex && <p>{uiText("已完成的项目已保留。打开工作区查看失败原因并继续处理。")}</p>}
        <ResourceList resources={plan.resources} controller={controller} />
      </div>
      <footer className="assistant-plan-footer">
        <span className="assistant-plan-environment"><Server aria-hidden="true" />{plan.environment_id === "local" ? uiText("本机") : plan.environment_id}</span>
        {hasActions && <div className="assistant-plan-buttons">
          {["pending", "running"].includes(plan.status) && <Button type="button" size="sm" variant="ghost" disabled={controller.readOnly || deciding} onClick={() => void controller.decide(plan.id, "cancel", plan)}>{plan.status === "running" ? uiText("停止执行") : uiText("取消计划")}</Button>}
          {plan.status === "pending" && <Button type="button" size="sm" disabled={controller.readOnly || deciding} onClick={() => void controller.decide(plan.id, "approve", plan)}>{deciding ? uiText("正在提交…") : uiText("确认并执行")}</Button>}
          {plan.status === "unknown" && <Button type="button" size="sm" variant="outline" disabled={controller.readOnly || deciding} onClick={() => void controller.reconcile(plan.id)}>{deciding ? uiText("正在核实…") : uiText("核实执行结果")}</Button>}
        </div>}
      </footer>
    </details>
  );
}

function AssistantActions({controller, runID}: {controller: GlobalAssistantController; runID: string}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activities = state.activities.filter((activity) => activity.run_id === runID).sort((a, b) => a.id - b.id);
  const plans = state.plans.filter((plan) => plan.run_id === runID).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  if (!activities.length && !plans.length) return null;
  return (
    <section className="my-3 min-w-0 space-y-3" aria-label={uiText("应用操作")} data-assistant-actions={runID}>
      {activities.length > 0 && <details className="assistant-queries" open={activities.some((activity) => !!(activity.result?.choices?.length || activity.result?.error || activity.result?.errors?.length)) || undefined}>
        <summary><Search aria-hidden="true" /><span>{uiText("{0} 项应用查询", activities.length)}</span><ChevronDown className="assistant-disclosure-icon" aria-hidden="true" /></summary>
        <div className="mt-2 space-y-2">{activities.map((activity) => <ActivityResult key={activity.id} activity={activity} controller={controller} />)}</div>
      </details>}
      {plans.map((plan) => <PlanCard key={plan.id} plan={plan} controller={controller} />)}
    </section>
  );
}
