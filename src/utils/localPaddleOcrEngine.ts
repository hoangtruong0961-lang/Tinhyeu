import * as ort from 'onnxruntime-web';
import { getModelBufferDB, storeModelBufferDB, deleteModelBufferDB } from './idbStorage';
import { checkRoiSubtitleDuplicate } from './ocrPreprocessing';
import { getAppSettings } from './settingsStorage';

// Pre-configure global ONNX runtime settings immediately
try {
  ort.env.logLevel = 'error';
  ort.env.wasm.simd = true;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = '/ort-wasm/';
} catch (_) {}

export interface LocalFrameItem {
  image?: string; // base64 or data URL
  pixelData?: Uint8ClampedArray;
  width?: number;
  height?: number;
  timestamp: number;
  isTransitionFrame?: boolean;
  segStartTime?: number;
  segEndTime?: number;
}

export interface LocalOcrResult {
  startTime: number;
  endTime: number;
  originalText: string;
  sourceLang: string;
  confidence?: number;
}

export interface PaddleOcrModelStatus {
  isReady: boolean;
  detLoaded: boolean;
  recLoaded: boolean;
  dictLoaded?: boolean;
  modelName: string;
  detSizeMB?: string;
  recSizeMB?: string;
  dictSizeKB?: string;
  downloadProgress?: number;
  downloadMessage?: string;
}

// Global ONNX Session cache
let onnxDetSession: ort.InferenceSession | null = null;
let onnxRecSession: ort.InferenceSession | null = null;
let isSessionLoading = false;

// Default URLs & Fallbacks for PaddleOCR PP-OCRv6 ONNX weights & dictionary (Small & Tiny)
export const HF_DET_SMALL_URL = 'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx?download=true';
export const HF_REC_SMALL_URL = 'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx?download=true';

export const HF_DET_TINY_URL = 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.onnx?download=true';
export const HF_REC_TINY_URL = 'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.onnx?download=true';

export const HF_DET_URL = HF_DET_SMALL_URL;
export const HF_REC_URL = HF_REC_SMALL_URL;

const DET_MODEL_URL = '/det.onnx';
const REC_MODEL_URL = '/rec.onnx';
const DICT_MODEL_URL = '/dict.txt';

export function toArrayBuffer(buf: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  const slice = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return (slice instanceof ArrayBuffer) ? slice : (new Uint8Array(slice).buffer as unknown as ArrayBuffer);
}

/**
 * Validate that an ArrayBuffer contains a valid ONNX or ORT model binary payload
 */
export function isProtobufValidHeader(buf: ArrayBuffer | null | undefined): boolean {
  if (!buf || buf.byteLength < 50000) return false;
  const u8 = new Uint8Array(buf, 0, Math.min(128, buf.byteLength));
  // Reject ASCII text errors: HTML, JSON, Git-LFS, XML
  if (u8[0] === 0x3c || u8[0] === 0x7b) { // '<' or '{'
    return false;
  }
  // Reject UTF-8 replacement character corruption \xEF\xBF\xBD
  if (u8.length >= 9 && u8[6] === 0xef && u8[7] === 0xbf && u8[8] === 0xbd) {
    return false;
  }

  const headStr = new TextDecoder('utf-8').decode(u8.subarray(0, 64)).toLowerCase();
  if (
    headStr.startsWith('<!doctype') ||
    headStr.startsWith('<html') ||
    headStr.startsWith('{"') ||
    headStr.includes('<html') ||
    headStr.includes('<!doc') ||
    headStr.includes('git-lfs') ||
    headStr.includes('version https://') ||
    headStr.includes('404 not found') ||
    headStr.includes('access denied')
  ) {
    return false;
  }
  return true;
}

/**
 * Check whether a dictionary buffer matches the expected model variant
 * Small: ~18,710 classes, ~75KB
 * Tiny: ~6,906 classes, ~27KB
 */
export function isDictionaryMatchingVariant(buf: ArrayBuffer | string | null | undefined, variant: 'small' | 'tiny'): boolean {
  if (!buf) return false;
  let text = '';
  if (typeof buf === 'string') {
    text = buf;
  } else if (buf instanceof ArrayBuffer && buf.byteLength > 0) {
    text = new TextDecoder('utf-8').decode(buf);
  } else {
    return false;
  }
  const lineCount = text.split(/\r?\n/).length;
  if (variant === 'small') {
    return lineCount >= 18000;
  } else {
    return lineCount >= 6500 && lineCount <= 12000;
  }
}

/**
 * Sanitize character dictionary buffer:
 * 1. Strip UTF-8 BOM (\uFEFF / 0xEF 0xBB 0xBF) at the very start
 * 2. Replace CRLF (\r\n) line endings with standard LF (\n)
 * 3. Ensure leading empty line for CTC Blank Index (0) so token alignment is 100% exact
 */
export function sanitizeDictionaryBuffer(buffer: ArrayBuffer | string): ArrayBuffer {
  let text = '';
  if (typeof buffer === 'string') {
    text = buffer;
  } else if (buffer && (buffer as ArrayBuffer).byteLength > 0) {
    text = new TextDecoder('utf-8').decode(buffer as ArrayBuffer);
  } else {
    return new ArrayBuffer(0);
  }
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff || text.startsWith('\uFEFF')) {
    text = text.slice(1);
  }
  // Normalize CRLF to LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  // Guarantee leading newline for BLANK_INDEX (index 0)
  if (!text.startsWith('\n')) {
    text = '\n' + text;
  }
  return new TextEncoder().encode(text).buffer;
}

export async function fetchDictionaryFromCandidates(variant: 'small' | 'tiny' = 'small'): Promise<ArrayBuffer | null> {
  const dictCandidates = variant === 'tiny'
    ? [
        '/ppocrv6_tiny_dict.txt',
        '/api/paddle-models/dict?variant=tiny',
        'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt',
      ]
    : [
        '/ppocrv6_dict.txt',
        '/dict.txt',
        '/api/paddle-models/dict?variant=small',
        'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt',
      ];

  for (const dictUrl of dictCandidates) {
    try {
      const dictRes = await fetch(dictUrl);
      if (dictRes.ok) {
        const cType = dictRes.headers.get('content-type') || '';
        if (!cType.toLowerCase().includes('text/html')) {
          const buf = await dictRes.arrayBuffer();
          if (buf && buf.byteLength > 10 && isDictionaryMatchingVariant(buf, variant)) {
            return sanitizeDictionaryBuffer(buf);
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Helper to check whether an ONNX buffer size matches the expected variant
 * PP-OCRv6 Small: Det ~9.5MB, Rec ~21MB
 * PP-OCRv6 Tiny:  Det ~1.7MB, Rec ~4.3MB
 */
function isBufferSizeMatchingVariant(buf: ArrayBuffer | null, isDet: boolean, variant: 'small' | 'tiny'): boolean {
  if (!buf) return false;
  if (variant === 'small') {
    return isDet ? buf.byteLength > 5000000 : buf.byteLength > 10000000;
  } else {
    return isDet ? (buf.byteLength < 5000000 && buf.byteLength > 500000) : (buf.byteLength < 10000000 && buf.byteLength > 1000000);
  }
}

/**
 * Ensure PaddleOCR ONNX models and dictionary are present in IndexedDB, auto-downloading them if missing or corrupted
 */
export async function ensurePaddleOcrModelsLoaded(
  onProgress?: (percent: number, msg: string) => void,
  variant: 'small' | 'tiny' = 'small'
): Promise<boolean> {
  let detBuf = await getModelBufferDB(`paddleocr_det_${variant}`) || await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB(`paddleocr_rec_${variant}`) || await getModelBufferDB('paddleocr_rec');
  let dictBuf = await getModelBufferDB(`paddleocr_dict_${variant}`) || await getModelBufferDB('paddleocr_dict');

  // Purge or re-fetch if corrupted or mismatched variant size
  if (detBuf && (!isProtobufValidHeader(detBuf) || !isBufferSizeMatchingVariant(detBuf, true, variant))) {
    detBuf = null;
  }
  if (recBuf && (!isProtobufValidHeader(recBuf) || !isBufferSizeMatchingVariant(recBuf, false, variant))) {
    recBuf = null;
  }
  if (dictBuf && !isDictionaryMatchingVariant(dictBuf, variant)) {
    console.warn(`[PaddleOCR] Cached dictionary does not match variant '${variant}'. Discarding old dictionary.`);
    await deleteModelBufferDB('paddleocr_dict');
    await deleteModelBufferDB(`paddleocr_dict_${variant}`);
    dictBuf = null;
  }

  if (detBuf && recBuf && dictBuf && isProtobufValidHeader(detBuf) && isProtobufValidHeader(recBuf) && isDictionaryMatchingVariant(dictBuf, variant)) {
    return true;
  }
  const ok = await downloadPaddleOcrModels(onProgress, variant);
  if (!ok) {
    throw new Error(`Không thể tải tệp trọng số PaddleOCR ONNX (${variant === 'tiny' ? 'Tiny' : 'Small'}).`);
  }
  return true;
}

/**
 * Check if PaddleOCR ONNX models are present in IndexedDB or memory
 */
export async function checkPaddleOcrModelStatus(variant: 'small' | 'tiny' = 'small'): Promise<PaddleOcrModelStatus> {
  const dictBuf = await getModelBufferDB(`paddleocr_dict_${variant}`) || await getModelBufferDB('paddleocr_dict');
  const variantName = variant === 'tiny' ? 'Tiny' : 'Small';

  let detBuf = await getModelBufferDB(`paddleocr_det_${variant}`) || await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB(`paddleocr_rec_${variant}`) || await getModelBufferDB('paddleocr_rec');

  const detValid = !!detBuf && isProtobufValidHeader(detBuf) && isBufferSizeMatchingVariant(detBuf, true, variant);
  const recValid = !!recBuf && isProtobufValidHeader(recBuf) && isBufferSizeMatchingVariant(recBuf, false, variant);
  const dictLoaded = !!dictBuf && isDictionaryMatchingVariant(dictBuf, variant);
  const isReady = detValid && recValid && dictLoaded;

  if (onnxDetSession && onnxRecSession && isReady) {
    return {
      isReady: true,
      detLoaded: true,
      recLoaded: true,
      dictLoaded,
      modelName: `PP-OCRv6 ${variantName} ONNX (Đã load trong bộ nhớ)`,
      detSizeMB: detBuf ? (detBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
      recSizeMB: recBuf ? (recBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
      dictSizeKB: dictBuf ? (dictBuf.byteLength / 1024).toFixed(1) + ' KB' : undefined,
    };
  }

  return {
    isReady,
    detLoaded: detValid,
    recLoaded: recValid,
    dictLoaded,
    modelName: isReady ? `PP-OCRv6 ${variantName} Local ONNX (Đã lưu trong bộ nhớ)` : `Chưa tải Model PaddleOCR PP-OCRv6 ${variantName}`,
    detSizeMB: detBuf && detBuf.byteLength > 100000 ? (detBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
    recSizeMB: recBuf && recBuf.byteLength > 100000 ? (recBuf.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : undefined,
    dictSizeKB: dictBuf && isDictionaryMatchingVariant(dictBuf, variant) ? (dictBuf.byteLength / 1024).toFixed(1) + ' KB' : undefined,
  };
}

/**
 * Initializes local ONNX Runtime Web session from IndexedDB or ArrayBuffers
 */
export async function initLocalOnnxEngine(): Promise<boolean> {
  try {
    const detBuf = await getModelBufferDB('paddleocr_det');
    const recBuf = await getModelBufferDB('paddleocr_rec');
    const hasDet = !!detBuf && detBuf.byteLength > 100000;
    const hasRec = !!recBuf && recBuf.byteLength > 100000;
    return hasDet || hasRec;
  } catch (err) {
    console.warn('[Local ONNX Engine Check]', err);
    return false;
  }
}

/**
 * Download PaddleOCR models directly with progress tracking
 */
export async function downloadPaddleOcrModels(
  onProgress?: (percent: number, msg: string) => void,
  variant: 'small' | 'tiny' = 'small'
): Promise<boolean> {
  try {
    const variantLabel = variant === 'tiny' ? 'Tiny' : 'Small';
    const detHfUrl = variant === 'tiny' ? HF_DET_TINY_URL : HF_DET_SMALL_URL;
    const recHfUrl = variant === 'tiny' ? HF_REC_TINY_URL : HF_REC_SMALL_URL;

    if (onProgress) onProgress(5, `Đang kết nối tải Model PaddleOCR v6 ${variantLabel} (ONNX)...`);

    const fetchWithProgress = async (mainUrl: string, name: string, startPct: number, endPct: number) => {
      const isDet = name.toLowerCase().includes('detection') || mainUrl.includes('det');
      const directStaticUrl = isDet
        ? (variant === 'tiny' ? '/det_tiny.onnx' : '/det_small.onnx')
        : (variant === 'tiny' ? '/rec_tiny.onnx' : '/rec_small.onnx');

      const fallbackUrls = [
        directStaticUrl,
        isDet ? `/api/paddle-models/det?variant=${variant}` : `/api/paddle-models/rec?variant=${variant}`,
        isDet ? `/api/ocr/model/det?variant=${variant}` : `/api/ocr/model/rec?variant=${variant}`,
        isDet ? '/det.onnx' : '/rec.onnx',
        isDet ? detHfUrl : recHfUrl,
        mainUrl,
      ];

      let lastError: any = null;
      for (const rawUrl of fallbackUrls) {
        const targetUrl = rawUrl.includes('huggingface.co') && rawUrl.includes('/blob/')
          ? rawUrl.replace('/blob/', '/resolve/')
          : rawUrl;
        try {
          const response = await fetch(targetUrl);
          if (!response.ok) continue;

          // Ignore HTML responses (e.g. Netlify/Vite SPA fallback returning index.html for non-existent routes)
          const contentType = response.headers.get('Content-Type') || '';
          if (contentType.toLowerCase().includes('text/html')) {
            continue;
          }

          const contentLength = +(response.headers.get('Content-Length') || '0');
          const reader = response.body?.getReader();

          if (!reader) {
            const rawBuf = await response.arrayBuffer();
            if (rawBuf.byteLength >= 100000 && isProtobufValidHeader(rawBuf)) {
              return rawBuf;
            }
            continue;
          }

          let receivedLength = 0;
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;

            if (contentLength && onProgress) {
              const pct = Math.round(startPct + (receivedLength / contentLength) * (endPct - startPct));
              const mb = (receivedLength / (1024 * 1024)).toFixed(1);
              onProgress(pct, `Đang tải ${name}: ${mb} MB...`);
            }
          }

          const allChunks = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            allChunks.set(chunk, position);
            position += chunk.length;
          }

          const finalBuf = allChunks.buffer.slice(allChunks.byteOffset, allChunks.byteOffset + allChunks.byteLength);
          if (finalBuf.byteLength >= 100000 && isProtobufValidHeader(finalBuf)) {
            return finalBuf;
          }
        } catch (e) {
          lastError = e;
        }
      }

      throw new Error(`Không thể tải tệp ${name} từ bất kỳ nguồn nào. Chi tiết: ${String(lastError || 'Server trả về dữ liệu rỗng hoặc không đúng chuẩn Protobuf')}`);
    };

    if (onProgress) onProgress(10, `Đang tải PaddleOCR PP-OCRv6 ${variantLabel} Detection Model (det.onnx)...`);
    const detBuffer = await fetchWithProgress(DET_MODEL_URL, `PP-OCRv6 ${variantLabel} Detection`, 10, 48);

    if (onProgress) onProgress(48, `Đang tải PaddleOCR PP-OCRv6 ${variantLabel} Recognition Model (rec.onnx)...`);
    const recBuffer = await fetchWithProgress(REC_MODEL_URL, `PP-OCRv6 ${variantLabel} Recognition`, 48, 85);

    if (!isProtobufValidHeader(detBuffer) || !isProtobufValidHeader(recBuffer)) {
      throw new Error('Tệp trọng số ONNX tải về không đạt chuẩn cấu trúc Protobuf hợp lệ.');
    }

    if (onProgress) onProgress(85, `Đang tải Từ điển ký tự PP-OCRv6 ${variantLabel}...`);
    let dictBuffer: ArrayBuffer | null = await fetchDictionaryFromCandidates(variant);
    if (!dictBuffer || !isDictionaryMatchingVariant(dictBuffer, variant)) {
      throw new Error(`Không thể tải từ điển ký tự phù hợp cho PP-OCRv6 ${variantLabel}`);
    }

    if (onProgress) onProgress(92, `Đang lưu Model PP-OCRv6 ${variantLabel} & Dictionary vào bộ nhớ trình duyệt IndexedDB...`);
    await storeModelBufferDB('paddleocr_det', detBuffer, 'det.onnx');
    await storeModelBufferDB('paddleocr_rec', recBuffer, 'rec.onnx');
    await storeModelBufferDB(`paddleocr_det_${variant}`, detBuffer, `det_${variant}.onnx`);
    await storeModelBufferDB(`paddleocr_rec_${variant}`, recBuffer, `rec_${variant}.onnx`);
    await storeModelBufferDB('paddleocr_dict', dictBuffer, 'dict.txt');
    await storeModelBufferDB(`paddleocr_dict_${variant}`, dictBuffer, `ppocrv6_${variant}_dict.txt`);
    try {
      localStorage.setItem('paddleocr_active_variant', variant);
    } catch {}

    if (onProgress) onProgress(98, 'Đang khởi tạo Session ONNX Runtime Web WASM...');
    await initLocalOnnxEngine();

    if (onProgress) onProgress(100, `Tải Model PaddleOCR PP-OCRv6 ${variantLabel} hoàn tất 100%! Đã sẵn sàng chạy local.`);
    return true;
  } catch (err: any) {
    console.error('Download PaddleOCR error:', err);
    if (onProgress) onProgress(0, `Lỗi tải model: ${err?.message || 'Không thể kết nối server'}`);
    return false;
  }
}

/**
 * Upload custom .onnx model file directly from user's computer
 */
export async function uploadCustomPaddleOcrModel(file: File, type: 'det' | 'rec'): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (reader.result instanceof ArrayBuffer) {
        const key = type === 'det' ? 'paddleocr_det' : 'paddleocr_rec';
        await storeModelBufferDB(key, reader.result, file.name);
        // Clear old sessions
        if (type === 'det') onnxDetSession = null;
        if (type === 'rec') onnxRecSession = null;
        await initLocalOnnxEngine();
        resolve(true);
      } else {
        resolve(false);
      }
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Clear PaddleOCR model cache from IndexedDB & OPFS
 */
export async function clearPaddleOcrCache(): Promise<void> {
  await deleteModelBufferDB('paddleocr_det');
  await deleteModelBufferDB('paddleocr_rec');
  await deleteModelBufferDB('paddleocr_dict');
  await deleteModelBufferDB('paddleocr_det_small');
  await deleteModelBufferDB('paddleocr_rec_small');
  await deleteModelBufferDB('paddleocr_dict_small');
  await deleteModelBufferDB('paddleocr_det_tiny');
  await deleteModelBufferDB('paddleocr_rec_tiny');
  await deleteModelBufferDB('paddleocr_dict_tiny');
  onnxDetSession = null;
  onnxRecSession = null;
  mainThreadPaddleService = null;
  console.log('[PaddleOCR] Local ONNX model & dictionary cache cleared.');
}

import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import {
  detectTextPresenceInFrame,
  applyBinarizationAndContrast,
  scaleFrameBitmap,
  SubtitleRoiCalibrator,
  cropPixelDataVertical,
  estimateTextVerticalRoi,
  findHorizontalTextBounds,
} from './ocrPreprocessing';
import {
  refineAndMergeSubtitles,
  correctOcrTextAnomalies,
  stripEmbeddedNoiseTokens,
  stripEdgeNoiseHanziTokens,
  isLatinLanguage,
  applyHardFilter,
  applySingleCjkFilter,
  filterOutliersByGeometry,
  deduplicateSubtitlesWithGemini,
  cleanChineseSub,
} from './ocrPostprocessing';

export {
  detectTextPresenceInFrame,
  applyBinarizationAndContrast,
  scaleFrameBitmap,
  SubtitleRoiCalibrator,
  refineAndMergeSubtitles,
  correctOcrTextAnomalies,
  stripEmbeddedNoiseTokens,
  stripEdgeNoiseHanziTokens,
  isLatinLanguage,
  applyHardFilter,
  applySingleCjkFilter,
  filterOutliersByGeometry,
  deduplicateSubtitlesWithGemini,
  cleanChineseSub,
};

let mainThreadPaddleService: PaddleOcrService | null = null;

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const parts = dataUrl.split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function hasSubtitleTextCandidate(
  pixelData?: Uint8ClampedArray | Uint8Array | null,
  width?: number,
  height?: number
): boolean {
  if (!pixelData || !width || !height) return true;
  return detectTextPresenceInFrame(pixelData, width, height).hasText;
}

export function applyBackgroundFilter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'none' | 'contrast' | 'binarize' | 'adaptive' = 'none',
  strengthPercent: number = 0
) {
  applyBinarizationAndContrast(ctx, width, height, mode, strengthPercent);
}

export function preprocessFrameCanvas(imgData: ImageData): ImageData {
  return imgData;
}

export function cleanOcrText(text: string, isLatin: boolean = false): string {
  if (!text) return '';
  let cleaned = correctOcrTextAnomalies(text);
  if (!isLatin) {
    cleaned = stripEmbeddedNoiseTokens(cleaned);
  }
  return cleaned;
}

export const cleanChineseOcrText = cleanOcrText;

export function processTemporalClusteringAndSnapping(
  detectedItems: { text: string; timestamp: number; confidence?: number; box?: number[] }[],
  stepInterval: number = 0.5,
  transitionTimestamps?: number[],
  minConfidence: number = 0.70,
  sourceLang?: string,
  _targetLang?: string
): LocalOcrResult[] {
  // IMPORTANT: The script type of OCR text inside video frames is determined by the video's SOURCE language!
  // Defaults to CJK (isLatin = false) if sourceLang is not explicitly a Latin language.
  const isLatin = sourceLang ? isLatinLanguage(sourceLang) : false;
  return refineAndMergeSubtitles(detectedItems, stepInterval, isLatin, transitionTimestamps, minConfidence);
}

/**
 * Run client-side local OCR frame analysis entirely in browser using WebAssembly & ONNX Runtime Web (WebGPU/WebGL)
 * offloaded to a multi-threaded Web Worker Pool (2-4 Web Workers concurrently) for maximum throughput on multi-core CPUs.
 */
export async function runClientSideLocalOcrBatch(
  frames: LocalFrameItem[],
  onProgress?: (msg: string) => void,
  stepInterval?: number,
  transitionTimestamps?: number[],
  minConfidence: number = 0.70,
  sourceLang?: string,
  targetLang?: string,
  paddleModelVariant?: 'small' | 'tiny'
): Promise<LocalOcrResult[]> {
  const detectedItems: { text: string; timestamp: number; confidence?: number }[] = [];
  const inferredInterval = stepInterval || (frames.length >= 2 ? Math.max(0.1, Math.abs(frames[1].timestamp - frames[0].timestamp)) : 0.5);

  if (!frames || frames.length === 0) return [];

  const activeVariant = paddleModelVariant || getAppSettings().paddleOcrModelVariant || 'small';

  await ensurePaddleOcrModelsLoaded((pct, msg) => {
    if (onProgress) onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
  }, activeVariant);

  let detBuf = await getModelBufferDB(`paddleocr_det_${activeVariant}`) || await getModelBufferDB('paddleocr_det');
  let recBuf = await getModelBufferDB(`paddleocr_rec_${activeVariant}`) || await getModelBufferDB('paddleocr_rec');
  let dictBuf = await getModelBufferDB(`paddleocr_dict_${activeVariant}`) || await getModelBufferDB('paddleocr_dict');

  if (dictBuf && !isDictionaryMatchingVariant(dictBuf, activeVariant)) {
    console.warn(`[PaddleOCR] Purging mismatched cached dictionary for variant '${activeVariant}'`);
    await deleteModelBufferDB('paddleocr_dict');
    await deleteModelBufferDB(`paddleocr_dict_${activeVariant}`);
    dictBuf = null;
  }

  // Auto-fetch dictionary matching activeVariant if not found or invalid
  if (!dictBuf) {
    const fetchedDict = await fetchDictionaryFromCandidates(activeVariant);
    if (fetchedDict && isDictionaryMatchingVariant(fetchedDict, activeVariant)) {
      await storeModelBufferDB('paddleocr_dict', fetchedDict, 'dict.txt');
      await storeModelBufferDB(`paddleocr_dict_${activeVariant}`, fetchedDict, `ppocrv6_${activeVariant}_dict.txt`);
      dictBuf = fetchedDict;
    }
  }

  const cleanDictBuf = dictBuf && dictBuf.byteLength > 10 ? sanitizeDictionaryBuffer(dictBuf) : undefined;

  // Ensure 100% frame coverage: process all extracted frames directly via worker pool
  const framesToProcess = frames;
  const skippedBatchCount = 0;

  // Determine optimal worker pool size: unlock up to 12 parallel Web Workers based on CPU logical cores
  const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const calculatedCores = logicalCores >= 8 ? logicalCores - 1 : logicalCores;
  const maxPoolSize = Math.min(12, Math.max(2, calculatedCores));
  // If frame count is small (e.g. < 4), use fewer workers; otherwise use full pool size
  const poolSize = Math.min(maxPoolSize, Math.max(1, Math.ceil(framesToProcess.length / 2)));

  if (onProgress) {
    onProgress(`⚡ Khởi tạo Đa luồng Web Worker Pool (${poolSize} Workers | Lọc ${skippedBatchCount} khung trùng ROI)...`);
  }

  // Split frame list into balanced chunks across worker pool
  const frameChunks: LocalFrameItem[][] = Array.from({ length: poolSize }, () => []);
  framesToProcess.forEach((f, idx) => {
    frameChunks[idx % poolSize].push(f);
  });

  const activeWorkerPromises: Promise<{ text: string; timestamp: number; confidence?: number }[]>[] = [];
  const workerProgressTracker: { completed: number; total: number }[] = Array.from(
    { length: poolSize },
    (_, i) => ({
      completed: 0,
      total: frameChunks[i].length,
    })
  );

  const updateOverallProgress = () => {
    if (!onProgress) return;
    const totalProcessed = workerProgressTracker.reduce((acc, w) => acc + w.completed, 0);
    const totalAll = framesToProcess.length;
    const pct = Math.round((totalProcessed / Math.max(1, totalAll)) * 100);
    onProgress(`🚀 [Đa luồng Pool ${poolSize} Workers] Đang bóc tách (${totalProcessed}/${totalAll} khung - ${pct}% | Bỏ qua trùng: ${skippedBatchCount})...`);
  };

  const spawnedWorkers: Worker[] = [];

  for (let wIdx = 0; wIdx < poolSize; wIdx++) {
    const chunk = frameChunks[wIdx];
    if (chunk.length === 0) continue;

    const workerId = wIdx + 1;
    const p = new Promise<{ text: string; timestamp: number; confidence?: number }[]>((resolve) => {
      try {
        const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
        spawnedWorkers.push(worker);

        const processedFrames = chunk.map((f) => {
          let pBuf: Uint8ClampedArray | undefined = f.pixelData;
          if (pBuf && pBuf.byteLength > 0 && pBuf.buffer && pBuf.buffer.byteLength > 0) {
            pBuf = new Uint8ClampedArray(pBuf.buffer, pBuf.byteOffset, pBuf.byteLength);
          } else {
            pBuf = undefined;
          }
          return {
            image: f.image,
            pixelData: pBuf,
            width: f.width,
            height: f.height,
            timestamp: f.timestamp,
            isTransitionFrame: f.isTransitionFrame,
          };
        });

        const safetyTimeout = setTimeout(() => {
          console.warn(`[OCR Worker #${workerId}] Timeout safety trigger after 30s`);
          try { worker.terminate(); } catch {}
          resolve([]);
        }, 30000);

        worker.onerror = (wErr) => {
          clearTimeout(safetyTimeout);
          console.warn(`[OCR Worker #${workerId} Script/Memory Error]:`, wErr);
          resolve([]);
        };

        worker.onmessage = (e: MessageEvent) => {
          const { type, completed, results, workerId: respWorkerId } = e.data;

          if (type === 'READY') {
            worker.postMessage({
              type: 'PROCESS_BATCH',
              workerId,
              frames: processedFrames,
              minConfidence,
            });
          } else if (type === 'PROGRESS') {
            if (typeof completed === 'number') {
              workerProgressTracker[wIdx].completed = completed;
            }
            updateOverallProgress();
          } else if (type === 'BATCH_COMPLETE') {
            clearTimeout(safetyTimeout);
            workerProgressTracker[wIdx].completed = chunk.length;
            updateOverallProgress();
            resolve(results || []);
          } else if (type === 'ERROR') {
            clearTimeout(safetyTimeout);
            console.warn(`[OCR Worker #${workerId} Error]:`, e.data.error);
            resolve([]);
          }
        };

        // Pass ArrayBuffer copies cleanly using Transferable List so worker init has zero copy overhead
        const detCopy = detBuf ? detBuf.slice(0) : undefined;
        const recCopy = recBuf ? recBuf.slice(0) : undefined;
        const dictCopy = cleanDictBuf ? cleanDictBuf.slice(0) : undefined;

        const initTransferables = [detCopy, recCopy, dictCopy].filter(Boolean) as Transferable[];

        worker.postMessage(
          {
            type: 'INIT',
            workerId,
            detBuffer: detCopy,
            recBuffer: recCopy,
            dictBuffer: dictCopy,
            modelVariant: activeVariant,
          },
          initTransferables
        );
      } catch (err) {
        console.warn(`[OCR Worker Pool #${workerId}] Spawning failed:`, err);
        resolve([]);
      }
    });

    activeWorkerPromises.push(p);
  }

  try {
    const allPoolResults = await Promise.all(activeWorkerPromises);
    spawnedWorkers.forEach((w) => w.terminate());

    const combinedItems = allPoolResults.flat();
    if (combinedItems.length > 0) {
      combinedItems.sort((a, b) => a.timestamp - b.timestamp);
      combinedItems.forEach((item) => detectedItems.push(item));
    }


  } catch (poolErr) {
    console.warn('Worker pool execution note, falling back to main thread:', poolErr);
    spawnedWorkers.forEach((w) => w.terminate());
  }

  // Main thread fallback if worker pool returned no items or workers failed
  if (detectedItems.length === 0) {
    if (onProgress) onProgress('Đang chạy PaddleOCR Engine trên Luồng chính (Main Thread)...');
    try {
      if (!mainThreadPaddleService) {
        try {
          ort.env.logLevel = 'error';
          ort.env.wasm.simd = true;
          const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
          const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
          ort.env.wasm.numThreads = hasSharedArrayBuffer ? Math.min(4, logicalCores) : 1;
          ort.env.wasm.proxy = false;
          ort.env.wasm.wasmPaths = '/ort-wasm/';
          if (typeof ort.env.webgpu === 'object' && ort.env.webgpu !== null) {
            (ort.env.webgpu as any).powerPreference = 'high-performance';
          }
        } catch (envErr) {
          console.warn('[Main Thread ONNX Setup Warning]', envErr);
        }

        if (!isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
          await downloadPaddleOcrModels((pct, msg) => {
            if (onProgress) onProgress(`[Main Thread Model Setup ${pct}%] ${msg}`);
          });
          detBuf = await getModelBufferDB('paddleocr_det');
          recBuf = await getModelBufferDB('paddleocr_rec');
        }

        if (!detBuf || !recBuf || !isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
          throw new Error('Không thể tải tệp trọng số ONNX hợp lệ cho PaddleOCR Main Thread.');
        }

        const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
        const settings = getAppSettings();
        const mainProviders = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

        mainThreadPaddleService = new PaddleOcrService({
          model: {
            detection: toArrayBuffer(detBuf),
            recognition: toArrayBuffer(recBuf),
            charactersDictionary: cleanDictBuf ? toArrayBuffer(cleanDictBuf) : undefined,
          },
          detection: {
            paddingVertical: 0.4,
            paddingHorizontal: 0.6,
            minimumAreaThreshold: 20,
            dbBoxThresh: settings.detDbBoxThresh ?? 0.55,
            dbThresh: settings.detDbThresh ?? 0.30,
            limitSideLen: settings.detLimitSideLen ?? (activeVariant === 'tiny' ? 960 : 1216),
            cls: settings.cls ?? false,
          } as any,
          recognition: {
            imageHeight: 48,
            strategy: 'per-line',
            minimumConfidence: settings.dropScore ?? 0.78,
            maxTextLength: settings.maxTextLength ?? 25,
            lang: settings.paddleOcrLang || 'ch',
          } as any,
          session: { executionProviders: mainProviders },
          processing: { engine: 'canvas-native' },
        });
        try {
          await mainThreadPaddleService.initialize();
        } catch (initErr) {
          console.warn('[Main Thread PaddleOCR Init Attempt 1 Warning]', initErr);
          try {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
            ort.env.wasm.numThreads = 1;
            mainThreadPaddleService = new PaddleOcrService({
              model: {
                detection: toArrayBuffer(detBuf),
                recognition: toArrayBuffer(recBuf),
                charactersDictionary: cleanDictBuf ? toArrayBuffer(cleanDictBuf) : undefined,
              },
              detection: {
                paddingVertical: 0.4,
                paddingHorizontal: 0.6,
                minimumAreaThreshold: 20,
                dbBoxThresh: settings.detDbBoxThresh ?? 0.55,
                dbThresh: settings.detDbThresh ?? 0.30,
                limitSideLen: settings.detLimitSideLen ?? (activeVariant === 'tiny' ? 960 : 1216),
                cls: settings.cls ?? false,
              } as any,
              recognition: {
                imageHeight: 48,
                strategy: 'per-line',
                minimumConfidence: settings.dropScore ?? 0.78,
                maxTextLength: settings.maxTextLength ?? 25,
                lang: settings.paddleOcrLang || 'ch',
              } as any,
              session: { executionProviders: ['wasm'] },
              processing: { engine: 'canvas-native' },
            });
            await mainThreadPaddleService.initialize();
          } catch (retryErr) {
            mainThreadPaddleService = null;
            throw retryErr;
          }
        }
      }

      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];

        // Yield to browser UI event loop every 2 frames to keep UI responsive and prevent tab freeze/crash
        if (i % 2 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if (onProgress) {
          onProgress(`PaddleOCR Engine đang bóc tách chữ (${i + 1}/${frames.length})...`);
        }
        try {
          let res: any = null;
          if (f.image && typeof f.image === 'string' && f.image.length > 30) {
            const buf = dataUrlToArrayBuffer(f.image);
            if (buf && buf.byteLength > 100) {
              res = await mainThreadPaddleService.recognize(buf, { flatten: true, strategy: 'per-line' });
            }
          } else if (f.pixelData && f.width && f.height && f.width > 0 && f.height > 0) {
            if (f.pixelData.byteLength === 0 || (f.pixelData.buffer && f.pixelData.buffer.byteLength === 0)) {
              console.warn(`[PaddleOCR Fallback] Frame ${i} skipped: pixelData buffer is detached or empty.`);
              continue;
            }
            const typedData = new Uint8ClampedArray(f.pixelData);
            const bounds = findHorizontalTextBounds(typedData, f.width, f.height);
            const targetW = bounds.cropW;
            const targetH = f.height;

            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              if (bounds.isTightCropped) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = f.width;
                tempCanvas.height = f.height;
                const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                if (tempCtx) {
                  tempCtx.putImageData(new ImageData(typedData, f.width, f.height), 0, 0);
                  ctx.drawImage(tempCanvas, bounds.cropX, 0, bounds.cropW, f.height, 0, 0, targetW, targetH);
                }
              } else {
                const imgData = new ImageData(typedData, f.width, f.height);
                ctx.putImageData(imgData, 0, 0);
              }
              res = await mainThreadPaddleService.recognize(canvas as any, { flatten: true, strategy: 'per-line' });
            }
          }

          if (!res) continue;

          const rawText = typeof res === 'string' ? res : res?.text || '';
          const text = cleanOcrText(rawText);
          if (text) {
            detectedItems.push({ timestamp: f.timestamp, text });
          }
        } catch (err) {
          console.warn('Main thread PaddleOCR recognition error for frame', i, err);
        }
      }
    } catch (err) {
      console.error('Main thread PaddleOCR service setup failed:', err);
    }
  }

  try {
    localStorage.setItem('raw_ocr_results', JSON.stringify(detectedItems));
  } catch (e) {
    console.warn('Failed to save raw_ocr_results to localStorage:', e);
  }

  return processTemporalClusteringAndSnapping(detectedItems, inferredInterval, transitionTimestamps, minConfidence, sourceLang, targetLang);
}

/**
 * PersistentWorker represents a Web Worker that has been initialized with the PaddleOCR models
 * and can be reused between multiple video scans without re-loading the ONNX buffers.
 */
export interface PersistentWorker {
  id: number;
  worker: Worker;
  isBusy: boolean;
  inFlightCount: number;
  currentBatchTimestamps?: number[];
}

// Global cache for initialized warm workers to prevent re-initializing ONNX sessions between scans
const globalWarmWorkers: PersistentWorker[] = [];

/**
 * Real-time Streaming Worker Pool for ONNX WASM PaddleOCR execution.
 * Allows video decoding and Web Worker OCR to run concurrently in parallel pipelines,
 * reducing total subtitle extraction waiting time by ~50%.
 */
export class StreamingOcrPool {
  private poolSize: number = 4;
  private workers: PersistentWorker[] = [];
  private frameQueue: LocalFrameItem[] = [];
  private detectedItems: { text: string; timestamp: number; confidence?: number }[] = [];
  private totalPushed: number = 0;
  private totalProcessed: number = 0;
  private skippedDuplicateCount: number = 0;
  private minConfidence: number = 0.70;
  private stepInterval: number = 0.5;
  private transitionTimestamps: number[] = [];
  private onProgress?: (msg: string) => void;
  public latestProgressMessage: string = '';
  private finishPromiseResolve?: () => void;
  private isInitDone: boolean = false;
  private isExtractionFinished: boolean = false;
  private activeBackend: 'webgpu' | 'wasm' = 'wasm';
  private speedUpMode: boolean = false;
  private frameMetadataMap: Map<number, { segStartTime?: number; segEndTime?: number }> = new Map();

  // Trick 1: Fast ROI Subtitle Hash / Pixel Diff state
  private lastRefFramePixels: Uint8ClampedArray | null = null;
  private lastRefFrameTimestamp: number = -1;
  private consecutiveDuplicateCount: number = 0;
  private pendingDuplicates: Map<number, number[]> = new Map(); // parentTimestamp -> childTimestamps[]
  private pendingDuplicateFrames: Map<number, LocalFrameItem[]> = new Map(); // parentTimestamp -> childFrames[]
  private completedOcrResultsMap: Map<number, { text: string; timestamp: number; confidence?: number } | null> = new Map();

  // Subtitle ROI Auto-Calibration State
  private roiCalibrator: SubtitleRoiCalibrator = new SubtitleRoiCalibrator();
  private hasLoggedRoiLock: boolean = false;
  private sourceLang: string = 'zh_cn';
  private targetLang: string = 'Tiếng Việt';

  private lastProgressReportTime: number = 0;

  constructor(options?: {
    stepInterval?: number;
    transitionTimestamps?: number[];
    minConfidence?: number;
    sourceLang?: string;
    targetLang?: string;
    speedUpMode?: boolean;
    onProgress?: (msg: string) => void;
  }) {
    this.stepInterval = options?.stepInterval ?? 0.5;
    this.transitionTimestamps = options?.transitionTimestamps ?? [];
    this.minConfidence = options?.minConfidence ?? 0.70;
    this.sourceLang = options?.sourceLang ?? 'zh_cn';
    this.targetLang = options?.targetLang ?? 'Tiếng Việt';
    this.speedUpMode = options?.speedUpMode ?? false;
    this.onProgress = options?.onProgress;

    const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    // Unlocked CPU cores: scale up to 12 parallel Web Workers (8 cores -> 7 workers, 12-16 cores -> max 12 workers)
    const calculatedCores = logicalCores >= 8 ? logicalCores - 1 : logicalCores;
    this.poolSize = Math.min(12, Math.max(2, calculatedCores));
  }

  private handleWorkerMessage(entry: PersistentWorker, e: MessageEvent) {
    const { type, results } = e.data;
    if (type === 'BATCH_COMPLETE' || type === 'ERROR') {
      const batchTimestamps = entry.currentBatchTimestamps ? [...entry.currentBatchTimestamps] : [];
      entry.inFlightCount = Math.max(0, entry.inFlightCount - 1);
      if (entry.inFlightCount === 0) {
        entry.isBusy = false;
        entry.currentBatchTimestamps = undefined;
      }

      if (type === 'BATCH_COMPLETE') {
        if (Array.isArray(results)) {
          for (const res of results) {
            const meta = this.frameMetadataMap.get(res.timestamp);
            this.detectedItems.push({
              ...res,
              segStartTime: meta?.segStartTime,
              segEndTime: meta?.segEndTime,
            } as any);
            this.completedOcrResultsMap.set(res.timestamp, res);

            // Resolve pending duplicate child frames
            if (this.pendingDuplicates.has(res.timestamp)) {
              const children = this.pendingDuplicates.get(res.timestamp)!;
              const childFrames = this.pendingDuplicateFrames.get(res.timestamp) || [];

              if (res.text && res.text.trim().length > 0) {
                for (const childT of children) {
                  this.detectedItems.push({
                    timestamp: childT,
                    text: res.text,
                    confidence: res.confidence,
                  });
                  this.completedOcrResultsMap.set(childT, res);
                }
              } else {
                // Parent returned NO text! Re-queue the first child frame to run actual OCR on it
                if (childFrames.length > 0) {
                  const firstChild = childFrames[0];
                  this.frameQueue.unshift(firstChild);
                  const remainingChildren = children.filter(t => t !== firstChild.timestamp);
                  const remainingFrames = childFrames.filter(f => f.timestamp !== firstChild.timestamp);
                  if (remainingChildren.length > 0) {
                    this.pendingDuplicates.set(firstChild.timestamp, remainingChildren);
                    this.pendingDuplicateFrames.set(firstChild.timestamp, remainingFrames);
                  }
                }
              }
              this.pendingDuplicates.delete(res.timestamp);
              this.pendingDuplicateFrames.delete(res.timestamp);
            }
          }
        }

        // Mark sent frames with no OCR result as empty completed
        if (Array.isArray(batchTimestamps) && batchTimestamps.length > 0) {
          for (const sentT of batchTimestamps) {
            if (!this.completedOcrResultsMap.has(sentT)) {
              this.completedOcrResultsMap.set(sentT, null);
              // If parent frame sentT had no text, re-queue the first child frame if available
              if (this.pendingDuplicates.has(sentT)) {
                const childFrames = this.pendingDuplicateFrames.get(sentT) || [];
                if (childFrames.length > 0) {
                  const firstChild = childFrames[0];
                  this.frameQueue.unshift(firstChild);
                  const remainingChildren = (this.pendingDuplicates.get(sentT) || []).filter(t => t !== firstChild.timestamp);
                  const remainingFrames = childFrames.filter(f => f.timestamp !== firstChild.timestamp);
                  if (remainingChildren.length > 0) {
                    this.pendingDuplicates.set(firstChild.timestamp, remainingChildren);
                    this.pendingDuplicateFrames.set(firstChild.timestamp, remainingFrames);
                  }
                }
                this.pendingDuplicates.delete(sentT);
                this.pendingDuplicateFrames.delete(sentT);
              }
            }
          }
        }
      } else if (type === 'ERROR') {
        console.warn(`[Streaming OCR Worker #${entry.id} Error]:`, e.data.error);
      }

      this.reportProgress();
      this.dispatchNextBatch();
    }
  }

  public async init(): Promise<boolean> {
    if (this.onProgress) {
      this.onProgress(`⚡ Khởi tạo luồng xử lý song song Streaming OCR Pool (${this.poolSize} Workers)...`);
    }

    // Try to reuse warm workers first
    let reusedCount = 0;
    const workersToUse: PersistentWorker[] = [];

    while (globalWarmWorkers.length > 0 && workersToUse.length < this.poolSize) {
      const w = globalWarmWorkers.pop()!;
      w.isBusy = false;
      w.inFlightCount = 0;
      w.currentBatchTimestamps = undefined;
      workersToUse.push(w);
      reusedCount++;
    }

    if (reusedCount > 0 && this.onProgress) {
      this.onProgress(`⚡ Tái sử dụng ${reusedCount} luồng OCR ấm (sẵn sàng hoạt động)...`);
    }

    await ensurePaddleOcrModelsLoaded((pct, msg) => {
      if (this.onProgress) {
        this.onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
      }
    });

    let detBuf = await getModelBufferDB('paddleocr_det');
    let recBuf = await getModelBufferDB('paddleocr_rec');
    let dictBuf = await getModelBufferDB('paddleocr_dict');

    if (!isProtobufValidHeader(detBuf) || !isProtobufValidHeader(recBuf)) {
      await downloadPaddleOcrModels((pct, msg) => {
        if (this.onProgress) {
          this.onProgress(`[Tải Model Local OCR ${pct}%] ${msg}`);
        }
      });
      detBuf = await getModelBufferDB('paddleocr_det');
      recBuf = await getModelBufferDB('paddleocr_rec');
    }

    if (!dictBuf || dictBuf.byteLength < 10) {
      const fetchedDict = await fetchDictionaryFromCandidates();
      if (fetchedDict && fetchedDict.byteLength > 10) {
        await storeModelBufferDB('paddleocr_dict', fetchedDict, 'dict.txt');
        dictBuf = fetchedDict;
      }
    }

    const cleanDictBuf = dictBuf && dictBuf.byteLength > 10 ? sanitizeDictionaryBuffer(dictBuf) : undefined;

    const initPromises: Promise<boolean>[] = [];

    // Bind event handlers and track reused workers
    workersToUse.forEach((entry) => {
      this.workers.push(entry);
      const p = new Promise<boolean>((resolve) => {
        entry.worker.onmessage = (e: MessageEvent) => {
          this.handleWorkerMessage(entry, e);
        };
        // Reused workers are already fully initialized
        resolve(true);
      });
      initPromises.push(p);
    });

    // Create new workers for the remaining slots
    const needed = this.poolSize - reusedCount;
    for (let i = 0; i < needed; i++) {
      const workerId = reusedCount + i + 1;
      const p = new Promise<boolean>((resolve) => {
        try {
          const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
          const entry: PersistentWorker = { id: workerId, worker, isBusy: false, inFlightCount: 0, currentBatchTimestamps: undefined };
          this.workers.push(entry);

          worker.onmessage = (e: MessageEvent) => {
            const { type } = e.data;
            if (type === 'READY') {
              if (e.data.executionProvider === 'webgpu') {
                this.activeBackend = 'webgpu';
              }
              // Switch to dynamic message handler once initialized
              worker.onmessage = (ev: MessageEvent) => {
                this.handleWorkerMessage(entry, ev);
              };
              resolve(true);
            } else {
              this.handleWorkerMessage(entry, e);
            }
          };

          const detCopy = detBuf ? detBuf.slice(0) : undefined;
          const recCopy = recBuf ? recBuf.slice(0) : undefined;
          const dictCopy = cleanDictBuf ? cleanDictBuf.slice(0) : undefined;

          worker.postMessage({
            type: 'INIT',
            workerId,
            detBuffer: detCopy,
            recBuffer: recCopy,
            dictBuffer: dictCopy,
          });
        } catch (err) {
          console.warn(`[Streaming OCR Pool Worker #${workerId}] init error:`, err);
          resolve(false);
        }
      });
      initPromises.push(p);
    }

    await Promise.all(initPromises);
    this.isInitDone = true;
    this.dispatchNextBatch();
    return true;
  }

  public pushFrame(frame: LocalFrameItem) {
    this.totalPushed++;

    if (frame.segStartTime !== undefined || frame.segEndTime !== undefined) {
      this.frameMetadataMap.set(frame.timestamp, {
        segStartTime: frame.segStartTime,
        segEndTime: frame.segEndTime,
      });
    }

    if (this.speedUpMode) {
      // In Speed-Up 1 Sub = 1 Frame mode, frames are pre-grouped into representative subtitle sentences
      this.frameQueue.push(frame);
      if (this.isInitDone) {
        this.dispatchNextBatch();
      }
      return;
    }

    let isDuplicate = false;
    // Never mark transition frames as duplicates - they explicitly indicate scene/text change
    if (!frame.isTransitionFrame && this.lastRefFramePixels && frame.pixelData && frame.width && frame.height) {
      const res = checkRoiSubtitleDuplicate(
        frame.pixelData,
        this.lastRefFramePixels,
        frame.width,
        frame.height,
        0.8,
        0.0015
      );
      if (res.isDuplicate) {
        isDuplicate = true;
      }
    }

    if (isDuplicate && this.lastRefFrameTimestamp !== -1) {
      this.skippedDuplicateCount++;
      
      // Group with last non-duplicate (parent) frame for detection & recognition reuse
      const parentT = this.lastRefFrameTimestamp;
      if (!this.pendingDuplicates.has(parentT)) {
        this.pendingDuplicates.set(parentT, []);
      }
      this.pendingDuplicates.get(parentT)!.push(frame.timestamp);

      if (!this.pendingDuplicateFrames.has(parentT)) {
        this.pendingDuplicateFrames.set(parentT, []);
      }
      this.pendingDuplicateFrames.get(parentT)!.push(frame);
    } else {
      // Not a duplicate - this is a new reference frame
      this.frameQueue.push(frame);
      if (frame.pixelData) {
        this.lastRefFramePixels = new Uint8ClampedArray(frame.pixelData);
        this.lastRefFrameTimestamp = frame.timestamp;
      }
    }

    if (this.isInitDone) {
      this.dispatchNextBatch();
    }
  }

  private reportProgress(forceImmediate: boolean = false) {
    if (this.totalPushed === 0) return;
    const now = performance.now();
    if (!forceImmediate && now - this.lastProgressReportTime < 120) {
      return;
    }
    this.lastProgressReportTime = now;

    const completedCount = this.completedOcrResultsMap.size + this.skippedDuplicateCount;
    const totalPushed = Math.max(1, this.totalPushed);
    const pct = Math.min(100, Math.round((completedCount / totalPushed) * 100));
    const busyWorkers = this.workers.filter((w) => w.inFlightCount > 0).length;

    const backendTag = this.activeBackend === 'webgpu' ? 'WebGPU' : 'WASM SIMD';
    const modeTag = this.speedUpMode ? '⚡ TĂNG TỐC 1 Sub/Frame' : 'Đa luồng Pool';
    const msg = `🚀 [${modeTag} ${this.poolSize} luồng (${backendTag}) | Active: ${busyWorkers}/${this.poolSize}] Đang bóc OCR: ${completedCount}/${totalPushed} ${this.speedUpMode ? 'câu' : 'khung'} (${pct}%) ${this.speedUpMode ? '' : `| Bỏ qua trùng: ${this.skippedDuplicateCount} khung`}`;
    this.latestProgressMessage = msg;
    if (this.onProgress) {
      this.onProgress(msg);
    }
  }

  private dispatchNextBatch() {
    if (this.frameQueue.length === 0) {
      this.reportProgress(true);
      this.checkCompletion();
      return;
    }

    // Dispatch work to any worker that has 0 in-flight batches active
    while (this.frameQueue.length > 0) {
      const availableWorkers = this.workers.filter((w) => w.inFlightCount === 0);
      if (availableWorkers.length === 0) break;

      // Pick the available worker
      const worker = availableWorkers[0];

      const batchSize = Math.min(6, this.frameQueue.length);
      const batch = this.frameQueue.splice(0, batchSize);

      worker.inFlightCount = 1;
      worker.isBusy = true;
      worker.currentBatchTimestamps = batch.map((f) => f.timestamp);
      this.totalProcessed += batch.length;

      this.reportProgress();

      const processedFrames = batch.map((f) => {
        let pBuf: Uint8ClampedArray | undefined = f.pixelData;
        let w = f.width;
        let h = f.height;

        if (pBuf && pBuf.byteLength > 0 && pBuf.buffer && pBuf.buffer.byteLength > 0) {
          pBuf = new Uint8ClampedArray(pBuf.buffer, pBuf.byteOffset, pBuf.byteLength);
        } else {
          pBuf = undefined;
        }
        return {
          image: f.image,
          pixelData: pBuf,
          width: w,
          height: h,
          timestamp: f.timestamp,
        };
      });

      worker.worker.postMessage({
        type: 'PROCESS_BATCH',
        workerId: worker.id,
        frames: processedFrames,
        sourceLang: this.sourceLang,
        targetLang: this.targetLang,
        enableDeepScan: true,
        minConfidence: this.minConfidence,
      });
    }
  }

  private checkCompletion() {
    const allIdle = this.workers.every((w) => w.inFlightCount === 0);
    if (this.isExtractionFinished && this.frameQueue.length === 0 && allIdle) {
      if (this.finishPromiseResolve) {
        this.finishPromiseResolve();
      }
    }
  }

  public async finish(updatedTransitions?: number[]): Promise<LocalOcrResult[]> {
    this.isExtractionFinished = true;
    if (updatedTransitions) {
      this.transitionTimestamps = updatedTransitions;
    }

    const allIdle = this.workers.every((w) => w.inFlightCount === 0);
    if (this.frameQueue.length > 0 || !allIdle) {
      await new Promise<void>((resolve) => {
        this.finishPromiseResolve = resolve;
        this.dispatchNextBatch();
      });
    }

    // Final cleanup resolve for remaining pending duplicates
    this.pendingDuplicates.forEach((children, parentT) => {
      const parentRes = this.completedOcrResultsMap.get(parentT);
      if (parentRes && parentRes.text) {
        for (const childT of children) {
          this.detectedItems.push({
            timestamp: childT,
            text: parentRes.text,
            confidence: parentRes.confidence,
          });
        }
      }
    });
    this.pendingDuplicates.clear();

    // Release workers back to the global warm pool instead of terminating them
    this.workers.forEach((w) => {
      w.worker.onmessage = null;
      w.isBusy = false;
      w.inFlightCount = 0;
      w.currentBatchTimestamps = undefined;
      globalWarmWorkers.push(w);
    });
    this.workers = [];

    if (this.detectedItems.length === 0) return [];

    this.detectedItems.sort((a, b) => a.timestamp - b.timestamp);

    if (this.speedUpMode) {
      const isLatin = isLatinLanguage(this.sourceLang);
      const results: LocalOcrResult[] = [];
      for (const item of this.detectedItems) {
        const rawText = item.text || '';
        const text = cleanOcrText(rawText, isLatin);
        if (text && text.trim().length > 0) {
          const segStart = (item as any).segStartTime ?? Math.max(0, item.timestamp - 0.2);
          const segEnd = (item as any).segEndTime ?? (segStart + Math.max(0.8, this.stepInterval * 2));
          results.push({
            startTime: parseFloat(segStart.toFixed(2)),
            endTime: parseFloat(Math.max(segStart + 0.35, segEnd).toFixed(2)),
            originalText: text.trim(),
            sourceLang: this.sourceLang,
            confidence: item.confidence,
          });
        }
      }

      results.sort((a, b) => a.startTime - b.startTime);

      // Merge identical consecutive subtitles (e.g. across boundary splits)
      const merged: LocalOcrResult[] = [];
      for (const r of results) {
        if (merged.length > 0) {
          const prev = merged[merged.length - 1];
          if (prev.originalText === r.originalText && Math.abs(r.startTime - prev.endTime) <= 0.85) {
            prev.endTime = Math.max(prev.endTime, r.endTime);
            continue;
          }
          if (r.startTime < prev.endTime) {
            prev.endTime = Math.max(prev.startTime + 0.3, r.startTime - 0.05);
          }
        }
        merged.push(r);
      }

      console.log(`⚡ [StreamingOcrPool - Chế độ Tăng tốc 1 Sub = 1 Frame] Thu gọn thành công ${merged.length} câu phụ đề chất lượng cao từ ${this.totalPushed} frame!`);
      return merged;
    }

    console.log(`[StreamingOcrPool] Bóc chữ hoàn tất! Tổng nạp: ${this.totalPushed} khung | Bỏ qua trùng ROI: ${this.skippedDuplicateCount} khung (Tiết kiệm ${Math.round((this.skippedDuplicateCount / Math.max(1, this.totalPushed)) * 100)}% thời gian ONNX OCR)`);

    return processTemporalClusteringAndSnapping(
      this.detectedItems,
      this.stepInterval,
      this.transitionTimestamps,
      this.minConfidence,
      this.sourceLang,
      this.targetLang
    );
  }

  public getRawDetectedItems(): { text: string; timestamp: number; confidence?: number }[] {
    return [...this.detectedItems];
  }

  public getBusyWorkersCount(): number {
    return this.workers.filter((w) => w.inFlightCount > 0).length;
  }

  public getPoolSize(): number {
    return this.poolSize;
  }
}



