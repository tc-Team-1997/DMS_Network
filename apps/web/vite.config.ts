import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// All API calls are same-origin in prod (Node serves the built SPA).
// In dev we proxy them to the running Node server so the session cookie works.
const NODE_BACKEND = process.env.VITE_NODE_BACKEND ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/spa/api': { target: NODE_BACKEND, changeOrigin: true },
      '/api/v1':  { target: NODE_BACKEND, changeOrigin: true },
      '/py':      { target: NODE_BACKEND, changeOrigin: true },
      '/uploads': { target: NODE_BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
