import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Screenshot / review harness for the desktop Settings -> Mobile card.
 * Renders the real component against a live daemon through a proxy.
 */
const root = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(root, '..');

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  // The harness renders desktop/src/components/settings/MobileCard.tsx in place,
  // so its bare imports would resolve by walking up from the repo root — where
  // this package owns nothing. Pin them to the harness's own node_modules.
  resolve: {
    alias: {
      react: resolve(toolsRoot, 'node_modules/react'),
      'react-dom': resolve(toolsRoot, 'node_modules/react-dom'),
      'lucide-react': resolve(toolsRoot, 'node_modules/lucide-react'),
    },
  },
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
