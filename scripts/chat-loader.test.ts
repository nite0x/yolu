import {before, test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {JSDOM} from "jsdom";

let bundle = "";
before(async () => {
  const result = await build({entryPoints: ["web/chat/loader.js"], bundle: true, write: false, format: "iife", plugins: [{
    name: "chat-bridge-fixture",
    setup(builder) {
      builder.onResolve({filter: /^\/chat\/assistant\.js$/}, () => ({path: "bridge", namespace: "fixture"}));
      builder.onLoad({filter: /.*/, namespace: "fixture"}, () => ({contents: "export const bridge = window.testBridge;"}));
    },
  }]});
  bundle = result.outputFiles[0].text;
});

function mount() {
  const dom = new JSDOM('<div id="assistantChatRoot"></div>', {runScripts: "outside-only"});
  const calls: {method: string; value?: any}[] = [];
  const window = dom.window as any;
  window.testBridge = Object.fromEntries(["open", "close", "updateOverview", "updateSession"].map(method => [method, (value: unknown) => calls.push({method, value})]));
  window.eval(bundle);
  return {dom, calls, loader: window.WorkHubAssistant};
}

test("lazy chat loading retains workspace refreshes received before the bridge mounts and forwards later metadata", async () => {
  const h = mount();
  try {
    const workspace = {workspaces: [{id: "workspace"}], projects: [{id: "project"}]};
    const pending = h.loader.open({overview: {workspaces: [], projects: []}});
    h.loader.updateOverview(workspace);
    await pending;
    assert.equal(h.calls.find(c => c.method === "open")?.value.overview, workspace);
    const refreshed = {...workspace, projects: [{id: "project", branch: "feature/ui"}]};
    h.loader.updateOverview(refreshed);
    const session = {id: "session", name: "新的会话标题"};
    h.loader.updateSession(session);
    assert.equal(h.calls.find(c => c.method === "updateOverview")?.value, refreshed);
    assert.equal(h.calls.find(c => c.method === "updateSession")?.value, session);
  } finally {h.dom.window.close();}
});

test("switching conversations during lazy loading mounts only the newest workspace", async () => {
  const h = mount();
  try {
    const first = h.loader.open({session: {id: "old"}, overview: {projects: [{id: "old"}]}});
    const workspace = {workspaces: [], projects: [{id: "new"}]};
    const second = h.loader.open({session: {id: "new"}, overview: workspace});
    await Promise.all([first, second]);
    const opened = h.calls.filter(c => c.method === "open");
    assert.equal(opened.length, 1);
    assert.equal(opened[0].value.session.id, "new");
    assert.equal(opened[0].value.overview, workspace);
  } finally {h.dom.window.close();}
});

test("lazy loader exposes the mounted draft preview to the page snapshot", async () => {
  const h = mount();
  try {
    let preview = "";
    (h.dom.window as any).testBridge.draftTitle = () => preview;
    assert.equal(h.loader.draftTitle(), "");
    await h.loader.open({overview: {projects: []}});
    preview = "整理导航层级";
    assert.equal(h.loader.draftTitle(), preview);
    preview = "";
    assert.equal(h.loader.draftTitle(), "");
  } finally {h.dom.window.close();}
});

test("language reload can flush before chat mounts and respects mounted draft failures", async () => {
  const h = mount();
  try {
    assert.equal(await h.loader.flushDraft(), true);
    let finish: (saved: boolean) => void = () => {};
    (h.dom.window as any).testBridge.flushDraft = () => new Promise<boolean>(resolve => {finish = resolve;});
    await h.loader.open({overview: {projects: []}});
    let completed = false;
    const saving = h.loader.flushDraft().then((saved: boolean) => {completed = true; return saved;});
    await Promise.resolve();
    assert.equal(completed, false, "reload waits for the mounted draft");
    finish(false);
    assert.equal(await saving, false, "a failed draft prevents reload");
    (h.dom.window as any).testBridge.flushDraft = async () => true;
    assert.equal(await h.loader.flushDraft(), true);
    (h.dom.window as any).testBridge.flushDraft = async () => {throw new Error("Draft write failed");};
    await assert.rejects(h.loader.flushDraft(), /Draft write failed/);
  } finally {h.dom.window.close();}
});
