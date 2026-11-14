import { CapacitorFFmpeg } from '@capgo/capacitor-ffmpeg';
import { Capacitor } from '@capacitor/core';
import NativeFFmpegKit, { FFmpegKitInfo, FFmpegExecuteResult, FFmpegStatistics } from '../plugins/ffmpegKit';
import {
  SubtitleItem,
  SubtitleStyleConfig,
  BlurOverlay,
  LogoOverlay,
  TextOverlay,
  AudioEffectType,
  ExportVideoFormat,
  ExportResolution,
} from '../types';
import { exportToASS } from './srtParser';
import { generateVoiceoverAudioBuffer, audioBufferToWavBlob } from './audioExporter';
import { renderVideoWithSubtitles, RenderProgress } from './videoRenderer';
import { computeExportDimensions, getMimeTypeForFormat } from './exportResolution';

export interface MobileFfmpegOptions {
  fileName?: string;
  format?: ExportVideoFormat;
  resolution?: ExportResolution;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  preset?: 'fast' | 'medium' | 'slow';
  gpuAcceleration?: boolean;
  includeVoiceover?: boolean;
  ttsSpeed?: number;
  ttsPitch?: number;
  videoVolume?: number;
  videoAudioEffect?: AudioEffectType;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  videoDuration?: number;
}

export interface MobileFfmpegPluginInfo {
  isNative: boolean;
  platform: string;
  pluginVersion: string;
  isAvailable: boolean;
  engine: string;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.subarray(i, Math.min(i + step, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Streams a Blob or string in small 1.5 MB chunks into an Android cache temp file (zero OOM).
 */
export async function streamDataToNativeTempFile(
  data: Blob | string,
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const { filePath } = await NativeFFmpegKit.openTempFile({ fileName });

  if (typeof data === 'string') {
    const chunkChars = 512 * 1024;
    for (let offset = 0; offset < data.length; offset += chunkChars) {
      await NativeFFmpegKit.appendFileChunk({
        filePath,
        textContent: data.slice(offset, offset + chunkChars),
      });
      if (onProgress) {
        onProgress(Math.min(100, Math.round(((offset + chunkChars) / Math.max(1, data.length)) * 100)));
      }
    }
    return filePath;
  }

  const chunkSize = 1536 * 1024; // 1.5 MB chunks
  const totalSize = data.size;
  let offset = 0;

  while (offset < totalSize) {
    const slice = data.slice(offset, Math.min(offset + chunkSize, totalSize));
    const buf = await slice.arrayBuffer();
    const b64 = uint8ToBase64(new Uint8Array(buf));
    await NativeFFmpegKit.appendFileChunk({ filePath, base64Chunk: b64 });
    offset += chunkSize;
    if (onProgress && totalSize > 0) {
      onProgress(Math.min(100, Math.round((offset / totalSize) * 100)));
    }
  }

  return filePath;
}

/**
 * Saves a Blob or string directly into public Download/BachTranlastor/ via Android MediaStore.Downloads.
 */
export async function saveBlobToAndroidDownloads(
  data: Blob | string,
  fileName: string,
  mimeType: string = 'application/octet-stream',
  onProgress?: (pct: number) => void
): Promise<{ savedPath: string; fileName: string; sizeMB: number }> {
  const tempPath = await streamDataToNativeTempFile(data, fileName, onProgress);
  try {
    const saved = await NativeFFmpegKit.saveToPublicDownloads({
      filePath: tempPath,
      fileName,
      mimeType,
      deleteSource: true,
    });
    return {
      savedPath: saved.savedPath,
      fileName: saved.fileName,
      sizeMB: saved.sizeMB,
    };
  } catch (err) {
    await NativeFFmpegKit.deleteTempFile({ filePath: tempPath }).catch(() => {});
    throw err;
  }
}

/**
 * Inspects native FFmpegKit and Capacitor FFmpeg plugin availability
 */
export async function getMobileFfmpegPluginInfo(): Promise<MobileFfmpegPluginInfo> {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  let pluginVersion = 'web';
  let isAvailable = false;
  let engine = 'WebCodecs / Canvas / MP4-Muxer Engine';

  try {
    const kitInfo: FFmpegKitInfo = await NativeFFmpegKit.getInfo();
    if (kitInfo && kitInfo.isNative) {
      return {
        isNative: true,
        platform: kitInfo.platform || platform,
        pluginVersion: kitInfo.version || '8.1.7',
        isAvailable: true,
        engine: 'FFmpegKit Native (Android Full C/C++)',
      };
    }
  } catch (err) {
    console.debug('[Mobile FFmpeg] FFmpegKitNative check failed/not on Android:', err);
  }

  try {
    const res = await CapacitorFFmpeg.getPluginVersion();
    if (res && res.version) {
      pluginVersion = res.version;
      isAvailable = true;
      engine = 'Capacitor FFmpeg Plugin';
    }
  } catch (e) {
    console.debug('[Mobile FFmpeg] CapacitorFFmpeg check:', e);
    pluginVersion = isNative ? 'native-unregistered' : 'web-fallback';
    isAvailable = isNative;
  }

  return {
    isNative,
    platform,
    pluginVersion,
    isAvailable,
    engine,
  };
}

/**
 * Executes a native FFmpeg command through FFmpegKit on Android
 */
export async function executeNativeFFmpegCommand(
  command: string,
  onProgress?: (stats: FFmpegStatistics) => void
): Promise<FFmpegExecuteResult> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('Native FFmpegKit is only available when running on Android app.');
  }

  let listenerHandle: any = null;
  if (onProgress) {
    listenerHandle = await NativeFFmpegKit.addListener('ffmpegStatistics', onProgress);
  }

  try {
    const result = await NativeFFmpegKit.execute({ command });
    return result;
  } finally {
    if (listenerHandle) {
      try {
        await listenerHandle.remove();
      } catch (_) {}
    }
  }
}

/**
 * Re-encodes a video file directly using @capgo/capacitor-ffmpeg native plugin
 */
export async function reencodeVideoNative(options: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  bitrate?: number;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  await CapacitorFFmpeg.reencodeVideo(options);
}

function buildAudioEffectFilter(effect: AudioEffectType | undefined, volume: number): string {
  const filters: string[] = [];
  if (effect === 'chipmunk') {
    filters.push('asetrate=44100*1.35,aresample=44100,atempo=0.74');
  } else if (effect === 'deep') {
    filters.push('asetrate=44100*0.78,aresample=44100,atempo=1.28');
  } else if (effect === 'telephone') {
    filters.push('highpass=f=400,lowpass=f=3000');
  } else if (effect === 'walkie_talkie' || effect === 'radio') {
    filters.push('highpass=f=600,lowpass=f=2400,acrusher=bits=8:mode=log');
  } else if (effect === 'echo' || effect === 'cave' || effect === 'cave_echo') {
    filters.push('aecho=0.8:0.88:120:0.4');
  } else if (effect === 'underwater') {
    filters.push('lowpass=f=500');
  } else if (effect === 'megaphone') {
    filters.push('highpass=f=800,lowpass=f=3500,volume=1.35');
  }
  if (Math.abs(volume - 1.0) > 0.01) {
    filters.push(`volume=${Math.max(0, volume).toFixed(2)}`);
  }
  return filters.join(',');
}

function probeVideoDimensions(videoUrl: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    if (!videoUrl.startsWith('blob:')) v.crossOrigin = 'anonymous';
    v.src = videoUrl;
    const done = (w: number, h: number, d: number) => {
      v.removeAttribute('src');
      try { v.load(); } catch {}
      resolve({ width: w || 1280, height: h || 720, duration: isFinite(d) && d > 0 ? d : 10 });
    };
    v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight, v.duration);
    v.onerror = () => done(1280, 720, 10);
    setTimeout(() => done(v.videoWidth || 1280, v.videoHeight || 720, v.duration || 10), 4000);
  });
}

function getTargetBitrateForFFmpeg(width?: number, height?: number, explicitBitrate?: number): number {
  if (explicitBitrate && explicitBitrate > 0) return explicitBitrate;
  const pixels = (width || 1280) * (height || 720);
  if (pixels >= 3840 * 2160) return 18_000_000;
  if (pixels >= 2560 * 1440) return 10_000_000;
  if (pixels >= 1920 * 1080) return 6_000_000;
  if (pixels >= 1280 * 720) return 3_200_000;
  return 1_600_000;
}

/**
 * True Disk-to-Disk Native Android Video Exporter (FFmpegKit + MediaStore.Downloads)
 * with automatic graceful fallback to Mediabunny WebCodecs + chunked MediaStore saver.
 */
export async function exportWithCapacitorFFmpeg(
  videoUrl: string,
  subtitles: SubtitleItem[],
  styleConfig: SubtitleStyleConfig,
  onProgress: (progress: RenderProgress) => void,
  options: MobileFfmpegOptions = {}
): Promise<{ blob?: Blob; formatUsed: string; savedPath?: string; engineUsed: string }> {
  const format: ExportVideoFormat = options.format || 'mp4';
  const baseName = (options.fileName || 'video_export').replace(/\.[^.]+$/, '');
  const mimeMap: Record<ExportVideoFormat, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
  };

  const pluginInfo = await getMobileFfmpegPluginInfo();
  const hasLogosOrText = (options.logoOverlays?.length || 0) > 0 || (options.textOverlays?.length || 0) > 0;
  const hasBlurOverlays = (options.blurOverlays?.length || 0) > 0;
  const needsCanvasOnlyTypography =
    styleConfig.orientation === 'vertical' ||
    Boolean(styleConfig.hasSecondaryOutline) ||
    Boolean(styleConfig.customUploadedFonts && styleConfig.customUploadedFonts.length > 0);

  const canRunDirectFFmpegKit =
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    pluginInfo.isAvailable &&
    !hasLogosOrText &&
    !hasBlurOverlays &&
    !needsCanvasOnlyTypography;

  if (canRunDirectFFmpegKit) {
    let tempInputPath: string | null = null;
    let tempAssPath: string | null = null;
    let tempTtsPath: string | null = null;
    let outputPath: string | null = null;

    try {
      onProgress({
        percentage: 3,
        currentTime: 0,
        duration: options.videoDuration || 1,
        status: 'Đang chuẩn bị tệp video trên bộ nhớ Android (FFmpegKit)...',
      });

      // 1. Resolve video path on disk with zero copy if downloaded locally, or stream chunks if blob:
      const resolved = await NativeFFmpegKit.resolveCapacitorUrl({ url: videoUrl });
      let inputVideoPath = resolved.exists ? resolved.filePath : '';

      if (!inputVideoPath) {
        onProgress({
          percentage: 6,
          currentTime: 0,
          duration: options.videoDuration || 1,
          status: 'Đang chép dữ liệu video ra đĩa tạm (tiết kiệm RAM)...',
        });
        const resp = await fetch(videoUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} khi đọc video nguồn`);
        const srcBlob = await resp.blob();
        tempInputPath = await streamDataToNativeTempFile(srcBlob, `in_${Date.now()}.mp4`, (pct) => {
          onProgress({
            percentage: 6 + Math.round(pct * 0.12),
            currentTime: 0,
            duration: options.videoDuration || 1,
            status: `Đang chuẩn bị luồng nguồn (${pct}%)...`,
          });
        });
        inputVideoPath = tempInputPath;
      }

      // Probe video dimensions & duration for accurate ASS scaling, aspect-ratio & ETA
      const probed = await probeVideoDimensions(videoUrl);
      const duration = Math.max(0.5, options.videoDuration || probed.duration || 10);
      const resolvedDims = computeExportDimensions(options.resolution, probed.width, probed.height);
      const hasCustomScale = Boolean(
        (options.resolution && options.resolution !== 'original') ||
        (options.width && options.height)
      );
      const vW = resolvedDims?.width || options.width || probed.width || 1280;
      const vH = resolvedDims?.height || options.height || probed.height || 720;

      // 2. Write ASS subtitle script to temp disk if subtitles exist
      const hasSubtitles = subtitles.some((s) => (s.translatedText || s.originalText || '').trim().length > 0);
      if (hasSubtitles) {
        const assScript = exportToASS(subtitles, styleConfig, 'translated', vW, vH);
        tempAssPath = await streamDataToNativeTempFile(assScript, `subs_${Date.now()}.ass`);
      }

      // 3. Generate optional TTS Voiceover WAV directly to temp disk
      if (options.includeVoiceover) {
        const subsWithTts = subtitles.filter((s) => s.audioUrl && s.audioUrl.trim().length > 0);
        if (subsWithTts.length > 0) {
          onProgress({
            percentage: 20,
            currentTime: 0,
            duration,
            status: 'Đang tổng hợp track âm thanh thuyết minh TTS...',
          });
          try {
            const voiceRes = await generateVoiceoverAudioBuffer(
              subtitles,
              duration,
              options.ttsSpeed || 1.0,
              options.ttsPitch || 0
            );
            const wavBlob = audioBufferToWavBlob(voiceRes.buffer);
            tempTtsPath = await streamDataToNativeTempFile(wavBlob, `tts_${Date.now()}.wav`);
          } catch (ttsErr) {
            console.warn('[FFmpegKit Export] Could not prepare TTS WAV:', ttsErr);
          }
        }
      }

      // 4. Probe if input video actually has an audio stream
      const videoVol = options.videoVolume ?? 1.0;
      let hasOrigAudio = false;
      if (videoVol > 0) {
        try {
          const probeRes = await NativeFFmpegKit.execute({
            command: `-v error -i "${inputVideoPath}" -map 0:a:0 -t 0.1 -f null -`,
          });
          hasOrigAudio = probeRes.isSuccess;
        } catch {
          hasOrigAudio = false;
        }
      }

      // 5. Prepare output path on Android disk
      const outPrep = await NativeFFmpegKit.prepareOutputPath({
        fileName: baseName,
        format,
      });
      outputPath = outPrep.filePath;

      // 6. Build FFmpeg filter & encoding command
      const inputs: string[] = [`-y -i "${inputVideoPath}"`];
      if (tempTtsPath) {
        inputs.push(`-i "${tempTtsPath}"`);
      }

      const vfParts: string[] = [];
      if (hasCustomScale) {
        vfParts.push(`scale=${vW}:${vH}`);
      } else {
        vfParts.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
      }
      if (options.fps && options.fps > 0) {
        vfParts.push(`fps=${options.fps}`);
      }
      if (tempAssPath) {
        const escapedAss = tempAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        vfParts.push(`ass=${escapedAss}`);
      }
      vfParts.push('format=yuv420p');
      const vfArg = `-vf "${vfParts.join(',')}"`;

      let audioArgs = '-an';
      const effectChain = buildAudioEffectFilter(options.videoAudioEffect, videoVol);

      if (tempTtsPath && hasOrigAudio && videoVol > 0) {
        const origChain = effectChain ? `[0:a]${effectChain}[orig];` : `[0:a]anull[orig];`;
        audioArgs = `-filter_complex "${origChain}[orig][1:a]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]" -map 0:v:0 -map "[aout]" -c:a aac -b:a 192k`;
      } else if (tempTtsPath) {
        audioArgs = `-map 0:v:0 -map 1:a:0 -c:a aac -b:a 192k`;
      } else if (hasOrigAudio && videoVol > 0) {
        if (effectChain) {
          audioArgs = `-map 0:v:0 -map 0:a:0 -af "${effectChain}" -c:a aac -b:a 160k`;
        } else {
          audioArgs = `-map 0:v:0 -map 0:a:0 -c:a copy`;
        }
      } else {
        audioArgs = `-map 0:v:0 -an`;
      }

      const bitrate = getTargetBitrateForFFmpeg(vW, vH, options.bitrate);
      const isWebm = format === 'webm';
      const useHwCodec = !isWebm && options.gpuAcceleration !== false;
      const fastStartArg = (format === 'mp4' || format === 'mov') ? '-movflags +faststart' : '';

      const encoderVariants: { label: string; vCodecArg: string }[] = isWebm
        ? [{ label: 'libvpx-vp9 (CPU)', vCodecArg: `-c:v libvpx -b:v ${bitrate} -deadline realtime -cpu-used 4` }]
        : useHwCodec
        ? [
            { label: 'h264_mediacodec (Android GPU)', vCodecArg: `-c:v h264_mediacodec -b:v ${bitrate}` },
            { label: 'libx264 ultrafast (CPU Fallback)', vCodecArg: `-c:v libx264 -preset ultrafast -crf 23 -maxrate ${bitrate} -bufsize ${bitrate * 2}` },
          ]
        : [{ label: 'libx264 ultrafast (CPU)', vCodecArg: `-c:v libx264 -preset ultrafast -crf 23 -maxrate ${bitrate} -bufsize ${bitrate * 2}` }];

      // Replace aac with libopus when container is webm
      if (isWebm) {
        audioArgs = audioArgs.replace(/-c:a (aac|copy)/g, '-c:a libopus').replace(/-b:a \d+k/g, '-b:a 128k');
      }

      let renderedOk = false;
      let usedEncoderLabel = 'FFmpegKit Native';
      let lastFfErr: any = null;
      const renderStartMs = performance.now();

      for (const variant of encoderVariants) {
        try {
          onProgress({
            percentage: 25,
            currentTime: 0,
            duration,
            status: `FFmpegKit (${variant.label}): Đang xuất trực tiếp ra file...`,
          });

          const cmd = `${inputs.join(' ')} ${vfArg} ${variant.vCodecArg} ${audioArgs} ${fastStartArg} -shortest "${outputPath}"`;
          const execRes = await executeNativeFFmpegCommand(cmd, (stats) => {
            const curSec = Math.max(0, (stats.time || 0) / 1000);
            const ratio = Math.min(0.99, curSec / duration);
            const pct = Number((25 + ratio * 70).toFixed(1));
            const elapsed = (performance.now() - renderStartMs) / 1000;
            const eta = ratio > 0.02 ? Math.max(0, Math.round((elapsed / ratio) * (1 - ratio))) : undefined;
            onProgress({
              percentage: pct,
              currentTime: Math.min(duration, curSec),
              duration,
              fps: stats.videoFps ? Number(stats.videoFps.toFixed(1)) : undefined,
              etaSeconds: eta,
              status: `FFmpegKit (${variant.label}): ${curSec.toFixed(1)}s / ${duration.toFixed(1)}s (${pct}%)`,
            });
          });

          if (execRes.isSuccess) {
            renderedOk = true;
            usedEncoderLabel = `FFmpegKit (${variant.label})`;
            break;
          }
        } catch (err) {
          lastFfErr = err;
          console.warn(`[FFmpegKit Export] Variant ${variant.label} failed, trying next:`, err);
        }
      }

      if (!renderedOk) {
        throw lastFfErr || new Error('FFmpegKit không thể mã hóa video với các encoder hiện có.');
      }

      onProgress({
        percentage: 97,
        currentTime: duration,
        duration,
        status: 'Đang lưu tệp video vào Download/BachTranlastor...',
      });

      const saved = await NativeFFmpegKit.saveToPublicDownloads({
        filePath: outputPath,
        fileName: `${baseName}.${format}`,
        mimeType: mimeMap[format] || 'video/mp4',
        deleteSource: true,
      });

      onProgress({
        percentage: 100,
        currentTime: duration,
        duration,
        status: `Hoàn tất! Đã lưu vào ${saved.savedPath} (${saved.sizeMB} MB)`,
      });

      return {
        formatUsed: format,
        savedPath: saved.savedPath,
        engineUsed: usedEncoderLabel,
      };
    } catch (ffmpegErr) {
      console.warn('[FFmpegKit Export] Native disk pipeline failed, falling back cleanly to Mediabunny + MediaStore saver:', ffmpegErr);
      onProgress({
        percentage: 5,
        currentTime: 0,
        duration: options.videoDuration || 1,
        status: 'Chuyển sang WebCodecs GPU + Lưu thẳng vào Download Android...',
      });
    } finally {
      if (tempInputPath) NativeFFmpegKit.deleteTempFile({ filePath: tempInputPath }).catch(() => {});
      if (tempAssPath) NativeFFmpegKit.deleteTempFile({ filePath: tempAssPath }).catch(() => {});
      if (tempTtsPath) NativeFFmpegKit.deleteTempFile({ filePath: tempTtsPath }).catch(() => {});
    }
  }

  // Tier 2 / Complex Overlay Path: Render via Unified Canvas/WebCodecs (honors blur, logos, text overlays, custom fonts, and MP4/WebM/MOV/MKV)
  // and on Android Capacitor save cleanly to Download/BachTranlastor via chunked MediaStore bridge!
  const renderResult = await renderVideoWithSubtitles(
    videoUrl,
    subtitles,
    styleConfig,
    (p) => {
      onProgress({
        ...p,
        percentage: Number((p.percentage * 0.92).toFixed(1)),
      });
    },
    format,
    {
      blurOverlays: options.blurOverlays,
      logoOverlays: options.logoOverlays,
      textOverlays: options.textOverlays,
      includeVoiceover: options.includeVoiceover,
      ttsSpeed: options.ttsSpeed,
      ttsPitch: options.ttsPitch,
      videoVolume: options.videoVolume,
      videoAudioEffect: options.videoAudioEffect,
      videoDuration: options.videoDuration,
      resolution: options.resolution,
      targetWidth: options.width,
      targetHeight: options.height,
      fps: options.fps,
      bitrate: options.bitrate,
      gpuAcceleration: options.gpuAcceleration,
    }
  );

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    onProgress({
      percentage: 94,
      currentTime: options.videoDuration || 1,
      duration: options.videoDuration || 1,
      status: 'Đang lưu tệp video vào Download/BachTranlastor...',
    });

    const saved = await saveBlobToAndroidDownloads(
      renderResult.blob,
      `${baseName}.${renderResult.formatUsed}`,
      getMimeTypeForFormat(renderResult.formatUsed),
      (pct) => {
        onProgress({
          percentage: Number((94 + pct * 0.06).toFixed(1)),
          currentTime: options.videoDuration || 1,
          duration: options.videoDuration || 1,
          status: `Đang ghi xuống Download/BachTranlastor (${pct}%)...`,
        });
      }
    );

    onProgress({
      percentage: 100,
      currentTime: options.videoDuration || 1,
      duration: options.videoDuration || 1,
      status: `Hoàn tất! Đã lưu vào ${saved.savedPath}`,
    });

    return {
      blob: renderResult.blob,
      formatUsed: renderResult.formatUsed,
      savedPath: saved.savedPath,
      engineUsed: 'WebCodecs Canvas + Android MediaStore',
    };
  }

  onProgress({
    percentage: 100,
    currentTime: 1,
    duration: 1,
    status: 'Đã hoàn tất xuất video 100%!',
  });

  return {
    blob: renderResult.blob,
    formatUsed: renderResult.formatUsed,
    engineUsed: 'Mediabunny WebCodecs',
  };
}
