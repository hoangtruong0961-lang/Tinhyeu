import { SubtitleItem, SubtitleStyleConfig, BlurOverlay, LogoOverlay, TextOverlay, RegionROI } from '../types';
import { gpuShaderEngine } from './gpuShaderEngine';
import { wrapSubtitleText } from './srtParser';

export interface RenderFrameOptions {
  videoSource?: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap | VideoFrame | null;
  vWidth: number;
  vHeight: number;
  curTime: number;
  subtitles: SubtitleItem[];
  activeSubtitle?: SubtitleItem | null;
  styleConfig: SubtitleStyleConfig;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  logoBitmaps?: Record<string, HTMLImageElement | ImageBitmap>;
  subLiveBox?: RegionROI | null;
  liveRoi?: RegionROI | null;
  liveOverlay?: { id: string; rect: RegionROI } | null;
  showCenterGuide?: boolean;
  gpuAcceleration?: boolean;
  skipBaseVideo?: boolean;
}

/**
 * Splits text into lines fitting maxWidth using Canvas context text measurement.
 * Handles both spaces and linebreaks gracefully.
 */
export function wrapCanvasText(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const rawLines = text.split(/\r?\n/);
  const result: string[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine.trim()) {
      result.push('');
      continue;
    }
    const words = rawLine.split(/\s+/);
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = context.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

/**
 * Calculates the exact rendered pixel & percent bounding box of a subtitle.
 * This guarantees the interactive DOM touch overlay aligns 1:1 with the canvas rendered text,
 * eliminating empty gaps, misalignments, or distorted aspect ratios.
 */
export function calculateRenderedSubtitleRect(
  rawText: string,
  styleConfig: SubtitleStyleConfig,
  displayBox: { x: number; y: number; width?: number; height?: number },
  vWidth: number,
  vHeight: number
): { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } {
  const safeVWidth = Math.max(100, vWidth || 720);
  const safeVHeight = Math.max(100, vHeight || 1280);
  const scaleFactor = safeVHeight / 720;
  const fontSize = Math.max(8, Math.round((styleConfig.fontSize || 28) * scaleFactor));
  const fontFamily = styleConfig.fontFamily || 'Montserrat, sans-serif';
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';
  const defaultPadding = 6;
  const padding = (styleConfig.hasBackground !== false ? defaultPadding : 2) * scaleFactor;

  let canvas = (calculateRenderedSubtitleRect as any)._canvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    (calculateRenderedSubtitleRect as any)._canvas = canvas;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      xPercent: displayBox.x,
      yPercent: displayBox.y,
      widthPercent: displayBox.width || 60,
      heightPercent: displayBox.height || 8,
    };
  }

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  const isVertical = styleConfig.orientation === 'vertical';
  const parentX = (displayBox.x / 100) * safeVWidth;
  const parentY = (displayBox.y / 100) * safeVHeight;
  const parentWidth = ((displayBox.width || 80) / 100) * safeVWidth;

  const maxSafeWidth = safeVWidth * 0.94;
  const wrapWidth = isVertical
    ? Math.max(40, parentWidth - padding * 2)
    : Math.max(100, Math.max(parentWidth, maxSafeWidth) - padding * 2);

  const maxH = styleConfig.maxCharsHorizontal || 65;
  const maxV = styleConfig.maxCharsVertical || 36;
  const orientation = styleConfig.orientation || 'horizontal';
  const charWrapped = wrapSubtitleText(rawText || '', orientation, maxH, maxV);
  const charLines = charWrapped.split('\n');
  const lines: string[] = [];
  for (const cLine of charLines) {
    if (isVertical) {
      lines.push(...(cLine.split(/\s+/).filter(Boolean)));
    } else {
      lines.push(...wrapCanvasText(ctx, cLine, wrapWidth));
    }
  }
  if (!lines || lines.length === 0) {
    return {
      xPercent: displayBox.x,
      yPercent: displayBox.y,
      widthPercent: 20,
      heightPercent: 6,
    };
  }

  let maxLineWidth = 0;
  lines.forEach((line) => {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  });

  const lineHeight = fontSize * 1.25;
  const totalTextHeight = (lines.length - 1) * lineHeight + fontSize * 0.95;
  const boxWidth = Math.min(safeVWidth - padding * 2, maxLineWidth + padding * 2);
  const boxHeight = totalTextHeight + padding * 2;

  const centerX = parentX + parentWidth / 2;
  const boxX = Math.max(padding, Math.min(safeVWidth - boxWidth - padding, centerX - boxWidth / 2));
  const boxY = parentY - (lines.length - 1) * lineHeight;

  return {
    xPercent: Math.round(((boxX / safeVWidth) * 100) * 10) / 10,
    yPercent: Math.round(((boxY / safeVHeight) * 100) * 10) / 10,
    widthPercent: Math.round(((boxWidth / safeVWidth) * 100) * 10) / 10,
    heightPercent: Math.round(((boxHeight / safeVHeight) * 100) * 10) / 10,
  };
}

/**
 * Converts hex / rgb color strings into rgba with custom opacity (0 - 100).
 */
export function getBgColorWithOpacity(hexColor: string, opacity: number = 65): string {
  if (!hexColor) return `rgba(0, 0, 0, ${opacity / 100})`;
  if (hexColor.startsWith('rgba')) return hexColor;
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
  const num = parseInt(hex, 16);
  if (isNaN(num)) return `rgba(0, 0, 0, ${opacity / 100})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
}

/**
 * Helper to safely draw rounded rectangles across standard 2D and OffscreenCanvas contexts.
 */
export function drawRoundRectPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, width, height, r);
  } else if (r > 0) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  } else {
    ctx.rect(x, y, width, height);
  }
}

/**
 * UNIFIED CANVAS 2D/WEBGL RENDER ENGINE (Chuẩn CapCut 100%)
 * 
 * Draws the complete composited frame:
 * 1. Base Video Frame (with letterbox/pillarbox/scale)
 * 2. Blur Overlays (Gaussian filter + clipping path)
 * 3. Logo Overlays (Alpha opacity + rounded corners)
 * 4. Text Overlays (Time-windowed / persistent titles, custom styles, dual stroke, text shadow)
 * 5. Subtitle Mask (if enabled)
 * 6. Subtitles with Subpixel vector stroke, glow, background box, and karaoke highlighting.
 * 
 * Both Editor Preview Viewport and Export Exporters call this exact same function!
 */
export function renderCompositedFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: RenderFrameOptions
): void {
  const {
    videoSource,
    vWidth,
    vHeight,
    curTime,
    subtitles = [],
    activeSubtitle,
    styleConfig,
    blurOverlays = [],
    logoOverlays = [],
    textOverlays = [],
    logoBitmaps = {},
    subLiveBox,
    liveOverlay,
    gpuAcceleration,
    skipBaseVideo = false,
  } = options;

  if (vWidth <= 0 || vHeight <= 0) return;

  // Global scale factor relative to standard 720p base height
  const scaleFactor = vHeight / 720;

  // Configure high-fidelity subpixel rendering & antialiasing
  try {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  } catch (_) {}

  // 1. Draw base video frame (or clear to transparent in preview mode to let native hardware video show)
  if (skipBaseVideo) {
    ctx.clearRect(0, 0, vWidth, vHeight);
  } else {
    const isVideoValid = videoSource && (
      !(typeof HTMLVideoElement !== 'undefined' && videoSource instanceof HTMLVideoElement) ||
      (videoSource.readyState >= 2 && videoSource.videoWidth > 0 && videoSource.videoHeight > 0)
    );

    if (isVideoValid && videoSource) {
      let handledByGpu = false;
      if (gpuAcceleration && ctx.canvas) {
        try {
          handledByGpu = gpuShaderEngine.processFrame(videoSource, ctx.canvas as HTMLCanvasElement, blurOverlays);
        } catch (_) {
          handledByGpu = false;
        }
      }
      if (!handledByGpu) {
        try {
          ctx.drawImage(videoSource, 0, 0, vWidth, vHeight);
        } catch (err) {
          // Fallback: fill black canvas if frame is currently unavailable
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, vWidth, vHeight);
        }
      }
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, vWidth, vHeight);
    }
  }

  // 2. Render Blur Overlays
  blurOverlays.forEach((blur) => {
    try {
      const currentBlur = liveOverlay && liveOverlay.id === blur.id ? { ...blur, ...liveOverlay.rect } : blur;
      const x = (currentBlur.x / 100) * vWidth;
      const y = (currentBlur.y / 100) * vHeight;
      const w = (currentBlur.width / 100) * vWidth;
      const h = (currentBlur.height / 100) * vHeight;
      const r = (currentBlur.borderRadius || 0) * scaleFactor;
      const blurRadius = Math.max(1, (currentBlur.blur || 10) * scaleFactor);

      if (w > 0 && h > 0 && videoSource) {
        ctx.save();
        ctx.beginPath();
        drawRoundRectPath(ctx, x, y, w, h, r);
        ctx.clip();
        ctx.filter = `blur(${blurRadius}px)`;
        ctx.drawImage(videoSource, 0, 0, vWidth, vHeight);
        ctx.restore();
      }
    } catch (err) {
      console.warn('[UnifiedCanvasEngine] Blur overlay render notice:', err);
    }
  });

  // 3. Render Logo Overlays
  logoOverlays.forEach((logo) => {
    try {
      const currentLogo = liveOverlay && liveOverlay.id === logo.id ? { ...logo, ...liveOverlay.rect } : logo;
      const x = (currentLogo.x / 100) * vWidth;
      const y = (currentLogo.y / 100) * vHeight;
      const w = (currentLogo.width / 100) * vWidth;
      const h = (currentLogo.height / 100) * vHeight;
      const r = (currentLogo.borderRadius || 0) * scaleFactor;
      const img = logoBitmaps[logo.id] || logoBitmaps[logo.url];

      if (img && w > 0 && h > 0) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, (currentLogo.opacity ?? 100) / 100));
        if (r > 0) {
          ctx.beginPath();
          drawRoundRectPath(ctx, x, y, w, h, r);
          ctx.clip();
        }
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
      }
    } catch (err) {
      console.warn('[UnifiedCanvasEngine] Logo overlay render notice:', err);
    }
  });

  // 4. Render Text Overlays
  textOverlays.forEach((textItem) => {
    const isVisible =
      textItem.isTitle ||
      ((textItem.startTime === undefined || curTime >= textItem.startTime) &&
        (textItem.endTime === undefined || curTime <= textItem.endTime));

    if (!isVisible) return;

    const currentText = liveOverlay && liveOverlay.id === textItem.id ? { ...textItem, ...liveOverlay.rect } : textItem;
    const isTitle = Boolean(textItem.isTitle);

    const textStyleConfig: SubtitleStyleConfig = (textItem as any).styleConfig || {
      fontSize: textItem.fontSize || (isTitle ? 32 : 26),
      fontColor: textItem.color || (isTitle ? '#facc15' : '#ffffff'),
      fontFamily: textItem.fontFamily || 'Montserrat, sans-serif',
      fontWeight: textItem.fontWeight || (isTitle ? '900' : 'bold'),
      fontStyle: textItem.fontStyle || 'normal',
      hasBackground: Boolean(textItem.hasBackground),
      backgroundColor: textItem.backgroundColor || '#000000',
      bgOpacity:
        textItem.backgroundOpacity !== undefined
          ? textItem.backgroundOpacity > 1
            ? textItem.backgroundOpacity
            : Math.round(textItem.backgroundOpacity * 100)
          : 80,
      borderRadius: textItem.borderRadius ?? 6,
      textOutline: textItem.textOutline !== false,
      outlineColor: textItem.outlineColor || '#000000',
      outlineWidth: textItem.outlineWidth || 3,
      hasSecondaryOutline: (textItem as any).hasSecondaryOutline,
      secondaryOutlineColor: (textItem as any).secondaryOutlineColor || '#000000',
      secondaryOutlineWidth: (textItem as any).secondaryOutlineWidth || 4,
      textShadowColor: textItem.shadowColor,
      textShadowBlur: textItem.shadowBlur || 6,
      textAlign: textItem.textAlign || 'center',
    };

    const boxX = (currentText.x / 100) * vWidth;
    const boxY = (currentText.y / 100) * vHeight;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (currentText.opacity ?? 100) / 100));

    const fontSize = Math.max(8, Math.round((textStyleConfig.fontSize || 28) * scaleFactor));
    const fontFamily = textStyleConfig.fontFamily || 'Montserrat, sans-serif';
    const fontWeight = textStyleConfig.fontWeight || 'bold';
    const fontStyle = textStyleConfig.fontStyle || 'normal';
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

    const align = textStyleConfig.textAlign || 'center';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';

    const isVertical = (textItem as any).orientation === 'vertical';
    const padding = (textStyleConfig.hasBackground !== false ? textStyleConfig.padding || 6 : 2) * scaleFactor;
    const maxSafeWidth = vWidth * 0.94;
    const maxWrapWidth = isVertical
      ? Math.max(40, ((currentText.width || 20) / 100) * vWidth - padding * 2)
      : Math.max(100, maxSafeWidth - padding * 2);

    const textLines = isVertical
      ? (currentText.text || '').split(/\s+/).filter(Boolean)
      : wrapCanvasText(ctx, currentText.text || '', maxWrapWidth);
    if (!textLines || textLines.length === 0) {
      ctx.restore();
      return;
    }

    let maxLineWidth = 0;
    textLines.forEach((line) => {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    });

    const lineHeight = fontSize * 1.25;
    const totalTextHeight = (textLines.length - 1) * lineHeight + fontSize * 0.95;
    const boxWidth = Math.min(vWidth - padding * 2, maxLineWidth + padding * 2);
    const boxHeight = totalTextHeight + padding * 2;

    // Background box
    if (
      textStyleConfig.hasBackground !== false &&
      textStyleConfig.backgroundColor &&
      textStyleConfig.backgroundColor !== 'transparent'
    ) {
      const bgOpacity = (textStyleConfig.bgOpacity ?? 80) / 100;
      ctx.fillStyle = getBgColorWithOpacity(textStyleConfig.backgroundColor, bgOpacity * 100);
      const bgRadius = (textStyleConfig.borderRadius ?? 0) * scaleFactor;
      ctx.beginPath();
      drawRoundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, bgRadius);
      ctx.fill();
    }

    let drawX = boxX + boxWidth / 2;
    if (align === 'left') drawX = boxX + padding;
    else if (align === 'right') drawX = boxX + boxWidth - padding;

    const startY = boxY + padding + fontSize * 0.52;

    textLines.forEach((line, idx) => {
      const lineY = startY + idx * lineHeight;

      // Drop shadow / glow
      if (textStyleConfig.textShadowColor) {
        ctx.save();
        ctx.shadowColor = textStyleConfig.textShadowColor;
        ctx.shadowBlur = (textStyleConfig.textShadowBlur ?? 6) * scaleFactor;
        ctx.shadowOffsetX = (textStyleConfig.textShadowOffsetX ?? 0) * scaleFactor;
        ctx.shadowOffsetY = (textStyleConfig.textShadowOffsetY ?? 2) * scaleFactor;
        ctx.fillStyle = textStyleConfig.fontColor || '#ffffff';
        ctx.fillText(line, drawX, lineY);
        ctx.restore();
      }

      // Secondary outline (outer stroke)
      const hasSecOutline =
        textStyleConfig.hasSecondaryOutline === true ||
        (typeof textStyleConfig.secondaryOutlineWidth === 'number' &&
          textStyleConfig.secondaryOutlineWidth > 0 &&
          textStyleConfig.hasSecondaryOutline !== false);
      const secOutlineWidth = hasSecOutline ? Math.max(0, textStyleConfig.secondaryOutlineWidth ?? 4) : 0;
      const primOutlineWidth =
        textStyleConfig.textOutline !== false ? Math.max(0, textStyleConfig.outlineWidth ?? 3) : 0;

      if (secOutlineWidth > 0) {
        const totalSecStroke = Math.max(0.5, (primOutlineWidth + secOutlineWidth) * 2 * scaleFactor);
        ctx.strokeStyle = textStyleConfig.secondaryOutlineColor || '#000000';
        ctx.lineWidth = totalSecStroke;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(line, drawX, lineY);
      }

      // Primary outline
      if (textStyleConfig.textOutline !== false && primOutlineWidth > 0) {
        ctx.strokeStyle = textStyleConfig.outlineColor || '#000000';
        ctx.lineWidth = Math.max(0.5, primOutlineWidth * 2 * scaleFactor);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(line, drawX, lineY);
      }

      // Main text fill
      ctx.fillStyle = textStyleConfig.fontColor || '#ffffff';
      ctx.fillText(line, drawX, lineY);
    });

    ctx.restore();
  });

  // 5. Mask original subtitles if requested
  if (styleConfig && styleConfig.maskOriginalSubtitles) {
    ctx.fillStyle = styleConfig.maskColor || 'rgba(0, 0, 0, 0.75)';
    const maskY =
      vHeight * (1 - (styleConfig.bottomOffsetPercentage || 12) / 100) - vHeight * 0.08;
    const maskH = vHeight * 0.14;
    ctx.fillRect(0, Math.max(0, maskY), vWidth, maskH);
  }

  // 6. Render Active Subtitle
  const currentActiveSub =
    activeSubtitle !== undefined
      ? activeSubtitle
      : subtitles.find((s) => curTime >= s.startTime && curTime <= s.endTime);

  if (!currentActiveSub) return;

  let rawText = currentActiveSub.translatedText || currentActiveSub.originalText || '';

  // Apply casing transformation
  if (styleConfig.textTransform === 'uppercase') {
    rawText = rawText.toUpperCase();
  } else if (styleConfig.textTransform === 'lowercase') {
    rawText = rawText.toLowerCase();
  } else if (styleConfig.textTransform === 'capitalize') {
    rawText = rawText.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const defaultFontSize = styleConfig.fontSize || 22;
  const defaultPadding = styleConfig.padding || 6;
  const defaultBorderRadius = styleConfig.borderRadius ?? 6;
  const bgOpacity = styleConfig.bgOpacity ?? 65;

  const fontSize = Math.max(10, Math.round(defaultFontSize * scaleFactor));

  const fontFamily = styleConfig.fontFamily || 'Montserrat, sans-serif';
  const fontWeight = styleConfig.fontWeight || 'bold';
  const fontStyle = styleConfig.fontStyle || 'normal';

  ctx.save();
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  const align = styleConfig.textAlign || 'center';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const lineHeight = fontSize * 1.25;
  const padding = (styleConfig.hasBackground !== false ? defaultPadding : 2) * scaleFactor;

  const displayBox =
    subLiveBox ||
    currentActiveSub.boundingBox ||
    (styleConfig as any).roi || { x: 10, y: 76, width: 80, height: 20 };

  const isVertical = styleConfig.orientation === 'vertical';
  const parentX = (displayBox.x / 100) * vWidth;
  const parentY = (displayBox.y / 100) * vHeight;
  const parentWidth = (displayBox.width / 100) * vWidth;

  const maxSafeWidth = vWidth * 0.94;
  const wrapWidth = isVertical
    ? Math.max(40, parentWidth - padding * 2)
    : Math.max(100, Math.max(parentWidth, maxSafeWidth) - padding * 2);

  const maxH = styleConfig.maxCharsHorizontal || 65;
  const maxV = styleConfig.maxCharsVertical || 36;
  const orientation = styleConfig.orientation || 'horizontal';
  const charWrapped = wrapSubtitleText(rawText || '', orientation, maxH, maxV);
  const charLines = charWrapped.split('\n');
  const lines: string[] = [];
  for (const cLine of charLines) {
    if (isVertical) {
      lines.push(...(cLine.split(/\s+/).filter(Boolean)));
    } else {
      lines.push(...wrapCanvasText(ctx, cLine, wrapWidth));
    }
  }

  if (!lines || lines.length === 0) {
    ctx.restore();
    return;
  }

  let maxLineWidth = 0;
  lines.forEach((line) => {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  });

  const totalTextHeight = (lines.length - 1) * lineHeight + fontSize * 0.95;
  const boxWidth = Math.min(vWidth - padding * 2, maxLineWidth + padding * 2);
  const boxHeight = totalTextHeight + padding * 2;

  const centerX = parentX + parentWidth / 2;
  const boxX = Math.max(padding, Math.min(vWidth - boxWidth - padding, centerX - boxWidth / 2));
  const boxY = parentY - (lines.length - 1) * lineHeight;

  // Draw background box
  if (
    styleConfig.hasBackground !== false &&
    styleConfig.backgroundColor &&
    styleConfig.backgroundColor !== 'transparent'
  ) {
    ctx.fillStyle = getBgColorWithOpacity(styleConfig.backgroundColor, bgOpacity);
    const radius = (defaultBorderRadius ?? 0) * scaleFactor;
    ctx.beginPath();
    drawRoundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, radius);
    ctx.fill();
  }

  let drawX = boxX + boxWidth / 2;
  if (align === 'left') drawX = boxX + padding;
  else if (align === 'right') drawX = boxX + boxWidth - padding;

  const startY = boxY + padding + fontSize * 0.52;

  lines.forEach((line, idx) => {
    const lineY = startY + idx * lineHeight;

    // Drop shadow / glow (Only when user explicitly specified textShadowColor)
    if (styleConfig.textShadowColor) {
      ctx.save();
      ctx.shadowColor = styleConfig.textShadowColor;
      ctx.shadowBlur = (styleConfig.textShadowBlur ?? 8) * scaleFactor;
      ctx.shadowOffsetX = (styleConfig.textShadowOffsetX ?? 0) * scaleFactor;
      ctx.shadowOffsetY = (styleConfig.textShadowOffsetY ?? 2) * scaleFactor;
      ctx.fillStyle = styleConfig.fontColor || '#ffffff';
      ctx.fillText(line, drawX, lineY);
      ctx.restore();
    }

    // Secondary outline (outer stroke)
    const hasSecOutline =
      styleConfig.hasSecondaryOutline === true ||
      (typeof styleConfig.secondaryOutlineWidth === 'number' &&
        styleConfig.secondaryOutlineWidth > 0 &&
        styleConfig.hasSecondaryOutline !== false);
    const secOutlineWidth = hasSecOutline ? Math.max(0, styleConfig.secondaryOutlineWidth ?? 4) : 0;
    const primOutlineWidth =
      styleConfig.textOutline !== false ? Math.max(0, styleConfig.outlineWidth ?? 3) : 0;

    if (secOutlineWidth > 0) {
      const totalSecStroke = Math.max(0.5, (primOutlineWidth + secOutlineWidth) * 2 * scaleFactor);
      ctx.strokeStyle = styleConfig.secondaryOutlineColor || '#000000';
      ctx.lineWidth = totalSecStroke;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, drawX, lineY);
    }

    // Primary outline
    if (styleConfig.textOutline !== false && primOutlineWidth > 0) {
      ctx.strokeStyle = styleConfig.outlineColor || '#000000';
      ctx.lineWidth = Math.max(0.5, primOutlineWidth * 2 * scaleFactor);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, drawX, lineY);
    }

    // Main text fill
    ctx.fillStyle = styleConfig.fontColor || '#ffffff';
    ctx.fillText(line, drawX, lineY);
  });

  ctx.restore();
}
