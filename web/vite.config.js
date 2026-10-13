import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  build: { outDir: 'static', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
