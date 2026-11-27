import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, run, targets } from '../desktop-lib.mjs';
import { checkEngramCore, protocolVersion } from './compatibility.mjs';

const upstream = JSON.parse(readFileSync(new URL('./upstream.json', import.meta.url), 'utf8'));
const modulePath = 'github.com/Gentleman-Programming/engram/v3';
const buildArgs = ['-mod=readonly', '-tags=yolu_engram_core'];
const corePackage = './cmd/engram-core';

function checkoutSource(directory) {
  if (upstream.repository !== 'https://github.com/Gentleman-Programming/engram.git' ||
    !/^v[\d.a-z-]+$/i.test(upstream.tag) || !/^[\da-f]{40}$/.test(upstream.commit)) {
    throw new Error('Invalid Engram upstream source lock');
  }
  const options = { cwd: directory };
  run('git', ['init', '--quiet'], options);
  run('git', ['fetch', '--quiet', '--no-tags', '--depth=1', upstream.repository, `refs/tags/${upstream.tag}`], options);
  const sha = run('git', ['rev-parse', 'FETCH_HEAD^{commit}'], options);
  if (sha !== upstream.commit) throw new Error(`Engram ${upstream.tag} resolved to ${sha}, expected ${upstream.commit}`);
  run('git', ['checkout', '--quiet', '--detach', sha], options);
}

function writeCoreNotices(source, dependencyRows, destination) {
  const sections = [`Engram Core built from Engram ${upstream.tag}\n${upstream.repository}\nCommit: ${upstream.commit}\n`,
    readFileSync(path.join(source, 'LICENSE'), 'utf8')];
  for (const row of [...new Set(dependencyRows)].sort()) {
    const [name, version, directory] = row.split('|');
    const names = readdirSync(directory, { withFileTypes: true })
      .filter(file => file.isFile() && /^(licen[cs]e|copying|copyright|notice|unlicense)([._-]|$)/i.test(file.name))
      .map(file => file.name).sort();
    if (!names.length) throw new Error(`No license text found for Engram dependency ${name} ${version}`);
    sections.push(`\n${'='.repeat(72)}\n${name} ${version}\n`);
    for (const name of names) sections.push(`\n--- ${name} ---\n${readFileSync(path.join(directory, name), 'utf8')}`);
  }
  writeFileSync(destination, sections.join('\n'));
}

function buildCore(stage, triple, target) {
  const source = path.join(stage, 'source');
  mkdirSync(source);
  try {
    checkoutSource(source);
    const adapter = path.join(source, 'cmd', 'engram-core');
    mkdirSync(adapter);
    copyFileSync(fileURLToPath(new URL('./main.go', import.meta.url)), path.join(adapter, 'main.go'));
    const goos = target.platform === 'win32' ? 'windows' : target.platform;
    const options = { cwd: source, env: { ...process.env, GOWORK: 'off', GOOS: goos, GOARCH: target.goarch, CGO_ENABLED: '0' } };
    const rows = run('go', ['list', ...buildArgs, '-deps', '-f', '{{.ImportPath}}|{{with .Module}}{{if not .Main}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}{{end}}', corePackage], options);
    const dependencyRows = [];
    for (const row of rows.split('\n')) {
      const split = row.indexOf('|');
      const name = row.slice(0, split);
      const localPackage = name.startsWith(`${modulePath}/`) ? name.slice(modulePath.length + 1) : '';
      if (/^(cmd\/engram|internal\/(mcp|server|tui))(\/|$)/.test(localPackage)) {
        throw new Error(`Engram Core links an unexpected Engram package: ${name}`);
      }
      if (row.slice(split + 1)) dependencyRows.push(row.slice(split + 1));
    }
    const binary = path.join(stage, `engram-core-${triple}${goos === 'windows' ? '.exe' : ''}`);
    run('go', ['build', ...buildArgs, '-trimpath', '-ldflags', `-s -w -X main.upstreamVersion=${upstream.tag}`, '-o', binary, corePackage], options);
    if (goos !== 'windows') chmodSync(binary, 0o755);
    writeCoreNotices(source, dependencyRows, path.join(stage, 'ENGRAM-CORE-NOTICES.txt'));
    return binary;
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
}

export function withEngramCore(triple, bundle) {
  const target = targets[triple];
  if (!target) throw new Error(`Unsupported desktop target: ${triple}`);
  const stagingRoot = path.join(root, 'src-tauri', 'binaries');
  mkdirSync(stagingRoot, { recursive: true });
  const stage = mkdtempSync(path.join(stagingRoot, '.engram-core-'));
  try {
    const binary = buildCore(stage, triple, target);
    checkEngramCore(binary, upstream.tag, stage);
    console.log(`Verified Engram Core ${upstream.tag} compatibility for ${triple}`);
    const base = JSON.parse(readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const sourcePath = path.relative(path.join(root, 'src-tauri'), stage).split(path.sep).join('/');
    return bundle({
      config: { bundle: {
        externalBin: [...base.bundle.externalBin, `${sourcePath}/engram-core`],
        resources: { [`${sourcePath}/ENGRAM-CORE-NOTICES.txt`]: 'notices/ENGRAM-CORE-NOTICES.txt' },
      } },
      manifest: { upstream_tag: upstream.tag, upstream_commit: upstream.commit, protocol: protocolVersion },
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function buildDesktopWithEngram(triple, args, options = {}) {
  const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const cargoIndex = args.indexOf('--');
  const tauriArgs = cargoIndex === -1 ? args : args.slice(0, cargoIndex);
  const cargoArgs = cargoIndex === -1 ? [] : args.slice(cargoIndex);
  return withEngramCore(triple, ({ config, manifest }) => {
    run(process.execPath, [cli, 'build', ...tauriArgs, '--config', JSON.stringify(config), ...cargoArgs], {
      stdio: 'inherit', ...options,
    });
    return manifest;
  });
}
