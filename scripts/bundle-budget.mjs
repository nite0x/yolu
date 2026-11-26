import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function checkBundleBudgets(manifest, policy) {
  const errors = [];
  const files = new Map(manifest.files.map(file => [file.path, file]));
  for (const budget of policy.assets) {
    const file = files.get(budget.path);
    if (!file) { errors.push(`Missing budgeted asset: ${budget.path}`); continue; }
    for (const [field, limit] of [['bytes', budget.bytes], ['gzip_bytes', budget.gzip_bytes]]) {
      if (!Number.isFinite(file[field]) || file[field] < 0) errors.push(`${budget.path}: invalid ${field}`);
      else if (file[field] > limit) errors.push(`${budget.path}: ${field} ${file[field]} exceeds ${limit}`);
    }
  }
  const total = policy.critical.reduce((sum, name) => sum + (files.get(name)?.gzip_bytes || 0), 0);
  for (const name of policy.critical) if (!files.has(name)) errors.push(`Missing critical asset: ${name}`);
  if (total > policy.critical_gzip_bytes) errors.push(`Critical JavaScript gzip ${total} exceeds ${policy.critical_gzip_bytes}`);
  return {errors, criticalGzip: total};
}

export async function verifyBundleBudgets(root = fileURLToPath(new URL('../', import.meta.url))) {
  const [manifest, policy] = await Promise.all(['web/ui/build-manifest.json', 'frontend/bundle-budgets.json'].map(name => readFile(path.join(root, name), 'utf8').then(JSON.parse)));
  const result = checkBundleBudgets(manifest, policy);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  console.log(`Bundle budgets passed: critical JavaScript ${result.criticalGzip} bytes gzip.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await verifyBundleBudgets();
