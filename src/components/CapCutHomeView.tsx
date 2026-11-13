import React, { useState } from 'react';
import {
  Star,
  LayoutGrid,
  Video,
  Languages,
  Download,
  Users,
  Home,
  Settings,
  Plus,
  Play,
  Trash2,
  Clock,
  Sparkles,
  Upload,
  Film,
  FileText,
  HelpCircle,
  Cpu,
  Globe,
  Link as LinkIcon,
  DownloadCloud,
  Check,
  Loader2,
  ShieldCheck,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  ChevronDown,
  FileVideo,
  Crown,
  KeyRound,
  ShieldAlert,
  Facebook,
  Volume2,
  VolumeX,
  Copy,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { Project, GeminiModelOption, AppSettings, VideoClip, TTSProviderOption } from '../types';
import { storeMediaFileDB } from '../utils/idbStorage';
import { ConfigView } from './ConfigView';
import { MultiPlatformDownloaderView } from './MultiPlatformDownloaderView';
import { VIENEU_VOICES } from '../data/vieneuVoices';
import { VieNeuModelDownloadModal } from './VieNeuModelDownloadModal';
import { LicenseState, isWhitelistedAdminMember } from '../utils/licenseManager';
import { resolveApiUrl, isMobileCapacitor, getBackendBaseUrl } from '../utils/apiUrl';

interface CapCutHomeViewProps {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onCreateNewProject: (videoUrl: string, title?: string, roi?: any, videoFile?: File, clips?: VideoClip[]) => void;
  onDeleteProject: (id: string) => void;
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  onOpenHelp: () => void;
  appSettings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  initialTab?: 'home' | 'editor' | 'config' | 'downloader' | 'miniapp';
  licenseState?: LicenseState | null;
  onOpenLicense?: () => void;
}

export const CapCutHomeView: React.FC<CapCutHomeViewProps> = ({
  projects,
  onOpenProject,
  onCreateNewProject,
  onDeleteProject,
  selectedModel,
  onSelectModel,
  onOpenHelp,
  appSettings,
  onSaveSettings,
  initialTab = 'home',
  licenseState,
  onOpenLicense,
}) => {
  const [activeTab, setActiveTab] = useState<'home' | 'editor' | 'config' | 'downloader' | 'miniapp'>(initialTab);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showTtsModal, setShowTtsModal] = useState<boolean>(false);
  const [showCommunityModal, setShowCommunityModal] = useState<boolean>(false);
  const [copiedFbLink, setCopiedFbLink] = useState<boolean>(false);

  // Quick TTS Studio State
  const [ttsText, setTtsText] = useState<string>('Xin chào! Đây là công cụ chuyển đổi văn bản thành giọng nói AI chất lượng cao.');
  const [ttsProvider, setTtsProvider] = useState<TTSProviderOption>(appSettings.ttsProvider || 'capcut_tts');
  const [ttsVoice, setTtsVoice] = useState<string>(appSettings.capcutVoice || 'BV001_streaming');
  const [ttsSpeed, setTtsSpeed] = useState<number>(appSettings.ttsSpeed || 1.0);
  const [ttsPitch, setTtsPitch] = useState<number>(appSettings.ttsPitch || 0);
  const [isTtsGenerating, setIsTtsGenerating] = useState<boolean>(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [isVieNeuModalOpen, setIsVieNeuModalOpen] = useState<boolean>(false);

  const handleGenerateTts = async () => {
    if (!ttsText.trim()) return;
    setIsTtsGenerating(true);
    setTtsError(null);
    try {
      const res = await fetch(resolveApiUrl('/api/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsText.trim(),
          provider: ttsProvider,
          voice: ttsVoice,
          vieneuVoice: ttsVoice,
          speed: ttsSpeed,
          pitch: ttsPitch,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Lỗi khi tạo giọng nói AI');
        }
        if (data.audioUrl) {
          setTtsAudioUrl(data.audioUrl);
        } else if (data.audioBase64) {
          setTtsAudioUrl(`data:audio/mp3;base64,${data.audioBase64}`);
        }
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setTtsAudioUrl(url);
      }
    } catch (err: any) {
      console.error('Error generating quick TTS:', err);
      setTtsError(err.message || 'Không thể tạo âm thanh AI lúc này.');
    } finally {
      setIsTtsGenerating(false);
    }
  };

  const handleCopyFbLink = () => {
    navigator.clipboard.writeText('https://facebook.com/groups/bachmedia');
    setCopiedFbLink(true);
    setTimeout(() => setCopiedFbLink(false), 2000);
  };
  const [importTab, setImportTab] = useState<'file' | 'gendownload' | 'url'>('gendownload');
  const [customUrl, setCustomUrl] = useState<string>('');
  
  // GenDownload Extractor State for Quick Import Modal
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<{
    title: string;
    videoUrl: string;
    directUrl: string;
    platform: string;
    thumbnail?: string;
    author?: string;
  } | null>(null);

  // Multi-video upload & concatenation states
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isConcatenating, setIsConcatenating] = useState<boolean>(false);
  const [concatError, setConcatError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const videoFiles = (Array.from(files) as File[]).filter(f => f.type.startsWith('video/'));
      if (videoFiles.length > 0) {
        setSelectedFiles((prev) => [...prev, ...videoFiles]);
        setConcatError(null);
      } else {
        setConcatError('Chỉ hỗ trợ kéo thả tệp tin video (MP4, WebM, MOV...)');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...Array.from(files)]);
      setConcatError(null);
    }
  };

  const handleMoveFile = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === selectedFiles.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...selectedFiles];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setSelectedFiles(updated);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConcatAndCreateProject = async () => {
    if (selectedFiles.length === 0) return;
    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      const title = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      await onCreateNewProject(url, title, undefined, file);
      setShowImportModal(false);
      setSelectedFiles([]);
      return;
    }

    setIsConcatenating(true);
    setConcatError(null);

    try {
      console.log('[CapCutHomeView] Processing selected files client-side...');
      const projTimestamp = Date.now();
      const clips = await Promise.all(
        selectedFiles.map(async (file, index) => {
          const url = URL.createObjectURL(file);
          const duration = await new Promise<number>((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = url;
            video.onloadedmetadata = () => {
              resolve(video.duration || 0);
            };
            video.onerror = () => {
              resolve(0);
            };
          });

          // Store file in IndexedDB under a custom clip ID
          const clipId = `clip-${projTimestamp}-${index}`;
          const storedUrl = await storeMediaFileDB(clipId, file);

          return {
            id: clipId,
            title: file.name,
            url: storedUrl || url,
            duration: duration || 10,
          };
        })
      );

      // Filter out any invalid clips
      const validClips = clips.filter(c => c.duration > 0);

      if (validClips.length === 0) {
        throw new Error('Không thể tải hoặc đọc thông tin của các tệp video đã chọn.');
      }

      const defaultTitle = selectedFiles
        .slice(0, 3)
        .map((f) => f.name.replace(/\.[^/.]+$/, ''))
        .join(' + ') + (selectedFiles.length > 3 ? '...' : '');

      const mainUrl = validClips[0].url;

      await onCreateNewProject(mainUrl, defaultTitle, undefined, selectedFiles[0], validClips);
      setShowImportModal(false);
      setSelectedFiles([]);
    } catch (err: any) {
      console.error('Error loading video clips:', err);
      setConcatError(err.message || 'Có lỗi xảy ra trong quá trình xử lý video.');
    } finally {
      setIsConcatenating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const title = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      await onCreateNewProject(url, title, undefined, file);
      setShowImportModal(false);
    }
  };

  const handleExtractVideoWithGenDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    setIsExtracting(true);
    setExtractError(null);
    setExtractedData(null);

    try {
      if (isMobileCapacitor() && !getBackendBaseUrl()) {
        throw new Error('Trên app Android APK, vui lòng vào Cài Đặt (Config) và nhập link "Máy Chủ Backend (Render/Cloud)" để bóc tách video bằng yt-dlp.');
      }

      const res = await fetch(resolveApiUrl('/api/download-video'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: customUrl.trim(),
          apiKey: appSettings.genDownloadApiKey,
          apiUrl: appSettings.videoDownloaderApiUrl,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(`Phản hồi máy chủ không hợp lệ: ${rawText.slice(0, 100)}`);
      }

      if (!res.ok || !json || !json.success || !json.data) {
        throw new Error(json?.error || json?.message || 'Không thể bóc tách link video từ đường dẫn đã cung cấp.');
      }

      setExtractedData({
        title: json.data.title || 'Video Tải Từ Link',
        videoUrl: json.data.videoUrl,
        directUrl: json.data.directUrl || json.data.videoUrl,
        platform: json.platform || 'Multi-platform',
        thumbnail: json.data.thumbnail,
        author: json.data.author,
      });
    } catch (err: any) {
      console.error('Error extracting video:', err);
      setExtractError(err.message || 'Lỗi khi kết nối API tải video GenDownload.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConfirmImportExtracted = () => {
    if (extractedData) {
      onCreateNewProject(extractedData.directUrl || extractedData.videoUrl, extractedData.title);
      setShowImportModal(false);
      setExtractedData(null);
      setCustomUrl('');
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim()) {
      onCreateNewProject(customUrl.trim(), 'Video URL từ Internet');
      setCustomUrl('');
      setShowImportModal(false);
    }
  };

  const handlePrimaryEditorClick = () => {
    if (projects.length > 0) {
      onOpenProject(projects[0]);
    } else {
      onCreateNewProject('', 'Dự án mới');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0b0b0d] text-slate-100 flex justify-center font-sans antialiased">
      {/* Smartphone / PC Responsive Container Viewport */}
      <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-[#121215] min-h-[100dvh] flex flex-col relative shadow-2xl border-x border-slate-900/80 transition-all duration-300">
        
        {/* Top Header - BachTranslate Logo + License Badge */}
        <header
          className="px-4 py-3 bg-metallic-panel flex items-center justify-between gap-2 sticky top-0 z-30 border-b border-slate-700/60 shadow-md"
          style={{ paddingTop: 'calc(0.75rem + var(--app-safe-top))' }}
        >
          {/* Logo Left */}
          <div className="flex items-center cursor-pointer min-w-0" onClick={() => setActiveTab('home')}>
            <h1 className="text-lg sm:text-xl font-black tracking-wider text-metallic-silver font-sans truncate">
              BachTranlastor
            </h1>
          </div>

          {/* Admin Control Panel Button (Only visible for Whitelisted Super Admin) */}
          {onOpenLicense && isWhitelistedAdminMember(licenseState) && (
            <button
              onClick={onOpenLicense}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all shadow-md active:scale-95 cursor-pointer bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-slate-950 shadow-amber-500/20 hover:brightness-110 shrink-0 whitespace-nowrap"
              title="Trung Tâm Quản Trị Super Admin & Buff VIP"
            >
              <Crown className="w-3.5 h-3.5 fill-slate-950 shrink-0" />
              <span>👑 ADMIN BUFF VIP</span>
            </button>
          )}
        </header>

        {/* Main Content Area */}
        <main className="flex-1 px-4 py-4 flex flex-col gap-4 overflow-y-auto pb-[calc(6.25rem+var(--app-safe-bottom))]">
          
          {/* VIEW SWITCHER: CONFIG VIEW */}
          {activeTab === 'config' ? (
            <ConfigView
              settings={appSettings}
              onSaveSettings={onSaveSettings}
              onOpenLicense={onOpenLicense}
            />
          ) : activeTab === 'miniapp' ? (
            /* VIEW SWITCHER: DEDICATED DOUYIN / MINI-APP DRAMA DOWNLOADER */
            <MultiPlatformDownloaderView
              initialTab="miniapp"
              onBack={() => setActiveTab('home')}
              onCreateProject={(url, title, roi, file) => {
                onCreateNewProject(url, title, roi, file);
              }}
              appSettings={appSettings}
              onOpenConfig={() => setActiveTab('config')}
            />
          ) : activeTab === 'downloader' ? (
            /* VIEW SWITCHER: MULTI-PLATFORM VIDEO DOWNLOADER (Standard) */
            <MultiPlatformDownloaderView
              initialTab="standard"
              onBack={() => setActiveTab('home')}
              onCreateProject={(url, title, roi, file) => {
                onCreateNewProject(url, title, roi, file);
              }}
              appSettings={appSettings}
              onOpenConfig={() => setActiveTab('config')}
            />
          ) : (
            /* VIEW SWITCHER: HOME DASHBOARD */
            <div className="flex flex-col gap-4">
              
              {/* SECTION 1: BIÊN TẬP VIDEO */}
              <div>
                <div className="flex items-center space-x-2 text-[11px] font-bold text-zinc-300 uppercase tracking-wider mb-2.5 px-0.5">
                  <span className="w-2 h-2 rounded-full bg-[#ff3b30] inline-block shadow-[0_0_8px_rgba(255,59,48,0.8)]" />
                  <span>BIÊN TẬP VIDEO</span>
                </div>

                {/* Big Hero Card */}
                <div className="relative bg-[#18181d] border border-zinc-800/90 rounded-3xl p-5 shadow-2xl overflow-hidden">
                  {/* Glowing Icon Badge */}
                  <div className="w-12 h-12 rounded-2xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff] mb-4 shadow-lg shadow-blue-500/10">
                    <Video className="w-6 h-6 fill-[#2189ff]/20 text-[#2189ff]" />
                  </div>

                  {/* Content */}
                  <h2 className="text-xl font-extrabold text-white mb-1 tracking-tight">
                    Trình biên tập Video
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-5">
                    Biên tập video tích hợp dịch thuật và lồng tiếng.
                  </p>

                  {/* Primary Action Buttons */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setShowImportModal(true)}
                      className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-500/25 cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-white" />
                      <span>TẠO DỰ ÁN MỚI</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrimaryEditorClick}
                      className="w-full py-3.5 px-4 bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 hover:text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 border border-zinc-700/80 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current text-white ml-0.5" />
                      <span>{projects.length > 0 ? 'DỰ ÁN GẦN NHẤT' : 'MỞ TRÌNH BIÊN TẬP'}</span>
                    </button>
                  </div>

                  {/* Watermark Slate Graphic */}
                  <Film className="absolute -right-4 -top-3 w-36 h-36 text-zinc-800/25 pointer-events-none transform -rotate-12" />
                </div>
              </div>

              {/* SECTION 2: CÔNG CỤ KHÁC */}
              <div>
                <div className="flex items-center space-x-2 text-[11px] font-bold text-zinc-300 uppercase tracking-wider mb-2.5 px-0.5">
                  <span className="w-2 h-2 rounded-full bg-[#2189ff] inline-block shadow-[0_0_8px_rgba(33,137,255,0.8)]" />
                  <span>CÔNG CỤ KHÁC</span>
                </div>

                {/* 2x2 Grid Tools */}
                <div className="grid grid-cols-2 gap-3.5">
                  
                  {/* Tool 1: Mini App (Tách riêng Mini App Downloader) */}
                  <div
                    onClick={() => setActiveTab('miniapp')}
                    className="bg-[#18181d] border border-zinc-800/90 hover:border-blue-500/50 rounded-2xl p-4.5 cursor-pointer transition-all duration-200 active:scale-[0.98] flex flex-col justify-between group min-h-[145px] shadow-lg relative overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff] mb-3 group-hover:scale-105 transition-transform">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                        Mini App
                      </h3>
                      <p className="text-[11px] text-zinc-400 leading-snug mt-1">
                        Tải kịch ngắn Douyin, Kuaishou, DramaBox...
                      </p>
                    </div>
                  </div>

                  {/* Tool 2: Tải Video (Tải video đa nền tảng) */}
                  <div
                    onClick={() => setActiveTab('downloader')}
                    className="bg-[#18181d] border border-zinc-800/90 hover:border-blue-500/50 rounded-2xl p-4.5 cursor-pointer transition-all duration-200 active:scale-[0.98] flex flex-col justify-between group min-h-[145px] shadow-lg relative overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff] mb-3 group-hover:scale-105 transition-transform">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                        Tải Video
                      </h3>
                      <p className="text-[11px] text-zinc-400 leading-snug mt-1">
                        Tải từ Douyin, TikTok, YouTube...
                      </p>
                    </div>
                  </div>

                  {/* Tool 3: Text To Speech */}
                  <div
                    onClick={() => setShowTtsModal(true)}
                    className="bg-[#18181d] border border-zinc-800/90 hover:border-blue-500/50 rounded-2xl p-4.5 cursor-pointer transition-all duration-200 active:scale-[0.98] flex flex-col justify-between group min-h-[145px] shadow-lg relative overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff] mb-3 group-hover:scale-105 transition-transform">
                      <Volume2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                        Text To Speech
                      </h3>
                      <p className="text-[11px] text-zinc-400 leading-snug mt-1">
                        Chuyển văn bản thành giọng nói AI
                      </p>
                    </div>
                  </div>

                  {/* Tool 4: Cộng đồng */}
                  <div
                    onClick={() => setShowCommunityModal(true)}
                    className="bg-[#18181d] border border-zinc-800/90 hover:border-blue-500/50 rounded-2xl p-4.5 cursor-pointer transition-all duration-200 active:scale-[0.98] flex flex-col justify-between group min-h-[145px] shadow-lg relative overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff] mb-3 group-hover:scale-105 transition-transform">
                      <Facebook className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                        Cộng đồng
                      </h3>
                      <p className="text-[11px] text-zinc-400 leading-snug mt-1">
                        Group FB hướng dẫn, cập nhật &amp; báo lỗi
                      </p>
                    </div>
                  </div>

                </div>
              </div>

              {/* Saved Projects List */}
              {projects.length > 0 && (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-zinc-300 flex items-center space-x-1.5">
                      <Clock className="w-3.5 h-3.5 text-sky-400" />
                      <span>Dự án gần đây ({projects.length})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowImportModal(true)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-bold flex items-center space-x-1 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm video mới</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {projects.map((proj) => (
                      <div
                        key={proj.id}
                        className="bg-[#18181d] border border-zinc-800/80 hover:border-blue-500/50 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition"
                        onClick={() => onOpenProject(proj)}
                      >
                        <div className="flex items-center space-x-3 min-w-0">
                          <div className="w-12 h-12 bg-zinc-900 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center border border-zinc-800">
                            {proj.thumbnailUrl ? (
                              <img src={proj.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Video className="w-5 h-5 text-zinc-600" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-white truncate">{proj.title}</h4>
                            <p className="text-[10px] text-zinc-400">
                              {proj.subtitles?.length || 0} phụ đề • {Math.round(proj.duration || 0)}s
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProject(proj.id);
                          }}
                          className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition"
                          title="Xóa dự án"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Smartphone / PC Fixed Bottom Dock Navigation */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-metallic-panel/95 backdrop-blur-md border-t border-slate-700/80 px-6 py-2 flex items-center justify-between z-40 shadow-2xl transition-all duration-300"
          style={{ paddingBottom: 'calc(0.5rem + var(--app-safe-bottom))' }}
        >
          {/* Home Tab */}
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center space-y-1 transition ${
              activeTab === 'home' ? 'text-white font-bold drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] tracking-wider uppercase">HOME</span>
          </button>

          {/* Center Floating Editor Action */}
          <button
            onClick={handlePrimaryEditorClick}
            className="flex flex-col items-center justify-center -mt-5 group"
          >
            <div className="w-12 h-12 rounded-full btn-metallic text-slate-950 flex items-center justify-center shadow-lg shadow-white/20 border-4 border-[#121215] transition-transform group-hover:scale-105">
              <Play className="w-5 h-5 fill-slate-950 ml-0.5" />
            </div>
            <span className="text-[10px] tracking-wider uppercase text-slate-200 font-bold mt-0.5">
              EDITOR
            </span>
          </button>

          {/* Config Tab */}
          <button
            onClick={() => setActiveTab('config')}
            className={`flex flex-col items-center justify-center space-y-1 transition ${
              activeTab === 'config' ? 'text-white font-bold drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] tracking-wider uppercase">CONFIG</span>
          </button>
        </nav>

        {/* Import Video Modal */}
        {showImportModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="bg-metallic-panel border-t sm:border border-slate-700/80 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 pb-[calc(1.25rem+var(--app-safe-bottom))] sm:pb-5 flex flex-col gap-4 shadow-2xl">
              
              {/* Modal Title & Close */}
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
                <div className="flex items-center space-x-2">
                  <DownloadCloud className="w-4 h-4 text-slate-300" />
                  <h3 className="text-xs font-black text-metallic-silver uppercase tracking-wider">Tải / Import Video Vào BachTranlastor</h3>
                </div>
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setExtractedData(null);
                    setExtractError(null);
                  }}
                  className="text-slate-400 hover:text-white bg-slate-800 p-1.5 rounded-full text-xs transition border border-slate-700"
                >
                  ✕
                </button>
              </div>

              {/* Import Modal Mode Tabs */}
              <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-700/80 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setImportTab('gendownload');
                    setExtractError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'gendownload'
                      ? 'btn-metallic text-slate-950 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>GenDownload</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImportTab('file');
                    setExtractError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'file'
                      ? 'btn-metallic text-slate-950 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>File Máy</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImportTab('url');
                    setExtractError(null);
                  }}
                  className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
                    importTab === 'url'
                      ? 'bg-sky-500 text-slate-950 font-extrabold shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Link MP4</span>
                </button>
              </div>

              {/* TAB 1: GENDOWNLOAD MULTI-PLATFORM VIDEO DOWNLOADER */}
              {importTab === 'gendownload' && (
                <div className="flex flex-col gap-3">
                  {/* Platform Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                    <span className="bg-slate-800 text-sky-300 font-mono font-bold px-2 py-0.5 rounded-full border border-sky-500/30 flex items-center space-x-1">
                      <ShieldCheck className="w-3 h-3 text-sky-400" />
                      <span>GenDownload API</span>
                    </span>
                    <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800">TikTok</span>
                    <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800">Douyin 抖音</span>
                    <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800">YouTube</span>
                    <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800">Facebook</span>
                    <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded-full border border-slate-800">Bilibili</span>
                  </div>

                  <form onSubmit={handleExtractVideoWithGenDownload} className="flex flex-col gap-2">
                    <label className="text-[11px] text-slate-300 font-semibold flex items-center justify-between">
                      <span>Dán link video từ TikTok / Douyin / YT / FB:</span>
                    </label>
                    <div className="flex space-x-2">
                      <input
                        type="url"
                        required
                        placeholder="https://v.douyin.com/... hoặc TikTok / YouTube link"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                        className="flex-1 bg-[#121215] border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="submit"
                        disabled={isExtracting || !customUrl.trim()}
                        className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-black text-xs px-4 py-2 rounded-xl transition flex items-center space-x-1 shadow-md"
                      >
                        {isExtracting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Đang bóc...</span>
                          </>
                        ) : (
                          <>
                            <DownloadCloud className="w-3.5 h-3.5" />
                            <span>LẤY VIDEO</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Error Notification */}
                  {extractError && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs">
                      {extractError}
                    </div>
                  )}

                  {/* Extracted Video Result Card */}
                  {extractedData && (
                    <div className="bg-[#121215] border border-sky-500/40 rounded-2xl p-3 flex flex-col gap-2 animate-fade-in shadow-xl">
                      <div className="flex items-start space-x-3">
                        {extractedData.thumbnail ? (
                          <img
                            src={extractedData.thumbnail}
                            alt="Preview"
                            className="w-16 h-16 object-cover rounded-xl border border-slate-800 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0">
                            <Film className="w-6 h-6 text-sky-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[9px] bg-sky-500/20 text-sky-300 font-bold px-1.5 py-0.5 rounded border border-sky-500/30 uppercase">
                              {extractedData.platform}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">{extractedData.author}</span>
                          </div>
                          <h4 className="text-xs font-bold text-white line-clamp-2 leading-snug">
                            {extractedData.title}
                          </h4>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleConfirmImportExtracted}
                        className="w-full mt-1 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-extrabold text-xs py-2.5 rounded-xl transition flex items-center justify-center space-x-1.5 shadow-lg shadow-sky-500/20"
                      >
                        <Check className="w-4 h-4" />
                        <span>MỞ DỰ ÁN VỚI VIDEO NÀY</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: LOCAL FILE SELECTOR */}
              {importTab === 'file' && (
                <div className="flex flex-col gap-4">
                  {/* Drag-and-drop container */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                      isDragging
                        ? 'border-sky-400 bg-sky-950/20 scale-[1.01]'
                        : 'border-slate-800 hover:border-slate-600 bg-slate-900/40 hover:bg-slate-900/60'
                    }`}
                  >
                    {/* Metallic shining sheen effect */}
                    <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none opacity-20">
                      <div className="w-full h-full animate-metallic-sheen" />
                    </div>

                    <div className="relative z-10 flex flex-col items-center space-y-4">
                      {/* Animated Metallic Graphic */}
                      <div className="w-14 h-14 rounded-full bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shadow-inner relative transition-transform">
                        <Upload className="w-7 h-7 text-sky-400 animate-pulse" />
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-sm font-extrabold text-metallic-silver uppercase tracking-wider">
                          Tải lên & Ghép nối Video
                        </h3>
                        <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-normal">
                          Kéo thả các tệp tin video vào đây, hoặc nhấn nút bên dưới để chọn từng video / nhiều video cùng lúc.
                        </p>
                      </div>

                      {/* Premium Silver Metallic Button */}
                      <label className="cursor-pointer btn-metallic text-[11px] font-black uppercase tracking-wider px-6 py-2.5 rounded-xl inline-flex items-center space-x-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all">
                        <FileVideo className="w-4 h-4 text-slate-900" />
                        <span>Chọn Video từ thiết bị</span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={handleFileSelect}
                          multiple
                          className="hidden"
                        />
                      </label>

                      <div className="text-[10px] text-slate-500">
                        Hỗ trợ MP4, WebM, MOV • Có thể chọn lần lượt từng video để thêm vào danh sách
                      </div>
                    </div>
                  </div>

                  {/* Selected Video List for Reordering */}
                  {selectedFiles.length > 0 && (
                    <div className="bg-metallic-card border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 max-h-72 overflow-y-auto">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 mb-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                          <span className="text-[11px] font-black text-metallic-silver uppercase tracking-wider">
                            Danh sách Video ghép ({selectedFiles.length})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles([])}
                          className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline font-extrabold uppercase tracking-wide transition-colors"
                        >
                          Xóa tất cả
                        </button>
                      </div>

                      <div className="space-y-2">
                        {selectedFiles.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between bg-[#121316] border border-slate-800/80 p-2.5 rounded-xl text-xs hover:border-slate-700/60 transition duration-150 group"
                          >
                            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                              <span className="text-[10px] bg-slate-800/80 text-slate-300 font-extrabold w-5.5 h-5.5 rounded-lg flex items-center justify-center flex-shrink-0 border border-slate-700/50">
                                {idx + 1}
                              </span>
                              <FileVideo className="w-4.5 h-4.5 text-sky-400 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-slate-200 font-semibold leading-none mb-1">
                                  {file.name}
                                </p>
                                <p className="text-[10px] text-slate-500 leading-none">
                                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1.5 ml-3 flex-shrink-0">
                              <button
                                type="button"
                                disabled={idx === 0 || isConcatenating}
                                onClick={() => handleMoveFile(idx, 'up')}
                                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 disabled:opacity-20 disabled:hover:bg-transparent rounded-lg transition"
                                title="Di chuyển lên"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === selectedFiles.length - 1 || isConcatenating}
                                onClick={() => handleMoveFile(idx, 'down')}
                                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 disabled:opacity-20 disabled:hover:bg-transparent rounded-lg transition"
                                title="Di chuyển xuống"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={isConcatenating}
                                onClick={() => handleRemoveFile(idx)}
                                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition"
                                title="Xóa khỏi danh sách"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add more video button (one-by-one or multi helper) */}
                      <div className="flex gap-2 mt-2">
                        <label className="flex-1 cursor-pointer bg-slate-800/60 hover:bg-slate-800 hover:border-slate-600 border border-slate-700/50 text-slate-300 font-bold text-xs py-2.5 rounded-xl transition text-center flex items-center justify-center space-x-1.5">
                          <Plus className="w-4 h-4 text-sky-400" />
                          <span>Thêm video vào danh sách...</span>
                          <input
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime"
                            onChange={handleFileSelect}
                            multiple
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Action trigger for merging - Premium Gold Metallic Accent */}
                      <button
                        type="button"
                        disabled={isConcatenating}
                        onClick={handleConcatAndCreateProject}
                        className="w-full mt-1 btn-metallic-amber hover:scale-[1.01] active:scale-[0.99] text-slate-950 font-black text-xs py-3 rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-amber-500/10 cursor-pointer"
                      >
                        <Check className="w-4.5 h-4.5 stroke-[3px]" />
                        <span className="tracking-wider uppercase font-black">TIẾN HÀNH GHÉP VIDEO & BẮT ĐẦU DỰ ÁN</span>
                      </button>
                    </div>
                  )}

                  {/* Concatenating Loader */}
                  {isConcatenating && (
                    <div className="bg-metallic-card border border-sky-500/30 rounded-xl p-5 flex flex-col items-center justify-center gap-3.5 text-center shadow-xl">
                      <div className="relative">
                        <Loader2 className="w-10 h-10 text-sky-400 animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-black text-sky-300">FF</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-black text-white uppercase tracking-wider">Đang đồng bộ & ghép nối video...</p>
                        <p className="text-[10px] text-slate-400 max-w-xs mx-auto leading-normal">
                          Hệ thống đang chuẩn hóa độ phân giải, kiểm tra đường truyền âm thanh tĩnh và hợp nhất các video thành một tập tin duy nhất. Vui lòng không đóng tab!
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Error Notification */}
                  {concatError && (
                    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-medium animate-fade-in">
                      {concatError}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: DIRECT MP4 URL */}
              {importTab === 'url' && (
                <form onSubmit={handleUrlSubmit} className="flex flex-col gap-2">
                  <label className="text-xs text-slate-300 font-medium">Dán link trực tiếp file video MP4 / WebM:</label>
                  <div className="flex space-x-2">
                    <input
                      type="url"
                      placeholder="https://example.com/video.mp4"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="flex-1 bg-[#121215] border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="submit"
                      className="bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition"
                    >
                      Mở
                    </button>
                  </div>
                </form>
              )}

            </div>
          </div>
        )}

        {/* TEXT TO SPEECH STUDIO MODAL */}
        {showTtsModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="bg-[#18181d] border-t sm:border border-zinc-800 rounded-t-3xl sm:rounded-3xl w-full max-w-lg p-5 pb-[calc(1.25rem+var(--app-safe-bottom))] sm:pb-5 flex flex-col gap-4 shadow-2xl max-h-[90dvh] overflow-y-auto">
              
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff]">
                    <Volume2 className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Text To Speech AI Studio
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Chuyển đổi văn bản thành giọng đọc truyền cảm
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTtsModal(false)}
                  className="text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 p-1.5 rounded-full text-xs transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Text Area Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                  <span>Nội dung văn bản:</span>
                  <span className="text-[10px] text-zinc-500">{ttsText.length} ký tự</span>
                </label>
                <textarea
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Nhập hoặc dán văn bản cần đọc..."
                  rows={4}
                  className="w-full bg-[#121215] border border-zinc-800 rounded-2xl p-3.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition resize-none leading-relaxed"
                />
              </div>

              {/* Engine & Voice Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-zinc-300 block">
                    Động cơ TTS:
                  </label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => {
                      const p = e.target.value as TTSProviderOption;
                      setTtsProvider(p);
                      if (p === 'vieneu_tts') setTtsVoice('Minh Đức');
                      else if (p === 'capcut_tts') setTtsVoice('BV001_streaming');
                      else if (p === 'edge_tts') setTtsVoice('vi-VN-HoaiMyNeural');
                      else if (p === 'tiktok_tts') setTtsVoice('vi_female_01');
                      else if (p === 'nghi_tts') setTtsVoice('ngochuyennew');
                    }}
                    className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="vieneu_tts">🎙️ VieNeu-TTS v3 Turbo (Offline AI)</option>
                    <option value="capcut_tts">✨ CapCut TTS (K07VN)</option>
                    <option value="nghi_tts">Piper TTS (Sherpa-ONNX)</option>
                    <option value="edge_tts">Microsoft Edge TTS</option>
                    <option value="tiktok_tts">TikTok Voice TTS</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-zinc-300 block">
                      Giọng đọc:
                    </label>
                    {ttsProvider === 'vieneu_tts' && (
                      <button
                        type="button"
                        onClick={() => setIsVieNeuModalOpen(true)}
                        className="text-[10px] text-amber-400 hover:text-amber-300 underline font-medium cursor-pointer"
                      >
                        Tải mô hình
                      </button>
                    )}
                  </div>
                  <select
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                    className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {ttsProvider === 'vieneu_tts' && (
                      <>
                        <optgroup label="🌟 Miền Bắc (Tin tức & Đời thường)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'bac').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} ({v.style})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="✨ Miền Nam (Phóng khoáng & Duyên dáng)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'nam').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} ({v.style})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="🌿 Miền Trung (Huế & Hào sảng)">
                          {VIENEU_VOICES.filter((v) => v.accent === 'trung').map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.gender === 'male' ? '🎙️ [Nam]' : '🌸 [Nữ]'} {v.name} ({v.style})
                            </option>
                          ))}
                        </optgroup>
                      </>
                    )}
                    {ttsProvider === 'capcut_tts' && (
                      <>
                        <option value="BV001_streaming">✨ K07VN (Nữ ngọt ngào)</option>
                        <option value="BV002_streaming">K07VN (Nam truyền cảm)</option>
                        <option value="BV003_streaming">K07VN (Nữ tự sự)</option>
                        <option value="BV004_streaming">K07VN (Nam thời sự)</option>
                      </>
                    )}
                    {ttsProvider === 'edge_tts' && (
                      <>
                        <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ chuẩn)</option>
                        <option value="vi-VN-NamMinhNeural">Nam Minh (Nam trầm)</option>
                        <option value="zh-CN-XiaoxiaoNeural">Xiaoxiao (Tiếng Trung)</option>
                        <option value="en-US-JennyNeural">Jenny (Tiếng Anh)</option>
                      </>
                    )}
                    {ttsProvider === 'tiktok_tts' && (
                      <>
                        <option value="vi_female_01">TikTok Nữ trẻ trung</option>
                        <option value="vi_male_01">TikTok Nam sôi nổi</option>
                      </>
                    )}
                    {ttsProvider === 'nghi_tts' && (
                      <>
                        <option value="ngochuyennew">Ngọc Huyền (Nữ - Review Phim)</option>
                        <option value="lacphi">Lạc Phi (Nam chuẩn)</option>
                        <option value="ngocngan">Nguyễn Ngọc Ngạn (Kể chuyện)</option>
                        <option value="vietthao3886">Việt Thảo (Kể chuyện / Review)</option>
                        <option value="tranthanh3870">Trấn Thành (Hài hước)</option>
                        <option value="duyoryx">Duy Oryx (Nam trầm)</option>
                        <option value="maiphuong">Mai Phương (Nữ nhẹ nhàng)</option>
                        <option value="banmai">Ban Mai (Nữ trong trẻo)</option>
                        <option value="minhquang">Minh Quang (Nam thời sự)</option>
                        <option value="minhkhang">Minh Khang (Nam truyền cảm)</option>
                        <option value="minhthu">Minh Thu (Nữ truyền cảm)</option>
                        <option value="mytam2">Mỹ Tâm (Nữ ấm áp)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {ttsProvider === 'vieneu_tts' && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5 flex items-center justify-between">
                  <div className="text-[11px] text-amber-200">
                    <span className="font-semibold text-amber-300">VieNeu-TTS:</span> Mô hình offline (~147 MB)
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsVieNeuModalOpen(true)}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    <span>Cài đặt mô hình</span>
                  </button>
                </div>
              )}

              {/* Speed & Pitch Controls */}
              <div className="grid grid-cols-2 gap-3 bg-[#121215] p-3 rounded-2xl border border-zinc-800/80">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Tốc độ đọc:</span>
                    <span className="font-mono text-zinc-200">{ttsSpeed.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={ttsSpeed}
                    onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Cao độ (Pitch):</span>
                    <span className="font-mono text-zinc-200">{ttsPitch > 0 ? `+${ttsPitch}` : ttsPitch}Hz</span>
                  </div>
                  <input
                    type="range"
                    min="-20"
                    max="20"
                    step="1"
                    value={ttsPitch}
                    onChange={(e) => setTtsPitch(parseInt(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Error Message */}
              {ttsError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs">
                  {ttsError}
                </div>
              )}

              {/* Audio Result & Player */}
              {ttsAudioUrl && (
                <div className="p-3.5 bg-[#121215] border border-blue-500/30 rounded-2xl space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      <span>Đã tạo âm thanh AI thành công!</span>
                    </span>
                    <a
                      href={ttsAudioUrl}
                      download="tts_audio.mp3"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải file MP3</span>
                    </a>
                  </div>
                  <audio controls src={ttsAudioUrl} autoPlay className="w-full h-8" />
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                disabled={isTtsGenerating || !ttsText.trim()}
                onClick={handleGenerateTts}
                className="w-full py-3.5 px-4 bg-[#2189ff] hover:bg-[#1a78e6] active:scale-[0.98] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-500/20 cursor-pointer disabled:opacity-50"
              >
                {isTtsGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang tổng hợp giọng nói AI...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>TẠO GIỌNG ĐỌC AI &amp; NGHE THỬ</span>
                  </>
                )}
              </button>

            </div>
          </div>
        )}

        {/* COMMUNITY / FACEBOOK GROUP MODAL */}
        {showCommunityModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="bg-[#18181d] border-t sm:border border-zinc-800 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 pb-[calc(1.25rem+var(--app-safe-bottom))] sm:pb-5 flex flex-col gap-4 shadow-2xl">
              
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#0e2a4a] border border-[#1e4e80] flex items-center justify-center text-[#2189ff]">
                    <Facebook className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Cộng Đồng BachTranlastor
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Giao lưu, học hỏi và nhận hỗ trợ kỹ thuật
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCommunityModal(false)}
                  className="text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 p-1.5 rounded-full text-xs transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Information Card */}
              <div className="bg-[#121215] border border-zinc-800/90 rounded-2xl p-4 space-y-2.5 text-xs text-zinc-300 leading-relaxed">
                <p className="font-semibold text-white">
                  Chào mừng bạn đến với cộng đồng người dùng BachTranlastor!
                </p>
                <p className="text-zinc-400 text-[11.5px]">
                  Tham gia nhóm Facebook chính thức để:
                </p>
                <ul className="space-y-1 text-zinc-300 text-[11px] list-disc list-inside">
                  <li>Xem video hướng dẫn sử dụng chi tiết &amp; mẹo biên tập video.</li>
                  <li>Cập nhật các phiên bản, động cơ AI &amp; tính năng mới nhất.</li>
                  <li>Báo lỗi trực tiếp và nhận giải đáp từ đội ngũ phát triển.</li>
                  <li>Chia sẻ kinh nghiệm làm video kịch ngắn, phim ngắn &amp; lồng tiếng AI.</li>
                </ul>
              </div>

              {/* Primary Action Buttons */}
              <div className="flex flex-col gap-2 pt-1">
                <a
                  href="https://facebook.com/groups/bachmedia"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3 px-4 bg-[#1877f2] hover:bg-[#166fe5] active:scale-[0.98] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20 cursor-pointer"
                >
                  <Facebook className="w-4 h-4 fill-white" />
                  <span>THAM GIA GROUP FACEBOOK NGAY</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </a>

                <button
                  type="button"
                  onClick={handleCopyFbLink}
                  className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 font-medium text-xs rounded-xl transition flex items-center justify-center space-x-2 cursor-pointer border border-zinc-700"
                >
                  {copiedFbLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Đã sao chép liên kết Group!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Sao chép liên kết Group FB</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>
        )}

        <VieNeuModelDownloadModal
          isOpen={isVieNeuModalOpen}
          onClose={() => setIsVieNeuModalOpen(false)}
        />
      </div>
    </div>
  );
};
