import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Settings,
  StopCircle,
  DownloadCloud,
  Loader2,
  Database,
  AlertTriangle,
} from 'lucide-react';
import { OCRScanProgress, AppSettings } from '../types';
import {
  checkPaddleOcrModelStatus,
  downloadPaddleOcrModels,
  PaddleOcrModelStatus,
} from '../utils/localPaddleOcrEngine';

interface ExtractionSettingsProps {
  videoDuration: number;
  onStartFullScan: (startTime: number, endTime: number, interval: number, customContext: string) => void;
  scanProgress: OCRScanProgress;
  onCancelScan: () => void;
  subtitleCount: number;
  appSettings?: AppSettings;
  onSaveSettings?: (newSettings: AppSettings) => void;
  onOpenSettings?: () => void;
}

export const ExtractionSettings: React.FC<ExtractionSettingsProps> = ({
  videoDuration,
  onStartFullScan,
  scanProgress,
  onCancelScan,
  subtitleCount,
  appSettings,
  onSaveSettings,
  onOpenSettings,
}) => {
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(Math.min(300, Math.ceil(videoDuration) || 60));
  const [interval, setInterval] = useState<number>(appSettings?.ocrInterval || 0.7);
  const [bgFilterMode, setBgFilterMode] = useState<'none' | 'contrast' | 'binarize' | 'adaptive'>(
    appSettings?.bgFilterMode || 'none'
  );
  const [bgFilterStrength, setBgFilterStrength] = useState<number>(
    appSettings?.bgFilterStrength ?? 0
  );
  const [customContext, setCustomContext] = useState<string>('');

  useEffect(() => {
    if (appSettings?.ocrInterval) {
      setInterval(appSettings.ocrInterval);
    }
    if (appSettings?.bgFilterMode) {
      setBgFilterMode(appSettings.bgFilterMode);
    }
    if (appSettings?.bgFilterStrength !== undefined) {
      setBgFilterStrength(appSettings.bgFilterStrength);
    }
  }, [appSettings?.ocrInterval, appSettings?.bgFilterMode, appSettings?.bgFilterStrength]);

  const updateBgFilterSettings = (
    mode: 'none' | 'contrast' | 'binarize' | 'adaptive',
    strength: number
  ) => {
    setBgFilterMode(mode);
    setBgFilterStrength(strength);
    if (appSettings && onSaveSettings) {
      onSaveSettings({
        ...appSettings,
        bgFilterMode: mode,
        bgFilterStrength: strength,
      });
    }
  };

  const [paddleStatus, setPaddleStatus] = useState<PaddleOcrModelStatus | null>(null);
  const [isDownloadingPaddle, setIsDownloadingPaddle] = useState<boolean>(false);
  const [paddleProgressMsg, setPaddleProgressMsg] = useState<string>('');

  useEffect(() => {
    if (appSettings?.ocrEngine === 'paddleocr') {
      checkPaddleOcrModelStatus().then((res) => setPaddleStatus(res)).catch(() => {});
    }
  }, [appSettings?.ocrEngine]);

  const handleDownloadPaddle = async () => {
    setIsDownloadingPaddle(true);
    setPaddleProgressMsg('Đang nạp model...');
    const ok = await downloadPaddleOcrModels((pct, msg) => {
      setPaddleProgressMsg(`${pct}% - ${msg}`);
    });
    setIsDownloadingPaddle(false);
    const updated = await checkPaddleOcrModelStatus();
    setPaddleStatus(updated);
  };

  const isScanning = scanProgress.status === 'scanning' || scanProgress.status === 'translating';

  const handleStart = () => {
    const validEnd = endTime > startTime ? endTime : startTime + 10;
    onStartFullScan(startTime, validEnd, interval, customContext);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <div className="bg-amber-500/20 p-2 rounded-lg text-amber-400 border border-amber-500/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Bóc Tách & Dịch Phụ Đề Tự Động</h2>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span>Engine:</span>
              <span className="font-bold text-amber-400 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                {appSettings?.ocrEngine === 'gemini_vision'
                  ? 'Gemini Vision AI (Trực tiếp)'
                  : 'PaddleOCR Siêu Tốc (WebGPU / WASM SIMD)'}
              </span>
              <span className="font-bold text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1">
                <span>⚡ Tăng Tốc WebGPU + Quét Thích Ứng (Adaptive Stepping)</span>
              </span>
              {appSettings?.ocrEngine === 'paddleocr' && (
                paddleStatus?.isReady ? (
                  <span className="text-[10px] text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Model ONNX Đã Sẵn Sàng
                  </span>
                ) : (
                  <button
                    onClick={handleDownloadPaddle}
                    disabled={isDownloadingPaddle}
                    className="text-[10px] text-amber-300 bg-amber-950/60 hover:bg-amber-900/80 border border-amber-500/50 px-2 py-0.5 rounded font-bold flex items-center gap-1 transition shadow-sm animate-pulse"
                  >
                    {isDownloadingPaddle ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>{paddleProgressMsg || 'Đang tải model...'}</span>
                      </>
                    ) : (
                      <>
                        <DownloadCloud className="w-3 h-3 text-amber-400" />
                        <span>Tải Model PaddleOCR Ngay</span>
                      </>
                    )}
                  </button>
                )
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition border border-slate-700 flex items-center space-x-1 text-xs"
              title="Cấu hình OCR, API Key, Proxy"
            >
              <Settings className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Cài Đặt</span>
            </button>
          )}

          {subtitleCount > 0 && (
            <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {subtitleCount} phụ đề đã tạo
            </span>
          )}
        </div>
      </div>

      {/* Progress View if Scanning */}
      {isScanning ? (
        <div className="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-indigo-300 animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              {scanProgress.message}
            </span>
            <span className="text-slate-400 font-mono">{scanProgress.percentage}%</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${scanProgress.percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Khung hình: {scanProgress.currentFrame} / {Math.max(scanProgress.currentFrame, scanProgress.totalFrames)}</span>
            <span>Thời gian quét: {scanProgress.currentTime.toFixed(1)}s / {scanProgress.totalTime.toFixed(1)}s</span>
          </div>

          <button
            onClick={onCancelScan}
            className="mt-1 w-full bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-xs font-semibold py-2 rounded-lg transition flex items-center justify-center space-x-2"
          >
            <StopCircle className="w-4 h-4" />
            <span>Hủy Quét OCR</span>
          </button>
        </div>
      ) : (
        /* Form Settings */
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Start Time */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Thời gian bắt đầu (giây)
              </label>
              <input
                type="number"
                min="0"
                max={videoDuration || 3600}
                value={startTime}
                onChange={(e) => setStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* End Time */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Thời gian kết thúc (giây)
              </label>
              <input
                type="number"
                min="1"
                max={videoDuration || 3600}
                value={endTime}
                onChange={(e) => setEndTime(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Interval */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Tần suất trích xuất (Tốc độ phụ đề)
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval(parseFloat(e.target.value))}
                className="w-full bg-slate-950 border border-indigo-500/40 rounded-lg px-3 py-2 text-xs text-slate-100 font-semibold focus:outline-none focus:border-indigo-400"
              >
                <option value={0.3}>⚡ Mỗi 0.3s (Thoại siêu dồn dập / Video nhạc)</option>
                <option value={0.5}>⚡ Mỗi 0.5s (Thoại nhanh)</option>
                <option value={0.7}>🎯 Mỗi 0.7s (Khuyên dùng - Chuẩn tối ưu)</option>
                <option value={1.0}>⚖️ Mỗi 1.0s (Cân bằng cho video dài)</option>
                <option value={1.5}>🚀 Mỗi 1.5s (Tiết kiệm hiệu năng)</option>
                <option value={2.0}>Mỗi 2.0s (Rất nhanh)</option>
              </select>
            </div>
          </div>

          {/* Adaptive High-Density Sampling Toggle */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <span className="text-amber-400 text-sm">⚡</span>
              <div>
                <p className="text-xs font-bold text-slate-200">Quét thích ứng đoạn thoại ngắn dồn dập (Adaptive High-Density Sampling)</p>
                <p className="text-[11px] text-slate-400">Tự động x2 mật độ quét khi phát hiện thoại ngắn biến đổi liên tục (&lt;1.5s/câu) để không bỏ sót câu thoại nào</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={appSettings?.adaptiveSampling !== false}
              onChange={(e) => {
                if (appSettings && onSaveSettings) {
                  onSaveSettings({ ...appSettings, adaptiveSampling: e.target.checked });
                }
              }}
              className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* AI Post-Filtering Workflow Toggle */}
          <div className="bg-slate-950/80 border border-amber-500/30 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <span className="text-amber-400 text-sm">🤖</span>
                <div>
                  <div className="flex items-center space-x-2">
                    <p className="text-xs font-bold text-slate-200">Rà soát phụ đề bằng AI ở bước workflow cuối (AI Refine)</p>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                      {appSettings?.autoAiRefine !== false ? 'ĐANG BẬT (Dùng Gemini AI)' : 'TẮT (Tiết kiệm Quota - OCR Cục bộ 100%)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Bật để Gemini AI tự động sửa lỗi chính tả, lọc trùng & làm sạch phụ đề ở bước cuối. Tắt khi muốn dùng 100% OCR Cục bộ.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={appSettings?.autoAiRefine !== false}
                onChange={(e) => {
                  if (appSettings && onSaveSettings) {
                    onSaveSettings({ ...appSettings, autoAiRefine: e.target.checked });
                  }
                }}
                className="w-4 h-4 rounded accent-amber-400 cursor-pointer"
              />
            </div>
            {appSettings?.autoAiRefine !== false && !appSettings?.apiKey && (
              <div className="text-[11px] text-amber-300/90 bg-amber-950/40 border border-amber-500/20 rounded-lg p-2 flex items-start gap-1.5">
                <span className="text-amber-400 mt-0.5">💡</span>
                <span>
                  <strong>Khi deploy lên Render/Vercel:</strong> Hãy cấu hình biến môi trường <code className="bg-amber-900/60 px-1 py-0.5 rounded text-amber-200">GEMINI_API_KEY</code> trong Dashboard của host hoặc bấm nút <strong>Cài Đặt ⚙️</strong> phía trên để nhập API Key cá nhân của bạn, giúp bước AI Lọc trùng hoạt động 100%.
                </span>
              </div>
            )}
          </div>

          {/* OCR Confidence Threshold Slider */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-amber-400 text-sm">🎯</span>
                <div>
                  <p className="text-xs font-bold text-slate-200">Ngưỡng lọc độ tin cậy OCR (Confidence Threshold)</p>
                  <p className="text-[11px] text-slate-400">Tự động loại bỏ rác & nét mờ dưới ngưỡng để giảm tối đa lỗi chính tả OCR</p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {Math.round((appSettings?.confidenceThreshold ?? 0.7) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.30"
              max="0.95"
              step="0.05"
              value={appSettings?.confidenceThreshold ?? 0.70}
              onChange={(e) => {
                if (appSettings && onSaveSettings) {
                  onSaveSettings({ ...appSettings, confidenceThreshold: parseFloat(e.target.value) });
                }
              }}
              className="w-full accent-amber-400 cursor-pointer"
            />
          </div>

          {/* Background Text Filtering Controls (Bộ Lọc Khử Nền Chữ Video) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
                  🎨 Bộ Lọc Lọc Chữ Nền Video
                </span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30 font-semibold">
                  ĐỘ MẠNH LỌC
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-400">
                {bgFilterMode === 'none' ? 'Tắt' : `${bgFilterStrength}%`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Filter Mode Selector */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Chế độ lọc nền:
                </label>
                <select
                  value={bgFilterMode}
                  onChange={(e) => {
                    const newMode = e.target.value as 'none' | 'contrast' | 'binarize' | 'adaptive';
                    const newStrength = (newMode !== 'none' && (!bgFilterStrength || bgFilterStrength === 0)) ? 40 : bgFilterStrength;
                    updateBgFilterSettings(newMode, newStrength);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400 font-semibold"
                >
                  <option value="none">⚪ Tắt (Giữ nguyên ảnh gốc)</option>
                  <option value="contrast">✨ Tăng Tương Phản Nét Chữ (Khuyên dùng)</option>
                  <option value="binarize">🔲 Chuyển Đen Trắng Đơn Sắc (Binarization)</option>
                  <option value="adaptive">🌀 Lọc Nền Chuyển Màu Động (Adaptive)</option>
                </select>
              </div>

              {/* Filter Strength Slider */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    Độ mạnh lọc chữ nền:
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {bgFilterStrength <= 25 ? 'Nhẹ' : bgFilterStrength <= 45 ? 'Tiêu chuẩn (40%)' : bgFilterStrength <= 65 ? 'Vừa' : 'Mạnh'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  disabled={bgFilterMode === 'none'}
                  value={bgFilterStrength}
                  onChange={(e) => updateBgFilterSettings(bgFilterMode, parseInt(e.target.value, 10))}
                  className="w-full accent-amber-400 cursor-pointer disabled:opacity-40"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-normal">
              💡 <strong>Hoạt động thực sự:</strong> Bộ lọc canvas trực tiếp khử bớt nhiễu cảnh quay video phía sau, làm nổi bật viền và nét chữ phụ đề (tiếng Trung/Anh/Việt) để PaddleOCR & Gemini nhận diện chính xác 100%.
            </p>
          </div>

          {/* Context / Keywords Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Ghi chú ngữ cảnh video (Tùy chọn)
            </label>
            <input
              type="text"
              placeholder="Ví dụ: Phim hoạt hình anime thoại tiếng Nhật, hội thảo AI công nghệ..."
              value={customContext}
              onChange={(e) => setCustomContext(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Submit Action Button */}
          <button
            onClick={handleStart}
            className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs py-3 px-4 rounded-xl shadow-lg shadow-indigo-600/30 transition transform active:scale-98 flex items-center justify-center space-x-2"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Chạy Bóc Tách OCR & Dịch Tự Động Toàn Đoạn</span>
          </button>
        </div>
      )}
    </div>
  );
};
