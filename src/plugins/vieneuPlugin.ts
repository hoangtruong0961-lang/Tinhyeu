import { registerPlugin } from '@capacitor/core';

export interface VieNeuStatus {
  isReady: boolean;
  isCloningReady?: boolean;
  isDownloading: boolean;
  modelsPath?: string;
  totalSizeMB?: number;
  platform?: string;
}

export interface VieNeuProgressEvent {
  status: 'downloading' | 'extracting' | 'completed' | 'cancelled' | 'error';
  percent: number;
  message: string;
}

export interface VieNeuSynthesizeOptions {
  tokenIds: number[];
  voiceName: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  repPenalty?: number;
  repWindow?: number;
  maxFrames?: number;
  seed?: number;
}

export interface VieNeuSynthesizeResult {
  success: boolean;
  audioPath: string;
  duration: number;
}

export interface VieNeuCloneVoiceOptions {
  audioBase64: string;
  voiceName: string;
  gender?: 'male' | 'female';
  accent?: 'bac' | 'trung' | 'nam';
  fileName?: string;
  mimeType?: string;
}

export interface VieNeuCloneVoiceResult {
  success: boolean;
  voice: {
    id: string;
    name: string;
    gender: 'male' | 'female';
    accent: 'bac' | 'trung' | 'nam';
    style: string;
    description: string;
    speaker_emb: number[];
    codes: number[][];
    numFrames?: number;
    createdAt?: string;
  };
}

export interface VieNeuPluginInterface {
  checkStatus(): Promise<VieNeuStatus>;
  downloadModels(options?: { includeCloning?: boolean }): Promise<{
    success: boolean;
    modelsPath: string;
    isReady: boolean;
    isCloningReady?: boolean;
  }>;
  downloadCloningModels(): Promise<{
    success: boolean;
    isCloningReady: boolean;
    isReady: boolean;
  }>;
  cloneVoice(options: VieNeuCloneVoiceOptions): Promise<VieNeuCloneVoiceResult>;
  cancelDownload(): Promise<{ success: boolean }>;
  deleteModels(): Promise<{ success: boolean; message: string }>;
  listVoices(): Promise<{ success: boolean; voices: string[] }>;
  saveCustomVoice(options: { name: string; speakerEmb: number[]; codes: number[][] }): Promise<{ success: boolean; message: string }>;
  listCustomVoices(): Promise<{ success: boolean; voices: { id: string; name: string }[] }>;
  deleteCustomVoice(options: { name: string }): Promise<{ success: boolean }>;
  synthesize(options: VieNeuSynthesizeOptions): Promise<VieNeuSynthesizeResult>;
  cancelSynthesis(): Promise<{ success: boolean }>;
  releaseModels(): Promise<{ success: boolean }>;
  addListener(
    eventName: 'vieneu_download_progress',
    listenerFunc: (event: VieNeuProgressEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const VieNeuNative = registerPlugin<VieNeuPluginInterface>('VieNeuNative', {
  web: {
    async checkStatus() {
      return {
        isReady: false,
        isCloningReady: false,
        isDownloading: false,
        platform: 'web',
        totalSizeMB: 0,
      };
    },
    async downloadModels() {
      throw new Error('Mô hình VieNeu-TTS v3 Turbo offline chỉ hỗ trợ trên ứng dụng Android (Native ONNX Runtime).');
    },
    async downloadCloningModels() {
      throw new Error('Gói AI Clone Giọng chỉ hỗ trợ trên ứng dụng Android (Native ONNX Runtime).');
    },
    async cloneVoice() {
      throw new Error('Tính năng nhân bản giọng thật ONNX chỉ hoạt động trên ứng dụng Android APK.');
    },
    async cancelDownload() {
      return { success: true };
    },
    async deleteModels() {
      return { success: true, message: 'Đã xóa mô hình khỏi hệ thống web.' };
    },
    async listVoices() {
      return {
        success: true,
        voices: ['Minh Đức', 'Phạm Tuyên', 'Thái Sơn', 'Xuân Vĩnh', 'Thanh Bình', 'Mai Anh', 'Ngọc Huyền'],
      };
    },
    async saveCustomVoice(_options: { name: string; speakerEmb: number[]; codes: number[][] }) {
      return { success: true, message: 'Saved on web' };
    },
    async listCustomVoices() {
      return { success: true, voices: [] };
    },
    async deleteCustomVoice(_options: { name: string }) {
      return { success: true };
    },
    async synthesize() {
      throw new Error('Động cơ VieNeu-TTS v3 Turbo Offline chạy trực tiếp trên Android qua ONNX Runtime.');
    },
    async cancelSynthesis() {
      return { success: true };
    },
    async releaseModels() {
      return { success: true };
    },
    async addListener(_eventName: 'vieneu_download_progress', _listenerFunc: (event: VieNeuProgressEvent) => void) {
      return { remove: async () => {} };
    },
  },
});
