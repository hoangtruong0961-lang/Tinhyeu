import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  SlidersHorizontal,
  Zap,
  Cpu,
  Layers,
  Check,
  X,
  Sparkles,
} from 'lucide-react';
import {
  ExportSettingsConfig,
  ExportEngine,
  ExportVideoFormat,
  ExportResolution,
  ExportFrameRate,
  ExportBitrate,
} from '../types';

interface TopExportSettingsDropdownProps {
  settings: ExportSettingsConfig;
  onChangeSettings: (newSettings: ExportSettingsConfig) => void;
  videoDimensions?: { width: number; height: number } | null;
  isOpen?: boolean;
  onToggleOpen?: () => void;
  onClose?: () => void;
}

export const TopExportSettingsDropdown: React.FC<TopExportSettingsDropdownProps> = ({
  settings,
  onChangeSettings,
  videoDimensions,
  isOpen: controlledIsOpen,
  onToggleOpen,
  onClose,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const isPanelOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const toggleOpen = () => {
    if (onToggleOpen) {
      onToggleOpen();
    } else {
      setInternalIsOpen((prev) => !prev);
    }
  };

  const closePanel = () => {
    if (onClose) {
      onClose();
    } else if (onToggleOpen && controlledIsOpen) {
      onToggleOpen();
    } else {
      setInternalIsOpen(false);
    }
  };

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closePanel();
      }
    };
    if (isPanelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPanelOpen]);

  const updateSetting = <K extends keyof ExportSettingsConfig>(
    key: K,
    val: ExportSettingsConfig[K]
  ) => {
    onChangeSettings({
      ...settings,
      [key]: val,
    });
  };

  const engines: { id: ExportEngine; label: string; sub: string; badge?: string }[] = [
    { id: 'mediabunny', label: 'Mediabunny', sub: 'WebCodecs GPU MP4', badge: 'Khuyên dùng' },
    { id: 'ffmpeg_wasm', label: 'FFmpeg Wasm', sub: 'WebAssembly in Browser', badge: 'WASM' },
    { id: 'ffmpeg_native', label: 'FFmpeg Native', sub: 'Desktop C/C++ GPU', badge: 'Desktop' },
    { id: 'ffmpeg_mobile', label: 'FFmpeg Mobile', sub: 'Android ARM64 Native', badge: 'Mobile' },
    { id: 'mediarecorder', label: 'MediaRecoder', sub: 'HTML5 MediaStream', badge: 'Fallback' },
  ];

  const formats: { id: ExportVideoFormat; label: string; desc: string }[] = [
    { id: 'mp4', label: 'MP4', desc: 'H.264 / AAC (Khuyên dùng)' },
    { id: 'webm', label: 'WebM', desc: 'VP9 / Opus (Mã nguồn mở)' },
    { id: 'mov', label: 'MOV', desc: 'QuickTime ProRes' },
    { id: 'mkv', label: 'MKV', desc: 'Matroska' },
  ];

  const resolutions: { id: ExportResolution; label: string; desc: string }[] = [
    {
      id: 'original',
      label: 'Độ phân giải gốc',
      desc: videoDimensions ? `${videoDimensions.width} × ${videoDimensions.height} (Khuyến nghị)` : 'Theo video nguồn (Khuyến nghị)',
    },
    { id: '4k', label: '4K Ultra HD', desc: '3840 × 2160' },
    { id: '2k', label: '2K Quad HD', desc: '2560 × 1440' },
    { id: '1080p', label: 'Full HD 1080p', desc: '1920 × 1080' },
    { id: '720p', label: 'HD 720p', desc: '1280 × 720' },
    { id: '480p', label: 'SD 480p', desc: '854 × 480' },
  ];

  const frameRates: { id: ExportFrameRate; label: string; desc: string }[] = [
    { id: 'original', label: 'Frame rate gốc', desc: 'Theo video nguồn (Khuyến nghị)' },
    { id: 60, label: '60 fps', desc: 'Mượt mà (Gaming / Fast motion)' },
    { id: 50, label: '50 fps', desc: 'Chuẩn PAL Châu Âu' },
    { id: 30, label: '30 fps', desc: 'Tiêu chuẩn video trực tuyến' },
    { id: 25, label: '25 fps', desc: 'Chuẩn phát thanh & điện ảnh' },
    { id: 24, label: '24 fps', desc: 'Điện ảnh (Cinematic Film)' },
  ];

  const bitrates: { id: ExportBitrate; label: string; desc: string }[] = [
    { id: 'recommended', label: 'Bitrate tự động', desc: 'Tự động tối ưu hóa (Khuyến nghị)' },
    { id: 16000000, label: '16 Mbps', desc: 'Cực nét (4K / 2K Master)' },
    { id: 12000000, label: '12 Mbps', desc: 'Siêu nét (1080p High)' },
    { id: 8000000, label: '8 Mbps', desc: 'Nét cao (1080p Standard)' },
    { id: 4000000, label: '4 Mbps', desc: 'Tiêu chuẩn (720p)' },
    { id: 2000000, label: '2 Mbps', desc: 'Tiết kiệm dung lượng (Nhanh)' },
  ];

  const currentEngineObj = engines.find((e) => e.id === settings.engine) || engines[0];

  return (
    <div className="inline-block" ref={dropdownRef}>
      {/* 1. KÉO XUỐNG BUTTON (Đồng bộ với các nút top bar) */}
      <button
        type="button"
        onClick={toggleOpen}
        className={`relative z-[100] h-[30px] px-2.5 rounded-lg border text-xs font-medium transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5 select-none ${
          isPanelOpen
            ? 'bg-[#2e2e36] border-white/20 text-white'
            : 'bg-[#222226] hover:bg-[#2c2c31] text-zinc-300 hover:text-white border-white/10'
        }`}
        title="Tùy chọn xuất: Engine, Định dạng, Độ phân giải, Frame rate, Bitrate"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
        <span className="hidden sm:inline">Tùy chọn</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 text-zinc-400 ${
            isPanelOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {/* 2. PANEL ĐƯỢC KÉO XUỐNG HIỂN THỊ TÙY CHỌN */}
      {isPanelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[95] backdrop-blur-[1px] animate-in fade-in duration-150"
            onClick={closePanel}
          />

          {/* Panel tùy chọn - Tông màu tối đồng bộ với Editor */}
          <div className="absolute top-full left-2 right-2 sm:left-auto sm:right-3 mt-1.5 z-[100] sm:w-[390px] max-w-[calc(100%-16px)] bg-[#18181d] border border-zinc-800 rounded-2xl shadow-2xl p-4 text-zinc-200 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/90 mb-3.5">
              <div className="flex items-center space-x-2.5">
                <div className="p-1.5 rounded-lg bg-white/5 text-zinc-300">
                  <SlidersHorizontal className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-zinc-100 tracking-wide">
                    Tùy chọn xuất video
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Cấu hình bộ mã hóa, định dạng, độ phân giải & bitrate
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition cursor-pointer"
                title="Đóng bảng tùy chọn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 max-h-[min(520px,calc(100vh-120px))] overflow-y-auto pr-1 [scrollbar-width:thin]">
              {/* 1. ENGINE XUẤT */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Engine xuất</span>
                  </label>
                  <span className="text-[10.5px] font-mono text-zinc-400">
                    {currentEngineObj.label}
                  </span>
                </div>
                <select
                  value={settings.engine}
                  onChange={(e) => updateSetting('engine', e.target.value as ExportEngine)}
                  className="w-full bg-[#202026] border border-zinc-800/80 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                >
                  {engines.map((eng) => (
                    <option key={eng.id} value={eng.id} className="bg-[#18181d] text-zinc-200">
                      {eng.label} ({eng.sub})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. ĐỊNH DẠNG XUẤT VIDEO */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Định dạng tệp</span>
                  </label>
                  <span className="text-[10.5px] font-mono text-zinc-400 uppercase font-medium">
                    .{settings.format}
                  </span>
                </div>
                <select
                  value={settings.format}
                  onChange={(e) => updateSetting('format', e.target.value as ExportVideoFormat)}
                  className="w-full bg-[#202026] border border-zinc-800/80 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                >
                  {formats.map((fmt) => (
                    <option key={fmt.id} value={fmt.id} className="bg-[#18181d] text-zinc-200">
                      .{fmt.label.toUpperCase()} — {fmt.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. ĐỘ PHÂN GIẢI VIDEO */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Độ phân giải</span>
                  </label>
                  <span className="text-[10.5px] text-zinc-400 font-mono">
                    {settings.resolution === 'original' ? 'Gốc' : settings.resolution.toUpperCase()}
                  </span>
                </div>
                <select
                  value={settings.resolution}
                  onChange={(e) => updateSetting('resolution', e.target.value as ExportResolution)}
                  className="w-full bg-[#202026] border border-zinc-800/80 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                >
                  {resolutions.map((r) => (
                    <option key={r.id} value={r.id} className="bg-[#18181d] text-zinc-200">
                      {r.label} — {r.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. FRAME RATE VIDEO */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Tốc độ khung hình (FPS)</span>
                  </label>
                  <span className="text-[10.5px] text-zinc-400 font-mono">
                    {settings.frameRate === 'original' ? 'Gốc' : `${settings.frameRate} FPS`}
                  </span>
                </div>
                <select
                  value={settings.frameRate}
                  onChange={(e) =>
                    updateSetting(
                      'frameRate',
                      e.target.value === 'original' ? 'original' : (Number(e.target.value) as ExportFrameRate)
                    )
                  }
                  className="w-full bg-[#202026] border border-zinc-800/80 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                >
                  {frameRates.map((fr) => (
                    <option key={String(fr.id)} value={fr.id} className="bg-[#18181d] text-zinc-200">
                      {fr.label} — {fr.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. BITRATE VIDEO */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-zinc-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Bitrate chất lượng</span>
                  </label>
                  <span className="text-[10.5px] text-zinc-400 font-mono">
                    {settings.bitrate === 'recommended' ? 'Tự động' : `${settings.bitrate / 1000000} Mbps`}
                  </span>
                </div>
                <select
                  value={settings.bitrate}
                  onChange={(e) =>
                    updateSetting(
                      'bitrate',
                      e.target.value === 'recommended' ? 'recommended' : (Number(e.target.value) as ExportBitrate)
                    )
                  }
                  className="w-full bg-[#202026] border border-zinc-800/80 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
                >
                  {bitrates.map((b) => (
                    <option key={String(b.id)} value={b.id} className="bg-[#18181d] text-zinc-200">
                      {b.label} — {b.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* 6. GPU HARDWARE ACCELERATION TOGGLE */}
              <div className="pt-2 border-t border-zinc-800/60">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#202026] border border-zinc-800/80">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${settings.gpuAcceleration !== false ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400'}`}>
                      <Zap className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-zinc-200 flex items-center gap-1.5">
                        <span>GPU Acceleration</span>
                        <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 font-mono">Tăng tốc 3-5X</span>
                      </div>
                      <div className="text-[10px] text-zinc-400">WebGL / WebGPU / NVENC</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSetting('gpuAcceleration', settings.gpuAcceleration === false ? true : false)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      settings.gpuAcceleration !== false ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.gpuAcceleration !== false ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Footer Summary & Close Button */}
            <div className="mt-3.5 pt-3 border-t border-zinc-800/90 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-400 truncate max-w-[230px]">
                <Check className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                <span className="truncate">
                  {currentEngineObj.label} • {settings.format.toUpperCase()} •{' '}
                  {settings.resolution === 'original' ? 'Gốc' : settings.resolution} •{' '}
                  {settings.frameRate === 'original' ? 'FPS gốc' : `${settings.frameRate}fps`}
                </span>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="px-3.5 py-1.5 rounded-lg bg-[#272730] hover:bg-[#32323c] text-zinc-100 font-medium text-xs transition active:scale-95 cursor-pointer border border-zinc-700/80"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
