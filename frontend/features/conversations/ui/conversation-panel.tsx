import {useEffect, type ComponentProps, type ReactNode, type ReactElement, type RefObject} from "react"
import {AssistantRuntimeProvider, useExternalStoreRuntime, type AssistantRuntime} from "@assistant-ui/react"
import {HandIcon, InfoIcon, LoaderCircleIcon, LockKeyholeIcon, XIcon} from "lucide-react"
import {Popover} from "radix-ui"
import {Thread, Composer, type ThreadProps} from "../components/assistant-ui/elements/thread.aui"
import {Alert, AlertDescription} from "@/shared/ui/primitives/alert"
import type {ConversationHeader} from "@/shared/ui/conversation-surface"
import type {useChatReading} from "../runtime/use-chat-reading"
import {uiText} from "@/shared/i18n"

export function ConversationOccupied({description, retrying, forking, canRetry, canFork, onRetry, onFork}: {
  description: string; retrying: boolean; forking: boolean; canRetry: boolean; canFork: boolean;
  onRetry: () => void; onFork: () => void;
}) {
  return <div className="chat-occupied" role="status">
    <LockKeyholeIcon className="chat-occupied-icon" aria-hidden="true" />
    <div className="chat-occupied-copy"><strong>{uiText("已在另一个应用中打开")}</strong><p>{description}</p></div>
    <div className="chat-occupied-actions">
      <button type="button" disabled={!canRetry || retrying || forking} onClick={onRetry}>{retrying ? uiText("重试中…") : uiText("重试")}</button>
      <button type="button" disabled={!canFork || retrying || forking} onClick={onFork}>{forking ? uiText("创建中…") : uiText("创建聊天分支")}</button>
    </div>
  </div>;
}

export function ConversationNotice({message, portal}: {
  message: string;
  portal: RefObject<HTMLElement | null>;
}) {
  return <Popover.Root>
    <Popover.Trigger type="button" className="chat-notice-trigger" aria-label={uiText("状态说明")}>
      <InfoIcon aria-hidden="true" /><span>{uiText("状态说明")}</span>
    </Popover.Trigger>
    <Popover.Portal container={portal.current}>
      <Popover.Content className="shadcn-scope chat-control-overlay chat-notice-popover" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label={uiText("状态说明")}>
        <p>{message}</p>
        <Popover.Close type="button" className="chat-notice-close" aria-label={uiText("关闭说明")}><XIcon aria-hidden="true" /></Popover.Close>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

interface ConversationController {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { draft: string; submitting: boolean };
  setDraft: (text: string) => void;
  connect: () => void | Promise<void>;
  disconnect: () => void;
}

// Both transports use the same lifecycle and composer synchronization. The
// runtime adapter supplies domain-specific messages, capabilities and sends.
export function useConversationRuntime<T>(
  controller: ConversationController,
  adapter: Parameters<typeof useExternalStoreRuntime<T>>[0],
) {
  const runtime = useExternalStoreRuntime<T>(adapter);
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
  return runtime;
}

export function ConversationRunIndicator({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <div
      className="chat-run-indicator"
      role="status"
      aria-live="polite"
      data-state={status}
    >
      {status === "waiting" ? (
        <HandIcon aria-hidden="true" />
      ) : (
        <LoaderCircleIcon
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </div>
  );
}

export function ConversationFeedback({
  messages = [],
  error,
  children,
}: {
  messages?: (string | undefined)[];
  error?: string;
  children?: ReactNode;
}) {
  return (
    <footer className="chat-feedback shrink-0 space-y-1 text-xs text-muted-foreground">
      {messages.filter(Boolean).map((message, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Feedback slots keep their caller-defined order without row-local state.
        <p key={index} role="status">
          {message}
        </p>
      ))}
      {children}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </footer>
  );
}

type Reading = ReturnType<typeof useChatReading>;
interface ConversationPanelProps {
  runtime: AssistantRuntime;
  panelRef: RefObject<HTMLElement | null>;
  header: ReactElement<ComponentProps<typeof ConversationHeader>>;
  reading: Reading;
  thread: Omit<ThreadProps, "managedScroll">;
  composerInput?: ComponentProps<typeof Composer>["input"];
  composerPrediction?: ComponentProps<typeof Composer>["prediction"];
  onDismissPrediction?: () => void;
  beforeThread?: ReactNode;
  afterThread?: ReactNode;
  feedback?: ReactNode;
  onKeyDownCapture?: ComponentProps<"section">["onKeyDownCapture"];
  onChange?: ComponentProps<"div">["onChange"];
}

export function ConversationPanel({
  runtime,
  panelRef,
  header,
  reading,
  thread,
  composerInput,
  composerPrediction,
  onDismissPrediction,
  beforeThread,
  afterThread,
  feedback,
  onKeyDownCapture,
  onChange,
}: ConversationPanelProps) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <section
        data-slot="conversation-panel"
        ref={panelRef}
        className="shadcn-scope assistant-chat-scope flex h-full min-h-0 w-full flex-col bg-background text-foreground"
        aria-labelledby={header.props.titleID}
        onKeyDownCapture={onKeyDownCapture}
      >
        {header}
        {beforeThread}
        <div
          ref={reading.container}
          className="chat-reading relative min-h-0 flex-1"
          onChange={onChange}
        >
          <Thread
            {...thread}
            managedScroll
            composer={
              thread.composer === undefined && composerInput ? (
                <Composer
                  autoFocus={!!thread.autoFocus}
                  input={composerInput}
                  prediction={composerPrediction}
                  onDismissPrediction={onDismissPrediction}
                  controls={thread.composerControls}
                  leadingControls={thread.composerLeadingControls}
                />
              ) : thread.composer
            }
          />
        </div>
        {afterThread}
        {feedback}
      </section>
    </AssistantRuntimeProvider>
  );
}
