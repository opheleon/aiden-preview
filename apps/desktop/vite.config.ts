import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  root: resolve('apps/desktop'),
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve('dist/desktop'), emptyOutDir: true },
});
