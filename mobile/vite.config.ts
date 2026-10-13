import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * XR mobile companion PWA.
 *
 * Base path is `/mobile/` because in production the daemon serves these static
 * assets from that path (there is no second server on the phone's network).
 * Dev mode proxies /api to a daemon running on loopback:3141.
 */
export default defineConfig({
  base: '/mobile/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      scope: '/mobile/',
      base: '/mobile/',
      includeAssets: ['icons/*.png'],
      manifest: {
        id: '/mobile/',
        name: 'XR',
        short_name: 'XR',
        description: 'XR — local-first AI companion',
        start_url: '/mobile/?source=pwa',
        scope: '/mobile/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#03070D',
        background_color: '#03070D',
        categories: ['productivity', 'developer-tools', 'utilities'],
        lang: 'en',
        dir: 'ltr',
        icons: [
          { src: '/mobile/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/mobile/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/mobile/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/mobile/icons/maskable-1024.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/mobile/screenshots/chat.png',
            sizes: '1170x2532',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Chat with XR from anywhere on your WiFi',
          },
          {
            src: '/mobile/screenshots/approvals.png',
            sizes: '1170x2532',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Approve or deny actions with one tap',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // Splash screens are cosmetic and heavy; they're fetched on demand
        // rather than precached, so the install payload stays small on 4G.
        // Splash screens are cosmetic and heavy; store screenshots are only
        // read by the Android install prompt. Neither belongs in the precache.
        globIgnores: [
          'icons/splash-*.png',
          'icons/maskable-1024.png',
          'screenshots/*.png',
        ],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // No source maps in production: smaller bundle, less surface.
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Keep the critical path tiny: voice + approval detail are code split.
        manualChunks(id: string) {
          if (id.includes('node_modules/framer-motion')) return 'motion';
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark'))
            return 'markdown';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/'))
            return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3141', changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4180,
  },
});
