import { createRoot, type Root } from "react-dom/client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import {
  Thread,
  Composer,
} from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LoaderCircle } from "lucide-react";
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
  type AssistantMessage,
  type AssistantRequest,
} from "./global-assistant-controller";

const convertMessage = (message: AssistantMessage) => ({
  id: String(message.id),
  role: message.role,
  content: [{ type: "text" as const, text: message.text }],
});
const Welcome = () => (
  <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
    <p className="text-2xl font-medium tracking-tight">
      {uiText("想推进哪项开发工作？")}
    </p>
  </div>
);

function AssistantThread({
  controller,
}: {
  controller: GlobalAssistantController;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const panel = useRef<HTMLDivElement>(null);
  const runtime = useExternalStoreRuntime({
    messages: state.messages,
    convertMessage,
    isRunning: controller.busy || state.submitting,
    isLoading: state.loading,
    isSendDisabled:
      !state.restored ||
      state.loading ||
      state.submitting ||
      controller.busy ||
      controller.readOnly,
    onNew: async (message) => {
      controller.setDraft(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      if (!(await controller.send())) {
        const error = controller.getSnapshot().error;
        // The shared composer restores a rejected submission into its draft.
        if (panel.current) controller.setDraft("");
        throw new MessageNotSentError(error);
      }
    },
    hasEarlier: !!state.before,
    onLoadEarlier: () => controller.refresh(true),
    onCancel: () => controller.stop(),
  });
  useEffect(() => {
    void controller.connect();
    return () => controller.disconnect();
  }, [controller]);
  useEffect(() => {
    const composer = runtime.thread.composer;
    const syncDraft = () => {
      if (composer.getState().submission || controller.getSnapshot().submitting)
        return;
      const text = controller.getSnapshot().draft;
      if (composer.getState().text !== text) composer.setText(text);
    };
    syncDraft();
    const unsubscribeDraft = controller.subscribe(syncDraft);
    const unsubscribeComposer = composer.subscribe(() => {
      const state = composer.getState();
      if (!state.submission && !controller.getSnapshot().submitting)
        controller.setDraft(state.text);
    });
    return () => {
      unsubscribeDraft();
      unsubscribeComposer();
    };
  }, [controller, runtime]);
  useLayoutEffect(() => {
    if (!state.restored || state.loading) return;
    const viewport = panel.current?.querySelector<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    if (!viewport) return;
    const reading = controller.getReading();
    viewport.scrollTop = reading.bottom ? viewport.scrollHeight : reading.top;
    const save = () => {
      if (document.getElementById("globalAssistantPage")?.hidden) return;
      controller.setReading(
        viewport.scrollTop,
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 60,
      );
    };
    viewport.addEventListener("scroll", save, { passive: true });
    return () => viewport.removeEventListener("scroll", save);
  }, [controller, state.restored, state.loading]);
  useLayoutEffect(() => {
    if (!controller.getReading().bottom) return;
    const viewport = panel.current?.querySelector<HTMLElement>(
      '[data-slot="aui_thread-viewport"]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [controller, state.messages.at(-1)?.id]);
  const error =
    state.error || state.loadError || assistantRunError(state.run?.error_code);
  return (
    <div
      ref={panel}
      className="global-assistant-thread assistant-chat-scope shadcn-scope"
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread
          readOnly={controller.readOnly}
          managedScroll
          components={{ Welcome }}
          composerStatus={
            <>
              {controller.busy && (
                <div className="chat-run-indicator" role="status">
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <span>{uiText("Codex 正在回复…")}</span>
                </div>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              {state.notice && <p role="status">{state.notice}</p>}
            </>
          }
          composer={
            <Composer
              autoFocus={false}
              input={{
                "aria-label": uiText("助手消息"),
                placeholder: uiText("描述你的开发目标…"),
                maxLength: 64000,
              }}
            />
          }
        />
      </AssistantRuntimeProvider>
    </div>
  );
}

let active: GlobalAssistantController | undefined;
const controllers = new Map<string, GlobalAssistantController>();
function GlobalAssistant({ request }: { request: AssistantRequest }) {
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
      value = new GlobalAssistantController(selected, request, readOnly);
      controllers.set(selected, value);
    }
    return value;
  }, [selected, request, readOnly]);
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
        />
        {controller ? (
          <AssistantThread key={selected} controller={controller} />
        ) : (
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
        )}
      </WorkspacePane>
    </WorkspaceSplitLayout>
  );
}

let root: Root | undefined;
export function openGlobalAssistant(request: AssistantRequest) {
  if (root) return;
  root = createRoot(document.getElementById("globalAssistantRoot")!);
  root.render(<GlobalAssistant request={request} />);
}
export const flushGlobalAssistantDraft = () =>
  active?.flush() ?? Promise.resolve(true);
