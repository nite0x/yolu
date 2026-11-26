import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkBundleBudgets} from './bundle-budget.mjs';

const policy = {assets:[{path:'main.js',bytes:100,gzip_bytes:50}],critical:['main.js'],critical_gzip_bytes:45};
test('bundle limits catch raw, compressed and aggregate growth', () => {
  const result = checkBundleBudgets({files:[{path:'main.js',bytes:101,gzip_bytes:51}]}, policy);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join('\n'), /Critical JavaScript/);
});
test('renaming or removing an entry cannot bypass its budget', () => {
  assert.match(checkBundleBudgets({files:[]}, policy).errors.join('\n'), /Missing budgeted asset/);
});
test('invalid sizes fail while lazy assets do not count as critical transfers', () => {
  const valid = {files:[{path:'main.js',bytes:90,gzip_bytes:40},{path:'lazy.js',bytes:9999,gzip_bytes:9999}]};
  assert.equal(checkBundleBudgets(valid, policy).errors.length, 0);
  assert.match(checkBundleBudgets({files:[{path:'main.js',bytes:-1,gzip_bytes:40}]}, policy).errors[0], /invalid bytes/);
});
