import { AppSettings } from '../types';
import { saveSettingsToDB } from './idbStorage';

const SETTINGS_STORAGE_KEY = 'subtranslate_app_settings_v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ocrEngine: 'paddleocr',
  paddleOcrModelVariant: 'small',
  apiMode: 'direct',
  apiKey: '',
  groqApiKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  groqSttModel: 'whisper-large-v3',
  selectedModel: 'gemini-3.6-flash',
  customModelName: '',
  proxyUrl: '',
  proxyKey: '',
  proxyTargetModel: '',
  proxyModelsList: [],
  googleAccountConnected: false,
  googleAccountEmail: '',
  googleAccountName: '',
  geminiWebCookie: '',
  geminiWebSessionToken: '',
  geminiWebAccountStatus: 'disconnected',
  geminiWebHeadlessMode: true,
  geminiWebKeepAlive: true,
  ocrInterval: 0.7,
  confidenceThreshold: 0.7,
  sourceLang: 'zh_cn',
  targetLang: 'Tiếng Việt',
  autoFilterDuplicates: true,
  autoIdealPreset: true,
  genDownloadApiKey: '',
  videoDownloaderApiUrl: 'https://gendownload.com/api',
  backendServerUrl: 'https://thiantai.onrender.com',
  ttsProvider: 'capcut_tts',
  capcutVoice: 'BV074_streaming',
  nghiVoice: 'lacphi',
  edgeVoice: 'vi-VN-HoaiMyNeural',
  tiktokSessionId: '',
  tiktokVoice: 'BV074_streaming',
  tiktokProxyUrl: '',
  ttsSpeed: 1.0,
  ttsPitch: 0,
  bgFilterStrength: 40,
  bgFilterMode: 'none',
  adaptiveSampling: true,
  autoAiRefine: true,
  enableAudioSync: true,
  proxyNoApiKey: false,
  paddleOcrLang: 'ch',
  detDbBoxThresh: 0.55,
  detDbThresh: 0.30,
  detLimitSideLen: 1216,
  maxTextLength: 25,
  dropScore: 0.78,
  cls: false,
  framesToSkip: 4,
  similarPixelThreshold: 0.82,
  roiCropBottomPercent: 15,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate legacy providers to official 'capcut_tts'
      const ttsProvider = (parsed.ttsProvider === 'nghi_tts' || parsed.ttsProvider === 'vieneu_tts' || parsed.ttsProvider === 'kokoro_tts')
        ? 'capcut_tts'
        : (parsed.ttsProvider || 'capcut_tts');
      return { 
        ...DEFAULT_APP_SETTINGS, 
        ...parsed, 
        ttsProvider, 
        capcutVoice: parsed.capcutVoice || 'BV074_streaming',
        ocrEngine: parsed.ocrEngine || 'paddleocr',
        paddleOcrModelVariant: parsed.paddleOcrModelVariant === 'tiny' ? 'tiny' : 'small',
      };
    }
  } catch (err) {
    console.warn('Failed to parse app settings from localStorage', err);
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    const updated = { ...settings, _hasExplicitOcrSelection: true };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    // Persist asynchronously to IndexedDB
    saveSettingsToDB(updated);
  } catch (err) {
    console.error('Failed to save app settings to localStorage', err);
  }
}

