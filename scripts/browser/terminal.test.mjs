import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, readFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

for (const entry of ['browser', 'desktop-chrome']) test(`${entry} terminal sends real PTY input before and after reconnect`, {timeout:90000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Build frontend assets and Go, then set YOLU_TEST_BINARY.');
  // System temp directories are intentionally absent from creation inventories.
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let output = '';
  const sizes = [];
  page.on('websocket', socket => {
    socket.on('framereceived', ({payload}) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'output') output += Buffer.from(message.data, 'base64').toString();
    });
    socket.on('framesent', ({payload}) => {
      const message = JSON.parse(String(payload));
      if (message.type === 'resize') sizes.push(message);
    });
  });
  await page.goto(app.url);
  await page.getByRole('button', {name:'新建对话',exact:true}).click();
  const frame = page.frameLocator('iframe.workspace-page:visible');
  await frame.getByRole('button', {name:'终端',exact:true}).click();
  await frame.locator('[data-terminal-profile="shell"]').click();
  await expect(frame.locator('.xterm')).toBeVisible();
  await expect(frame.locator('#terminalStatus')).toHaveText('已连接');
  const input = frame.locator('.xterm-helper-textarea');
  async function expectRendered(marker) {
    await frame.locator('#openTerminalSearch').click();
    await frame.locator('#terminalSearch').fill(marker);
    await frame.locator('#terminalSearch').press('Enter');
    // Use the real search + copy integration to read the selected display
    // content. Received WS bytes alone cannot prove xterm parsed the output.
    await expect.poll(() => frame.locator('.xterm').evaluate(node => {
      const clipboard = new DataTransfer();
      node.dispatchEvent(new ClipboardEvent('copy', {bubbles:true,clipboardData:clipboard}));
      return clipboard.getData('text/plain');
    })).toBe(marker);
    await frame.locator('#closeTerminalSearch').click();
  }
  // Octal input ensures observing the command echo cannot satisfy the output
  // assertion; only the shell executing printf produces the literal marker.
  await input.pressSequentially("printf '\\131\\117\\114\\125\\137\\117\\113\\012'");
  await input.press('Enter');
  await expect.poll(() => output).toContain('YOLU_OK');
  await expectRendered('YOLU_OK');
  const reconnected = page.waitForEvent('websocket', {predicate:socket => socket.url().includes('/terminal-stream/')});
  await frame.locator('#reconnectTerminal').click();
  await reconnected;
  await expect(frame.locator('#terminalStatus')).toHaveText('已连接');
  await input.pressSequentially("printf '\\131\\117\\114\\125\\137\\101\\106\\124\\105\\122\\012'");
  await input.press('Enter');
  await expect.poll(() => output).toContain('YOLU_AFTER');
  await expectRendered('YOLU_AFTER');
  await expect.poll(() => sizes.length).toBeGreaterThan(0);
  const wideColumns = sizes.at(-1).cols;
  for (const width of [1440, 760]) {
    await page.setViewportSize({width,height:900});
    await expect(frame.locator('.xterm')).toBeVisible();
    if (process.env.YOLU_TEST_ARTIFACT_DIR) {
      await mkdir(process.env.YOLU_TEST_ARTIFACT_DIR, {recursive:true});
      await page.screenshot({path:path.join(process.env.YOLU_TEST_ARTIFACT_DIR, `${entry}-terminal-${width}.png`)});
    }
  }
  await expect.poll(() => sizes.at(-1)?.cols).toBeLessThan(wideColumns);
  assert.deepEqual(errors, []);
});
