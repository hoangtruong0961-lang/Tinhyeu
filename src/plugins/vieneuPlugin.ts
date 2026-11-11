import { registerPlugin } from '@capacitor/core';

export interface VieNeuStatus {
  isReady: boolean;
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

export interface VieNeuPluginInterface {
  checkStatus(): Promise<VieNeuStatus>;
  downloadModels(options?: { includeCloning?: boolean }): Promise<{ success: boolean; modelsPath: string; isReady: boolean }>;
  cancelDownload(): Promise<{ success: boolean }>;
  deleteModels(): Promise<{ success: boolean; message: string }>;
  listVoices(): Promise<{ success: boolean; voices: string[] }>;
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
        isDownloading: false,
        platform: 'web',
        totalSizeMB: 0,
      };
    },
    async downloadModels() {
      throw new Error('Mô hình VieNeu-TTS v3 Turbo offline chỉ hỗ trợ trên ứng dụng Android (Native ONNX Runtime).');
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
        voices: ['Minh Đức', 'Mai Anh', 'Mạnh Dũng', 'Lan Nhi', 'Tuấn Kiệt', 'Phương Trang', 'Gia Huy', 'Thảo My', 'Quốc Bảo', 'Bích Ngọc', 'Hoàng Nam', 'Khánh Vy', 'Thanh Thảo', 'Văn Phong'],
      };
    },
    async synthesize() {
      throw new Error('Động cơ VieNeu-TTS v3 Turbo Offline chạy trực tiếp trên Android qua ONNX Runtime. Bản Web xem trước tự động chuyển sang CapCut/Edge TTS server fallback.');
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
