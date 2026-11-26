import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

for (const entry of ['browser','desktop-chrome']) test(`${entry} runs the Cursor conversation lifecycle`, {timeout:120000}, async t=>{
 assert(process.env.YOLU_TEST_BINARY,'Set YOLU_TEST_BINARY to the built Go executable.');
 await mkdir(path.resolve('bin'),{recursive:true});
 const app=await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY),path.resolve('bin'));
 t.after(()=>app.close());
 const browser=await chromium.launch({headless:true,...(process.env.YOLU_BROWSER_EXECUTABLE?{executablePath:process.env.YOLU_BROWSER_EXECUTABLE}:{})});
 t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
 if(entry==='desktop-chrome'){
  const chrome=await readFile(new URL('../../src-tauri/src/window-chrome.js',import.meta.url),'utf8');
  await context.addInitScript({content:chrome+'("windows");'});
 }
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(app.url);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const settings=page.frameLocator('iframe.workspace-page:visible');
 await settings.getByRole('button',{name:'对话',exact:true}).click();
 await settings.locator('#defaultAgentSelect').selectOption('cursor');
 await expect.poll(async()=>(await app.request('/api/settings/default-agent')).provider).toBe('cursor');
 await settings.locator('#conversationDefaultProviderGroup label:has(input[value="cursor"])').click();
 await expect(settings.locator('#conversationDefaultModel')).toContainText('Fixture Model');
 await settings.locator('#conversationDefaultModel').selectOption('fixture-model');
 await expect.poll(async()=>(await app.request('/api/settings/conversation-defaults?provider=cursor')).settings.model).toBe('fixture-model');
 await settings.getByRole('button',{name:'诊断',exact:true}).click();
 await expect(settings.locator('#cursorDiagnosticsResults')).toContainText('Cursor ACP 已连接并完成认证');
 for(const width of [1440,760]){
  await page.setViewportSize({width,height:1000});
  await expect(settings.locator('#cursorDiagnosticsTitle')).toBeVisible();
  await settings.locator('#cursorDiagnosticsTitle').evaluate(node=>node.closest('.settings-card').scrollIntoView({block:'start',behavior:'instant'}));
  if(process.env.YOLU_TEST_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR,`${entry}-cursor-diagnostics-${width}.png`)});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'新建对话',exact:true}).click();
 let pane=page.frameLocator('iframe.workspace-page:visible');
 await pane.locator('#sessionCreationSetup').getByRole('button',{name:/Browser fixture/}).click();
 await pane.getByRole('checkbox',{name:'创建新 Worktree'}).check();
 await pane.getByRole('button',{name:'上下文与设置',exact:true}).click();
 await expect(pane.getByRole('group',{name:'对话引擎',exact:true}).getByRole('radio',{name:'Cursor',exact:true})).toBeChecked();
 await pane.getByRole('button',{name:'关闭设置',exact:true}).click();
 const editor=()=>pane.locator('textarea.aui-composer-input');
 const creation=page.waitForResponse(r=>r.ok()&&r.request().method()==='POST'&&r.url().endsWith('/api/sessions/new'));
 await editor().fill('Cursor integration [approval]');await editor().press('Enter');
 const response=await creation;assert.equal(response.request().postDataJSON().provider,'cursor');
 const created=(await response.json()).session;assert.notEqual(created.cwd,app.repository);
 pane=page.frameLocator('iframe.workspace-page:visible');
 await expect(pane.getByText('Run fixture command',{exact:true})).toBeVisible();
 await pane.getByRole('button',{name:'Allow once',exact:true}).click();
 await expect.poll(async()=>(await app.request(`/api/sessions/${created.id}/chat`)).status).toBe('completed');
 await expect(pane.getByText('Cursor fixture completed the request.',{exact:true})).toBeVisible();
 await page.reload();
 pane=page.frameLocator('iframe.workspace-page:visible');
 await expect(pane.getByText('Cursor fixture completed the request.',{exact:true})).toBeVisible();
 const send=async text=>{
  await expect(pane.getByRole('button',{name:'停止',exact:true})).toHaveCount(0);
  const sent=page.waitForResponse(r=>r.ok()&&r.request().method()==='POST'&&r.url().endsWith(`/api/sessions/${created.id}/chat`));
  await editor().fill(text);await editor().press('Enter');await sent;
 };
 await send('[question]');
 await pane.getByRole('checkbox',{name:'Unit tests',exact:true}).check();
 await pane.getByRole('checkbox',{name:'Browser tests',exact:true}).check();
 await pane.getByRole('button',{name:'提交回答',exact:true}).click();
 await expect.poll(async()=>(await app.request(`/api/sessions/${created.id}/chat`)).status).toBe('completed');
 await send('[plan]');
 await expect(pane.getByText('确认 Cursor 计划 · Cursor fixture plan',{exact:true})).toBeVisible();
 await pane.getByRole('button',{name:'执行计划',exact:true}).click();
 await expect.poll(async()=>(await app.request(`/api/sessions/${created.id}/chat`)).status).toBe('completed');
 await send('[hold]');await pane.getByRole('button',{name:'停止',exact:true}).click();
 await expect.poll(async()=>(await app.request(`/api/sessions/${created.id}/chat`)).status).toBe('interrupted');
 await pane.getByRole('button',{name:'更多对话操作',exact:true}).click();
 await expect(pane.getByRole('menuitem',{name:'从历史分叉',exact:true})).toHaveCount(0);
 await pane.getByRole('menuitem',{name:'重命名',exact:true}).click();
 await pane.getByRole('textbox',{name:'对话名称',exact:true}).fill('Cursor integration verified');
 await pane.getByRole('button',{name:'保存名称',exact:true}).click();
 await expect.poll(async()=>(await app.request('/api/sessions/search')).sessions.find(s=>s.id===created.id)?.name).toBe('Cursor integration verified');
 for(const width of [1440,760]){
  await page.setViewportSize({width,height:1000});
  await page.getByRole('button',{name:'项目',exact:true}).click();
  await page.getByRole('button',{name:'对话',exact:true}).click();
  await expect(editor()).toBeVisible();
  if(process.env.YOLU_TEST_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR,`${entry}-cursor-conversation-${width}.png`)});
 }
});
