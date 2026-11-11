import { Capacitor } from '@capacitor/core';
import NativeFFmpegKit, { FFmpegKitInfo, FFmpegExecuteResult, FFmpegStatistics } from '../plugins/ffmpegKit';
import { SubtitleItem, SubtitleStyleConfig, BlurOverlay, LogoOverlay, TextOverlay } from '../types';
import { ElectronFfmpegRenderPayload, ElectronHardwareAcceleration } from '../types/electron';

export type NativePlatformType = 'electron' | 'capacitor-android' | 'capacitor-ios' | 'web-preview';

export interface NativeEngineInfo {
  platform: NativePlatformType;
  isNativeApp: boolean;
  engineName: string;
  version: string;
  isHardwareAccelerated: boolean;
  hardwareEncoders?: ElectronHardwareAcceleration | Record<string, boolean>;
  details: string;
}

export interface NativeExportProgress {
  percentage: number;
  currentTime?: number;
  duration?: number;
  timeStr?: string;
  encoder?: string;
  statusText?: string;
}

/**
 * Unified Native Video & Audio Engine
 * Exclusively tailored for Electron (Desktop) and Capacitor (Android/iOS)
 * Utilizing high-performance native C/C++ FFmpeg libraries.
 */
class NativeVideoEngine {
  /**
   * Determine the current packaging runtime environment
   */
  getPlatform(): NativePlatformType {
    if (typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron)) {
      return 'electron';
    }
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform();
      if (p === 'android') return 'capacitor-android';
      if (p === 'ios') return 'capacitor-ios';
    }
    return 'web-preview';
  }

  isElectron(): boolean {
    return this.getPlatform() === 'electron';
  }

  isCapacitor(): boolean {
    return this.getPlatform().startsWith('capacitor');
  }

  isNative(): boolean {
    return this.isElectron() || this.isCapacitor();
  }

  /**
   * Get detailed engine specs and hardware acceleration capabilities
   */
  async getEngineInfo(): Promise<NativeEngineInfo> {
    const platform = this.getPlatform();

    if (platform === 'electron') {
      try {
        const check = await window.electronAPI?.checkFfmpegInstalled?.();
        const sysInfo = await window.electronAPI?.getSystemInfo?.();
        const hw = check?.hardwareAcceleration || {};
        const hasHw = Boolean(hw.nvenc_h264 || hw.qsv_h264 || hw.videotoolbox_h264 || hw.vaapi_h264);

        return {
          platform: 'electron',
          isNativeApp: true,
          engineName: 'Electron Native C/C++ FFmpeg',
          version: check?.version || 'FFmpeg Native Binary',
          isHardwareAccelerated: hasHw,
          hardwareEncoders: hw,
          details: `Desktop OS: ${sysInfo?.platform || 'Desktop'} (${sysInfo?.arch || 'x64'}), CPU: ${sysInfo?.cpuModel || 'Multi-core'}, RAM: ${sysInfo?.totalMemoryGB || 8}GB`
        };
      } catch (err: any) {
        return {
          platform: 'electron',
          isNativeApp: true,
          engineName: 'Electron Native (FFmpeg bridge)',
          version: 'Electron C++ Core',
          isHardwareAccelerated: false,
          details: `Lỗi kết nối FFmpeg binary: ${err.message || ''}`
        };
      }
    }

    if (platform === 'capacitor-android' || platform === 'capacitor-ios') {
      try {
        const kitInfo: FFmpegKitInfo = await NativeFFmpegKit.getInfo();
        return {
          platform,
          isNativeApp: true,
          engineName: 'FFmpegKit Native C/C++ (ARM64 Full)',
          version: kitInfo.version || 'FFmpegKit 6.0-2 (Native C/C++)',
          isHardwareAccelerated: true,
          hardwareEncoders: { mediacodec_h264: true, neon_arm64: true },
          details: `Thiết bị di động ${platform === 'capacitor-android' ? 'Android' : 'iOS'}, nhúng native library dev.ffmpegkit-maintained:ffmpeg-kit-full-gpl`
        };
      } catch (err: any) {
        return {
          platform,
          isNativeApp: true,
          engineName: 'Capacitor Native Engine',
          version: 'Mobile Core',
          isHardwareAccelerated: true,
          details: `Mobile native runtime: ${err.message || ''}`
        };
      }
    }

    return {
      platform: 'web-preview',
      isNativeApp: false,
      engineName: 'WebCodecs / Canvas Engine (Preview Mode)',
      version: 'Web Fallback',
      isHardwareAccelerated: false,
      details: 'Môi trường web preview (khuyên dùng xuất trên Electron hoặc Capacitor Android APK để tối ưu tốc độ C/C++)'
    };
  }

  /**
   * Execute raw native FFmpeg command (C/C++ binary directly on OS)
   */
  async executeFFmpeg(
    command: string | string[],
    onProgress?: (progressData: any) => void
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const platform = this.getPlatform();

    if (platform === 'electron') {
      if (!window.electronAPI?.runFfmpeg) {
        throw new Error('Electron FFmpeg native runner không khả dụng.');
      }
      const cmdStr = Array.isArray(command) ? command.join(' ') : command;
      const res = await window.electronAPI.runFfmpeg({ command: cmdStr });
      return {
        success: res.success,
        output: res.stdout || res.logs,
        error: res.error || res.stderr
      };
    }

    if (platform === 'capacitor-android' || platform === 'capacitor-ios') {
      const cmdStr = Array.isArray(command) ? command.join(' ') : command;
      let listener: any = null;
      if (onProgress) {
        listener = await NativeFFmpegKit.addListener('ffmpegStatistics', onProgress);
      }
      try {
        const res: FFmpegExecuteResult = await NativeFFmpegKit.execute({ command: cmdStr });
        return {
          success: res.isSuccess,
          output: res.output,
          error: res.isSuccess ? undefined : `FFmpegKit failed with code ${res.returnCode}`
        };
      } finally {
        if (listener) {
          try { await listener.remove(); } catch (_) {}
        }
      }
    }

    throw new Error('Chỉ hỗ trợ chạy lệnh FFmpeg C/C++ trực tiếp trên ứng dụng đóng gói Electron hoặc Capacitor.');
  }

  /**
   * High-speed Native Audio Extraction from Video
   */
  async extractAudioFast(options: {
    videoFilePath: string;
    outputAudioPath?: string;
    sampleRate?: number;
    channels?: number;
  }): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    const platform = this.getPlatform();
    const sampleRate = options.sampleRate || 16000;
    const channels = options.channels || 1;

    if (platform === 'electron' && window.electronAPI?.extractAudio) {
      return await window.electronAPI.extractAudio({
        inputPath: options.videoFilePath,
        outputPath: options.outputAudioPath,
        sampleRate,
        channels
      });
    }

    if (this.isCapacitor()) {
      const outPath = options.outputAudioPath || `temp_audio_${Date.now()}.wav`;
      const cmd = `-y -i "${options.videoFilePath}" -vn -acodec pcm_s16le -ar ${sampleRate} -ac ${channels} "${outPath}"`;
      const res = await this.executeFFmpeg(cmd);
      return {
        success: res.success,
        outputPath: res.success ? outPath : undefined,
        error: res.error
      };
    }

    return {
      success: false,
      error: 'Audio extraction native requires Electron or Capacitor environment.'
    };
  }

  /**
   * Cancel ongoing native export
   */
  async cancelCurrentExport(): Promise<void> {
    if (this.isElectron() && window.electronAPI?.cancelFfmpegRender) {
      await window.electronAPI.cancelFfmpegRender();
    } else if (this.isCapacitor()) {
      await NativeFFmpegKit.cancel();
    }
  }
}

export const nativeVideoEngine = new NativeVideoEngine();
export default nativeVideoEngine;
