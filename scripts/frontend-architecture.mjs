import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const extensions = ['.ts', '.tsx', '.css', '.json'];
const sourceFile = file => /\.(?:tsx?|css)$/.test(file);

// Tokenize strings/comments separately so quoted examples and comments cannot
// become dependencies. Includes re-exports, type queries and literal imports.
export function importSpecifiers(source, css = false) {
  if (css) return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+["']([^"']+)["']/g)].map(match => match[1]);
  const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g)]
    .map(match => match[0]).filter(token => !token.startsWith('//') && !token.startsWith('/*'));
  const quoted = value => /^["']/.test(value || '');
  const imports = [];
  for (let i = 0; i < tokens.length; i++) {
    const kind = tokens[i];
    if (kind !== 'import' && kind !== 'export') continue;
    let next = i + 1;
    if (kind === 'import' && tokens[next] === '.') continue; // import.meta
    if (kind === 'import' && tokens[next] === '(') next++;
    if (kind === 'import' && quoted(tokens[next])) { imports.push(tokens[next].slice(1, -1)); continue; }
    if (kind === 'export' && !['*', '{', 'type'].includes(tokens[next])) continue;
    for (; next < tokens.length; next++) {
      if ([';', '=', 'import', 'export'].includes(tokens[next])) break;
      if (tokens[next] === 'from' && quoted(tokens[next + 1])) { imports.push(tokens[next + 1].slice(1, -1)); break; }
    }
  }
  return imports;
}

async function listSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSources(file));
    else if (sourceFile(file)) files.push(file);
  }
  return files;
}

async function resolveSource(root, importer, specifier) {
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(importer), specifier);
  for (const candidate of [base, ...extensions.map(extension => base + extension), path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (await stat(candidate).then(info => info.isFile(), () => false)) return candidate;
  }
}

export async function checkFrontendArchitecture(root, rules) {
  const files = await listSources(root);
  const errors = [];
  const featureGraph = new Map();
  const sourceGraph = new Map();
  for (const file of files) {
    const name = path.relative(root, file).split(path.sep).join('/');
    if (name === 'vite-env.d.ts') continue;
    const [layer, feature] = name.split('/');
    if (!rules.layers[layer]) { errors.push(`${name}: unknown source layer`); continue; }
    if (layer === 'features' && !Object.hasOwn(rules.features, feature)) errors.push(`${name}: unregistered feature`);
    for (const specifier of importSpecifiers(await readFile(file, 'utf8'), file.endsWith('.css'))) {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      const target = await resolveSource(root, file, specifier);
      if (!target) { errors.push(`${name}: unresolved import ${specifier}`); continue; }
      const targetName = path.relative(root, target).split(path.sep).join('/');
      if (targetName.startsWith('../') || path.isAbsolute(targetName)) {
        errors.push(`${name}: source imports must stay inside frontend (${specifier})`);
        continue;
      }
      if (!sourceGraph.has(name)) sourceGraph.set(name, new Set());
      sourceGraph.get(name).add(targetName);
      const [targetLayer, targetFeature, ...inside] = targetName.split('/');
      if (!rules.layers[layer].includes(targetLayer)) errors.push(`${name}: ${layer} must not import ${targetName}`);
      if (name.startsWith('shared/ui/primitives/') && targetName.startsWith('shared/ui/') && !targetName.startsWith('shared/ui/primitives/')) {
        errors.push(`${name}: primitives must not import composed UI ${targetName}`);
      }
      if (layer === 'features' && targetLayer === 'features' && targetFeature !== feature) {
        const publicFiles = rules.features[feature]?.[targetFeature] || [];
        if (!publicFiles.includes(inside.join('/'))) errors.push(`${name}: ${targetName} is not an allowed feature integration`);
        if (!featureGraph.has(feature)) featureGraph.set(feature, new Set());
        featureGraph.get(feature).add(targetFeature);
      }
      if (layer === 'features' && /\/(?:model|runtime)\//.test(name) && /\/(?:ui|components)\//.test(targetName)) errors.push(`${name}: model/runtime must not import UI ${targetName}`);
    }
  }
  const visited = new Set();
  function visit(feature, trail = []) {
    if (trail.includes(feature)) { errors.push(`Feature cycle: ${[...trail, feature].join(' -> ')}`); return; }
    if (visited.has(feature)) return;
    for (const dependency of featureGraph.get(feature) || []) visit(dependency, [...trail, feature]);
    visited.add(feature);
  }
  for (const feature of featureGraph.keys()) visit(feature);
  // Feature-level checks cannot detect cycles inside a feature or between
  // shared/core files. Check the resolved file graph as well, including types,
  // re-exports, styles and lazy imports.
  const completed = new Set(), active = new Map(), trail = [];
  function visitSource(file) {
    if (active.has(file)) {
      errors.push(`Source cycle: ${[...trail.slice(active.get(file)), file].join(' -> ')}`);
      return;
    }
    if (completed.has(file)) return;
    active.set(file, trail.length); trail.push(file);
    for (const dependency of sourceGraph.get(file) || []) visitSource(dependency);
    trail.pop(); active.delete(file); completed.add(file);
  }
  for (const file of sourceGraph.keys()) visitSource(file);
  return {files:files.length, errors};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../frontend', import.meta.url));
  const rules = JSON.parse(await readFile(path.join(root, 'architecture.json'), 'utf8'));
  const result = await checkFrontendArchitecture(root, rules);
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`Frontend architecture checked: ${result.files} sources, ${Object.keys(rules.features).length} features.`);
}
