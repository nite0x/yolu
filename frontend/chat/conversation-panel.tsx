import {
  useEffect,
  type ComponentProps,
  type ReactNode,
  type ReactElement,
  type RefObject,
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { HandIcon, LoaderCircleIcon } from "lucide-react";
import {
  Thread,
  Composer,
  type ThreadProps,
} from "@/components/assistant-ui/elements/thread.aui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConversationHeader } from "../app/conversation-surface";
import type { useChatReading } from "./use-chat-reading";

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
    <footer className="shrink-0 space-y-2 border-t px-5 py-3 text-xs text-muted-foreground">
      {messages.filter(Boolean).map((message, index) => (
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
          className="relative min-h-0 flex-1"
          onChange={onChange}
        >
          <Thread
            {...thread}
            managedScroll
            composer={
              thread.composer ??
              (composerInput ? (
                <Composer
                  autoFocus={!!thread.autoFocus}
                  input={composerInput}
                  controls={thread.composerControls}
                  leadingControls={thread.composerLeadingControls}
                />
              ) : undefined)
            }
          />
        </div>
        {afterThread}
        {feedback}
      </section>
    </AssistantRuntimeProvider>
  );
}
