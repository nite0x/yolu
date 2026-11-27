import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

for (const entry of ['browser', 'desktop-chrome']) {
  test(`${entry} opens saved conversations while provider discovery is pending`, {timeout:45000}, async t => {
    assert(process.env.YOLU_TEST_BINARY, 'Set YOLU_TEST_BINARY to the built Go executable.');
    const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY));
    t.after(() => app.close());
    const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
    t.after(() => browser.close());
    const context = await browser.newContext({viewport:{width:1440,height:900}, locale:'zh-CN'});
    if (entry === 'desktop-chrome') {
      const chrome = await readFile(new URL('../../src-tauri/src/window-chrome.js', import.meta.url), 'utf8');
      await context.addInitScript({content:chrome + '("macos");'});
    }
    const page = await context.newPage();
    const refresh = Promise.withResolvers();
    await page.route(url => url.pathname === '/api/sessions' && !url.searchParams.has('cached'), async route => {
      await refresh.promise;
      await route.continue();
    });
    try {
      await page.goto(app.url);
      const nav = page.frameLocator('iframe.workspace-navigation-frame');
      const first = nav.locator(`[data-conversation-session="${app.sessions[0].id}"]`);
      const reader = page.frameLocator('iframe.workspace-page:visible');
      await expect(first).toBeVisible();
      await expect(page.locator('#page-workspace')).toHaveCount(0);
      await expect(nav.locator('#sessionBrowserList')).toHaveAttribute('aria-busy', 'true');
      await first.click();
      await expect(reader.getByText('First conversation', {exact:true}).first()).toBeVisible();
      await page.getByRole('button', {name:'项目', exact:true}).click();
      await expect(reader.getByText('Browser fixture', {exact:true}).first()).toBeVisible();
      await expect(page.locator('#page-workspace')).toHaveCount(1);
      await first.click();
      await expect(reader.getByText('First conversation', {exact:true}).first()).toBeVisible();
      refresh.resolve();
      await expect(nav.locator('#sessionBrowserList')).toHaveAttribute('aria-busy', 'false');
      await expect(first).toBeVisible();
    } finally {
      refresh.resolve();
    }
  });
}
