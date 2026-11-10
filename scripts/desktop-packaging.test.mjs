import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { desktopVersion, targets, packagePlan, bundleFiles, writeChecksums, validateReleaseSource, desktopBuildEnvironment } from './desktop-lib.mjs';
import { splitLinuxArtifacts } from './split-linux-artifacts.mjs';

test('empty macOS CI secrets use ad-hoc signing without requesting notarization', () => {
  const env = { APPLE_SIGNING_IDENTITY: '', APPLE_ID: '', APPLE_PASSWORD: '', APPLE_TEAM_ID: '', PATH: '/bin' };
  const plan = packagePlan([], 'aarch64-apple-darwin', env);
  assert.deepEqual(desktopBuildEnvironment(plan, env), { APPLE_SIGNING_IDENTITY: '-', PATH: '/bin' });
  assert.equal(env.APPLE_SIGNING_IDENTITY, '');
  const signed = { APPLE_SIGNING_IDENTITY: 'Developer ID Application: Test', APPLE_ID: 'test@example.com', APPLE_PASSWORD: 'fixture', APPLE_TEAM_ID: 'fixture' };
  assert.deepEqual(desktopBuildEnvironment(packagePlan(['--require-signing'], 'aarch64-apple-darwin', signed), signed), signed);
  assert.throws(() => packagePlan(['--require-signing'], 'aarch64-apple-darwin', env), /SIGNING_IDENTITY/);
  assert.deepEqual(desktopBuildEnvironment({ platform: 'win32' }, env), env);
});

test('Linux downloads each contain one installer with complete matching integrity metadata', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'yolu-split-'));
  try {
    const source = path.join(directory, 'release');
    const destination = path.join(directory, 'downloads');
    mkdirSync(source);
    for (const name of ['yolu.deb', 'yolu.AppImage', 'LICENSE', 'README.md']) writeFileSync(path.join(source, name), name);
    const files = writeChecksums(source, ['yolu.deb', 'yolu.AppImage', 'LICENSE', 'README.md']);
    writeFileSync(path.join(source, 'release.json'), JSON.stringify({ revision: 'fixture', files }));
    splitLinuxArtifacts(source, destination);
    for (const [format, installer] of [['deb', 'yolu.deb'], ['appimage', 'yolu.AppImage']]) {
      const output = path.join(destination, format);
      assert.deepEqual(readdirSync(output).sort(), ['LICENSE', 'README.md', 'SHA256SUMS', 'release.json', installer].sort());
      const manifest = JSON.parse(readFileSync(path.join(output, 'release.json'), 'utf8'));
      assert.equal(manifest.revision, 'fixture');
      assert.deepEqual(manifest.files, files.filter(file => file.name === installer || !/\.(deb|AppImage)$/.test(file.name)));
      const checksums = readFileSync(path.join(output, 'SHA256SUMS'), 'utf8');
      const expected = writeChecksums(output, ['LICENSE', 'README.md', installer, 'release.json']);
      assert.equal(checksums, expected.map(file => `${file.sha256}  ${file.name}\n`).join(''));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('installer plans select native platform formats and reject accidental cross-OS builds', () => {
  for (const [triple, definition] of Object.entries(targets)) {
    const plan = packagePlan(['--target', triple], triple, {});
    assert.deepEqual(plan.bundles, definition.bundles);
  }
  assert.throws(() => packagePlan(['--target', 'x86_64-pc-windows-msvc'], 'aarch64-apple-darwin', {}), /corresponding operating/);
  assert.throws(() => packagePlan(['--target', 'universal-apple-darwin'], 'aarch64-apple-darwin', {}), /Unsupported/);
  assert.throws(() => packagePlan(['--target'], 'aarch64-apple-darwin', {}), /requires/);
  assert.throws(() => packagePlan([], 'aarch64-apple-darwin', { CARGO_TARGET_DIR: '/other-output' }), /CARGO_TARGET_DIR/);
});

test('signed builds fail before compilation when publisher credentials are incomplete', () => {
  const mac = 'aarch64-apple-darwin', win = 'x86_64-pc-windows-msvc';
  assert.throws(() => packagePlan(['--require-signing'], mac, {}), /SIGNING_IDENTITY/);
  assert.throws(() => packagePlan(['--require-signing'], mac, { APPLE_SIGNING_IDENTITY: '-' }), /Developer ID/);
  assert.throws(() => packagePlan(['--require-signing'], mac, { APPLE_SIGNING_IDENTITY: 'Developer ID Application: Test' }), /notarization/);
  assert.throws(() => packagePlan(['--require-signing'], win, {}), /THUMBPRINT/);
  const plan = packagePlan(['--require-signing'], win, { WORK_HUB_WINDOWS_CERTIFICATE_THUMBPRINT: 'fixture' });
  assert.equal(plan.config.bundle.windows.digestAlgorithm, 'sha256');
  assert.equal(plan.config.bundle.windows.certificateThumbprint, 'fixture');
  const renamed = packagePlan(['--require-signing'], win, { YOLU_WINDOWS_CERTIFICATE_THUMBPRINT: 'yolu', WORK_HUB_WINDOWS_CERTIFICATE_THUMBPRINT: 'legacy' });
  assert.equal(renamed.config.bundle.windows.certificateThumbprint, 'yolu');
});

test('macOS preview gets a separate application identity without changing normal packages', () => {
  const preview = packagePlan(['--preview'], 'aarch64-apple-darwin', {});
  assert.equal(preview.preview, true);
  assert.equal(preview.config.productName, 'Yolu Preview');
  assert.equal(preview.config.identifier, 'dev.work-hub.desktop.preview');
  assert.deepEqual(packagePlan([], 'aarch64-apple-darwin', {}).config, {});
  assert.throws(() => packagePlan(['--preview'], 'x86_64-pc-windows-msvc', {}), /macOS only/);
});

test('version drift is rejected and every exported installer has integrity metadata', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'yolu-package-'));
  try {
    mkdirSync(path.join(directory, 'src-tauri'));
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(path.join(directory, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '../package.json' }));
    writeFileSync(path.join(directory, 'src-tauri/Cargo.toml'), '[package]\nversion = "1.2.3"\n');
    assert.equal(desktopVersion(directory), '1.2.3');
    writeFileSync(path.join(directory, 'src-tauri/Cargo.toml'), '[package]\nversion = "1.2.2"\n');
    assert.throws(() => desktopVersion(directory), /versions must match/);
    mkdirSync(path.join(directory, 'dmg'));
    writeFileSync(path.join(directory, 'dmg/test.dmg'), 'abc');
    assert.equal(bundleFiles(directory, { bundles: ['dmg'] }).length, 1);
    assert.throws(() => bundleFiles(directory, { bundles: ['nsis'] }));
    writeFileSync(path.join(directory, 'dmg/stale.dmg'), 'stale');
    assert.throws(() => bundleFiles(directory, { bundles: ['dmg'] }), /Expected one fresh/);
    writeFileSync(path.join(directory, 'installer'), 'abc');
    assert.equal(writeChecksums(directory, ['installer'])[0].sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.match(readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8'), /  installer\n$/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('signed release packaging requires committed source and an optimized build', () => {
  const plan = { requireSigning: true, debug: false };
  assert.doesNotThrow(() => validateReleaseSource(plan, ''));
  assert.throws(() => validateReleaseSource(plan, ' M internal/task/member_selection.go'), /clean Git working tree/);
  assert.throws(() => validateReleaseSource(plan, '?? unexpected.go'), /clean Git working tree/);
  assert.throws(() => validateReleaseSource({ ...plan, debug: true }, ''), /cannot use --debug/);
  assert.doesNotThrow(() => validateReleaseSource({ requireSigning: false, debug: true }, ' M README.md'));
});
