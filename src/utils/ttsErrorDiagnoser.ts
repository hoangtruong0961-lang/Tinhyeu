import { Capacitor } from '@capacitor/core';
import { VieNeuNative } from '../plugins/vieneuPlugin';
import { TtsErrorInfo } from '../components/TtsErrorModal';

export async function diagnoseTtsError(options: {
  provider: string;
  voiceName: string;
  textSnippet: string;
  error?: any;
  httpStatus?: number;
  rawResponseBody?: string;
}): Promise<TtsErrorInfo> {
  const { provider, voiceName, textSnippet, error, httpStatus, rawResponseBody } = options;
  const isAndroid = Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android';
  const platform = isAndroid ? 'android' : 'web';

  const errStr = error?.message || String(error || '');
  const techStack = `Error Object: ${errStr}\nStack: ${error?.stack || 'N/A'}\nResponse Body: ${rawResponseBody || 'N/A'}`;

  // Log prominently to console with rich formatting for developers and logcat
  console.group(`❌ [TTS Audition Diagnostic Log] ${provider} - ${voiceName}`);
  console.error(`Platform: ${platform}`);
  console.error(`Provider: ${provider}`);
  console.error(`Voice: ${voiceName}`);
  console.error(`HTTP Status: ${httpStatus || 'N/A'}`);
  console.error(`Text Snippet: "${textSnippet.slice(0, 80)}..."`);
  console.error(`Raw Error:`, error);
  if (rawResponseBody) console.error(`Raw Response Body:`, rawResponseBody);
  console.groupEnd();

  // 1. VieNeu-TTS Provider Specific Diagnosis
  if (provider === 'vieneu_tts') {
    if (isAndroid) {
      try {
        const st = await VieNeuNative.checkStatus().catch(() => null);
        if (!st || !st.isReady) {
          return {
            provider,
            providerDisplayName: 'VieNeu-TTS v3 Turbo (Offline AI)',
            voiceName: voiceName || 'Minh Đức',
            textSnippet,
            errorCode: 'VIENEU_MODEL_NOT_DOWNLOADED',
            rootCause: 'Ứng dụng chưa tải gói dữ liệu mô hình VieNeu-TTS v3 Turbo offline (~147 MB) vào bộ nhớ máy Android. Động cơ ONNX Runtime Native không tìm thấy tệp mô hình để khởi tạo.',
            userGuidance: 'Vui lòng bấm nút "Tải gói mô hình VieNeu-TTS (~147 MB)" bên dưới. Ứng dụng sẽ tự động tải tệp ONNX vào bộ nhớ máy để nghe thử offline không cần mạng.',
            technicalDetails: `VieNeu Status: isReady=${st?.isReady}, isDownloading=${st?.isDownloading}, platform=${st?.platform}\n${techStack}`,
            httpStatus,
            platform,
            canDownloadVieNeuModel: true,
          };
        }
      } catch (stErr) {
        console.warn('[VieNeu Status Check Failure]', stErr);
      }

      if (errStr.includes('tokenizer') || errStr.includes('g2pDict') || errStr.includes('convertTextToTokenIds')) {
        return {
          provider,
          providerDisplayName: 'VieNeu-TTS v3 Turbo (Offline AI)',
          voiceName: voiceName || 'Minh Đức',
          textSnippet,
          errorCode: 'VIENEU_G2P_TOKEN_ERROR',
          rootCause: 'Lỗi quy đổi từ ngữ phôn-mát (G2P Tokenizer): Không thể nạp hoặc xử lý tệp quy tắc phát âm tokenizer.json / vieneu_vi_g2p.json từ ứng dụng.',
          userGuidance: 'Vui lòng kiểm tra lại kết nối mạng hoặc thử lại để ứng dụng nạp lại tệp tokenizer chuẩn.',
          technicalDetails: techStack,
          httpStatus,
          platform,
        };
      }

      return {
        provider,
        providerDisplayName: 'VieNeu-TTS v3 Turbo (Offline AI)',
        voiceName: voiceName || 'Minh Đức',
        textSnippet,
        errorCode: 'VIENEU_ONNX_NATIVE_EXECUTION_ERROR',
        rootCause: `Động cơ ONNX Runtime Native trên Android gặp sự cố khi tổng hợp ma trận âm thanh VieNeu. Chi tiết: ${errStr || 'Mô hình chưa hoàn thành khởi tạo'}.`,
        userGuidance: 'Vui lòng kiểm tra xem bộ nhớ thiết bị còn đủ trống không, hoặc thử chọn lại giọng đọc VieNeu khác.',
        technicalDetails: techStack,
        httpStatus,
        platform,
        canDownloadVieNeuModel: true,
      };
    }

    // On Web Browser Platform
    return {
      provider,
      providerDisplayName: 'VieNeu-TTS v3 Turbo (Offline AI)',
      voiceName: voiceName || 'Minh Đức',
      textSnippet,
      errorCode: 'VIENEU_WEB_SERVER_FALLBACK_FAILED',
      rootCause: `Động cơ VieNeu-TTS v3 Turbo Offline được thiết kế chạy trực tiếp bằng đĩa cứng GPU/CPU trên Android qua ONNX Runtime. Trên trình duyệt Web, bản xem trước tự động chuyển sang giọng đọc CapCut/Edge server fallback nhưng máy chủ không phản hồi được âm thanh. Chi tiết lỗi: ${errStr || (httpStatus ? `HTTP ${httpStatus}` : 'Không có âm thanh tạo ra')}.`,
      userGuidance: 'Bạn có thể chuyển sang chọn nhà cung cấp "CapCut TTS" hoặc "Edge TTS" ở bảng cài đặt giọng đọc để nghe thử mượt mà trên Web, hoặc sử dụng bản cài đặt APK Android để chạy VieNeu Offline 100%.',
      technicalDetails: techStack,
      httpStatus,
      platform,
    };
  }

  // 2. CapCut TTS Provider
  if (provider === 'capcut_tts') {
    return {
      provider,
      providerDisplayName: 'CapCut TTS (K07VN Engine)',
      voiceName,
      textSnippet,
      errorCode: httpStatus ? `CAPCUT_HTTP_${httpStatus}` : 'CAPCUT_API_TIMEOUT',
      rootCause: `Máy chủ dịch vụ giọng đọc CapCut API không phản hồi âm thanh hoặc báo lỗi (Mã HTTP: ${httpStatus || 'Lỗi mạng'}). Chi tiết: ${errStr || rawResponseBody || 'Không nhận được dữ liệu audio'}.`,
      userGuidance: 'Vui lòng kiểm tra kết nối mạng của bạn, hoặc thử đổi sang giọng đọc CapCut khác (ví dụ: Thanh Niên Tự Tin / Cô Gái Hoạt Ngôn).',
      technicalDetails: techStack,
      httpStatus,
      platform,
    };
  }

  // 3. Edge TTS / TikTok / Gemini / Other Providers
  return {
    provider,
    providerDisplayName: provider.toUpperCase(),
    voiceName,
    textSnippet,
    errorCode: httpStatus ? `TTS_HTTP_${httpStatus}` : 'TTS_GENERATION_FAILED',
    rootCause: `Không thể tạo đoạn âm thanh nghe thử bằng nhà cung cấp ${provider}. Nguyên nhân: ${errStr || rawResponseBody || 'Server không trả về dữ liệu audio'}.`,
    userGuidance: 'Vui lòng kiểm tra lại kết nối Internet hoặc chuyển sang nhà cung cấp giọng đọc khác.',
    technicalDetails: techStack,
    httpStatus,
    platform,
  };
}
