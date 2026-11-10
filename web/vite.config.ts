import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const server = process.env.SIDEKICK_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@shared': resolve(__dirname, '../shared/src') } },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: server, changeOrigin: true },
      '/ws': { target: server, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pet: resolve(__dirname, 'pet.html'),
        sheet: resolve(__dirname, 'sheet.html'),
      },
    },
  },
});
