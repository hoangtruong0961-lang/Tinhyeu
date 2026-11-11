import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Import Fontsource fonts
import '@fontsource-variable/roboto-condensed';
import '@fontsource/be-vietnam-pro';
import '@fontsource-variable/inter';
import '@fontsource/dancing-script';

// Global optimization: default willReadFrequently to true for all 2D canvases to eliminate readback bottlenecks and browser warnings
if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.getContext) {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, options?: any) {
    if (contextId === '2d') {
      options = { willReadFrequently: true, ...(options || {}) };
    }
    return origGetContext.call(this, contextId as any, options);
  } as any;
}
if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.getContext) {
  const origGetContext = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, contextId: string, options?: any) {
    if (contextId === '2d') {
      options = { willReadFrequently: true, ...(options || {}) };
    }
    return origGetContext.call(this, contextId as any, options);
  } as any;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

