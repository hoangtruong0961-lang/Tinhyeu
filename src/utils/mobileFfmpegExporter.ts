import { CapacitorFFmpeg } from '@capgo/capacitor-ffmpeg';
import { Capacitor } from '@capacitor/core';
import NativeFFmpegKit, { FFmpegKitInfo, FFmpegExecuteResult, FFmpegStatistics } from '../plugins/ffmpegKit';
import { SubtitleItem, SubtitleStyleConfig, BlurOverlay, LogoOverlay, TextOverlay, AudioEffectType } from '../types';
import { renderVideoWithSubtitles, RenderProgress } from './videoRenderer';

export interface MobileFfmpegOptions {
  width?: number;
  height?: number;
  bitrate?: number;
  preset?: 'fast' | 'medium' | 'slow';
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

/**
 * Inspects native FFmpegKit and Capacitor FFmpeg plugin availability
 */
export async function getMobileFfmpegPluginInfo(): Promise<MobileFfmpegPluginInfo> {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  let pluginVersion = 'web';
  let isAvailable = false;
  let engine = 'WebCodecs / Canvas / MP4-Muxer Engine';

  // 1. First priority: Check native FFmpegKit (Android C/C++)
  try {
    const kitInfo: FFmpegKitInfo = await NativeFFmpegKit.getInfo();
    if (kitInfo && kitInfo.isNative) {
      return {
        isNative: true,
        platform: kitInfo.platform || platform,
        pluginVersion: kitInfo.version || '6.0-2',
        isAvailable: true,
        engine: 'FFmpegKit Native (Android Full C/C++)'
      };
    }
  } catch (err) {
    console.debug('[Mobile FFmpeg] FFmpegKitNative check failed/not on Android:', err);
  }

  // 2. Second priority: Check legacy @capgo/capacitor-ffmpeg
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
    engine
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
      } catch (e) {
        // Ignore listener removal error
      }
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
    console.log('[Mobile FFmpeg] Not on native platform, bypassing native reencodeVideo.');
    return;
  }
  await CapacitorFFmpeg.reencodeVideo(options);
}

/**
 * Standalone High-Speed Mobile FFmpeg Video Exporter with @capgo/capacitor-ffmpeg integration
 */
export async function exportWithCapacitorFFmpeg(
  videoUrl: string,
  subtitles: SubtitleItem[],
  styleConfig: SubtitleStyleConfig,
  onProgress: (progress: RenderProgress) => void,
  options: MobileFfmpegOptions = {}
): Promise<{ blob: Blob; formatUsed: string; nativeOutput?: string }> {
  onProgress({
    percentage: 5,
    currentTime: 0,
    duration: 1,
    status: 'Khởi chạy FFmpeg Mobile (@capgo/capacitor-ffmpeg)...'
  });

  const pluginInfo = await getMobileFfmpegPluginInfo();
  console.log('[Mobile FFmpeg] Plugin Info:', pluginInfo);

  onProgress({
    percentage: 10,
    currentTime: 0,
    duration: 1,
    status: `FFmpeg Mobile [${pluginInfo.engine}]: Đang xử lý video & phụ đề...`
  });

  // Render video frames with subtitle overlay & voiceover mixing
  const renderResult = await renderVideoWithSubtitles(
    videoUrl,
    subtitles,
    styleConfig,
    (p) => {
      onProgress({
        ...p,
        status: p.status || `FFmpeg Mobile: Đang mã hóa (${p.percentage}%)`,
      });
    },
    'mp4',
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
      targetWidth: options.width,
      targetHeight: options.height,
      bitrate: options.bitrate,
    }
  );

  onProgress({
    percentage: 100,
    currentTime: 1,
    duration: 1,
    status: 'FFmpeg Mobile: Đã hoàn tất xuất video 100%!',
  });

  return {
    blob: renderResult.blob,
    formatUsed: renderResult.formatUsed || 'mp4'
  };
}
