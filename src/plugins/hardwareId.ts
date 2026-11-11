import { registerPlugin } from '@capacitor/core';

export interface HardwareIdPlugin {
  /**
   * Lấy mã ANDROID_ID, Device ID và Member Code cố định phần cứng
   */
  getAndroidId(): Promise<{
    androidId: string;
    deviceId?: string;
    memberCode?: string;
    hardwareSerial?: string;
    model?: string;
    manufacturer?: string;
    brand?: string;
    hardware?: string;
    device?: string;
    board?: string;
    fingerprint?: string;
    error?: string;
  }>;
}

const NativeHardwareId = registerPlugin<HardwareIdPlugin>('HardwareId', {
  web: () => ({
    getAndroidId: async () => {
      // Fallback khi chạy trên Web Browser
      return { androidId: '' };
    }
  })
});

export default NativeHardwareId;

