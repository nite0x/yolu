import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../web/core/typography.css', import.meta.url), new URL('../desktop/typography.css', import.meta.url));
await import('./build-chat.mjs');
await import('./prepare-sidecar.mjs');
await import('./prepare-notices.mjs');
