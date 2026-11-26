import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';
for (const entry of ['browser','desktop-chrome']) test(`${entry} preserves file rendering, Git selection and worktree creation`, {timeout:90000}, async t => {
 assert(process.env.YOLU_TEST_BINARY, 'Build frontend assets and Go, then set YOLU_TEST_BINARY.');
 await mkdir(path.resolve('bin'), {recursive:true});
 const app=await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY), path.resolve('bin'));
 t.after(() => app.close());
 const browser=await chromium.launch({headless:true,...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
 t.after(() => browser.close());
 {
  await writeFile(path.join(app.repository,'README.md'), 'Browser regression fixture\nUpdated fixture content\n');
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});
  if(entry==='desktop-chrome') await context.addInitScript({content:await readFile(new URL('../../src-tauri/src/window-chrome.js', import.meta.url),'utf8')+'("windows");'});
  const page=await context.newPage(); page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url+'#/projects/'+app.project.id);
  const f=page.frameLocator('iframe.workspace-page:visible');
  const card=f.locator(`[data-directory-path="${app.repository}"]`);
  await card.locator('[data-action="changes-open"][data-mode="all"]').click();
  await f.locator('[data-change-file="README.md"]').click();
  await expect(f.locator('#projectFilesText')).toContainText('Updated fixture content');
  const viewer = f.locator('#projectFilesText diffs-container');
  // A bounded plain-text fallback is valid product behavior, but must not
  // satisfy the regression that specifically verifies the lazy renderer.
  await expect(viewer).toHaveCount(1);
  await expect(viewer.locator('pre')).toContainText('Updated fixture content');
  await expect(viewer).toHaveCSS('color-scheme', 'light');
  await expect(f.locator('#projectFilesError')).toBeHidden();
  await f.locator('#projectFilesMode').selectOption('working');
  await expect(f.locator('#projectFilesText')).toContainText('Updated fixture content');
  await expect(viewer.locator('pre')).toHaveAttribute('data-diff-type', 'split');
  await expect(f.locator('#projectFilesError')).toBeHidden();
  await f.locator('#projectFilesLayout').selectOption('unified');
  await expect(f.locator('#projectFilesText')).toContainText('Updated fixture content');
  await expect(viewer.locator('pre')).toHaveAttribute('data-diff-type', 'single');
  await page.evaluate(()=>window.YoluTheme.apply('dark'));
  await expect(f.locator('html')).toHaveAttribute('data-color-scheme','dark');
  await expect(viewer).toHaveCSS('color-scheme', 'dark');
  await expect(f.locator('#projectFilesText')).toContainText('Updated fixture content');
  for(const width of [1440,760]) {
   await page.setViewportSize({width,height:900});
   await expect(f.locator('#projectFilesText')).toBeVisible();
   await f.locator('[data-action="project-directory-files-expand"]').click();
   await expect(f.locator('#projectFilesText')).toContainText('Updated fixture content');
   await f.locator('[data-action="project-directory-files-expand"]').click();
   const rect=await f.locator('#projectFilesPane').boundingBox();assert(rect&&rect.width>200&&rect.height>150, JSON.stringify(rect));
  }
  await f.locator('[data-action="project-directory-files-close"]').click();
  await expect(f.locator('#projectFilesPane')).toBeHidden();
  await page.setViewportSize({width:1440,height:900});
  await card.hover();
  await card.getByRole('button',{name:'主工作目录 更多操作',exact:true}).click();
  await f.getByRole('menuitem',{name:'Git 操作',exact:true}).click();
  await expect(f.locator('#gitWorktree')).toHaveValue(app.repository);
  await expect(f.locator('#gitContext')).toContainText('main');
  await expect(f.locator('#gitError')).toBeHidden();
  await f.locator('#gitDialog .close-dialog').first().click();
  await f.locator('[data-action="new-worktree"]').click();
  await f.locator('#worktreeSlug').fill('frontend-regression');
  await expect(f.locator('#worktreeBranch')).toHaveValue('codex/frontend-regression');
  await f.locator('#worktreeSubmit').click();
  await expect(f.locator('#worktreeDialog')).toBeHidden();
  await expect(f.locator('[data-directory-path]').filter({hasText:'frontend-regression'}).first()).toBeVisible();
  assert.deepEqual(errors,[]);
 }
});
