import { registerPlugin, PluginListenerHandle } from '@capacitor/core';
import type { GenDownloadResponse } from '../types';

export interface YoutubeDLStatus {
  success: boolean;
  platform: string;
  isInitialized: boolean;
  aria2cReady: boolean;
  ytdlpVersion: string;
}

export interface YoutubeDLProgressEvent {
  status: 'extracting' | 'downloading' | 'merging' | 'saving' | 'updating' | 'completed' | 'error';
  percent: number;
  message: string;
}

export interface YoutubeDLUpdateResult {
  success: boolean;
  status: string;
  updated: boolean;
  ytdlpVersion: string;
  message: string;
}

export interface YoutubeDLExtractOptions {
  url: string;
  cookies?: string;
  userAgent?: string;
  referer?: string;
}

export interface YoutubeDLDownloadMediaOptions {
  pageUrl?: string;
  videoUrl: string;
  audioUrl?: string;
  title?: string;
  quality?: string;
  extension?: string;
  isAudioOnly?: boolean;
  hasAudio?: boolean;
  saveToDownloads?: boolean;
  httpHeaders?: Record<string, string>;
  audioHeaders?: Record<string, string>;
}

export interface YoutubeDLDownloadMediaResult {
  success: boolean;
  filePath: string;
  fileName: string;
  sizeMB: number;
  savedPath: string;
}

export interface YoutubeDLDownloadSubtitleOptions {
  subUrl: string;
  lang?: string;
  ext?: string;
  type?: 'official' | 'auto' | 'danmaku';
  title?: string;
  saveToDownloads?: boolean;
  httpHeaders?: Record<string, string>;
}

export interface YoutubeDLDownloadSubtitleResult {
  success: boolean;
  fileName: string;
  savedPath: string;
  srtContent: string;
}

export interface YoutubeDLPluginInterface {
  checkStatus(options?: { autoInit?: boolean }): Promise<YoutubeDLStatus>;
  initEngine(): Promise<YoutubeDLStatus>;
  updateYoutubeDL(options?: { channel?: 'stable' | 'nightly' | 'master' }): Promise<YoutubeDLUpdateResult>;
  extractVideo(options: YoutubeDLExtractOptions): Promise<GenDownloadResponse>;
  downloadMedia(options: YoutubeDLDownloadMediaOptions): Promise<YoutubeDLDownloadMediaResult>;
  downloadSubtitle(options: YoutubeDLDownloadSubtitleOptions): Promise<YoutubeDLDownloadSubtitleResult>;
  addListener(
    eventName: 'youtubedl_download_progress',
    listenerFunc: (event: YoutubeDLProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const YoutubeDLNative = registerPlugin<YoutubeDLPluginInterface>('YoutubeDLNative', {
  web: {
    async checkStatus() {
      return {
        success: true,
        platform: 'web',
        isInitialized: false,
        aria2cReady: false,
        ytdlpVersion: 'Web Server yt-dlp',
      };
    },
    async initEngine() {
      return {
        success: false,
        platform: 'web',
        isInitialized: false,
        aria2cReady: false,
        ytdlpVersion: 'Web Server yt-dlp',
      };
    },
    async updateYoutubeDL() {
      throw new Error('Cập nhật yt-dlp trực tiếp trên thiết bị chỉ khả dụng trên app Android APK.');
    },
    async extractVideo() {
      throw new Error('YoutubeDLNative chỉ khả dụng trên app Android APK.');
    },
    async downloadMedia() {
      throw new Error('YoutubeDLNative chỉ khả dụng trên app Android APK.');
    },
    async downloadSubtitle() {
      throw new Error('YoutubeDLNative chỉ khả dụng trên app Android APK.');
    },
    async addListener() {
      return { remove: async () => {} };
    },
    async removeAllListeners() {},
  },
});
