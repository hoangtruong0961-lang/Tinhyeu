import React, { useState, useEffect } from 'react';
import {
  X,
  Film,
  Sparkles,
  Loader2,
  Check,
  FolderOpen,
  SlidersHorizontal,
  Volume2,
  AlertCircle,
  Download,
  Cpu,
  Zap,
  Package,
  FileCode,
  FileText,
  Layers,
  CheckCircle2,
  ExternalLink,
  Flame,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  SubtitleItem,
  SubtitleStyleConfig,
  BlurOverlay,
  LogoOverlay,
  TextOverlay,
  ExportSettingsConfig,
  AudioEffectType,
} from '../types';
import { exportToSRT, exportToASS } from '../utils/srtParser';
import { generateVoiceoverWav, generateVoiceoverAudioBuffer, audioBufferToWavBlob } from '../utils/audioExporter';
import { renderVideoWithSubtitles, RenderProgress } from '../utils/videoRenderer';
import { exportWithCapacitorFFmpeg, saveBlobToAndroidDownloads } from '../utils/mobileFfmpegExporter';
import { nativeVideoEngine, NativeEngineInfo } from '../services/nativeVideoEngine';
import { gpuShaderEngine, GpuEngineStatus } from '../utils/gpuShaderEngine';
import { computeExportDimensions, getMimeTypeForFormat, normalizeExportFormat } from '../utils/exportResolution';
import {
  exportCapCutDraftZip,
  exportPremiereProProjectZip,
  exportMasterProjectBundle,
  triggerFileDownload,
} from '../utils/projectExporter';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleItem[];
  onImportSubtitles?: (subtitles: SubtitleItem[]) => void;
  videoUrl?: string;
  videoDuration?: number;
  videoDimensions?: { width: number; height: number } | null;
  styleConfig?: SubtitleStyleConfig;
  projectTitle?: string;
  onGenerateAllAudio?: () => Promise<void>;
  isGeneratingAllAudio?: boolean;
  ttsSpeed?: number;
  ttsPitch?: number;
  videoVolume?: number;
  videoAudioEffect?: AudioEffectType;
  blurOverlays?: BlurOverlay[];
  logoOverlays?: LogoOverlay[];
  textOverlays?: TextOverlay[];
  exportSettings?: ExportSettingsConfig;
  onOpenExportSettings?: () => void;
  onUpdateExportSettings?: (newSettings: ExportSettingsConfig) => void;
  onExportProgress?: (progress: RenderProgress | null) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  videoUrl = '',
  videoDuration = 0,
  videoDimensions,
  styleConfig,
  projectTitle = 'video_export',
  ttsSpeed = 1.0,
  ttsPitch = 0,
  videoVolume = 1.0,
  videoAudioEffect = 'none',
  blurOverlays = [],
  logoOverlays = [],
  textOverlays = [],
  exportSettings,
  onOpenExportSettings,
  onUpdateExportSettings,
  onExportProgress,
}) => {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
  const isNativeCapacitor = Capacitor.isNativePlatform();

  // Active Tab: 'video' | 'project'
  const [activeTab, setActiveTab] = useState<'video' | 'project'>('video');

  const [exportFileName, setExportFileName] = useState<string>(
    projectTitle ? projectTitle.replace(/\.\w+$/, '') : 'video_export'
  );

  const [mergeTtsAudioIntoVideo, setMergeTtsAudioIntoVideo] = useState<boolean>(true);

  // Native C/C++ Engine Info (Electron Desktop / Capacitor Mobile)
  const [nativeEngineInfo, setNativeEngineInfo] = useState<NativeEngineInfo | null>(null);

  // GPU Hardware Engine Status
  const [gpuStatus, setGpuStatus] = useState<GpuEngineStatus>(() => gpuShaderEngine.getStatus());

  // GPU Acceleration toggle state
  const isGpuAccelerated = exportSettings?.gpuAcceleration !== false;

  // Project Export states
  const [isExportingProject, setIsExportingProject] = useState<string | null>(null);
  const [projectExportSuccess, setProjectExportSuccess] = useState<string | null>(null);

  // Export Progress & Status
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<string>('');
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  const [lastExportedFilePath, setLastExportedFilePath] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>({
    percentage: 0,
    currentTime: 0,
    duration: videoDuration || 1,
    status: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    nativeVideoEngine
      .getEngineInfo()
      .then((info) => {
        setNativeEngineInfo(info);
      })
      .catch(() => {});

    try {
      setGpuStatus(gpuShaderEngine.getStatus());
    } catch (_) {}
  }, [isOpen]);

  useEffect(() => {
    if (projectTitle) {
      setExportFileName(projectTitle.replace(/\.\w+$/, ''));
    }
  }, [projectTitle]);

  if (!isOpen) return null;

  // Resolved Export Configurations (cleanly validated for current platform)
  const rawEngine = exportSettings?.engine;
  const currentEngine =
    rawEngine === 'ffmpeg_mobile' && isNativeCapacitor
      ? 'ffmpeg_mobile'
      : rawEngine === 'ffmpeg_native' && isElectron
      ? 'ffmpeg_native'
      : rawEngine === 'mediarecorder' || rawEngine === 'mediabunny'
      ? rawEngine
      : isNativeCapacitor
      ? 'ffmpeg_mobile'
      : isElectron
      ? 'ffmpeg_native'
      : 'mediabunny';

  const currentFormat = normalizeExportFormat(currentEngine, exportSettings?.format || 'mp4');
  const currentResolution = exportSettings?.resolution || 'original';
  const currentFrameRate = exportSettings?.frameRate || 'original';
  const currentBitrate = exportSettings?.bitrate || 'recommended';
  const resolvedDims = computeExportDimensions(
    currentResolution,
    videoDimensions?.width,
    videoDimensions?.height
  );

  const engineDisplayNames: Record<string, string> = {
    mediabunny: 'Mediabunny (WebCodecs Hardware)',
    ffmpeg_native: 'FFmpeg Native (Desktop GPU/CPU)',
    ffmpeg_mobile: 'FFmpeg Mobile (Android Native)',
    mediarecorder: 'MediaRecorder (HTML5 Fallback)',
  };

  const handleToggleGpuAcceleration = (enabled: boolean) => {
    if (onUpdateExportSettings && exportSettings) {
      onUpdateExportSettings({
        ...exportSettings,
        gpuAcceleration: enabled,
      });
    }
  };

  // 1. Export CapCut Project Draft (.zip)
  const handleExportCapCutDraft = async () => {
    try {
      setIsExportingProject('capcut');
      const zipBlob = await exportCapCutDraftZip({
        projectTitle: exportFileName || 'CapCut_Project',
        videoUrl,
        videoDuration,
        subtitles,
        styleConfig,
        blurOverlays,
        logoOverlays,
        textOverlays,
        fps: currentFrameRate === 'original' ? 30 : Number(currentFrameRate),
        videoVolume,
      });
      const savedPath = await triggerFileDownload(zipBlob, `${exportFileName}_CapCut_Draft.zip`, 'application/zip');
      setProjectExportSuccess(
        savedPath
          ? `Đã lưu gói CapCut Draft vào: ${savedPath}`
          : 'Đã xuất thành công gói dự án CapCut Draft (.zip)!'
      );
      setTimeout(() => setProjectExportSuccess(null), 6000);
    } catch (err: any) {
      console.error('CapCut export error:', err);
      alert(`Lỗi xuất dự án CapCut: ${err?.message || err}`);
    } finally {
      setIsExportingProject(null);
    }
  };

  // 2. Export Adobe Premiere Pro / DaVinci XML (.xml / .zip)
  const handleExportPremiereXml = async () => {
    try {
      setIsExportingProject('premiere');
      const zipBlob = await exportPremiereProProjectZip({
        projectTitle: exportFileName || 'Premiere_Project',
        videoUrl,
        videoDuration,
        subtitles,
        styleConfig,
        textOverlays,
        fps: currentFrameRate === 'original' ? 30 : Number(currentFrameRate),
      });
      const savedPath = await triggerFileDownload(zipBlob, `${exportFileName}_PremierePro_XML.zip`, 'application/zip');
      setProjectExportSuccess(
        savedPath
          ? `Đã lưu Premiere/DaVinci XML vào: ${savedPath}`
          : 'Đã xuất thành công gói sequence XML cho Adobe Premiere Pro & DaVinci Resolve!'
      );
      setTimeout(() => setProjectExportSuccess(null), 6000);
    } catch (err: any) {
      console.error('Premiere export error:', err);
      alert(`Lỗi xuất dự án Premiere Pro: ${err?.message || err}`);
    } finally {
      setIsExportingProject(null);
    }
  };

  // 3. Export Master Project Archive Bundle
  const handleExportMasterBundle = async () => {
    try {
      setIsExportingProject('master');
      const zipBlob = await exportMasterProjectBundle({
        projectTitle: exportFileName || 'Master_Project',
        videoUrl,
        videoDuration,
        subtitles,
        styleConfig,
        blurOverlays,
        logoOverlays,
        textOverlays,
        fps: currentFrameRate === 'original' ? 30 : Number(currentFrameRate),
      });
      const savedPath = await triggerFileDownload(zipBlob, `${exportFileName}_Master_Project_Bundle.zip`, 'application/zip');
      setProjectExportSuccess(
        savedPath
          ? `Đã lưu Master Bundle vào: ${savedPath}`
          : 'Đã xuất thành công toàn bộ gói Master Archive (.zip)!'
      );
      setTimeout(() => setProjectExportSuccess(null), 6000);
    } catch (err: any) {
      console.error('Master bundle export error:', err);
      alert(`Lỗi xuất gói tổng hợp: ${err?.message || err}`);
    } finally {
      setIsExportingProject(null);
    }
  };

  // 4. Download Standalone Subtitle Files
  const handleDownloadSubtitleOnly = async (format: 'srt' | 'ass' | 'vtt') => {
    try {
      let content = '';
      const mimeType = format === 'srt' ? 'application/x-subrip' : 'text/plain';
      const ext = format;

      if (format === 'srt') {
        content = exportToSRT(subtitles);
      } else if (format === 'ass') {
        content = exportToASS(subtitles, styleConfig || ({} as SubtitleStyleConfig));
      } else if (format === 'vtt') {
        const formatVttTime = (sec: number) => {
          const d = new Date(sec * 1000);
          return d.toISOString().substr(11, 12);
        };
        content = `WEBVTT\n\n` + subtitles.map((s, i) => `${i + 1}\n${formatVttTime(s.startTime)} --> ${formatVttTime(s.endTime)}\n${s.translatedText || s.originalText}\n`).join('\n');
      }

      const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
      const savedPath = await triggerFileDownload(blob, `${exportFileName}.${ext}`, mimeType);
      if (savedPath) {
        setProjectExportSuccess(`Đã lưu phụ đề .${ext.toUpperCase()} vào: ${savedPath}`);
        setTimeout(() => setProjectExportSuccess(null), 6000);
      }
    } catch (err: any) {
      alert(`Lỗi tải phụ đề .${format.toUpperCase()}: ${err?.message || err}`);
    }
  };

  // Main Video Export Process
  const handleStartExport = async () => {
    if (!videoUrl) {
      alert('Vui lòng chọn video trước khi xuất!');
      return;
    }

    setIsExporting(true);
    setExportSuccessMsg(null);
    setLastExportedFilePath(null);
    setExportStatus('Đang khởi tạo tiến trình xuất video...');
    setRenderProgress({
      percentage: 0,
      currentTime: 0,
      duration: videoDuration || 1,
      status: 'Đang chuẩn bị khung hình...',
    });

    const cleanFileName = exportFileName.trim() || 'video_export';
    const targetWidth = currentResolution === 'original' ? undefined : resolvedDims?.width;
    const targetHeight = currentResolution === 'original' ? undefined : resolvedDims?.height;
    const targetFps = currentFrameRate === 'original' ? undefined : Number(currentFrameRate);
    const targetBitrate = currentBitrate === 'recommended' ? undefined : Number(currentBitrate);

    const hasCanvasOnlyOverlays =
      blurOverlays.length > 0 ||
      logoOverlays.length > 0 ||
      textOverlays.length > 0 ||
      styleConfig?.orientation === 'vertical' ||
      Boolean(styleConfig?.hasSecondaryOutline) ||
      Boolean(styleConfig?.customUploadedFonts && styleConfig.customUploadedFonts.length > 0);

    try {
      window.electronAPI?.preventSleep?.();

      if (
        currentEngine === 'ffmpeg_native' &&
        isElectron &&
        window.electronAPI?.renderSubtitledVideo &&
        !hasCanvasOnlyOverlays
      ) {
        setExportStatus('Đang gọi FFmpeg C/C++ Native...');
        let unsubProgress: (() => void) | undefined;
        if (window.electronAPI?.onFfmpegRenderProgress) {
          unsubProgress = window.electronAPI.onFfmpegRenderProgress((p) => {
            const pct = Math.min(100, Math.max(0, Math.round(p.percentage || 0)));
            const progressData: RenderProgress = {
              percentage: pct,
              currentTime: p.currentTime || (p.duration ? (pct / 100) * p.duration : 0),
              duration: p.duration || videoDuration || 1,
              status: `FFmpeg Native: ${p.timeStr || `${pct}%`} (${pct}%)`,
            };
            setRenderProgress(progressData);
            onExportProgress?.(progressData);
            window.electronAPI?.setProgressBar?.(pct / 100);
          });
        }

        try {
          const assContent = exportToASS(
            subtitles,
            styleConfig || ({} as SubtitleStyleConfig),
            'translated',
            targetWidth || videoDimensions?.width || 1920,
            targetHeight || videoDimensions?.height || 1080
          );

          let audioWavBase64: string | undefined;
          if (mergeTtsAudioIntoVideo && subtitles.some((s) => s.audioUrl?.trim())) {
            setExportStatus('Đang tổng hợp track âm thanh thuyết minh TTS...');
            try {
              const voiceRes = await generateVoiceoverAudioBuffer(
                subtitles,
                Math.max(1, videoDuration || 10),
                ttsSpeed,
                ttsPitch
              );
              const wavBlob = audioBufferToWavBlob(voiceRes.buffer);
              const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());
              let bin = '';
              for (let i = 0; i < wavBytes.length; i += 0x8000) {
                bin += String.fromCharCode(...wavBytes.subarray(i, Math.min(i + 0x8000, wavBytes.length)));
              }
              audioWavBase64 = btoa(bin);
            } catch (ttsErr) {
              console.warn('[Electron FFmpeg] Could not synthesize TTS WAV:', ttsErr);
            }
          }

          const res = await window.electronAPI.renderSubtitledVideo({
            inputVideoPath: videoUrl,
            assContent,
            audioWavBase64,
            outputPath: `${cleanFileName}.${currentFormat}`,
            videoDuration,
            options: {
              gpuEncoder: isGpuAccelerated ? 'auto' : 'cpu',
              subMode: 'hardsub',
              videoVolume,
              videoAudioEffect: videoAudioEffect || exportSettings?.videoAudioEffect,
              resolution: currentResolution,
              targetWidth,
              targetHeight,
              fps: targetFps,
              bitrate: targetBitrate,
              format: currentFormat,
            },
          });

          if (res.success && res.outputPath) {
            setLastExportedFilePath(res.outputPath);
            setExportSuccessMsg(`Đã xuất video thành công vào: ${res.outputPath}`);
          } else {
            throw new Error(res.error || 'Xuất video qua Native FFmpeg không thành công');
          }
        } finally {
          unsubProgress?.();
        }
      } else if (currentEngine === 'ffmpeg_mobile' && isNativeCapacitor && !isElectron) {
        setExportStatus('Đang khởi chạy FFmpeg Mobile Native Engine...');
        const defaultStyle: SubtitleStyleConfig = styleConfig || {
          fontSize: 20,
          fontColor: '#ffffff',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          padding: 6,
          position: 'bottom',
          bottomOffsetPercentage: 10,
          textOutline: true,
          outlineColor: '#000000',
        };

        const mobileRes = await exportWithCapacitorFFmpeg(
          videoUrl,
          subtitles,
          defaultStyle,
          (p: RenderProgress) => {
            setRenderProgress(p);
            onExportProgress?.(p);
          },
          {
            fileName: cleanFileName,
            format: currentFormat,
            resolution: currentResolution,
            blurOverlays,
            logoOverlays,
            textOverlays,
            includeVoiceover: mergeTtsAudioIntoVideo,
            ttsSpeed,
            ttsPitch,
            videoVolume,
            videoAudioEffect: videoAudioEffect || exportSettings?.videoAudioEffect,
            videoDuration,
            width: targetWidth,
            height: targetHeight,
            fps: targetFps,
            bitrate: targetBitrate,
            gpuAcceleration: isGpuAccelerated,
          }
        );

        const actualExt = mobileRes.formatUsed || currentFormat;
        if (mobileRes.savedPath) {
          setLastExportedFilePath(mobileRes.savedPath);
          setExportSuccessMsg(`Đã xuất & lưu .${actualExt.toUpperCase()} thành công (${mobileRes.engineUsed})!`);
        } else if (mobileRes.blob) {
          const url = URL.createObjectURL(mobileRes.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${cleanFileName}.${actualExt}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          setExportSuccessMsg(`Đã xuất .${actualExt.toUpperCase()} thành công qua ${mobileRes.engineUsed}!`);
        }
      } else {
        // Mediabunny / MediaRecorder Export
        const selectedWebEngine = currentEngine === 'mediarecorder' ? 'mediarecorder' : 'mediabunny';
        setExportStatus(
          selectedWebEngine === 'mediarecorder'
            ? 'Đang render video với HTML5 MediaRecorder...'
            : 'Đang render video với Unified Canvas & Mediabunny WebCodecs...'
        );
        const defaultStyle: SubtitleStyleConfig = styleConfig || {
          fontSize: 20,
          fontColor: '#ffffff',
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          padding: 6,
          position: 'bottom',
          bottomOffsetPercentage: 10,
          textOutline: true,
          outlineColor: '#000000',
        };

        const { blob: renderedBlob, formatUsed } = await renderVideoWithSubtitles(
          videoUrl,
          subtitles,
          defaultStyle,
          (p) => {
            setRenderProgress(p);
            onExportProgress?.(p);
            window.electronAPI?.setProgressBar?.(p.percentage / 100);
          },
          currentFormat,
          {
            engine: selectedWebEngine,
            blurOverlays,
            logoOverlays,
            textOverlays,
            includeVoiceover: mergeTtsAudioIntoVideo,
            ttsSpeed,
            ttsPitch,
            videoVolume,
            videoAudioEffect: videoAudioEffect || exportSettings?.videoAudioEffect,
            videoDuration,
            resolution: currentResolution,
            targetWidth,
            targetHeight,
            fps: targetFps,
            bitrate: targetBitrate,
            gpuAcceleration: isGpuAccelerated,
          }
        );

        const fileExt = formatUsed || 'mp4';
        if (isNativeCapacitor && Capacitor.getPlatform() === 'android') {
          const saved = await saveBlobToAndroidDownloads(
            renderedBlob,
            `${cleanFileName}.${fileExt}`,
            getMimeTypeForFormat(fileExt)
          );
          setLastExportedFilePath(saved.savedPath);
          setExportSuccessMsg(`Đã render và lưu .${fileExt.toUpperCase()} vào thư mục Download!`);
        } else {
          const url = URL.createObjectURL(renderedBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${cleanFileName}.${fileExt}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          setExportSuccessMsg(`Đã render và tải về .${fileExt.toUpperCase()} hoàn tất!`);
        }
      }

      window.electronAPI?.setProgressBar?.(-1);
      window.electronAPI?.showNotification?.({
        title: '🎉 Xuất Dữ Liệu Thành Công',
        body: `Đã hoàn tất xuất video: ${cleanFileName}`,
      });
      setTimeout(() => setExportSuccessMsg(null), 5000);
    } catch (err: any) {
      console.error('Export error:', err);
      window.electronAPI?.setProgressBar?.(-1, { mode: 'error' });
      alert(`Lỗi xuất video: ${err?.message || 'Không thể hoàn tất xuất dữ liệu'}`);
    } finally {
      setIsExporting(false);
      onExportProgress?.(null);
      window.electronAPI?.setProgressBar?.(-1);
      window.electronAPI?.releaseSleep?.();
      setRenderProgress({ percentage: 0, currentTime: 0, duration: 1, status: '' });
      setExportStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#18181d] border border-zinc-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-scale-up max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between bg-[#1f1f26]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-200 border border-zinc-700">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-100 uppercase tracking-wider">
                Trung tâm xuất bản & Dự án chuyên nghiệp
              </h3>
              <p className="text-[10.5px] text-zinc-400">
                Xuất video MP4/WebM hoặc tải file dự án CapCut PC, Premiere Pro & SRT
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/5 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center border-b border-zinc-800 bg-[#15151a] px-3 pt-2">
          <button
            onClick={() => setActiveTab('video')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'video'
                ? 'border-zinc-200 text-white bg-white/5 rounded-t-lg'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Xuất Video</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 font-mono text-zinc-300">
              .{currentFormat}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('project')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'project'
                ? 'border-zinc-200 text-white bg-white/5 rounded-t-lg'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Package className="w-3.5 h-3.5 text-amber-400" />
            <span>Xuất Dự Án (CapCut / Premiere / SRT)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
              Mới
            </span>
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 bg-[#141418]">
          {/* TAB 1: XUẤT VIDEO CHÍNH */}
          {activeTab === 'video' && (
            <>
              {/* 1. Tên tệp xuất */}
              <div className="bg-[#1c1c22] border border-zinc-800/80 rounded-xl p-3.5 space-y-1.5 shadow-sm">
                <label className="text-[11px] font-medium text-zinc-400 block uppercase tracking-wider">
                  Tên tệp xuất video
                </label>
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(e) => setExportFileName(e.target.value)}
                  placeholder="ten_video_xuat"
                  className="w-full bg-[#141418] border border-zinc-800 rounded-lg px-3.5 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600 transition"
                />
              </div>

              {/* 2. Cấu hình tùy chọn xuất đã chọn */}
              <div className="bg-[#1c1c22] border border-zinc-800/80 rounded-xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                      Tùy chọn xuất hiện tại
                    </span>
                  </div>
                  {onOpenExportSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenExportSettings();
                      }}
                      className="text-[11px] font-medium text-zinc-300 hover:text-white hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Chỉnh sửa đầy đủ</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-[#141418] border border-zinc-800/60">
                    <span className="text-[10px] text-zinc-400 block">Engine Xuất:</span>
                    <span className="font-medium text-zinc-200 mt-0.5 block truncate">
                      {engineDisplayNames[currentEngine] || currentEngine}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#141418] border border-zinc-800/60">
                    <span className="text-[10px] text-zinc-400 block">Định dạng:</span>
                    <span className="font-medium text-zinc-200 mt-0.5 block uppercase">
                      .{currentFormat}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#141418] border border-zinc-800/60">
                    <span className="text-[10px] text-zinc-400 block">Độ phân giải:</span>
                    <span className="font-medium text-zinc-200 mt-0.5 block">
                      {currentResolution === 'original' ? 'Độ phân giải gốc' : currentResolution.toUpperCase()}
                      {resolvedDims ? ` (${resolvedDims.width}×${resolvedDims.height})` : ''}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#141418] border border-zinc-800/60">
                    <span className="text-[10px] text-zinc-400 block">Frame rate & Bitrate:</span>
                    <span className="font-medium text-zinc-200 mt-0.5 block truncate">
                      {currentFrameRate === 'original' ? 'Gốc' : `${currentFrameRate} fps`} •{' '}
                      {currentBitrate === 'recommended'
                        ? 'Khuyên dùng'
                        : `${Math.round(Number(currentBitrate) / 1000000)}M`}
                    </span>
                  </div>
                </div>

                {/* GPU Acceleration Option */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#141418] border border-zinc-800/80">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isGpuAccelerated ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400'}`}>
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-200 flex items-center gap-2">
                        <span>Tăng Tốc Phần Cứng (Hardware Encode)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 font-mono">
                          {isNativeCapacitor ? 'MediaCodec' : isElectron ? 'NVENC/QSV' : 'WebCodecs'}
                        </span>
                      </div>
                      <div className="text-[10.5px] text-zinc-400 font-mono mt-0.5">
                        {gpuStatus.description}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleGpuAcceleration(!isGpuAccelerated)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isGpuAccelerated ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isGpuAccelerated ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 3. Lồng tiếng thuyết minh vào video */}
              <div className="p-3.5 rounded-xl bg-[#1c1c22] border border-zinc-800/80 flex items-center justify-between shadow-sm">
                <label className="flex items-center space-x-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mergeTtsAudioIntoVideo}
                    onChange={(e) => setMergeTtsAudioIntoVideo(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-zinc-200 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
                      Lồng tiếng thuyết minh TTS vào video
                    </span>
                    <span className="text-[11px] text-zinc-400 block mt-0.5">
                      Tự động ghép âm thanh đọc phụ đề đã tạo vào video thành phẩm
                    </span>
                  </div>
                </label>
              </div>
            </>
          )}

          {/* TAB 2: XUẤT DỰ ÁN CAPCUT / PREMIERE PRO / SUBTITLES */}
          {activeTab === 'project' && (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 text-xs text-amber-200 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                  <Package className="w-4 h-4" />
                  <span>Xuất Gói Dự Án Để Hậu Kỳ Tiếp Trên Phần Mềm Chuyên Nghiệp</span>
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  Tải về gói dự án đầy đủ các layer timeline, phụ đề, âm thanh và hiệu ứng để mở tiếp trên CapCut PC, Adobe Premiere Pro, DaVinci Resolve hoặc CapCut Mobile.
                </p>
              </div>

              {projectExportSuccess && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{projectExportSuccess}</span>
                </div>
              )}

              {/* 1. CapCut PC & Mobile Draft Export */}
              <div className="p-4 rounded-xl bg-[#1c1c22] border border-zinc-800 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-100">CapCut Draft Project (.zip)</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-300 rounded">
                        CapCut PC & Mobile
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Tạo thư mục dự án chuẩn CapCut chứa <code className="text-zinc-300">draft_content.json</code>, timeline từng micro-giây, style chữ, viền và âm thanh TTS.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleExportCapCutDraft}
                    disabled={isExportingProject !== null}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#272730] hover:bg-[#333340] border border-zinc-700 text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isExportingProject === 'capcut' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span>Tải Gói Dự Án CapCut (.zip)</span>
                  </button>
                </div>
              </div>

              {/* 2. Adobe Premiere Pro & DaVinci XML Export */}
              <div className="p-4 rounded-xl bg-[#1c1c22] border border-zinc-800 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-100">Adobe Premiere Pro & DaVinci XML (.zip)</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-300 rounded">
                        FCP XML
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Xuất sequence timeline XML chuẩn Final Cut / Premiere Pro đa track (V1: Video, V2: Subtitles, A1: Voiceover).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleExportPremiereXml}
                    disabled={isExportingProject !== null}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#272730] hover:bg-[#333340] border border-zinc-700 text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isExportingProject === 'premiere' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-purple-400" />
                    )}
                    <span>Tải File Sequence XML (.zip)</span>
                  </button>
                </div>
              </div>

              {/* 3. Phụ Đề Rời & Master Bundle */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* File Subtitles */}
                <div className="p-3.5 rounded-xl bg-[#1c1c22] border border-zinc-800 space-y-2">
                  <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-zinc-400" />
                    Tải File Phụ Đề Rời
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDownloadSubtitleOnly('srt')}
                      className="py-1.5 px-2 bg-[#141418] hover:bg-[#22222a] border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 transition text-center cursor-pointer"
                    >
                      .SRT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadSubtitleOnly('ass')}
                      className="py-1.5 px-2 bg-[#141418] hover:bg-[#22222a] border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 transition text-center cursor-pointer"
                    >
                      .ASS
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadSubtitleOnly('vtt')}
                      className="py-1.5 px-2 bg-[#141418] hover:bg-[#22222a] border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 transition text-center cursor-pointer"
                    >
                      .VTT
                    </button>
                  </div>
                </div>

                {/* Master Bundle */}
                <div className="p-3.5 rounded-xl bg-[#1c1c22] border border-zinc-800 flex flex-col justify-between space-y-2">
                  <div>
                    <span className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      Gói Master Trọn Bộ
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-0.5">
                      Gồm CapCut + Premiere + SRT + Kịch bản
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportMasterBundle}
                    disabled={isExportingProject !== null}
                    className="w-full py-2 px-3 rounded-lg bg-[#2b2b3a] hover:bg-[#38384c] border border-cyan-800/60 text-cyan-200 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isExportingProject === 'master' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                    <span>Tải Gói Master Trọn Bộ</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Progress Bar khi đang render video */}
          {isExporting && (
            <div className="p-4 rounded-xl bg-[#1c1c22] border border-cyan-900/50 space-y-3 animate-fade-in shadow-inner">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-100 flex items-center gap-2 truncate pr-2">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                  <span className="truncate">{renderProgress.status || exportStatus || 'Đang xuất video thực tế...'}</span>
                </span>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-[10px] text-zinc-400 font-mono">TIẾN TRÌNH THỰC:</span>
                  <span className="font-mono font-bold text-cyan-400 text-base drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]">
                    {renderProgress.percentage >= 100
                      ? '100%'
                      : `${renderProgress.percentage.toFixed(1)}%`}
                  </span>
                </div>
              </div>

              {/* Real Progress Bar */}
              <div className="w-full bg-[#121216] h-3 rounded-full overflow-hidden border border-zinc-800 p-0.5 shadow-inner">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 rounded-full transition-all duration-150 ease-out shadow-sm shadow-cyan-500/50"
                  style={{ width: `${Math.min(100, Math.max(0.5, renderProgress.percentage))}%` }}
                />
              </div>

              {/* Real Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] font-mono text-zinc-400 pt-0.5">
                <div className="bg-[#141418] p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-[9.5px] text-zinc-400 block font-sans">Thời gian video</span>
                  <span className="text-zinc-200 font-semibold mt-0.5 block">
                    {renderProgress.currentTime.toFixed(1)}s / {Math.max(renderProgress.currentTime, renderProgress.duration).toFixed(1)}s
                  </span>
                </div>
                <div className="bg-[#141418] p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-[9.5px] text-zinc-400 block font-sans">Khung hình thực</span>
                  <span className="text-zinc-200 font-semibold mt-0.5 block">
                    {renderProgress.currentFrame !== undefined
                      ? `${renderProgress.currentFrame} / ${renderProgress.totalFrames || '—'}`
                      : 'Đang dựng'}
                  </span>
                </div>
                <div className="bg-[#141418] p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-[9.5px] text-zinc-400 block font-sans">Tốc độ render</span>
                  <span className="text-emerald-400 font-semibold mt-0.5 block">
                    {renderProgress.fps ? `${renderProgress.fps} FPS` : 'Tối đa GPU'}
                  </span>
                </div>
                <div className="bg-[#141418] p-2 rounded-lg border border-zinc-800/80">
                  <span className="text-[9.5px] text-zinc-400 block font-sans">Ước tính còn lại</span>
                  <span className="text-cyan-300 font-semibold mt-0.5 block">
                    {renderProgress.percentage >= 100
                      ? 'Hoàn tất'
                      : renderProgress.etaSeconds !== undefined
                      ? `~${renderProgress.etaSeconds}s`
                      : 'Đang tính'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Success Message Alert */}
          {exportSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-emerald-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1 truncate">
                <span className="font-semibold block">{exportSuccessMsg}</span>
                {lastExportedFilePath && (
                  <span className="text-[10px] text-emerald-400/80 font-mono block truncate mt-0.5">
                    {lastExportedFilePath}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-zinc-800 bg-[#191920] flex items-center justify-between">
          <div className="text-[11px] text-zinc-400 flex items-center gap-2">
            <span>
              {subtitles.length} câu phụ đề • {mergeTtsAudioIntoVideo ? 'Kèm Voiceover TTS' : 'Chỉ video gốc'}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition cursor-pointer disabled:opacity-50"
            >
              Đóng
            </button>

            {activeTab === 'video' && (
              <button
                onClick={handleStartExport}
                disabled={isExporting}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-white text-zinc-950 transition flex items-center space-x-2 shadow-lg hover:shadow-zinc-500/10 active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                    <span>Đang Xuất...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4" />
                    <span>Bắt Đầu Xuất Video</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
