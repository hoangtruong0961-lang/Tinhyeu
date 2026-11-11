import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, AlertCircle, HardDrive, Trash2, X, RefreshCw, Sparkles, Volume2 } from 'lucide-react';
import { VieNeuNative, VieNeuStatus, VieNeuProgressEvent } from '../plugins/vieneuPlugin';

interface VieNeuModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelReady?: () => void;
}

export const VieNeuModelDownloadModal: React.FC<VieNeuModelDownloadModalProps> = ({
  isOpen,
  onClose,
  onModelReady,
}) => {
  const [status, setStatus] = useState<VieNeuStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const st = await VieNeuNative.checkStatus();
      setStatus(st);
      if (st.isReady && onModelReady) {
        onModelReady();
      }
    } catch (e: any) {
      setError(e?.message || 'Không thể kiểm tra trạng thái mô hình');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    let removeListener: (() => Promise<void>) | null = null;

    const setupListener = async () => {
      try {
        const sub = await VieNeuNative.addListener(
          'vieneu_download_progress',
          (event: VieNeuProgressEvent) => {
            setDownloadProgress(event.percent);
            setProgressMessage(event.message);

            if (event.status === 'completed') {
              setIsDownloading(false);
              fetchStatus();
            } else if (event.status === 'error') {
              setIsDownloading(false);
              setError(event.message);
            } else if (event.status === 'cancelled') {
              setIsDownloading(false);
            }
          }
        );
        removeListener = sub.remove;
      } catch (e) {
        console.warn('VieNeu progress listener fallback:', e);
      }
    };

    if (isOpen) {
      setupListener();
    }

    return () => {
      if (removeListener) removeListener();
    };
  }, [isOpen]);

  const handleStartDownload = async () => {
    try {
      setIsDownloading(true);
      setError(null);
      setDownloadProgress(2);
      setProgressMessage('Đang kết nối kho mô hình Hugging Face...');

      const res = await VieNeuNative.downloadModels({ includeCloning: false });
      if (res.isReady) {
        setDownloadProgress(100);
        setProgressMessage('Tải và cài đặt thành công!');
        await fetchStatus();
      }
    } catch (e: any) {
      setError(e?.message || 'Lỗi trong quá trình tải mô hình');
      setIsDownloading(false);
    }
  };

  const handleCancelDownload = async () => {
    try {
      await VieNeuNative.cancelDownload();
      setIsDownloading(false);
      setProgressMessage('Đã hủy tải.');
    } catch (e: any) {
      console.warn('Cancel download error:', e);
    }
  };

  const handleDeleteModels = async () => {
    if (!window.confirm('Bạn có chắc muốn xóa dữ liệu mô hình VieNeu-TTS để giải phóng bộ nhớ máy không?')) {
      return;
    }
    try {
      setLoading(true);
      await VieNeuNative.deleteModels();
      await fetchStatus();
    } catch (e: any) {
      setError(e?.message || 'Không thể xóa mô hình');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#14151a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Mô hình VieNeu-TTS v3 Turbo
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  OFFLINE 100%
                </span>
              </h3>
              <p className="text-xs text-zinc-400">Giọng đọc AI tiếng Việt tự nhiên nhất hiện nay</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Status Banner */}
          {loading ? (
            <div className="p-6 text-center text-zinc-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
              <span>Đang kiểm tra dữ liệu máy...</span>
            </div>
          ) : status?.isReady ? (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-300">
                  Mô hình đã sẵn sàng trên thiết bị!
                </p>
                <p className="text-xs text-zinc-400">
                  Dung lượng đã lưu: <span className="text-white font-mono">{status.totalSizeMB || 147.4} MB</span>. Bạn có thể thuyết minh không giới hạn mà không cần internet.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                <HardDrive className="w-4 h-4" />
                <span>Chưa có gói dữ liệu mô hình</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Để giữ dung lượng ứng dụng siêu nhẹ khi cài đặt, mô hình AI VieNeu-TTS (~147 MB) được tải trực tiếp theo nhu cầu vào bộ nhớ máy của bạn.
              </p>
            </div>
          )}

          {/* Model Features Highlights */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
              <span className="text-amber-400 font-medium">✨ Giọng đọc tự nhiên</span>
              <p className="text-zinc-400">23 giọng đọc chuẩn 3 miền (Bắc - Trung - Nam), ngữ điệu mượt mà.</p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
              <span className="text-sky-400 font-medium">🔒 100% Riêng tư</span>
              <p className="text-zinc-400">Xử lý trực tiếp trên chip thiết bị, không cần gửi văn bản lên máy chủ.</p>
            </div>
          </div>

          {/* Download Progress Bar */}
          {isDownloading && (
            <div className="space-y-2 p-4 rounded-xl bg-white/[0.02] border border-white/10">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 flex items-center gap-1.5 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  {progressMessage || 'Đang tải dữ liệu...'}
                </span>
                <span className="font-mono text-amber-400 font-bold">{downloadProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden p-0.5 border border-white/5">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-300 ease-out shadow-sm"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleCancelDownload}
                  className="text-[11px] text-zinc-400 hover:text-red-400 transition-colors"
                >
                  Hủy tiến trình
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-white/10 bg-black/30 flex items-center justify-between gap-3">
          {status?.isReady ? (
            <>
              <button
                type="button"
                onClick={handleDeleteModels}
                disabled={loading || isDownloading}
                className="px-3.5 py-2 rounded-xl text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa mô hình</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Hoàn tất & Bắt đầu dùng</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isDownloading}
                className="px-4 py-2.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
              >
                Để sau
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                disabled={isDownloading || loading}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold btn-metallic-amber hover:brightness-110 text-zinc-950 transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang tải...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Tải mô hình ngay (~147 MB)</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
