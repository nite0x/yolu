import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GlobalAssistantController,
  type AssistantRequest,
  type AssistantSnapshot,
} from "../frontend/chat/global-assistant-controller";

const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await pause();
  assert.ok(check());
}

test("assistant sends persist a request before inference and recover uncertain delivery after reopening", async (t) => {
  let draft: unknown = null;
  let snapshot: AssistantSnapshot = { messages: [], run: null, before: 0 };
  let sendCalls = 0;
  const request = (async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path.startsWith("/api/conversation-drafts")) {
      if (body) draft = structuredClone(body);
      return draft;
    }
    if (path.endsWith("/runs")) {
      sendCalls++;
      assert.deepEqual((draft as any).assistant_request, body);
      snapshot = {
        messages: [
          { id: 1, run_id: body.request_id, role: "user", text: body.text },
        ],
        run: { id: body.request_id, status: "running", error_code: "" },
        before: 0,
      };
      throw new Error("uncertain delivery");
    }
    return snapshot;
  }) as AssistantRequest;
  const first = new GlobalAssistantController("recover", request);
  t.after(() => first.disconnect());
  await first.connect();
  await until(() => !first.getSnapshot().loading);
  first.setDraft("Plan work");
  await first.send();
  await until(() => first.getSnapshot().messages.length === 1);
  assert.equal(first.getSnapshot().draft, "");
  assert.equal(sendCalls, 1);
  first.disconnect();
  await first.flush();
  const reopened = new GlobalAssistantController("recover", request);
  t.after(() => reopened.disconnect());
  await reopened.connect();
  await until(() => !reopened.getSnapshot().loading);
  assert.equal(reopened.busy, true);
  assert.equal(reopened.getSnapshot().messages[0].text, "Plan work");
  assert.equal(sendCalls, 1);
});

test("assistant preserves failed sends and reuses request identity when retrying", async (t) => {
  const bodies: any[] = [];
  let failed = true;
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/runs")) {
      const body = JSON.parse(String(options?.body));
      bodies.push(body);
      if (failed) throw new Error("request failed");
      return { id: body.request_id, status: "completed", error_code: "" };
    }
    return { messages: [], run: null, before: 0 };
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("retry", request);
  t.after(() => controller.disconnect());
  await controller.connect();
  await until(() => !controller.getSnapshot().loading);
  controller.setDraft("Keep my draft");
  await controller.send();
  await pause();
  assert.equal(controller.getSnapshot().draft, "Keep my draft");
  assert.equal(controller.getSnapshot().error, "request failed");
  failed = false;
  await controller.send();
  assert.equal(controller.getSnapshot().draft, "");
  assert.deepEqual(bodies[0], bodies[1]);
});

test("assistant draft restoration and paged history retain conversation identity", async (t) => {
  const drafts = new Map<string, any>();
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) {
      if (options?.body) drafts.set(path, JSON.parse(String(options.body)));
      return drafts.get(path) || null;
    }
    if (path.includes("before=3"))
      return {
        messages: [{ id: 1, role: "user", text: "Earlier" }],
        run: null,
        before: 0,
      };
    return {
      messages: [{ id: 3, role: "assistant", text: "Recent" }],
      run: null,
      before: 3,
    };
  }) as AssistantRequest;
  const first = new GlobalAssistantController("first", request);
  const second = new GlobalAssistantController("second", request);
  t.after(() => {
    first.disconnect();
    second.disconnect();
  });
  await first.connect();
  await second.connect();
  await until(() => !first.getSnapshot().loading);
  first.setDraft("First draft");
  second.setDraft("Second draft");
  await first.flush();
  await second.flush();
  await first.refresh(true);
  assert.deepEqual(
    first.getSnapshot().messages.map((message) => message.id),
    [1, 3],
  );
  await first.refresh();
  assert.deepEqual(
    first.getSnapshot().messages.map((message) => message.id),
    [1, 3],
  );
  assert.equal(first.getSnapshot().before, 0);
  const restored = new GlobalAssistantController("first", request);
  t.after(() => restored.disconnect());
  await restored.connect();
  assert.equal(restored.getSnapshot().draft, "First draft");
  assert.equal(second.getSnapshot().draft, "Second draft");
});

test("leaving before draft restoration finishes preserves the saved draft", async () => {
  let finishLoad: (value: unknown) => void = () => {};
  let writes = 0;
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) {
      if (options?.method === "POST") {
        writes++;
        return null;
      }
      return new Promise((resolve) => {
        finishLoad = resolve;
      });
    }
    return { messages: [], run: null, before: 0 };
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("slow-restore", request);
  const loading = controller.connect();
  controller.disconnect();
  await controller.flush();
  finishLoad({
    text: "Saved work",
    settings: {},
    images: [],
    reading: {},
    updated: 1,
  });
  await loading;
  assert.equal(writes, 0);
});
