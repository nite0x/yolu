export type AgentProvider = "codex" | "agy";
export interface ProviderCapabilities { steer: boolean; fork: boolean; handoff: boolean; rate_limits: boolean; voice: boolean }
export const normalizeProvider = (provider?: string): AgentProvider => provider === "agy" ? "agy" : "codex";
export const defaultCapabilities = (provider: AgentProvider): ProviderCapabilities => provider === "agy"
  ? {steer: false, fork: false, handoff: false, rate_limits: false, voice: false}
  : {steer: true, fork: true, handoff: true, rate_limits: true, voice: true};
export type PermissionMode = "ask" | "auto" | "full";
export interface TurnSettings {model?: string; effort?: string; mode?: string; permission?: PermissionMode; serviceTier?: string}
export type ConversationDefaults = Pick<TurnSettings, "model" | "permission">;
export interface AssistantTurnSettings {model?: string; permission?: "query"}

// Preferences are loaded per execution environment. Empty values leave Codex
// configuration in charge; only explicit overrides are persisted with a draft.
export function newConversationSettings(settings: TurnSettings = {}, defaults: ConversationDefaults = {}): TurnSettings {
  return {
    ...defaults, ...settings,
    ...(settings.model || !defaults.model ? {} : {model:defaults.model}),
    ...(settings.permission || !defaults.permission ? {} : {permission:defaults.permission}),
  };
}
