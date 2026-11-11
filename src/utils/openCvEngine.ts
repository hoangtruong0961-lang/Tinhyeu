/**
 * OpenCV.js WebAssembly (C++ SIMD) Accelerated Vision Engine for BachTranslator
 * Provides native-speed frame filtering, Canny edge detection, CLAHE contrast enhancement,
 * and morphological text region analysis.
 */

let cvInstance: any = null;
let cvInitPromise: Promise<boolean> | null = null;
let isOpenCvReady = false;

/**
 * Asynchronously initialize OpenCV.js WebAssembly Module
 */
export async function initOpenCV(): Promise<boolean> {
  if (isOpenCvReady && cvInstance) return true;
  if (cvInitPromise) return cvInitPromise;

  cvInitPromise = (async () => {
    try {
      const cvModule = await import('@techstark/opencv-js');
      const cv = cvModule.default || cvModule;

      if (cv && cv.Mat) {
        cvInstance = cv;
        isOpenCvReady = true;
        console.log('⚡ [OpenCV.js WASM] C++ Vision Engine initialized successfully!');
        return true;
      }

      // Handle async WASM module initialization if present
      if (cv && typeof (cv as any).then === 'function') {
        cvInstance = await cv;
        isOpenCvReady = true;
        console.log('⚡ [OpenCV.js WASM] Async C++ Vision Engine initialized!');
        return true;
      }

      if (cv && cv.onRuntimeInitialized) {
        return new Promise<boolean>((resolve) => {
          cv.onRuntimeInitialized = () => {
            cvInstance = cv;
            isOpenCvReady = true;
            console.log('⚡ [OpenCV.js WASM] Runtime initialized!');
            resolve(true);
          };
          // Timeout fallback
          setTimeout(() => {
            if (cv.Mat) {
              cvInstance = cv;
              isOpenCvReady = true;
              resolve(true);
            } else {
              resolve(false);
            }
          }, 1500);
        });
      }

      if (cv) {
        cvInstance = cv;
        isOpenCvReady = true;
        return true;
      }
    } catch (err) {
      console.warn('[OpenCV.js WASM Init] Failed to load OpenCV WASM module, fallback to JS loops:', err);
    }
    return false;
  })();

  return cvInitPromise;
}

/**
 * Check if OpenCV WASM engine is loaded and ready
 */
export function isOpenCVLoaded(): boolean {
  return isOpenCvReady && !!cvInstance && typeof cvInstance.Mat === 'function';
}

export interface OpenCVTextPresenceResult {
  hasText: boolean;
  edgeNonZero: number;
  edgeRatio: number;
  labLuminanceVariance: number;
  labColorDelta: number;
  labNonZero?: number;
  detectionSource?: 'LAB' | 'CANNY' | 'OPENCV' | 'NONE';
  isOpenCVUsed: boolean;
}

/**
 * C++ WASM SIMD Accelerated Canny Edge & LAB Color Analysis
 * Controlled by "Độ mạnh lọc chữ nền" (filterStrength: 0% -> 100%).
 */
export function detectTextPresenceOpenCV(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  filterStrength: number = 40
): OpenCVTextPresenceResult | null {
  if (!isOpenCVLoaded() || !pixelData || pixelData.length < 16 || width < 10 || height < 10) {
    return null;
  }

  try {
    const cv = cvInstance;

    // 1. Convert pixel buffer to C++ Mat (8-bit 4-channel RGBA)
    const src = new cv.Mat(height, width, cv.CV_8UC4);
    src.data.set(pixelData);

    // 2. RGBA to Grayscale conversion in C++
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 3. Canny Edge Detection in C++ WASM with dynamic threshold
    const lowThresh = 30 + Math.floor((filterStrength / 100) * 20);
    const highThresh = 90 + Math.floor((filterStrength / 100) * 40);
    const edges = new cv.Mat();
    cv.Canny(gray, edges, lowThresh, highThresh);

    // Count non-zero edge pixels
    const nonZeroCount = cv.countNonZero(edges);
    const totalPixels = width * height;
    const edgeRatio = totalPixels > 0 ? nonZeroCount / totalPixels : 0;

    // 4. Mean & Standard Deviation of Luma in C++
    const meanMat = new cv.Mat();
    const stddevMat = new cv.Mat();
    cv.meanStdDev(gray, meanMat, stddevMat);

    const stdL = stddevMat.data64F && stddevMat.data64F.length > 0 ? stddevMat.data64F[0] : 0;
    const varianceL = stdL * stdL;

    // 5. LAB White/Yellow Subtitle Color Range Filtering
    // Convert RGBA -> RGB -> Lab
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const lab = new cv.Mat();
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);

    // White text range in LAB: L >= 175, 115 <= a <= 140, 115 <= b <= 140
    // Yellow text range in LAB: L >= 135, 110 <= a <= 150, 145 <= b <= 210
    const whiteLower = new cv.Mat(lab.rows, lab.cols, lab.type(), [175, 115, 115, 0]);
    const whiteUpper = new cv.Mat(lab.rows, lab.cols, lab.type(), [255, 140, 140, 0]);
    const whiteMask = new cv.Mat();
    cv.inRange(lab, whiteLower, whiteUpper, whiteMask);

    const yellowLower = new cv.Mat(lab.rows, lab.cols, lab.type(), [135, 110, 145, 0]);
    const yellowUpper = new cv.Mat(lab.rows, lab.cols, lab.type(), [255, 150, 210, 0]);
    const yellowMask = new cv.Mat();
    cv.inRange(lab, yellowLower, yellowUpper, yellowMask);

    const combinedColorMask = new cv.Mat();
    cv.bitwise_or(whiteMask, yellowMask, combinedColorMask);
    const labNonZero = cv.countNonZero(combinedColorMask);
    const labRatio = totalPixels > 0 ? labNonZero / totalPixels : 0;

    // Clean up WASM allocated memory immediately to avoid memory leaks
    src.delete();
    gray.delete();
    edges.delete();
    meanMat.delete();
    stddevMat.delete();
    rgb.delete();
    lab.delete();
    whiteLower.delete();
    whiteUpper.delete();
    whiteMask.delete();
    yellowLower.delete();
    yellowUpper.delete();
    yellowMask.delete();
    combinedColorMask.delete();

    // Dynamic thresholds based on "Độ mạnh lọc chữ nền"
    const strengthFactor = Math.max(0, Math.min(100, filterStrength)) / 100;
    const minLabRatioThresh = 0.0008 + strengthFactor * 0.005;
    const minEdgeRatioThresh = 0.0002 + strengthFactor * 0.004;

    let hasText = false;
    let detectionSource: 'LAB' | 'CANNY' | 'OPENCV' | 'NONE' = 'NONE';

    if (labRatio >= minLabRatioThresh && (varianceL >= 0.5 || stdL >= 1.5)) {
      hasText = true;
      detectionSource = 'LAB';
    } else if (edgeRatio >= minEdgeRatioThresh && (varianceL >= 0.8 || stdL >= 2.0)) {
      hasText = true;
      detectionSource = 'CANNY';
    }

    return {
      hasText,
      edgeNonZero: nonZeroCount,
      edgeRatio,
      labLuminanceVariance: varianceL,
      labColorDelta: stdL * 2,
      labNonZero,
      detectionSource,
      isOpenCVUsed: true,
    };
  } catch (err) {
    console.warn('[OpenCV.js detectTextPresenceOpenCV Exception]', err);
    return null;
  }
}

/**
 * C++ WASM CLAHE (Contrast Limited Adaptive Histogram Equalization)
 * Enhances subtitle strokes for CJK/Latin characters before OCR.
 */
export function enhanceImageOpenCV(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  clipLimit: number = 2.5,
  tileGridSize: number = 8
): boolean {
  if (!isOpenCVLoaded() || width <= 0 || height <= 0) return false;

  try {
    const cv = cvInstance;
    const imgData = ctx.getImageData(0, 0, width, height);

    const src = new cv.Mat(height, width, cv.CV_8UC4);
    src.data.set(imgData.data);

    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply CLAHE
    const clahe = new cv.CLAHE(clipLimit, new cv.Size(tileGridSize, tileGridSize));
    const claheMat = new cv.Mat();
    clahe.apply(gray, claheMat);

    // Convert back to RGBA
    const dst = new cv.Mat();
    cv.cvtColor(claheMat, dst, cv.COLOR_GRAY2RGBA);

    // Put enhanced image back to canvas
    const enhancedData = new ImageData(new Uint8ClampedArray(dst.data), width, height);
    ctx.putImageData(enhancedData, 0, 0);

    // Memory cleanup
    src.delete();
    gray.delete();
    claheMat.delete();
    dst.delete();
    clahe.delete();

    return true;
  } catch (err) {
    console.warn('[OpenCV.js enhanceImageOpenCV Exception]', err);
    return false;
  }
}
