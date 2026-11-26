import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {startBrowserApp} from '../fixtures/browser-app.mjs';

test('diagrams load their renderer and graph modules only when requested under the application CSP', {timeout:60000}, async t => {
  assert(process.env.YOLU_TEST_BINARY, 'Build Go after npm run build and set YOLU_TEST_BINARY.');
  const app = await startBrowserApp(path.resolve(process.env.YOLU_TEST_BINARY));
  t.after(() => app.close());
  const browser = await chromium.launch({headless:true, ...(process.env.YOLU_BROWSER_EXECUTABLE ? {executablePath:process.env.YOLU_BROWSER_EXECUTABLE} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const requests = [], failures = [];
  page.on('request', request => {if (/\/chat\/(?:mermaid\.js|diagrams\/)/.test(request.url())) requests.push(request.url());});
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(app.url);
  await expect(page.getByRole('button', {name:/项目|Projects/,exact:true})).toBeEnabled();
  assert.equal(requests.length, 0);
  const svg = await page.evaluate(async () => {
    const {renderDiagram} = await import('/chat/mermaid.js');
    return renderDiagram('flowchart TD; Start --> Done');
  });
  assert.match(svg, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(svg), /Start/);
  assert(requests.some(url => url.includes('/chat/diagrams/')));
  assert.equal(requests.filter(url => /(?:classDiagram|ganttDiagram|sequenceDiagram)-/.test(url)).length, 0, 'unused graph families stay deferred');
  assert.deepEqual(failures, []);
});
