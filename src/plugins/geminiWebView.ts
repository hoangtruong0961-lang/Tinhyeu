import { registerPlugin, Capacitor } from '@capacitor/core';

export interface GeminiSessionResult {
  cookies: string;
  snlm0e?: string;
  currentUrl?: string;
  success: boolean;
  hasAuth?: boolean;
  cancelled?: boolean;
  message?: string;
  error?: string;
}

export interface GeminiExecutePromptResult {
  success: boolean;
  text?: string;
  snlm0e?: string;
  error?: string;
}

export interface GeminiWebViewPlugin {
  /**
   * Tự động kiểm tra phiên và lấy Cookie từ WebView ẩn hoặc mở giao diện đăng nhập nếu chưa có.
   */
  fetchGeminiSession(): Promise<GeminiSessionResult>;

  /**
   * Mở giao diện WebView đăng nhập Google / Gemini Web trực tiếp trên App Android.
   * Tự động nhận diện khi người dùng đăng nhập thành công và đóng cửa sổ.
   */
  openGeminiLogin(): Promise<GeminiSessionResult>;

  /**
   * Kiểm tra nhanh trạng thái Cookie hiện tại trong WebView Android.
   */
  checkGeminiSession(): Promise<GeminiSessionResult>;

  /**
   * Xóa toàn bộ session Cookie Google/Gemini trong WebView.
   */
  clearGeminiSession(): Promise<{ success: boolean; message?: string }>;

  /**
   * Thực thi trực tiếp prompt dịch hoặc xử lý văn bản qua giao thức nội bộ Gemini Web RPC
   */
  executeGeminiPrompt(options: {
    prompt: string;
    cookies?: string;
    snlm0e?: string;
  }): Promise<GeminiExecutePromptResult>;
}

const NativeGeminiWebView = registerPlugin<GeminiWebViewPlugin>('GeminiWebView', {
  web: () => ({
    fetchGeminiSession: async () => {
      throw new Error(
        'Tính năng WebView tự động chỉ hỗ trợ trên ứng dụng Android APK (Capacitor). Trên trình duyệt Web máy tính, vui lòng dán Cookie thủ công (__Secure-1PSID).'
      );
    },
    openGeminiLogin: async () => {
      throw new Error(
        'Trình duyệt đăng nhập Google trong App chỉ khả dụng trên bản cài đặt APK Android. Trên Web, bạn chỉ cần mở tab gemini.google.com rồi copy Cookie.'
      );
    },
    checkGeminiSession: async () => {
      return { cookies: '', hasAuth: false, success: false };
    },
    clearGeminiSession: async () => {
      return { success: true };
    },
    executeGeminiPrompt: async () => {
      throw new Error('Chạy native RPC chỉ khả dụng trên Android App.');
    }
  })
});

/**
 * Helper kiểm tra xem thiết bị có đang chạy trên môi trường Native Capacitor hay không
 */
export function isNativeGeminiWebViewSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export default NativeGeminiWebView;
