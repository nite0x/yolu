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
  await row(first).click();
  const a = await pane(first);
  await a.locator('textarea.aui-composer-input').fill('Keep the first draft');
  await row(second).click();
  const b = await pane(second);
  await b.locator('textarea.aui-composer-input').fill('Keep the second draft');
  await row(first).click();
  await expect((await pane(first)).locator('textarea.aui-composer-input')).toHaveValue('Keep the first draft');
  await row(second).hover();
  await nav.locator(`[data-conversation-parallel="${second}"]`).click();
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
  // Approval ownership stays with the original conversation while panes switch.
  await app.request(`/api/sessions/${second}/chat`, 'POST', {text:'[request-directory]',request_id:'browser-approval'});
  await page.getByRole('button', {name:'项目',exact:true}).click();
  await page.getByRole('button', {name:'对话',exact:true}).click();
  const approvalPane = await pane(second);
  await approvalPane.locator('button[type="submit"]').filter({hasText:/允许|Allow|Accept/}).first().click({timeout:20000});
  await expect.poll(async () => (await app.request(`/api/sessions/${second}/chat`)).busy, {timeout:15000}).toBe(false);
  await expect(approvalPane.locator('textarea.aui-composer-input')).toHaveValue('Draft kept while offline');
  await screenshot('wide');
  await page.setViewportSize({width:760,height:900});
  await expect(approvalPane.locator('textarea.aui-composer-input')).toBeVisible();
  await screenshot('narrow');
  assert.deepEqual(errors, []);
});
