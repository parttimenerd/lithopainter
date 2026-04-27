import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/lithopainter/',
  plugins: [react()],
  server: {
    headers: {
      // Required for SharedArrayBuffer used by onnxruntime-web WASM threads
      'Cross-Origin-Opener-Policy': 'same-origin',
      // 'credentialless' enables SharedArrayBuffer while allowing cross-origin
      // fetches (HuggingFace model CDN, Vite dep chunks, etc.)
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
