import { RegionROI } from '../types';
import { applyBackgroundFilter } from './localPaddleOcrEngine';
import { detectTextPresenceInFrame, applyUnsharpMask, computeFrameDiffScore, computeLaplacianVariance, shouldOverrideFrameSkip, applyThresholdingNoiseFilter, GridCacheState } from './ocrPreprocessing';
import { createFile as createMp4BoxFile, DataStream } from 'mp4box';

/**
 * Adaptive threshold for detecting subtitle text transitions.
 * Lowered to 3.5 to catch short/small subtitle updates (e.g. 1-2 words in fast dialogue)
 * that occupy only a small pixel ratio of the ROI, while remaining above compression noise (~1.0-1.8).
 */
export const TRANSITION_DIFF_THRESHOLD = 3.5;

export interface FrameItem {
  canvas?: HTMLCanvasElement;
  pixelData: Uint8ClampedArray;
  width: number;
  height: number;
  timestamp: number;
  hasText: boolean;
  frameDiffScore?: number;
  isTransitionFrame?: boolean;
  sharpnessScore?: number;
  segStartTime?: number;
  segEndTime?: number;
}

export interface FrameExtractorOptions {
  videoUrl: string;
  crossOrigin?: string | null;
  startT: number;
  endT: number;
  stepInterval: number;
  roi: RegionROI;
  bgFilterMode?: 'none' | 'contrast' | 'binarize' | 'adaptive';
  bgFilterStrength?: number;
  adaptiveSampling?: boolean;
  speedUpMode?: boolean;
  onFrameCaptured: (item: FrameItem) => void;
  onProgress?: (current: number, total: number, message: string) => void;
  shouldCancel?: () => boolean;
  isLocalPaddle?: boolean;
}

/**
 * Check if WebCodecs VideoDecoder API is supported natively in browser
 */
export function isTrueWebCodecsSupported(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

/**
 * Check if requestVideoFrameCallback is supported in current browser environment
 */
export function isRequestVideoFrameCallbackSupported(): boolean {
  return typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

function getVideoCurrentTime(el: HTMLVideoElement): number {
  return el ? el.currentTime || 0 : 0;
}

function createMp4File() {
  return createMp4BoxFile();
}

/**
 * Helper to copy ROI pixels directly from a VideoFrame into a Uint8ClampedArray without 2D canvas readback.
 * Falls back to 2D canvas drawImage + getImageData if frame.copyTo is unsupported or fails.
 */
async function copyVideoFrameRoiDirect(
  frame: VideoFrame,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  outBuffer: Uint8ClampedArray,
  fallbackCanvas?: OffscreenCanvas | HTMLCanvasElement,
  fallbackCtx?: any
): Promise<boolean> {
  // Reset the buffer to prevent memory contamination and ghost artifacts on reuse
  outBuffer.fill(0);
  try {
    if (typeof frame.copyTo === 'function') {
      await frame.copyTo(outBuffer, {
        rect: { x: cropX, y: cropY, width: cropW, height: cropH },
        format: 'RGBA',
      });
      return true;
    }
  } catch (_err) {
    // Platform format or rect bounds error, fallback to canvas
  }

  if (fallbackCanvas && fallbackCtx) {
    if (fallbackCanvas.width !== cropW || fallbackCanvas.height !== cropH) {
      fallbackCanvas.width = cropW;
      fallbackCanvas.height = cropH;
    }
    fallbackCtx.drawImage(frame, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const imgData = fallbackCtx.getImageData(0, 0, cropW, cropH);
    outBuffer.set(imgData.data);
    return true;
  }
  return false;
}

/**
 * METHOD 1: True WebCodecs VideoDecoder API + MP4Box Demuxer
 * High-performance 2-pass pipeline with direct VideoFrame.copyTo() ROI extraction,
 * hardware acceleration, keyframe coarse scanning (GOP skipping), and parallel decoding.
 */
export async function extractFramesTrueWebCodecs(options: FrameExtractorOptions): Promise<number> {
  if (!isTrueWebCodecsSupported()) {
    throw new Error('WebCodecs VideoDecoder API is not supported in this browser.');
  }

  const {
    videoUrl,
    startT,
    endT,
    stepInterval,
    roi,
    bgFilterMode = 'none',
    bgFilterStrength = 0,
    shouldCancel,
    onFrameCaptured,
    onProgress,
    isLocalPaddle,
  } = options;

  if (onProgress) onProgress(0, 100, '⚡ [True WebCodecs] Đang nạp luồng video để giải mã phần cứng...');

  const isMobileEnv = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const maxSafeBytes = isMobileEnv ? 450 * 1024 * 1024 : 1800 * 1024 * 1024;

  const mp4File = createMp4File();
  let videoTrack: any = null;
  const allSamples: any[] = [];

  mp4File.onReady = (info: any) => {
    if (!info.videoTracks || info.videoTracks.length === 0) {
      return;
    }

    videoTrack = info.videoTracks[0];

    let description: Uint8Array | undefined = undefined;
    try {
      const trak = mp4File.getTrackById(videoTrack.id);
      if (trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]) {
        const entry = trak.mdia.minf.stbl.stsd.entries[0];
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          box.write(stream);
          description = new Uint8Array(stream.buffer, 8);
        }
      }
    } catch (_e) {}

    const decoderConfig: VideoDecoderConfig = {
      codec: videoTrack.codec,
      codedWidth: videoTrack.video.width,
      codedHeight: videoTrack.video.height,
      description,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    } as any;

    if (typeof VideoDecoder !== 'undefined' && typeof VideoDecoder.isConfigSupported === 'function') {
      VideoDecoder.isConfigSupported(decoderConfig).then((res) => {
        console.log(`[WebCodecs Extract GPU Verification] Supported: ${res.supported} | HW Accel: ${res.config?.hardwareAcceleration || 'prefer-hardware'} | Codec: ${res.config?.codec || videoTrack.codec}`);
      }).catch((err) => {
        console.warn('[WebCodecs Extract GPU Verification] Error:', err);
      });
    }

    // MUST set _decoderConfig BEFORE mp4File.start() because start() fires onSamples synchronously
    (mp4File as any)._decoderConfig = decoderConfig;

    const totalSamples = videoTrack.nb_samples || 500000;
    mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: totalSamples });
    mp4File.start();
  };

  mp4File.onSamples = (id: number, _user: any, samples: any[]) => {
    if (samples && samples.length > 0) {
      for (let i = 0; i < samples.length; i++) {
        allSamples.push(samples[i]);
      }
      try {
        const lastSample = samples[samples.length - 1];
        if (lastSample && typeof lastSample.number === 'number' && typeof (mp4File as any).releaseUsedSamples === 'function') {
          (mp4File as any).releaseUsedSamples(id, lastSample.number);
        }
      } catch (_) {}
    }
  };

  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentLength = Number(res.headers.get('Content-Length') || '0');
    if (contentLength > maxSafeBytes) {
      throw new Error(`Video vượt quá ngưỡng RAM an toàn (${Math.round(contentLength / (1024 * 1024))}MB) cho giải mã buffer toàn phần, chuyển sang luồng streaming.`);
    }

    const reader = res.body?.getReader();
    if (reader) {
      let fileOffset = 0;
      while (true) {
        if (shouldCancel && shouldCancel()) {
          try { await reader.cancel(); } catch {}
          return 0;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          if (fileOffset + value.byteLength > maxSafeBytes) {
            try { await reader.cancel(); } catch {}
            throw new Error('Video vượt quá ngưỡng RAM an toàn, chuyển sang luồng streaming.');
          }
          const chunkBuf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer & { fileStart?: number };
          chunkBuf.fileStart = fileOffset;
          fileOffset += chunkBuf.byteLength;
          mp4File.appendBuffer(chunkBuf);
        }
      }
      mp4File.flush();
    } else {
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > maxSafeBytes) {
        throw new Error('Video vượt quá ngưỡng RAM an toàn, chuyển sang luồng streaming.');
      }
      (arrayBuffer as any).fileStart = 0;
      mp4File.appendBuffer(arrayBuffer);
      mp4File.flush();
    }
  } catch (err) {
    throw new Error(`CORS/Stream error cho WebCodecs VideoDecoder: ${String(err)}`);
  }

  if (shouldCancel && shouldCancel()) return 0;
  if (!videoTrack || allSamples.length === 0) {
    throw new Error('Không tìm thấy luồng Video Track hợp lệ trong tệp MP4.');
  }

  return new Promise<number>((resolve, reject) => {
    try {
      mp4File.onError = (e: any) => reject(e);

      const processAllSamples = async (samples: any[]) => {
        if (shouldCancel && shouldCancel()) {
          resolve(0);
          return;
        }

        const decoderConfig: VideoDecoderConfig = (mp4File as any)._decoderConfig;
        if (!decoderConfig) {
          reject(new Error('Thiếu cấu hình VideoDecoder configuration.'));
          return;
        }

        // Filter relevant samples in target window
        const validSamples = samples.filter((s) => {
          const tSec = s.cts / s.timescale;
          return tSec >= startT - 1.0 && tSec <= endT + 1.0;
        });

        if (validSamples.length === 0) {
          resolve(0);
          return;
        }

        // Group samples into GOPs (Group of Pictures bounded by keyframes)
        interface SampleGop {
          gopIdx: number;
          keyframe: any;
          deltas: any[];
          startSec: number;
          endSec: number;
          isActive: boolean;
        }

        const gops: SampleGop[] = [];
        let currentGop: SampleGop | null = null;

        for (const sample of validSamples) {
          const tSec = sample.cts / sample.timescale;
          if (sample.is_sync || !currentGop) {
            currentGop = {
              gopIdx: gops.length,
              keyframe: sample,
              deltas: [],
              startSec: tSec,
              endSec: tSec,
              isActive: true, // Default active, evaluated in Pass 1
            };
            gops.push(currentGop);
          } else {
            currentGop.deltas.push(sample);
            currentGop.endSec = tSec;
          }
        }

        if (onProgress) {
          onProgress(0, 100, `🚀 [Pass 1/2] Phân tích ${gops.length} keyframe khoanh vùng thoại (Coarse Scan)...`);
        }

        // PASS 1: Keyframe Coarse Scan to detect silent non-subtitle regions
        const keyframeInfoMap = new Map<number, { hasText: boolean; diffScore: number }>();

        if (gops.length > 2) {
          await new Promise<void>((pass1Resolve) => {
            let prevKfBuffer: Uint8ClampedArray | null = null;
            let decodedKeyframeIdx = 0;
            const pass1GridCacheRef: { current: GridCacheState | null } = { current: null };

            const fallbackCanvas = typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(320, 160)
              : document.createElement('canvas');
            const fallbackCtx = fallbackCanvas.getContext('2d', { willReadFrequently: true }) as any;

            const pass1Decoder = new VideoDecoder({
              output: async (frame: VideoFrame) => {
                try {
                  const tSec = frame.timestamp / 1_000_000;
                  const vW = frame.codedWidth || frame.displayWidth || 1280;
                  const vH = frame.codedHeight || frame.displayHeight || 720;

                  const cropX = Math.max(0, Math.floor((roi.x / 100) * vW));
                  const cropY = Math.max(0, Math.floor((roi.y / 100) * vH));
                  const cropW = Math.max(16, Math.floor((roi.width / 100) * vW));
                  const cropH = Math.max(16, Math.floor((roi.height / 100) * vH));

                  const cropBuffer = new Uint8ClampedArray(cropW * cropH * 4);
                  await copyVideoFrameRoiDirect(frame, cropX, cropY, cropW, cropH, cropBuffer, fallbackCanvas, fallbackCtx);

                  applyThresholdingNoiseFilter(cropBuffer, cropW, cropH);
                  let diffScore = 0;
                  if (prevKfBuffer && prevKfBuffer.length === cropBuffer.length) {
                    diffScore = computeFrameDiffScore(cropBuffer, prevKfBuffer, cropW, cropH);
                  }
                  prevKfBuffer = cropBuffer;

                  const presence = detectTextPresenceInFrame(cropBuffer, cropW, cropH, bgFilterStrength, pass1GridCacheRef);
                  keyframeInfoMap.set(Number(tSec.toFixed(2)), {
                    hasText: presence.hasText,
                    diffScore,
                  });

                  decodedKeyframeIdx++;
                } finally {
                  frame.close();
                }
              },
              error: (err) => {
                console.warn('Pass 1 Keyframe Decoder warning:', err);
                pass1Resolve();
              },
            });

            try {
              try {
                pass1Decoder.configure(decoderConfig);
              } catch (_cfgErr) {
                const altConfig = { ...decoderConfig };
                delete (altConfig as any).description;
                pass1Decoder.configure(altConfig);
              }
              for (const gop of gops) {
                const sample = gop.keyframe;
                const chunk = new EncodedVideoChunk({
                  type: 'key',
                  timestamp: (sample.cts * 1_000_000) / sample.timescale,
                  duration: (sample.duration * 1_000_000) / sample.timescale,
                  data: sample.data,
                });
                pass1Decoder.decode(chunk);
              }
              pass1Decoder.flush().then(() => pass1Resolve()).catch(() => pass1Resolve());
            } catch (_err) {
              pass1Resolve();
            }
          });

          // Evaluate quiet GOPs
          for (let i = 0; i < gops.length - 1; i++) {
            const g1 = gops[i];
            const g2 = gops[i + 1];
            const info1 = keyframeInfoMap.get(Number(g1.startSec.toFixed(2)));
            const info2 = keyframeInfoMap.get(Number(g2.startSec.toFixed(2)));

            if (info1 && info2) {
              const gopDuration = g2.startSec - g1.startSec;
              // Safe threshold: If GOP is longer than 1.0 seconds, we never mark it silent.
              // Long GOPs (commonly produced on static/black backgrounds) can contain nested subtitles
              // that don't align with the boundary keyframes, so they must be fully decoded in Pass 2.
              if (gopDuration <= 1.0) {
                if (!info1.hasText && !info2.hasText && info2.diffScore < 3.0) {
                  g1.isActive = false; // Mark silent GOP window without subtitles
                }
              }
            }
          }
        }

        const activeGops = gops.filter((g) => g.isActive);

        // Pre-slice gop.deltas to only include frames up to the last target timestamp in each GOP
        // This avoids decoding trailing frames in the GOP that are not needed.
        const targetTimePoints: number[] = [];
        for (let t = startT; t <= endT + 0.001; t += stepInterval) {
          targetTimePoints.push(Number(t.toFixed(2)));
        }

        for (const gop of activeGops) {
          const gopTargets = targetTimePoints.filter(t => t >= gop.startSec - 0.05 && t <= gop.endSec + 0.05);
          if (gopTargets.length > 0) {
            const maxTargetSec = Math.max(...gopTargets);
            let maxNeededIdx = -1;
            for (let idx = 0; idx < gop.deltas.length; idx++) {
              const sTime = gop.deltas[idx].cts / gop.deltas[idx].timescale;
              if (sTime <= maxTargetSec + 0.15) {
                maxNeededIdx = idx;
              }
            }
            gop.deltas = gop.deltas.slice(0, maxNeededIdx + 1);
          } else {
            // No target points in this GOP, empty its deltas so we only decode the keyframe!
            gop.deltas = [];
          }
        }

        if (onProgress) {
          onProgress(
            0,
            100,
            `⚡ [Pass 2/2] Bật hardware decoding song song trên ${activeGops.length}/${gops.length} vùng thoại active...`
          );
        }

        // PASS 2: Parallel VideoDecoder Execution across active GOP chunks - Unlocked up to 16 parallel decoders for maximum CPU/GPU utilization
        const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
        const maxParallel = Math.min(16, Math.max(2, logicalCores));
        const numParallel = Math.min(maxParallel, Math.max(1, Math.ceil(activeGops.length / 3)));
        const chunkSize = Math.ceil(activeGops.length / numParallel);

        let globalCapturedCount = 0;
        let globalDecodedCount = 0;
        let lastProgressReportTime = 0;

        const parallelPromises = Array.from({ length: numParallel }).map(async (_, pIdx) => {
          const chunkGops = activeGops.slice(pIdx * chunkSize, (pIdx + 1) * chunkSize);
          if (chunkGops.length === 0) return 0;

          return new Promise<number>((pResolve) => {
            let prevDiffPixelData: Uint8ClampedArray | null = null;
            let lastEmittedTimestamp = -999;
            let lastProcessedTimestamp = -999;
            let workerCaptured = 0;
            let currentSecondBucket = -1;
            let framesInCurrentSecond = 0;
            let consecutiveNoTextCount = 0;
            let consecutiveStaticCount = 0;
            const workerGridCacheRef: { current: GridCacheState | null } = { current: null };

            interface SubtitleActiveBlock {
              startTime: number;
              endTime: number;
              candidateFrame: FrameItem | null;
              candidateScore: number;
              framesSeen: number;
            }
            let activeSubBlock: SubtitleActiveBlock | null = null;

            const flushActiveSubBlock = () => {
              if (activeSubBlock && activeSubBlock.candidateFrame) {
                const f = activeSubBlock.candidateFrame;
                f.segStartTime = activeSubBlock.startTime;
                f.segEndTime = Math.max(activeSubBlock.startTime + 0.4, activeSubBlock.endTime);
                f.timestamp = parseFloat(((f.segStartTime + f.segEndTime) / 2).toFixed(2));
                workerCaptured++;
                globalCapturedCount++;
                if (onProgress) {
                  const duration = Math.max(0.1, endT - startT);
                  const timeProgress = Math.min(1.0, Math.max(0.0, (f.timestamp - startT) / duration));
                  const pct = Math.round(timeProgress * 100);
                  onProgress(
                    globalCapturedCount,
                    pct,
                    `⚡ [Tăng tốc 1 Sub/Frame] (${pct}%): Thu được ${globalCapturedCount} câu phụ đề (${f.segStartTime.toFixed(1)}s - ${f.segEndTime.toFixed(1)}s)...`
                  );
                }
                onFrameCaptured(f);
                activeSubBlock = null;
              }
            };

            const fallbackCanvas = typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(320, 160)
              : document.createElement('canvas');
            const fallbackCtx = fallbackCanvas.getContext('2d', { willReadFrequently: true }) as any;

            const offscreenCanvas = typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(1280, 720)
              : document.createElement('canvas');
            const offCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true }) as any;

            const pass2Decoder = new VideoDecoder({
              output: async (frame: VideoFrame) => {
                if (shouldCancel && shouldCancel()) {
                  frame.close();
                  return;
                }

                const timestampSec = frame.timestamp / 1_000_000;
                if (timestampSec < startT - 0.1 || timestampSec > endT + 0.1) {
                  frame.close();
                  return;
                }

                // Smooth Progress Update for silent/no-subtitle zones
                globalDecodedCount++;
                const nowMs = performance.now();
                if (nowMs - lastProgressReportTime > 250) {
                  lastProgressReportTime = nowMs;
                  if (onProgress) {
                    const duration = Math.max(0.1, endT - startT);
                    const timeProgress = Math.min(1.0, Math.max(0.0, (timestampSec - startT) / duration));
                    const pct = Math.round(timeProgress * 100);
                    onProgress(
                      globalCapturedCount,
                      pct,
                      `🚀 [WebCodecs Song Song] (${pct}% | ${timestampSec.toFixed(1)}s/${endT.toFixed(1)}s): Bóc ${globalCapturedCount} khung...`
                    );
                  }
                }

                // Optimization: Avoid heavy JS processing (pixel copy, filter, diff) for frames too close together
                // A minimum gap of 0.12s (~8.3 fps) is optimal to prevent redundant crop+diff on dense consecutive candidate frames
                if (timestampSec - lastProcessedTimestamp < 0.12) {
                  frame.close();
                  return;
                }
                lastProcessedTimestamp = timestampSec;

                // Tầng 1: Hard Sampling Rate Ceiling (never emit faster than every 0.20s = max 5.0 fps)
                if (timestampSec - lastEmittedTimestamp < 0.20) {
                  frame.close();
                  return;
                }

                // Tầng 3: Throttling Queue - Max 2 frames per video-second window for stable non-spike regions
                const secBucket = Math.floor(timestampSec);
                if (secBucket !== currentSecondBucket) {
                  currentSecondBucket = secBucket;
                  framesInCurrentSecond = 0;
                }

                const vW = frame.codedWidth || frame.displayWidth || 1280;
                const vH = frame.codedHeight || frame.displayHeight || 720;

                const cropX = Math.max(0, Math.floor((roi.x / 100) * vW));
                const cropY = Math.max(0, Math.floor((roi.y / 100) * vH));
                const cropW = Math.max(16, Math.floor((roi.width / 100) * vW));
                const cropH = Math.max(16, Math.floor((roi.height / 100) * vH));

                // Direct VideoFrame.copyTo() into Uint8ClampedArray (No canvas drawImage for diffing!)
                const rawCropBuffer = new Uint8ClampedArray(cropW * cropH * 4);
                await copyVideoFrameRoiDirect(frame, cropX, cropY, cropW, cropH, rawCropBuffer, fallbackCanvas, fallbackCtx);

                applyThresholdingNoiseFilter(rawCropBuffer, cropW, cropH);
                let diffScore = 0;
                let isTransitionFrame = false;

                if (prevDiffPixelData && prevDiffPixelData.length === rawCropBuffer.length) {
                  diffScore = computeFrameDiffScore(rawCropBuffer, prevDiffPixelData, cropW, cropH);
                  if (diffScore >= TRANSITION_DIFF_THRESHOLD) {
                    isTransitionFrame = true;
                  } else if (diffScore >= 1.5 && shouldOverrideFrameSkip(rawCropBuffer, cropW, cropH, 15, workerGridCacheRef)) {
                    isTransitionFrame = true;
                  }
                }
                prevDiffPixelData = rawCropBuffer;

                // Adaptive Frame Stepping:
                // 1. On transition spike (text appearing/disappearing): snap interval tight (min 0.18s) to accurately capture word transitions.
                // 2. In holding subtitle zones (consecutiveStaticCount >= 2, diffScore < 1.8): step forward smoothly up to 1.4s to skip redundant OCR on identical text.
                // 3. In prolonged quiet zones (consecutiveNoTextCount >= 2): expand interval up to 1.8s, snapping back immediately upon frame diff activity.
                let effectiveStepInterval = stepInterval;
                if (options.adaptiveSampling !== false) {
                  if (isTransitionFrame) {
                    effectiveStepInterval = Math.max(0.18, stepInterval * 0.75);
                    consecutiveStaticCount = 0;
                    consecutiveNoTextCount = 0;
                  } else if (consecutiveStaticCount >= 2) {
                    const stretch = 1.25 + Math.min(0.5, (consecutiveStaticCount - 2) * 0.15);
                    effectiveStepInterval = Math.min(0.9, stepInterval * stretch);
                  } else if (consecutiveNoTextCount >= 2) {
                    // Cap quiet stretch so that fast dialogues (3-4 characters, ~0.6-0.8s) are NEVER skipped!
                    const quietStretch = 1.15 + Math.min(0.35, (consecutiveNoTextCount - 2) * 0.1);
                    effectiveStepInterval = Math.min(0.75, stepInterval * quietStretch);
                  }
                }

                const isIntervalElapsed = (timestampSec - lastEmittedTimestamp) >= (effectiveStepInterval - 0.05);

                // Skip non-transition and non-elapsed interval frames immediately!
                if (!isTransitionFrame && !isIntervalElapsed) {
                  frame.close();
                  return;
                }

                // Dynamic Throttling Check: Respect effectiveStepInterval rate per video second
                const maxFramesPerSec = Math.max(4, Math.ceil(1 / Math.max(0.1, effectiveStepInterval)) + 2);
                if (!isTransitionFrame && framesInCurrentSecond >= maxFramesPerSec && diffScore < 6.0) {
                  frame.close();
                  return;
                }

                // Full-res capture rendering for frames being emitted
                const scale = Math.min(1.0, 720 / Math.max(cropW, cropH));
                const targetW = Math.round(cropW * scale);
                const targetH = Math.round(cropH * scale);

                if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
                  offscreenCanvas.width = targetW;
                  offscreenCanvas.height = targetH;
                }

                offCtx.drawImage(frame, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
                frame.close();

                if (bgFilterMode !== 'none' && bgFilterStrength > 0) {
                  applyBackgroundFilter(offCtx, targetW, targetH, bgFilterMode, bgFilterStrength);
                }

                const imgData = offCtx.getImageData(0, 0, targetW, targetH);
                const currPixelData = imgData.data;

                lastEmittedTimestamp = timestampSec;
                framesInCurrentSecond++;

                const { hasText } = detectTextPresenceInFrame(currPixelData, targetW, targetH, bgFilterStrength, workerGridCacheRef);
                
                // Track quiet streak and static subtitle streak for adaptive interval expansion
                if (hasText) {
                  consecutiveNoTextCount = 0;
                  if (!isTransitionFrame && diffScore < 1.8) {
                    consecutiveStaticCount++;
                  } else {
                    consecutiveStaticCount = 0;
                  }
                } else {
                  consecutiveNoTextCount++;
                  consecutiveStaticCount = 0;
                }

                // Optimization: Skip computing Laplacian variance since sharpnessScore is completely unused in the app
                const sharpnessScore = 0;

                let finalCanvas: HTMLCanvasElement | undefined = undefined;
                if (!isLocalPaddle) {
                  finalCanvas = document.createElement('canvas');
                  finalCanvas.width = targetW;
                  finalCanvas.height = targetH;
                  const fCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
                  if (fCtx) {
                    fCtx.putImageData(imgData, 0, 0);
                  }
                }

                if (options.speedUpMode) {
                  if (hasText) {
                    const isNewSentence = !activeSubBlock || (isTransitionFrame && (timestampSec - activeSubBlock.startTime >= 0.35));
                    if (isNewSentence) {
                      flushActiveSubBlock();
                      activeSubBlock = {
                        startTime: timestampSec,
                        endTime: timestampSec,
                        candidateFrame: {
                          canvas: finalCanvas,
                          pixelData: new Uint8ClampedArray(currPixelData),
                          width: targetW,
                          height: targetH,
                          timestamp: timestampSec,
                          hasText: true,
                          frameDiffScore: diffScore,
                          isTransitionFrame: true,
                          sharpnessScore,
                        },
                        candidateScore: 1,
                        framesSeen: 1,
                      };
                    } else if (activeSubBlock) {
                      activeSubBlock.endTime = timestampSec;
                      activeSubBlock.framesSeen++;
                      const offset = timestampSec - activeSubBlock.startTime;
                      // Capture frame after ~0.15s - 0.40s to bypass initial fade-in
                      if (offset >= 0.15 && offset <= 0.40 && activeSubBlock.candidateScore < 2) {
                        activeSubBlock.candidateFrame = {
                          canvas: finalCanvas,
                          pixelData: new Uint8ClampedArray(currPixelData),
                          width: targetW,
                          height: targetH,
                          timestamp: timestampSec,
                          hasText: true,
                          frameDiffScore: diffScore,
                          isTransitionFrame: false,
                          sharpnessScore,
                        };
                        activeSubBlock.candidateScore = 2;
                      }
                    }
                  } else {
                    if (activeSubBlock) {
                      flushActiveSubBlock();
                    }
                  }
                } else {
                  workerCaptured++;
                  globalCapturedCount++;

                  if (onProgress) {
                    const duration = Math.max(0.1, endT - startT);
                    const timeProgress = Math.min(1.0, Math.max(0.0, (timestampSec - startT) / duration));
                    const pct = Math.round(timeProgress * 100);
                    onProgress(
                      globalCapturedCount,
                      pct,
                      `🚀 [WebCodecs Song Song] (${pct}% | ${timestampSec.toFixed(1)}s/${endT.toFixed(1)}s): Bóc ${globalCapturedCount} khung...`
                    );
                  }

                  onFrameCaptured({
                    canvas: finalCanvas,
                    pixelData: currPixelData,
                    width: targetW,
                    height: targetH,
                    timestamp: timestampSec,
                    hasText,
                    frameDiffScore: diffScore,
                    isTransitionFrame,
                    sharpnessScore,
                  });
                }
              },
              error: (err) => {
                console.warn('Pass 2 Parallel Decoder error:', err);
                pResolve(workerCaptured);
              },
            });

            try {
              try {
                pass2Decoder.configure(decoderConfig);
              } catch (_cfgErr) {
                const altConfig = { ...decoderConfig };
                delete (altConfig as any).description;
                pass2Decoder.configure(altConfig);
              }

              for (const gop of chunkGops) {
                if (shouldCancel && shouldCancel()) break;

                // Keyframe
                const kSample = gop.keyframe;
                pass2Decoder.decode(new EncodedVideoChunk({
                  type: 'key',
                  timestamp: (kSample.cts * 1_000_000) / kSample.timescale,
                  duration: (kSample.duration * 1_000_000) / kSample.timescale,
                  data: kSample.data,
                }));

                // Delta frames
                for (const dSample of gop.deltas) {
                  if (shouldCancel && shouldCancel()) break;
                  pass2Decoder.decode(new EncodedVideoChunk({
                    type: 'delta',
                    timestamp: (dSample.cts * 1_000_000) / dSample.timescale,
                    duration: (dSample.duration * 1_000_000) / dSample.timescale,
                    data: dSample.data,
                  }));
                  (dSample as any).data = null;
                }
                (kSample as any).data = null;
                gop.deltas = [];
              }

              pass2Decoder.flush().then(() => {
                if (options.speedUpMode) flushActiveSubBlock();
                pResolve(workerCaptured);
              }).catch(() => {
                if (options.speedUpMode) flushActiveSubBlock();
                pResolve(workerCaptured);
              });
            } catch (err) {
              console.warn('Pass 2 configure/decode error:', err);
              pResolve(workerCaptured);
            }
          });
        });

        await Promise.all(parallelPromises);
        resolve(globalCapturedCount);
      };

      processAllSamples(allSamples).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * METHOD 1: Fast Parallel 16x Playback Frame Extractor (requestVideoFrameCallback)
 * Spawns concurrent offscreen video streams playing segments at 16x speed.
 * Performs PRE-CHECKING text presence on raw pixelData BEFORE converting canvas to data URL / full capture.
 */
export async function extractFramesFastPlayback(options: FrameExtractorOptions): Promise<number> {
  const {
    videoUrl,
    crossOrigin,
    startT,
    endT,
    stepInterval,
    roi,
    bgFilterMode = 'none',
    bgFilterStrength = 0,
    onFrameCaptured,
    onProgress,
    shouldCancel,
  } = options;

  const timePoints: number[] = [];
  for (let t = startT; t <= endT + 0.001; t += stepInterval) {
    timePoints.push(Number(t.toFixed(2)));
  }

  const totalFrames = timePoints.length;
  if (totalFrames === 0) return 0;

  if (onProgress) onProgress(0, totalFrames, '⚡ Đang khởi tạo luồng phát video 16x siêu tốc (requestVideoFrameCallback)...');

  const tempVideo = document.createElement('video');
  tempVideo.muted = true;
  tempVideo.playsInline = true;
  tempVideo.preload = 'auto';
  tempVideo.style.position = 'fixed';
  tempVideo.style.left = '-9999px';
  tempVideo.style.top = '-9999px';
  tempVideo.style.width = '1px';
  tempVideo.style.height = '1px';
  tempVideo.style.opacity = '0';
  tempVideo.style.pointerEvents = 'none';

  if (crossOrigin) {
    tempVideo.crossOrigin = crossOrigin;
  } else if (!videoUrl.startsWith('blob:') && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
    tempVideo.crossOrigin = 'anonymous';
  }

  document.body.appendChild(tempVideo);

  await new Promise((resolve) => {
    if (tempVideo.readyState >= 1 && tempVideo.videoWidth > 0) return resolve(true);
    const onMeta = () => {
      tempVideo.removeEventListener('loadedmetadata', onMeta);
      resolve(true);
    };
    tempVideo.addEventListener('loadedmetadata', onMeta);
    tempVideo.src = videoUrl;
    tempVideo.load();
    setTimeout(resolve, 1200);
  });

  const vWidth = tempVideo.videoWidth || 1280;
  const vHeight = tempVideo.videoHeight || 720;

  const cropX = Math.max(0, (roi.x / 100) * vWidth);
  const cropY = Math.max(0, (roi.y / 100) * vHeight);
  const cropW = Math.min(vWidth - cropX, (roi.width / 100) * vWidth);
  const cropH = Math.min(vHeight - cropY, (roi.height / 100) * vHeight);

  let scale = 1.0;
  if (cropW > 0 && cropH > 0) {
    if (cropH < 64) scale = 64 / cropH;
    else if (cropW > 1280) scale = 1280 / cropW;
  }

  const targetW = Math.max(32, Math.round(cropW * scale));
  const targetH = Math.max(32, Math.round(cropH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    tempVideo.remove();
    return 0;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Seek once to start time
  tempVideo.currentTime = Math.max(0, startT - 0.05);
  await new Promise((r) => setTimeout(r, 60));

  // Set high playback rate (up to 16x)
  try {
    tempVideo.playbackRate = 16;
  } catch {
    tempVideo.playbackRate = 8;
  }

  let capturedCount = 0;
  let nextTargetIdx = 0;

  const videoEl: HTMLVideoElement = tempVideo;

  return new Promise<number>((resolve) => {
    let callbackId: number | null = null;
    let watchdogTimer: any = null;

    const cleanup = () => {
      if (watchdogTimer) clearInterval(watchdogTimer);
      if (callbackId !== null && 'cancelVideoFrameCallback' in videoEl) {
        try {
          (videoEl as any).cancelVideoFrameCallback(callbackId);
        } catch {}
      }
      videoEl.pause();
      videoEl.src = '';
      videoEl.load();
      videoEl.remove();
    };

    let consecutiveNoTextStreak = 0;
    const fastGridCacheRef: { current: GridCacheState | null } = { current: null };

    const processFrame = (_now: number, metadata?: any) => {
      if (shouldCancel && shouldCancel()) {
        cleanup();
        resolve(capturedCount);
        return;
      }

      const mediaTime = metadata?.mediaTime ?? videoEl.currentTime;

      while (
        nextTargetIdx < timePoints.length &&
        mediaTime >= timePoints[nextTargetIdx] - 0.08
      ) {
        const targetTime = timePoints[nextTargetIdx];

        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

        if (bgFilterMode !== 'none' && bgFilterStrength > 0) {
          applyBackgroundFilter(ctx, targetW, targetH, bgFilterMode, bgFilterStrength);
        }

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const diffCheckData = new Uint8ClampedArray(imgData.data);
        applyThresholdingNoiseFilter(diffCheckData, targetW, targetH);
        // PRE-CHECK: Run Canny Edge & LAB Luminance check BEFORE full processing
        const presence = detectTextPresenceInFrame(diffCheckData, targetW, targetH, bgFilterStrength, fastGridCacheRef);

        if (presence.hasText) {
          consecutiveNoTextStreak = 0;
        } else {
          consecutiveNoTextStreak++;
        }

        capturedCount++;

        onFrameCaptured({
          canvas,
          pixelData: imgData.data,
          width: targetW,
          height: targetH,
          timestamp: targetTime,
          hasText: presence.hasText,
        });

        if (onProgress) {
          onProgress(
            capturedCount,
            totalFrames,
            `⚡ [FastPass 16x] (${capturedCount}/${totalFrames}): Bắt khung hình tốc độ cao...`
          );
        }

        // Adaptive Sampling: If in a prolonged no-text zone, skip the immediately adjacent tight target point
        if (options.adaptiveSampling !== false && consecutiveNoTextStreak >= 3 && nextTargetIdx + 1 < timePoints.length) {
          const gap = timePoints[nextTargetIdx + 1] - targetTime;
          if (gap <= stepInterval * 1.1) {
            nextTargetIdx += 2;
            continue;
          }
        }

        nextTargetIdx++;
      }

      if (mediaTime >= endT - 0.02 || nextTargetIdx >= timePoints.length || videoEl.ended) {
        cleanup();
        resolve(capturedCount);
        return;
      }

      if ('requestVideoFrameCallback' in videoEl) {
        callbackId = (videoEl as any).requestVideoFrameCallback(processFrame);
      } else {
        requestAnimationFrame(() => processFrame(performance.now(), { mediaTime: getVideoCurrentTime(videoEl) }));
      }
    };

    let lastCheckedIdx = -1;
    let stuckTicks = 0;

    watchdogTimer = setInterval(() => {
      if (shouldCancel && shouldCancel()) {
        cleanup();
        resolve(capturedCount);
        return;
      }

      const mediaTime = videoEl.currentTime;

      if (
        nextTargetIdx >= timePoints.length ||
        mediaTime >= endT - 0.02 ||
        videoEl.ended ||
        videoEl.error
      ) {
        // Ensure any remaining timepoints get captured
        while (nextTargetIdx < timePoints.length) {
          const targetTime = timePoints[nextTargetIdx];
          ctx.clearRect(0, 0, targetW, targetH);
          ctx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
          const imgData = ctx.getImageData(0, 0, targetW, targetH);
          const presence = detectTextPresenceInFrame(imgData.data, targetW, targetH);
          capturedCount++;
          onFrameCaptured({
            canvas,
            pixelData: imgData.data,
            width: targetW,
            height: targetH,
            timestamp: targetTime,
            hasText: presence.hasText,
          });
          nextTargetIdx++;
        }
        cleanup();
        resolve(capturedCount);
        return;
      }

      if (nextTargetIdx === lastCheckedIdx) {
        stuckTicks++;
        if (stuckTicks >= 5) {
          if (videoEl.paused) videoEl.play().catch(() => {});
        }
        if (stuckTicks >= 10) {
          nextTargetIdx++;
          stuckTicks = 0;
        }
      } else {
        lastCheckedIdx = nextTargetIdx;
        stuckTicks = 0;
      }
    }, 200);

    videoEl.play().then(() => {
      if ('requestVideoFrameCallback' in videoEl) {
        callbackId = (videoEl as any).requestVideoFrameCallback(processFrame);
      } else {
        requestAnimationFrame(() => processFrame(performance.now(), { mediaTime: getVideoCurrentTime(videoEl) }));
      }
    }).catch(() => {
      cleanup();
      resolve(0);
    });
  });
}

/**
 * METHOD 2: Multi-Video Parallel 16x Stream Extractor (Zero repetitive seek lag)
 * Spawns 4-8 parallel hidden video players, each assigned a fraction of the video timeline.
 * Each player seeks ONLY ONCE to its starting chunk offset, sets playbackRate = 16x, and decodes continuously via requestVideoFrameCallback.
 * Performs fast Canny Edge pre-checking on raw pixel buffer before full canvas/base64 encoding.
 */
export async function extractFramesParallelVideo(options: FrameExtractorOptions): Promise<number> {
  const {
    videoUrl,
    crossOrigin,
    startT,
    endT,
    stepInterval,
    roi,
    bgFilterMode = 'none',
    bgFilterStrength = 0,
    adaptiveSampling = true,
    shouldCancel,
    onFrameCaptured,
    onProgress,
  } = options;

  // Adaptive Sampling: Keep original stepInterval as baseline instead of unconditionally halving it
  // Expanding intervals during static zones and letting transition detection catch rapid updates
  const effectiveInterval = stepInterval;

  const timePoints: number[] = [];
  for (let t = startT; t <= endT + 0.001; t += effectiveInterval) {
    timePoints.push(Number(t.toFixed(2)));
  }

  const totalFrames = timePoints.length;
  if (totalFrames === 0) return 0;

  const useFastCallback = isRequestVideoFrameCallbackSupported();
  // Cap parallel <video> elements safely: mobile/WebView hardware decoders choke above 2-3 concurrent video tags
  const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const isMobileEnv = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const maxWorkers = isMobileEnv ? 2 : Math.min(4, Math.max(2, logicalCores));
  const workerCount = Math.min(maxWorkers, Math.max(1, Math.ceil(totalFrames / 6)));
  const chunkSize = Math.ceil(totalFrames / workerCount);

  let globalCapturedCount = 0;

  const workerPromises = Array.from({ length: workerCount }).map(async (_, workerIdx) => {
    const chunkTimePoints = timePoints.slice(workerIdx * chunkSize, (workerIdx + 1) * chunkSize);
    if (chunkTimePoints.length === 0) return 0;

    const chunkStartT = chunkTimePoints[0];
    const chunkEndT = chunkTimePoints[chunkTimePoints.length - 1];

    const tempVideo = document.createElement('video');
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';
    tempVideo.style.position = 'fixed';
    tempVideo.style.left = '-9999px';
    tempVideo.style.top = '-9999px';
    tempVideo.style.width = '1px';
    tempVideo.style.height = '1px';
    tempVideo.style.opacity = '0';
    tempVideo.style.pointerEvents = 'none';

    if (crossOrigin) {
      tempVideo.crossOrigin = crossOrigin;
    } else if (!videoUrl.startsWith('blob:') && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
      tempVideo.crossOrigin = 'anonymous';
    }

    document.body.appendChild(tempVideo);

    await new Promise((resolve) => {
      if (tempVideo.readyState >= 1 && tempVideo.videoWidth > 0) return resolve(true);
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          tempVideo.removeEventListener('loadedmetadata', done);
          tempVideo.removeEventListener('loadeddata', done);
          tempVideo.removeEventListener('canplay', done);
          resolve(true);
        }
      };
      tempVideo.addEventListener('loadedmetadata', done);
      tempVideo.addEventListener('loadeddata', done);
      tempVideo.addEventListener('canplay', done);
      tempVideo.src = videoUrl;
      tempVideo.load();
      setTimeout(done, 3000);
    });

    const vWidth = tempVideo.videoWidth;
    const vHeight = tempVideo.videoHeight;
    if (!vWidth || !vHeight) {
      tempVideo.remove();
      return 0;
    }

    const rawCropX = Math.max(0, (roi.x / 100) * vWidth);
    const rawCropY = Math.max(0, (roi.y / 100) * vHeight);
    const rawCropW = Math.min(vWidth - rawCropX, (roi.width / 100) * vWidth);
    const rawCropH = Math.min(vHeight - rawCropY, (roi.height / 100) * vHeight);

    // Padding margin (8% per side) to prevent edge character clipping
    const PAD_RATIO = 0.08;
    const padX = Math.round(rawCropW * PAD_RATIO);
    const padY = Math.round(rawCropH * PAD_RATIO);
    const cropX = Math.max(0, rawCropX - padX);
    const cropY = Math.max(0, rawCropY - padY);
    const cropW = Math.min(vWidth - cropX, rawCropW + padX * 2);
    const cropH = Math.min(vHeight - cropY, rawCropH + padY * 2);

    let scale = 1.0;
    if (cropW > 0 && cropH > 0) {
      if (cropH < 64) scale = 64 / cropH;
      else if (cropW > 1280) scale = 1280 / cropW;
    }

    const targetW = Math.max(32, Math.round(cropW * scale));
    const targetH = Math.max(32, Math.round(cropH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      tempVideo.remove();
      return 0;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let workerCaptured = 0;
    let prevPixelData: Uint8ClampedArray | null = null;
    const workerGridCacheRef: { current: GridCacheState | null } = { current: null };

    if (useFastCallback) {
      // Controlled fast playback pass (3.5x rate for smooth GPU decode without keyframe dropping)
      await new Promise<void>((resolveSeek) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          tempVideo.removeEventListener('seeked', done);
          resolveSeek();
        };
        tempVideo.addEventListener('seeked', done);
        tempVideo.currentTime = Math.max(0, chunkStartT - 0.05);
        setTimeout(done, 1500); // Robust safety timeout for slow black-background seek
      });

      try { tempVideo.playbackRate = 3.5; } catch { tempVideo.playbackRate = 2.0; }

      let nextTargetIdx = 0;

      interface SubtitleActiveBlock {
        startTime: number;
        endTime: number;
        candidateFrame: FrameItem | null;
        candidateScore: number;
        framesSeen: number;
      }
      let activeSubBlock: SubtitleActiveBlock | null = null;

      const flushActiveSubBlock = () => {
        if (activeSubBlock && activeSubBlock.candidateFrame) {
          const f = activeSubBlock.candidateFrame;
          f.segStartTime = activeSubBlock.startTime;
          f.segEndTime = Math.max(activeSubBlock.startTime + 0.4, activeSubBlock.endTime);
          f.timestamp = parseFloat(((f.segStartTime + f.segEndTime) / 2).toFixed(2));
          workerCaptured++;
          globalCapturedCount++;
          if (onProgress) {
            const duration = Math.max(0.1, endT - startT);
            const timeProgress = Math.min(1.0, Math.max(0.0, (f.timestamp - startT) / duration));
            const pct = Math.round(timeProgress * 100);
            onProgress(
              globalCapturedCount,
              pct,
              `⚡ [Tăng tốc 1 Sub/Frame] (${pct}%): Thu được ${globalCapturedCount} câu phụ đề (${f.segStartTime.toFixed(1)}s - ${f.segEndTime.toFixed(1)}s)...`
            );
          }
          onFrameCaptured(f);
          activeSubBlock = null;
        }
      };

      await new Promise<void>((resolve) => {
        let callbackId: number | null = null;
        let watchdogTimer: any = null;
        let isProcessing = false;
        let isDraining = false;

        const cleanupWorker = () => {
          if (watchdogTimer) clearInterval(watchdogTimer);
          if (callbackId !== null && 'cancelVideoFrameCallback' in tempVideo) {
            try { (tempVideo as any).cancelVideoFrameCallback(callbackId); } catch {}
          }
          tempVideo.pause();
        };

        const processChunkFrame = async (_now: number, metadata?: any) => {
          if (isProcessing || isDraining) return;
          isProcessing = true;

          try {
            if (shouldCancel && shouldCancel()) {
              cleanupWorker();
              resolve();
              return;
            }

            const mediaTime = metadata?.mediaTime ?? tempVideo.currentTime;

            while (
              nextTargetIdx < chunkTimePoints.length &&
              mediaTime >= chunkTimePoints[nextTargetIdx] - 0.08
            ) {
              if (isDraining) return;
              const targetTime = chunkTimePoints[nextTargetIdx];

              // If decoder leaped ahead by > 0.35s, perform a micro-seek and wait for seeked event
              if (mediaTime > targetTime + 0.35) {
                tempVideo.pause();
                await new Promise<void>((resolveSeek) => {
                  let finished = false;
                  const done = () => {
                    if (finished) return;
                    finished = true;
                    tempVideo.removeEventListener('seeked', done);
                    resolveSeek();
                  };
                  tempVideo.addEventListener('seeked', done);
                  tempVideo.currentTime = targetTime;
                  setTimeout(done, 1000);
                });
                if (isDraining) return;
                try { await tempVideo.play(); } catch {}
              }

              ctx.clearRect(0, 0, targetW, targetH);
              ctx.drawImage(tempVideo, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
              applyUnsharpMask(ctx, targetW, targetH, 1.3, 1);

              if (bgFilterMode !== 'none' && bgFilterStrength > 0) {
                applyBackgroundFilter(ctx, targetW, targetH, bgFilterMode, bgFilterStrength);
              }

              const imgData = ctx.getImageData(0, 0, targetW, targetH);
              const diffCheckData = new Uint8ClampedArray(imgData.data);
              applyThresholdingNoiseFilter(diffCheckData, targetW, targetH);
              let diffScore = 0;
              let isTransitionFrame = false;

              if (prevPixelData) {
                diffScore = computeFrameDiffScore(diffCheckData, prevPixelData, targetW, targetH);
                if (diffScore >= TRANSITION_DIFF_THRESHOLD) {
                  isTransitionFrame = true;
                }
              }
              prevPixelData = diffCheckData;

              const presence = detectTextPresenceInFrame(diffCheckData, targetW, targetH, bgFilterStrength, workerGridCacheRef);

              if (options.speedUpMode) {
                if (presence.hasText) {
                  const isNewSentence = !activeSubBlock || (isTransitionFrame && (targetTime - activeSubBlock.startTime >= 0.35));
                  if (isNewSentence) {
                    flushActiveSubBlock();
                    activeSubBlock = {
                      startTime: targetTime,
                      endTime: targetTime,
                      candidateFrame: {
                        canvas,
                        pixelData: new Uint8ClampedArray(imgData.data),
                        width: targetW,
                        height: targetH,
                        timestamp: targetTime,
                        hasText: true,
                        frameDiffScore: diffScore,
                        isTransitionFrame: true,
                      },
                      candidateScore: 1,
                      framesSeen: 1,
                    };
                  } else if (activeSubBlock) {
                    activeSubBlock.endTime = targetTime;
                    activeSubBlock.framesSeen++;
                    const offset = targetTime - activeSubBlock.startTime;
                    if (offset >= 0.15 && offset <= 0.40 && activeSubBlock.candidateScore < 2) {
                      activeSubBlock.candidateFrame = {
                        canvas,
                        pixelData: new Uint8ClampedArray(imgData.data),
                        width: targetW,
                        height: targetH,
                        timestamp: targetTime,
                        hasText: true,
                        frameDiffScore: diffScore,
                        isTransitionFrame: false,
                      };
                      activeSubBlock.candidateScore = 2;
                    }
                  }
                } else {
                  if (activeSubBlock) {
                    flushActiveSubBlock();
                  }
                }
              } else {
                workerCaptured++;
                globalCapturedCount++;

                onFrameCaptured({
                  canvas,
                  pixelData: imgData.data,
                  width: targetW,
                  height: targetH,
                  timestamp: targetTime,
                  hasText: presence.hasText,
                  frameDiffScore: diffScore,
                  isTransitionFrame,
                });

                if (onProgress) {
                  const duration = Math.max(0.1, endT - startT);
                  const timeProgress = Math.min(1.0, Math.max(0.0, (targetTime - startT) / duration));
                  const pct = Math.round(timeProgress * 100);
                  onProgress(
                    globalCapturedCount,
                    pct,
                    `⚡ [Song Song GPU 4x] (${pct}% | ${targetTime.toFixed(1)}s/${endT.toFixed(1)}s): Bóc ${globalCapturedCount} khung...`
                  );
                }
              }

              nextTargetIdx++;
            }

            if (mediaTime >= chunkEndT - 0.02 || nextTargetIdx >= chunkTimePoints.length || tempVideo.ended) {
              if (options.speedUpMode) flushActiveSubBlock();
              cleanupWorker();
              resolve();
              return;
            }

            if ('requestVideoFrameCallback' in tempVideo) {
              callbackId = (tempVideo as any).requestVideoFrameCallback(processChunkFrame);
            } else {
              requestAnimationFrame(() => processChunkFrame(performance.now(), { mediaTime: getVideoCurrentTime(tempVideo) }));
            }
          } finally {
            isProcessing = false;
          }
        };

        let lastCheckedIdx = -1;
        let stuckTicks = 0;

        watchdogTimer = setInterval(() => {
          if (shouldCancel && shouldCancel()) {
            cleanupWorker();
            resolve();
            return;
          }

          const mediaTime = tempVideo.currentTime;

          if (
            nextTargetIdx >= chunkTimePoints.length ||
            mediaTime >= chunkEndT - 0.02 ||
            tempVideo.ended ||
            tempVideo.error
          ) {
            if (isDraining) return;
            isDraining = true;
            cleanupWorker();

            // Precise seek and capture for remaining points asynchronously!
            (async () => {
              while (nextTargetIdx < chunkTimePoints.length) {
                const targetTime = chunkTimePoints[nextTargetIdx];

                await new Promise<void>((resolveSeek) => {
                  let finished = false;
                  const done = () => {
                    if (finished) return;
                    finished = true;
                    tempVideo.removeEventListener('seeked', done);
                    resolveSeek();
                  };
                  tempVideo.addEventListener('seeked', done);
                  tempVideo.currentTime = targetTime;
                  setTimeout(done, 1000); // Robust timeout
                });

                ctx.clearRect(0, 0, targetW, targetH);
                ctx.drawImage(tempVideo, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
                applyUnsharpMask(ctx, targetW, targetH, 1.3, 1);
                if (bgFilterMode !== 'none' && bgFilterStrength > 0) {
                  applyBackgroundFilter(ctx, targetW, targetH, bgFilterMode, bgFilterStrength);
                }
                const imgData = ctx.getImageData(0, 0, targetW, targetH);
                const presence = detectTextPresenceInFrame(imgData.data, targetW, targetH, bgFilterStrength);
                workerCaptured++;
                globalCapturedCount++;
                onFrameCaptured({
                  canvas,
                  pixelData: imgData.data,
                  width: targetW,
                  height: targetH,
                  timestamp: targetTime,
                  hasText: presence.hasText,
                });
                nextTargetIdx++;
              }
              resolve();
            })();
            return;
          }

          if (nextTargetIdx === lastCheckedIdx) {
            stuckTicks++;
            if (stuckTicks >= 5) {
              if (tempVideo.paused) tempVideo.play().catch(() => {});
            }
            if (stuckTicks >= 10) {
              nextTargetIdx++;
              stuckTicks = 0;
            }
          } else {
            lastCheckedIdx = nextTargetIdx;
            stuckTicks = 0;
          }
        }, 200);

        tempVideo.play().then(() => {
          if ('requestVideoFrameCallback' in tempVideo) {
            callbackId = (tempVideo as any).requestVideoFrameCallback(processChunkFrame);
          } else {
            requestAnimationFrame(() => processChunkFrame(performance.now(), { mediaTime: getVideoCurrentTime(tempVideo) }));
          }
        }).catch(() => {
          cleanupWorker();
          resolve();
        });
      });
    } else {
      // Fallback seeking with Adaptive Sampling
      let consecutiveEmptyCount = 0;
      let i = 0;

      while (i < chunkTimePoints.length) {
        if (shouldCancel && shouldCancel()) break;

        const timePoint = chunkTimePoints[i];

        await new Promise<void>((resolve) => {
          if (Math.abs(tempVideo.currentTime - timePoint) < 0.02) {
            resolve();
            return;
          }

          let timer: any = null;
          let seeked = false;
          const onSeeked = () => {
            if (seeked) return;
            seeked = true;
            if (timer) clearTimeout(timer);
            tempVideo.removeEventListener('seeked', onSeeked);
            resolve();
          };

          timer = setTimeout(() => {
            if (seeked) return;
            seeked = true;
            tempVideo.removeEventListener('seeked', onSeeked);
            resolve();
          }, 200);

          tempVideo.addEventListener('seeked', onSeeked, { once: true });
          tempVideo.currentTime = timePoint;
        });

        if (shouldCancel && shouldCancel()) break;

        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(tempVideo, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
        applyUnsharpMask(ctx, targetW, targetH, 1.3, 1);

        if (bgFilterMode !== 'none' && bgFilterStrength > 0) {
          applyBackgroundFilter(ctx, targetW, targetH, bgFilterMode, bgFilterStrength);
        }

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const diffCheckData = new Uint8ClampedArray(imgData.data);
        applyThresholdingNoiseFilter(diffCheckData, targetW, targetH);
        let diffScore = 0;
        let isTransitionFrame = false;

        if (prevPixelData) {
          diffScore = computeFrameDiffScore(diffCheckData, prevPixelData, targetW, targetH);
          if (diffScore >= TRANSITION_DIFF_THRESHOLD) {
            isTransitionFrame = true;
          }
        }
        prevPixelData = diffCheckData;

        // PRE-CHECK BEFORE FULL CAPTURE
        const presence = detectTextPresenceInFrame(diffCheckData, targetW, targetH, bgFilterStrength, workerGridCacheRef);

        workerCaptured++;
        globalCapturedCount++;

        onFrameCaptured({
          canvas,
          pixelData: imgData.data,
          width: targetW,
          height: targetH,
          timestamp: timePoint,
          hasText: presence.hasText,
          frameDiffScore: diffScore,
          isTransitionFrame,
        });

        if (onProgress) {
          const duration = Math.max(0.1, endT - startT);
          const timeProgress = Math.min(1.0, Math.max(0.0, (timePoint - startT) / duration));
          const pct = Math.round(timeProgress * 100);
          onProgress(
            globalCapturedCount,
            pct,
            `⚡ [Song Song GPU] (${pct}% | ${timePoint.toFixed(1)}s/${endT.toFixed(1)}s): Bóc ${globalCapturedCount} khung...`
          );
        }

        // Consistent sequential sampling without skipping frames
        i++;
      }
    }

    tempVideo.pause();
    tempVideo.src = '';
    tempVideo.load();
    tempVideo.remove();

    return workerCaptured;
  });

  await Promise.all(workerPromises);
  return globalCapturedCount;
}

/**
 * Master Frame Extractor:
 * 1. Tries True WebCodecs VideoDecoder API + MP4Box Demuxer (exact timestamps, zero drift, frame-diffing)
 * 2. Fallbacks seamlessly to Multi-Player Parallel 16x Stream Extractor if VideoDecoder or ArrayBuffer fetch fails.
 */
export async function extractFramesWithWebCodecs(options: FrameExtractorOptions): Promise<number> {
  if (isTrueWebCodecsSupported()) {
    try {
      console.log('⚡ Attempting True WebCodecs VideoDecoder API...');
      const count = await extractFramesTrueWebCodecs(options);
      if (count > 0) {
        console.log(`✅ WebCodecs VideoDecoder decoded ${count} frames successfully with frame-diffing.`);
        return count;
      }
    } catch (webcodecsErr) {
      console.warn('WebCodecs VideoDecoder failed or skipped, falling back to Parallel 16x Stream:', webcodecsErr);
    }
  }

  // Fallback to Parallel 16x Stream (with frame-diffing)
  return extractFramesParallelVideo(options);
}

// Compatibility exports
export const isWebCodecsSupported = isTrueWebCodecsSupported;

