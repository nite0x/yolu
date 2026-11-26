export interface Session {
  terminal?: {projectID?: string; cwd?: string; sessionID?: string; bindingID?: string; attached: boolean};
  primary_project_id?: string; project_ids?: string[]; project_directories?: string[];
  browser_key?: string; environment_id?: string; environment_name?: string;
  context?: ReturnType<typeof import("./context").conversationContext>;
  id: string; provider?: "codex" | "codex-cloud" | "agy"; cloud_environment?: string; name: string; cwd: string; updated_at?: number; updatedAt?: number;
  source?: string; error?: string; available?: boolean;
  pinned?: boolean; archived?: boolean; chat_status?: string; completed_run?: string; unread?: boolean;
}
export interface SessionsData { sessions: Session[]; loading?: boolean; error?: string }
