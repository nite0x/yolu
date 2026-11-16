import { before, test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
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

function createAssistantWindow(t: { after: (callback: () => void) => void }) {
  const errors: unknown[] = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(
    '<meta name="session-mode" content="interactive"><section id="globalAssistantPage"><div id="globalAssistantRoot"></div></section>',
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
  assert.ok(w.document.querySelector(".workspace-split-layout"));
  assert.equal(w.document.querySelectorAll(".workspace-pane").length, 2);
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
  send();
  await until(() => sends.length === 2 && input().value === "");
  assert.equal(sends[0].request_id, sends[1].request_id);
  assert.match(w.document.body.textContent || "", /Ready/);
  type("Keep another draft");
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[1]
    .click();
  await until(
    () =>
      w.document
        .querySelector('button[aria-pressed="true"]')
        ?.textContent?.includes("Second plan") === true && input().value === "",
  );
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[0]
    .click();
  await until(() => input().value === "Keep another draft");
  delayFailure = true;
  type("Preserve the draft when leaving during a send");
  send();
  await until(() => sends.length === 3 && !!rejectSend);
  w.document
    .querySelectorAll<HTMLButtonElement>(".session-browser-item")[1]
    .click();
  await until(
    () =>
      w.document
        .querySelector('button[aria-pressed="true"]')
        ?.textContent?.includes("Second plan") === true,
  );
  rejectSend!();
  await new Promise((resolve) => setTimeout(resolve, 450));
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
