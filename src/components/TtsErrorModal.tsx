import React, { useState } from 'react';
import { AlertTriangle, Copy, Check, RefreshCw, Download, X, Terminal, ChevronDown, ChevronUp, Cpu, Globe } from 'lucide-react';

export interface TtsErrorInfo {
  provider: string;
  providerDisplayName: string;
  voiceName: string;
  textSnippet: string;
  errorCode: string;
  rootCause: string;
  userGuidance: string;
  technicalDetails?: string;
  httpStatus?: number;
  platform: 'web' | 'android';
  canDownloadVieNeuModel?: boolean;
}

interface TtsErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  errorInfo: TtsErrorInfo | null;
  onRetry?: () => void;
  onOpenVieNeuDownloadModal?: () => void;
}

export const TtsErrorModal: React.FC<TtsErrorModalProps> = ({
  isOpen,
  onClose,
  errorInfo,
  onRetry,
  onOpenVieNeuDownloadModal,
}) => {
  const [copied, setCopied] = useState(false);
  const [showTechnicalLog, setShowTechnicalLog] = useState(false);

  if (!isOpen || !errorInfo) return null;

  const fullLog = `[TTS ERROR DIAGNOSTIC REPORT]
Time: ${new Date().toLocaleString('vi-VN')}
Platform: ${errorInfo.platform.toUpperCase()}
Provider: ${errorInfo.provider} (${errorInfo.providerDisplayName})
Voice: ${errorInfo.voiceName}
Error Code: ${errorInfo.errorCode}
HTTP Status: ${errorInfo.httpStatus || 'N/A'}
Text Snippet: "${errorInfo.textSnippet.slice(0, 100)}"
Root Cause: ${errorInfo.rootCause}
Technical Details:
${errorInfo.technicalDetails || 'No additional stack trace provided.'}`;

  const handleCopyLog = () => {
    navigator.clipboard.writeText(fullLog);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isVieNeu = errorInfo.provider === 'vieneu_tts';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#18181c] border border-rose-500/30 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl text-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-rose-950/80 via-red-950/60 to-[#18181c] border-b border-rose-500/20 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-400">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-rose-200">
                {isVieNeu ? 'Lỗi Nghe Thử Giọng Đọc VieNeu-TTS' : 'Lỗi Tạo Âm Thanh Nghe Thử'}
              </h3>
              <p className="text-[11px] text-rose-300/70 font-mono">
                Mã lỗi: {errorInfo.errorCode}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Badge Context */}
          <div className="flex flex-wrap gap-2 items-center bg-[#222228] p-2.5 rounded-xl border border-white/5 text-[11px]">
            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30 flex items-center gap-1">
              🎙️ {errorInfo.providerDisplayName}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-medium border border-sky-500/30">
              Giọng: {errorInfo.voiceName}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30 flex items-center gap-1">
              {errorInfo.platform === 'android' ? <Cpu className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              Nền tảng: {errorInfo.platform === 'android' ? 'Android Native' : 'Trình duyệt Web'}
            </span>
          </div>

          {/* Root Cause Banner */}
          <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-rose-300 font-bold text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>Nguyên nhân chính gây lỗi:</span>
            </div>
            <p className="text-rose-100 text-xs leading-relaxed pl-6 font-medium whitespace-pre-wrap">
              {errorInfo.rootCause}
            </p>
          </div>

          {/* Actionable User Guidance */}
          <div className="bg-sky-950/30 border border-sky-500/30 rounded-xl p-3.5 space-y-2">
            <h4 className="font-bold text-sky-300 text-xs flex items-center gap-1.5">
              💡 Hướng dẫn xử lý:
            </h4>
            <p className="text-sky-100 text-xs leading-relaxed pl-2">
              {errorInfo.userGuidance}
            </p>

            {errorInfo.canDownloadVieNeuModel && onOpenVieNeuDownloadModal && (
              <div className="pt-2">
                <button
                  onClick={() => {
                    onClose();
                    onOpenVieNeuDownloadModal();
                  }}
                  className="w-full py-2 px-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black font-bold rounded-xl shadow-lg flex items-center justify-center space-x-2 transition cursor-pointer text-xs"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải gói mô hình VieNeu-TTS Offline (~147 MB)</span>
                </button>
              </div>
            )}
          </div>

          {/* Text Sample Snippet */}
          {errorInfo.textSnippet && (
            <div className="bg-[#121215] p-3 rounded-xl border border-white/5 space-y-1">
              <span className="text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
                Đoạn văn bản nghe thử:
              </span>
              <p className="text-zinc-300 italic font-mono text-[11px] line-clamp-2">
                "{errorInfo.textSnippet}"
              </p>
            </div>
          )}

          {/* Expandable Technical Log / Stack Trace */}
          <div className="border border-white/10 rounded-xl overflow-hidden bg-[#121215]">
            <button
              onClick={() => setShowTechnicalLog(!showTechnicalLog)}
              className="w-full px-3 py-2 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 flex items-center justify-between bg-[#1b1b20] transition cursor-pointer"
            >
              <div className="flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-rose-400" />
                <span>Nhật ký kỹ thuật (Technical Log & Stack Trace)</span>
              </div>
              {showTechnicalLog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showTechnicalLog && (
              <div className="p-3 font-mono text-[10px] text-emerald-400 bg-black/60 space-y-2 border-t border-white/5 overflow-x-auto max-h-48 leading-snug">
                <div>
                  <span className="text-zinc-500">Mã HTTP: </span>
                  <span className="text-amber-300">{errorInfo.httpStatus || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Chi tiết kỹ thuật: </span>
                </div>
                <pre className="text-zinc-300 whitespace-pre-wrap break-all font-mono text-[10px] bg-zinc-950 p-2 rounded border border-white/5">
                  {errorInfo.technicalDetails || 'Không có stack trace phụ.'}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="p-3.5 bg-[#121215] border-t border-white/10 flex items-center justify-between gap-2">
          <button
            onClick={handleCopyLog}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl flex items-center space-x-1.5 transition text-xs cursor-pointer border border-white/10"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Đã sao chép' : 'Sao chép Log'}</span>
          </button>

          <div className="flex items-center space-x-2">
            {onRetry && (
              <button
                onClick={() => {
                  onClose();
                  onRetry();
                }}
                className="px-4 py-2 bg-[#00a2ff] hover:bg-sky-500 text-white font-bold rounded-xl flex items-center space-x-1.5 transition text-xs cursor-pointer shadow-md"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử lại</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition text-xs cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
