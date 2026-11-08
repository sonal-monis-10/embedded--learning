import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reachable from a phone on the same Wi-Fi (http://<laptop-ip>:5173).
    // Motion sensors need HTTPS on iOS, so phone sensor tests use the Render deploy.
    host: true,
  },
});
