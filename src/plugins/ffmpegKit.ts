import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface FFmpegKitInfo {
  isNative: boolean;
  platform: string;
  version: string;
  buildDate?: string;
  packageType?: string;
}

export interface FFmpegExecuteResult {
  sessionId: number;
  state: string;
  returnCode: number;
  isSuccess: boolean;
  isCancel: boolean;
  duration?: number;
  output?: string;
}

export interface FFmpegStatistics {
  sessionId: number;
  time: number;
  size: number;
  bitrate: number;
  speed: number;
  videoFps: number;
  videoQuality: number;
}

export interface FFmpegLog {
  sessionId: number;
  level: string;
  message: string;
}

export interface FFmpegKitNativePlugin {
  getInfo(): Promise<FFmpegKitInfo>;
  execute(options: { command: string }): Promise<FFmpegExecuteResult>;
  cancel(options?: { sessionId?: number }): Promise<{ cancelled: boolean }>;
  addListener(
    eventName: 'ffmpegStatistics',
    listenerFunc: (stats: FFmpegStatistics) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'ffmpegLog',
    listenerFunc: (log: FFmpegLog) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const NativeFFmpegKit = registerPlugin<FFmpegKitNativePlugin>('FFmpegKitNative', {
  web: () => ({
    getInfo: async () => ({
      isNative: false,
      platform: 'web',
      version: '6.0-web-shim',
      packageType: 'web-fallback'
    }),
    execute: async () => {
      throw new Error('FFmpegKitNative is only available on Android native app.');
    },
    cancel: async () => ({ cancelled: true }),
    addListener: async () => ({
      remove: async () => {}
    }),
    removeAllListeners: async () => {}
  })
});

export default NativeFFmpegKit;
