import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 2 trang: app (index.html) + trang tuyển dụng công khai (apply.html, M7-3)
  build: { rollupOptions: { input: { main: 'index.html', apply: 'apply.html' } } },
  server: {
    port: 5173,
    strictPort: true, // Edge admin-users chỉ cho origin http://localhost:5173 (ALLOWED_ORIGINS)
    fs: { allow: ['..'] }, // dùng chung ../shared và ../supabase/functions/*/logic.ts
  },
});
