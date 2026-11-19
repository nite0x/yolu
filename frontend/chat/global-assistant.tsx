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
import { AssistantModelPicker, AssistantPermissions } from "./assistant-controls";
import { Button } from "@/components/ui/button";
import { ArrowLeft, History, Plus, X } from "lucide-react";
import { ConversationList } from "../workspace/session-browser";
import {
  ConversationHeader,
  ConversationIconButton,
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
      {uiText("想在 Yolu 里做什么？")}
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
          composerLeadingControls: <AssistantPermissions controller={controller} portal={panel} />,
          composerControls: <AssistantModelPicker controller={controller} portal={panel} />,
          composerStatus: controller.busy ? (
            <ConversationRunIndicator
              status="running"
              label={uiText("Codex 正在回复…")}
            />
          ) : undefined,
        }}
        composerInput={{
          "aria-label": uiText("助手消息"),
          placeholder: uiText("查找工作区、添加项目，或准备新的工作区…"),
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

function AssistantSelection({ controller }: { controller: GlobalAssistantController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const label = controller.options.contextLabel?.();
  if (!label) return null;
  return (
    <div className="global-assistant-context">
      <span title={label}>{uiText("当前上下文 · {0}", label)}</span>
      {controller.options.clearContext && (
        <Button type="button" variant="ghost" size="sm" disabled={controller.readOnly || state.submitting} onClick={controller.clearContext}>
          {uiText("清除上下文")}
        </Button>
      )}
    </div>
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
  const [showHistory, setShowHistory] = useState(false);
  const focusHeading = useRef(false);
  const pendingCreation = useRef<string | undefined>(undefined);
  const listGeneration = useRef(0);
  const listReady = useRef(false);
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
  const reload = async () => {
    const generation = ++listGeneration.current;
    try {
      const items = await request<AssistantConversation[]>(
        "/api/assistant/conversations",
      );
      if (generation !== listGeneration.current) return;
      setConversations(items);
      if (!listReady.current) {
        listReady.current = true;
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
    void reload();
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
  const activity = conversations.some((item) => item.activity === "waiting") ? "waiting"
    : conversations.some((item) => item.activity === "running") ? "running" : "";
  useEffect(() => options.onActivity?.(activity), [activity, options.onActivity]);
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    document.getElementById(showHistory ? "globalAssistantHistoryTitle" : "globalAssistantTitle")?.focus({preventScroll: true});
    window.dispatchEvent(new CustomEvent("workhub:chat-layout", {detail: {visible: true}}));
  }, [showHistory]);
  const switchPane = (history: boolean) => {
    if (showHistory === history) return;
    if (history) window.dispatchEvent(new CustomEvent("workhub:chat-layout", {detail: {phase: "before"}}));
    focusHeading.current = true;
    setShowHistory(history);
  };
  const select = async (id: string) => {
    if (controller && !(await controller.flush())) return;
    setSelected(id);
    switchPane(false);
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
    chat_status: item.activity,
    updated_at: item.updated_at ? item.updated_at / 1000 : undefined,
  }));
  const currentTitle = conversations.find((item) => item.id === selected)?.title;
  const canCreate = !readOnly && !creating && !loading;
  const close = options.close && (
    <ConversationIconButton label={uiText("关闭助手")} onClick={options.close}>
      <X aria-hidden="true" />
    </ConversationIconButton>
  );
  const newConversation = !readOnly && (
    <ConversationIconButton label={uiText("新建助手对话")} disabled={!canCreate} onClick={() => void create()}>
      <Plus aria-hidden="true" />
    </ConversationIconButton>
  );
  const header = (
    <ConversationHeader
      title={uiText("Yolu 助手")}
      titleID="globalAssistantTitle"
      actions={
        <>
          {controller && newConversation}
          <ConversationIconButton label={uiText("助手历史")} onClick={() => switchPane(true)}>
            <History aria-hidden="true" />
          </ConversationIconButton>
          {close}
        </>
      }
    >
      {currentTitle && <p className="global-assistant-current-title" title={currentTitle}>{currentTitle}</p>}
      {controller && <AssistantSelection controller={controller} />}
    </ConversationHeader>
  );
  return (
    <div className="global-assistant-layout shadcn-scope">
      <section className="global-assistant-conversation" hidden={showHistory}>
        {controller ? (
          <GlobalConversation key={selected} controller={controller} header={header} />
        ) : (
          <>
            {header}
            <div className="global-assistant-empty">
              {loading ? (
                <p role="status">{uiText("正在读取对话…")}</p>
              ) : (
                <>
                  <p>{uiText("查找工作区、添加项目，或准备新的工作区。")}</p>
                  {!readOnly && (
                    <Button type="button" variant="outline" disabled={!canCreate || !!error} onClick={() => void create()}>
                      {uiText("新建助手对话")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
      <section className="global-assistant-history" aria-labelledby="globalAssistantHistoryTitle" hidden={!showHistory}>
        <ConversationHeader
          title={uiText("助手历史")}
          titleID="globalAssistantHistoryTitle"
          actions={
            <>
              <ConversationIconButton label={uiText("返回助手对话")} onClick={() => switchPane(false)}>
                <ArrowLeft aria-hidden="true" />
              </ConversationIconButton>
              {newConversation}
              {close}
            </>
          }
        />
        <div className="global-assistant-history-list">
          {(sessions.length > 0 || !error) &&
          <ConversationList
            sessions={sessions}
            selected={selected}
            showDirectory={false}
            showContext={false}
            canCreate={false}
            loading={loading}
            onSelect={(id) => void select(id)}
          />}
        </div>
      </section>
      {error && (
        <div className="global-assistant-error">
          <p role="alert">{error}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>{uiText("重新加载")}</Button>
        </div>
      )}
    </div>
  );
}

let root: Root | undefined;
export function openGlobalAssistant(request: AssistantRequest, options: AssistantOptions = {}) {
  const target = document.getElementById("globalAssistantRoot")!;
  if (!root) {
    target.replaceChildren();
    root = createRoot(target);
  }
  root.render(<GlobalAssistant request={request} options={options} />);
}
export const flushGlobalAssistantDraft = () =>
  active?.flush() ?? Promise.resolve(true);
