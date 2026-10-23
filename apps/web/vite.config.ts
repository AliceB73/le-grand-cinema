import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? '/AliceB73/le-grand-cinema/' : '/',
  server: {
    host: '0.0.0.0',
  },
}));
