import { access, copyFile, mkdir } from 'node:fs/promises';

// The preload is emitted as CommonJS by TypeScript; never overwrite it with source.
await access('dist/apps/desktop/src/preload.cjs');
await mkdir('dist/licenses', { recursive: true });
await copyFile('LICENSE', 'dist/licenses/LICENSE');
await copyFile('NOTICE', 'dist/licenses/NOTICE');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/licenses/THIRD_PARTY_NOTICES.md');
