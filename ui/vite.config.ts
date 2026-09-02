import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = dirname(fileURLToPath(import.meta.url));

// Run from the repo root as `vite --config ui/vite.config.ts` — Vite's
// default root is process.cwd(), not the config file's own directory, so it
// has to be set explicitly or index.html is never found.
export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4310' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
