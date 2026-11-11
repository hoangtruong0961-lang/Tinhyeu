import { SubtitleItem, SubtitleStyleConfig } from '../types';
import { wrapSubtitleText } from '../utils/srtParser';
import { renderCompositedFrame } from '../utils/canvasRenderer';

let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let fontsLoaded = false;

// Preload custom fonts into the worker's FontFaceSet to prevent falling back to standard thin fonts
async function loadCustomFonts() {
  if (fontsLoaded) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    try {
      const fonts = [
        { family: 'Plus Jakarta Sans', url: 'https://fonts.gstatic.com/s/plusjakartasans/v8/L0x9DFM0_VJNtXg7FIdC7K3uyX4nyqHNNiV9694t1A3G8g.woff2' },
        { family: 'Roboto', url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2' },
        { family: 'Playfair Display', url: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD7K327Spv37f968DGpY1rad7gMW30ey87iU.woff2' },
        { family: 'Montserrat', url: 'https://fonts.gstatic.com/s/montserrat/v25/JTUSjIg1_i6t8kCHKm459W1hyyTh89ZNpQ.woff2' },
        { family: 'Barlow Condensed', url: 'https://fonts.gstatic.com/s/barlowcondensed/v12/HTxxL3EI-opent69ZuKVOCS52Ex65UHA.woff2' },
        { family: 'Charm', url: 'https://fonts.gstatic.com/s/charm/v10/7cHrv4kjgoGqM5E_cA87.woff2' },
        { family: 'Cherry Bomb One', url: 'https://fonts.gstatic.com/s/cherrybombone/v6/z7NWdUtX86Dk4q6rOa-ZqgZ_Zk4A.woff2' },
        { family: 'Fira Sans', url: 'https://fonts.gstatic.com/s/firasans/v17/va9E4kDNxMZdWfMOD5Vvl4jO.woff2' },
        { family: 'IBM Plex Sans', url: 'https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bp8cxfrFh.woff2' },
      ];
      for (const f of fonts) {
        try {
          const fontFace = new FontFace(f.family, `url(${f.url})`, { weight: 'bold' });
          await Promise.race([
            fontFace.load(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Font load timeout')), 3000))
          ]);
          (self as any).fonts.add(fontFace);
        } catch (e) {
          // Ignore individual load failures
        }
      }
      fontsLoaded = true;
    } catch (err) {
      console.warn('[Worker] Failed to load custom web fonts:', err);
    }
  }
}

const loadedCustomFontNames = new Set<string>();

async function loadUploadedFonts(customUploadedFonts?: { family: string; dataUrl: string }[]) {
  if (!customUploadedFonts || customUploadedFonts.length === 0) return;
  if (typeof FontFace !== 'undefined' && (self as any).fonts) {
    for (const font of customUploadedFonts) {
      if (loadedCustomFontNames.has(font.family)) continue;
      try {
        const fontFace = new FontFace(font.family, `url(${font.dataUrl})`);
        const loaded = await fontFace.load();
        (self as any).fonts.add(loaded);
        loadedCustomFontNames.add(font.family);
      } catch (e) {
        console.warn('[Worker] Failed to load custom uploaded font:', font.family, e);
      }
    }
  }
}

function drawSubtitleOverlay(
  context: OffscreenCanvasRenderingContext2D,
  imageBitmap: ImageBitmap | VideoFrame,
  vWidth: number,
  vHeight: number,
  curTime: number,
  subtitles: SubtitleItem[],
  styleConfig: SubtitleStyleConfig,
  blurOverlays: any[] = [],
  logoOverlays: any[] = [],
  textOverlays: any[] = [],
  logoBitmaps: Record<string, ImageBitmap> = {}
) {
  renderCompositedFrame(context, {
    videoSource: imageBitmap,
    vWidth,
    vHeight,
    curTime,
    subtitles,
    styleConfig,
    blurOverlays,
    logoOverlays,
    textOverlays,
    logoBitmaps,
  });
}

const logoBitmapsCache = new Map<string, ImageBitmap>();

async function getLogoBitmap(logo: { id: string; url: string }): Promise<ImageBitmap | null> {
  if (logoBitmapsCache.has(logo.id)) {
    return logoBitmapsCache.get(logo.id)!;
  }
  try {
    const res = await fetch(logo.url);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    logoBitmapsCache.set(logo.id, bitmap);
    return bitmap;
  } catch (err) {
    console.error('Failed to load logo bitmap in worker:', err);
    return null;
  }
}

let renderQueuePromise: Promise<void> = Promise.resolve();

async function processRenderTask(data: any) {
  const {
    imageBitmap,
    videoFrame,
    timestampUs,
    isKeyFrame,
    currentTime,
    vWidth,
    vHeight,
    subtitles,
    styleConfig,
    frameIdx,
    blurOverlays = [],
    logoOverlays = [],
    textOverlays = [],
  } = data;

  const frameSource = videoFrame || imageBitmap;

  try {
    // Async preload fonts
    await loadCustomFonts();
    if (styleConfig && styleConfig.customUploadedFonts) {
      await loadUploadedFonts(styleConfig.customUploadedFonts);
    }

    // Pre-load all logo bitmaps for this frame
    const logoBitmaps: Record<string, ImageBitmap> = {};
    if (logoOverlays && logoOverlays.length > 0) {
      await Promise.all(
        logoOverlays.map(async (logo: any) => {
          const bmp = await getLogoBitmap(logo);
          if (bmp) {
            logoBitmaps[logo.id] = bmp;
          }
        })
      );
    }

    // Align dimensions to even numbers (H.264/WebCodecs requirement)
    const alignedWidth = Math.max(2, Math.floor(vWidth / 2) * 2);
    const alignedHeight = Math.max(2, Math.floor(vHeight / 2) * 2);

    if (!offscreenCanvas || offscreenCanvas.width !== alignedWidth || offscreenCanvas.height !== alignedHeight) {
      offscreenCanvas = new OffscreenCanvas(alignedWidth, alignedHeight);
      ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!ctx || !offscreenCanvas) {
      throw new Error('Render context creation failed in task worker');
    }

    // Clear canvas before drawing to make sure no leftover garbage from any previous crash/draw remains
    ctx.clearRect(0, 0, alignedWidth, alignedHeight);

    // Draw the overlay
    drawSubtitleOverlay(
      ctx,
      frameSource,
      alignedWidth,
      alignedHeight,
      currentTime,
      subtitles,
      styleConfig,
      blurOverlays,
      logoOverlays,
      textOverlays,
      logoBitmaps
    );
    
    if (frameSource && typeof frameSource.close === 'function') {
      frameSource.close(); // Immediate memory cleanup of original frame
    }

    // Extract the high-performance rendered bitmap
    const renderedBitmap = offscreenCanvas.transferToImageBitmap();

    // Send the rendered bitmap back using zero-copy transfer
    (self.postMessage as any)({
      type: 'RENDER_DONE',
      renderedBitmap,
      frameIdx,
      timestampUs,
      isKeyFrame,
      currentTime,
    }, [renderedBitmap]);

  } catch (err: any) {
    if (frameSource && typeof frameSource.close === 'function') {
      frameSource.close();
    }
    self.postMessage({
      type: 'RENDER_ERROR',
      frameIdx,
      error: err?.message || 'Parallel rendering failed',
    });
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === 'RENDER') {
    renderQueuePromise = renderQueuePromise
      .then(() => processRenderTask(e.data))
      .catch((err) => {
        console.error('[Task Worker] Uncaught render queue error:', err);
      });
  }
};
