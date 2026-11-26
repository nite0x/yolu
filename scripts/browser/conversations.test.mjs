import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

test('project groups can be dropped in gaps and keep their order after reload', {timeout:45000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY));
  t.after(() => app.close());
  for (const name of ['Yolu', 'Zeta']) {
    const cwd = path.join(path.dirname(app.repository), name);
    execFileSync('git', ['clone', '--quiet', app.repository, cwd]);
    const project = await app.request('/api/projects', 'POST', {name, path:cwd});
    await app.request('/api/sessions/new', 'POST', {project_id:project.id,cwd,request_id:name,text:name,allow_shared:true});
  }
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const nav = page.frameLocator('iframe.workspace-navigation-frame');
  const projects = nav.locator('[data-collection="project"]');
  const names = projects.locator('.session-workspace-name');
  const group = name => nav.locator(`[data-collection="project"][aria-label="${name}"]`);
  const zeta = group('Zeta').locator('[data-project-reorder]');
  await page.goto(app.url);
  await expect(names).toHaveText(['Yolu','Browser fixture','Zeta']);
  const source = await zeta.boundingBox();
  const first = await group('Yolu').boundingBox();
  const second = await group('Browser fixture').boundingBox();
  assert(source && first && second);
  const gap = (first.y + first.height + second.y) / 2;
  const x = source.x + source.width / 2;
  await page.mouse.move(x, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, gap, {steps:8});
  await expect(group('Browser fixture')).toHaveAttribute('data-project-drop', 'before', {timeout:3000});
  const saved = page.waitForResponse(response => response.ok()
    && response.request().method() === 'PUT' && response.url().endsWith('/api/settings/conversation-project-order'));
  await page.mouse.up();
  await saved;
  await expect(names).toHaveText(['Yolu','Zeta','Browser fixture']);
  await expect(zeta).toHaveAttribute('aria-expanded','true');
  await expect(nav.locator('[data-project-drop], [data-project-dragging]')).toHaveCount(0);
  await page.reload();
  await expect(names).toHaveText(['Yolu','Zeta','Browser fixture']);
  await zeta.click();
  await expect(zeta).toHaveAttribute('aria-expanded','false');
});

for (const entry of ['browser', 'desktop-chrome']) test(`${entry} handles creation directory conflicts inline`, {timeout:90000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
  // The picker filters system temporary directories out of the repository inventory.
  const fixtureRoot = path.resolve('bin');
  await mkdir(fixtureRoot, {recursive:true});
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY), fixtureRoot);
  t.after(() => app.close());
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
  if (entry === 'desktop-chrome') {
    const chrome = await readFile(new URL('../../src-tauri/src/window-chrome.js', import.meta.url), 'utf8');
    await context.addInitScript({content:chrome + '("windows");'});
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const busy = app.sessions[0].id;
  await expect.poll(async () => (await app.request(`/api/sessions/${busy}/chat`)).busy).toBe(false);
  await app.request(`/api/sessions/${busy}/chat`, 'POST', {text:'[hold]',request_id:'occupy-directory'});
  await page.goto(app.url);
  const openDraft = () => page.getByRole('button', {name:'新建对话',exact:true}).click();
  const draft = page.frameLocator('iframe.workspace-page:visible');
  const setup = draft.locator('#sessionCreationSetup');
  const project = setup.getByRole('button', {name:/Browser fixture/});
  const defaultDirectory = setup.getByRole('button', {name:'默认目录（无需项目）'});
  const worktree = draft.getByRole('checkbox', {name:'创建新 Worktree'});
  const notice = draft.locator('.session-creation-directory-conflict');
  const recommendation = draft.getByText('其他对话正在使用此目录，建议新建 Worktree。');
  const editor = draft.locator('textarea.aui-composer-input');
  const noModal = () => expect(draft.getByRole('dialog', {name:'共享工作目录'})).toHaveCount(0);

  await openDraft();
  await project.click();
  await expect(recommendation).toBeVisible();
  await expect(worktree).not.toBeChecked();
  await expect(notice.getByRole('checkbox')).toHaveCount(0);
  await noModal();
  for (const width of [1440, 760]) {
    await page.setViewportSize({width,height:900});
    assert((await recommendation.boundingBox()).y > (await worktree.boundingBox()).y);
    const artifacts = process.env.YOLU_TEST_ARTIFACT_DIR;
    if (artifacts) {
      await mkdir(artifacts, {recursive:true});
      await page.screenshot({path:path.join(artifacts, `${entry}-directory-conflict-${width}.png`)});
    }
  }

  const firstDraft = 'Keep editing while choosing a worktree';
  await editor.fill(firstDraft);
  await defaultDirectory.click();
  await expect(notice).toHaveCount(0);
  await project.click();
  await expect(recommendation).toBeVisible();
  await expect(editor).toHaveValue(firstDraft);
  await worktree.check();
  await expect(notice).toHaveCount(0);
  const isolatedSend = page.waitForResponse(response => response.ok() && response.url().endsWith('/api/sessions/new'));
  await editor.press('Enter');
  const isolated = await isolatedSend;
  assert.notEqual(isolated.request().postDataJSON().cwd, app.repository);
  assert.equal(isolated.request().postDataJSON().project_id, app.project.id);
  assert.equal(isolated.request().postDataJSON().allow_shared, undefined);
  await expect(draft.getByText('Reviewed the selected directory.', {exact:true})).toBeVisible();

  for (const staleInspection of [false, true]) {
    // A clean preview can become stale before the first send.
    if (staleInspection) {
      await page.route('**/api/session-bindings/inspect?include_files=false', route => route.fulfill({json:{directory:app.repository}}), {times:1});
    }
    await openDraft();
    const inspected = page.waitForResponse(response => response.url().includes('/api/session-bindings/inspect?include_files=false'));
    await project.click();
    await inspected;
    if (staleInspection) await expect(recommendation).toHaveCount(0);
    else await expect(recommendation).toBeVisible();
    await expect(worktree).not.toBeChecked();
    await expect(notice.getByRole('checkbox')).toHaveCount(0);
    const message = staleInspection ? 'Use the selected directory even after the preview changes' : 'Use the selected directory directly';
    await editor.fill(message);
    const sharedSend = page.waitForResponse(response => response.url().endsWith('/api/sessions/new'));
    await editor.press('Enter');
    const response = await sharedSend;
    assert(response.ok(), await response.text());
    const shared = response.request().postDataJSON();
    assert.equal(shared.cwd, app.repository);
    assert.equal(shared.allow_shared, true);
    assert.equal(shared.text, message);
    await expect(draft.getByText('Reviewed the selected directory.', {exact:true})).toBeVisible();
    await noModal();
  }
});

for (const entry of ['browser', 'desktop-chrome']) test(`${entry} preserves drafts, split panes and approvals through navigation and reconnect`, {timeout:120000}, async t => {
  const binary = process.env.YOLU_TEST_BINARY;
  assert(binary, 'Build Go after npm run build and set YOLU_TEST_BINARY to the executable.');
  const app = await startBrowserApp(path.resolve(binary));
  t.after(() => app.close());
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
  if (entry === 'desktop-chrome') {
    const chrome = await readFile(new URL('../../src-tauri/src/window-chrome.js', import.meta.url), 'utf8');
    await context.addInitScript({content:chrome + '("windows");'});
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const screenshot = async size => {
    if (!process.env.YOLU_TEST_ARTIFACT_DIR) return;
    await mkdir(process.env.YOLU_TEST_ARTIFACT_DIR, {recursive:true});
    await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR, `${entry}-${size}.png`)});
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = page.frameLocator('iframe.workspace-navigation-frame');
  const row = id => nav.locator(`[data-conversation-session="${id}"]`);
  const reader = id => page.frameLocator(`iframe.workspace-page[data-test-session="${id}"]`);
  // Locate the real reader after host restoration, without invoking controller
  // methods. Tag only the frame element so assertions remain readable.
  async function pane(id) {
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const editor = frame.locator('textarea.aui-composer-input');
        const frameElement = await frame.frameElement().catch(() => null);
        if (frameElement && await frameElement.isVisible() && await editor.count()) {
          const identity = await frame.evaluate(() => window.WorkHubPage?.snapshot().conversation?.session?.id || window.WorkHubPage?.snapshot().conversation?.selected);
          if (identity === id) {await frameElement.evaluate((node, value) => node.setAttribute('data-test-session', value), id); return true;}
        }
      }
      return false;
    }, {timeout:15000}).toBe(true);
    return reader(id);
  }
  const first = app.sessions[0].id, second = app.sessions[1].id;
  await page.goto(app.url);
  await page.getByRole('button', {name:'新建对话',exact:true}).click();
  const draft = page.frameLocator('iframe.workspace-page:visible');
  const setup = draft.locator('#sessionCreationSetup');
  const editor = draft.locator('textarea.aui-composer-input');
  const header = draft.locator('.conversation-surface-header');
  const message = 'Verify the first reply [hold]';
  await expect(setup.getByRole('heading', {name:'想完成什么？'})).toBeVisible();
  let rejectSend;
  const rejected = new Promise(resolve => {rejectSend = resolve;});
  await page.route('**/api/sessions/new', async route => {
    await rejected;
    await route.fulfill({status:503,json:{error:'Fixture rejected the first send'}});
  }, {times:1});
  await editor.fill(message);
  await editor.press('Enter');
  try {
    await expect(draft.getByText(message, {exact:true})).toBeVisible();
    await expect(draft.getByText('正在发送…', {exact:true})).toBeVisible();
    await expect(setup).toBeHidden();
    await expect(header.getByRole('button', {name:'选择工作目录'})).toBeDisabled();
    await screenshot('first-send');
  } finally {
    rejectSend();
  }
  await expect(draft.getByRole('alert').filter({hasText:'Fixture rejected the first send'})).toBeVisible();
  await expect(editor).toHaveValue(message);
  await expect(setup).toBeVisible();

  const sending = page.waitForResponse(response => response.ok() && response.url().endsWith('/api/sessions/new'));
  await editor.press('Enter');
  await sending;
  await expect(draft.getByText(message, {exact:true})).toBeVisible();
  await expect(setup).toBeHidden();
  await expect(draft.getByText('Reviewed the selected directory.', {exact:true})).toHaveCount(0);
  const waitingHeader = await header.boundingBox();
  await app.release();
  await expect(draft.getByText('Reviewed the selected directory.', {exact:true})).toBeVisible();
  assert.equal((await header.boundingBox()).y, waitingHeader.y);
  await row(first).click();
  const a = await pane(first);
  await a.locator('textarea.aui-composer-input').fill('Keep the first draft');
  await row(second).click();
  const b = await pane(second);
  await b.locator('textarea.aui-composer-input').fill('Keep the second draft');
  await row(first).click();
  const firstEditor = (await pane(first)).locator('textarea.aui-composer-input');
  await expect(firstEditor).toHaveValue('Keep the first draft');
  await firstEditor.hover();
  const projectHeading = nav.locator('[data-collection="project"] .session-collection-heading');
  const projectName = projectHeading.locator('.session-workspace-name');
  const count = projectHeading.locator('.session-collection-count');
  const timestamp = row(second).locator('time');
  const agent = row(second).getByRole('img', {name:'Codex',exact:true});
  const title = row(second).locator('.session-browser-item-title');
  const branch = row(second).locator('.session-browser-item-branch');
  const splitAction = nav.locator(`[data-conversation-parallel="${second}"]`);
  const rightEdge = async locator => {
    const box = await locator.boundingBox();
    assert(box);
    return box.x + box.width;
  };
  await expect(projectHeading.locator('.session-collection-actions')).toBeHidden();
  await expect(branch).toBeVisible();
  const restingTime = await timestamp.boundingBox();
  assert(restingTime);
  const rowStart = (await row(second).boundingBox()).x;
  const titleStart = (await title.boundingBox()).x;
  assert((await agent.boundingBox()).x >= rowStart && await rightEdge(agent) < titleStart);
  assert.equal((await branch.boundingBox()).x, titleStart);
  await expect(count).toBeVisible();
  const restingEdges = {count:await rightEdge(count), project:await rightEdge(projectName), time:await rightEdge(timestamp), agent:await rightEdge(agent), title:await rightEdge(title)};
  await projectHeading.hover();
  await expect(count).toBeHidden();
  const createEdge = await rightEdge(projectHeading.locator('.session-collection-create svg'));
  assert(Math.abs(createEdge - restingEdges.count) < 1);
  assert.equal(await rightEdge(projectName), restingEdges.project);
  await row(second).hover();
  await expect(count).toBeVisible();
  await expect(timestamp).toHaveCSS('opacity','0');
  const hoverAction = await splitAction.boundingBox();
  assert(hoverAction);
  assert.equal(hoverAction.x, restingTime.x);
  assert.equal(hoverAction.width, restingTime.width);
  assert(Math.abs(hoverAction.y + hoverAction.height / 2 - (restingTime.y + restingTime.height / 2)) < 1);
  assert.equal(await rightEdge(agent), restingEdges.agent);
  assert.equal(await rightEdge(title), restingEdges.title);
  assert(Math.abs(await rightEdge(splitAction.locator('svg')) - restingEdges.time) < 1);
  assert(Math.abs(await rightEdge(splitAction.locator('svg')) - createEdge) < 1);
  await splitAction.click();
  const split = await pane(second);
  await expect(page.locator('iframe.workspace-page:visible')).toHaveCount(2);
  await expect(split.locator('textarea.aui-composer-input')).toHaveValue('Keep the second draft');
  await page.getByRole('button', {name:'项目',exact:true}).click();
  await page.getByRole('button', {name:'对话',exact:true}).click();
  await expect((await pane(first)).locator('textarea.aui-composer-input')).toHaveValue('Keep the first draft');
  // The backend is unchanged while the browser connection disappears.
  const failedSave = page.waitForEvent('requestfailed', {predicate:request => request.method() === 'POST' && request.url().includes('/api/conversation-drafts')});
  await context.setOffline(true);
  await split.locator('textarea.aui-composer-input').fill('Draft kept while offline');
  await failedSave;
  const recoveredSave = page.waitForResponse(response => response.ok() && response.request().method() === 'POST'
    && response.url().includes('/api/conversation-drafts') && response.request().postData()?.includes('Draft kept while offline'));
  await context.setOffline(false);
  await recoveredSave;
  await expect(split.locator('textarea.aui-composer-input')).toHaveValue('Draft kept while offline');
  await expect((await pane(first)).getByRole('alert').filter({hasText:/状态读取失败|Failed to fetch/})).toHaveCount(0);
  await expect(split.getByRole('alert').filter({hasText:/状态读取失败|Failed to fetch/})).toHaveCount(0);
  // Approval ownership stays with the original conversation while panes switch.
  await app.request(`/api/sessions/${second}/chat`, 'POST', {text:'[request-directory]',request_id:'browser-approval'});
  await page.getByRole('button', {name:'项目',exact:true}).click();
  await page.getByRole('button', {name:'对话',exact:true}).click();
  const approvalPane = await pane(second);
  await approvalPane.locator('button[type="submit"]').filter({hasText:/允许|Allow|Accept/}).first().click({timeout:20000});
  await expect.poll(async () => (await app.request(`/api/sessions/${second}/chat`)).busy, {timeout:15000}).toBe(false);
  await expect(approvalPane.getByText('Reviewed the selected directory.', {exact:true})).toHaveCount(2);
  await expect(approvalPane.locator('textarea.aui-composer-input')).toHaveValue('Draft kept while offline');
  await screenshot('wide');
  // Shared foundation components are exercised through both real host entries.
  for (const width of [1440, 760]) {
    await page.setViewportSize({width,height:1000});
    const history = await page.locator('.window-history').boundingBox();
    const search = await page.locator('.window-search-trigger').boundingBox();
    assert(history && search);
    const searchGap = search.x - (history.x + history.width);
    assert(searchGap >= 0 && searchGap <= 16, `Expected history beside search at ${width}px, got ${searchGap}px`);
    await page.getByRole('button', {name:'项目',exact:true}).click();
    const projectPage = page.frameLocator('iframe.workspace-page:visible');
    await projectPage.getByRole('button', {name:'添加项目',exact:true}).click();
    const dialog = projectPage.locator('#projectDialog');
    await expect(dialog).toBeVisible();
    const pathInput = dialog.locator('#projectPath');
    await expect(pathInput).toHaveAttribute('aria-describedby', 'projectPath-help');
    await expect(pathInput).toHaveAttribute('required', '');
    await expect(dialog.locator('#projectCloneURL')).toBeDisabled();
    if (process.env.YOLU_TEST_ARTIFACT_DIR) await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR, `${entry}-project-form-${width}.png`)});
    await dialog.getByRole('button', {name:'关闭',exact:true}).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', {name:'设置',exact:true}).click();
    const settings = page.frameLocator('iframe.workspace-page:visible');
    await expect(settings.locator('#appearanceTitle')).toBeVisible();
    await expect(settings.locator('#languageSelect')).toBeVisible();
    if (process.env.YOLU_TEST_ARTIFACT_DIR) await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR, `${entry}-settings-${width}.png`)});
    await page.getByRole('button', {name:'对话',exact:true}).click();
    await expect((await pane(second)).locator('textarea.aui-composer-input')).toHaveValue('Draft kept while offline');
  }
  await page.setViewportSize({width:760,height:900});
  await expect(approvalPane.locator('textarea.aui-composer-input')).toBeVisible();
  await screenshot('narrow');

  await page.setViewportSize({width:1440,height:1000});
  const assistants = nav.locator('[data-conversation-group="yolu-assistant"]');
  await expect(assistants).toBeVisible();
  await assistants.hover();
  await assistants.locator('[data-yolu-assistant]').click();
  const creation = page.frameLocator('iframe.workspace-page[data-focused="true"]:visible');
  const composer = creation.getByPlaceholder('询问项目、分支或工作树状态…');
  await expect(composer).toBeFocused();
  await expect(creation.locator('#sessionBrowserNewDirectoryField')).toBeHidden();
  await expect(creation.getByRole('button', {name:'选择工作目录'})).toHaveCount(0);
  await expect(creation.getByRole('button', {name:'添加附加目录'})).toHaveCount(0);
  await composer.press('Control+Shift+D');
  await expect(creation.getByRole('dialog', {name:'选择工作目录'})).toHaveCount(0);
  const assistantDraft = '[assistant-status] Which worktrees have uncommitted changes?';
  const previousDraftKey = JSON.stringify(['local', 'draft', 'yolu-assistant', app.project.id, app.repository]);
  await app.request(`/api/conversation-drafts?key=${encodeURIComponent(previousDraftKey)}`, 'POST', {
    text:assistantDraft, images:[], settings:{}, project:app.project.id,
    reading:{top:0, bottom:true, anchor:'', offset:0}, updated:Date.now(),
  });
  await composer.evaluate((editor, repository) => {
    const pane = editor.ownerDocument.defaultView;
    const snapshot = pane.WorkHubPage.snapshot();
    snapshot.conversation.creationDirectory = repository;
    pane.dispatchEvent(new pane.MessageEvent('message', {source:pane.parent, origin:pane.location.origin,
      data:{type:'workhub:page-restore', active:true, snapshot}}));
  }, app.repository);
  await expect(composer).toHaveValue(assistantDraft);
  await expect(creation.locator('#sessionBrowserNewDirectoryField')).toBeHidden();
  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/sessions/new'));
  await composer.press('Enter');
  const response = await created;
  assert(response.ok(), await response.text());
  const payload = response.request().postDataJSON();
  assert.equal(payload.cwd, undefined);
  assert.equal(payload.project_id, undefined);
  const {session} = await response.json();
  assert.equal(session.yolu_assistant, true);
  assert.match(session.cwd, /\/conversation-directories\/[a-f0-9]{64}$/);
  await expect(assistants.locator(`[data-conversation-session="${session.id}"]`)).toBeVisible();
  const assistant = await pane(session.id);
  await assistant.getByRole('link', {name:'Open fixture worktree'}).click();
  await page.waitForURL(url => url.hash.startsWith(`#/projects/${app.project.id}?`));
  const details = page.frameLocator('iframe.workspace-page:visible');
  await expect(details.locator('#projectDetail')).toBeVisible();
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('directory')).toBe(app.repository);
  const card = details.locator(`[data-directory-path="${app.repository}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-action="project-directory-toggle"]')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', {name:'对话',exact:true}).click();
  const restored = await pane(session.id);
  await restored.locator('textarea.aui-composer-input').fill('Check that status again');
  await restored.locator('textarea.aui-composer-input').press('Enter');
  await expect(restored.getByText('Reviewed the selected directory.', {exact:true})).toBeVisible();
  const calls = (await app.providerLog()).trim().split('\n').map(JSON.parse);
  const start = calls.find(call => call.rpc === 'thread/start' && call.params.developerInstructions?.startsWith('You are Yolu Assistant'));
  const resume = calls.find(call => call.rpc === 'thread/resume' && call.params.threadId === session.id && call.params.config?.mcp_servers?.yolu_builtin);
  assert.deepEqual(start.params.config.mcp_servers.yolu_builtin.enabled_tools, ['list_projects', 'get_project']);
  assert.deepEqual(resume?.params.config.mcp_servers.yolu_builtin, start.params.config.mcp_servers.yolu_builtin);
  assert.deepEqual(errors, []);
});
