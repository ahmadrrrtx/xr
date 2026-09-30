import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

  // https://vite.dev/config/
  export default defineConfig({
    plugins: [react(), tailwindcss()],
    // Never watch Rust build artifacts (src-tauri/target can hold 40k+ files
    // after a cargo build and exhausts inotify watchers).
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  // Tauri expects a fixed dev port (see src-tauri/tauri.conf.json > app.windows > devUrl)
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // Sandbox/preview proxies (e.g. *.e2b.app) serve the dev server through a
    // public host — allow that suffix. Inert during local development.
    allowedHosts: ['.e2b.app'],
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'oxc' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src'),
    },
  },
});
