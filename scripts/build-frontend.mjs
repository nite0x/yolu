import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
import { build } from 'vite';
import { build as buildModule, context } from 'esbuild';

const watch = process.argv.includes('--watch');

// Go embeds these files, so every binary build must compile the UI first.
await build({ root: fileURLToPath(new URL('../', import.meta.url)), ...(watch ? { build: { watch: {}, emptyOutDir: false } } : {}) });

const runtimeOptions = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['frontend/core/browser-runtime.ts'], outfile: 'web/ui/browser-runtime.js',
  bundle: true, format: 'iife', target: ['es2022'], minify: true,
};
if (watch) {
  const runtime = await context(runtimeOptions);
  await runtime.watch();
} else {
  await buildModule(runtimeOptions);
}

// Keep Shiki language/theme chunks out of the initial application bundle. All
// assets are local and embedded by Go; the viewer loads only when opened.
const viewerOptions = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: { 'file-display': 'frontend/app/file-display.ts' },
  outdir: 'web/ui/files', bundle: true, splitting: true, format: 'esm',
  target: ['es2022'], minify: true, legalComments: 'linked',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
};
if (watch) {
  const viewer = await context(viewerOptions);
  await viewer.watch();
} else {
  await buildModule(viewerOptions);
}

const layoutOptions = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['frontend/app/page-layout.tsx'],
  outfile: 'web/ui/page-layout.js', bundle: true, format: 'iife',
  globalName: 'WorkHubLayout', target: ['es2022'], jsx: 'automatic',
  minify: true, legalComments: 'linked',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
};
if (watch) {
  const layout = await context(layoutOptions);
  await layout.watch();
} else {
  await buildModule(layoutOptions);
}

// Terminal pages are independently mounted application panes. Keep xterm out of
// the initial application bundle and bundle all assets locally.
const terminalOptions = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['frontend/app/terminal.ts'],
  outfile: 'web/ui/terminal.js', bundle: true, format: 'iife',
  loader: { '.woff2': 'file' }, assetNames: 'fonts/[name]-[hash]',
  target: ['es2022'], jsx: 'automatic', minify: true, legalComments: 'linked',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
};
if (watch) {
  const terminal = await context(terminalOptions);
  await terminal.watch();
} else {
  await buildModule(terminalOptions);
}

// Load the shared locale before application, terminal and chat controllers.
await buildModule({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['frontend/i18n-runtime.ts'], outfile: 'web/ui/i18n.js',
  bundle: true, format: 'iife', target: ['es2022'], minify: true,
});

await copyFile(new URL('../web/ui/i18n.js', import.meta.url), new URL('../desktop/i18n.js', import.meta.url));
