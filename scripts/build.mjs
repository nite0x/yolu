import {createHash} from 'node:crypto';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

// This is the complete embedded application build. Go/desktop callers must use
// this entry so web UI, chat UI and the manifest describe the same source tree.
if (process.argv.includes('--watch')) throw new Error('Use npm run web:watch for incremental application builds.');
await import('./build-frontend.mjs');
await import('./build-chat.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(name);
    else if (/\.(?:js|css|woff2)$/.test(name)) {
      const bytes = await readFile(path.join(root, name));
      files.push({path:name, bytes:bytes.length, gzip_bytes:gzipSync(bytes).length, sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  }
}
await collect('web/ui');
await collect('web/chat');
files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
await writeFile(path.join(root, 'web/ui/build-manifest.json'), JSON.stringify({version:1, files}, null, 2) + '\n');
for (const directory of ['web/ui/', 'web/chat/']) {
  const group = files.filter(file => file.path.startsWith(directory));
  console.log(`${directory}: ${group.length} assets, ${group.reduce((sum, file) => sum + file.bytes, 0)} bytes (${group.reduce((sum, file) => sum + file.gzip_bytes, 0)} gzip)`);
}
