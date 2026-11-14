import { ExportEngine, ExportResolution, ExportVideoFormat } from '../types';

export function toEvenDimension(val: number): number {
  return Math.max(2, Math.floor(val / 2) * 2);
}

const PRESET_SHORT_SIDE: Record<Exclude<ExportResolution, 'original'>, number> = {
  '4k': 2160,
  '2k': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
};

/**
 * Computes exact even output width & height preserving the source video's orientation.
 * Landscape 16:9 -> 1920x1080; Portrait 9:16 -> 1080x1920; Square 1:1 -> 1080x1080.
 */
export function computeExportDimensions(
  resolution: ExportResolution | undefined,
  srcWidth?: number | null,
  srcHeight?: number | null
): { width: number; height: number } | undefined {
  const hasSrc = Boolean(srcWidth && srcHeight && srcWidth > 0 && srcHeight > 0);
  const validW = hasSrc ? (srcWidth as number) : 1920;
  const validH = hasSrc ? (srcHeight as number) : 1080;

  if (!resolution || resolution === 'original') {
    if (hasSrc) {
      return {
        width: toEvenDimension(validW),
        height: toEvenDimension(validH),
      };
    }
    return undefined;
  }

  const shortSide = PRESET_SHORT_SIDE[resolution] || 1080;
  const aspect = validW / validH;

  if (validW >= validH) {
    return {
      width: toEvenDimension(Math.round(shortSide * aspect)),
      height: toEvenDimension(shortSide),
    };
  }

  return {
    width: toEvenDimension(shortSide),
    height: toEvenDimension(Math.round(shortSide / aspect)),
  };
}

export function getSupportedFormatsForEngine(engine: ExportEngine): ExportVideoFormat[] {
  if (engine === 'mediarecorder') {
    return ['mp4', 'webm'];
  }
  return ['mp4', 'webm', 'mov', 'mkv'];
}

export function normalizeExportFormat(
  engine: ExportEngine,
  format: ExportVideoFormat | undefined
): ExportVideoFormat {
  const supported = getSupportedFormatsForEngine(engine);
  if (format && supported.includes(format)) {
    return format;
  }
  return supported[0];
}

export function getMimeTypeForFormat(format: ExportVideoFormat): string {
  switch (format) {
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp4':
    default:
      return 'video/mp4';
  }
}
