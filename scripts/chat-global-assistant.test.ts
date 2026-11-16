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

test("assistant history errors remain visible until an explicit page retry succeeds", async (t) => {
  let fail = true;
  const request = (async (path: string) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.includes("before=3")) {
      if (fail) throw new Error("Earlier history failed");
      return {
        messages: [{ id: 1, role: "user", text: "Earlier" }],
        run: null,
        before: 0,
      };
    }
    return {
      messages: [{ id: 3, role: "assistant", text: "Current" }],
      run: null,
      before: 3,
    };
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("history-error", request);
  t.after(() => controller.disconnect());
  await controller.connect();
  await controller.refresh(true);
  assert.equal(
    controller.getReadingSnapshot().historyError,
    "Earlier history failed",
  );
  await controller.refresh();
  assert.equal(
    controller.getReadingSnapshot().historyError,
    "Earlier history failed",
  );
  fail = false;
  await controller.refresh(true);
  assert.equal(controller.getReadingSnapshot().historyError, "");
  assert.equal(controller.getReadingSnapshot().cursor, 0);
});

function actionPlan(status = "pending") {
  return {
    id: "plan-one", conversation_id: "review", run_id: "run-one", revision: 1,
    digest: "reviewed-digest", environment_id: "local", capability: "workspace_create",
    arguments: {name: "Payments"}, review: {input: {name: "Payments"}}, status,
    steps: [], resources: [], created_at: 1, updated_at: 1,
  };
}

test("plan decisions bind the reviewed revision and suppress duplicate delivery", async (t) => {
  let plan = actionPlan();
  let finishDecision: (value: typeof plan) => void = () => {};
  const bodies: any[] = [];
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/decision")) {
      bodies.push(JSON.parse(String(options?.body)));
      return new Promise((resolve) => {finishDecision = resolve;});
    }
    return {messages: [], run: null, before: 0, plans: [plan], activities: []};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("review", request);
  t.after(() => controller.disconnect());
  await controller.connect();
  const pending = controller.decide(plan.id, "approve");
  assert.equal(await controller.decide(plan.id, "approve"), false);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {decision: "approve", revision: 1, digest: "reviewed-digest", request_id: "decision-plan-one-1-approve"});
  plan = {...plan, status: "running"};
  finishDecision(plan);
  assert.equal(await pending, true);
  await until(() => controller.getSnapshot().plans[0]?.status === "running");
  assert.equal(await controller.decide(plan.id, "approve"), false);
});

test("failed plan decisions retain the receipt while refreshing authoritative conflicts", async (t) => {
  let plan = actionPlan();
  const bodies: any[] = [];
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/decision")) {
      bodies.push(JSON.parse(String(options?.body)));
      if (bodies.length === 2) plan = {...plan, status: "conflict"};
      throw new Error("Reviewed branch changed");
    }
    return {messages: [], run: null, before: 0, plans: [plan]};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("review", request);
  t.after(() => controller.disconnect());
  await controller.connect();
  assert.equal(await controller.decide(plan.id, "approve"), false);
  await until(() => !controller.getSnapshot().deciding[plan.id]);
  assert.equal(await controller.decide(plan.id, "approve"), false);
  await until(() => controller.getSnapshot().plans[0]?.status === "conflict");
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(controller.getSnapshot().decisionErrors[plan.id], "Reviewed branch changed");
  assert.equal(await controller.decide(plan.id, "approve"), false);
  assert.equal(bodies.length, 2);
});

test("read-only assistant plans block decisions and reconciliation", async (t) => {
  const calls: string[] = [];
  const request = (async (path: string) => {
    calls.push(path);
    if (path.startsWith("/api/conversation-drafts")) return null;
    return {messages: [], run: null, before: 0, plans: [actionPlan("unknown")]};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("review", request, true);
  t.after(() => controller.disconnect());
  await controller.connect();
  assert.equal(await controller.decide("plan-one", "cancel"), false);
  assert.equal(await controller.reconcile("plan-one"), false);
  assert.equal(calls.some((path) => path.endsWith("/decision") || path.endsWith("/reconcile")), false);
});

test("resource navigation revalidates identity before opening and preserves drafts", async (t) => {
  const resource = {kind: "workspace" as const, id: "payments", environment_id: "remote-one", name: "Payments"};
  const opened: unknown[] = [];
  let mismatch = true;
  const writes: unknown[] = [];
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) {
      if (options?.body) writes.push(JSON.parse(String(options.body)));
      return null;
    }
    if (path.startsWith("/api/assistant/resources/")) return {...resource, id: mismatch ? "another-resource" : resource.id};
    return {messages: [], run: null, before: 0};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("navigation", request, false, {openResource: (value) => {opened.push(value);}});
  t.after(() => controller.disconnect());
  await controller.connect();
  controller.setDraft("Keep planning");
  await controller.openResource(resource);
  assert.equal(opened.length, 0);
  assert.equal(controller.getSnapshot().draft, "Keep planning");
  mismatch = false;
  await controller.openResource(resource);
  assert.deepEqual(opened, [resource]);
  assert.equal((writes.at(-1) as any).text, "Keep planning");
});

test("uncertain assistant send retains its original selection context across retries", async (t) => {
  let context = {environment_id: "local", project_id: "frontend"};
  const bodies: any[] = [];
  const request = (async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/runs")) {
      bodies.push(JSON.parse(String(options?.body)));
      throw new Error("uncertain delivery");
    }
    return {messages: [], run: null, before: 0};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("context", request, false, {getContext: () => context});
  t.after(() => controller.disconnect());
  await controller.connect();
  controller.setDraft("Plan payments");
  await controller.send();
  context = {environment_id: "local", project_id: "backend"};
  await controller.send();
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[1].context.project_id, "frontend");
});

test("a stale rendered review cannot approve a newer plan revision", async (t) => {
  const reviewed = actionPlan();
  let plan = reviewed;
  let decisions = 0;
  const request = (async (path: string) => {
    if (path.startsWith("/api/conversation-drafts")) return null;
    if (path.endsWith("/decision")) decisions++;
    return {messages: [], run: null, before: 0, plans: [plan]};
  }) as AssistantRequest;
  const controller = new GlobalAssistantController("review", request);
  t.after(() => controller.disconnect());
  await controller.connect();
  plan = {...reviewed, revision: 2, digest: "changed-review"};
  await controller.refresh();
  assert.equal(await controller.decide(reviewed.id, "approve", reviewed), false);
  assert.equal(decisions, 0);
  assert.match(controller.getSnapshot().decisionErrors[reviewed.id], /计划已更新/);
});
