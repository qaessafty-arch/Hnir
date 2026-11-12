import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { sourcemap: false, chunkSizeWarningLimit: 700, assetsInlineLimit: 0 }, // no data: URIs (strict CSP)
});
