import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,        // bind to 0.0.0.0 so LAN/WiFi clients can hit http://<host-ip>:5173
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
