import type {ConversationWorkspace} from "../workspace/conversation-context";
import type {ChatState, Entry, HistoryPush, Session, Task, TurnSettings, ChatContext, ChatModel} from "./model";
import type {ConversationDefaults} from "./settings";

export interface ChatOptions {
  workspace?: ConversationWorkspace;
  task?: Task; target?: SessionTarget; session: Session | null; environment: string; environmentName?: string;
  readOnly?: boolean; persistDraft?: boolean; focusComposer?: boolean;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  stream: (path: string, signal: AbortSignal) => Promise<Response>;
  created: (session: Session) => void;
  loaded?: (session: Session) => void;
  activity?: (session: string, chat: ChatState) => void;
  close: () => void;
  newConversation?: () => void;
  openWorkspace?: (kind: "task" | "project", id: string) => void;
  managed?: (session: Session, action: string) => void;
}
export interface SessionTarget { task_id?: string; project_id?: string; cwd?: string; additional_directories?: string[] }
export interface Snapshot {
  session: Session | null; entries: Entry[]; chat: ChatState; project: string; draft: string;
  error: string; historyError: string; loading: boolean; submitting: boolean; stopping: boolean;
  answering: string | null; cursor: string | null;
  draftRestore: number; settings: TurnSettings; defaults: ConversationDefaults; context?: ChatContext; models: ChatModel[]; modes: string[]; optionsLoading: boolean; draftNotice: string; search: string; searching: boolean; searchError: string; managing: boolean;
  terminal?: HistoryPush;
}
