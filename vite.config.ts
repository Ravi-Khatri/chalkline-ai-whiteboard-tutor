import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs in `wrangler dev` on :8790 and Vite proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8790' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
