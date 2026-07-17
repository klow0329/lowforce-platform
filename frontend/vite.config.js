import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // During local dev, calls to /api/* get forwarded to the backend
      // so the frontend and backend can run on separate ports without
      // browser CORS headaches.
      '/api': 'http://localhost:3001',
    },
  },
});
