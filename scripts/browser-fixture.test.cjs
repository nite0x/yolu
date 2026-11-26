const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {protocol} = require('./fixtures/desktop-codex.cjs');

test('provider snapshot readers see complete JSON even during a write truncation interval', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yolu-fixture-atomic-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const file = path.join(directory, 'provider.json');
  const log = path.join(directory, 'rpc.log');
  fs.writeFileSync(file, JSON.stringify({log,sessions:[{id:'one',name:'Before'}]}));
  const write = fs.writeFileSync;
  const observed = [];
  // Deterministically interleave a CLI read after the writer opens/truncates
  // its output, before any JSON bytes are written. The live path stays valid.
  t.mock.method(fs, 'writeFileSync', (target, contents, options) => {
    // appendFileSync may delegate through this method too; preserve unrelated
    // RPC log writes and interleave only the provider-state publication.
    if (target === log) return write(target, contents, options);
    const descriptor = fs.openSync(target, 'w');
    try {
      observed.push(JSON.parse(fs.readFileSync(file, 'utf8')).sessions[0].name);
      write(descriptor, contents, options);
    } finally {fs.closeSync(descriptor);}
  });
  const responses = [];
  protocol(file)({id:1,method:'thread/name/set',params:{threadId:'one',name:'After'}}, response => responses.push(response));
  assert.deepEqual(observed, ['Before']);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions[0].name, 'After');
  assert.deepEqual(responses, [{id:1,result:{}}]);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['provider.json','rpc.log']);
});
