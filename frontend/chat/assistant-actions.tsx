import { useSyncExternalStore } from "react";
import { ArrowUpRight, Check, Circle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { uiText, uiLocale } from "../i18n";
import { statusLabels } from "../workspace/shared";
import {
  GlobalAssistantController,
  type AssistantActivity,
  type AssistantPlan,
  type AssistantResource,
} from "./global-assistant-controller";

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
    "app.navigate": uiText("打开资源"),
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
    <ul className="space-y-2" aria-label={choose ? uiText("选择资源") : uiText("相关资源")}>
      {resources.map((resource) => (
        <li key={JSON.stringify([resource.environment_id, resource.kind, resource.id])} className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2">
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
    workspace: uiText("工作区"),
    requirement: uiText("工作区"),
    requirement_id: uiText("工作区标识"),
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
    has_workspace: uiText("创建工作区目录"),
    existing: uiText("现有资源"),
    warnings: uiText("提示"),
    fingerprint: uiText("状态校验值"),
    operation: uiText("操作详情"),
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
    requirements: uiText("关联工作区"),
    requirement_name: uiText("工作区名称"),
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

function PlanReview({plan}: {plan: AssistantPlan}) {
  const review = plan.review || {};
  const operation = (review.operation || review) as Record<string, unknown>;
  const target = (operation.requirement || operation.project) as Record<string, unknown> | undefined;
  if (!target) return <ReviewFields value={Object.keys(review).length ? review : plan.arguments} />;
  const fields = Object.fromEntries(
    ["name", "description", "id", "path", "common_dir", "branch", "primary_project_id", "has_workspace"]
      .filter((key) => target[key] !== undefined && target[key] !== "")
      .map((key) => [key, target[key]]),
  );
  const members = (operation.added || target.members) as Record<string, unknown>[] | undefined;
  return <div className="space-y-3">
    <ReviewFields value={fields} />
    {members?.length ? <div className="space-y-2">
      <p className="font-medium">{operation.added ? uiText("新增参与项目") : uiText("参与项目")}</p>
      <ul className="space-y-3">{members.map((member, index) => <li key={String(member.project_id || index)} className="rounded-md bg-muted/40 p-3">
        <ReviewFields value={Object.fromEntries(["project_name", "project_id", "mode", "path", "base_ref", "base_commit", "branch"].filter((key) => member[key] !== undefined && member[key] !== "").map((key) => [key, member[key]]))} />
      </li>)}</ul>
    </div> : null}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">{uiText("完整计划")}</summary><div className="mt-3"><ReviewFields value={review} /></div></details>
  </div>;
}

function ActivityResult({activity, controller}: {activity: AssistantActivity; controller: GlobalAssistantController}) {
  const result = activity.result || {};
  const error = typeof result.error === "string" ? result.error : result.error?.message;
  const refreshed = result.refreshed_at && new Date(result.refreshed_at);
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="cursor-pointer text-sm focus-visible:outline-ring">{capabilityLabel(activity.capability)} · {statusLabel(activity.status)}</summary>
      <div className="mt-3 space-y-3 text-sm">
        {result.message && <p>{uiText(result.message)}</p>}
        {error && <p role="alert" className="text-destructive">{uiText(error)}</p>}
        {typeof result.error === "object" && result.error.details?.map((detail, index) => <p key={index} role="alert" className="text-destructive">{uiText(detail)}</p>)}
        <ResourceList resources={result.resources} controller={controller} />
        <ResourceList resources={result.choices} controller={controller} choose />
        {result.data !== undefined && <ReviewFields value={result.data} />}
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
    <details><summary className="cursor-pointer text-xs text-muted-foreground">{uiText("执行结果")}</summary><div className="mt-2"><ReviewFields value={value} /></div></details>
  </div>;
}

function PlanCard({plan, controller}: {plan: AssistantPlan; controller: GlobalAssistantController}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const active = ["pending", "running", "cancelling", "unknown", "partial", "conflict"].includes(plan.status);
  const deciding = !!state.deciding[plan.id];
  const error = state.decisionErrors[plan.id] || plan.error;
  return (
    <details open={active || undefined} className="rounded-lg border p-3" data-assistant-plan={plan.id}>
      <summary className="cursor-pointer text-sm font-medium focus-visible:outline-ring">{capabilityLabel(plan.capability)} · {statusLabel(plan.status)}</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">{uiText("执行环境 {0} · 计划版本 {1}", plan.environment_id, plan.revision)}</p>
        <PlanReview plan={plan} />
        {plan.steps?.length > 0 && <ol className="space-y-2" aria-label={uiText("执行进度")} aria-live="polite">
          {plan.steps.map((step) => <li key={step.id} className="flex gap-2">
            {step.status === "running" ? <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : ["succeeded", "completed"].includes(step.status) ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : step.status === "failed" ? <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <Circle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><p>{capabilityLabel(step.label)} · {statusLabel(step.status)}</p>{step.error && <p className="break-words text-destructive">{uiText(step.error)}</p>}<ExecutionDetails value={step.result} /></div>
          </li>)}
        </ol>}
        {error && <Alert variant="destructive"><AlertDescription>{uiText(error)}</AlertDescription></Alert>}
        {plan.status === "conflict" && <p>{uiText("项目、路径或分支已变化，请让助手重新生成计划。")}</p>}
        {plan.status === "unknown" && <p>{uiText("执行结果需要核实。可检查已创建的资源并刷新结果。")}</p>}
        {plan.status === "partial" && <p>{uiText("已完成的项目已保留。打开工作区查看失败原因并继续处理。")}</p>}
        <ResourceList resources={plan.resources} controller={controller} />
        <div className="flex flex-wrap gap-2">
          {plan.status === "pending" && <Button type="button" size="sm" disabled={controller.readOnly || deciding} onClick={() => void controller.decide(plan.id, "approve", plan)}>{deciding ? uiText("正在提交…") : uiText("确认并执行")}</Button>}
          {["pending", "running"].includes(plan.status) && <Button type="button" size="sm" variant="outline" disabled={controller.readOnly || deciding} onClick={() => void controller.decide(plan.id, "cancel", plan)}>{plan.status === "running" ? uiText("停止执行") : uiText("取消计划")}</Button>}
          {plan.status === "unknown" && <Button type="button" size="sm" variant="outline" disabled={controller.readOnly || deciding} onClick={() => void controller.reconcile(plan.id)}>{deciding ? uiText("正在核实…") : uiText("核实执行结果")}</Button>}
        </div>
      </div>
    </details>
  );
}

export function AssistantActions({controller}: {controller: GlobalAssistantController}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state.activities.length && !state.plans.length) return null;
  return (
    <section className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-t px-4 py-3" aria-label={uiText("应用操作")}>
      {state.activities.length > 0 && <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{uiText("{0} 项应用查询", state.activities.length)}</summary>
        <div className="mt-2 space-y-2">{state.activities.map((activity) => <ActivityResult key={activity.id} activity={activity} controller={controller} />)}</div>
      </details>}
      {state.plans.map((plan) => <PlanCard key={plan.id} plan={plan} controller={controller} />)}
    </section>
  );
}
