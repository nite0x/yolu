import {createRoot, type Root} from "react-dom/client"
import {ChatController, conversationKey as key, type ChatOptions} from "@/features/conversations/runtime/controller"
import {ChatPanel} from "@/features/conversations/ui/panel"
import "@/features/conversations/ui/chat.css";
import {reuseValue} from "@/features/conversations/runtime/state"
import {draftTitle} from "@/features/conversations/model/draft-title"
import {createControllerCache} from "@/features/conversations/runtime/controller-cache"
import {RenderBoundary} from "@/shared/ui/feedback/render-boundary"

let root: Root | undefined;
let active: ChatController | undefined;
const controllers = createControllerCache<ChatController>(8, controller => controller === active);
let mountSequence = 0;
let unsubscribePreview: (() => void) | undefined;
export const bridge = {
  draftTitle: () => active && !active.getSnapshot().session ? draftTitle(active.getSnapshot().draft) : "",
  selectDraftExecution: (execution: NonNullable<ChatOptions["draftExecution"]>) => active?.selectDraftExecution(execution, false),
  flushDraft: () => controllers.flush(),
  open(options: ChatOptions) {
    if (!root) {
      const container = document.getElementById("assistantChatRoot");
      if (!container) throw new Error("Missing conversation mount: assistantChatRoot");
      root = createRoot(container);
    }
    unsubscribePreview?.();
    active?.disconnect();
    let controller = controllers.get(key(options));
    if (!controller) { controller = new ChatController(options); controllers.set(key(options), controller); }
    const current = controller;
    controller.options = {...options, created(session) {
      controllers.delete(key(options, null)); controllers.set(key(options, session.id), current);
      options.created(session);
    }};
    if (options.draftExecution) controller.selectDraftExecution(options.draftExecution, false);
    active = controller;
    let previous: string | undefined;
    const publishPreview = () => {
      const preview = bridge.draftTitle();
      if (preview === previous) return;
      previous = preview;
      window.dispatchEvent(new Event("workhub:chat-draft"));
    };
    unsubscribePreview = controller.subscribe(publishPreview);
    publishPreview();
    root.render(<RenderBoundary key={++mountSequence}><ChatPanel controller={controller} /></RenderBoundary>);
    void controllers.trim();
  },
  close() { unsubscribePreview?.(); unsubscribePreview = undefined; active?.disconnect(); active = undefined; root?.render(null); void controllers.trim(); },
  updateOverview(overview: ChatOptions['overview']) {
    if (!active) return;
    const next = reuseValue(active.options.overview, overview);
    if (next === active.options.overview) return;
    active.options.overview = next;
    const controller = active;
    root?.render(<RenderBoundary key={mountSequence}><ChatPanel controller={controller} /></RenderBoundary>);
  },
  updateSession(session: NonNullable<ChatOptions['session']>) { active?.updateSession(session); },
};
