import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'yolu-icons-'));
try {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon',
    path.join(root, 'web/yolu.svg'), '--output', temporary,
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon export exited with ${result.status}`);
  for (const name of ['icon.png', 'icon.ico', 'icon.icns']) {
    cpSync(path.join(temporary, name), path.join(root, 'src-tauri/icons', name));
  }
  cpSync(path.join(temporary, 'icon.png'), path.join(root, 'web/yolu.png'));
  cpSync(path.join(temporary, 'icon.ico'), path.join(root, 'web/yolu.ico'));
  cpSync(path.join(root, 'web/yolu.svg'), path.join(root, 'desktop/yolu.svg'));
  console.log('Exported Yolu web, Windows, macOS and Linux icons from web/yolu.svg');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
