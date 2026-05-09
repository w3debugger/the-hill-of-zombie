import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import legacy from '@vitejs/plugin-legacy';

// We ship two bundles: a modern ESM one for evergreen browsers and a SystemJS
// one transpiled to ES5 + polyfilled via core-js for old browsers (IE11, old
// Edge/Safari/Chrome/Firefox). The hard floor is still set by the runtime APIs
// the game needs — Canvas (IE9+), WebSocket (IE10+), and Web Audio (no IE) —
// none of which can be polyfilled. index.html does a feature check and shows a
// friendly message on browsers below that floor.
export default defineConfig({
  plugins: [
    preact(),
    legacy({
      targets: ['ie >= 11', 'safari >= 10', 'chrome >= 50', 'firefox >= 50', 'edge >= 12'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  server: {
    host: true,        // bind to 0.0.0.0 so LAN/WiFi clients can hit http://<host-ip>:5173
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2015',
    sourcemap: true,
  },
});
