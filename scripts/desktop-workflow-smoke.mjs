import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import codexFixture from './fixtures/desktop-codex.cjs';

const execute = promisify(execFile);
const binary = path.resolve(process.argv[2]);
const keep = process.argv.includes('--keep');
const directory = await realpath(await mkdtemp(path.join('/tmp', 'yolu-workflow-')));
const data = path.join(directory, "数据 ' & spaces");
const worktreeRoot = path.join(directory, "Worktrees ' & spaces");
const bin = path.join(directory, 'tools');
const fixtureHome = path.join(directory, 'home');
const fixtureFile = path.join(directory, 'codex-fixture.json');
const log = path.join(directory, 'codex-calls.jsonl');
const shellQuote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
await mkdir(bin);
await mkdir(fixtureHome);
const fixtureScript = fileURLToPath(new URL('fixtures/desktop-codex.cjs', import.meta.url));
await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nexec ' + [process.execPath, fixtureScript, fixtureFile].map(shellQuote).join(' ') + ' "$@"\n', { mode: 0o700 });
const env = { ...process.env, HOME: fixtureHome, PATH: bin + path.delimiter + '/usr/bin:/bin', CODEX_HOME: path.join(directory, 'codex-home'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const socket = path.join(directory, 's');
await writeFile(fixtureFile, JSON.stringify({ sessions: [], items: [], log, socket }));
const server = createServer();
const daemon = new WebSocketServer({ server });
const handle = codexFixture.protocol(fixtureFile);
daemon.on('connection', client => client.on('message', raw => {
  handle(JSON.parse(raw.toString()), response => {
    if (client.readyState === 1) client.send(JSON.stringify(response));
  });
}));
await new Promise((resolve, reject) => server.once('error', reject).listen(socket, resolve));
const run = (file, args, extra = {}) => execute(file, args, { env, timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...extra });
const git = async (cwd, ...args) => (await run('/usr/bin/git', ['-C', cwd, ...args])).stdout.trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let running = false;
try {
  const startBackend = async () => JSON.parse((await run(binary, ['--desktop-start', '--data', data, '--root', worktreeRoot])).stdout);
  let host = await startBackend();
  running = true;
  const descriptor = JSON.parse(await readFile(path.join(data, 'service.json'), 'utf8'));
  assert.equal(descriptor.read_only_sessions, false);
  const page = await (await fetch(host.url)).text();
  assert.match(page, /<title>Yolu<\/title>/);
  assert.match(page, /href="\/yolu.svg"/);
  for (const extension of ['svg', 'png', 'ico']) {
    const icon = await fetch(host.url + '/yolu.' + extension);
    assert.equal(icon.status, 200);
    assert((await icon.arrayBuffer()).byteLength > 100);
  }
  assert.match(page, /name="session-mode" content="interactive"/);
  assert.match(page, /id="workspacePages"/);
  assert.match(page, /src="\/core\/page-host.js"/);
  const workPage = await (await fetch(host.url + '/?app-page=workflow-verification')).text();
  assert.match(workPage, /name="session-mode" content="interactive"/);
  assert.match(workPage, /src="\/features\/sessions\/session-create.js"/);
  const headers = { 'X-CSRF-Token': descriptor.token, 'Content-Type': 'application/json' };
  const request = async (endpoint, method = 'GET', body, expected = 200) => {
    const response = await fetch(host.url + endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}`);
    return result;
  };
  const environment = await request('/api/environments');
  assert.equal(environment.platform, process.platform === 'darwin' ? 'darwin' : process.platform);
  if (process.platform === 'darwin') assert.equal(environment.wsl_supported, false);
  const projects = [];
  for (const name of ["前端 ' & spaces", '后端项目']) {
    const seed = path.join(directory, 'seed-' + projects.length);
    const remote = path.join(directory, 'remote-' + projects.length + '.git');
    const repository = path.join(directory, name);
    await mkdir(seed);
    await git(seed, 'init', '-b', 'master');
    await git(seed, 'config', 'user.name', 'Yolu Verification');
    await git(seed, 'config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(seed, 'README.md'), name + '\n');
    await git(seed, 'add', '.'); await git(seed, 'commit', '-m', 'baseline');
    await git(directory, 'clone', '--bare', seed, remote);
    await git(directory, 'clone', remote, repository);
    const project = await request('/api/projects', 'POST', { name, path: repository }, 201);
    projects.push({ id: project.id, name, repository, seed, remote });
  }
  const projectEndpoint = id => '/api/projects/' + id;
  const prepare = (id, slug, mode = 'new', branch = undefined) =>
    request(projectEndpoint(id) + '/worktrees', 'POST', { slug, mode, branch, source: 'refs/heads/master' }, 201);
  const projectsTrees = await Promise.all(projects.map(project => prepare(project.id, 'parallel')));
  for (const tree of projectsTrees) {
    assert(tree.path.startsWith(worktreeRoot + path.sep));
    assert.equal(await git(tree.path, 'branch', '--show-current'), tree.branch);
  }
  const primary = projectsTrees[0].path;
  const baseline = await git(primary, 'rev-parse', 'HEAD');
  const project = projects[0];
  await writeFile(path.join(project.seed, 'remote-update.txt'), 'fast forward\n');
  await git(project.seed, 'add', '.'); await git(project.seed, 'commit', '-m', 'remote update');
  await git(project.seed, 'push', project.remote, 'master');
  const action = (body, expected = 200) => request('/api/projects/' + project.id + '/git', 'POST', body, expected);
  await action({ action: 'fetch', remote: 'origin' });
  await action({ action: 'pull', path: project.repository });
  assert.equal(await git(project.repository, 'rev-parse', 'HEAD'), await git(project.seed, 'rev-parse', 'HEAD'));
  assert.equal(await git(primary, 'rev-parse', 'HEAD'), baseline);
  await action({ action: 'create_branch', name: 'codex/git-verification', source: 'refs/heads/master' });
  await action({ action: 'switch', source: 'refs/heads/codex/git-verification', path: project.repository });
  await writeFile(path.join(project.repository, 'uncommitted.txt'), 'keep me\n');
  await action({ action: 'switch', source: 'refs/heads/master', path: project.repository }, 409);
  await rm(path.join(project.repository, 'uncommitted.txt'));
  await action({ action: 'switch', source: 'refs/heads/master', path: project.repository });
  await writeFile(path.join(primary, '本地修改.txt'), 'visible in the worktree\n');
  await request('/api/state?refresh=1');
  let state;
  for (let attempt = 0; attempt < 50; attempt++) {
    state = await request('/api/state');
    const tree = state.projects.find(p => p.id === project.id)?.worktrees.find(t => t.path === primary);
    if (tree?.dirty && !tree.refreshing) break;
    await pause(100);
  }
  assert(state.projects.find(p => p.id === project.id).worktrees.find(t => t.path === primary).dirty > 0);
  if (process.platform === 'darwin') {
    assert.equal(state.terminal.settings.kind, 'macos-terminal');
    assert.equal(state.terminal.available, true);
    assert.equal(state.terminal.codex, true); // discovered from minimal GUI-like PATH.
    assert(!state.terminal.supported_kinds.includes('powershell'));
    await request('/api/settings/terminal', 'PUT', { kind: 'macos-terminal' });
  }
  const secondary = projectsTrees[1];
  const binding = { project_id: projects[1].id, directory: secondary.path, access: 'write' };
  const native = { provider: 'codex', project_id: projects[0].id, cwd: primary };
  const first = await request('/api/sessions/new', 'POST', {
    ...native, request_id: 'first', text: 'Review the changes in the selected repository.',
  }, 202);
  const session = first.session;
  const base = '/api/sessions/' + session.id;
  const waitFor = async (read, complete) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await read();
      if (complete(value)) return value;
      await pause(75);
    }
    assert.fail('Timed out waiting for the development conversation');
  };
  const settledChat = endpoint => waitFor(() => request(endpoint + '/chat'), chat => !chat.busy);
  assert.equal((await settledChat(base)).status, 'completed');
  assert.equal((await request(base + '/bindings')).bindings[0].directory, primary);
  const related = await request('/api/sessions?project_id=' + project.id);
  assert(related.sessions.some(s => s.id === session.id));
  const history = await request(base + '/history');
  assert(history.entries.some(entry => entry.kind === 'assistant' && entry.text.includes('selected directory')));

  const inspected = await request('/api/session-bindings/inspect', 'POST', { session_id: session.id, ...binding });
  assert.equal(inspected.branch, secondary.branch);
  const attached = await request(base + '/bindings', 'POST', binding);
  const attachment = attached.bindings.find(row => row.directory === secondary.path);
  assert.equal(attachment?.access, 'write');
  assert.notEqual(attachment?.role, 'primary');

  const notes = path.join(directory, 'design-notes');
  await mkdir(notes);
  await writeFile(path.join(notes, 'adr.md'), '# Local design notes\n');
  const projectless = await request('/api/sessions/new', 'POST', {
    provider: 'codex', request_id: 'projectless', text: 'Review this task without a checkout.',
  }, 202);
  const plain = '/api/sessions/' + projectless.session.id;
  const defaultDirectory = path.join(data, 'conversation-directories');
  assert(projectless.session.cwd.startsWith(defaultDirectory + path.sep));
  assert.equal((await settledChat(plain)).status, 'completed');
  assert.deepEqual((await request(plain + '/bindings')).bindings, []);
  await request(plain + '/chat', 'POST', { request_id: 'projectless-follow-up', text: 'Continue in the same directory.' }, 202);
  assert.equal((await settledChat(plain)).status, 'completed');
  await request(plain + '/bindings', 'POST', { directory: notes, access: 'read', role: 'primary' });
  assert.equal((await request(plain + '/bindings')).bindings[0].directory, notes);
  assert.equal((await request(base + '/bindings')).bindings.length, 2);

  await request(base + '/chat', 'POST', { request_id: 'follow-up', text: '[hold] Check both directories.' }, 202);
  await waitFor(() => request(base + '/bindings'), context => context.bindings.some(row => row.directory === secondary.path && row.status === 'ready'));
  const conflict = await request('/api/sessions/new', 'POST', {
    provider: 'codex', project_id: projects[1].id, cwd: secondary.path, request_id: 'overlap', text: 'Review this directory.',
  }, 409);
  assert(conflict.conflicts.length > 0);
  assert(conflict.request_id);
  const isolated = await prepare(projects[1].id, 'isolated');
  const parallel = await request('/api/sessions/new', 'POST', {
    provider: 'codex', project_id: projects[1].id, cwd: isolated.path, request_id: 'parallel', text: 'Review the isolated checkout.',
  }, 202);
  assert.equal((await settledChat('/api/sessions/' + parallel.session.id)).status, 'completed');
  await writeFile(fixtureFile + '.release', '');
  assert.equal((await settledChat(base)).status, 'completed');
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const resumed = calls.find(call => call.rpc === 'thread/resume' && call.params.threadId === session.id && call.params.permissions);
  assert(resumed && JSON.stringify(resumed.params.config).includes(secondary.path), 'Codex received the additional directory in its filesystem profile');
  const standalone = calls.find(call => call.rpc === 'thread/resume' && call.params.threadId === projectless.session.id && call.params.permissions);
  assert.equal(standalone?.params.cwd, projectless.session.cwd);
  assert.equal(standalone.params.config.default_permissions, standalone.params.permissions);
  assert.equal(standalone.params.config.permissions[standalone.params.permissions].filesystem[projectless.session.cwd], 'write');
  const fixtureData = JSON.parse(await readFile(fixtureFile, 'utf8'));
  await writeFile(fixtureFile, JSON.stringify({ ...fixtureData, requestDirectory: notes }));
  await request(base + '/chat', 'POST', { request_id: 'native-approval', text: '[request-directory] Read the design notes.' }, 202);
  const waiting = await waitFor(() => request(base + '/chat'), chat => chat.approvals.some(approval => approval.kind === 'project_access'));
  const approval = waiting.approvals.find(approval => approval.kind === 'project_access');
  assert.equal(approval.project_access.directory, notes);
  assert.equal(approval.project_access.access, 'read');
  await request(base + '/chat/approval', 'POST', { run_id: waiting.id, approval_id: approval.id, decision: 'accept' });
  assert.equal((await settledChat(base)).status, 'completed');
  assert((await readFile(log, 'utf8')).includes(JSON.stringify({ permissionReply: { permissions: { fileSystem: { read: [notes] } }, scope: 'turn' } })));
  assert((await request(base + '/bindings')).bindings.some(row => row.directory === notes && row.access === 'read'));

  const finish = await prepare(project.id, 'cleanup-check');
  const changedFile = path.join(finish.path, '改动预览.txt');
  await writeFile(changedFile, 'staged content\n');
  await git(finish.path, 'add', '改动预览.txt');
  await writeFile(changedFile, 'working content\n');
  const changeQuery = new URLSearchParams({ path: finish.path, file: '改动预览.txt' });
  const changeEndpoint = projectEndpoint(project.id) + '/changes?' + changeQuery;
  assert((await request(changeEndpoint + '&mode=working')).text.includes('+working content'));
  assert((await request(changeEndpoint + '&mode=index')).text.includes('+staged content'));
  await git(finish.path, 'reset', '--', '改动预览.txt');
  await rm(changedFile);
  const cleanup = projectEndpoint(project.id) + '/worktree';
  const review = await request(cleanup + '?' + new URLSearchParams({ path: finish.path }));
  assert(review.cleanable, JSON.stringify(review));
  await request(cleanup, 'DELETE', { path: review.path, fingerprint: review.fingerprint });
  await assert.rejects(readFile(path.join(finish.path, '.git')));
  const reused = await prepare(project.id, 'cleanup-check', 'existing', finish.branch);
  assert.equal(reused.path, finish.path);
  const blocked = await request(projectEndpoint(projects[1].id) + '/worktree?' + new URLSearchParams({ path: secondary.path }));
  assert.equal(blocked.cleanable, false);
  await request(base + '/bindings/' + attachment.id, 'DELETE');
  assert.equal((await request(base + '/bindings')).bindings.length, 2);
  await request(base + '/bindings', 'POST', binding);
  assert.equal((await request(base + '/bindings')).bindings.length, 3);
  assert.equal((await fetch(host.url + '/api/workspaces', { headers })).status, 404);
  // The stop command must drain an open reader without waiting for the agent
  // or requiring a pane to disconnect first.
  const shutdownNotes = path.join(directory, 'shutdown-notes');
  await mkdir(shutdownNotes);
  const beforeShutdown = JSON.parse(await readFile(fixtureFile, 'utf8'));
  await writeFile(fixtureFile, JSON.stringify({ ...beforeShutdown, requestDirectory: shutdownNotes }));
  const stopping = await request(base + '/chat', 'POST', { request_id: 'shutdown-stream', text: '[request-directory] Wait for approval.' }, 202);
  await waitFor(() => request(base + '/chat'), chat => chat.approvals.length > 0);
  const stream = await fetch(host.url + base + '/chat/events?' + new URLSearchParams({ run: stopping.id }), {
    headers, signal: AbortSignal.timeout(12000),
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  try {
    const firstFrame = await reader.read();
    assert.equal(firstFrame.done, false);
    assert.match(Buffer.from(firstFrame.value).toString(), /^data: /);
    const startedStopping = performance.now();
    await run(binary, ['--stop', '--data', data]);
    assert(performance.now() - startedStopping < 9000, 'backend waited for the HTTP shutdown deadline');
    while (!(await reader.read()).done) { /* Consume any final frames. */ }
  } finally {
    await reader.cancel();
  }
  host = await startBackend();
  headers['X-CSRF-Token'] = JSON.parse(await readFile(path.join(data, 'service.json'), 'utf8')).token;
  const restored = await request(base + '/bindings');
  assert.deepEqual(new Set(restored.bindings.map(row => row.directory)), new Set([primary, secondary.path, notes]));
  assert.equal(restored.bindings.find(row => row.role === 'primary').branch, projectsTrees[0].branch);
  assert((await request(base + '/history')).entries.find(entry => entry.kind === 'assistant' && entry.text.includes('selected directory')));

  const saved = { directory, data, worktreeRoot, projects, session, primary, url: host.url, pid: host.pid, log };
  await writeFile(path.join(directory, 'test-state.json'), JSON.stringify(saved, null, 2));
  console.log('Workflow passed: project and projectless conversations, directory profiles and native approvals, history and restoration, write conflicts, isolated checkouts, Git previews, protected Worktree removal and active-stream shutdown.');
  if (keep) {
    console.log('Native UI verification state: ' + path.join(directory, 'test-state.json'));
    await new Promise(resolve => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  for (const client of daemon.clients) client.terminate();
  daemon.close();
  await new Promise(resolve => server.close(resolve));
  try {
    if (running) await run(binary, ['--stop', '--data', data]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
