import path from 'node:path';
import { root, run } from './desktop-lib.mjs';
import { buildDesktopWithEngram } from './engram-core/build.mjs';

const args = process.argv.slice(2);
const cargoIndex = args.indexOf('--');
const flags = cargoIndex === -1 ? args : args.slice(0, cargoIndex);
if (flags.some(flag => ['--help', '-h', '--version', '-V', '--no-bundle'].includes(flag))) {
  const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  run(process.execPath, [cli, 'build', ...args], { stdio: 'inherit' });
} else {
  const index = flags.findIndex(flag => flag === '--target' || flag === '-t' || flag.startsWith('--target='));
  const target = index === -1
    ? run('rustc', ['--print', 'host-tuple'])
    : flags[index].startsWith('--target=') ? flags[index].slice('--target='.length) : flags[index + 1];
  if (!target || target.startsWith('-')) throw new Error('--target requires a triple');
  buildDesktopWithEngram(target, args);
}
