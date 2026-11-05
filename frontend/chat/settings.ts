export type PermissionMode = "ask" | "auto" | "full";
export interface TurnSettings {model?: string; effort?: string; mode?: string; permission?: PermissionMode}
export type ConversationDefaults = Pick<TurnSettings, "model" | "permission">;

// Preferences are loaded per execution environment. Empty values leave Codex
// configuration in charge; only explicit overrides are persisted with a draft.
export function newConversationSettings(settings: TurnSettings = {}, defaults: ConversationDefaults = {}): TurnSettings {
  return {
    ...defaults, ...settings,
    ...(settings.model || !defaults.model ? {} : {model:defaults.model}),
    ...(settings.permission || !defaults.permission ? {} : {permission:defaults.permission}),
  };
}
