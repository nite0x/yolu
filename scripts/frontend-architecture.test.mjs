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

test('cycles within a feature and shared infrastructure are rejected', async t => {
  const result = await fixture(t, {
    'features/files/model/a.ts': `import type {B} from './b'`,
    'features/files/model/b.ts': `export type {A} from './a'`,
    'shared/a.ts': `export {b} from './b'`,
    'shared/b.ts': `const a = import('./a')`,
  });
  assert.equal(result.errors.filter(error => error.startsWith('Source cycle:')).length, 2);
  assert.match(result.errors.join('\n'), /features\/files\/model\/a.ts -> features\/files\/model\/b.ts/);
  assert.match(result.errors.join('\n'), /shared\/a.ts -> shared\/b.ts/);
});

test('a converging dependency graph and a literal dynamic import remain valid', async t => {
  const result = await fixture(t, {
    'shared/a.ts': `import './b'; import('./c')`,
    'shared/b.ts': `import './c'`,
    'shared/c.ts': 'export const c = 1',
  });
  assert.deepEqual(result.errors, []);
});

test('relative imports cannot escape the checked source tree', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yolu-escape-check-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const root = path.join(directory, 'frontend');
  await mkdir(path.join(root, 'shared'), {recursive:true});
  await writeFile(path.join(root, 'shared/a.ts'), `import '../../external'`);
  await writeFile(path.join(directory, 'external.ts'), 'export const value = 1');
  const result = await checkFrontendArchitecture(root, rules);
  assert.match(result.errors.join('\n'), /source imports must stay inside frontend/);
});

test('primitives cannot depend on composed shared components', async t => {
  const result = await fixture(t, {
    'shared/ui/primitives/button.tsx':`import {Field} from '../forms/field'`,
    'shared/ui/forms/field.tsx':'export const Field = {}',
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /primitives must not import composed UI/);
});

test('the component catalog stays outside production dependencies and business features', async t => {
  const result = await fixture(t, {
    'shared/ui/forms/field.tsx':'export const Field = {}',
    'features/projects/ui/view.tsx':'export const Project = {}',
    'dev/catalog.tsx':`import {Field} from '@/shared/ui/forms/field'; import {Project} from '@/features/projects/ui/view'`,
    'app/bootstrap.ts':`import '@/dev/catalog'`,
  });
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join('\n'), /dev must not import features/);
  assert.match(result.errors.join('\n'), /app must not import dev/);
});
