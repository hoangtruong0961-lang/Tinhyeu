/**
 * Advanced Pre-Processing Pipeline for PaddleOCR PP-OCRv6 Subtitle Extraction
 * Includes:
 * 1. [Decision] Canny Edge Detection + LAB Color Space Analysis for smart frame skipping
 * 2. [Edge] edgeNonZero pixel counting threshold
 * 3. [BinarizeMLKit] / Binarization & contrast stroke enhancement
 * 4. [Scale] / [ScaleFilter] bitmap scaling for optimal CJK/Latin stroke height (48px - 72px)
 * 5. [Calibrate] Auto-calibration & lock of active subtitle region height (calibratedHeight / ROI Lock)
 */

import {
  initOpenCV,
  isOpenCVLoaded,
  detectTextPresenceOpenCV,
  enhanceImageOpenCV,
} from './openCvEngine';

// Non-blocking initialization of OpenCV WASM engine in background
initOpenCV().catch(() => {});

export interface TextPresenceDecision {
  hasText: boolean;
  edgeNonZero: number;
  edgeRatio: number;
  labLuminanceVariance: number;
  labColorDelta: number;
  labNonZero?: number;
  detectionSource?: 'LAB' | 'CANNY' | 'OPENCV' | 'NONE';
  isOpenCVUsed?: boolean;
}

export interface RoiCalibrationResult {
  isCalibrated: boolean;
  calibratedYPercent: number;      // e.g. 78%
  calibratedHeightPercent: number; // e.g. 18%
  sampleCount: number;
}

/**
 * Simulated JPEG "black background filtering" (Thresholding Noise Filter)
 * Extremely lightweight mathematical in-place filter for raw RGBA/RGB pixel byte arrays.
 * Suppresses compression artifacts/mosquito noise on dark backdrops by forcing dark pixels below 30 to absolute black.
 */
export function applyThresholdingNoiseFilter(
  pixelData: Uint8Array | Uint8ClampedArray,
  width?: number,
  height?: number
): void {
  if (!pixelData || pixelData.length < 4) return;
  const len = pixelData.length;
  for (let i = 0; i < len; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];

    if (r < 30 && g < 30 && b < 30) {
      pixelData[i] = 0;     // Force hard absolute black
      pixelData[i + 1] = 0;
      pixelData[i + 2] = 0;
    } else {
      // JPEG QUANTIZATION EMULATION: bitwise AND to clear the last 3 bits (same as (r >> 3) << 3)
      // Eliminates small compression fluctuations, boosting diffScore stability and OCR accuracy at maximum speed.
      pixelData[i] = r & 0xF8;
      pixelData[i + 1] = g & 0xF8;
      pixelData[i + 2] = b & 0xF8;
    }
  }
}

/**
 * Fast 16x16 Coarse Grid Luma signature (256 bytes)
 * Ultra-cheap pre-filter (runs in ~0.02ms) to detect static video regions before computing LAB / Sobel.
 */
export function computeCoarseLumaGrid(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  gridSize: number = 16
): Uint8Array {
  const grid = new Uint8Array(gridSize * gridSize);
  if (!pixelData || width < gridSize || height < gridSize) return grid;

  const blockW = Math.floor(width / gridSize);
  const blockH = Math.floor(height / gridSize);

  for (let gy = 0; gy < gridSize; gy++) {
    const startY = gy * blockH + (blockH >> 1);
    const rowOffset = startY * width * 4;
    for (let gx = 0; gx < gridSize; gx++) {
      const startX = gx * blockW + (blockW >> 1);
      const idx = rowOffset + startX * 4;
      if (idx + 2 < pixelData.length) {
        const r = pixelData[idx];
        const g = pixelData[idx + 1];
        const b = pixelData[idx + 2];
        grid[gy * gridSize + gx] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
      }
    }
  }
  return grid;
}

export function compareCoarseLumaGrids(gridA: Uint8Array, gridB: Uint8Array): number {
  if (!gridA || !gridB || gridA.length !== gridB.length || gridA.length === 0) return 999;
  let totalDiff = 0;
  const len = gridA.length;
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(gridA[i] - gridB[i]);
  }
  return totalDiff / len;
}

// Module-level cache for ultra-fast coarse grid decision reuse across consecutive video frames
let lastGridCache: { grid: Uint8Array; decision: TextPresenceDecision; filterStrength: number } | null = null;

/**
 * 1. [Decision] & [Edge]: Dual-Check Classical Computer Vision Pre-filter (LAB + Canny Edge)
 * Controlled by "Độ mạnh lọc chữ nền" (filterStrength: 0% -> 100%).
 * 
 * 1. Coarse 16x16 Grid Check: Ultra-fast (<0.02ms) skip for static video scenes
 * 2. LAB Color Space: Specifically detects White/Yellow text (the 2 most dominant subtitle colors)
 * 3. Canny Edge: Detects text of any arbitrary color with contrast edges
 * 4. Compares density/pixel count against filterStrength-adjusted thresholds
 */
export function detectTextPresenceInFrame(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  filterStrength: number = 40
): TextPresenceDecision {
  if (!pixelData || pixelData.length < 16 || width < 10 || height < 10) {
    return {
      hasText: true, // Default to true if buffer unavailable
      edgeNonZero: 100,
      edgeRatio: 0.1,
      labLuminanceVariance: 50,
      labColorDelta: 20,
      labNonZero: 50,
      detectionSource: 'NONE',
    };
  }

  // Pre-Filter 0: Ultra-cheap 16x16 coarse luma grid check against previous frame
  const currGrid = computeCoarseLumaGrid(pixelData, width, height, 16);
  if (lastGridCache && lastGridCache.filterStrength === filterStrength) {
    const gridDiff = compareCoarseLumaGrids(currGrid, lastGridCache.grid);
    // If previous frame already had text, reusing true is safe for minor changes (<0.40 luma)
    if (lastGridCache.decision.hasText && gridDiff < 0.40) {
      return { ...lastGridCache.decision };
    }
    // If previous frame had NO text, NEVER reuse false unless the image is virtually identical (<0.08 luma)
    // to avoid dropping short 3-4 character subtitles that produce low average grid change!
    if (!lastGridCache.decision.hasText && gridDiff < 0.08) {
      return { ...lastGridCache.decision };
    }
  }

  // 1. Try OpenCV WASM C++ SIMD Canny Edge Detector first if loaded
  if (isOpenCVLoaded()) {
    const cvResult = detectTextPresenceOpenCV(pixelData, width, height, filterStrength);
    if (cvResult) {
      lastGridCache = { grid: currGrid, decision: cvResult, filterStrength };
      return cvResult;
    }
  }

  const totalPixels = width * height;
  let edgeNonZeroCount = 0;
  let labWhiteYellowCount = 0;

  // L* (Luminance) stats for LAB analysis
  let sumL = 0;
  let sumL2 = 0;
  let minL = 255;
  let maxL = 0;

  // Sample every 4th pixel horizontally & vertically for speed (4x speedup)
  const stepX = 4;
  const stepY = 4;
  let sampledCount = 0;
  const stride = width * 4;

  const grayscale = new Uint8Array(Math.floor(width / stepX) * Math.floor(height / stepY));
  const sampleW = Math.floor(width / stepX);

  let gIdx = 0;
  for (let y = 0; y < height; y += stepY) {
    const rowOffset = y * stride;
    for (let x = 0; x < width; x += stepX) {
      const idx = rowOffset + x * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];

      // Approximate CIELAB L* (Luminance) = 0.2126 R + 0.7152 G + 0.0722 B
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      grayscale[gIdx++] = luma;

      sumL += luma;
      sumL2 += luma * luma;
      if (luma < minL) minL = luma;
      if (luma > maxL) maxL = luma;

      // 1. LAB Color Space Check: White or Yellow subtitle text
      // - White Subtitle: High Luma (>= 175) and balanced RGB (|R-G| < 30, |R-B| < 30)
      const isWhiteText = luma >= 175 && Math.abs(r - g) < 30 && Math.abs(r - b) < 30;
      // - Yellow Subtitle: High Red & Green, low Blue (R >= 140, G >= 130, B <= 115)
      const isYellowText = r >= 140 && g >= 130 && b <= 115 && (r + g) > (b * 2.2);

      if (isWhiteText || isYellowText) {
        labWhiteYellowCount++;
      }

      sampledCount++;
    }
  }

  // 2. Compute Sobel/Canny-style edge gradient on sampled grayscale grid
  const sampleH = Math.floor(height / stepY);
  // Edge threshold scales with filter strength (higher strength = requires crisper edges)
  const baseEdgeThresh = 20 + Math.floor((filterStrength / 100) * 16);

  for (let sy = 1; sy < sampleH - 1; sy++) {
    const rowOffset = sy * sampleW;
    const prevRow = rowOffset - sampleW;
    const nextRow = rowOffset + sampleW;

    for (let sx = 1; sx < sampleW - 1; sx++) {
      // Sobel Gx and Gy
      const gx =
        -grayscale[prevRow + sx - 1] + grayscale[prevRow + sx + 1]
        -2 * grayscale[rowOffset + sx - 1] + 2 * grayscale[rowOffset + sx + 1]
        -grayscale[nextRow + sx - 1] + grayscale[nextRow + sx + 1];

      const gy =
        -grayscale[prevRow + sx - 1] - 2 * grayscale[prevRow + sx] - grayscale[prevRow + sx + 1]
        +grayscale[nextRow + sx - 1] + 2 * grayscale[nextRow + sx] + grayscale[nextRow + sx + 1];

      const gradMag = Math.abs(gx) + Math.abs(gy);
      if (gradMag > baseEdgeThresh * 4) {
        edgeNonZeroCount++;
      }
    }
  }

  const edgeRatio = sampledCount > 0 ? edgeNonZeroCount / sampledCount : 0;
  const labRatio = sampledCount > 0 ? labWhiteYellowCount / sampledCount : 0;
  const meanL = sumL / (sampledCount || 1);
  const varianceL = Math.max(0, sumL2 / (sampledCount || 1) - meanL * meanL);
  const labColorDelta = maxL - minL;

  // Dynamic threshold based on "Độ mạnh lọc chữ nền" (filterStrength 0% -> 100%)
  // - Low strength (e.g. 0-25%): Low thresholds (high recall, keeps faint & short text)
  // - High strength (e.g. 70-100%): Strict thresholds (rejects background logos/noise)
  const strengthFactor = Math.max(0, Math.min(100, filterStrength)) / 100;
  // Tuned for high sensitivity on short 3-4 character subtitles in wide aspect ratio ROIs
  const minLabRatioThresh = 0.0003 + strengthFactor * 0.0035; // 0.03% to 0.38% pixel density
  const minEdgeRatioThresh = 0.0001 + strengthFactor * 0.0025; // 0.01% to 0.26% edge density

  let hasText = false;
  let detectionSource: 'LAB' | 'CANNY' | 'NONE' = 'NONE';

  // Rule 1: LAB White/Yellow detection (supports short phrases of 3-4 Chinese chars)
  if ((labRatio >= minLabRatioThresh || labWhiteYellowCount >= 8) && (varianceL >= 0.4 || labColorDelta >= 2.0)) {
    hasText = true;
    detectionSource = 'LAB';
  }
  // Rule 2: Canny Edge detection (for arbitrary color text or short CJK glyphs)
  else if ((edgeRatio >= minEdgeRatioThresh || edgeNonZeroCount >= 6) && (varianceL >= 0.6 || labColorDelta >= 2.5)) {
    hasText = true;
    detectionSource = 'CANNY';
  }

  const decision: TextPresenceDecision = {
    hasText,
    edgeNonZero: edgeNonZeroCount,
    edgeRatio,
    labLuminanceVariance: varianceL,
    labColorDelta,
    labNonZero: labWhiteYellowCount,
    detectionSource,
  };

  lastGridCache = { grid: currGrid, decision, filterStrength };
  return decision;
}

/**
 * Strategy 2: Thuật toán Đệm Đa Khung Hình (Temporal Padding / Look-ahead)
 * Scans extracted sequence of frames: If Frame X is reported as hasText = false by heuristics,
 * but Frame X-1 and Frame X+1 (or frames within 0.25s) both have text,
 * overrides Frame X to hasText = true. Subtitles cannot physically vanish for 0.05s mid-sentence.
 */
export interface FramePresenceItem {
  timestamp: number;
  hasText: boolean;
  [key: string]: any;
}

export function applyTemporalPaddingLookAhead<T extends FramePresenceItem>(frames: T[], maxGapSec: number = 0.25): T[] {
  if (!frames || frames.length < 3) return frames;

  const n = frames.length;
  for (let i = 1; i < n - 1; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const next = frames[i + 1];

    if (!curr.hasText) {
      const prevHasText = prev.hasText;
      const nextHasText = next.hasText;
      const gapPrev = curr.timestamp - prev.timestamp;
      const gapNext = next.timestamp - curr.timestamp;

      // If sandwiched between active text frames within maxGapSec (e.g. 0.25s), override!
      if (prevHasText && nextHasText && gapPrev <= maxGapSec && gapNext <= maxGapSec) {
        curr.hasText = true;
      }
    }
  }

  return frames;
}

/**
 * Technique 1: Sharpness / Clarity Metric using Laplacian Variance (Gradient-Energy Metric)
 * Measures image sharpness in the ROI region. Higher variance = crisp text edges without motion blur.
 */
export function computeLaplacianVariance(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  if (!pixelData || pixelData.length < 16 || width < 5 || height < 5) return 0;

  const stride = width * 4;
  let sumLap = 0;
  let sumLap2 = 0;
  let count = 0;

  // Sample with step 2 for high performance
  const step = 2;
  for (let y = step; y < height - step; y += step) {
    const row = y * stride;
    const prevRow = (y - step) * stride;
    const nextRow = (y + step) * stride;

    for (let x = step; x < width - step; x += step) {
      const idx = row + x * 4;
      const luma = 0.299 * pixelData[idx] + 0.587 * pixelData[idx + 1] + 0.114 * pixelData[idx + 2];

      const lumaUp = 0.299 * pixelData[prevRow + x * 4] + 0.587 * pixelData[prevRow + x * 4 + 1] + 0.114 * pixelData[prevRow + x * 4 + 2];
      const lumaDown = 0.299 * pixelData[nextRow + x * 4] + 0.587 * pixelData[nextRow + x * 4 + 1] + 0.114 * pixelData[nextRow + x * 4 + 2];
      const lumaLeft = 0.299 * pixelData[row + (x - step) * 4] + 0.587 * pixelData[row + (x - step) * 4 + 1] + 0.114 * pixelData[row + (x - step) * 4 + 2];
      const lumaRight = 0.299 * pixelData[row + (x + step) * 4] + 0.587 * pixelData[row + (x + step) * 4 + 1] + 0.114 * pixelData[row + (x + step) * 4 + 2];

      // 4-neighbor discrete Laplacian kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
      const lap = lumaUp + lumaDown + lumaLeft + lumaRight - 4 * luma;
      sumLap += lap;
      sumLap2 += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const meanLap = sumLap / count;
  return Math.max(0, sumLap2 / count - meanLap * meanLap);
}

/**
 * Technique 3: Contrast-Based Double Check Override (Double-Check Pipeline)
 * Checks if the ROI contains high-contrast text edge boundaries (signifying active subtitle characters).
 * Overrides SSIM / frame-diff skip decisions when camera motion (pan/zoom) occurs.
 */
export function shouldOverrideFrameSkip(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  filterStrength: number = 25
): boolean {
  if (!pixelData || pixelData.length < 16) return false;
  const presence = detectTextPresenceInFrame(pixelData, width, height, filterStrength);
  // High contrast text edges or presence detected (supports short 3-4 character lines)
  return presence.hasText || presence.edgeRatio >= 0.001 || presence.labLuminanceVariance >= 6.0;
}

/**
 * Compute pixel difference score between two consecutive frame buffers in the subtitle ROI.
 * Returns normalized difference value (0.0 to 100+).
 * Conservative scores >= 8.0 indicate a genuine subtitle transition (text appearing, disappearing, or changing).
 */
export function computeFrameDiffScore(
  currData: Uint8ClampedArray | Uint8Array,
  prevData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  if (!currData || !prevData || currData.length < 16 || prevData.length < 16 || currData.length !== prevData.length) {
    return 0;
  }

  let totalDiff = 0;
  let sampledCount = 0;
  // Sample every 4th pixel in RGB space (4 bytes) (2x speedup)
  const step = 4 * 4;

  for (let i = 0; i < currData.length; i += step) {
    const r1 = currData[i];
    const g1 = currData[i + 1];
    const b1 = currData[i + 2];

    const r2 = prevData[i];
    const g2 = prevData[i + 1];
    const b2 = prevData[i + 2];

    // Grayscale luminance
    const l1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
    const l2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;

    const diff = Math.abs(l1 - l2);
    // Ignore video noise / compression artifacts below threshold 22
    if (diff > 22) {
      totalDiff += diff;
    }
    sampledCount++;
  }

  return sampledCount > 0 ? totalDiff / sampledCount : 0;
}

export interface RoiDiffResult {
  isDuplicate: boolean;
  isNearDuplicate?: boolean;
  l1Mean: number;
  changedPixelRatio: number;
}

/**
 * Trick 1: Subtitle Region Hash / Pixel Difference (L1 Mean)
 * Computes fast L1 Mean pixel difference & significant pixel change ratio
 * in the subtitle ROI.
 * Returns isDuplicate: true if subtitle text is unchanged.
 */
export function checkRoiSubtitleDuplicate(
  currPixels: Uint8ClampedArray | Uint8Array,
  prevPixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  l1Threshold: number = 1.8,
  ratioThreshold: number = 0.005
): RoiDiffResult {
  if (!currPixels || !prevPixels || currPixels.length < 16 || prevPixels.length < 16 || currPixels.length !== prevPixels.length) {
    return { isDuplicate: false, isNearDuplicate: false, l1Mean: 999, changedPixelRatio: 1.0 };
  }

  let totalL1Diff = 0;
  let significantChanges = 0;
  let sampledCount = 0;

  // Sample every 4th pixel in RGBA space (stride = 16 bytes) for 4x performance speedup
  const step = 4 * 4;
  const len = currPixels.length;

  for (let i = 0; i < len; i += step) {
    const r1 = currPixels[i];
    const g1 = currPixels[i + 1];
    const b1 = currPixels[i + 2];

    const r2 = prevPixels[i];
    const g2 = prevPixels[i + 1];
    const b2 = prevPixels[i + 2];

    const y1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
    const y2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;

    const diff = Math.abs(y1 - y2);
    totalL1Diff += diff;

    // Trigger on subtle pixel changes (diff > 8) to catch fast character or word changes in clean RGBA pixelData
    if (diff > 8) {
      significantChanges++;
    }
    sampledCount++;
  }

  if (sampledCount === 0) {
    return { isDuplicate: false, isNearDuplicate: false, l1Mean: 999, changedPixelRatio: 1.0 };
  }

  const l1Mean = totalL1Diff / sampledCount;
  const changedPixelRatio = significantChanges / sampledCount;

  // A frame is duplicate if both the mean absolute difference (L1) and the ratio of significantly changed pixels are below thresholds
  const isDuplicate = l1Mean <= l1Threshold && changedPixelRatio <= ratioThreshold;
  const isNearDuplicate = isDuplicate || (l1Mean <= (l1Threshold * 1.8) && changedPixelRatio <= (ratioThreshold * 2.5));

  return { isDuplicate, isNearDuplicate, l1Mean, changedPixelRatio };
}

/**
 * 3. [BinarizeMLKit] / High-Contrast & Stroke Sharpening Enhancement
 * Pre-processes canvas or ImageData to sharpen text stroke contrast & remove dynamic background gradient
 */
export function applyBinarizationAndContrast(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'none' | 'contrast' | 'binarize' | 'adaptive' = 'contrast',
  strengthPercent: number = 30
): void {
  if (mode === 'none' || strengthPercent <= 0 || width <= 0 || height <= 0) return;

  try {
    // Try OpenCV C++ CLAHE enhancement first
    if (isOpenCVLoaded() && (mode === 'contrast' || mode === 'adaptive')) {
      const ok = enhanceImageOpenCV(ctx, width, height, 2.5, 8);
      if (ok) return;
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const factor = 1 + (strengthPercent / 100) * 1.8;

    if (mode === 'contrast' || mode === 'adaptive') {
      // Soft contrast stretch on bright subtitle text, darkening lower background luma
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        if (luma < 70) {
          // Suppress dark background to prevent texture false positives
          data[i] = Math.max(0, Math.round(r * 0.45));
          data[i + 1] = Math.max(0, Math.round(g * 0.45));
          data[i + 2] = Math.max(0, Math.round(b * 0.45));
        } else {
          // Stretch text stroke brightness and sharpen character borders
          data[i] = Math.min(255, Math.max(0, Math.round((r - 120) * factor + 128)));
          data[i + 1] = Math.min(255, Math.max(0, Math.round((g - 120) * factor + 128)));
          data[i + 2] = Math.min(255, Math.max(0, Math.round((b - 120) * factor + 128)));
        }
      }
    } else if (mode === 'binarize') {
      // Otsu-style thresholding / adaptive binarization
      let sumL = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumL += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const avgThresh = Math.min(185, Math.max(75, sumL / (data.length / 4)));

      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = luma >= avgThresh ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (err) {
    console.warn('applyBinarizationAndContrast error:', err);
  }
}

/**
 * 4. [Scale] / [ScaleFilter]
 * Calculates optimal width and height to scale subtitle cropped bitmap so vertical stroke height is ~64px - 112px
 */
export function scaleFrameBitmap(
  cropWidth: number,
  cropHeight: number,
  targetMinHeight: number = 64,
  targetMaxHeight: number = 112
): { targetWidth: number; targetHeight: number; scaleFactor: number } {
  if (cropWidth <= 0 || cropHeight <= 0) {
    return { targetWidth: 320, targetHeight: 64, scaleFactor: 1.0 };
  }

  let scaleFactor = 1.0;
  if (cropHeight < targetMinHeight) {
    scaleFactor = targetMinHeight / cropHeight;
  } else if (cropHeight > targetMaxHeight) {
    scaleFactor = targetMaxHeight / cropHeight;
  }

  // Constrain width so tensor remains within 32px to 1280px
  let targetWidth = Math.round(cropWidth * scaleFactor);
  let targetHeight = Math.round(cropHeight * scaleFactor);

  if (targetWidth > 1280) {
    const downScale = 1280 / targetWidth;
    targetWidth = 1280;
    targetHeight = Math.round(targetHeight * downScale);
  }

  targetWidth = Math.max(32, targetWidth);
  targetHeight = Math.max(32, targetHeight);

  return { targetWidth, targetHeight, scaleFactor };
}

/**
 * Fast vertical ROI cropping directly on raw pixel buffer with horizontal cap (det_limit_side_len <= 960px).
 * Extracts [0, yStart, width, cropHeight] without canvas overhead, saving 75-85% pixel compute.
 */
export function cropPixelDataVertical(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  yPercent: number,
  heightPercent: number,
  maxDetectionWidth: number = 960
): { cropped: Uint8ClampedArray; width: number; height: number; offsetY: number } {
  const safeYPct = Math.max(0, Math.min(95, yPercent));
  const safeHPct = Math.max(5, Math.min(100 - safeYPct, heightPercent));

  const startY = Math.floor((safeYPct / 100) * height);
  const cropH = Math.max(16, Math.min(height - startY, Math.floor((safeHPct / 100) * height)));
  const rowByteSize = width * 4;

  const srcByteOffset = startY * rowByteSize;
  const copyLength = cropH * rowByteSize;

  if (srcByteOffset + copyLength > src.length) {
    return { cropped: new Uint8ClampedArray(src), width, height, offsetY: 0 };
  }

  // If width is already within optimal detection limit (<= 960px), copy directly
  if (width <= maxDetectionWidth) {
    const cropped = new Uint8ClampedArray(cropH * rowByteSize);
    cropped.set(src.subarray(srcByteOffset, srcByteOffset + copyLength));
    return { cropped, width, height: cropH, offsetY: startY };
  }

  // Downsample horizontal resolution (e.g. 1080p -> 960px, 4K -> 960px) for ultra-fast DBNet detection
  const targetW = maxDetectionWidth;
  const cropped = new Uint8ClampedArray(cropH * targetW * 4);
  const scaleX = width / targetW;

  for (let y = 0; y < cropH; y++) {
    const srcRow = (startY + y) * width * 4;
    const dstRow = y * targetW * 4;
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(width - 1, Math.floor(x * scaleX));
      const srcIdx = srcRow + srcX * 4;
      const dstIdx = dstRow + x * 4;
      cropped[dstIdx] = src[srcIdx];
      cropped[dstIdx + 1] = src[srcIdx + 1];
      cropped[dstIdx + 2] = src[srcIdx + 2];
      cropped[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  return { cropped, width: targetW, height: cropH, offsetY: startY };
}

/**
 * Scans vertical row luminance & edge density profile to estimate the Y% and Height% of active subtitle text.
 */
export function estimateTextVerticalRoi(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): { yPercent: number; heightPercent: number } | null {
  if (!pixelData || width < 16 || height < 16) return null;
  const rowActivity = new Float32Array(height);
  const stepX = Math.max(1, Math.floor(width / 80));

  for (let y = 0; y < height; y++) {
    let act = 0;
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += stepX) {
      const idx = rowOffset + x * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      // High contrast text luminance or saturated colored subtitle (yellow/white/cyan)
      if (luma >= 165 || (r >= 150 && g >= 140 && b <= 110)) {
        act++;
      }
    }
    rowActivity[y] = act;
  }

  // Find continuous high-activity band (typical subtitle window ~18-24% screen height)
  const windowSize = Math.floor(height * 0.22);
  let maxBandSum = 0;
  let bestStart = -1;
  let curSum = 0;

  for (let y = 0; y < windowSize && y < height; y++) {
    curSum += rowActivity[y];
  }
  maxBandSum = curSum;
  bestStart = 0;

  for (let y = windowSize; y < height; y++) {
    curSum += rowActivity[y] - rowActivity[y - windowSize];
    if (curSum > maxBandSum) {
      maxBandSum = curSum;
      bestStart = y - windowSize + 1;
    }
  }

  if (maxBandSum < 10) return null;

  const yPercent = Math.max(0, Math.min(95, (bestStart / height) * 100));
  const heightPercent = Math.max(10, Math.min(40, (windowSize / height) * 100));

  return {
    yPercent: Number(yPercent.toFixed(1)),
    heightPercent: Number(heightPercent.toFixed(1)),
  };
}

/**
 * 5. [Calibrate] (lock calibratedHeight / ROI Lock)
 * Auto-calibrates active subtitle region vertically across video frames
 */
export class SubtitleRoiCalibrator {
  private detectedYRanges: { yPercent: number; heightPercent: number }[] = [];
  private lockedRoi: RoiCalibrationResult = {
    isCalibrated: false,
    calibratedYPercent: 75,
    calibratedHeightPercent: 20,
    sampleCount: 0,
  };

  public recordDetection(yPercent: number, heightPercent: number): void {
    if (yPercent <= 0 || heightPercent <= 0) return;
    this.detectedYRanges.push({ yPercent, heightPercent });

    // Calibrate once we have 3 or more detections
    if (this.detectedYRanges.length >= 3) {
      const sortedY = [...this.detectedYRanges].sort((a, b) => a.yPercent - b.yPercent);
      const medianY = sortedY[Math.floor(sortedY.length / 2)].yPercent;

      const sortedH = [...this.detectedYRanges].sort((a, b) => a.heightPercent - b.heightPercent);
      const medianH = sortedH[Math.floor(sortedH.length / 2)].heightPercent;

      // Expand ROI slightly by 2% buffer top/bottom for padding
      this.lockedRoi = {
        isCalibrated: true,
        calibratedYPercent: Math.max(0, Number((medianY - 2).toFixed(1))),
        calibratedHeightPercent: Math.min(100, Number((medianH + 4).toFixed(1))),
        sampleCount: this.detectedYRanges.length,
      };
    }
  }

  public getLockedRoi(): RoiCalibrationResult {
    return this.lockedRoi;
  }

  public reset(): void {
    this.detectedYRanges = [];
    this.lockedRoi = {
      isCalibrated: false,
      calibratedYPercent: 75,
      calibratedHeightPercent: 20,
      sampleCount: 0,
    };
  }
}

/**
 * 6. [Unsharp Mask]
 * Sharpens blurry character strokes from compressed video sources before ONNX OCR inference
 */
export function applyUnsharpMask(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number = 1.3,
  radius: number = 1
): void {
  if (w <= 0 || h <= 0) return;
  try {
    const src = ctx.getImageData(0, 0, w, h);
    const blurred = ctx.getImageData(0, 0, w, h);
    boxBlur(blurred.data, w, h, radius);
    const out = src.data;
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = src.data[i + c] - blurred.data[i + c];
        out[i + c] = Math.min(255, Math.max(0, Math.round(src.data[i + c] + diff * amount)));
      }
    }
    ctx.putImageData(src, 0, 0);
  } catch (e) {
    console.warn('Unsharp mask failed:', e);
  }
}

function boxBlur(data: Uint8ClampedArray, w: number, h: number, r: number) {
  const tmp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const idx = (y * w + nx) * 4;
        sr += data[idx];
        sg += data[idx + 1];
        sb += data[idx + 2];
        cnt++;
      }
      const idx = (y * w + x) * 4;
      tmp[idx] = sr / cnt;
      tmp[idx + 1] = sg / cnt;
      tmp[idx + 2] = sb / cnt;
      tmp[idx + 3] = data[idx + 3];
    }
  }
  data.set(tmp);
}

export interface HorizontalCropBounds {
  cropX: number;
  cropW: number;
  isTightCropped: boolean;
}

/**
 * Calculates the tight horizontal bounding box around active subtitle text inside a wide ROI crop.
 * Prevents PaddleOCR from misrecognizing short 1-2 character CJK subtitles in wide ROI boxes
 * by cropping out empty background margins before feeding into DBNet / CRNN models.
 */
export function findHorizontalTextBounds(
  pixelData: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): HorizontalCropBounds {
  if (!pixelData || width < 40 || height < 10) {
    return { cropX: 0, cropW: width, isTightCropped: false };
  }

  const colTextCount = new Uint16Array(width);
  const stride = width * 4;

  // Scan vertical columns
  for (let y = 1; y < height - 1; y += 2) {
    const rowOffset = y * stride;
    const prevRow = rowOffset - stride;
    const nextRow = rowOffset + stride;

    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      const gx = Math.abs(pixelData[idx + 4] - pixelData[idx - 4]);
      const gy = Math.abs(pixelData[nextRow + x * 4] - pixelData[prevRow + x * 4]);

      const isBright = luma >= 145 || (r >= 135 && g >= 125 && b <= 125);
      const isEdge = (gx + gy) > 55;

      if (isBright || isEdge) {
        colTextCount[x]++;
      }
    }
  }

  // Smooth column counts with 3-column moving window
  const smoothed = new Uint16Array(width);
  for (let x = 1; x < width - 1; x++) {
    smoothed[x] = (colTextCount[x - 1] + colTextCount[x] * 2 + colTextCount[x + 1]) >> 2;
  }

  const activeThreshold = Math.max(2, Math.floor(height * 0.08));
  let minX = -1;
  let maxX = -1;

  for (let x = 0; x < width; x++) {
    if (smoothed[x] >= activeThreshold) {
      if (minX === -1) minX = x;
      maxX = x;
    }
  }

  if (minX === -1 || maxX === -1 || (maxX - minX) < 8) {
    return { cropX: 0, cropW: width, isTightCropped: false };
  }

  // Add 28px safety margin padding to left and right
  const pad = 28;
  const tightMinX = Math.max(0, minX - pad);
  const tightMaxX = Math.min(width - 1, maxX + pad);
  const cropW = tightMaxX - tightMinX + 1;

  // If text already spans more than 85% of ROI width, use full width
  if (cropW >= width * 0.85) {
    return { cropX: 0, cropW: width, isTightCropped: false };
  }

  // Ensure minimum width of at least Math.max(100, height * 2.0) so PaddleOCR gets clean aspect ratio
  const minRequiredW = Math.max(100, Math.floor(height * 2.0));
  if (cropW < minRequiredW) {
    const center = Math.floor((tightMinX + tightMaxX) / 2);
    const half = Math.floor(minRequiredW / 2);
    const adjMinX = Math.max(0, center - half);
    const adjMaxX = Math.min(width - 1, adjMinX + minRequiredW - 1);
    return {
      cropX: adjMinX,
      cropW: adjMaxX - adjMinX + 1,
      isTightCropped: true,
    };
  }

  return {
    cropX: tightMinX,
    cropW,
    isTightCropped: true,
  };
}

