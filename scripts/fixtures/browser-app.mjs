import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import fixture from './desktop-codex.cjs';

const execute = promisify(execFile);
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";

// Real HTTP, Git and SQLite with deterministic provider responses. No user
// projects, authentication files or paid model requests are involved.
export async function startBrowserApp(binary, fixtureRoot = os.tmpdir(), paths = {}) {
  const directory = await realpath(await mkdtemp(path.join(fixtureRoot, 'yolu-browser-')));
  const data = paths.data || path.join(directory, 'data');
  const worktrees = paths.worktrees || path.join(directory, 'worktrees');
  const repository = path.join(directory, 'repository');
  const reference = path.join(directory, 'reference');
  const bin = path.join(directory, 'bin');
  const home = path.join(directory, 'home');
  const state = path.join(directory, 'provider.json');
  const log = path.join(directory, 'provider.jsonl');
  for (const dir of [repository, reference, bin, home]) await mkdir(dir);
  const socket = path.join(directory, 's');
  await writeFile(state, JSON.stringify({sessions:[],items:[],log,socket,requestDirectory:reference}));
  const script = fileURLToPath(new URL('./desktop-codex.cjs', import.meta.url));
  await writeFile(path.join(bin, 'codex'), `#!/bin/sh\nexec ${[process.execPath,script,state].map(quote).join(' ')} "$@"\n`, {mode:0o700});
  const cursorScript = fileURLToPath(new URL('./cursor-agent.cjs', import.meta.url));
  await writeFile(path.join(bin, 'cursor-agent'), `#!/bin/sh\nexec ${[process.execPath,cursorScript,path.join(directory,'cursor.json')].map(quote).join(' ')} "$@"\n`, {mode:0o700});
  const env = {...process.env, HOME:home, CODEX_HOME:path.join(home, '.codex'), PATH:`${bin}:/usr/bin:/bin`, GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_SYSTEM:os.devNull,GIT_CONFIG_NOSYSTEM:'1'};
  const run = (file, args) => execute(file, args, {env, timeout:30000, maxBuffer:2*1024*1024});
  const server = createServer();
  const daemon = new WebSocketServer({server});
  const handle = fixture.protocol(state);
  daemon.on('connection', client => client.on('message', raw => handle(JSON.parse(raw), response => {
    if (client.readyState === 1) client.send(JSON.stringify(response));
  })));
  await new Promise((resolve, reject) => server.once('error', reject).listen(socket, resolve));
  let running = false;
  const close = async () => {
    try { if (running) await run(binary, ['--stop','--data',data]); }
    finally {
      for (const client of daemon.clients) client.terminate();
      await new Promise(resolve => server.close(resolve));
      await rm(directory, {recursive:true,force:true});
    }
  };
  try {
    await run('/usr/bin/git', ['-C',repository,'init','-b','main']);
    await run('/usr/bin/git', ['-C',repository,'config','user.name','Yolu Browser Test']);
    await run('/usr/bin/git', ['-C',repository,'config','user.email','fixture@example.invalid']);
    await writeFile(path.join(repository,'README.md'), 'Browser regression fixture\n');
    await run('/usr/bin/git', ['-C',repository,'add','.']);
    await run('/usr/bin/git', ['-C',repository,'commit','-m','Initial fixture']);
    const host = JSON.parse((await run(binary, ['--desktop-start','--data',data,'--root',worktrees])).stdout);
    running = true;
    const descriptor = JSON.parse(await readFile(path.join(data,'service.json'), 'utf8'));
    const request = async (endpoint, method = 'GET', body) => {
      const response = await fetch(host.url + endpoint, {method,headers:{'Content-Type':'application/json','X-CSRF-Token':descriptor.token}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      const value = await response.json();
      if (!response.ok) throw new Error(`${endpoint}: ${JSON.stringify(value)}`);
      return value;
    };
    const project = await request('/api/projects','POST',{name:'Browser fixture',path:repository});
    const fixtureData = JSON.parse(await readFile(state, 'utf8'));
    fixtureData.assistantLink = '#/projects/' + project.id + '?' + new URLSearchParams({environment:'local',directory:repository});
    await writeFile(state, JSON.stringify(fixtureData));
    const sessions = [];
    for (const [index, text] of ['First conversation','Second conversation'].entries()) {
      const result = await request('/api/sessions/new','POST',{project_id:project.id,cwd:repository,request_id:`browser-${index}`,text,allow_shared:true});
      sessions.push(result.session);
    }
    return {url:host.url, request, sessions, project, repository, close, providerLog:() => readFile(log, 'utf8'), release:() => writeFile(state+'.release','1')};
  } catch (error) { await close(); throw error; }
}
