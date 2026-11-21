import {useId, useState, useSyncExternalStore, type RefObject} from "react";
import {CheckIcon, ChevronDownIcon, HandIcon, ShieldCheckIcon} from "lucide-react";
import {DropdownMenu, Popover} from "radix-ui";
import {Button} from "@/components/ui/button";
import {NativeSelect, NativeSelectOption} from "@/components/ui/native-select";
import {uiText} from "../i18n";
import type {GlobalAssistantController} from "./global-assistant-controller";
import type {ChatModel} from "./model";

type AssistantControlsProps = {
  controller: GlobalAssistantController;
  portal: RefObject<HTMLElement | null>;
};
const overlayClass = "shadcn-scope chat-control-overlay rounded-xl border border-border bg-background p-4 text-sm text-foreground shadow-lg outline-none";

export function AssistantPermissions({controller, portal}: AssistantControlsProps) {
  const {settings, restored, submitting} = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const canPropose = settings.permission !== "query";
  const value = canPropose ? "review" : "query";
  const options = [
    {value: "query", label: uiText("仅查询"), description: uiText("查询项目、工作区和 Git 状态。"), icon: ShieldCheckIcon},
    {value: "review", label: uiText("变更前确认"), description: uiText("可准备工作区管理操作，确认后执行。"), icon: HandIcon},
  ];
  const selected = options[canPropose ? 1 : 0];
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className="chat-permission-trigger"
          aria-label={uiText("助手权限设置")} title={selected.label} disabled={!restored || submitting}>
          <selected.icon aria-hidden="true" />
          <span>{selected.label}</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal.current}>
        <DropdownMenu.Content className={`${overlayClass} chat-permission-menu`} align="start" side="top" sideOffset={8} collisionPadding={12}>
          <DropdownMenu.Label className="chat-permission-heading">{uiText("下轮助手权限")}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={permission => controller.setTurnSettings({
            ...settings, permission: permission === "query" ? "query" : undefined,
          })}>
            {options.map(option => (
              <DropdownMenu.RadioItem key={option.value} value={option.value} className="chat-permission-option">
                <option.icon aria-hidden="true" />
                <span><strong>{option.label}</strong><span className="chat-permission-description">{option.description}</span></span>
                <DropdownMenu.ItemIndicator asChild><CheckIcon className="chat-permission-check" aria-hidden="true" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AssistantModelPicker({controller, portal}: AssistantControlsProps) {
  const {settings, restored, submitting} = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [models, setModels] = useState<ChatModel[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const title = useId();
  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const result = await controller.request<{models: ChatModel[]}>("/api/codex/chat-options");
      setModels(result.models || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  const selected = models?.find(entry => entry.model === settings.model);
  const modelLabel = selected?.displayName || settings.model || uiText("Codex 默认模型");
  return (
    <Popover.Root onOpenChange={open => {if (open) void load();}}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className="chat-context-trigger" aria-label={uiText("选择助手模型")}
          title={modelLabel} disabled={!restored || submitting}>
          <span className="truncate">{modelLabel}</span><ChevronDownIcon aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={portal.current}>
        <Popover.Content className={`${overlayClass} chat-settings-popover space-y-2`} align="end" side="top" sideOffset={8} collisionPadding={12} aria-labelledby={title}>
          <div className="grid gap-1.5 text-xs">
            <label id={title} htmlFor={title + "-model"}>{uiText("下轮助手模型")}</label>
            <NativeSelect id={title + "-model"} value={settings.model || ""} disabled={submitting} onChange={event => controller.setTurnSettings({
              ...settings, model: event.target.value || undefined,
            })}>
              <NativeSelectOption value="">{uiText("Codex 默认模型")}</NativeSelectOption>
              {settings.model && !selected && <NativeSelectOption value={settings.model}>{settings.model}</NativeSelectOption>}
              {models?.map(entry => <NativeSelectOption key={entry.id} value={entry.model}>{entry.displayName || entry.model}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          {loading && <p role="status" className="text-xs text-muted-foreground">{uiText("正在读取模型…")}</p>}
          {error && <div className="flex items-center justify-between gap-2 text-xs">
            <p role="alert" className="text-destructive">{uiText("暂时无法读取可用模型。")}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>{uiText("重试")}</Button>
          </div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
