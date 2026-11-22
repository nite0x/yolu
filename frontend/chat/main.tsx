import {createRoot, type Root} from "react-dom/client";
import {ChatController, conversationKey as key, type ChatOptions} from "./controller";
import {ChatPanel} from "./panel";
import "./style.css";
import {reuseValue} from "./state";

let root: Root | undefined;
let active: ChatController | undefined;
const controllers = new Map<string, ChatController>();
let mountSequence = 0;
export const bridge = {
  flushDraft: () => active?.flushDraft() ?? Promise.resolve(true),
  open(options: ChatOptions) {
    if (!root) root = createRoot(document.getElementById("assistantChatRoot")!);
    active?.disconnect();
    let controller = controllers.get(key(options));
    if (!controller) { controller = new ChatController(options); controllers.set(key(options), controller); }
    const current = controller;
    controller.options = {...options, created(session) {
      controllers.delete(key(options, null)); controllers.set(key(options, session.id), current);
      options.created(session);
    }};
    active = controller;
    root.render(<ChatPanel key={++mountSequence} controller={controller} />);
  },
  close() { active?.disconnect(); active = undefined; root?.render(null); },
  updateWorkspace(workspace: ChatOptions['workspace']) {
    if (!active || !workspace || active.options.workspace?.id !== workspace.id) return;
    const next = reuseValue(active.options.workspace, workspace);
    if (next === active.options.workspace) return;
    active.options.workspace = next;
    root?.render(<ChatPanel key={mountSequence} controller={active} />);
  },
  updateOverview(overview: ChatOptions['overview']) {
    if (!active) return;
    const next = reuseValue(active.options.overview, overview);
    if (next === active.options.overview) return;
    active.options.overview = next;
    root?.render(<ChatPanel key={mountSequence} controller={active} />);
  },
  updateSession(session: NonNullable<ChatOptions['session']>) { active?.updateSession(session); },
};
