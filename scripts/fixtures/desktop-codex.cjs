// Deterministic Codex boundary fixture. The desktop workflow uses real Git,
// SQLite, HTTP and UI without touching the user's Codex data or making a model request.
const fs = require('node:fs');
const readline = require('node:readline');

function protocol(fixtureFile) {
  const read = () => JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  let nextThread = 0;
  let nextTurn = 0;
  const requests = new Map();
  return (request, send) => {
    if (request.id === undefined) return;
    const data = read();
    if (!request.method && requests.has(request.id)) {
      const pending = requests.get(request.id);
      requests.delete(request.id);
      fs.appendFileSync(data.log, JSON.stringify({ permissionReply: request.result }) + '\n');
      send({ method: 'serverRequest/resolved', params: { threadId: pending.threadId, requestId: request.id } });
      pending.complete();
      return;
    }
    const params = request.params || {};
    fs.appendFileSync(data.log, JSON.stringify({ rpc: request.method, params }) + '\n');
    const session = () => data.sessions.find(s => s.id === params.threadId);
    let result;
    switch (request.method) {
      case 'initialize': result = { userAgent: 'Yolu isolated verification' }; break;
      case 'config/read': result = { config: {} }; break;
      case 'model/list': result = { data: [], nextCursor: null }; break;
      case 'collaborationMode/list': result = { data: [] }; break;
      case 'account/read': result = { account: null, requiresOpenaiAuth: false }; break;
      case 'account/rateLimits/read': result = { rateLimits: null }; break;
      case 'thread/list': {
        const directories = Array.isArray(params.cwd) ? params.cwd : params.cwd ? [params.cwd] : [];
        result = { data: data.sessions.filter(s => !directories.length || directories.includes(s.cwd)), nextCursor: null };
        break;
      }
      case 'thread/start': {
        const now = Math.floor(Date.now() / 1000);
        const thread = { id: 'desktop-fixture-' + ++nextThread, cwd: params.cwd, name: '', preview: '', createdAt: now, updatedAt: now, status: { type: 'idle' } };
        if (!params.ephemeral) {
          data.sessions.push(thread);
          fs.writeFileSync(fixtureFile, JSON.stringify(data));
        }
        result = { thread, cwd: params.cwd, activePermissionProfile: params.permissions ? { id: params.permissions } : undefined };
        break;
      }
      case 'thread/resume': result = { thread: session(), cwd: params.cwd || session()?.cwd, activePermissionProfile: params.permissions ? { id: params.permissions } : undefined }; break;
      case 'thread/read': result = { thread: session() }; break;
      case 'thread/name/set': {
        if (session()) session().name = params.name;
        fs.writeFileSync(fixtureFile, JSON.stringify(data));
        result = {};
        break;
      }
      case 'thread/unsubscribe':
        result = {};
        break;
      case 'thread/turns/list': {
        result = { data: data.turns?.[params.threadId] || [], nextCursor: null };
        break;
      }
      case 'turn/start': {
        const id = 'fixture-turn-' + ++nextTurn;
        const threadId = params.threadId;
        const turn = { id, status: 'inProgress', items: [] };
        const titleRequest = !!params.outputSchema?.properties?.title;
        const text = String(params.input?.[0]?.text || '');
        const title = titleRequest ? String(JSON.parse(text.split('\n').at(-1)).user).split(/\s+/).slice(0, 4).join(' ').slice(0, 28) : '';
        const statusReply = text.includes('[assistant-status]') && data.assistantLink;
        const reply = { id: id + '-reply', type: 'agentMessage', text: titleRequest ? JSON.stringify({ title })
          : statusReply ? `[Open fixture worktree](${data.assistantLink})` : 'Reviewed the selected directory.' };
        result = { turn };
        const complete = () => {
          const user = { id: id + '-user', type: 'userMessage', content: params.input || [] };
          if (!titleRequest) {
            const snapshot = read();
            snapshot.turns ??= {};
            snapshot.turns[threadId] ??= [];
            snapshot.turns[threadId].push({ ...turn, status: 'completed', items: [user, reply] });
            fs.writeFileSync(fixtureFile, JSON.stringify(snapshot));
          }
          send({ method: 'item/completed', params: { threadId, turnId: id, item: reply } });
          send({ method: 'turn/completed', params: { threadId, turn: { ...turn, status: 'completed' } } });
        };
        setTimeout(() => {
          send({ method: 'turn/started', params: { threadId, turn } });
          if (!titleRequest && text.includes('[request-directory]')) {
            const approvalID = 'directory-' + id;
            requests.set(approvalID, { threadId, complete });
            send({ id: approvalID, method: 'item/permissions/requestApproval', params: {
              threadId, turnId: id, reason: 'Read the shared design notes',
              permissions: { fileSystem: { read: [read().requestDirectory] } },
            } });
          } else if (!titleRequest && text.includes('[hold]')) {
            const finish = dataDirectory => {
              if (fs.existsSync(dataDirectory + '.release')) complete();
              else setTimeout(() => finish(dataDirectory), 60).unref();
            };
            finish(fixtureFile);
          } else complete();
        }, 25).unref();
        break;
      }
      default:
        send({ id: request.id, error: { code: -32601, message: 'Unsupported fixture method: ' + request.method } });
        return;
    }
    send({ id: request.id, result });
  };
}

module.exports = { protocol };

if (require.main === module) {
  const fixtureFile = process.argv[2];
  const args = process.argv.slice(3);
  if (args[0] === '--version') {
    console.log('codex-cli 0.171.0');
  } else if (args[0] === 'app-server' && args[1] === 'daemon') {
    console.log(JSON.stringify({ socketPath: JSON.parse(fs.readFileSync(fixtureFile, 'utf8')).socket }));
  } else if (args[0] === 'app-server') {
    const handle = protocol(fixtureFile);
    readline.createInterface({ input: process.stdin }).on('line', line => {
      handle(JSON.parse(line), response => process.stdout.write(JSON.stringify(response) + '\n'));
    });
  } else {
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
    fs.appendFileSync(fixture.log, JSON.stringify({ cli: args, cwd: process.cwd() }) + '\n');
    console.log('WORK_HUB_MACOS_TEST_CLI · isolated fixture, no model request');
    console.log('cwd: ' + process.cwd());
  }
}
