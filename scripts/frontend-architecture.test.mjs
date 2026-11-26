import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {checkFrontendArchitecture, importSpecifiers} from './frontend-architecture.mjs';

const rules = JSON.parse(await readFile(new URL('../frontend/architecture.json', import.meta.url), 'utf8'));
async function fixture(t, sources, policy = rules) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yolu-module-check-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  for (const [file, source] of Object.entries(sources)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive:true});
    await writeFile(path.join(root, file), source);
  }
  return checkFrontendArchitecture(root, policy);
}

test('imports include multiline type dependencies and lazy imports without reading comments or examples', () => {
  const source = `// import x from '@/features/ignored'
    const example = "import {x} from '@/features/ignored'";
    /* import '@/app/ignored' */
    import type {A,
      B} from '@/entities/model'
    export {value} from './value'
    type Item = import('./type').Item
    const lazy = import('./lazy')
    import './style.css'`;
  assert.deepEqual(importSpecifiers(source), ['@/entities/model', './value', './type', './lazy', './style.css']);
});

test('shared code cannot depend on a feature, including through CSS or type-only imports', async t => {
  const result = await fixture(t, {
    'features/files/model/file.ts':'export interface File {}',
    'features/files/ui/style.css':'.file {}',
    'shared/types.ts':`import type {File} from '@/features/files/model/file'`,
    'shared/style.css':`@import '../features/files/ui/style.css';`,
  });
  assert.equal(result.errors.length, 2);
  assert(result.errors.every(error => error.includes('shared must not import')));
});

test('features cannot import application composition or their own rendered UI into model code', async t => {
  const result = await fixture(t, {
    'app/shell.ts':'export const shell = {}',
    'features/files/ui/view.tsx':'export const view = {}',
    'features/files/model/file.ts':`import {shell} from '@/app/shell'; import {view} from '../ui/view'`,
  });
  assert.equal(result.errors.length, 2);
});

test('explicit file-browser integration is allowed while feature internals stay private', async t => {
  const result = await fixture(t, {
    'features/files/ui/browser.tsx':'export const mountFileBrowser = () => {}',
    'features/files/runtime/private.ts':'export const privateValue = {}',
    'features/conversations/list/files.ts':`import {mountFileBrowser} from '@/features/files/ui/browser'`,
    'features/projects/ui/page.tsx':`import {privateValue} from '@/features/files/runtime/private'`,
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /projects.*not an allowed feature integration/);
});

test('module cycles are rejected even if every individual integration is declared', async t => {
  const policy = {...rules, features:{files:{git:['model.ts']}, git:{files:['model.ts']}}};
  const result = await fixture(t, {
    'features/files/model.ts':`export {git} from '@/features/git/model'`,
    'features/git/model.ts':`export {file} from '@/features/files/model'`,
  }, policy);
  assert.match(result.errors.join('\n'), /Feature cycle: files -> git -> files/);
});
