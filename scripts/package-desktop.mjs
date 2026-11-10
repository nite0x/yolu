import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, run, desktopVersion, packagePlan, bundleFiles, writeChecksums, validateReleaseSource, desktopBuildEnvironment } from './desktop-lib.mjs';

const plan = packagePlan(process.argv.slice(2), run('rustc', ['--print', 'host-tuple']));
const version = desktopVersion();
const mode = plan.debug ? 'debug' : 'release';
const output = path.join(root, 'dist/desktop', version, plan.target, plan.preview ? `${mode}-preview` : mode);
if (plan.requireSigning) validateReleaseSource(plan, run('git', ['status', '--porcelain', '--untracked-files=normal']));
if (plan.dryRun) {
  console.log(JSON.stringify({ version, target: plan.target, bundles: plan.bundles, mode, requireSigning: plan.requireSigning, output }, null, 2));
} else {
  const targetDirectory = path.join(root, 'src-tauri/target', plan.target, mode);
  const bundleDirectory = path.join(targetDirectory, 'bundle');
  // Both directories contain generated build output only. A failed rebuild must
  // never leave old installers looking like artifacts of the new source tree.
  rmSync(output, { recursive: true, force: true });
  rmSync(bundleDirectory, { recursive: true, force: true });
  const args = [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--ci', '--target', plan.target, '--bundles', plan.bundles.join(',')];
  if (plan.debug) args.push('--debug');
  if (Object.keys(plan.config).length) args.push('--config', JSON.stringify(plan.config));
  args.push('--', '--locked');
  run(process.execPath, args, { stdio: 'inherit', env: desktopBuildEnvironment(plan) });
  if (plan.requireSigning) validateReleaseSource(plan, run('git', ['status', '--porcelain', '--untracked-files=normal']));
  const artifacts = bundleFiles(bundleDirectory, plan);
  mkdirSync(output, { recursive: true });
  const names = [];
  for (const artifact of artifacts) {
    const name = `yolu${plan.preview ? '-preview' : ''}_${version}_${plan.target}${artifact.suffix}`;
    cpSync(artifact.source, path.join(output, name));
    names.push(name);
  }
  const revision = run('git', ['rev-parse', 'HEAD']);
  const documents = new Map([['LICENSE', 'LICENSE'], ['README.md', 'README.md'], ['docs/guide.md', 'GUIDE.md'], ['docs/development.md', 'DEVELOPMENT.md'], ['docs/brand/yolu/migration.md', 'MIGRATION.md']]);
  for (const [source, name] of documents) {
    // Flatten exported guides without breaking their repository-relative links.
    const contents = readFileSync(path.join(root, source), 'utf8')
      .replace(/\]\(([^)]+)\)/g, (match, target) => {
        if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) return match;
        const [relative, fragment] = target.split('#');
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), relative));
        const destination = documents.get(resolved) || `https://github.com/nite0x/yolu/blob/${revision}/${resolved}`;
        return `](${destination}${fragment ? '#' + fragment : ''})`;
      }).replaceAll('src="web/yolu.png"', 'src="yolu.png"');
    writeFileSync(path.join(output, name), contents);
    names.push(name);
  }
  for (const [source, name] of [['web/yolu.png', 'yolu.png'], ['src-tauri/notices/THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.txt']]) {
    cpSync(path.join(root, source), path.join(output, name));
    names.push(name);
  }
  if (plan.platform === 'win32') {
    for (const [source, name] of [
      ['scripts/upgrade-windows.ps1', 'Upgrade-Yolu.ps1'],
      ['scripts/upgrade-windows.cmd', 'Upgrade.cmd'],
      [`src-tauri/binaries/yolu-backend-${plan.target}.exe`, 'yolu-upgrade.exe'],
    ]) {
      cpSync(path.join(root, source), path.join(output, name)); names.push(name);
    }
  }
  const files = writeChecksums(output, names);
  const modified = Boolean(run('git', ['status', '--porcelain', '--untracked-files=normal']));
  writeFileSync(path.join(output, 'release.json'), JSON.stringify({ version, target: plan.target, mode, backend_version: readFileSync(path.join(root, 'src-tauri/backend-version.txt'), 'utf8').trim(), revision, modified, signing_required: plan.requireSigning, files }, null, 2) + '\n');
  // Cover the manifest itself too; the manifest's file list intentionally has no
  // self-hash. SHA256SUMS is integrity metadata, not a publisher signature.
  writeChecksums(output, [...names, 'release.json']);
  console.log(`Desktop installers: ${output}`);
}
