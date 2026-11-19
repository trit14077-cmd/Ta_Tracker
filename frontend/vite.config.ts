import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // Edge admin-users chỉ cho origin http://localhost:5173 (ALLOWED_ORIGINS)
    fs: { allow: ['..'] }, // dùng chung ../shared và ../supabase/functions/*/logic.ts
  },
});
