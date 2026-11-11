import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Enable inclusion of binary/WASM/ONNX model files
    assetsInclude: ['**/*.wasm', '**/*.onnx', '**/*.bin'],
    // Configure Web Worker support for smooth 60fps UI
    worker: {
      format: 'es' as const,
    },
    build: {
      chunkSizeWarningLimit: 30000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('opencv.js') || id.includes('@techstark/opencv-js')) {
              return 'opencv';
            }
            if (id.includes('onnxruntime-web')) {
              return 'onnxruntime';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/scheduler')) {
              return 'react-vendor';
            }
          },
        },
      },
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
