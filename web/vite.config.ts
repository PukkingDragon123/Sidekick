import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const server = process.env.SIDEKICK_SERVER ?? 'http://localhost:8787';

export default defineConfig(({ mode }) => ({
  // `--mode artifact`: a standalone offline build with relative paths, for publishing as a static page
  base: mode === 'artifact' ? './' : '/',
  define: mode === 'artifact' ? { 'import.meta.env.VITE_OFFLINE': JSON.stringify('1') } : {},
  plugins: [preact()],
  // keep non-ASCII characters escaped in the bundle (some hosts reject literal U+FFFD)
  esbuild: { charset: 'ascii' },
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
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    rollupOptions: {
      input: mode === 'artifact' ? { main: resolve(__dirname, 'index.html') } : {
        main: resolve(__dirname, 'index.html'),
        pet: resolve(__dirname, 'pet.html'),
        sheet: resolve(__dirname, 'sheet.html'),
      },
    },
  },
}));
