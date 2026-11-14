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

export interface FFmpegResolveUrlResult {
  exists: boolean;
  filePath: string;
  sizeBytes: number;
}

export interface FFmpegTempFileResult {
  success: boolean;
  filePath: string;
}

export interface FFmpegOutputPathResult {
  success: boolean;
  filePath: string;
  fileName: string;
}

export interface FFmpegAppendChunkResult {
  success: boolean;
  bytesWritten: number;
  totalSize: number;
}

export interface FFmpegSaveDownloadResult {
  success: boolean;
  savedPath: string;
  fileName: string;
  sizeMB: number;
}

export interface FFmpegKitNativePlugin {
  getInfo(): Promise<FFmpegKitInfo>;
  execute(options: { command: string }): Promise<FFmpegExecuteResult>;
  cancel(options?: { sessionId?: number }): Promise<{ cancelled: boolean }>;
  resolveCapacitorUrl(options: { url: string }): Promise<FFmpegResolveUrlResult>;
  openTempFile(options: { fileName: string }): Promise<FFmpegTempFileResult>;
  appendFileChunk(options: {
    filePath: string;
    base64Chunk?: string;
    textContent?: string;
  }): Promise<FFmpegAppendChunkResult>;
  prepareOutputPath(options: { fileName: string; format: string }): Promise<FFmpegOutputPathResult>;
  saveToPublicDownloads(options: {
    filePath: string;
    fileName?: string;
    mimeType?: string;
    deleteSource?: boolean;
  }): Promise<FFmpegSaveDownloadResult>;
  deleteTempFile(options: { filePath: string }): Promise<{ success: boolean }>;
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
    resolveCapacitorUrl: async () => ({ exists: false, filePath: '', sizeBytes: 0 }),
    openTempFile: async () => {
      throw new Error('Not available on web');
    },
    appendFileChunk: async () => {
      throw new Error('Not available on web');
    },
    prepareOutputPath: async () => {
      throw new Error('Not available on web');
    },
    saveToPublicDownloads: async () => {
      throw new Error('Not available on web');
    },
    deleteTempFile: async () => ({ success: false }),
    addListener: async () => ({
      remove: async () => {}
    }),
    removeAllListeners: async () => {}
  })
});

export default NativeFFmpegKit;
