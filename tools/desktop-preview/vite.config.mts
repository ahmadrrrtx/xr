import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot / review harness for the desktop Settings -> Mobile card.
 * Renders the real component against a live daemon through a proxy.
 */
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5181,
    proxy: { '/api': { target: 'https://127.0.0.1:3141', secure: false, changeOrigin: false } },
  },
  preview: {
    port: 4181,
    proxy: { '/api': { target: 'https://127.0.0.1:3141', secure: false, changeOrigin: false } },
  },
});
