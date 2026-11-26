import type {TurnSettings as ContractTurnSettings} from "@/api/contracts"
import {uiText} from "@/shared/i18n"

export type AgentProvider = "codex" | "agy";
export interface ChatModel {id:string;model:string;displayName:string;isDefault:boolean;defaultReasoningEffort:string;supportedReasoningEfforts?:{reasoningEffort:string}[];serviceTiers?:{id:string;name:string;description:string}[]}
export interface ProviderCapabilities { steer: boolean; fork: boolean; handoff: boolean; rate_limits: boolean; voice: boolean }
export const normalizeProvider = (provider?: string): AgentProvider => provider === "agy" ? "agy" : "codex";
export const defaultCapabilities = (provider: AgentProvider, cloud = false): ProviderCapabilities => provider === "agy" || cloud
  ? {steer: false, fork: false, handoff: false, rate_limits: false, voice: false}
  : {steer: true, fork: true, handoff: true, rate_limits: true, voice: true};
export type PermissionMode = "ask" | "auto" | "full";
export interface TurnSettings extends Omit<ContractTurnSettings, "permission"> {permission?: PermissionMode}
export type ConversationDefaults = Pick<TurnSettings, "model" | "permission" | "effort" | "serviceTier">;
export interface AssistantTurnSettings {model?: string; permission?: "query"}

// Preferences are loaded per execution environment. Empty values leave Codex
// configuration in charge; only explicit overrides are persisted with a draft.
export function newConversationSettings(settings: TurnSettings = {}, defaults: ConversationDefaults = {}): TurnSettings {
  const inheritModelOptions = !settings.model || settings.model === defaults.model;
  return {
    ...settings,
    ...(settings.model || !defaults.model ? {} : {model: defaults.model}),
    ...(settings.permission || settings.useDefaultPermission || !defaults.permission ? {} : {permission: defaults.permission}),
    ...(inheritModelOptions && !settings.effort && !settings.useModelEffort && defaults.effort ? {effort: defaults.effort} : {}),
    ...(inheritModelOptions && !settings.serviceTier && !settings.useDefaultSpeed && defaults.serviceTier ? {serviceTier: defaults.serviceTier} : {}),
  };
}

export function findChatModel(models: ChatModel[], name?: string) {
  return models.find(model => name ? model.model === name : model.isDefault);
}

export const effortLabel = (effort?: string) => effort ? ({none: uiText("无"), minimal: uiText("最低"), low: uiText("低"), medium: uiText("中"), high: uiText("高"), xhigh: uiText("超高"), max: uiText("最高"), ultra: uiText("极高")}[effort] || effort) : "";
export const isFastTier = (id?: string) => id === "fast" || id === "priority";
export const serviceTierLabel = (tier: NonNullable<ChatModel["serviceTiers"]>[number]) => isFastTier(tier.id) ? uiText("快速") : tier.name || tier.id;

export function permissionChoices(provider: AgentProvider): {value: PermissionMode; label: string; description: string; danger?: boolean}[] {
  if (provider === "agy") return [
    {value: "ask", label: uiText("启用沙箱"), description: uiText("在 Antigravity 的沙箱限制内运行。")},
    {value: "full", label: uiText("跳过权限检查"), description: uiText("Antigravity 将跳过操作权限检查。"), danger: true},
  ];
  return [
    {value: "ask", label: uiText("请求批准"), description: uiText("编辑已授权目录外的文件或访问网络时请求批准")},
    {value: "auto", label: uiText("帮我批准"), description: uiText("自动审查批准请求，风险操作仍需确认")},
    {value: "full", label: uiText("完全访问权限"), description: uiText("可不受沙箱限制地访问互联网和电脑上的文件"), danger: true},
  ];
}
