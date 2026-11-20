import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const master = path.join(root, 'web/yolu.svg');

function exportIcons(source, output) {
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', source, '--output', output,
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon export exited with ${result.status}`);
}

const temporary = mkdtempSync(path.join(os.tmpdir(), 'yolu-icons-'));
try {
  exportIcons(master, temporary);

  // Center 832 px of artwork on the 1024 px canvas to match the macOS launcher grid.
  const macSource = path.join(temporary, 'yolu-macos.svg');
  const macOutput = path.join(temporary, 'macos');
  writeFileSync(macSource, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(96 96) scale(0.8125)">
${readFileSync(master, 'utf8').trim()}
  </g>
</svg>`);
  exportIcons(macSource, macOutput);

  for (const name of ['icon.png', 'icon.ico']) {
    cpSync(path.join(temporary, name), path.join(root, 'src-tauri/icons', name));
  }
  cpSync(path.join(macOutput, 'icon.icns'), path.join(root, 'src-tauri/icons/icon.icns'));
  cpSync(path.join(temporary, 'icon.png'), path.join(root, 'web/yolu.png'));
  cpSync(path.join(temporary, 'icon.ico'), path.join(root, 'web/yolu.ico'));
  cpSync(master, path.join(root, 'desktop/yolu.svg'));
  console.log('Exported Yolu web, Windows, macOS and Linux icons from web/yolu.svg');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
