import React, { useState, useEffect } from 'react';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Zap,
  Key,
  Server,
  Globe,
  Database,
  DownloadCloud,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Terminal,
  Code2,
  Copy,
  Check,
  Info,
  Play,
  Bug,
  Sparkles,
} from 'lucide-react';
import { AppSettings, ApiConnectionMode } from '../types';
import { VIENEU_VOICES, getLocalCustomVoices, saveLocalCustomVoice, deleteLocalCustomVoice, VieNeuVoice } from '../data/vieneuVoices';
import { VieNeuModelDownloadModal } from './VieNeuModelDownloadModal';
import { VieNeuVoiceCloneModal } from './VieNeuVoiceCloneModal';
import { Capacitor } from '@capacitor/core';
import { VieNeuNative } from '../plugins/vieneuPlugin';

interface AdvancedConfigDrawerProps {
  formData: AppSettings;
  handleChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  paddleStatus?: {
    isReady: boolean;
    detSizeMB?: string;
    recSizeMB?: string;
    isDownloaded?: boolean;
    isIndexedDBReady?: boolean;
  } | null;
  isDownloadingPaddle?: boolean;
  paddleProgress?: { percent: number; msg: string };
  handleDownloadPaddleModels?: (variantOverride?: 'small' | 'tiny') => void;
  handleClearPaddleCache?: () => void;
  paddleDownloadMsg?: { text: string; isError: boolean } | null;
  currentApiMode: ApiConnectionMode;
  googleLogs: string[];
  setGoogleLogs: React.Dispatch<React.SetStateAction<string[]>>;
  handleApplyIdealPresets: () => void;
  isCheckingGoogleToken?: boolean;
  handleCheckGoogleToken?: (cookie?: string) => Promise<void>;
  handleGoogleLogout?: () => void;
  googleAuthMessage?: { text: string; isError: boolean } | null;
  handleTestGeminiWeb?: () => void;
  isTestingPrompt?: boolean;
  testPromptResult?: string | null;
  showTikTokGuide?: boolean;
  setShowTikTokGuide?: (show: boolean) => void;
  isElectronApp?: boolean;
  devToolsStatus?: string | null;
  handleToggleDevTools?: () => void;
  handleCopyDiagnostic?: () => void;
  diagCopied?: boolean;
}

export const AdvancedConfigDrawer: React.FC<AdvancedConfigDrawerProps> = ({
  formData,
  handleChange,
  paddleStatus,
  isDownloadingPaddle,
  paddleProgress,
  handleDownloadPaddleModels,
  handleClearPaddleCache,
  paddleDownloadMsg,
  currentApiMode,
  googleLogs,
  setGoogleLogs,
  handleApplyIdealPresets,
  isCheckingGoogleToken,
  handleCheckGoogleToken,
  handleGoogleLogout,
  googleAuthMessage,
  handleTestGeminiWeb,
  isTestingPrompt,
  testPromptResult,
  showTikTokGuide,
  setShowTikTokGuide,
  isElectronApp,
  devToolsStatus,
  handleToggleDevTools,
  handleCopyDiagnostic,
  diagCopied,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'ocr' | 'tts' | 'proxy' | 'debug'>('ocr');
  const [isTestingBackend, setIsTestingBackend] = useState(false);
  const [backendTestStatus, setBackendTestStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [isVieNeuModalOpen, setIsVieNeuModalOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [customVieNeuVoices, setCustomVieNeuVoices] = useState<VieNeuVoice[]>(() => getLocalCustomVoices());

  useEffect(() => {
    fetch(resolveApiUrl('/api/vieneu/custom-voices'))
      .then((r) => r.json())
      .then((d) => {
        if (d && d.success && Array.isArray(d.voices)) {
          d.voices.forEach((v: any) => {
            saveLocalCustomVoice(v);
          });
          setCustomVieNeuVoices(getLocalCustomVoices());
        }
      })
      .catch(() => {});
  }, []);

  const handleTestBackendServer = async () => {
    const url = (formData.backendServerUrl || '').trim().replace(/\/+$/, '');
    if (!url) {
      setBackendTestStatus({ success: false, msg: 'Vui lòng nhập URL máy chủ backend trước khi kiểm tra.' });
      return;
    }
    setIsTestingBackend(true);
    setBackendTestStatus(null);
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        setBackendTestStatus({ success: true, msg: '✓ Kết nối thành công! Server online và sẵn sàng tải video yt-dlp.' });
      } else {
        setBackendTestStatus({ success: false, msg: `Máy chủ phản hồi mã HTTP ${res.status}. Vui lòng kiểm tra lại.` });
      }
    } catch (err: any) {
      setBackendTestStatus({ success: false, msg: `Không thể kết nối tới máy chủ: ${err?.message || 'Timeout hoặc máy chủ chưa mở'}` });
    } finally {
      setIsTestingBackend(false);
    }
  };

  return (
    <div className="bg-[#141418] border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl transition-all">
      {/* Accordion Trigger Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-slate-800/30 transition cursor-pointer"
      >
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-sky-400 shadow-inner">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <span>Cài Đặt Nâng Cao &amp; Gỡ Lỗi</span>
              <span className="text-[10px] bg-slate-800 text-slate-400 font-normal px-2 py-0.5 rounded-full border border-slate-700">
                {isOpen ? 'Đang mở' : 'Thu gọn'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tần suất quét OCR, ngôn ngữ, thuyết minh TTS, Proxy gateway &amp; F12 Console
            </p>
          </div>
        </div>

        <div className="p-2 text-slate-400 hover:text-white transition">
          {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Accordion Content */}
      {isOpen && (
        <div className="p-4 sm:p-5 pt-0 space-y-4 border-t border-slate-800/80 mt-1 animate-fade-in">
          {/* Sub Navigation Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-[#0c0c10] rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('ocr')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                activeTab === 'ocr'
                  ? 'bg-[#1e88e5] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Quét Chữ (OCR)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tts')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                activeTab === 'tts'
                  ? 'bg-[#1e88e5] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Giọng Đọc TTS</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('proxy')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                activeTab === 'proxy'
                  ? 'bg-[#1e88e5] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Proxy &amp; API</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('debug')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                activeTab === 'debug'
                  ? 'bg-[#1e88e5] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Gỡ Lỗi (F12)</span>
            </button>
          </div>

          {/* TAB 1: OCR & SCAN FREQUENCY */}
          {activeTab === 'ocr' && (
            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Cấu hình Quét Chữ &amp; Tần Suất
                </span>
                <button
                  type="button"
                  onClick={handleApplyIdealPresets}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold rounded-xl border border-slate-700 flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Áp dụng tối ưu</span>
                </button>
              </div>

              {/* Engine Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <label
                  className={`p-3 rounded-2xl border cursor-pointer transition flex items-start space-x-2.5 ${
                    formData.ocrEngine === 'gemini_vision'
                      ? 'bg-sky-950/20 border-sky-500/50 text-white'
                      : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="advancedOcrEngine"
                    value="gemini_vision"
                    checked={formData.ocrEngine === 'gemini_vision'}
                    onChange={() => handleChange('ocrEngine', 'gemini_vision')}
                    className="mt-0.5 accent-sky-500"
                  />
                  <div>
                    <span className="font-bold text-slate-200 block">Google Gemini Vision AI</span>
                    <span className="text-[10.5px] text-slate-400">Nhận diện chính xác 99% trực tiếp từ khung hình video</span>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-2xl border cursor-pointer transition flex items-start space-x-2.5 ${
                    formData.ocrEngine === 'paddleocr'
                      ? 'bg-sky-950/20 border-sky-500/50 text-white'
                      : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="advancedOcrEngine"
                    value="paddleocr"
                    checked={formData.ocrEngine === 'paddleocr'}
                    onChange={() => handleChange('ocrEngine', 'paddleocr')}
                    className="mt-0.5 accent-sky-500"
                  />
                  <div>
                    <span className="font-bold text-slate-200 block">PaddleOCR Wasm (Offline)</span>
                    <span className="text-[10.5px] text-slate-400">Quét cục bộ không tốn API, chạy bằng Wasm WebGL</span>
                  </div>
                </label>
              </div>

              {/* Sliders: Interval & Confidence */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-200">
                    <span>Tần suất quét OCR:</span>
                    <span className="font-mono text-sky-400 font-bold">{formData.ocrInterval}s / khung</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="3.0"
                    step="0.1"
                    value={formData.ocrInterval}
                    onChange={(e) => handleChange('ocrInterval', parseFloat(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>

                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-200">
                    <span>Độ tin cậy tối thiểu:</span>
                    <span className="font-mono text-sky-400 font-bold">{Math.round(formData.confidenceThreshold * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.4"
                    max="0.95"
                    step="0.05"
                    value={formData.confidenceThreshold}
                    onChange={(e) => handleChange('confidenceThreshold', parseFloat(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Languages */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300 block">Nguồn quét OCR:</label>
                  <select
                    value={formData.sourceLang}
                    onChange={(e) => handleChange('sourceLang', e.target.value)}
                    className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                  >
                    <option value="zh">Tiếng Trung (Giản thể / Phồn thể)</option>
                    <option value="en">Tiếng Anh (English)</option>
                    <option value="ja">Tiếng Nhật (日本語)</option>
                    <option value="ko">Tiếng Hàn (한국어)</option>
                    <option value="vi">Tiếng Việt (Vietnamese)</option>
                  </select>
                </div>

                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300 block">Dịch phụ đề sang:</label>
                  <select
                    value={formData.targetLang}
                    onChange={(e) => handleChange('targetLang', e.target.value)}
                    className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                  >
                    <option value="vi">Tiếng Việt (Vietnamese)</option>
                    <option value="en">Tiếng Anh (English)</option>
                  </select>
                </div>
              </div>

              {/* PaddleOCR Model Download Status & Size Toggle */}
              {formData.ocrEngine === 'paddleocr' && (
                <div className="bg-[#0e0e14] border border-slate-800 rounded-2xl p-3 space-y-3 text-xs">
                  {/* Model Variant Selection: Small vs Tiny */}
                  <div className="space-y-1.5 border-b border-slate-800/80 pb-2.5">
                    <label className="text-[11px] font-bold text-slate-300 block">Kích thước Model PaddleOCR (Model Size):</label>
                    <div className="grid grid-cols-2 gap-2">
                      <label
                        className={`p-2 rounded-xl border cursor-pointer transition flex items-center space-x-2 ${
                          (formData.paddleOcrModelVariant || 'small') === 'small'
                            ? 'bg-sky-950/40 border-sky-500/60 text-white font-semibold'
                            : 'bg-[#14141e] border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paddleOcrVariant"
                          value="small"
                          checked={(formData.paddleOcrModelVariant || 'small') === 'small'}
                          onChange={() => handleChange('paddleOcrModelVariant', 'small')}
                          className="accent-sky-500"
                        />
                        <div>
                          <span className="text-[11.5px] text-slate-200 block font-bold">PP-OCRv6 Small</span>
                          <span className="text-[9.5px] text-slate-400">Độ chính xác cao (Khuyên dùng)</span>
                        </div>
                      </label>

                      <label
                        className={`p-2 rounded-xl border cursor-pointer transition flex items-center space-x-2 ${
                          formData.paddleOcrModelVariant === 'tiny'
                            ? 'bg-sky-950/40 border-sky-500/60 text-white font-semibold'
                            : 'bg-[#14141e] border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paddleOcrVariant"
                          value="tiny"
                          checked={formData.paddleOcrModelVariant === 'tiny'}
                          onChange={() => handleChange('paddleOcrModelVariant', 'tiny')}
                          className="accent-sky-500"
                        />
                        <div>
                          <span className="text-[11.5px] text-slate-200 block font-bold">PP-OCRv6 Tiny</span>
                          <span className="text-[9.5px] text-slate-400">Siêu nhẹ & Nhanh (Tiết kiệm RAM)</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Database className="w-4 h-4 text-sky-400" />
                      <span className="font-bold text-slate-200">
                        Cache ({formData.paddleOcrModelVariant === 'tiny' ? 'Tiny' : 'Small'}):
                      </span>
                      {paddleStatus?.isReady ? (
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Đã tải model
                        </span>
                      ) : (
                        <span className="text-rose-400 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Chưa tải
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      {handleDownloadPaddleModels && (
                        <button
                          type="button"
                          onClick={() => handleDownloadPaddleModels(formData.paddleOcrModelVariant || 'small')}
                          disabled={isDownloadingPaddle}
                          className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-[11px] transition flex items-center gap-1 disabled:opacity-50"
                        >
                          <DownloadCloud className="w-3 h-3" />
                          <span>{paddleStatus?.isReady ? 'Tải lại' : 'Tải model'}</span>
                        </button>
                      )}
                      {paddleStatus?.isReady && handleClearPaddleCache && (
                        <button
                          type="button"
                          onClick={handleClearPaddleCache}
                          className="p-1 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 rounded-lg transition"
                          title="Xóa bộ nhớ đệm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isDownloadingPaddle && paddleProgress && (
                    <div className="space-y-1 bg-slate-950 p-2 rounded-lg border border-sky-500/30">
                      <div className="flex items-center justify-between text-[10.5px]">
                        <span className="text-sky-300 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {paddleProgress.msg}
                        </span>
                        <span className="font-mono font-bold text-sky-400">{paddleProgress.percent}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-sky-400 h-full rounded-full transition-all"
                          style={{ width: `${paddleProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TTS VOICE SETTINGS */}
          {activeTab === 'tts' && (
            <div className="space-y-3 pt-1 text-xs">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-200 block">Động cơ Thuyết Minh TTS:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center space-x-2 ${
                      formData.ttsProvider === 'vieneu_tts'
                        ? 'bg-amber-950/20 border-amber-500/50 text-white'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advancedTtsEngine"
                      value="vieneu_tts"
                      checked={formData.ttsProvider === 'vieneu_tts'}
                      onChange={() => handleChange('ttsProvider', 'vieneu_tts')}
                      className="accent-amber-500"
                    />
                    <span className="font-semibold text-amber-300">🎙️ VieNeu-TTS (Offline)</span>
                  </label>

                  <label
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center space-x-2 ${
                      (formData.ttsProvider || 'capcut_tts') === 'capcut_tts'
                        ? 'bg-sky-950/20 border-sky-500/50 text-white'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advancedTtsEngine"
                      value="capcut_tts"
                      checked={(formData.ttsProvider || 'capcut_tts') === 'capcut_tts'}
                      onChange={() => handleChange('ttsProvider', 'capcut_tts')}
                      className="accent-sky-500"
                    />
                    <span className="font-semibold">✨ CapCut TTS</span>
                  </label>

                  <label
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center space-x-2 ${
                      formData.ttsProvider === 'nghi_tts'
                        ? 'bg-sky-950/20 border-sky-500/50 text-white'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advancedTtsEngine"
                      value="nghi_tts"
                      checked={formData.ttsProvider === 'nghi_tts'}
                      onChange={() => handleChange('ttsProvider', 'nghi_tts')}
                      className="accent-sky-500"
                    />
                    <span className="font-semibold">Piper TTS (Sherpa)</span>
                  </label>

                  <label
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center space-x-2 ${
                      formData.ttsProvider === 'edge_tts'
                        ? 'bg-sky-950/20 border-sky-500/50 text-white'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advancedTtsEngine"
                      value="edge_tts"
                      checked={formData.ttsProvider === 'edge_tts'}
                      onChange={() => handleChange('ttsProvider', 'edge_tts')}
                      className="accent-sky-500"
                    />
                    <span className="font-semibold">Microsoft Edge TTS</span>
                  </label>

                  <label
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center space-x-2 ${
                      formData.ttsProvider === 'tiktok_tts'
                        ? 'bg-sky-950/20 border-sky-500/50 text-white'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="advancedTtsEngine"
                      value="tiktok_tts"
                      checked={formData.ttsProvider === 'tiktok_tts'}
                      onChange={() => handleChange('ttsProvider', 'tiktok_tts')}
                      className="accent-sky-500"
                    />
                    <span className="font-semibold">TikTok Voice TTS</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-300 block">Giọng đọc:</label>
                    {formData.ttsProvider === 'vieneu_tts' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsCloneModalOpen(true)}
                          className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 cursor-pointer hover:underline"
                          title="Tạo giọng đọc mới từ bản thu âm hoặc file audio mẫu"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
                          <span>+ Nhân bản giọng</span>
                        </button>
                        <span className="text-[10px] text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setIsVieNeuModalOpen(true)}
                          className="text-[10px] text-slate-400 hover:text-slate-300 underline font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <DownloadCloud className="w-3 h-3" />
                          <span>Tải mô hình</span>
                        </button>
                      </div>
                    )}
                  </div>
                  {formData.ttsProvider === 'vieneu_tts' ? (
                    <div className="space-y-2">
                      <select
                        value={formData.vieneuVoice || 'Minh Đức'}
                        onChange={(e) => handleChange('vieneuVoice', e.target.value)}
                        className="w-full bg-[#16161e] border border-amber-500/40 rounded-xl p-2 text-xs text-amber-200 focus:outline-none focus:border-amber-400"
                      >
                        {customVieNeuVoices.length > 0 && (
                          <optgroup label="✨ Giọng nhân bản của bạn (Voice Clone)">
                            {customVieNeuVoices.map((v) => (
                              <option key={v.id} value={v.id}>
                                ⭐ [Clone] {v.name} - {v.style}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="🌟 Miền Bắc (Tin tức & Đời thường)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'bac').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} - {v.style}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="✨ Miền Nam (Phóng khoáng & Duyên dáng)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'nam').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} - {v.style}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="🌿 Miền Trung (Huế & Hào sảng)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'trung').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} - {v.style}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsCloneModalOpen(true)}
                          className="flex-1 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <span>+ Nhân bản giọng mới</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsVieNeuModalOpen(true)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
                          title="Tải gói mô hình VieNeu-TTS offline (~147 MB)"
                        >
                          <DownloadCloud className="w-3.5 h-3.5" />
                          <span>Gói mô hình</span>
                        </button>
                      </div>
                    </div>
                  ) : (formData.ttsProvider || 'capcut_tts') === 'capcut_tts' ? (
                    <select
                      value={formData.capcutVoice || 'BV074_streaming'}
                      onChange={(e) => handleChange('capcutVoice', e.target.value)}
                      className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <optgroup label="🎙️ Giọng Nam (Nam Tính, Tự Nhiên)">
                        <option value="multi_male_felipe_uranus_bigtts">🎙️ [Nam] Giọng Nam Trầm (Ấm áp, nam tính)</option>
                        <option value="BV075_streaming">⚡ [Nam] Thanh Niên Tự Tin (Trẻ trung, dứt khoát)</option>
                      </optgroup>
                      <optgroup label="🌟 Giọng Nữ Đời Thường & Thịnh Hành">
                        <option value="BV074_streaming">🌟 [Nữ] Cô Gái Hoạt Ngôn (Top 1 TikTok)</option>
                        <option value="vi_female_huong">👩 [Nữ] Giọng Nữ Phổ Thông (Tự nhiên, nhẹ nhàng)</option>
                        <option value="BV421_vivn_streaming">💖 [Nữ] Nhỏ Ngọt Ngào (Dễ thương)</option>
                        <option value="multi_female_yangguangnv_uranus_bigtts">☀️ [Nữ] Ban Mai (Trong trẻo)</option>
                        <option value="BV562_streaming">🌸 [Nữ] Mai (Thanh thoát, dịu dàng)</option>
                        <option value="multi_female_peiqi_uranus_bigtts">🎀 [Nữ] Giọng Gái Mới Lớn (Trẻ trung)</option>
                        <option value="multi_female_kiwi_uranus_bigtts">✨ [Nữ] Sunny Idol (Năng động)</option>
                      </optgroup>
                      <optgroup label="🎬 Thuyết Minh & Review Phim, Tin Tức">
                        <option value="multi_female_richgirl_uranus_bigtts">🍿 [Nữ] Review Phim new</option>
                        <option value="multi_female_xyf04auto_uranus_bigtts">📽️ [Nữ] Review Phim 2</option>
                        <option value="multi_female_daqi_uranus_bigtts">🎬 [Nữ] Review Phim 3</option>
                        <option value="multi_female_stokie_uranus_bigtts">🎞️ [Nữ] Review Phim 4</option>
                        <option value="multi_female_tianmeijieshuo_uranus_bigtts">🎬 [Nữ] Thuyết Minh Ngọt Ngào</option>
                        <option value="multi_female_xinwenjieshuo_uranus_bigtts">📢 [Nữ] Bản Tin Thời Sự</option>
                        <option value="multi_female_quanweinv_uranus_bigtts">📰 [Nữ] Bản Tin Phóng Viên</option>
                        <option value="multi_female_sisi_uranus_bigtts">🎙️ [Nữ] Bản Tin Phát Thanh</option>
                      </optgroup>
                      <optgroup label="🎭 Biến Âm & Hiệu Ứng Hài Hước">
                        <option value="BV074_streaming_dsp">👶 [Hiệu ứng] Giọng Bé (Dễ thương)</option>
                        <option value="BV560_streaming">👑 [Hiệu ứng] Alex Đại Đế</option>
                        <option value="BV075_streaming_demon_dsp">👿 [Hiệu ứng] Kenny Đại Đế</option>
                        <option value="BV075_streaming_robot_dsp">🤖 [Hiệu ứng] Robot VN</option>
                        <option value="BV075_streaming_vibrato_dsp">🌊 [Hiệu ứng] Việt Méo</option>
                      </optgroup>
                    </select>
                  ) : formData.ttsProvider === 'nghi_tts' ? (
                    <select
                      value={formData.nghiVoice || 'ngochuyennew'}
                      onChange={(e) => handleChange('nghiVoice', e.target.value)}
                      className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <optgroup label="🌟 Giọng Nữ (Thuyết Minh / Kể Chuyện)">
                        <option value="ngochuyennew">Ngọc Huyền (Mới - Review Phim)</option>
                        <option value="ngochuyen">Ngọc Huyền (Bản gốc)</option>
                        <option value="maiphuong">Mai Phương (Nhẹ nhàng)</option>
                        <option value="banmai">Ban Mai (Trong trẻo)</option>
                        <option value="minhthu">Minh Thu (Truyền cảm)</option>
                        <option value="mytam2">Mỹ Tâm 2 (Ấm áp)</option>
                        <option value="mytam2794">Mỹ Tâm (v2794)</option>
                        <option value="phuongtrang">Phương Trang (Dịu dàng)</option>
                        <option value="thanhphuong2">Thanh Phương (Viettel)</option>
                        <option value="calmwoman3688">Calm Woman (Điềm tĩnh)</option>
                        <option value="yannew">Yan New (Trẻ trung)</option>
                      </optgroup>
                      <optgroup label="🎙️ Giọng Nam (Truyền Cảm / Trầm Ấm)">
                        <option value="lacphi">Lạc Phi (Nam chuẩn)</option>
                        <option value="duyoryx">Duy Oryx (Nam trầm ấm)</option>
                        <option value="ngocngan">Nguyễn Ngọc Ngạn (Kể chuyện / Thuyết minh)</option>
                        <option value="vietthao3886">Việt Thảo (Kể chuyện / Review)</option>
                        <option value="tranthanh3870">Trấn Thành (Hài hước / Sôi nổi)</option>
                        <option value="minhquang">Minh Quang (Nam thời sự)</option>
                        <option value="minhkhang">Minh Khang (Nam truyền cảm)</option>
                        <option value="manhdung">Mạnh Dũng (Nam mạnh mẽ)</option>
                        <option value="chieuthanh">Chiếu Thành (Nam đĩnh đạc)</option>
                        <option value="thientam">Thiện Tâm (Nam nhẹ nhàng)</option>
                        <option value="taian2">Tài An 2 (CD Media)</option>
                        <option value="taian4">Tài An 4 (CD Media)</option>
                        <option value="deepman3909">Deep Man (Nam trầm sâu)</option>
                        <option value="adam1">Adam 1 (Nam phát thanh)</option>
                      </optgroup>
                    </select>
                  ) : formData.ttsProvider === 'tiktok_tts' ? (
                    <select
                      value={formData.tiktokVoice || 'BV074_streaming'}
                      onChange={(e) => handleChange('tiktokVoice', e.target.value)}
                      className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="BV074_streaming">TikTok Nữ (Mặc định)</option>
                      <option value="BV075_streaming">TikTok Nam (Mặc định)</option>
                    </select>
                  ) : (
                    <select
                      value={formData.edgeVoice || 'vi-VN-HoaiMyNeural'}
                      onChange={(e) => handleChange('edgeVoice', e.target.value)}
                      className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-sky-400"
                    >
                      <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ miền Nam, êm dịu)</option>
                      <option value="vi-VN-NamMinhNeural">Nam Minh (Nam miền Bắc, truyền cảm)</option>
                    </select>
                  )}
                </div>

                <div className="bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-200">
                    <span>Tốc độ đọc:</span>
                    <span className="font-mono text-sky-400 font-bold">{formData.ttsSpeed || 1.0}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={formData.ttsSpeed || 1.0}
                    onChange={(e) => handleChange('ttsSpeed', parseFloat(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROXY & API CONNECTION */}
          {activeTab === 'proxy' && (
            <div className="space-y-3 pt-1 text-xs">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-200 block">
                  Phương thức kết nối API nâng cao:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleChange('apiMode', 'direct')}
                    className={`p-3 rounded-2xl border text-center transition cursor-pointer ${
                      currentApiMode === 'direct'
                        ? 'bg-sky-950/20 border-sky-500 text-white font-bold'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <Key className="w-4 h-4 mx-auto mb-1 text-sky-400" />
                    Direct API Key
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChange('apiMode', 'proxy')}
                    className={`p-3 rounded-2xl border text-center transition cursor-pointer ${
                      currentApiMode === 'proxy'
                        ? 'bg-sky-950/20 border-sky-500 text-white font-bold'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <Server className="w-4 h-4 mx-auto mb-1 text-sky-400" />
                    Proxy Gateway
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChange('apiMode', 'gemini_web')}
                    className={`p-3 rounded-2xl border text-center transition cursor-pointer ${
                      currentApiMode === 'gemini_web'
                        ? 'bg-sky-950/20 border-sky-500 text-white font-bold'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <Globe className="w-4 h-4 mx-auto mb-1 text-sky-400" />
                    Web RPC
                  </button>

                  <button
                    type="button"
                    onClick={() => handleChange('apiMode', 'groq')}
                    className={`p-3 rounded-2xl border text-center transition cursor-pointer ${
                      currentApiMode === 'groq'
                        ? 'bg-orange-950/20 border-orange-500 text-white font-bold'
                        : 'bg-[#0d0d11] border-slate-800 text-slate-400'
                    }`}
                  >
                    <Zap className="w-4 h-4 mx-auto mb-1 text-orange-400" />
                    Groq AI
                  </button>
                </div>
              </div>

              {currentApiMode === 'groq' && (
                <div className="space-y-2 bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl">
                  <label className="text-[11px] font-semibold text-slate-300 block">Groq API Key (gsk_...):</label>
                  <input
                    type="password"
                    value={formData.groqApiKey || ''}
                    onChange={(e) => handleChange('groqApiKey', e.target.value)}
                    placeholder="gsk_xxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-orange-400"
                  />
                  <p className="text-[10px] text-slate-400">
                    Sử dụng Whisper STT siêu tốc và mô hình Llama 3.3 70B của Groq Cloud.
                  </p>
                </div>
              )}

              {currentApiMode === 'proxy' && (
                <div className="space-y-2 bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl">
                  <label className="text-[11px] font-semibold text-slate-300 block">Địa chỉ Reverse Proxy URL:</label>
                  <input
                    type="text"
                    value={formData.proxyUrl || ''}
                    onChange={(e) => handleChange('proxyUrl', e.target.value)}
                    placeholder="https://your-proxy-domain.com/v1"
                    className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-sky-400"
                  />
                  <p className="text-[10px] text-slate-400">
                    Dùng khi API Google bị chặn hoặc muốn phân luồng qua gateway riêng.
                  </p>
                </div>
              )}

              {currentApiMode === 'gemini_web' && (
                <div className="space-y-2 bg-[#0d0d11] border border-slate-800 p-3 rounded-2xl">
                  <label className="text-[11px] font-semibold text-slate-300 block">Google Web Cookie Session:</label>
                  <textarea
                    rows={3}
                    value={formData.geminiWebCookie || ''}
                    onChange={(e) => handleChange('geminiWebCookie', e.target.value)}
                    placeholder="Dán chuỗi Cookie từ https://gemini.google.com..."
                    className="w-full bg-[#16161e] border border-slate-700 rounded-xl p-2 text-[11px] text-white font-mono focus:outline-none focus:border-sky-400"
                  />
                  {handleCheckGoogleToken && (
                    <button
                      type="button"
                      onClick={() => handleCheckGoogleToken(formData.geminiWebCookie)}
                      disabled={isCheckingGoogleToken || !formData.geminiWebCookie?.trim()}
                      className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs transition disabled:opacity-50"
                    >
                      {isCheckingGoogleToken ? 'Đang kiểm tra...' : 'Xác thực Cookie'}
                    </button>
                  )}
                </div>
              )}

              {/* CARD: MÁY CHỦ BACKEND CHO CAPACITOR APK */}
              <div className="space-y-2.5 bg-[#0d0d11] border border-slate-800 p-4 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <DownloadCloud className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Máy Chủ Tải Video yt-dlp (Cloud Backend Server)
                    </span>
                  </div>
                  <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full font-mono">
                    Capacitor APK &amp; Mobile
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Khi cài app độc lập lên điện thoại Android (Capacitor APK), điện thoại không có sẵn Python/yt-dlp. Bạn hãy dán link server Cloud miễn phí (Render, Koyeb, Railway...) vào đây để app điện thoại tải video đa nền tảng bình thường:
                </p>

                <div className="flex gap-2">
                  <input
                    type="url"
                    value={formData.backendServerUrl || ''}
                    onChange={(e) => {
                      handleChange('backendServerUrl', e.target.value);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('vtranslate_backend_server_url', e.target.value.trim());
                      }
                    }}
                    placeholder="https://ten-app-cua-ban.onrender.com"
                    className="flex-1 bg-[#16161e] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={handleTestBackendServer}
                    disabled={isTestingBackend || !formData.backendServerUrl?.trim()}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer shadow-md"
                  >
                    {isTestingBackend ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Kiểm tra...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Kiểm Tra</span>
                      </>
                    )}
                  </button>
                </div>

                {backendTestStatus && (
                  <div
                    className={`p-2.5 rounded-xl text-[11px] flex items-center gap-2 ${
                      backendTestStatus.success
                        ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/60 border border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {backendTestStatus.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <span>{backendTestStatus.msg}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DEBUG & F12 CONSOLE */}
          {activeTab === 'debug' && (
            <div className="space-y-3 pt-1 text-xs">
              <div className="flex items-start space-x-3 bg-[#0d0d11] border border-slate-800 p-3.5 rounded-2xl">
                <Terminal className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-bold text-slate-200 block">F12 Console &amp; Báo Cáo Kỹ Thuật</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Xem log hệ thống, mã lỗi HTTP, hoặc sao chép thông số cấu hình để gửi hỗ trợ kỹ thuật viên.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {handleToggleDevTools && (
                  <button
                    type="button"
                    onClick={handleToggleDevTools}
                    className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-md"
                  >
                    <Code2 className="w-4 h-4" />
                    <span>BẬT / TẮT F12 CONSOLE</span>
                  </button>
                )}

                {handleCopyDiagnostic && (
                  <button
                    type="button"
                    onClick={handleCopyDiagnostic}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl transition flex items-center justify-center space-x-1.5 border border-slate-700 cursor-pointer"
                  >
                    {diagCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                    <span>{diagCopied ? 'Đã chép báo cáo!' : 'Sao chép thông số gửi Dev'}</span>
                  </button>
                )}
              </div>

              {devToolsStatus && (
                <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-2 text-sky-300 text-[11px] flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  <span>{devToolsStatus}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <VieNeuModelDownloadModal
        isOpen={isVieNeuModalOpen}
        onClose={() => setIsVieNeuModalOpen(false)}
      />

      <VieNeuVoiceCloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        customVoices={customVieNeuVoices}
        onVoiceCreated={(newVoice) => {
          saveLocalCustomVoice(newVoice);
          setCustomVieNeuVoices(getLocalCustomVoices());
          handleChange('vieneuVoice', newVoice.name);
        }}
        onDeleteCustomVoice={async (id) => {
          if (window.confirm('Bạn có chắc muốn xóa giọng nhân bản này không?')) {
            deleteLocalCustomVoice(id);
            setCustomVieNeuVoices(getLocalCustomVoices());
            try {
              await fetch(resolveApiUrl(`/api/vieneu/custom-voices/${encodeURIComponent(id)}`), { method: 'DELETE' });
            } catch {}
            if (Capacitor.isNativePlatform()) {
              try {
                await VieNeuNative.deleteCustomVoice({ name: id });
              } catch {}
            }
            if (formData.vieneuVoice === id) {
              handleChange('vieneuVoice', 'Minh Đức');
            }
          }
        }}
      />
    </div>
  );
};
