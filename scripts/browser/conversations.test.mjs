import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

test('conversation scrollbars appear independently and fade without reserving space', {timeout:60000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY));
  t.after(() => app.close());
  for (let index = 0; index < 16; index++) {
    await app.request('/api/sessions/new', 'POST', {
      project_id:app.project.id, cwd:app.repository, request_id:`list-${index}`, text:`Sidebar conversation ${index}`, allow_shared:true,
    });
  }
  const [first, second] = app.sessions.map(session => session.id);
  for (const id of [first, second]) {
    await expect.poll(async () => (await app.request(`/api/sessions/${id}/chat`)).busy).toBe(false);
    const text = Array.from({length:60}, (_, line) => `Long saved message, line ${line + 1}`).join('\n');
    await app.request(`/api/sessions/${id}/chat`, 'POST', {text, request_id:`long-${id}`, allow_shared:true});
  }
  await expect.poll(async () => (await app.request(`/api/sessions/${first}/chat`)).busy).toBe(false);
  await app.request(`/api/sessions/${first}/chat`, 'POST', {text:'[hold]', request_id:'show-running-status', allow_shared:true});
  const browser = await chromium.launch({headless:true, args:['--disable-overlay-scrollbar'], ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:680}});
  await page.addInitScript(() => localStorage.setItem('workhub:conversation-list-mode:v1', 'recent'));
  const nav = page.frameLocator('iframe.workspace-navigation-frame');
  const list = nav.locator('#sessionBrowserList');
  const listBar = nav.locator('.conversation-scrollbar');
  const row = id => nav.locator(`[data-conversation-session="${id}"]`);
  const viewports = '[data-slot="aui_thread-viewport"]';
  const frames = page.locator('iframe.workspace-page:visible');
  await page.goto(app.url);
  const running = row(first).locator('.session-browser-item-status');
  await expect(running).toHaveAttribute('data-state', 'running');
  await expect(running).toBeVisible();
  const stateBox = await running.boundingBox();
  const timeBox = await row(first).locator('time').boundingBox();
  assert(stateBox && timeBox);
  assert(timeBox.x - stateBox.x - stateBox.width <= 8);
  assert(Math.abs(timeBox.y + timeBox.height / 2 - stateBox.y - stateBox.height / 2) < 1);
  await row(first).click();
  await row(second).hover();
  await nav.locator(`[data-conversation-parallel="${second}"]`).click();
  await expect(frames).toHaveCount(2);

  const checkScroll = async (viewport, bar, delta, inactive, drag = false) => {
    const thumb = bar.locator(':scope > div');
    await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100);
    await expect(thumb).toHaveCSS('opacity', '0');
    const dimensions = () => viewport.evaluate(node => [node.offsetWidth, node.clientWidth]);
    const before = await dimensions();
    assert.equal(before[0], before[1]);
    const position = () => viewport.evaluate(node => node.scrollTop);
    await viewport.hover({position:{x:35,y:140}});
    await expect(thumb).toHaveCSS('opacity', '0');
    for (const other of inactive) await expect(other).not.toHaveAttribute('data-visible');
    const previous = await position();
    const range = await viewport.evaluate(node => node.scrollHeight - node.clientHeight);
    await page.mouse.wheel(0, previous > range / 2 ? -delta : delta);
    await expect.poll(position).not.toBe(previous);
    await expect(bar).toHaveAttribute('data-visible', '');
    for (const other of inactive) await expect(other).not.toHaveAttribute('data-visible');
    assert.deepEqual(await dimensions(), before);
    if (drag) {
      const bounds = await thumb.boundingBox();
      assert(bounds);
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      const start = await position();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + (start > range / 2 ? -34 : 34), {steps:4});
      await page.mouse.up();
      await expect.poll(position).not.toBe(start);
      await viewport.hover({position:{x:35,y:140}});
    }
    await expect(thumb).toHaveCSS('opacity', '0');
    assert.deepEqual(await dimensions(), before);
  };
  const paneBars = [0, 1].map(index => frames.nth(index).contentFrame().locator('.chat-reading .conversation-scrollbar'));
  await checkScroll(list, listBar, 120, paneBars, true);
  for (let index = 0; index < 2; index++) {
    const pane = frames.nth(index).contentFrame();
    await checkScroll(pane.locator(viewports), paneBars[index], 250, [paneBars[1 - index], listBar]);
  }
  await app.release();
});

test('project groups can be dropped in gaps and keep their order after reload', {timeout:45000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY));
  t.after(() => app.close());
  const projectIDs = new Map([['Browser fixture', app.project.id]]);
  for (const name of ['Yolu', 'Zeta']) {
    const cwd = path.join(path.dirname(app.repository), name);
    execFileSync('git', ['clone', '--quiet', app.repository, cwd]);
    const project = await app.request('/api/projects', 'POST', {name, path:cwd});
    projectIDs.set(name, project.id);
    await app.request('/api/sessions/new', 'POST', {project_id:project.id,cwd,request_id:name,text:name,allow_shared:true});
  }
  // Repository discovery order can change with Git/status completion timing.
  // Exercise drag/drop from a known saved order, leaving the movement and
  // persistence assertions independent of that backend enumeration.
  await app.request('/api/settings/conversation-project-order', 'PUT', {
    order: ['Yolu', 'Browser fixture', 'Zeta'].map(name => JSON.stringify(['local', 'project', projectIDs.get(name)])),
  });
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
  // Project headings arrive before their conversation inventories. Measuring
  // the gap while rows are still filling would drag to obsolete coordinates.
  await expect(group('Yolu').locator('[data-conversation-session]')).toHaveCount(1);
  await expect(group('Browser fixture').locator('[data-conversation-session]')).toHaveCount(2);
  await expect(group('Zeta').locator('[data-conversation-session]')).toHaveCount(1);
  await expect(nav.locator('#sessionBrowserList')).toHaveAttribute('aria-busy', 'false');
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

for (const entry of ['browser', 'desktop-chrome']) test(`${entry} switches between chat, terminal and Codex Cloud in the creation form`, {timeout:90000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY), path.resolve('bin'));
  t.after(() => app.close());
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1240,height:860},locale:'zh-CN'});
  if (entry === 'desktop-chrome') {
    const chrome = await readFile(new URL('../../src-tauri/src/window-chrome.js', import.meta.url), 'utf8');
    await context.addInitScript({content:chrome + '("windows");'});
  }
  await context.route('**/api/codex/cloud-environments', route => route.fulfill({json:[{id:'cloud-fixture',name:'Cloud fixture',shared:false}]}));
  const page = await context.newPage();
  await page.goto(app.url);
  await page.getByRole('button', {name:'新建对话',exact:true}).click();
  const surface = page.frameLocator('iframe.workspace-page:visible');
  const modes = surface.getByRole('group', {name:'对话形式',exact:true});
  const chat = modes.getByRole('button', {name:'对话',exact:true});
  const terminal = modes.getByRole('button', {name:'终端',exact:true});
  const cloud = modes.getByRole('button', {name:'Codex Cloud',exact:true});
  const environment = surface.getByLabel('云端环境', {exact:true});
  const directory = surface.locator('#sessionBrowserNewDirectoryField');
  const worktree = surface.getByRole('checkbox', {name:'创建新 Worktree'});
  const editor = surface.locator('textarea.aui-composer-input');
  await expect(modes.getByRole('button')).toHaveText(['对话','终端','Codex Cloud']);
  await expect(chat).toHaveAttribute('aria-pressed','true');
  await expect(directory).toBeVisible();
  await directory.getByRole('button', {name:/Browser fixture/}).click();
  await worktree.check();
  await editor.fill('Keep this draft across creation modes');
  await cloud.focus();
  await cloud.press('Enter');
  await expect(cloud).toBeFocused();
  await expect(cloud).toHaveAttribute('aria-pressed','true');
  await expect(directory).toBeHidden();
  await environment.selectOption('cloud-fixture');
  await terminal.click();
  await expect(terminal).toHaveAttribute('aria-pressed','true');
  await expect(modes.getByRole('button')).toHaveText(['对话','终端','Codex Cloud']);
  await cloud.click();
  await expect(cloud).toHaveAttribute('aria-pressed','true');
  await expect(environment).toHaveValue('cloud-fixture');
  await expect(editor).toHaveValue('Keep this draft across creation modes');
  await terminal.click();
  await expect(terminal).toHaveAttribute('aria-pressed','true');
  await chat.click();
  await expect(chat).toHaveAttribute('aria-pressed','true');
  await expect(directory).toBeVisible();
  await expect(worktree).toBeChecked();
  await expect(environment).toBeHidden();
  await expect(editor).toHaveValue('Keep this draft across creation modes');
  await page.setViewportSize({width:375,height:780});
  const buttons = await modes.getByRole('button').all();
  const positions = await Promise.all(buttons.map(button => button.boundingBox()));
  assert(positions.every(position => position && position.y === positions[0]?.y && position.x + position.width <= 375));
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
  assert.equal(hoverAction.width, hoverAction.height);
  assert.equal(hoverAction.width, 30);
  assert(Math.abs(hoverAction.y + hoverAction.height / 2 - (restingTime.y + restingTime.height / 2)) < 1);
  assert.equal(await rightEdge(agent), restingEdges.agent);
  assert.equal(await rightEdge(title), restingEdges.title);
  assert(Math.abs(await rightEdge(splitAction.locator('svg')) - restingEdges.time) < 1);
  assert(Math.abs(await rightEdge(splitAction.locator('svg')) - createEdge) < 1);
  await splitAction.click();
  const split = await pane(second);
  await expect(page.locator('iframe.workspace-page:visible')).toHaveCount(2);
  await expect(split.locator('textarea.aui-composer-input')).toHaveValue('Keep the second draft');
  const activeHeader = page.frameLocator('iframe.workspace-page[data-focused="true"]').locator('.conversation-surface-header');
  await expect(activeHeader).toHaveCSS('background-image', /^linear-gradient\(/);
  const inactiveHeader = page.frameLocator('iframe.workspace-page[data-focused="false"]').locator('.conversation-surface-header');
  await expect(inactiveHeader).toHaveCSS('background-image', /^linear-gradient\(/);
  assert.equal(await inactiveHeader.evaluate(header => getComputedStyle(header).getPropertyValue('--conversation-header-tint').trim()), '');
  const initialGradient = await activeHeader.evaluate(header => getComputedStyle(header).backgroundImage);
  await expect(inactiveHeader).not.toHaveCSS('background-image', initialGradient);
  const initialTheme = await page.evaluate(() => window.YoluTheme.current());
  await page.evaluate(() => window.YoluTheme.apply('dark'));
  await expect(activeHeader).toHaveCSS('background-image', /^linear-gradient\(/);
  await expect(activeHeader).not.toHaveCSS('background-image', initialGradient);
  await page.evaluate(theme => window.YoluTheme.apply(theme), initialTheme);
  await expect(activeHeader).toHaveCSS('background-image', initialGradient);
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
    const currentPane = await pane(second);
    const conversationHeader = currentPane.locator('.conversation-surface-header');
    const workingDetails = currentPane.locator('.chat-panel-actions > .chat-workspace-context > summary[aria-label="工作详情"]');
    const filesButton = currentPane.locator('.chat-workspace-context + .chat-file-toggle-slot #toggleConversationFiles');
    const workingPopover = currentPane.locator('.conversation-context-popover');
    await expect(conversationHeader).toHaveCSS('border-bottom-width', '0px');
    const messageEdge = () => currentPane.locator('.chat-reading').evaluate(thread => {
      const viewport = thread.querySelector('[data-slot="aui_thread-viewport"]');
      const header = thread.previousElementSibling;
      const headerBox = header.getBoundingClientRect();
      const overlap = headerBox.bottom - viewport.getBoundingClientRect().top;
      return {
        headerGradient: getComputedStyle(header).backgroundImage.startsWith('linear-gradient('),
        startsAtHeaderTop: overlap > 0 && Math.abs(overlap - headerBox.height) < 1,
        compensatesForOverlap: Math.abs(overlap - Number.parseFloat(getComputedStyle(viewport).paddingTop)) < 1,
      };
    });
    const fullHeader = {headerGradient:true, startsAtHeaderTop:true, compensatesForOverlap:true};
    await expect.poll(messageEdge).toEqual(fullHeader);
    await expect(workingDetails).toBeVisible();
    await expect(filesButton).toBeVisible();
    await expect(workingDetails).toHaveText('');
    await workingDetails.press('Enter');
    await expect(workingPopover).toBeVisible();
    assert.equal(Math.round(await rightEdge(conversationHeader) - await rightEdge(workingPopover)), 12);
    await workingDetails.press('Escape');
    await expect(workingPopover).toBeHidden();
    await expect(workingDetails).toBeFocused();
    if (width === 1440) {
      await conversationHeader.getByRole('button', {name:'更多对话操作'}).click();
      await currentPane.getByRole('menuitem', {name:'查找消息'}).click();
      const messageSearch = conversationHeader.getByRole('searchbox', {name:'查找对话内容'});
      await expect(messageSearch).toBeVisible();
      await expect.poll(messageEdge).toEqual(fullHeader);
      await messageSearch.press('Escape');
      await expect(messageSearch).toBeHidden();
      await expect.poll(messageEdge).toEqual(fullHeader);
    }
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
