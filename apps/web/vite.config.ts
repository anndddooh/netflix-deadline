import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 開発中は API（wrangler dev）へプロキシし、同一オリジン扱いにする
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
});
