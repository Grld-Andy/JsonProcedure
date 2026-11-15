import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Locks the packaged renderer down: no remote scripts, no network calls from the page. */
const csp: Plugin = {
  name: 'jp-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>
    <meta http-equiv="Content-Security-Policy" content="${[
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; ')}" />`,
    ),
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: path.resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: path.resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss(), csp],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src/renderer/src') },
    },
    build: {
      rollupOptions: { input: { index: path.resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
