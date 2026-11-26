import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

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
  const count = projectHeading.locator('.session-collection-count');
  const timestamp = row(second).locator('time');
  const agent = row(second).locator('.session-browser-item-agent svg');
  const splitAction = nav.locator(`[data-conversation-parallel="${second}"]`);
  const rightEdge = async locator => {
    const box = await locator.boundingBox();
    assert(box);
    return box.x + box.width;
  };
  await expect(projectHeading.locator('.session-collection-actions')).toBeHidden();
  assert(Math.abs(await rightEdge(count) - await rightEdge(timestamp)) < 1);
  assert(Math.abs((await timestamp.boundingBox()).x - await rightEdge(agent) - 6) < 1);
  await projectHeading.hover();
  await expect(count).toBeHidden();
  const createEdge = await rightEdge(projectHeading.locator('.session-collection-create svg'));
  await row(second).hover();
  await expect(timestamp).toBeHidden();
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
  await expect(composer).toBeVisible();
  await composer.fill('[assistant-status] Which worktrees have uncommitted changes?');
  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/sessions/new'));
  await composer.press('Enter');
  const response = await created;
  assert(response.ok(), await response.text());
  const {session} = await response.json();
  assert.equal(session.yolu_assistant, true);
  await expect(assistants.locator(`[data-conversation-session="${session.id}"]`)).toBeVisible();
  const assistant = await pane(session.id);
  await assistant.getByRole('link', {name:'Open fixture worktree'}).click();
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
