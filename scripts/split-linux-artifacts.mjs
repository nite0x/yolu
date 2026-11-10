import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeChecksums } from './desktop-lib.mjs';

export function splitLinuxArtifacts(source, destination) {
  const manifest = JSON.parse(readFileSync(path.join(source, 'release.json'), 'utf8'));
  for (const format of ['deb', 'AppImage']) {
    const files = manifest.files.filter(file => !/\.(deb|AppImage)$/.test(file.name) || file.name.endsWith(`.${format}`));
    if (files.filter(file => file.name.endsWith(`.${format}`)).length !== 1) {
      throw new Error(`Expected one ${format} installer`);
    }
    const output = path.join(destination, format.toLowerCase());
    mkdirSync(output, { recursive: true });
    for (const file of files) cpSync(path.join(source, file.name), path.join(output, file.name));
    const names = files.map(file => file.name);
    writeFileSync(path.join(output, 'release.json'), JSON.stringify({ ...manifest, files: writeChecksums(output, names) }, null, 2) + '\n');
    writeChecksums(output, [...names, 'release.json']);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  splitLinuxArtifacts(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
}
