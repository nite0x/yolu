import type {ConversationOverview} from "../app/conversation-context";
import type {AgentProvider, ChatState, Entry, HistoryPush, ProviderCapabilities, Session, TurnSettings, ChatContext, ChatModel} from "./model";
import type {ConversationDefaults} from "./settings";

export interface ChatOptions {
  overview?: ConversationOverview;
  target?: SessionTarget; session: Session | null; environment: string; environmentName?: string;
  readOnly?: boolean; persistDraft?: boolean; focusComposer?: boolean;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  stream: (path: string, signal: AbortSignal) => Promise<Response>;
  created: (session: Session) => void;
  loaded?: (session: Session) => void;
  activity?: (session: string, chat: ChatState) => void;
  close: () => void;
  newConversation?: () => void;
  openProject?: (id: string, path?: string) => void;
  openTerminal?: (binding: {id:string; project_id?:string; directory:string}) => void;
  managed?: (session: Session, action: string) => void;
}
export interface BindingInput {
  project_id?: string; directory?: string; access: "read" | "write"; role?: "primary" | "additional"; allow_shared?: boolean;
}
export interface SessionTarget { project_id?: string; cwd?: string; access?: "read" | "write"; allow_shared?: boolean; bindings?: BindingInput[] }

export interface Snapshot {
  session: Session | null; provider: AgentProvider; capabilities: ProviderCapabilities; entries: Entry[]; chat: ChatState; project: string; draft: string;
  error: string; historyError: string; loading: boolean; submitting: boolean; stopping: boolean;
  answering: string | null; cursor: string | null;
  draftRestore: number; settings: TurnSettings; defaults: ConversationDefaults; context?: ChatContext; models: ChatModel[]; modes: string[]; optionsLoading: boolean; draftNotice: string; search: string; searching: boolean; searchError: string; managing: boolean;
  terminal?: HistoryPush;
}
