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
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConversationHeader } from "../workspace/conversation-surface";
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
  <div className="global-assistant-welcome">
    <p>
      {uiText(
        "讨论开发目标，规划跨项目工作。项目查询和工作区操作将在后续阶段接入。",
      )}
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
    isRunning: controller.busy,
    isLoading: state.loading,
    onNew: async (message) => {
      controller.setDraft(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      await controller.send();
    },
    hasEarlier: !!state.before,
    onLoadEarlier: () => controller.refresh(true),
    onCancel: () => controller.stop(),
  });
  useEffect(() => {
    void controller.connect();
    return () => controller.disconnect();
  }, [controller]);
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
                <p role="status">{uiText("Codex 正在回复…")}</p>
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
            <form
              className="global-assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void controller.send();
              }}
            >
              <Textarea
                aria-label={uiText("助手消息")}
                placeholder={uiText("描述你的开发目标…")}
                value={state.draft}
                disabled={!state.restored || state.submitting}
                onChange={(event) => controller.setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void controller.send();
                  }
                }}
              />
              <div className="global-assistant-composer-actions">
                {controller.busy && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void controller.stop()}
                  >
                    {uiText("停止")}
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={
                    !state.restored ||
                    !state.draft.trim() ||
                    controller.busy ||
                    state.submitting
                  }
                >
                  {state.submitting ? uiText("正在发送…") : uiText("发送")}
                </Button>
              </div>
            </form>
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
  return (
    <div className="global-assistant-layout shadcn-scope">
      <aside
        className="global-assistant-history"
        aria-label={uiText("助手历史")}
      >
        <Button
          type="button"
          variant="outline"
          disabled={readOnly || creating || loading}
          onClick={() => void create()}
        >
          {uiText("新建助手对话")}
        </Button>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">{uiText("正在读取历史…")}</p>}
        <nav aria-label={uiText("助手对话")}>
          {conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={selected === item.id ? "page" : undefined}
              title={item.title || uiText("新建助手对话")}
              onClick={() => void select(item.id)}
            >
              {item.title || uiText("新建助手对话")}
            </button>
          ))}
        </nav>
      </aside>
      <section className="global-assistant-conversation">
        <ConversationHeader
          title={uiText("Yolu 助手")}
          titleID="globalAssistantTitle"
        >
          <p className="global-assistant-provider">
            {uiText("本机 · Codex CLI")}
          </p>
        </ConversationHeader>
        {controller ? (
          <AssistantThread key={selected} controller={controller} />
        ) : (
          <p className="global-assistant-empty">
            {uiText("新建助手对话，开始规划你的开发工作。")}
          </p>
        )}
      </section>
    </div>
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
