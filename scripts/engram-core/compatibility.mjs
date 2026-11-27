import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export const protocolVersion = 1;

export function checkEngramCore(binary, tag, directory) {
  function invoke(args, input) {
    const result = spawnSync(binary, args, { input, encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Engram Core exited with ${result.status}: ${result.stderr}`);
    return result.stdout.trim();
  }

  function call(dataDir, request) {
    const result = JSON.parse(invoke(['--data-dir', dataDir], JSON.stringify({ version: protocolVersion, ...request })));
    assert.equal(result.version, protocolVersion);
    return result;
  }

  function success(dataDir, request) {
    const result = call(dataDir, request);
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    return result.result;
  }

  assert.equal(invoke(['--version']), `engram-core protocol ${protocolVersion} (Engram ${tag})`);
  const fresh = path.join(directory, 'fresh');
  const save = {
    operation: 'save', project: 'project-one', session_id: 'first-session', operation_id: 'first-save',
    title: 'Cobalt packaging decision', content: 'Keep the engine in a private child process.', type: 'decision',
  };
  const search = { operation: 'search', project: save.project, query: 'cobalt', limit: 5 };
  assert.deepEqual(success(fresh, search).matches, []);
  assert.equal(call(fresh, { ...search, project: '' }).error?.code, 'invalid_request');
  assert.equal(call(fresh, { ...search, all_projects: true }).error?.code, 'invalid_request');

  const saved = success(fresh, save);
  assert(saved.id > 0);
  assert.equal(saved.replayed, false);
  // Each call reopens the store in a new process, including the replay.
  assert.deepEqual(success(fresh, save), { id: saved.id, replayed: true });
  assert.equal(call(fresh, { ...save, content: 'Changed payload' }).error?.code, 'operation_conflict');
  assert.deepEqual(success(fresh, search).matches, [
    { id: saved.id, title: save.title, type: save.type, preview: save.content, truncated: false },
  ]);
  const otherProject = 'project-two';
  assert.deepEqual(success(fresh, { ...search, project: otherProject }).matches, []);
  const other = success(fresh, { ...save, project: otherProject, title: 'Cobalt unrelated decision' });
  assert.notEqual(other.id, saved.id);
  assert.deepEqual(success(fresh, search).matches.map(match => match.id), [saved.id]);

  const legacy = path.join(directory, 'legacy');
  mkdirSync(legacy, { mode: 0o700 });
  const fixture = new URL('./testdata/engram-v3.7.1.db.gz', import.meta.url);
  writeFileSync(path.join(legacy, 'engram.db'), gunzipSync(readFileSync(fixture)), { mode: 0o600 });
  const legacySearch = { ...search, project: 'legacy-project' };
  assert.deepEqual(success(legacy, legacySearch).matches.map(match => match.title), ['Legacy cobalt checkpoint']);
  const added = success(legacy, { ...save, project: legacySearch.project });
  assert.deepEqual(new Set(success(legacy, legacySearch).matches.map(match => match.id)), new Set([1, added.id]));
  assert.notEqual(added.id, 1);
}
