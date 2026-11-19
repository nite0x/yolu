import { before, test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import {readFileSync} from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

let bundle = "";
before(async () => {
  const result = await build({
    entryPoints: ["frontend/chat/main.tsx"],
    bundle: true,
    write: false,
    outfile: "assistant-test.js",
    format: "iife",
    globalName: "AssistantTest",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "test-css",
        setup(builder) {
          builder.onLoad({ filter: /\.css$/ }, () => ({
            contents: "",
            loader: "css",
          }));
        },
      },
    ],
  });
  bundle =
    result.outputFiles.find((file) => file.path.endsWith(".js"))!.text +
    "\nwindow.AssistantTest = AssistantTest;";
});
async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(check(), "assistant panel did not reach the expected state");
}

function createAssistantWindow(t: { after: (callback: () => void) => void }, readOnly = false) {
  const errors: unknown[] = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(
    `<meta name="session-mode" content="${readOnly ? "read-only" : "interactive"}"><section id="globalAssistantPage"><div id="globalAssistantRoot"></div></section>`,
    {
      url: "http://localhost",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: console,
    },
  );
  const w = dom.window;
  t.after(() => {
    w.dispatchEvent(new w.Event("pagehide"));
    w.close();
  });
  Object.assign(w, {
    TransformStream,
    ReadableStream,
    WritableStream,
    TextEncoder,
    TextDecoder,
    Response,
    Request,
    Headers,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  w.HTMLElement.prototype.scrollTo = function (
    options: ScrollToOptions | number,
  ) {
    this.scrollTop = typeof options === "number" ? options : options.top || 0;
  };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.eval(readFileSync("web/core/chat-input.js", "utf8"));
  w.eval(bundle);
  return { w, errors };
}

test("global assistant uses the shared list and composer while preserving failed submissions and drafts", async (t) => {
  const { w, errors } = createAssistantWindow(t);
  const drafts = new Map();
  let messages: any[] = [];
  let run: any = null;
  let fail = true;
  let delayFailure = false;
  let rejectSend: (() => void) | undefined;
  const sends: any[] = [];
  (w as any).AssistantTest.openGlobalAssistant(
    async (path: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      if (path === "/api/assistant/conversations")
        return [
          { id: "one", title: "First plan", updated_at: Date.now() },
          { id: "two", title: "Second plan", updated_at: Date.now() },
        ];
      if (path.startsWith("/api/conversation-drafts")) {
        if (body) drafts.set(path, body);
        return drafts.get(path) || null;
      }
      if (path.endsWith("/runs")) {
        sends.push(body);
        if (delayFailure)
          return new Promise((_, reject) => {
            rejectSend = () => reject(new Error("Delayed failure"));
          });
        if (fail) throw new Error("Send failed");
        run = { id: body.request_id, status: "completed", error_code: "" };
        messages = [
          { id: 1, role: "user", text: body.text },
          { id: 2, role: "assistant", text: "Ready" },
        ];
        return run;
      }
      return { messages, run, before: 0 };
    },
  );
  const input = () =>
    w.document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="助手消息"]',
    )!;
  await until(() => !!input() && !input().disabled);
  assert.ok(w.document.querySelector(".aui-composer-root"));
  assert.equal(
    w.document.querySelectorAll('[data-slot="conversation-panel"]').length,
    1,
  );
  assert.equal(w.document.querySelector("#globalAssistantTitle")?.textContent, "Yolu 助手");
  const history = w.document.querySelector<HTMLElement>(".global-assistant-history")!;
  assert.equal(history.hidden, true);
  assert.equal(w.document.querySelector(".global-assistant-composer"), null);
  assert.equal(input().maxLength, 64000);
  assert.equal(w.document.querySelectorAll(".session-browser-item").length, 2);
  assert.equal(w.document.querySelector("[data-conversation-session]"), null);
  const type = (text: string) => {
    Object.getOwnPropertyDescriptor(
      w.HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input(), text);
    input().dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  type("Preserve this planning draft");
  const send = () =>
    w.document
      .querySelector<HTMLButtonElement>('button[aria-label="发送消息"]')!
      .click();
  await until(
    () =>
      !w.document.querySelector<HTMLButtonElement>(
        'button[aria-label="发送消息"]',
      )!.disabled,
  );
  send();

  await until(
    () =>
      sends.length === 1 &&
      !input().disabled &&
      input().value === "Preserve this planning draft",
  );
  assert.match(w.document.body.textContent || "", /Send failed/);
  fail = false;
  (w as any).YoluChatInput.apply('enter');
  await until(() => input().title.includes('Shift+Enter'));
  input().dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
  await until(() => sends.length === 2 && input().value === "");
  assert.equal(sends[0].request_id, sends[1].request_id);
  assert.match(w.document.body.textContent || "", /Ready/);
  type("Keep another draft");
  const openHistory = async () => {
    w.document.querySelector<HTMLButtonElement>('button[aria-label="助手历史"]')!.click();
    await until(() => !history.hidden);
  };
  await openHistory();
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[1]
    .click();
  await until(
    () =>
      history.hidden && w.document
        .querySelector('button[aria-pressed="true"]')
        ?.textContent?.includes("Second plan") === true && input().value === "",
  );
  await openHistory();
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[0]
    .click();
  await until(() => input().value === "Keep another draft");
  delayFailure = true;
  type("Preserve the draft when leaving during a send");
  send();
  await until(() => sends.length === 3 && !!rejectSend);
  await openHistory();
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[1]
    .click();
  await until(
    () =>
      history.hidden && w.document
        .querySelector('button[aria-pressed="true"]')
        ?.textContent?.includes("Second plan") === true,
  );
  rejectSend!();
  await new Promise((resolve) => setTimeout(resolve, 450));
  await openHistory();
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[0]
    .click();
  await until(
    () => input().value === "Preserve the draft when leaving during a send",
  );
  assert.deepEqual(errors, []);
});

test("global conversation shares automatic history loading and persisted reading state", async (t) => {
  const { w, errors } = createAssistantWindow(t);
  Object.defineProperty(w.HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 100;
    },
  });
  Object.defineProperty(w.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 500;
    },
  });
  const requests: string[] = [];
  let draft: any;
  (w as any).AssistantTest.openGlobalAssistant(
    async (path: string, options?: RequestInit) => {
      if (path === "/api/assistant/conversations")
        return [{ id: "history", title: "Plan history" }];
      if (path.startsWith("/api/conversation-drafts")) {
        if (options?.body) draft = JSON.parse(String(options.body));
        return draft || null;
      }
      requests.push(path);
      if (path.includes("before=3"))
        return {
          messages: [{ id: 1, role: "user", text: "Earlier request" }],
          run: null,
          before: 0,
        };
      return {
        messages: [{ id: 3, role: "assistant", text: "Current response" }],
        run: null,
        before: 3,
      };
    },
  );
  await until(
    () => w.document.body.textContent?.includes("Earlier request") === true,
  );
  assert.equal(requests.filter((path) => path.includes("before=3")).length, 1);
  const viewport = w.document.querySelector<HTMLElement>(
    '[data-slot="aui_thread-viewport"]',
  )!;
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    get() {
      return 1000;
    },
  });
  viewport.scrollTop = 400;
  viewport.dispatchEvent(new w.Event("scroll"));
  await until(() => draft?.reading?.top === 400);
  assert.equal(draft.reading.bottom, false);
  assert.deepEqual(errors, []);
});

function reviewedPlan() {
  return {
    id: "review-plan", conversation_id: "review", run_id: "run", revision: 3,
    digest: "immutable-review", environment_id: "local", capability: "workspace_create", status: "pending",
    arguments: {name: "Payment module"},
    review: {environment_id: "local", operation: {input: {name: "Payment module"}, requirement: {path: "/tmp/workspaces/payments", members: [{project_name: "Frontend", mode: "new", branch: "codex/payments", base_ref: "main", base_commit: "reviewed-commit"}, {project_name: "Backend", mode: "project", path: "/tmp/backend"}]}}},
    steps: [{id: "create", label: "Prepare payment workspace", status: "pending"}], resources: [], created_at: 1, updated_at: 1,
  };
}

const reviewMessages = [
  {id: 1, run_id: "run", role: "user", text: "Prepare the payment workspace"},
  {id: 2, run_id: "run", role: "assistant", text: "Review the proposed workspace"},
];

test("assistant renders reviewed operations and verified resource navigation in the shared panel", async (t) => {
  const {w, errors} = createAssistantWindow(t);
  let plan = reviewedPlan();
  const decisions: any[] = [];
  const opened: any[] = [];
  const resource = {kind: "workspace", id: "payments", environment_id: "local", name: "Payment workspace", path: "/tmp/workspaces/payments"};
  const choice = {kind: "project", id: "backend", environment_id: "local", name: "Backend <img src=x>", path: "/tmp/backend"};
  const activities = [
    {id: 1, run_id: "run", capability: "project_list", status: "completed", result: {resources: [resource], choices: [choice], errors: [{environment_id: "offline", message: "Environment unavailable"}], refreshed_at: 1700000000000}, created_at: 1},
    {id: 2, run_id: "run", capability: "workspace_get", status: "failed", result: {error: {code: "resource_missing", message: "Workspace no longer exists"}}, created_at: 2},
  ];
  (w as any).AssistantTest.openGlobalAssistant(async (path: string, options?: RequestInit) => {
    if (path === "/api/assistant/conversations") return [{id: "review", title: "Payment planning"}];
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.startsWith("/api/assistant/resources/")) return resource;
    if (path.endsWith("/decision")) {
      decisions.push(JSON.parse(String(options?.body)));
      plan = {...plan, status: "succeeded"};
      return {...plan, resources: [resource]};
    }
    return {messages: reviewMessages, run: null, before: 0, activities, plans: [plan]};
  }, {openResource: (value: any) => {opened.push(value);}});
  await until(() => !!w.document.querySelector('[data-assistant-plan="review-plan"]'));
  const panel = w.document.querySelector('[data-slot="conversation-panel"]')!;
  const card = panel.querySelector('[data-assistant-plan="review-plan"]')!;
  assert.ok(card.closest('[data-slot="aui_thread-viewport"]'));
  assert.equal(card.closest('[data-chat-message-id]')?.getAttribute("data-chat-message-id"), "assistant:run");
  assert.equal(card.hasAttribute("open"), true);
  assert.equal(card.querySelector(".assistant-plan-header strong")?.textContent, "Payment module");
  assert.equal(card.querySelectorAll(".assistant-plan-members > li").length, 2);
  assert.equal(card.querySelector(".assistant-plan-steps"), null, "pending plans keep the review focused on the proposed changes");
  const technical = card.querySelector("details.assistant-action-details")!;
  assert.equal(technical.hasAttribute("open"), false);
  assert.match(technical.textContent || "", /reviewed-commit/);
  assert.equal(card.querySelector(".assistant-plan-member-facts")?.textContent?.includes("reviewed-commit"), false);
  assert.equal(panel.querySelectorAll('[data-assistant-actions="run"]').length, 1);
  assert.match(panel.textContent || "", /新分支工作目录/);
  assert.match(panel.textContent || "", /复用项目目录/);
  assert.match(panel.textContent || "", /reviewed-commit/);
  assert.match(panel.textContent || "", /codex\/payments/);
  assert.match(panel.textContent || "", /Workspace no longer exists/);
  assert.equal(w.document.querySelector("img[src=x]"), null);
  const buttons = () => [...panel.querySelectorAll<HTMLButtonElement>("button")];
  buttons().find((button) => button.textContent === "选择")!.click();
  await until(() => w.document.querySelector<HTMLTextAreaElement>("textarea")?.value.includes("backend") === true);
  buttons().find((button) => button.getAttribute("aria-label") === "打开工作区：Payment workspace")!.click();
  await until(() => opened.length === 1);
  assert.deepEqual(opened[0], resource);
  buttons().find((button) => button.textContent === "确认并执行")!.click();
  await until(() => decisions.length === 1 && !buttons().some((button) => button.textContent === "确认并执行"));
  assert.equal(decisions[0].revision, 3);
  assert.equal(decisions[0].digest, "immutable-review");
  assert.equal(decisions[0].decision, "approve");
  assert.deepEqual(errors, []);
});

test("partial assistant operations expose member failures and context notices", async (t) => {
  const {w, errors} = createAssistantWindow(t);
  const plan = {...reviewedPlan(), status: "partial", steps: [{id: "prepare", label: "workspace_create", status: "partial", result: {context_warning: "Workspace notes need attention", members: [{project_id: "backend", project_name: "Backend", state: "failed", error: "Branch is occupied"}]}}]};
  (w as any).AssistantTest.openGlobalAssistant(async (path: string) => {
    if (path === "/api/assistant/conversations") return [{id: "review", title: "Partial preparation"}];
    if (path.startsWith("/api/conversation-drafts")) return null;
    return {messages: reviewMessages, run: null, before: 0, plans: [plan]};
  });
  await until(() => !!w.document.querySelector('[data-assistant-plan="review-plan"]'));
  const card = w.document.querySelector('[data-assistant-plan="review-plan"]')!;
  assert.match(card.textContent || "", /Backend · Branch is occupied/);
  assert.match(card.textContent || "", /Workspace notes need attention/);
  assert.match(card.textContent || "", /创建工作区 · 部分完成/);
  assert.equal([...card.querySelectorAll("button")].some((button) => button.textContent === "确认并执行"), false);
  assert.deepEqual(errors, []);
});

test("read-only assistant review controls stay disabled", async (t) => {
  const {w, errors} = createAssistantWindow(t, true);
  const mutations: string[] = [];
  (w as any).AssistantTest.openGlobalAssistant(async (path: string, options?: RequestInit) => {
    if (options?.method === "POST") mutations.push(path);
    if (path === "/api/assistant/conversations") return [{id: "review", title: "Payment planning"}];
    if (path.startsWith("/api/conversation-drafts")) return null;
    return {messages: reviewMessages, run: null, before: 0, plans: [reviewedPlan()]};
  });
  await until(() => !!w.document.querySelector('[data-assistant-plan="review-plan"]'));
  for (const label of ["确认并执行", "取消计划"]) {
    const button = [...w.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
    assert.equal(button.disabled, true);
    button.click();
  }
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
});

test("inline plans stay attached to their turn while replies and decisions update", async (t) => {
  const {w, errors} = createAssistantWindow(t);
  let plan = reviewedPlan();
  const olderPlan = {...reviewedPlan(), id: "older-plan", run_id: "earlier", status: "succeeded"};
  let messages = [
    {id: 1, run_id: "earlier", role: "user", text: "An earlier request"},
    {id: 2, run_id: "earlier", role: "assistant", text: "Earlier operation complete"},
    {id: 3, run_id: "run", role: "user", text: "Prepare another workspace"},
  ];
  let rejectFirst = true;
  const decisions: any[] = [];
  let finishDecision: (() => void) | undefined;
  let reads = 0;
  (w as any).AssistantTest.openGlobalAssistant(async (path: string, options?: RequestInit) => {
    if (path === "/api/assistant/conversations") return [{id: "review", title: "Inline planning"}];
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/decision")) {
      const decision = JSON.parse(String(options?.body));
      decisions.push(decision);
      if (rejectFirst) {
        rejectFirst = false;
        throw new Error("Decision connection failed");
      }
      await new Promise<void>((resolve) => { finishDecision = resolve; });
      plan = {...plan, status: decision.decision === "approve" ? "running" : "cancelled"};
      return plan;
    }
    reads++;
    return {messages, run: {id: "run", status: "running"}, before: 0, plans: [plan, olderPlan]};
  });
  const card = () => w.document.querySelector<HTMLElement>('[data-assistant-plan="review-plan"]')!;
  const button = (text: string) => [...card().querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
  await until(() => !!card());
  const original = card();
  const replies = [...w.document.querySelectorAll('[data-role="assistant"]')];
  assert.equal(replies.length, 2);
  assert.equal(replies[0].querySelector('[data-assistant-plan="review-plan"]'), null);
  assert.ok(replies[0].querySelector('[data-assistant-plan="older-plan"]'));
  assert.equal(original.closest('[data-chat-message-id]')?.getAttribute("data-chat-message-id"), "assistant:run");
  assert.ok(original.closest('[data-slot="aui_thread-viewport"]'));

  messages = [...messages, {id: 4, run_id: "run", role: "assistant", text: "The new plan is ready for review"}];
  await until(() => w.document.body.textContent?.includes("The new plan is ready for review") === true);
  assert.equal(card(), original, "arrival of reply text must preserve the interactive card");
  button("确认并执行").click();
  await until(() => card().textContent?.includes("Decision connection failed") === true);
  assert.equal(button("确认并执行").disabled, false);
  button("确认并执行").click();
  await until(() => !!finishDecision);
  assert.equal(button("正在提交…").disabled, true);
  button("正在提交…").click();
  assert.equal(decisions.length, 2);
  finishDecision!();
  await until(() => !!button("停止执行"));
  assert.equal(card(), original);
  assert.deepEqual(decisions[0], decisions[1]);
  finishDecision = undefined;
  button("停止执行").click();
  await until(() => !!finishDecision);
  finishDecision!();
  await until(() => card().textContent?.includes("已取消") === true);
  assert.equal(card().hasAttribute("open"), false);
  assert.equal(w.document.querySelectorAll('[data-assistant-plan="review-plan"]').length, 1);
  assert.ok(reads > 1);
  assert.deepEqual(errors, []);
});

test("assistant header clears unavailable context while preserving composer text", async (t) => {
  const {w, errors} = createAssistantWindow(t);
  let context = {environment_id: "offline", workspace_id: "deleted"};
  const bodies: any[] = [];
  const request = async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path === "/api/assistant/conversations") return [{id: "clear-selection", title: "Workspace planning"}];
    if (path.endsWith("/runs")) {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      return {id: body.request_id, status: "completed", error_code: ""};
    }
    return {messages: [], run: null, before: 0};
  };
  w.AssistantTest.openGlobalAssistant(request, {
    getContext: () => context,
    contextLabel: () => context.workspace_id ? "Offline · Deleted workspace" : "Local",
    clearContext: () => { context = {environment_id: "local", workspace_id: ""}; },
  });
  await until(() => !!w.document.querySelector('textarea[aria-label="助手消息"]'));
  const input = w.document.querySelector('textarea[aria-label="助手消息"]') as HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, "value")!.set!;
  setValue.call(input, "List local workspaces");
  input.dispatchEvent(new w.Event("input", {bubbles: true}));
  const clear = [...w.document.querySelectorAll("button")].find((button) => button.textContent === "清除上下文")!;
  clear.click();
  await until(() => !!w.document.body.textContent?.includes("Local"));
  assert.equal(input.value, "List local workspaces");
  assert.equal(w.document.body.textContent?.includes("Deleted workspace"), false);
  input.dispatchEvent(new w.KeyboardEvent("keydown", {key: "Enter", code: "Enter", ctrlKey: true, bubbles: true}));
  await until(() => bodies.length === 1);
  assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].context)), {environment_id: "local", workspace_id: ""});
  assert.deepEqual(errors, []);
});
