export interface ElectronHardwareAcceleration {
  nvenc_h264?: boolean;
  nvenc_hevc?: boolean;
  qsv_h264?: boolean;
  qsv_hevc?: boolean;
  videotoolbox_h264?: boolean;
  videotoolbox_hevc?: boolean;
  vaapi_h264?: boolean;
}

export interface ElectronFfmpegCheckResult {
  available: boolean;
  version?: string;
  hardwareAcceleration?: ElectronHardwareAcceleration;
  error?: string;
}

export interface ElectronSystemInfo {
  platform: string;
  arch: string;
  cpus: number;
  cpuModel: string;
  totalMemoryGB: number;
  freeMemoryGB: number;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  nativeHardwareId?: string;
  motherboardSerial?: string;
  hardwareHash?: string;
  memberCode?: string;
  deviceId?: string;
}

export interface ElectronFfmpegRenderOptions {
  gpuEncoder?: 'auto' | 'nvenc' | 'qsv' | 'videotoolbox' | 'cpu';
  subMode?: 'hardsub' | 'softsub';
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  crf?: number;
  videoVolume?: number;
  ttsVolume?: number;
}

export interface ElectronFfmpegRenderPayload {
  inputVideoPath?: string;
  inputVideoBufferBase64?: string;
  assContent?: string;
  srtContent?: string;
  audioWavBase64?: string;
  outputPath: string;
  videoDuration?: number;
  options?: ElectronFfmpegRenderOptions;
}

export interface ElectronFfmpegRenderProgress {
  percentage: number;
  currentTime: number;
  duration: number;
  timeStr: string;
  encoder?: string;
  fallbackNotice?: string;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  showOpenDialog: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => Promise<boolean>;
  setProgressBar: (progress: number, options?: { mode?: 'none' | 'normal' | 'indeterminate' | 'error' | 'paused' }) => Promise<boolean>;
  showNotification: (options: { title: string; body: string; silent?: boolean }) => Promise<boolean>;
  preventSleep: () => Promise<{ active: boolean; id?: number }>;
  releaseSleep: () => Promise<{ active: boolean }>;
  toggleDevTools?: () => Promise<boolean>;
  openDevTools?: () => Promise<boolean>;
  getSystemInfo: () => Promise<ElectronSystemInfo>;
  writeTempFile: (options: { filename: string; content: string; isBase64?: boolean }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  checkFfmpegInstalled: () => Promise<ElectronFfmpegCheckResult>;
  cancelFfmpegRender: () => Promise<{ success: boolean; error?: string }>;
  renderSubtitledVideo: (payload: ElectronFfmpegRenderPayload) => Promise<{ success: boolean; outputPath?: string; encoderUsed?: string; error?: string; logs?: string }>;
  runFfmpeg: (args: string[] | { args?: string[]; command?: string }) => Promise<{ success: boolean; code?: number; logs?: string; error?: string; stdout?: string; stderr?: string }>;
  extractAudio?: (options: { inputPath: string; outputPath?: string; sampleRate?: number; channels?: number }) => Promise<{ success: boolean; outputPath?: string; error?: string; code?: number }>;
  onFfmpegProgress: (callback: (data: { line?: string; chunk?: string }) => void) => () => void;
  onFfmpegRenderProgress: (callback: (data: ElectronFfmpegRenderProgress) => void) => () => void;
  onOpenVideoMenu: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
