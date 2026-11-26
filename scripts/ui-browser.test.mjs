import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'vite';

test('shared component catalog supports validation, pending actions, keyboard dialogs and accessible themes', {timeout:60000}, async t => {
  const server = await createServer({configFile:'vite.ui.config.mts', server:{open:false, port:0}});
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:1280,height:1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}frontend/dev/`);
  await page.getByRole('button', {name:'Validate form', exact:true}).click();
  const path = page.getByRole('textbox', {name:'Repository path', exact:true});
  await expect(path).toHaveAttribute('aria-invalid', 'true');
  await expect(path).toHaveAccessibleDescription('Enter an absolute repository path. Use an absolute path starting with /.');
  await page.getByRole('button', {name:'Choose directory', exact:true}).click();
  await expect(path).toHaveValue('/workspace/example');
  await expect(path).not.toHaveAttribute('aria-invalid');
  await page.getByRole('button', {name:'Save example', exact:true}).click();
  await expect(page.getByRole('button', {name:'Saving…', exact:true})).toBeDisabled();
  await page.getByRole('button', {name:'Reset pending', exact:true}).click();
  await expect(page.getByRole('button', {name:'Save example', exact:true})).toBeEnabled();
  const trigger = page.getByRole('button', {name:'Open example dialog', exact:true});
  await trigger.click();
  await expect(page.getByRole('dialog', {name:'Example dialog', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Close example dialog', exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const help = page.getByRole('button', {name:/Environment/});
  await help.focus();
  await expect(page.getByRole('tooltip').filter({hasText:'The operation runs in this environment.'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  for (const dark of [false, true]) {
    if (dark) await page.getByRole('button', {name:'Dark appearance', exact:true}).click();
    for (const width of [1280, 390]) {
      await page.setViewportSize({width,height:1000});
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', dark ? 'dark' : 'light');
      // Audit the requested appearance after finite color/layout transitions
      // settle. Infinite loading indicators remain running and are still audited.
      await page.evaluate(async () => {
        const transitions = document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity);
        await Promise.all(transitions.map(animation => animation.finished.catch(() => {})));
      });
      const accessibility = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      assert.deepEqual(accessibility.violations.map(({id, nodes}) => ({id, targets:nodes.map(node => node.target)})), [], `${dark ? 'dark' : 'light'} ${width}px accessibility`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  assert.deepEqual(errors, []);
});
