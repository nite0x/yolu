import { createRoot, type Root } from "react-dom/client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ComponentProps,
} from "react";
import { MessageNotSentError, type ThreadMessageLike } from "@assistant-ui/react";
import {
  ConversationPanel,
  ConversationFeedback,
  ConversationRunIndicator,
  useConversationRuntime,
} from "./conversation-panel";
import { useChatReading } from "./use-chat-reading";
import {
  AssistantActionGroup,
  AssistantActionTool,
  AssistantActionsProvider,
} from "./assistant-actions";
import { assistantMessages } from "./assistant-messages";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ConversationList } from "../workspace/session-browser";
import { WorkspaceSplitLayout, WorkspacePane } from "../workspace/page-surface";
import { ListCreateButton } from "../workspace/list-controls";
import {
  ConversationHeader,
  ConversationStatusBadge,
} from "../workspace/conversation-surface";
import { uiText } from "../i18n";
import {
  GlobalAssistantController,
  assistantRunError,
  type AssistantConversation,
  type AssistantRequest,
  type AssistantOptions,
} from "./global-assistant-controller";

const convertMessage = (message: ThreadMessageLike) => message;
const Welcome = () => (
  <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
    <p className="text-2xl font-medium tracking-tight">
      {uiText("想推进哪项开发工作？")}
    </p>
  </div>
);

const assistantComponents = {
  Welcome,
  ToolFallback: AssistantActionTool,
  ToolGroup: AssistantActionGroup,
};

function GlobalConversation({
  controller,
  header,
}: {
  controller: GlobalAssistantController;
  header: ReactElement<ComponentProps<typeof ConversationHeader>>;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const panel = useRef<HTMLElement>(null);
  const messages = useMemo(
    () => assistantMessages(state),
    [state.messages, state.activities, state.plans, state.run],
  );
  const runtime = useConversationRuntime(controller, {
    messages,
    convertMessage,
    isRunning: controller.busy || state.submitting,
    isLoading: state.loading && state.messages.length === 0,
    isSendDisabled:
      !state.restored ||
      state.loading ||
      state.submitting ||
      controller.busy ||
      controller.readOnly,
    onNew: async (message) => {
      reading.latest();
      controller.setDraft(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      if (!(await controller.send())) {
        const error = controller.getSnapshot().error;
        if (panel.current) controller.setDraft("");
        throw new MessageNotSentError(error);
      }
    },
    hasEarlier: !!state.before,
    onLoadEarlier: () => controller.refresh(true),
    onCancel: () => controller.stop(),
  });
  const reading = useChatReading(controller, runtime.thread);
  const error =
    state.error ||
    state.historyError ||
    state.loadError ||
    assistantRunError(state.run?.error_code);
  return (
    <AssistantActionsProvider value={controller}>
      <ConversationPanel
        runtime={runtime}
        panelRef={panel}
        header={header}
        reading={reading}
        thread={{
          readOnly: controller.readOnly,
          autoFocus: false,
          components: assistantComponents,
          composerStatus: controller.busy ? (
            <ConversationRunIndicator
              status="running"
              label={uiText("Codex 正在回复…")}
            />
          ) : undefined,
        }}
        composerInput={{
          "aria-label": uiText("助手消息"),
          placeholder: uiText("描述你的开发目标…"),
          maxLength: 64000,
        }}
        feedback={
          (error || state.notice) && (
            <ConversationFeedback messages={[state.notice]} error={error} />
          )
        }
      />
    </AssistantActionsProvider>
  );
}

let active: GlobalAssistantController | undefined;
const controllers = new Map<string, GlobalAssistantController>();
function GlobalAssistant({ request, options }: { request: AssistantRequest; options: AssistantOptions }) {
  const readOnly =
    document
      .querySelector('meta[name="session-mode"]')
      ?.getAttribute("content") === "read-only";
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [pane, setPane] = useState("list");
  const pendingCreation = useRef<string | undefined>(undefined);
  const listGeneration = useRef(0);
  const controller = useMemo(() => {
    if (!selected) return undefined;
    let value = controllers.get(selected);
    if (!value) {
      value = new GlobalAssistantController(selected, request, readOnly, options);
      controllers.set(selected, value);
    }
    value.options = options;
    return value;
  }, [selected, request, readOnly, options]);
  useEffect(() => {
    active = controller;
    return () => {
      if (active === controller) active = undefined;
    };
  }, [controller]);
  const reload = async (initial = false) => {
    const generation = ++listGeneration.current;
    try {
      const items = await request<AssistantConversation[]>(
        "/api/assistant/conversations",
      );
      if (generation !== listGeneration.current) return;
      setConversations(items);
      if (initial) {
        if (items.length) setPane("detail");
        let saved = "";
        try {
          saved = localStorage.getItem("yolu:assistant:selected") || "";
        } catch {
          /* Database history remains available. */
        }
        setSelected(
          items.find((item) => item.id === saved)?.id || items[0]?.id || "",
        );
      }
      setError("");
    } catch (error) {
      if (generation === listGeneration.current)
        setError((error as Error).message);
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  };
  useEffect(() => {
    void reload(true);
    const timer = setInterval(() => void reload(), 5000);
    const flush = () => {
      void active?.flush();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      listGeneration.current++;
      clearInterval(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [request]);
  const select = async (id: string) => {
    if (controller && !(await controller.flush())) return;
    setSelected(id);
    setPane("detail");
    try {
      localStorage.setItem("yolu:assistant:selected", id);
    } catch {
      /* Database history remains available. */
    }
  };
  const create = async () => {
    setCreating(true);
    try {
      if (controller && !(await controller.flush())) return;
      const id = (pendingCreation.current ||= "yolu-" + crypto.randomUUID());
      await request("/api/assistant/conversations", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      pendingCreation.current = undefined;
      await reload();
      await select(id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };
  const sessions = conversations.map((item) => ({
    id: item.id,
    name: item.title || uiText("新建助手对话"),
    cwd: "",
    updated_at: item.updated_at ? item.updated_at / 1000 : undefined,
  }));
  return (
    <WorkspaceSplitLayout
      className="global-assistant-layout shadcn-scope"
      data-pane={pane}
    >
      <WorkspacePane
        as="aside"
        className="global-assistant-history"
        aria-label={uiText("助手历史")}
      >
        <div className="session-browser-list-tools">
          <div className="session-browser-list-heading">
            <div className="session-browser-list-title">
              <strong>{uiText("Yolu 助手")}</strong>
            </div>
            <div className="session-browser-heading-actions">
              <ListCreateButton
                label={uiText("新建助手对话")}
                disabled={readOnly || creating || loading}
                onClick={() => void create()}
              />
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="global-assistant-error">
            {error}
          </p>
        )}
        <nav
          className="global-assistant-history-list"
          aria-label={uiText("助手对话")}
        >
          <ConversationList
            sessions={sessions}
            selected={selected}
            showDirectory={false}
            showContext={false}
            canCreate={false}
            loading={loading}
            onSelect={(id) => void select(id)}
          />
        </nav>
      </WorkspacePane>
      <WorkspacePane className="global-assistant-conversation">
        {controller ? (
          <GlobalConversation
            key={selected}
            controller={controller}
            header={
              <ConversationHeader
                title={
                  conversations.find((item) => item.id === selected)?.title ||
                  uiText("新建助手对话")
                }
                titleID="globalAssistantTitle"
                actions={
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="global-assistant-mobile-back"
                      aria-label={uiText("对话列表")}
                      onClick={() => setPane("list")}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <ConversationStatusBadge>Codex CLI</ConversationStatusBadge>
                  </>
                }
              >
                {options.contextLabel?.() && <p className="text-xs text-muted-foreground">{options.contextLabel()}</p>}
              </ConversationHeader>
            }
          />
        ) : (
          <>
            <ConversationHeader
              title={uiText("新建助手对话")}
              titleID="globalAssistantTitle"
            />
            <div className="global-assistant-empty">
              <p>{uiText("选择一个对话，或新建对话开始工作。")}</p>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={creating || loading}
                  onClick={() => void create()}
                >
                  {uiText("新建助手对话")}
                </Button>
              )}
            </div>
          </>
        )}
      </WorkspacePane>
    </WorkspaceSplitLayout>
  );
}

let root: Root | undefined;
export function openGlobalAssistant(request: AssistantRequest, options: AssistantOptions = {}) {
  if (root) return;
  root = createRoot(document.getElementById("globalAssistantRoot")!);
  root.render(<GlobalAssistant request={request} options={options} />);
}
export const flushGlobalAssistantDraft = () =>
  active?.flush() ?? Promise.resolve(true);
