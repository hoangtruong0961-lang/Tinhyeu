export interface DownloadRequest {
  url: string;
}

export interface VideoMedia {
  quality: string;
  extension: string;
  url: string;
  directUrl?: string;
  size?: string;
  isAudioOnly?: boolean;
  formatId?: string;
}

export interface SubtitleTrack {
  lang: string;
  name: string;
  url: string;
  ext: string;
  type?: 'official' | 'auto' | 'danmaku'; // 'official' = Phụ đề chuẩn (Uploader), 'auto' = Tự động (AI CC), 'danmaku' = Đạn mạc
  isAuto?: boolean;
  isDanmaku?: boolean;
  author?: string;
  downloadUrl?: string;
}

export interface GenDownloadResponse {
  success: boolean;
  title?: string;
  thumbnail?: string;
  duration?: string;
  source?: string;
  author?: string;
  views?: string;
  medias?: VideoMedia[];
  subtitles?: SubtitleTrack[];
  error?: string;
}

export interface DouyinEpisodeItem {
  episodeNumber: number;
  title: string;
  vid?: string;
  duration?: number;
  durationFormatted?: string;
  cover?: string;
  videoUrl: string;
  directDownloadUrl?: string;
  streamType: 'mp4' | 'm3u8' | 'vod';
  isVip?: boolean;
}

export interface DouyinMicroAppInfo {
  appId?: string;
  appName?: string;
  seriesId?: string;
  seriesTitle: string;
  coverImage?: string;
  description?: string;
  totalEpisodes: number;
  author?: string;
  tags?: string[];
  episodes: DouyinEpisodeItem[];
  rawSourceUrl: string;
  resolvedSourceUrl?: string;
  isMicroAppProtected?: boolean;
  schemaLaunchUrl?: string;
  queryDetails?: {
    bookId?: string;
    chapterIndex?: number;
    appId?: string;
    appName?: string;
  };
}

export interface DouyinMicroAppParseResult {
  success: boolean;
  data?: DouyinMicroAppInfo;
  error?: string;
}

export interface GlossaryEntity {
  original: string;
  translated: string;
  type: 'character' | 'location' | 'term' | 'organization' | 'other';
  description?: string;
}

export interface GlobalMovieContext {
  movieGenre: string;
  eraAndSetting: string;
  characterPronounGuide: string;
  summary: string;
  knownEntityGlossary: GlossaryEntity[];
}

export interface WordTimestamp {
  word: string;
  start: number; // in seconds relative to subtitle start
  end: number;   // in seconds relative to subtitle start
}

export interface SubtitleItem {
  id: string;
  startTime: number; // in seconds, e.g. 1.25
  endTime: number;   // in seconds, e.g. 4.50
  originalText: string;
  translatedText: string;
  sourceLang?: string;
  confidence?: number;
  boundingBox?: RegionROI; // Normalized percentage coordinates (x, y, width, height) of detected subtitle box
  audioUrl?: string;       // Base64 or Blob URL of synthesized TTS audio
  duration?: number;       // Exact audio duration in seconds from sample count
  speed?: number;          // Custom speed multiplier for Smart Audio Fit
  pitch?: number;          // Custom pitch value
  timestamps?: WordTimestamp[]; // Word-level timestamps for exact audio sync
  audioVolume?: number;        // Individual audio volume (0.0 - 2.0, default 1.0)
  audioDeleted?: boolean;       // Marked as deleted from audio track
}

export interface RegionROI {
  x: number;      // percentage 0 - 100
  y: number;      // percentage 0 - 100
  width: number;  // percentage 0 - 100
  height: number; // percentage 0 - 100
}

export interface SubtitleStyleConfig {
  fontSize: number;          // in px (default 16)
  fontColor: string;         // hex or color name (default #ffffff)
  backgroundColor: string;   // hex or rgba color
  bgOpacity?: number;        // opacity percentage 0 - 100 (default 65)
  borderRadius?: number;     // border radius in px (default 8)
  fontWeight?: 'normal' | 'bold'; // font weight (default 'bold')
  fontStyle?: 'normal' | 'italic'; // font style (default 'normal')
  textTransform?: 'normal' | 'uppercase' | 'lowercase' | 'capitalize'; // text casing
  outlineColor?: string;     // hex color for text stroke/outline (default #000000)
  outlineWidth?: number;     // outline thickness in pixels (default 3)
  secondaryOutlineColor?: string; // hex color for outer sticker border
  secondaryOutlineWidth?: number; // thickness in pixels for outer sticker border
  hasSecondaryOutline?: boolean; // enable/disable double outline (viền kép)
  textShadowColor?: string;  // color for drop shadow / glow
  textShadowBlur?: number;   // blur radius in px
  textShadowOffsetX?: number; // shadow offset X in px
  textShadowOffsetY?: number; // shadow offset Y in px
  textEffect?: string;       // identifier for preset effect
  padding: number;           // in px (default 6)
  position: 'bottom' | 'top' | 'middle';
  bottomOffsetPercentage: number; // 0 - 30%
  maskOriginalSubtitles?: boolean;
  maskColor?: string;
  textOutline: boolean;      // default true
  fontFamily?: string;
  orientation?: 'horizontal' | 'vertical';
  textAlign?: 'left' | 'center' | 'right';
  maxCharsHorizontal?: number;
  maxCharsVertical?: number;
  hasBackground?: boolean;
  customUploadedFonts?: { family: string; dataUrl: string }[];
}

export type GeminiModelOption = 
  | 'GEMINI_WEB'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash-lite';

export interface AudioOutputHeader {
  sampleRate: number;    // e.g. 22050 or 44100 Hz
  channels: number;      // e.g. 1 (mono) or 2 (stereo)
  bitDepth: number;      // e.g. 16-bit PCM
  duration: number;      // duration in seconds
}

export interface SherpaAudioResult {
  samples: Float32Array; // PCM float samples normalized -1.0 to 1.0
  sampleRate: number;    // Sampling rate in Hz
  channels: number;      // Number of audio channels
  duration: number;      // Audio duration in seconds
}

export interface ONNXSessionOptions {
  executionProviders: ('webgpu' | 'webgl' | 'wasm' | 'cpu')[];
  graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  freeSessionOnComplete?: boolean;
}

export interface TTSWorkerMessage {
  type: 'GENERATE' | 'PROCESS_AUDIO' | 'RELEASE_SESSION';
  id?: string;
  text?: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  targetDuration?: number;
  duration?: number;
  provider?: TTSProviderOption;
  audioData?: {
    base64?: string;
    buffer?: ArrayBuffer;
    sampleRate?: number;
  };
}

export interface TTSWorkerResponse {
  type: 'AUDIO_READY' | 'PROCESSED' | 'SESSION_RELEASED' | 'ERROR';
  id?: string;
  base64Audio?: string;
  audioHeader?: AudioOutputHeader;
  duration?: number;
  error?: string;
}

export type OCREngineOption = 'paddleocr' | 'gemini_vision';

export type PaddleOcrModelVariant = 'small' | 'tiny';

export type ApiConnectionMode = 'direct' | 'proxy' | 'gemini_web' | 'groq';

export type TTSProviderOption = 'vieneu_tts' | 'capcut_tts' | 'gemini' | 'nghi_tts' | 'edge_tts' | 'tiktok_tts' | 'browser';

export interface AppSettings {
  ocrEngine: OCREngineOption;          // 'paddleocr' | 'gemini_vision'
  paddleOcrModelVariant?: PaddleOcrModelVariant; // 'small' | 'tiny' (default 'small')
  apiMode?: ApiConnectionMode;         // 'direct' | 'proxy' | 'gemini_web' | 'groq' (default 'direct')
  apiKey: string;                      // Gemini or custom API Key
  groqApiKey?: string;                 // Groq API Key (gsk_...)
  groqModel?: string;                  // Groq translation LLM (default 'llama-3.3-70b-versatile')
  groqSttModel?: string;               // Groq Whisper model (default 'whisper-large-v3')
  selectedModel: GeminiModelOption;    // Default 'gemini-3.6-flash'
  customModelName?: string;            // Custom model name if entered
  proxyUrl: string;                    // Reverse proxy URL endpoint
  proxyKey: string;                    // Proxy authorization key
  proxyTargetModel?: string;           // Target model for proxy
  proxyModelsList?: string[];          // List of fetched proxy models
  googleAccountConnected?: boolean;    // Is Google Account session active for Gemini Web
  googleAccountEmail?: string;         // Google account email e.g. user@gmail.com
  googleAccountName?: string;          // Google account display name
  geminiWebCookie?: string;            // Google session cookies (__Secure-1PSID / SAPISID)
  geminiWebSessionToken?: string;      // Cached SNlM0e session token
  geminiWebAccountStatus?: 'disconnected' | 'token_ready' | 'error'; // Automated session status
  geminiWebHeadlessMode?: boolean;     // Run offscreen hidden WebView in background (default true)
  geminiWebKeepAlive?: boolean;        // Keep background session active (default true)
  ocrInterval: number;                 // Scan interval in seconds (default 0.5s)
  confidenceThreshold: number;         // Minimum score threshold 0.0 - 1.0 (default 0.7)
  sourceLang: string;                  // Source OCR language (default 'zh_cn')
  targetLang: string;                  // Target translation language (default 'Tiếng Việt')
  autoFilterDuplicates: boolean;       // Filter duplicate/repetitive subtitle lines
  autoIdealPreset: boolean;            // Auto set ideal OCR configs
  genDownloadApiKey?: string;         // GenDownload API Key (https://gendownload.com/)
  videoDownloaderApiUrl?: string;     // Custom Video Downloader API Endpoint
  backendServerUrl?: string;          // Remote Node.js / yt-dlp Backend URL (e.g. https://my-server.onrender.com for Capacitor APK)
  ttsProvider?: TTSProviderOption;     // 'vieneu_tts' | 'capcut_tts' | 'gemini' | 'nghi_tts' | 'edge_tts' | 'tiktok_tts' | 'browser'
  vieneuVoice?: string;                // VieNeu Voice preset name e.g. 'Minh Đức' or 'Mai Anh'
  capcutVoice?: string;                // CapCut Voice e.g. BV074_streaming (Cô Gái Hoạt Ngôn)
  nghiVoice?: string;                  // Nghi TTS Sherpa voice e.g. lacphi, duyoryx, ngochuyennew, ngocngan, maiphuong, minhquang
  edgeVoice?: string;                  // Edge TTS Voice e.g. vi-VN-HoaiMyNeural or vi-VN-NamMinhNeural
  tiktokSessionId?: string;            // TikTok sessionid cookie value
  tiktokVoice?: string;                // TikTok Voice e.g. vi_001 (Nữ Tiếng Việt)
  tiktokProxyUrl?: string;             // TikTok / Edge proxy URL (HTTP or SOCKS proxy)
  geminiVoice?: string;                // Gemini Voice e.g. Kore or Puck
  ttsSpeed?: number;                   // Speed multiplier 0.5 - 2.0 (default 1.0)
  ttsPitch?: number;                   // Pitch offset -5 to +5 (default 0)
  bgFilterStrength?: number;           // Background text filter strength 0 - 100% (default 40)
  bgFilterMode?: 'none' | 'contrast' | 'binarize' | 'adaptive'; // Background text filter mode (default 'contrast')
  adaptiveSampling?: boolean;          // Auto-increase frame density in fast dialogue zones (default true)
  autoAiRefine?: boolean;              // Auto AI post-filtering: fix typos, remove OCR trash, merge duplicates (default true)
  enableAudioSync?: boolean;           // Auto time-stretch TTS audio to match subtitle block duration (default true)
  proxyNoApiKey?: boolean;             // True if proxy does not require an API Key
  paddleOcrLang?: string;              // 'ch' | 'xianshi' | 'zh' (default 'ch')
  detDbBoxThresh?: number;             // DB box threshold 0.5 - 0.6 (default 0.55)
  detDbThresh?: number;                // DB threshold 0.3 (default 0.30)
  detLimitSideLen?: number;            // Limit side length 960 (tiny) or 1216/1600 (small) (default 1216)
  maxTextLength?: number;              // Max text length 25 (default 25)
  dropScore?: number;                  // Drop score 0.75 - 0.80 (default 0.78)
  cls?: boolean;                       // Direction classification (default false)
  framesToSkip?: number;               // Frames to skip 4-5 (default 4)
  similarPixelThreshold?: number;      // Similar pixel threshold 0.80 - 0.85 (default 0.82)
  roiCropBottomPercent?: number;       // ROI bottom crop percentage 10-15% (default 15)
}

export interface TargetLanguageOption {
  code: string;
  name: string;
  flag: string;
}

export interface OCRFrameRequest {
  image: string; // base64 string without header or data URL
  timestamp: number;
  region?: RegionROI;
  targetLang: string;
  model?: GeminiModelOption;
  customContext?: string;
}

export interface OCRScanProgress {
  status: 'idle' | 'scanning' | 'translating' | 'completed' | 'error';
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  totalTime: number;
  message: string;
  percentage: number;
  fps?: number;
  cpuUsage?: number;
  activeWorkers?: number;
  totalWorkers?: number;
}

export interface SampleVideo {
  id: string;
  title: string;
  description: string;
  url: string;
  language: string;
  defaultRoi: RegionROI;
}

export interface BlurOverlay {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blur: number;
  borderRadius: number;
}

export interface LogoOverlay {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  borderRadius?: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | '800' | '900';
  fontStyle?: 'normal' | 'italic';
  color: string;
  hasBackground?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderRadius?: number;
  opacity: number;
  textAlign?: 'left' | 'center' | 'right';
  orientation?: 'horizontal' | 'vertical';
  textOutline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  textShadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  startTime?: number; // Timeline start time in seconds
  endTime?: number;   // Timeline end time in seconds
  isTitle?: boolean;  // If true: persistent video title/header that is always visible and NOT on text timeline
  styleConfig?: SubtitleStyleConfig; // Dedicated independent style config for text / title overlays
}

export interface VideoClip {
  id: string;
  title: string;
  url: string;
  duration: number;
}

export type CapCutTab = 'extract' | 'stt' | 'translate' | 'style' | 'audio' | 'subtitles' | 'filters' | 'config' | 'find_replace' | 'overlays' | 'text' | 'bgm' | 'phu_de' | 'am_thanh';

export type ExportEngine = 'mediabunny' | 'ffmpeg_wasm' | 'ffmpeg_native' | 'ffmpeg_mobile' | 'mediarecorder';
export type ExportVideoFormat = 'mp4' | 'webm' | 'mov' | 'mkv';
export type ExportResolution = 'original' | '4k' | '2k' | '1080p' | '720p' | '480p';
export type ExportFrameRate = 'original' | 60 | 50 | 30 | 25 | 24;
export type ExportBitrate = 'recommended' | 16000000 | 12000000 | 8000000 | 4000000 | 2000000;

export interface ExportSettingsConfig {
  engine: ExportEngine;
  format: ExportVideoFormat;
  resolution: ExportResolution;
  frameRate: ExportFrameRate;
  bitrate: ExportBitrate;
  gpuAcceleration?: boolean;
}

export interface Project {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  subtitles: SubtitleItem[];
  roi: RegionROI;
  targetLang: string;
  styleConfig: SubtitleStyleConfig;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  videoVolume?: number;
  videoSpeed?: number;
  clips?: VideoClip[];
  customContext?: string;
  globalContext?: GlobalMovieContext;
}

