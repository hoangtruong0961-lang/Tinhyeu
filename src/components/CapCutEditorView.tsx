import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Settings,
  Crown,
  Loader2,
} from 'lucide-react';
import { RenderProgress } from '../utils/videoRenderer';
import { LicenseState, isWhitelistedAdminMember } from '../utils/licenseManager';
import {
  Project,
  CapCutTab,
  GeminiModelOption,
  RegionROI,
  SubtitleItem,
  SubtitleStyleConfig,
  OCRScanProgress,
  AppSettings,
  TTSProviderOption,
  BlurOverlay,
  LogoOverlay,
  TextOverlay,
  VideoClip,
  GlobalMovieContext,
  GlossaryEntity,
  AudioEffectType,
} from '../types';
import { applyAudioEffectChain } from '../utils/audioEffects';
import {
  ensureGoogleFontsLoaded,
  loadAllSavedCustomFonts,
  getUserPreferredFont,
  getUserPreferredStyleConfig,
} from '../utils/fontStorage';
import { cleanTranslatedSubtitleText } from '../utils/subtitleCleaner';
import { normalizeGlobalContext } from '../utils/contextUtils';
import { parseSRT, normalizeSubtitles, resolveOverlapsWithPriority } from '../utils/srtParser';
import { storeMediaFileDB, getMediaFileUrlDB, cacheRemoteVideoToDB, hasMediaFileDB } from '../utils/idbStorage';
import { extractAudioFromVideoBlob, uploadFileInChunks } from '../utils/audioExporter';
import { runClientSideLocalOcrBatch, StreamingOcrPool, hasSubtitleTextCandidate, applyBackgroundFilter } from '../utils/localPaddleOcrEngine';
import { extractFramesWithWebCodecs, extractFramesParallelVideo, isWebCodecsSupported } from '../utils/webcodecsFrameExtractor';
import {
  translateSubtitleChunkWithGeminiWeb,
  screenTtsOverloadWithGeminiWeb,
  optimizeTtsOverloadWithGeminiWeb,
} from '../utils/geminiWebHelper';
import { VideoPlayer } from './VideoPlayer';
import { CapCutTimeline } from './CapCutTimeline';
import { CapCutBottomBar } from './CapCutBottomBar';
import { SubtitleList } from './SubtitleList';
import { ExportModal } from './ExportModal';
import { TopExportSettingsDropdown } from './TopExportSettingsDropdown';
import { TtsErrorModal, TtsErrorInfo } from './TtsErrorModal';
import { VieNeuModelDownloadModal } from './VieNeuModelDownloadModal';
import { diagnoseTtsError } from '../utils/ttsErrorDiagnoser';
import { VieNeuNative } from '../plugins/vieneuPlugin';
import { convertTextToTokenIds } from '../utils/vieneuTextProcessor';
import { Capacitor } from '@capacitor/core';
import { HelpModal } from './HelpModal';
import { ConfigView } from './ConfigView';
import { ExportSettingsConfig } from '../types';

interface CapCutEditorViewProps {
  project: Project;
  onBackToHome: () => void;
  onSaveProject: (updated: Project) => void;
  selectedModel: GeminiModelOption;
  onSelectModel: (model: GeminiModelOption) => void;
  appSettings: AppSettings;
  onSaveSettings: (newSettings: AppSettings) => void;
  onOpenSettings?: () => void;
  licenseState?: LicenseState | null;
  onOpenLicense?: () => void;
}

export const CapCutEditorView: React.FC<CapCutEditorViewProps> = ({
  project,
  onBackToHome,
  onSaveProject,
  selectedModel,
  onSelectModel,
  appSettings,
  onSaveSettings,
  onOpenSettings,
  licenseState,
  onOpenLicense,
}) => {
  const [projectTitle, setProjectTitle] = useState<string>(project.title);
  const [videoUrl, setVideoUrl] = useState<string>(project.videoUrl);
  const [videoDuration, setVideoDuration] = useState<number>(project.duration || 0);

  const [clips, setClips] = useState<VideoClip[]>(() => {
    if (project.clips && project.clips.length > 0) {
      return project.clips;
    }
    return [
      {
        id: project.id,
        title: project.title,
        url: project.videoUrl,
        duration: project.duration || 0,
      }
    ];
  });
  const [activeClipIndex, setActiveClipIndex] = useState<number>(0);

  const clipStartTimes = React.useMemo(() => {
    const starts: number[] = [];
    let accum = 0;
    for (const c of clips) {
      starts.push(accum);
      accum += c.duration;
    }
    return starts;
  }, [clips]);

  const totalDuration = React.useMemo(() => {
    return clips.reduce((sum, c) => sum + c.duration, 0);
  }, [clips]);

  useEffect(() => {
    if (totalDuration > 0) {
      setVideoDuration((prev) => (Math.abs(prev - totalDuration) < 0.05 ? prev : totalDuration));
    }
  }, [totalDuration]);

  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  const handleLoadedMetadata = (d: number) => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoDimensions({ width: videoRef.current.videoWidth, height: videoRef.current.videoHeight });
    }
    if (clips && clips.length > 1) {
      setVideoDuration((prev) => (Math.abs(prev - totalDuration) < 0.05 ? prev : totalDuration));
    } else {
      setVideoDuration((prev) => (Math.abs(prev - d) < 0.05 ? prev : d));
      setClips((prev) => {
        if (prev.length <= 1) {
          if (prev[0] && Math.abs((prev[0].duration || 0) - d) < 0.05) {
            return prev;
          }
          return [{ ...prev[0], duration: d }];
        }
        return prev;
      });
    }
  };

  // Detect and track exact intrinsic resolution of the current video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const checkDim = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    checkDim();
    video.addEventListener('loadedmetadata', checkDim);
    video.addEventListener('canplay', checkDim);
    return () => {
      video.removeEventListener('loadedmetadata', checkDim);
      video.removeEventListener('canplay', checkDim);
    };
  }, [videoUrl]);

  const getResolutionBadge = () => {
    if (!videoDimensions || !videoDimensions.width || !videoDimensions.height) {
      return videoUrl ? 'HD' : '--';
    }
    const { width, height } = videoDimensions;
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);

    if (minDim >= 2160 || maxDim >= 3840) return '4K';
    if (minDim >= 1440 || maxDim >= 2560) return '2K';
    if (minDim >= 1080 || maxDim >= 1920) return '1080P';
    if (minDim >= 720 || maxDim >= 1280) return '720P';
    if (minDim >= 480 || maxDim >= 854) return '480P';
    if (minDim >= 360) return '360P';
    return `${minDim}P`;
  };

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);

  // Active Bottom Bar Tab (null by default so timeline & video stay big)
  const [activeTab, setActiveTab] = useState<CapCutTab | null>(null);
  const [extractSubTab, setExtractSubTab] = useState<'image' | 'audio'>('image');
  const [activeBottomBarSheet, setActiveBottomBarSheet] = useState<string | null>(null);

  const isFullToolSheetActive = Boolean(
    (activeTab && activeTab !== 'config' && activeTab !== 'style') ||
    (activeBottomBarSheet && activeBottomBarSheet !== 'config' && activeBottomBarSheet !== 'text_overlay_config')
  );

  // ROI Box
  const [roi, setRoi] = useState<RegionROI>(project.roi || { x: 10, y: 76, width: 80, height: 20 });

  // Subtitles
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>(project.subtitles || []);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);

  const selectedSubtitle = subtitles.find((s) => s.id === selectedSubtitleId) || null;

  // Audio track selection (independent from subtitles)
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const selectedAudio = subtitles.find((s) => s.id === selectedAudioId) || null;

  // Overlays (Blur, Logo, Text)
  const [blurOverlays, setBlurOverlays] = useState<BlurOverlay[]>(project.blurOverlays || []);
  const [showBlurVirtualBorder, setShowBlurVirtualBorder] = useState<boolean>(true);
  const [selectedBlurOverlayId, setSelectedBlurOverlayId] = useState<string | null>(null);
  const [logoOverlays, setLogoOverlays] = useState<LogoOverlay[]>(project.logoOverlays || []);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>(project.textOverlays || []);
  const [selectedTextOverlayId, setSelectedTextOverlayId] = useState<string | null>(null);
  const [triggerTextOverlayAction, setTriggerTextOverlayAction] = useState<{ id: string; action: 'edit' | 'config' } | null>(null);

  // History state for Undo/Redo of subtitles
  const [history, setHistory] = useState<SubtitleItem[][]>(() => [project.subtitles || []]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const isHistoryChangeRef = useRef(false);
  const isFirstRenderRef = useRef(true);
  const onSaveProjectRef = useRef(onSaveProject);
  useEffect(() => {
    onSaveProjectRef.current = onSaveProject;
  }, [onSaveProject]);

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedSnapshotRef = useRef<string>('');

  // Sync with project loaded
  useEffect(() => {
    setBlurOverlays(project.blurOverlays || []);
    setLogoOverlays(project.logoOverlays || []);
    setTextOverlays(project.textOverlays || []);
    setVideoVolume(project.videoVolume ?? 1.0);
    setVideoSpeed(project.videoSpeed ?? 1.0);
    setVideoAudioEffect(project.videoAudioEffect || 'none');
    setCustomContext(project.customContext || '');
    setHistory([project.subtitles || []]);
    setHistoryIndex(0);
    lastSavedSnapshotRef.current = JSON.stringify({
      title: project.title,
      videoUrl: project.videoUrl,
      duration: project.duration || 0,
      subtitles: project.subtitles || [],
      roi: project.roi || { x: 10, y: 76, width: 80, height: 20 },
      targetLang: project.targetLang || 'Tiếng Việt',
      styleConfig: project.styleConfig,
      blurOverlays: project.blurOverlays || [],
      logoOverlays: project.logoOverlays || [],
      textOverlays: project.textOverlays || [],
      videoVolume: project.videoVolume ?? 1.0,
      videoSpeed: project.videoSpeed ?? 1.0,
      videoAudioEffect: project.videoAudioEffect || 'none',
      customContext: project.customContext || '',
      globalContext: project.globalContext || null,
      clips: project.clips || [],
    });
  }, [project.id]);

  // Track subtitles changes to update history
  useEffect(() => {
    if (isHistoryChangeRef.current) {
      isHistoryChangeRef.current = false;
      return;
    }
    const currentHead = history[historyIndex];
    if (currentHead && JSON.stringify(currentHead) === JSON.stringify(subtitles)) {
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(subtitles);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [subtitles]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      isHistoryChangeRef.current = true;
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setSubtitles(history[prevIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isHistoryChangeRef.current = true;
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setSubtitles(history[nextIndex]);
    }
  };

  // Target Language
  const [targetLang, setTargetLang] = useState<string>(project.targetLang || 'Tiếng Việt');

  // TTS Audition Error Diagnostics & VieNeu Modal State
  const [ttsErrorInfo, setTtsErrorInfo] = useState<TtsErrorInfo | null>(null);
  const [isTtsErrorModalOpen, setIsTtsErrorModalOpen] = useState(false);
  const [isVieNeuModalOpen, setIsVieNeuModalOpen] = useState(false);
  const [lastTtsRetryParams, setLastTtsRetryParams] = useState<{
    text: string;
    speed?: number;
    pitch?: number;
    providerOverride?: TTSProviderOption;
    voiceOverride?: string;
  } | null>(null);

  // Style Config with persisted user font preferences
  const [styleConfig, setStyleConfig] = useState<SubtitleStyleConfig>(() => {
    const savedPrefStyle = getUserPreferredStyleConfig();
    const savedPrefFont = getUserPreferredFont();

    const base: SubtitleStyleConfig = project.styleConfig || {
      fontSize: 22,
      fontColor: '#121212',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      bgOpacity: 65,
      padding: 6,
      position: 'bottom',
      bottomOffsetPercentage: 12,
      maskOriginalSubtitles: false,
      maskColor: 'rgba(0,0,0,0.35)',
      textOutline: true,
      outlineColor: '#ffffff',
      outlineWidth: 3,
      hasSecondaryOutline: false,
      secondaryOutlineColor: '#000000',
      secondaryOutlineWidth: 4,
      fontFamily: savedPrefFont?.fontFamily || 'system-ui, sans-serif',
      orientation: 'horizontal',
      maxCharsHorizontal: 65,
      maxCharsVertical: 36,
      hasBackground: false,
      ...savedPrefStyle,
    };

    return {
      ...base,
      fontFamily: base.fontFamily || savedPrefFont?.fontFamily || 'system-ui, sans-serif',
      maskOriginalSubtitles: base.maskOriginalSubtitles === true,
      hasBackground: base.hasBackground === true,
      hasSecondaryOutline:
        base.hasSecondaryOutline === true ||
        (typeof base.secondaryOutlineWidth === 'number' &&
          base.secondaryOutlineWidth > 0 &&
          base.hasSecondaryOutline !== false),
    };
  });

  // Preload web fonts and custom fonts on mount
  useEffect(() => {
    ensureGoogleFontsLoaded();
    loadAllSavedCustomFonts().catch(() => {});
  }, []);

  // Scan progress
  const [scanProgress, setScanProgress] = useState<OCRScanProgress>({
    status: 'idle',
    currentFrame: 0,
    totalFrames: 0,
    currentTime: 0,
    totalTime: 0,
    message: '',
    percentage: 0,
  });

  const [isExtractingSingle, setIsExtractingSingle] = useState<boolean>(false);
  const [isDetectingRoi, setIsDetectingRoi] = useState<boolean>(false);
  const [isTranslatingBatch, setIsTranslatingBatch] = useState<boolean>(false);
  const [translationProgressMsg, setTranslationProgressMsg] = useState<string>('');

  // Video Block Selection State for context-sensitive bottom bar
  const [isVideoSelected, setIsVideoSelected] = useState<boolean>(false);
  const [bgMusicTitle, setBgMusicTitle] = useState<string | null>(null);
  const [videoVolume, setVideoVolume] = useState<number>(project.videoVolume ?? 1.0);
  const [videoSpeed, setVideoSpeed] = useState<number>(project.videoSpeed ?? 1.0);
  const [videoAudioEffect, setVideoAudioEffect] = useState<AudioEffectType>(project.videoAudioEffect || 'none');
  const [customContext, setCustomContext] = useState<string>(project.customContext || '');
  const [globalContext, setGlobalContext] = useState<GlobalMovieContext | null>(normalizeGlobalContext(project.globalContext) || null);

  // CapCut STT (Speech-to-Text) state & refs
  const [isSttRunning, setIsSttRunning] = useState<boolean>(false);
  const [sttProgress, setSttProgress] = useState<{
    status: 'idle' | 'extracting' | 'uploading' | 'recognizing' | 'translating' | 'completed' | 'error';
    percentage: number;
    message: string;
  }>({
    status: 'idle',
    percentage: 0,
    message: '',
  });
  const sttAbortControllerRef = useRef<AbortController | null>(null);

  // Audio / TTS state & refs
  const [isGeneratingAllAudio, setIsGeneratingAllAudio] = useState<boolean>(false);
  const [isGeneratingSingleAudio, setIsGeneratingSingleAudio] = useState<string | null>(null);
  const [audioGenProgress, setAudioGenProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [audioPlayWithVideo, setAudioPlayWithVideo] = useState<boolean>(true);
  const activeAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastPlayedSubIdRef = useRef<string | null>(null);
  const ttsPipelineIdRef = useRef<number>(0);
  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const prevTimeRef = useRef<number>(0);

  // App settings ref for real-time async callbacks
  const appSettingsRef = useRef<AppSettings>(appSettings);
  useEffect(() => {
    if (
      appSettingsRef.current?.capcutVoice !== appSettings.capcutVoice ||
      appSettingsRef.current?.ttsProvider !== appSettings.ttsProvider ||
      appSettingsRef.current?.edgeVoice !== appSettings.edgeVoice ||
      appSettingsRef.current?.nghiVoice !== appSettings.nghiVoice ||
      appSettingsRef.current?.tiktokVoice !== appSettings.tiktokVoice
    ) {
      audioBufferCacheRef.current.clear();
    }
    appSettingsRef.current = appSettings;
  }, [appSettings]);

  // Helper to retrieve or initialize single persistent AudioContext
  const getSharedAudioContext = () => {
    if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      sharedAudioCtxRef.current = new AudioCtx();
    }
    if (sharedAudioCtxRef.current.state === 'suspended') {
      sharedAudioCtxRef.current.resume().catch(() => {});
    }
    return sharedAudioCtxRef.current;
  };

  // Native Video Selectors for "+ Tạo mới" and "Thay thế"
  const newVideoFileInputRef = useRef<HTMLInputElement>(null);
  const replaceVideoFileInputRef = useRef<HTMLInputElement>(null);

  const handleTriggerNewVideo = () => {
    newVideoFileInputRef.current?.click();
  };

  const handleTriggerReplaceVideo = () => {
    replaceVideoFileInputRef.current?.click();
  };

  const handleNewVideoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const title = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      handleImportVideo(url, title, undefined, file, false);
    }
    e.target.value = '';
  };

  const handleReplaceVideoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const title = file.name.replace(/\.[^/.]+$/, '');
      const url = URL.createObjectURL(file);
      handleImportVideo(url, title, undefined, file, true);
    }
    e.target.value = '';
  };

  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<RenderProgress | null>(null);
  const [showExportSettingsDropdown, setShowExportSettingsDropdown] = useState<boolean>(false);

  const isElectronApp = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
  const isNativeCapacitorApp = Capacitor.isNativePlatform();

  const [exportSettings, setExportSettings] = useState<ExportSettingsConfig>(() => {
    try {
      const saved = localStorage.getItem('capcut_export_settings');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return {
      engine: isElectronApp ? 'ffmpeg_native' : (isNativeCapacitorApp ? 'ffmpeg_mobile' : 'mediabunny'),
      format: 'mp4',
      resolution: 'original',
      frameRate: 'original',
      bitrate: 'recommended',
    };
  });

  const handleUpdateExportSettings = (newSettings: ExportSettingsConfig) => {
    setExportSettings(newSettings);
    try {
      localStorage.setItem('capcut_export_settings', JSON.stringify(newSettings));
    } catch {}
  };

  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Stop active audio play sources (Web Audio & SpeechSynthesis)
  const stopAllAudioPlayback = () => {
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop();
        activeAudioSourceRef.current.disconnect();
      } catch {}
      activeAudioSourceRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    lastPlayedSubIdRef.current = null;
  };

  // Sync state when project prop changes
  useEffect(() => {
    stopAllAudioPlayback();
    setProjectTitle(project.title);
    setVideoUrl(project.videoUrl);
    setVideoDuration(project.duration || 0);
    setSubtitles(project.subtitles || []);
    setSelectedSubtitleId(null);
    setRoi(project.roi || { x: 10, y: 76, width: 80, height: 20 });
    setTargetLang(project.targetLang || 'Tiếng Việt');
    if (project.styleConfig) {
      setStyleConfig(project.styleConfig);
    }
  }, [project.id]);

  // Smooth requestAnimationFrame animation loop to update currentTime at 60fps during playback
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;

    const updatePlayhead = () => {
      if (videoRef.current && !videoRef.current.paused) {
        setCurrentTime(videoRef.current.currentTime);
        animationFrameId = requestAnimationFrame(updatePlayhead);
      }
    };

    animationFrameId = requestAnimationFrame(updatePlayhead);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying]);

  const [isLocallyStored, setIsLocallyStored] = useState<boolean>(false);
  const [isCachingVideo, setIsCachingVideo] = useState<boolean>(false);

  // Restore stored video from IndexedDB or cache remote video to prevent expiration (anti-die)
  useEffect(() => {
    let isMounted = true;
    async function checkAndRestoreVideo() {
      const activeClip = clips[activeClipIndex];
      const targetIds = [activeClip?.id, project.id, ...clips.map((c) => c.id)].filter(Boolean) as string[];

      // 1. Check if video already exists in IndexedDB
      const restoredUrl = await getMediaFileUrlDB(project.id, targetIds);
      if (restoredUrl && isMounted) {
        if (restoredUrl !== videoUrl) {
          setVideoUrl(restoredUrl);
          setClips((prev) =>
            prev.map((c, idx) => (idx === activeClipIndex || c.id === project.id ? { ...c, url: restoredUrl } : c))
          );
        }
        setIsLocallyStored(true);
        return;
      }

      // 2. If not in IndexedDB and videoUrl is a remote URL (e.g. TikTok CDN / GenDownload), auto-cache in background
      const targetRemoteUrl = project.videoUrl || videoUrl;
      if (targetRemoteUrl && !targetRemoteUrl.startsWith('blob:') && !targetRemoteUrl.startsWith('data:')) {
        setIsCachingVideo(true);
        cacheRemoteVideoToDB(project.id, targetRemoteUrl, undefined, targetIds)
          .then((cachedUrl) => {
            if (cachedUrl && isMounted) {
              console.log('[Editor] Auto-cached remote video to IndexedDB:', cachedUrl);
              setVideoUrl(cachedUrl);
              setIsLocallyStored(true);
              setClips((prev) =>
                prev.map((c, idx) => (idx === activeClipIndex ? { ...c, url: cachedUrl } : c))
              );
              if (onSaveProjectRef.current) {
                onSaveProjectRef.current({
                  ...project,
                  videoUrl: cachedUrl,
                  clips: clips.map((c, idx) => (idx === activeClipIndex ? { ...c, url: cachedUrl } : c)),
                  updatedAt: Date.now(),
                });
              }
            }
          })
          .finally(() => {
            if (isMounted) setIsCachingVideo(false);
          });
      }
    }
    checkAndRestoreVideo();
    return () => {
      isMounted = false;
    };
  }, [project.id]);

  // Synchronize native video element playback speed and volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = videoVolume;
    }
  }, [videoVolume, videoUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = videoSpeed;
    }
  }, [videoSpeed, videoUrl, isPlaying]);

  const handleImportVideo = async (
    newUrl: string,
    newTitle?: string,
    newRoi?: RegionROI,
    videoFile?: File,
    preserveExistingSubtitles: boolean = false
  ) => {
    stopAllAudioPlayback();
    let finalUrl = newUrl;
    const currentClipId = clips[activeClipIndex]?.id || `clip-${Date.now()}`;
    const aliasIds = [project.id, currentClipId];

    if (videoFile) {
      const storedUrl = await storeMediaFileDB(project.id, videoFile, aliasIds);
      if (storedUrl) {
        finalUrl = storedUrl;
        setIsLocallyStored(true);
      }
    } else if (finalUrl && !finalUrl.startsWith('blob:') && !finalUrl.startsWith('data:')) {
      setIsCachingVideo(true);
      cacheRemoteVideoToDB(project.id, finalUrl, undefined, aliasIds)
        .then((cachedUrl) => {
          if (cachedUrl) {
            setVideoUrl(cachedUrl);
            setIsLocallyStored(true);
            setClips((prev) =>
              prev.map((c, idx) => (idx === activeClipIndex ? { ...c, url: cachedUrl } : c))
            );
            if (onSaveProjectRef.current) {
              onSaveProjectRef.current({
                ...project,
                videoUrl: cachedUrl,
                clips: clips.map((c, idx) => (idx === activeClipIndex ? { ...c, url: cachedUrl } : c)),
                updatedAt: Date.now(),
              });
            }
          }
        })
        .finally(() => {
          setIsCachingVideo(false);
        });
    }

    setVideoUrl(finalUrl);
    if (newTitle) setProjectTitle(newTitle);
    if (newRoi) setRoi(newRoi);
    setVideoDuration(0);
    setCurrentTime(0);

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }

    let updatedClips: VideoClip[] = [];
    // Only clear subtitles and overlays if user is creating a completely new blank project and has no existing subtitles
    const shouldPreserveSubtitles = preserveExistingSubtitles || (subtitles && subtitles.length > 0);
    if (!shouldPreserveSubtitles) {
      setSubtitles([]);
      setSelectedSubtitleId(null);
      updatedClips = [
        {
          id: project.id,
          title: newTitle || 'video.mp4',
          url: finalUrl,
          duration: 0,
        },
      ];
      setClips(updatedClips);
      setActiveClipIndex(0);
      setTextOverlays([]);
      setBlurOverlays([]);
      setLogoOverlays([]);
      setBgMusicTitle(null);
      setSelectedAudioId(null);
      setSelectedTextOverlayId(null);
      setIsVideoSelected(false);
    } else {
      // When replacing or re-linking video, update the current clip URL and preserve all subtitles and overlays
      if (clips && clips.length > 0) {
        updatedClips = clips.map((c, idx) =>
          idx === activeClipIndex ? { ...c, url: finalUrl, title: newTitle || c.title } : c
        );
      } else {
        updatedClips = [
          {
            id: project.id,
            title: newTitle || projectTitle || 'video.mp4',
            url: finalUrl,
            duration: 0,
          },
        ];
      }
      setClips(updatedClips);
    }

    // Immediately persist changes
    if (onSaveProjectRef.current) {
      onSaveProjectRef.current({
        ...project,
        title: newTitle || projectTitle,
        videoUrl: finalUrl,
        clips: updatedClips,
        updatedAt: Date.now(),
      });
    }
  };

  const cancelScanRef = useRef<boolean>(false);

  // Active Subtitle item for current video time or selected subtitle
  const activeSubtitle = React.useMemo(() => {
    const matches = subtitles.filter(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );
    if (matches.length > 0) {
      return matches.sort((a, b) => b.startTime - a.startTime)[0];
    }
    // When paused or stopped, if a subtitle is selected or active, allow editing its box
    if (!isPlaying && selectedSubtitleId) {
      return subtitles.find((s) => s.id === selectedSubtitleId) || null;
    }
    return null;
  }, [subtitles, currentTime, isPlaying, selectedSubtitleId]);

  // Auto-save project changes with debouncing and stable snapshot guard
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    const currentSnapshot = JSON.stringify({
      title: projectTitle,
      videoUrl,
      duration: videoDuration,
      subtitles,
      roi,
      targetLang,
      styleConfig,
      blurOverlays,
      logoOverlays,
      textOverlays,
      videoVolume,
      videoSpeed,
      videoAudioEffect,
      customContext,
      globalContext: globalContext || null,
      clips,
    });

    if (currentSnapshot === lastSavedSnapshotRef.current) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      lastSavedSnapshotRef.current = currentSnapshot;
      if (onSaveProjectRef.current) {
        onSaveProjectRef.current({
          ...project,
          title: projectTitle,
          videoUrl,
          duration: videoDuration,
          subtitles,
          roi,
          targetLang,
          styleConfig,
          blurOverlays,
          logoOverlays,
          textOverlays,
          videoVolume,
          videoSpeed,
          videoAudioEffect,
          customContext,
          globalContext: globalContext || undefined,
          clips,
          updatedAt: Date.now(),
        });
      }
    }, 600);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    projectTitle,
    videoUrl,
    videoDuration,
    subtitles,
    roi,
    targetLang,
    styleConfig,
    blurOverlays,
    logoOverlays,
    textOverlays,
    videoVolume,
    videoSpeed,
    videoAudioEffect,
    customContext,
    globalContext,
    clips,
  ]);

  const handleManualSave = () => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    const currentSnapshot = JSON.stringify({
      title: projectTitle,
      videoUrl,
      duration: videoDuration,
      subtitles,
      roi,
      targetLang,
      styleConfig,
      blurOverlays,
      logoOverlays,
      textOverlays,
      videoVolume,
      videoSpeed,
      videoAudioEffect,
      customContext,
      globalContext: globalContext || null,
      clips,
    });
    lastSavedSnapshotRef.current = currentSnapshot;
    if (onSaveProjectRef.current) {
      onSaveProjectRef.current({
        ...project,
        title: projectTitle,
        videoUrl,
        duration: videoDuration,
        subtitles,
        roi,
        targetLang,
        styleConfig,
        blurOverlays,
        logoOverlays,
        textOverlays,
        videoVolume,
        videoSpeed,
        videoAudioEffect,
        customContext,
        globalContext: globalContext || undefined,
        clips,
        updatedAt: Date.now(),
      });
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  // Helper to map relative 2D box [ymin, xmin, ymax, xmax] from 0-1000 scale to absolute frame percentage
  const calculateAbsoluteBox = (box2d: number[], currentRoi: RegionROI): RegionROI => {
    if (!Array.isArray(box2d) || box2d.length !== 4) return currentRoi;
    const [ymin, xmin, ymax, xmax] = box2d;
    const relY = ymin / 10;
    const relX = xmin / 10;
    const relH = Math.max(3, (ymax - ymin) / 10);
    const relW = Math.max(6, (xmax - xmin) / 10);

    return {
      x: Number(Math.max(0, Math.min(95, currentRoi.x + (relX * currentRoi.width) / 100)).toFixed(2)),
      y: Number(Math.max(0, Math.min(95, currentRoi.y + (relY * currentRoi.height) / 100)).toFixed(2)),
      width: Number(Math.min(100 - currentRoi.x, (relW * currentRoi.width) / 100).toFixed(2)),
      height: Number(Math.min(100 - currentRoi.y, (relH * currentRoi.height) / 100).toFixed(2)),
    };
  };

  // Handler: Auto-detect exact original subtitle position in video frame
  const handleAutoDetectRoi = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    setIsDetectingRoi(true);
    try {
      const canvas = document.createElement('canvas');
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      const cropX = (roi.x / 100) * vWidth;
      const cropY = (roi.y / 100) * vHeight;
      const cropW = (roi.width / 100) * vWidth;
      const cropH = (roi.height / 100) * vHeight;

      canvas.width = Math.max(10, Math.round(cropW));
      canvas.height = Math.max(10, Math.round(cropH));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);

      const res = await fetch('/api/ocr-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: croppedBase64,
          timestamp: currentTime,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success && data.result?.box_2d) {
        const autoBox = calculateAbsoluteBox(data.result.box_2d, roi);
        setRoi(autoBox);

        if (selectedSubtitleId) {
          setSubtitles((prev) =>
            prev.map((s) => (s.id === selectedSubtitleId ? { ...s, boundingBox: autoBox } : s))
          );
        }
      } else {
        alert('Đã khớp vị trí vùng chọn phụ đề.');
      }
    } catch (err) {
      console.error('Auto detect ROI error:', err);
    } finally {
      setIsDetectingRoi(false);
    }
  };

  // Handler: Single frame OCR
  const handleExtractSingleFrame = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    setIsExtractingSingle(true);
    try {
      const canvas = document.createElement('canvas');
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      const cropX = (roi.x / 100) * vWidth;
      const cropY = (roi.y / 100) * vHeight;
      const cropW = (roi.width / 100) * vWidth;
      const cropH = (roi.height / 100) * vHeight;

      const targetW = Math.max(800, Math.round(cropW * 1.5));
      const targetH = Math.max(160, Math.round(cropH * 1.5));

      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);

      const res = await fetch('/api/ocr-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: croppedBase64,
          timestamp: currentTime,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = {};
      }
      if (data.success && data.result?.hasText) {
        let subBox: RegionROI | undefined = undefined;
        if (data.result.box_2d) {
          subBox = calculateAbsoluteBox(data.result.box_2d, roi);
        }

        const newSub: SubtitleItem = {
          id: `single-${Date.now()}`,
          startTime: Math.max(0, currentTime - 0.2),
          endTime: currentTime + 2.5,
          originalText: data.result.originalText || '',
          translatedText: '', // Quét OCR ra phụ đề gốc chưa cần dịch ngay
          sourceLang: data.result.sourceLang,
          boundingBox: subBox || roi,
        };

        setSubtitles((prev) => {
          return normalizeSubtitles([...prev, newSub]);
        });
      } else {
        alert('Không tìm thấy phụ đề trong vùng chọn tại khung hình này.');
      }
    } catch (err: any) {
      console.error('OCR extract error:', err);
    } finally {
      setIsExtractingSingle(false);
    }
  };

  // Helper: Extract cropped frame at timestamp with contrast boost for high OCR accuracy
  const extractCroppedFrameAtTime = async (
    targetTime: number,
    roiBox: RegionROI,
    customVideo?: HTMLVideoElement | null
  ): Promise<{ canvas: HTMLCanvasElement; pixelData?: Uint8ClampedArray; width?: number; height?: number } | null> => {
    return new Promise((resolve) => {
      const video = customVideo || videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        resolve(null);
        return;
      }

      const capture = () => {
        try {
          const canvas = document.createElement('canvas');
          const vWidth = video.videoWidth;
          const vHeight = video.videoHeight;

          const cropX = (roiBox.x / 100) * vWidth;
          const cropY = (roiBox.y / 100) * vHeight;
          const cropW = (roiBox.width / 100) * vWidth;
          const cropH = (roiBox.height / 100) * vHeight;

          // Maintain clean, proportional resolution for OCR tensor input without distorting text aspect ratio
          let scale = 1.0;
          if (cropW > 0 && cropH > 0) {
            if (cropH < 64) {
              scale = 64 / cropH;
            } else if (cropW > 1280) {
              scale = 1280 / cropW;
            }
          }

          const targetW = Math.max(32, Math.round(cropW * scale));
          const targetH = Math.max(32, Math.round(cropH * scale));

          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.filter = 'none';
          ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

          // Apply real background filter to eliminate video background interference & enhance text stroke contrast
          if (appSettings?.bgFilterMode && appSettings.bgFilterMode !== 'none' && (appSettings.bgFilterStrength ?? 0) > 0) {
            applyBackgroundFilter(ctx, targetW, targetH, appSettings.bgFilterMode, appSettings.bgFilterStrength ?? 40);
          }

          const imgData = ctx.getImageData(0, 0, targetW, targetH);

          resolve({
            canvas,
            pixelData: imgData.data,
            width: targetW,
            height: targetH,
          });
        } catch (err) {
          console.error('Error capturing frame:', err);
          resolve(null);
        }
      };

      let relativeTime = targetTime;
      let targetClipIndex = activeClipIndex;

      if (clips && clips.length > 1) {
        for (let i = 0; i < clips.length; i++) {
          const start = clipStartTimes[i];
          const end = start + clips[i].duration;
          if (targetTime >= start && targetTime <= end) {
            targetClipIndex = i;
            relativeTime = targetTime - start;
            break;
          }
        }
      }

      const switchSourceAndSeek = async () => {
        if (clips && clips.length > 1 && clips[targetClipIndex]) {
          const expectedSrc = clips[targetClipIndex].url;
          if (!video.src.includes(expectedSrc) && !video.currentSrc.includes(expectedSrc)) {
            return new Promise<void>((resolveSrc) => {
              const onLoaded = () => {
                video.removeEventListener('loadedmetadata', onLoaded);
                resolveSrc();
              };
              video.addEventListener('loadedmetadata', onLoaded);
              video.src = expectedSrc;
              video.load();
            });
          }
        }
      };

      switchSourceAndSeek().then(() => {
        if (Math.abs(video.currentTime - relativeTime) < 0.02) {
          capture();
          return;
        }

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let seekedFired = false;

        const onSeeked = () => {
          if (seekedFired) return;
          seekedFired = true;
          if (timeoutId) clearTimeout(timeoutId);
          video.removeEventListener('seeked', onSeeked);
          capture();
        };

        timeoutId = setTimeout(() => {
          if (seekedFired) return;
          seekedFired = true;
          video.removeEventListener('seeked', onSeeked);
          capture();
        }, 800);

        video.addEventListener('seeked', onSeeked, { once: true });
        if ('fastSeek' in video && typeof (video as any).fastSeek === 'function') {
          (video as any).fastSeek(relativeTime);
        } else {
          video.currentTime = relativeTime;
        }
      });
    });
  };

  // Full scan handler
  const handleStartFullScan = async (
    startT: number,
    endT: number,
    stepInterval: number,
    customContext: string,
    speedUpMode: boolean = false
  ) => {
    cancelScanRef.current = false;
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    const initialMainVideoTime = video.currentTime;

    const timePoints: number[] = [];
    for (let t = startT; t <= endT; t += stepInterval) {
      timePoints.push(t);
    }

    const totalFrames = timePoints.length;
    setScanProgress({
      status: 'scanning',
      currentFrame: 0,
      totalFrames,
      currentTime: startT,
      totalTime: endT - startT,
      message: speedUpMode
        ? '⚡ Đang khởi tạo bộ bóc tách 1 Sub = 1 Frame siêu tốc trên RAM...'
        : '⚡ Đang khởi tạo 8 luồng GPU bóc tách video song song siêu tốc...',
      percentage: 0,
    });

    const frameBatches: { image: string; pixelData?: Uint8ClampedArray; width?: number; height?: number; timestamp: number }[][] = [];
    let currentBatch: { image: string; pixelData?: Uint8ClampedArray; width?: number; height?: number; timestamp: number }[] = [];
    let capturedFramesCount = 0;
    let filteredNoTextCount = 0;
    const detectedTransitions: number[] = [];

    // Dynamic optimal batch size: 6-10 frames per batch for complete temporal video context
    const targetBatchSize = Math.max(5, Math.min(10, Math.round(2.8 / Math.max(0.15, stepInterval))));

    const videoSourceUrl = video.currentSrc || video.src || videoUrl;

    const effectiveBgFilterMode = appSettings?.bgFilterMode && appSettings.bgFilterMode !== 'none' ? appSettings.bgFilterMode : 'none';
    const effectiveBgFilterStrength = (effectiveBgFilterMode !== 'none' && appSettings?.bgFilterStrength) ? appSettings.bgFilterStrength : 0;
    const isAdaptiveSampling = appSettings?.adaptiveSampling !== false;
    console.log('[OCR-Config] Image Filter Mode:', effectiveBgFilterMode, 'Strength:', effectiveBgFilterStrength, '| Adaptive Frame Sampling:', isAdaptiveSampling ? 'ON' : 'OFF', '| Speed Up (1 Sub/Frame):', speedUpMode ? 'ON' : 'OFF');

    const isLocalPaddle = appSettings?.ocrEngine === 'paddleocr';

    // Initialize Streaming OCR Worker Pool for local PaddleOCR to process frames concurrently during video extraction
    let streamingOcrPool: StreamingOcrPool | null = null;
    const recentFrameTimes: number[] = [];
    if (isLocalPaddle) {
      streamingOcrPool = new StreamingOcrPool({
        stepInterval,
        transitionTimestamps: detectedTransitions,
        minConfidence: appSettings?.confidenceThreshold ?? 0.70,
        sourceLang: 'zh',
        targetLang,
        speedUpMode,
        onProgress: (msg) => {
          const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
          const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
          const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

          const nowMs = performance.now();
          const cutoff = nowMs - 2000;
          while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
            recentFrameTimes.shift();
          }
          const windowDurationSec = recentFrameTimes.length > 1
            ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
            : 2;
          const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

          setScanProgress((prev) => ({
            ...prev,
            message: msg,
            fps: Math.round(currentFps * 10) / 10,
            cpuUsage,
            activeWorkers,
            totalWorkers,
          }));
        },
      });
      await streamingOcrPool.init();
    }

    // True WebCodecs VideoDecoder Extractor with Frame-Diffing transition detection
    await extractFramesWithWebCodecs({
      videoUrl: videoSourceUrl,
      crossOrigin: video.crossOrigin,
      startT,
      endT,
      stepInterval,
      roi,
      bgFilterMode: effectiveBgFilterMode,
      bgFilterStrength: effectiveBgFilterStrength,
      adaptiveSampling: appSettings?.adaptiveSampling ?? true,
      speedUpMode,
      shouldCancel: () => cancelScanRef.current,
      isLocalPaddle,
      onProgress: (current, total, msg) => {
        const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
        const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
        const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

        const nowMs = performance.now();
        const cutoff = nowMs - 2000;
        while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
          recentFrameTimes.shift();
        }
        const windowDurationSec = recentFrameTimes.length > 1
          ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
          : 2;
        const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

        setScanProgress((prev) => ({
          ...prev,
          currentFrame: current,
          totalFrames: Math.max(prev.totalFrames, total, current),
          message: streamingOcrPool && streamingOcrPool.latestProgressMessage
            ? streamingOcrPool.latestProgressMessage
            : msg,
          fps: Math.round(currentFps * 10) / 10,
          cpuUsage,
          activeWorkers,
          totalWorkers,
        }));
      },
      onFrameCaptured: (item) => {
        capturedFramesCount++;
        if (item.isTransitionFrame) {
          detectedTransitions.push(item.timestamp);
        }

        // Optimization: Skip heavy synchronous toDataURL('image/jpeg') Base64 encoding on main UI thread for Local PaddleOCR
        const base64 = isLocalPaddle ? '' : (item.canvas ? item.canvas.toDataURL('image/jpeg', 0.88) : '');
        const frameItem = {
          image: base64 || '',
          pixelData: item.pixelData,
          width: item.width,
          height: item.height,
          timestamp: item.timestamp,
          segStartTime: item.segStartTime,
          segEndTime: item.segEndTime,
        };

        currentBatch.push(frameItem);
        if (currentBatch.length >= targetBatchSize) {
          frameBatches.push([...currentBatch]);
          currentBatch = [];
        }

        if (streamingOcrPool) {
          // Push directly to concurrent ONNX WASM worker pipeline!
          streamingOcrPool.pushFrame(frameItem);
        }

        const scanDuration = Math.max(0.1, endT - startT);
        const timeProgress = Math.min(1.0, Math.max(0.0, (item.timestamp - startT) / scanDuration));
        const scanPercentage = Math.min(60, Math.max(1, Math.round(timeProgress * 60)));

        const nowMs = performance.now();
        recentFrameTimes.push(nowMs);
        const cutoff = nowMs - 2000;
        while (recentFrameTimes.length > 0 && recentFrameTimes[0] < cutoff) {
          recentFrameTimes.shift();
        }
        const windowDurationSec = recentFrameTimes.length > 1
          ? (recentFrameTimes[recentFrameTimes.length - 1] - recentFrameTimes[0]) / 1000
          : 2;
        const currentFps = windowDurationSec > 0.05 ? (recentFrameTimes.length / windowDurationSec) : 0;

        const activeWorkers = streamingOcrPool ? streamingOcrPool.getBusyWorkersCount() : 0;
        const totalWorkers = streamingOcrPool ? streamingOcrPool.getPoolSize() : 0;
        const cpuUsage = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0;

        setScanProgress((prev) => ({
          ...prev,
          currentFrame: capturedFramesCount,
          totalFrames: Math.max(prev.totalFrames, capturedFramesCount),
          currentTime: item.timestamp,
          percentage: scanPercentage,
          fps: Math.round(currentFps * 10) / 10,
          cpuUsage,
          activeWorkers,
          totalWorkers,
          message: streamingOcrPool && streamingOcrPool.latestProgressMessage
            ? streamingOcrPool.latestProgressMessage
            : `⚡ [Song song WebCodecs + 8 Luồng PaddleOCR] (${Math.round(timeProgress * 100)}% | ${item.timestamp.toFixed(1)}s/${endT.toFixed(1)}s)...`,
        }));
      },
    });

    if (currentBatch.length > 0) {
      frameBatches.push([...currentBatch]);
      currentBatch = [];
    }

    // Restore main video player position so user view is not disrupted
    if (video) {
      try {
        video.currentTime = initialMainVideoTime;
      } catch (e) {
        // ignore
      }
    }

    if (cancelScanRef.current) {
      setScanProgress((prev) => ({ ...prev, status: 'idle', message: 'Đã hủy' }));
      return;
    }

    if (capturedFramesCount === 0) {
      setScanProgress({
        status: 'completed',
        currentFrame: totalFrames,
        totalFrames,
        currentTime: endT,
        totalTime: endT - startT,
        message: 'Không thể bóc tách ảnh từ video (do bảo mật CORS của link video ngoài). Vui lòng nạp file video trực tiếp từ máy.',
        percentage: 100,
      });
      return;
    }

    const engineName = isLocalPaddle
      ? 'PP-OCRv6 WebAssembly (ONNX Web)'
      : 'Gemini Cloud AI';

    setScanProgress((prev) => ({
      ...prev,
      status: 'translating',
      percentage: Math.max(prev.percentage, 70),
      message: streamingOcrPool ? prev.message : `Đang hoàn thiện bóc tách chữ bằng ${engineName}...`,
    }));

    const newSubtitles: SubtitleItem[] = [];
    let lastApiError = '';

    if (streamingOcrPool) {
      try {
        const localResults = await streamingOcrPool.finish(detectedTransitions);
        try {
          const rawItems = streamingOcrPool.getRawDetectedItems();
          localStorage.setItem('raw_ocr_results', JSON.stringify(rawItems));
        } catch (e) {
          console.warn('Failed to save raw_ocr_results to localStorage:', e);
        }
        localResults.forEach((res, idx) => {
          if (res.originalText && res.originalText.trim()) {
            newSubtitles.push({
              id: `local-scan-${idx}-${Date.now()}`,
              startTime: res.startTime,
              endTime: res.endTime,
              originalText: res.originalText.trim(),
              translatedText: '',
              sourceLang: res.sourceLang || 'zh',
              boundingBox: roi,
              confidence: res.confidence,
            });
          }
        });
      } catch (err: any) {
        console.warn('Streaming OCR finish error:', err);
      }
    }

    // Fallback: If streaming pool returned 0 items or wasn't initialized, run client-side batch OCR engine!
    if (isLocalPaddle && newSubtitles.length === 0) {
      const allFrames = frameBatches.flat();
      try {
        const localResults = await runClientSideLocalOcrBatch(
          allFrames,
          (msg) => {
            setScanProgress((prev) => ({ ...prev, message: msg }));
          },
          stepInterval,
          detectedTransitions,
          appSettings?.confidenceThreshold ?? 0.70,
          'zh',
          targetLang
        );

        localResults.forEach((res, idx) => {
          if (res.originalText && res.originalText.trim()) {
            newSubtitles.push({
              id: `local-scan-${idx}-${Date.now()}`,
              startTime: res.startTime,
              endTime: res.endTime,
              originalText: res.originalText.trim(),
              translatedText: '',
              sourceLang: res.sourceLang || 'PP-OCRv6 Wasm Local',
              boundingBox: roi,
              confidence: res.confidence,
            });
          }
        });
      } catch (err: any) {
        console.error('Local OCR error:', err);
        lastApiError = 'Lỗi xử lý Local Wasm ONNX Engine.';
      }
    } else if (!isLocalPaddle && newSubtitles.length === 0) {
      for (let b = 0; b < frameBatches.length; b++) {
        if (cancelScanRef.current) break;

        try {
          const res = await fetch('/api/ocr-batch-frames', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              frames: frameBatches[b],
              targetLang,
              model: selectedModel,
              ocrEngine: 'gemini_vision',
              customContext,
              apiMode: appSettings?.apiMode,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
            }),
          });

          const rawText = await res.text().catch(() => '');
          let data: any = {};
          try {
            data = JSON.parse(rawText);
          } catch {
            data = {};
          }

          if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}: ${res.statusText || rawText.slice(0, 100)}`);
          }

          if (data.success && Array.isArray(data.subtitles)) {
            const batchFrames = frameBatches[b];
            const maxBatchTimestamp = batchFrames && batchFrames.length > 0
              ? batchFrames[batchFrames.length - 1].timestamp + Math.max(0.3, stepInterval)
              : endT;

            data.subtitles.forEach((s: any, idx: number) => {
              if (s.originalText && s.originalText.trim()) {
                let subBox: RegionROI | undefined = undefined;
                if (s.box_2d) {
                  subBox = calculateAbsoluteBox(s.box_2d, roi);
                }

                const rawStart = typeof s.startTime === 'number' && !isNaN(s.startTime) ? s.startTime : 0;
                let rawEnd = typeof s.endTime === 'number' && !isNaN(s.endTime) ? s.endTime : rawStart + 1.2;

                // Cap duration so a single subtitle cannot drift into future batches
                if (rawEnd > maxBatchTimestamp) {
                  rawEnd = maxBatchTimestamp;
                }
                if (rawEnd <= rawStart) {
                  rawEnd = Number((rawStart + 0.5).toFixed(2));
                }

                newSubtitles.push({
                  id: `scan-${b}-${idx}-${Date.now()}`,
                  startTime: Number(rawStart.toFixed(2)),
                  endTime: Number(rawEnd.toFixed(2)),
                  originalText: s.originalText.trim(),
                  translatedText: '', // OCR ra phụ đề gốc
                  sourceLang: s.sourceLang,
                  boundingBox: subBox || roi,
                });
              }
            });
          } else if (data.error) {
            lastApiError = data.error;
          }
        } catch (err: any) {
          console.error('Batch scan error:', err);
          lastApiError = err?.message || 'Lỗi kết nối máy chủ API OCR.';
        }

        setScanProgress((prev) => ({
          ...prev,
          percentage: 70 + Math.round(((b + 1) / frameBatches.length) * 28),
        }));

        // Gentle pause to respect API rate limits
        if (b < frameBatches.length - 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    let finalSubtitles = newSubtitles;

    let aiRefineError: string | null = null;
    let aiRefineSucceeded = false;

    // Workflow bước cuối: Gọi AI Sàng lọc phụ đề gốc (tự động chạy để sửa lỗi chính tả & lọc trùng, trừ khi người dùng chủ động TẮT trong Cài đặt)
    if (newSubtitles.length > 0 && appSettings?.autoAiRefine !== false && !cancelScanRef.current) {
      setScanProgress((prev) => ({
        ...prev,
        status: 'translating',
        percentage: 92,
        message: `🤖 Bước cuối: AI (${selectedModel}) đang sửa lỗi chính tả & lọc trùng ${newSubtitles.length} phụ đề...`,
      }));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s safety timeout for Render deployment & large subtitle lists

        const dedupRes = await fetch('/api/deduplicate-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            subtitles: newSubtitles,
            targetLang,
            model: selectedModel,
            apiMode: appSettings?.apiMode,
            apiKey: appSettings?.apiKey,
            groqApiKey: appSettings?.groqApiKey,
            groqModel: appSettings?.groqModel,
            proxyUrl: appSettings?.proxyUrl,
            proxyKey: appSettings?.proxyKey,
            proxyTargetModel: appSettings?.proxyTargetModel,
            customModelName: appSettings?.customModelName,
            proxyNoApiKey: appSettings?.proxyNoApiKey,
          }),
        });

        clearTimeout(timeoutId);

        let dedupData: any = {};
        try {
          dedupData = await dedupRes.json();
        } catch (jsonParseErr) {
          const rawText = await dedupRes.text().catch(() => '');
          dedupData = { error: `Invalid JSON response: ${rawText.slice(0, 300)}` };
        }

        if (dedupRes.ok && dedupData.success && Array.isArray(dedupData.subtitles) && dedupData.subtitles.length > 0) {
          finalSubtitles = dedupData.subtitles.map((s: any, idx: number) => ({
            id: `ai-clean-${idx}-${Date.now()}`,
            startTime: typeof s.startTime === 'number' ? s.startTime : 0,
            endTime: typeof s.endTime === 'number' ? s.endTime : (s.startTime || 0) + 1.2,
            originalText: String(s.originalText || '').trim(),
            translatedText: '', // Phụ đề gốc đã được AI sửa lỗi chính tả & làm sạch, giữ nguyên chưa dịch
            sourceLang: s.sourceLang,
            boundingBox: roi,
          }));
          aiRefineSucceeded = true;
          console.log(`[AI Refine] Succeeded! Refined into ${finalSubtitles.length} clean subtitles.`);
        } else {
          aiRefineError = dedupData.message || dedupData.error || `HTTP ${dedupRes.status} ${dedupRes.statusText}`;
          console.error('[AI Refine Error - F12 DevTools]', {
            status: dedupRes.status,
            statusText: dedupRes.statusText,
            apiMode: appSettings?.apiMode,
            proxyUrl: appSettings?.proxyUrl,
            proxyTargetModel: appSettings?.proxyTargetModel,
            model: selectedModel,
            errorMessage: aiRefineError,
            rawResponse: dedupData,
          });
        }
      } catch (dedupErr: any) {
        if (dedupErr.name === 'AbortError') {
          aiRefineError = 'Quá thời gian chờ phản hồi AI (90s)';
          console.error('[AI Refine Timeout - F12 DevTools] Request timed out after 90s:', dedupErr);
        } else {
          aiRefineError = dedupErr?.message || 'Không thể kết nối đến máy chủ AI';
          console.error('[AI Refine Network/Execution Exception - F12 DevTools]', dedupErr);
        }
      }
    }

    if (finalSubtitles.length > 0) {
      setSubtitles((prev) => {
        // Replace existing subtitles in the scanned interval [startT, endT]
        const remainingOld = prev.filter(
          (s) => s.endTime <= startT || s.startTime >= endT
        );
        return normalizeSubtitles([...remainingOld, ...finalSubtitles]);
      });
    }

    let completionMessage = '';
    if (finalSubtitles.length > 0) {
      if (appSettings?.autoAiRefine !== false) {
        if (aiRefineSucceeded) {
          completionMessage = `✨ Hoàn thành! AI đã bóc tách & tinh lọc thành công ${finalSubtitles.length} phụ đề chuẩn.`;
        } else if (aiRefineError) {
          completionMessage = `Đã bóc tách được ${finalSubtitles.length} phụ đề bằng PaddleOCR. ⚠️ Bước AI Lọc trùng bị bỏ qua do: ${aiRefineError} (Vui lòng kiểm tra API Key trong Cài đặt hoặc biến GEMINI_API_KEY trên Render).`;
        } else {
          completionMessage = `Đã hoàn thành! Đã bóc tách thành công ${finalSubtitles.length} phụ đề.`;
        }
      } else {
        completionMessage = `Đã hoàn thành! Đã bóc tách ${finalSubtitles.length} phụ đề bằng PaddleOCR Cục bộ (0 tốn Quota).`;
      }
    } else if (lastApiError) {
      completionMessage = lastApiError;
    } else {
      completionMessage = `AI không tìm thấy chữ trong vùng quét OCR (${capturedFramesCount} khung hình). Bạn hãy điều chỉnh/mở rộng khung quét OCR màu xanh đè trọn vùng chữ phụ đề trên video và quét lại.`;
    }

    setScanProgress({
      status: 'completed',
      currentFrame: totalFrames,
      totalFrames,
      currentTime: endT,
      totalTime: endT - startT,
      message: completionMessage,
      percentage: 100,
    });

    setTimeout(() => {
      setScanProgress((prev) => ({ ...prev, status: 'idle' }));
    }, 3000);
  };

  const handleCancelScan = () => {
    cancelScanRef.current = true;
    setScanProgress((prev) => ({ ...prev, status: 'idle', message: 'Đã hủy' }));
  };

  const handleCancelStt = () => {
    if (sttAbortControllerRef.current) {
      sttAbortControllerRef.current.abort();
      sttAbortControllerRef.current = null;
    }
    setIsSttRunning(false);
    setSttProgress({
      status: 'idle',
      percentage: 0,
      message: 'Đã hủy nhận diện giọng nói STT',
    });
  };

  const handleStartCapCutStt = async (options: {
    language: string;
    autoTranslateToVietnamese: boolean;
    range: 'full' | 'range';
    startTime: number;
    endTime: number;
    mode: 'replace' | 'append';
  }) => {
    if (isSttRunning) return;
    if (!project.videoUrl) {
      alert('Vui lòng tải hoặc chọn một video trước khi thực hiện nhận diện STT');
      return;
    }

    setIsSttRunning(true);
    setSttProgress({
      status: 'extracting',
      percentage: 10,
      message: 'Đang trích xuất luồng âm thanh từ video...',
    });

    const abortController = new AbortController();
    sttAbortControllerRef.current = abortController;

    try {
      const formData = new FormData();
      formData.append('language', options.language || 'zh-CN');
      formData.append('autoTranslateToVietnamese', String(options.autoTranslateToVietnamese));
      formData.append('translationLanguage', 'vi-VN');
      const startT = options.range === 'range' ? options.startTime : 0;
      const endT = options.range === 'range' ? options.endTime : (videoDuration || project.duration || 0);
      formData.append('startTimeSeconds', String(startT));
      formData.append('endTimeSeconds', String(endT));

      // Append API configuration for auto-translation if present
      if (appSettings) {
        if (appSettings.groqApiKey) formData.append('groqApiKey', appSettings.groqApiKey);
        if (appSettings.groqModel) formData.append('groqModel', appSettings.groqModel);
        if (appSettings.groqSttModel) formData.append('groqSttModel', appSettings.groqSttModel);
        if (appSettings.apiKey) formData.append('apiKey', appSettings.apiKey);
        if (appSettings.selectedModel) formData.append('selectedModel', appSettings.selectedModel);
        if (appSettings.apiMode) formData.append('apiMode', appSettings.apiMode);
        if (appSettings.proxyUrl) formData.append('proxyUrl', appSettings.proxyUrl);
        if (appSettings.proxyKey) formData.append('proxyKey', appSettings.proxyKey);
        if (appSettings.proxyTargetModel) formData.append('proxyTargetModel', appSettings.proxyTargetModel);
        if (appSettings.customModelName) formData.append('customModelName', appSettings.customModelName);
      }

      // 1. First, attempt ultra-fast browser client-side audio extraction (16kHz mono WAV)
      // This reduces payload from 100MB+ video down to 1-3MB audio, completely eliminating HTTP 413.
      try {
        setSttProgress({
          status: 'extracting',
          percentage: 15,
          message: 'Đang trích xuất âm thanh 16kHz siêu nhẹ từ video...',
        });

        const extraction = await extractAudioFromVideoBlob(
          project.videoUrl,
          startT,
          endT,
          (msg) => setSttProgress((prev) => ({ ...prev, message: msg }))
        );

        formData.append('file', extraction.audioBlob, 'extracted_audio.wav');
        formData.append('clientPreSliced', 'true');
      } catch (extractErr) {
        console.warn('[STT] Client-side audio extraction failed, falling back to chunked video upload...', extractErr);

        // 2. Fallback: If client audio extraction fails, fetch video blob and upload in small chunks (5MB each)
        // Never sends entire video in one POST request, avoiding HTTP 413 on any reverse proxy / Cloud Run.
        setSttProgress({
          status: 'uploading',
          percentage: 20,
          message: 'Đang tải lên video theo phân đoạn an toàn (chống lỗi 413)...',
        });

        const videoFetchRes = await fetch(project.videoUrl, { signal: abortController.signal });
        const videoBlob = await videoFetchRes.blob();

        if (videoBlob.size > 20 * 1024 * 1024) {
          // File is large (>20MB) -> chunked upload
          const uploadRes = await uploadFileInChunks(
            videoBlob,
            'project_video.mp4',
            5 * 1024 * 1024,
            (pct, msg) => {
              setSttProgress({
                status: 'uploading',
                percentage: Math.round(20 + pct * 0.25),
                message: msg,
              });
            },
            abortController.signal
          );
          formData.append('serverTempFilePath', uploadRes.serverTempFilePath);
        } else {
          // File is small (<=20MB) -> safe to send directly
          formData.append('file', videoBlob, 'video_input.mp4');
        }
      }

      setSttProgress({
        status: 'recognizing',
        percentage: 50,
        message: 'Groq AI Whisper đang nhận diện giọng nói siêu tốc...',
      });

      const response = await fetch('/api/groq-stt', {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Máy chủ phản hồi mã lỗi ${response.status}`);
      }

      setSttProgress({
        status: 'translating',
        percentage: 85,
        message: 'Đang hoàn tất và đồng bộ danh sách phụ đề...',
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Nhận diện giọng nói thất bại');
      }

      const receivedSubs: SubtitleItem[] = (data.subtitles || []).map((item: any, idx: number) => ({
        id: `sub_stt_${Date.now()}_${idx}`,
        startTime: Number(item.startTime) || 0,
        endTime: Number(item.endTime) || (Number(item.startTime) + 2),
        originalText: item.originalText || item.sourceText || '',
        translatedText: item.vietnamese || item.translatedText || item.originalText || item.sourceText || '',
        sourceLang: options.language,
        confidence: item.confidence || 0.95,
        boundingBox: { x: 10, y: 78, width: 80, height: 16 },
      }));

      if (receivedSubs.length === 0) {
        setSttProgress({
          status: 'completed',
          percentage: 100,
          message: 'Không phát hiện được câu thoại nào trong đoạn âm thanh được chọn.',
        });
      } else {
        setSubtitles((prev) => {
          if (options.mode === 'replace') {
            if (options.range === 'range') {
              const remainingOld = prev.filter(
                (s) => s.endTime <= startT || s.startTime >= endT
              );
              return normalizeSubtitles([...remainingOld, ...receivedSubs]);
            } else {
              return normalizeSubtitles(receivedSubs);
            }
          } else {
            return normalizeSubtitles([...prev, ...receivedSubs]);
          }
        });

        setSttProgress({
          status: 'completed',
          percentage: 100,
          message: `✨ Thành công! Đã nhận diện ${receivedSubs.length} câu phụ đề bằng Groq AI Whisper.`,
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[STT] Operation cancelled by user');
      } else {
        console.error('[STT Error]', err);
        setSttProgress({
          status: 'error',
          percentage: 0,
          message: `Lỗi: ${err?.message || 'Không thể nhận diện giọng nói'}`,
        });
      }
    } finally {
      setIsSttRunning(false);
      sttAbortControllerRef.current = null;
    }
  };

  const handleReScanSubtitle = async (sub: SubtitleItem) => {
    if (!sub) return;
    const interval = appSettings?.ocrInterval || 0.3;
    handleSeek(sub.startTime);
    await handleStartFullScan(sub.startTime, sub.endTime, interval, '');
  };

  const handleAiDeduplicateSubtitles = async () => {
    if (subtitles.length === 0) return;
    setIsTranslatingBatch(true);
    try {
      const res = await fetch('/api/deduplicate-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitles,
          targetLang,
          model: selectedModel,
          apiMode: appSettings?.apiMode,
          apiKey: appSettings?.apiKey,
          proxyUrl: appSettings?.proxyUrl,
          proxyKey: appSettings?.proxyKey,
          proxyTargetModel: appSettings?.proxyTargetModel,
          customModelName: appSettings?.customModelName,
          proxyNoApiKey: appSettings?.proxyNoApiKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP Error ${res.status}`);
      }

      if (data.success && Array.isArray(data.subtitles) && data.subtitles.length > 0) {
        const cleanedSubs: SubtitleItem[] = data.subtitles.map((s: any, idx: number) => ({
          id: `ai-clean-${idx}-${Date.now()}`,
          startTime: typeof s.startTime === 'number' ? s.startTime : 0,
          endTime: typeof s.endTime === 'number' ? s.endTime : (s.startTime || 0) + 1.2,
          originalText: String(s.originalText || '').trim(),
          translatedText: String(s.translatedText || '').trim(),
          sourceLang: s.sourceLang,
          boundingBox: s.boundingBox || roi,
        }));

        setSubtitles(normalizeSubtitles(cleanedSubs));
        alert(`✨ AI đã hoàn thành sàng lọc phụ đề:\n- Sửa lỗi chính tả OCR\n- Loại bỏ rác & thủy ấn\n- Gộp câu lặp trùng, còn lại ${cleanedSubs.length} phụ đề.`);
      } else {
        alert(data.error || 'AI không trả về dữ liệu phụ đề hợp lệ.');
      }
    } catch (err: any) {
      console.error('AI deduplicate error:', err);
      alert('Không thể thực hiện AI lọc trùng: ' + (err?.message || 'Lỗi hệ thống'));
    } finally {
      setIsTranslatingBatch(false);
    }
  };

  const handleReTranslateAll = async (
    overrideModel?: GeminiModelOption,
    optimizeForTts: boolean = false,
    customCtx?: string
  ) => {
    if (subtitles.length === 0) return;
    const effectiveContext = customCtx !== undefined ? customCtx : customContext;
    if (customCtx !== undefined && customCtx !== customContext) {
      setCustomContext(customCtx);
    }

    setIsTranslatingBatch(true);
    
    try {
      // =========================================================================
      // BƯỚC 1: ĐỒNG BỘ VÀ RÀ SOÁT NGỮ CẢNH TOÀN CỤC TRƯỚC KHI DỊCH
      // Trích xuất ngữ cảnh, thể loại, đại từ, và đồng bộ nhân vật, địa danh, thế lực...
      // =========================================================================
      setTranslationProgressMsg('🧠 Bước 1/3: Rà soát ngữ cảnh & đồng bộ dịch trước nhân vật, địa danh, thế lực...');
      console.log(`[handleReTranslateAll] Stage 1: Extracting global context from ${subtitles.length} subtitles...`);

      let activeGlobalContext: GlobalMovieContext = globalContext || {
        movieGenre: 'Tự động',
        eraAndSetting: 'Tự nhiên',
        characterPronounGuide: 'Xưng hô tự nhiên theo ngữ cảnh từng câu.',
        summary: '',
        knownEntityGlossary: [],
      };

      try {
        const ctxRes = await fetch('/api/extract-global-context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subtitles,
            targetLang,
            model: overrideModel || selectedModel,
            customContext: effectiveContext,
            apiMode: appSettings?.apiMode,
            apiKey: appSettings?.apiKey,
            proxyUrl: appSettings?.proxyUrl,
            proxyKey: appSettings?.proxyKey,
            proxyTargetModel: appSettings?.proxyTargetModel,
            customModelName: appSettings?.customModelName,
            proxyNoApiKey: appSettings?.proxyNoApiKey,
          }),
        });

        const rawCtxText = await ctxRes.text().catch(() => '');
        let ctxData: any = {};
        try {
          ctxData = JSON.parse(rawCtxText);
        } catch {
          console.warn('[handleReTranslateAll] Global context parse warning:', rawCtxText.slice(0, 100));
        }

        if (ctxRes.ok && ctxData.success && ctxData.globalContext) {
          const normalized = normalizeGlobalContext(ctxData.globalContext);
          if (normalized) {
            activeGlobalContext = normalized;
            setGlobalContext(activeGlobalContext);
            console.log('[handleReTranslateAll] Stage 1 Global Context Extracted:', activeGlobalContext);
          }
        }
      } catch (ctxErr) {
        console.warn('[handleReTranslateAll] Global context extraction fallback:', ctxErr);
      }

      // =========================================================================
      // BƯỚC 2: DỊCH CHÍNH TOÀN BỘ PHỤ ĐỀ — ÁP DỤNG NGAY CÁC THỰC THỂ ĐÃ ĐỒNG BỘ
      // Dịch mượt mà, đầy đủ 100% ngữ nghĩa & cảm xúc điện ảnh, không cắt xén
      // =========================================================================
      const chunkSize = 20;
      const totalSubtitles = subtitles.length;
      const chunks: SubtitleItem[][] = [];
      
      for (let i = 0; i < totalSubtitles; i += chunkSize) {
        chunks.push(subtitles.slice(i, i + chunkSize));
      }
      
      const totalChunks = chunks.length;
      console.log(`[handleReTranslateAll] Stage 2: Translating ${totalSubtitles} subtitles in ${totalChunks} chained batches (Genre: "${activeGlobalContext.movieGenre}")...`);

      let runningGlossary: GlossaryEntity[] = [...(activeGlobalContext.knownEntityGlossary || [])];
      let previousContextBuffer: { id: string; originalText: string; translatedText: string }[] = [];
      const accumulatedTranslationsMap = new Map<string, string>();

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const currentChunk = chunks[chunkIdx];
        const genreBadge = activeGlobalContext.movieGenre && activeGlobalContext.movieGenre !== 'Tự động'
          ? `[${activeGlobalContext.movieGenre}] `
          : '';
        const pct = Math.round((chunkIdx / totalChunks) * 100);
        setTranslationProgressMsg(`🎬 Bước 2/3: Đang dịch kịch bản chính nhóm ${chunkIdx + 1}/${totalChunks} ${genreBadge}(${pct}%)...`);

        // Gắn trước các thực thể nhân vật / địa danh / thế lực đã đồng bộ vào chunk
        const currentChunkWithEntities = currentChunk.map((sub) => {
          const matched = runningGlossary.filter(
            (g) => g.original && sub.originalText && sub.originalText.toLowerCase().includes(g.original.toLowerCase())
          );
          return {
            ...sub,
            ...(matched.length > 0
              ? { syncedEntities: matched.map((m) => `${m.original} -> ${m.translated}`) }
              : {}),
          };
        });

        let success = false;
        let attempt = 0;
        const maxRetries = 2;
        let lastError: any = null;

        while (attempt <= maxRetries && !success) {
          try {
            let data: any = null;

            // Direct execution for Gemini Web mode when on Android APK or as direct method
            if (appSettings?.apiMode === 'gemini_web') {
              try {
                const directWebResult = await translateSubtitleChunkWithGeminiWeb(
                  currentChunkWithEntities,
                  targetLang,
                  {
                    cookie: appSettings.geminiWebCookie || '',
                    snlm0e: appSettings.geminiWebSessionToken,
                    globalContext: activeGlobalContext,
                    glossary: runningGlossary,
                    previousContext: previousContextBuffer,
                    customContext: effectiveContext,
                    optimizeForTts: false,
                  }
                );
                if (directWebResult.success && Array.isArray(directWebResult.translations) && directWebResult.translations.length > 0) {
                  data = {
                    success: true,
                    translations: directWebResult.translations,
                    newEntities: directWebResult.newEntities || [],
                  };
                }
              } catch (_) {}
            }

            if (!data) {
              const res = await fetch('/api/translate-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subtitles: currentChunkWithEntities,
                  targetLang,
                  model: overrideModel || selectedModel,
                  optimizeForTts: false,
                  customContext: effectiveContext,
                  globalContext: activeGlobalContext,
                  knownEntityGlossary: runningGlossary,
                  previousContext: previousContextBuffer,
                  apiMode: appSettings?.apiMode,
                  groqApiKey: appSettings?.groqApiKey,
                  groqModel: appSettings?.groqModel,
                  groqSttModel: appSettings?.groqSttModel,
                  geminiWebCookie: appSettings?.geminiWebCookie,
                  apiKey: appSettings?.apiKey,
                  proxyUrl: appSettings?.proxyUrl,
                  proxyKey: appSettings?.proxyKey,
                  proxyTargetModel: appSettings?.proxyTargetModel,
                  customModelName: appSettings?.customModelName,
                  proxyNoApiKey: appSettings?.proxyNoApiKey,
                }),
              });

              const rawText = await res.text().catch(() => '');
              try {
                data = JSON.parse(rawText);
              } catch {
                if (appSettings?.apiMode === 'gemini_web') {
                  const fallbackWebResult = await translateSubtitleChunkWithGeminiWeb(
                    currentChunkWithEntities,
                    targetLang,
                    {
                      cookie: appSettings.geminiWebCookie || '',
                      snlm0e: appSettings.geminiWebSessionToken,
                      globalContext: activeGlobalContext,
                      glossary: runningGlossary,
                      previousContext: previousContextBuffer,
                      customContext: effectiveContext,
                      optimizeForTts: false,
                    }
                  );
                  if (fallbackWebResult.success && Array.isArray(fallbackWebResult.translations)) {
                    data = {
                      success: true,
                      translations: fallbackWebResult.translations,
                      newEntities: fallbackWebResult.newEntities || [],
                    };
                  } else {
                    throw new Error(fallbackWebResult.error || `HTTP ${res.status}`);
                  }
                } else {
                  throw new Error(`HTTP ${res.status}: Phản hồi dịch không hợp lệ (${rawText.slice(0, 100)})`);
                }
              }

              if (!res.ok || !data.success) {
                throw new Error(data.message || data.error || `HTTP ${res.status}`);
              }
            }

            if (Array.isArray(data.translations)) {
              const chunkTranslationsMap = new Map<string, string>();
              data.translations.forEach((t: any) => {
                const clean = cleanTranslatedSubtitleText(t.translatedText || '');
                chunkTranslationsMap.set(t.id, clean);
                accumulatedTranslationsMap.set(t.id, clean);
              });

              // Cập nhật phụ đề trên giao diện ngay lập tức
              setSubtitles((prev) =>
                prev.map((s) => {
                  if (chunkTranslationsMap.has(s.id)) {
                    const cleanText = cleanTranslatedSubtitleText(chunkTranslationsMap.get(s.id)!);
                    return { ...s, translatedText: cleanText };
                  }
                  return s;
                })
              );

              // Cập nhật từ điển thực thể nếu batch mới tìm thấy thực thể mới
              if (Array.isArray(data.newEntities) && data.newEntities.length > 0) {
                const existingKeys = new Set(runningGlossary.map((g) => g.original.toLowerCase().trim()));
                data.newEntities.forEach((ne: any) => {
                  if (ne.original && ne.translated && !existingKeys.has(ne.original.toLowerCase().trim())) {
                    runningGlossary.push({
                      original: ne.original,
                      translated: ne.translated,
                      type: ne.type || 'term',
                      description: ne.description || '',
                    });
                    existingKeys.add(ne.original.toLowerCase().trim());
                  }
                });
              }

              // Lưu 3 câu cuối của batch này làm PREVIOUS CONTEXT cho batch sau
              previousContextBuffer = currentChunk.slice(-3).map((sub) => ({
                id: sub.id,
                originalText: sub.originalText,
                translatedText: chunkTranslationsMap.get(sub.id) || '',
              }));

              success = true;
            } else {
              throw new Error('Định dạng dữ liệu dịch trả về không hợp lệ.');
            }
          } catch (err: any) {
            attempt++;
            lastError = err;
            console.warn(`[handleReTranslateAll] Batch ${chunkIdx + 1} attempt ${attempt} failed:`, err);
            if (attempt <= maxRetries) {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }

        if (!success) {
          throw new Error(lastError?.message || `Lỗi ở nhóm dịch thứ ${chunkIdx + 1}`);
        }
      }

      // =========================================================================
      // BƯỚC 3: AI SÀNG LỌC & TỐI ƯU TTS (QUY TRÌNH 2 LƯỢT AI THỰC CHẤT)
      // Lượt 1 (Request 1): AI rà soát & sàng lọc các block phụ đề quá tải thời lượng phát âm.
      // Lượt 2 (Request 2): Gửi một request nữa cho AI để tối ưu & viết lại cô đọng, tự nhiên các block đó.
      // =========================================================================
      setTranslationProgressMsg('⚡ Bước 3/3 (Lượt 1/2): AI đang rà soát & sàng lọc các câu phụ đề quá tải thời lượng phát âm...');
      console.log(`[handleReTranslateAll] Stage 3 - Request 1: AI screening ${subtitles.length} subtitles for TTS overload...`);

      const subtitlesToScreen = subtitles.map((s) => {
        const transText = accumulatedTranslationsMap.get(s.id) ?? s.translatedText ?? s.originalText ?? '';
        const durSec = Math.max(0.4, ((s.endTime || 0) - (s.startTime || 0)) || 1.5);
        return {
          id: s.id,
          text: (transText || '').trim(),
          duration: durSec,
          durationSec: Number(durSec.toFixed(2)),
          startTime: s.startTime,
          endTime: s.endTime,
        };
      });

      let screenedOverloaded: { id: string | number; text: string; duration: number | string; reason?: string; targetWords?: number }[] = [];

      // Lượt 1: Gửi Request cho AI sàng lọc
      if (appSettings?.apiMode === 'gemini_web') {
        try {
          const webScreen = await screenTtsOverloadWithGeminiWeb(subtitlesToScreen, {
            cookie: appSettings.geminiWebCookie || '',
            snlm0e: appSettings.geminiWebSessionToken,
          });
          if (webScreen.success && Array.isArray(webScreen.overloadedItems)) {
            screenedOverloaded = webScreen.overloadedItems;
          }
        } catch (screenErr) {
          console.warn('[Stage 3 - Request 1] Gemini Web screening error:', screenErr);
        }
      }

      if (screenedOverloaded.length === 0 && appSettings?.apiMode !== 'gemini_web') {
        try {
          const screenRes = await fetch('/api/screen-tts-overload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subtitles: subtitlesToScreen,
              targetLang,
              model: overrideModel || selectedModel,
              apiMode: appSettings?.apiMode,
              geminiWebCookie: appSettings?.geminiWebCookie,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
            }),
          });
          if (screenRes.ok) {
            const screenData = await screenRes.json().catch(() => null);
            if (screenData?.success && Array.isArray(screenData.overloadedItems)) {
              screenedOverloaded = screenData.overloadedItems;
            }
          }
        } catch (screenErr) {
          console.warn('[Stage 3 - Request 1] Server screening error:', screenErr);
        }
      }

      let optimizedCount = 0;

      // Lượt 2: Gửi tiếp một Request nữa cho AI để tối ưu lại các câu phụ đề quá tải vừa sàng lọc
      if (screenedOverloaded.length > 0) {
        setTranslationProgressMsg(`⚡ Bước 3/3 (Lượt 2/2): Đã phát hiện ${screenedOverloaded.length} câu quá tải. AI đang viết lại súc tích, tự nhiên...`);
        console.log(`[handleReTranslateAll] Stage 3 - Request 2: Sending second request to AI to optimize ${screenedOverloaded.length} overloaded subtitle blocks...`);

        let optData: any = null;
        if (appSettings?.apiMode === 'gemini_web') {
          try {
            const webOpt = await optimizeTtsOverloadWithGeminiWeb(screenedOverloaded, {
              cookie: appSettings.geminiWebCookie || '',
              snlm0e: appSettings.geminiWebSessionToken,
            });
            if (webOpt.success && Array.isArray(webOpt.optimizedBlocks) && webOpt.optimizedBlocks.length > 0) {
              optData = { success: true, optimizedBlocks: webOpt.optimizedBlocks };
            }
          } catch (optErr) {
            console.warn('[Stage 3 - Request 2] Gemini Web optimization error:', optErr);
          }
        }

        if (!optData) {
          const optRes = await fetch('/api/optimize-tts-overload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              overloadedBlocks: screenedOverloaded,
              targetLang,
              model: overrideModel || selectedModel,
              apiMode: appSettings?.apiMode,
              geminiWebCookie: appSettings?.geminiWebCookie,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
            }),
          });

          if (optRes.ok) {
            optData = await optRes.json().catch(() => null);
          }
        }

        if (optData && Array.isArray(optData.optimizedBlocks) && optData.optimizedBlocks.length > 0) {
          const optMap = new Map<string, string>();
          optData.optimizedBlocks.forEach((item: any) => {
            if (item.id !== undefined && item.text) {
              const clean = cleanTranslatedSubtitleText(String(item.text));
              optMap.set(String(item.id), clean);
            }
          });

          optimizedCount = optMap.size;
          setSubtitles((prev) =>
            prev.map((s) => {
              const sId = String(s.id);
              if (optMap.has(sId)) {
                return { ...s, translatedText: optMap.get(sId)! };
              }
              return s;
            })
          );
        }
      }

      // Cập nhật lại từ điển thực thể hoàn chỉnh vào project context
      setGlobalContext((prev) => ({
        ...(prev || activeGlobalContext),
        knownEntityGlossary: runningGlossary,
      }));

      setTranslationProgressMsg('');
      const entityCount = runningGlossary.length;
      alert(
        `✨ Hoàn tất quy trình dịch & tối ưu TTS 3 bước thành công!\n` +
        `1️⃣ Bước 1 (Ngữ cảnh): Đồng bộ & áp dụng ${entityCount} nhân vật, địa danh, thế lực.\n` +
        `2️⃣ Bước 2 (Dịch chính): Đã dịch full ${totalSubtitles} câu chuẩn cảm xúc & nghĩa gốc.\n` +
        `3️⃣ Bước 3 (Rà soát & Tối ưu TTS 2 lượt AI):\n` +
        `   • Lượt 1 (Sàng lọc AI): ${
          screenedOverloaded.length > 0
            ? `AI đã rà soát toàn bộ và phát hiện ${screenedOverloaded.length} câu quá tải thời lượng phát âm.`
            : `AI đã rà soát toàn bộ và xác nhận 100% câu đều khớp chuẩn thời lượng phát âm!`
        }\n` +
        `   • Lượt 2 (Tối ưu AI): ${
          optimizedCount > 0
            ? `Đã gửi request riêng để AI viết lại thành công ${optimizedCount} câu súc tích, tự nhiên, bảo toàn 100% cảm xúc và xưng hô!`
            : `Không cần rút gọn thêm.`
        }`
      );
    } catch (e: any) {
      console.error(e);
      alert('Quá trình dịch bị gián đoạn:\n' + (e?.message || 'Lỗi hệ thống'));
    } finally {
      setIsTranslatingBatch(false);
      setTranslationProgressMsg('');
    }
  };

  /**
   * Chạy riêng Bước 3: Rà soát & Tối ưu các block phụ đề quá tải thời lượng cho TTS qua 2 lượt AI
   * Lượt 1: Cho AI sàng lọc phụ đề quá tải
   * Lượt 2: Gửi một request nữa cho AI để tối ưu lại các câu đó
   */
  const handleOptimizeTtsOverload = async (overrideModel?: GeminiModelOption) => {
    if (subtitles.length === 0) return;
    setIsTranslatingBatch(true);
    try {
      setTranslationProgressMsg('⚡ Bước 3 (Lượt 1/2): AI đang rà soát & sàng lọc các câu phụ đề quá tải thời lượng đọc...');

      const subtitlesToScreen = subtitles.map((s) => {
        const durSec = Math.max(0.4, ((s.endTime || 0) - (s.startTime || 0)) || 1.5);
        const text = (s.translatedText || s.originalText || '').trim();
        return {
          id: s.id,
          text: text,
          duration: durSec,
          durationSec: Number(durSec.toFixed(2)),
          startTime: s.startTime,
          endTime: s.endTime,
        };
      });

      let screenedOverloaded: { id: string | number; text: string; duration: number | string; reason?: string; targetWords?: number }[] = [];

      // Lượt 1: AI sàng lọc
      if (appSettings?.apiMode === 'gemini_web') {
        try {
          const webScreen = await screenTtsOverloadWithGeminiWeb(subtitlesToScreen, {
            cookie: appSettings.geminiWebCookie || '',
            snlm0e: appSettings.geminiWebSessionToken,
          });
          if (webScreen.success && Array.isArray(webScreen.overloadedItems)) {
            screenedOverloaded = webScreen.overloadedItems;
          }
        } catch (screenErr) {
          console.warn('[handleOptimizeTtsOverload] Gemini Web screening error:', screenErr);
        }
      }

      if (screenedOverloaded.length === 0 && appSettings?.apiMode !== 'gemini_web') {
        try {
          const screenRes = await fetch('/api/screen-tts-overload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subtitles: subtitlesToScreen,
              targetLang,
              model: overrideModel || selectedModel,
              apiMode: appSettings?.apiMode,
              geminiWebCookie: appSettings?.geminiWebCookie,
              apiKey: appSettings?.apiKey,
              proxyUrl: appSettings?.proxyUrl,
              proxyKey: appSettings?.proxyKey,
              proxyTargetModel: appSettings?.proxyTargetModel,
              customModelName: appSettings?.customModelName,
              proxyNoApiKey: appSettings?.proxyNoApiKey,
            }),
          });
          if (screenRes.ok) {
            const screenData = await screenRes.json().catch(() => null);
            if (screenData?.success && Array.isArray(screenData.overloadedItems)) {
              screenedOverloaded = screenData.overloadedItems;
            }
          }
        } catch (screenErr) {
          console.warn('[handleOptimizeTtsOverload] Server screening error:', screenErr);
        }
      }

      if (screenedOverloaded.length === 0) {
        alert(
          '✅ AI ĐÃ SÀNG LỌC TOÀN BỘ PHỤ ĐỀ!\n\n' +
          `AI đã rà soát toàn bộ ${subtitles.length} câu thoại và xác nhận:\n` +
          'Tất cả các câu đều khớp chuẩn thời lượng đọc tự nhiên (không có câu nào bị quá tải). Sẵn sàng tạo audio lồng tiếng hoàn hảo!'
        );
        return;
      }

      // Lượt 2: Gửi một request nữa cho AI để tối ưu lại
      setTranslationProgressMsg(`⚡ Bước 3 (Lượt 2/2): Đã phát hiện ${screenedOverloaded.length} câu quá tải. AI đang viết lại súc tích, tự nhiên...`);
      let optData: any = null;
      if (appSettings?.apiMode === 'gemini_web') {
        try {
          const webOpt = await optimizeTtsOverloadWithGeminiWeb(screenedOverloaded, {
            cookie: appSettings.geminiWebCookie || '',
            snlm0e: appSettings.geminiWebSessionToken,
          });
          if (webOpt.success && Array.isArray(webOpt.optimizedBlocks) && webOpt.optimizedBlocks.length > 0) {
            optData = { success: true, optimizedBlocks: webOpt.optimizedBlocks };
          }
        } catch (_) {}
      }

      if (!optData) {
        const optRes = await fetch('/api/optimize-tts-overload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            overloadedBlocks: screenedOverloaded,
            targetLang,
            model: overrideModel || selectedModel,
            apiMode: appSettings?.apiMode,
            geminiWebCookie: appSettings?.geminiWebCookie,
            apiKey: appSettings?.apiKey,
            proxyUrl: appSettings?.proxyUrl,
            proxyKey: appSettings?.proxyKey,
            proxyTargetModel: appSettings?.proxyTargetModel,
            customModelName: appSettings?.customModelName,
            proxyNoApiKey: appSettings?.proxyNoApiKey,
          }),
        });

        if (optRes.ok) {
          optData = await optRes.json().catch(() => null);
        }
      }

      const optMap = new Map<string, string>();
      if (optData && Array.isArray(optData.optimizedBlocks) && optData.optimizedBlocks.length > 0) {
        optData.optimizedBlocks.forEach((item: any) => {
          if (item.id !== undefined && item.text) {
            const clean = cleanTranslatedSubtitleText(String(item.text));
            optMap.set(String(item.id), clean);
          }
        });
      }

      if (optMap.size > 0) {
        setSubtitles((prev) =>
          prev.map((s) => {
            const sId = String(s.id);
            if (optMap.has(sId)) {
              return { ...s, translatedText: optMap.get(sId)! };
            }
            return s;
          })
        );

        alert(
          `✨ TỐI ƯU TTS 2 LƯỢT AI THÀNH CÔNG!\n\n` +
          `• Lượt 1 (AI sàng lọc): Phát hiện ${screenedOverloaded.length} câu thoại quá dài so với thời lượng.\n` +
          `• Lượt 2 (AI viết lại): Đã tối ưu súc tích ${optMap.size} câu, bảo toàn trọn vẹn ngữ nghĩa, cảm xúc và cách xưng hô của nhân vật!`
        );
      } else {
        alert('Không nhận được bản tối ưu từ AI hoặc các câu đã ở mức tối ưu.');
      }
    } catch (err: any) {
      console.error('Tts overload optimize error:', err);
      alert('Không thể tối ưu phụ đề TTS: ' + (err?.message || 'Lỗi hệ thống'));
    } finally {
      setIsTranslatingBatch(false);
      setTranslationProgressMsg('');
    }
  };

  // Play base64 audio with Web Audio API using persistent AudioContext and buffer cache for ultra-fast, zero-lag playback
  const playBase64AudioWithControls = async (
    base64: string,
    speed: number = appSettings.ttsSpeed || 1.0,
    pitch: number = appSettings.ttsPitch || 0,
    subId?: string,
    volume: number = 1.0,
    effect: AudioEffectType = 'none'
  ) => {
    try {
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }

      const audioCtx = getSharedAudioContext();
      const len = base64.length;
      const p1 = base64.slice(0, 20);
      const p2 = base64.slice(Math.floor(len * 0.25), Math.floor(len * 0.25) + 20);
      const p3 = base64.slice(Math.floor(len * 0.5), Math.floor(len * 0.5) + 20);
      const p4 = base64.slice(Math.floor(len * 0.75), Math.floor(len * 0.75) + 20);
      const p5 = base64.slice(-20);
      const sampleSignature = `${len}_${p1}_${p2}_${p3}_${p4}_${p5}`;
      const cacheKey = subId ? `${subId}_${sampleSignature}` : sampleSignature;

      let audioBuffer = audioBufferCacheRef.current.get(cacheKey);

      if (!audioBuffer) {
        const binaryStr = atob(base64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        // Retain up to 300 decoded audio clips in memory to eliminate decoding overhead during playback
        if (audioBufferCacheRef.current.size > 300) {
          audioBufferCacheRef.current.clear();
        }
        audioBufferCacheRef.current.set(cacheKey, audioBuffer);
      }

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = Math.max(0.95, Math.min(1.25, speed));

      // Apply pitch shift and audio effect routing
      let totalDetuneCents = pitch * 100;
      const { outputNode, detuneOffsetCents } = applyAudioEffectChain(
        audioCtx,
        source,
        effect,
        volume
      );

      totalDetuneCents += detuneOffsetCents;
      source.detune.value = Math.max(-2400, Math.min(2400, totalDetuneCents));

      outputNode.connect(audioCtx.destination);
      source.start(0);
      activeAudioSourceRef.current = source;
      return source;
    } catch (e) {
      console.warn('Web Audio Playback Fallback', e);
      try {
        const audio = new Audio(`data:audio/wav;base64,${base64}`);
        audio.playbackRate = Math.max(0.95, Math.min(1.25, speed));
        audio.play().catch(() => {});
      } catch {}
    }
  };

  // Helper to assign TTS audio to a subtitle and ripple-shift subsequent subtitles to prevent audio truncation
  const updateSubtitleAudioAndRippleTimeline = (
    prevSubtitles: SubtitleItem[],
    targetId: string,
    audioBase64: string,
    rawDuration: number,
    timestamps?: any
  ): SubtitleItem[] => {
    const list = prevSubtitles.map((s) => ({ ...s }));
    const targetIdStr = String(targetId);
    const idx = list.findIndex((s, i) => {
      const sId = (s.id !== undefined && s.id !== null && String(s.id).trim() !== '') ? String(s.id) : String(i);
      return sId === targetIdStr || String(i) === targetIdStr;
    });
    if (idx === -1) return prevSubtitles;

    const target = list[idx];
    const origDuration = target.endTime - target.startTime;

    let roundedDuration = rawDuration;
    const currentSettings = appSettingsRef.current;
    const isSyncEnabled = currentSettings?.enableAudioSync !== false;
    let speedMultiplier = currentSettings?.ttsSpeed || 1.0;

    // Apply gentle speedup if needed to fit original timing ONLY when Audio Sync is enabled
    // STRICT BOUNDARY: Never slow down (< 1.0) to prevent dragging or slow-motion voice distortion!
    if (isSyncEnabled && roundedDuration > origDuration && origDuration > 0.5) {
      const requiredSpeed = roundedDuration / origDuration;
      const syncSpeed = Math.min(1.25, Math.max(1.0, requiredSpeed));
      speedMultiplier = Math.round((speedMultiplier * syncSpeed) * 100) / 100;
      roundedDuration = roundedDuration / syncSpeed;
    }
    speedMultiplier = Math.max(0.95, Math.min(1.25, speedMultiplier));

    const finalEndTime = target.startTime + Math.max(origDuration, roundedDuration) + 0.1;
    target.audioUrl = `data:audio/wav;base64,${audioBase64}`;
    target.duration = Math.round(roundedDuration * 1000) / 1000;
    target.endTime = Math.round(finalEndTime * 1000) / 1000;
    target.speed = speedMultiplier;
    if (timestamps) target.timestamps = timestamps;

    // Ripple shift subsequent subtitles if new endTime extends into next start time
    for (let k = idx + 1; k < list.length; k++) {
      const prevItem = list[k - 1];
      const currItem = list[k];
      const minStart = prevItem.endTime + 0.08;

      if (currItem.startTime < minStart) {
        const shift = minStart - currItem.startTime;
        const currDuration = currItem.endTime - currItem.startTime;
        currItem.startTime = Math.round((currItem.startTime + shift) * 1000) / 1000;
        currItem.endTime = Math.round((currItem.startTime + Math.max(0.3, currDuration)) * 1000) / 1000;
      } else {
        break;
      }
    }

    return list;
  };

  // Split text into short sentence chunks for instant pipelined TTS streaming
  const splitTextIntoSentenceChunks = (text: string): string[] => {
    if (!text || !text.trim()) return [];
    const trimmed = text.trim();
    // Subtitles <= 180 characters should be processed in 1 single chunk without splitting
    if (trimmed.length <= 180) {
      return [trimmed];
    }
    const rawParts = trimmed.split(/(?<=[.?!;\n])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const part of rawParts) {
      const p = part.trim();
      if (!p) continue;

      if ((current ? current + ' ' + p : p).length <= 180) {
        current = current ? current + ' ' + p : p;
      } else {
        if (current) chunks.push(current);
        if (p.length <= 180) {
          current = p;
        } else {
          const commaParts = p.split(/(?<=[,])\s+/);
          let cCurrent = '';
          for (const cp of commaParts) {
            const cTrim = cp.trim();
            if (!cTrim) continue;
            if ((cCurrent ? cCurrent + ' ' + cTrim : cTrim).length <= 180) {
              cCurrent = cCurrent ? cCurrent + ' ' + cTrim : cTrim;
            } else {
              if (cCurrent) chunks.push(cCurrent);
              cCurrent = cTrim;
            }
          }
          if (cCurrent) chunks.push(cCurrent);
          current = '';
        }
      }
    }
    if (current) chunks.push(current);

    return chunks.length > 0 ? chunks : [trimmed];
  };

  const fetchChunkAudioBase64 = async (
    textChunk: string,
    speed: number,
    provider: TTSProviderOption,
    voiceOverride?: string
  ): Promise<{ b64: string | null; error?: any; httpStatus?: number; rawResponse?: string }> => {
    try {
      const currentSettings = appSettingsRef.current || appSettings;
      const actualProvider = provider || currentSettings.ttsProvider || 'capcut_tts';
      const voiceName = (actualProvider === 'vieneu_tts' && voiceOverride)
        ? voiceOverride
        : (actualProvider === 'vieneu_tts' ? (currentSettings.vieneuVoice || 'Minh Đức') : voiceOverride || '');

      // Native Android VieNeu-TTS v3 Turbo Offline Synthesis
      if (actualProvider === 'vieneu_tts' && Capacitor.isNativePlatform()) {
        try {
          const st = await VieNeuNative.checkStatus().catch(() => null);
          if (st && !st.isReady) {
            console.error('[VieNeu Native TTS Error] Models not ready on device:', st);
            return {
              b64: null,
              error: new Error('Mô hình VieNeu-TTS v3 Turbo offline (~147 MB) chưa được nạp/tải về máy Android.'),
            };
          }

          const tokenIds = await convertTextToTokenIds(textChunk);
          const synRes = await VieNeuNative.synthesize({
            tokenIds,
            voiceName: voiceName || 'Minh Đức',
            temperature: 0.8,
            topP: 0.95,
            repPenalty: 1.2,
          });

          if (synRes && synRes.success && synRes.audioPath) {
            const webUrl = Capacitor.convertFileSrc(synRes.audioPath);
            const aRes = await fetch(webUrl);
            const blob = await aRes.blob();
            const b64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const dataUrl = reader.result as string;
                const base64Str = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                resolve(base64Str);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            return { b64 };
          } else {
            return { b64: null, error: new Error('Không nhận được đường dẫn tệp âm thanh từ VieNeu Native Engine') };
          }
        } catch (nativeErr: any) {
          console.error('[VieNeu Native TTS Synthesis Exception]', nativeErr);
          return { b64: null, error: nativeErr };
        }
      }

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textChunk,
          provider: provider || currentSettings.ttsProvider || 'capcut_tts',
          vieneuVoice: (provider === 'vieneu_tts' && voiceOverride) ? voiceOverride : (currentSettings.vieneuVoice || 'Minh Đức'),
          capcutVoice: (provider === 'capcut_tts' && voiceOverride) ? voiceOverride : (currentSettings.capcutVoice || 'BV074_streaming'),
          nghiVoice: (provider === 'nghi_tts' && voiceOverride) ? voiceOverride : (currentSettings.nghiVoice || 'lacphi'),
          edgeVoice: (provider === 'edge_tts' && voiceOverride) ? voiceOverride : (currentSettings.edgeVoice || 'vi-VN-HoaiMyNeural'),
          tiktokSessionId: currentSettings.tiktokSessionId,
          tiktokVoice: (provider === 'tiktok_tts' && voiceOverride) ? voiceOverride : (currentSettings.tiktokVoice || 'BV074_streaming'),
          voice: currentSettings.geminiVoice || 'Kore',
          ttsSpeed: speed,
          enableAudioSync: currentSettings.enableAudioSync !== false,
          apiMode: currentSettings?.apiMode,
          apiKey: currentSettings?.apiKey,
          proxyUrl: currentSettings?.proxyUrl,
          proxyKey: currentSettings?.proxyKey,
          proxyTargetModel: currentSettings?.proxyTargetModel,
          customModelName: currentSettings?.customModelName,
          proxyNoApiKey: currentSettings?.proxyNoApiKey,
          tiktokProxyUrl: currentSettings?.tiktokProxyUrl,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        console.error('[Chunk TTS Server Response Parse Error]', res.status, rawText.slice(0, 200));
        return {
          b64: null,
          httpStatus: res.status,
          rawResponse: rawText,
          error: new Error(`Phản hồi từ server không phải định dạng JSON hợp lệ (Mã HTTP ${res.status})`),
        };
      }

      if (!res.ok || !data.success || !data.audioBase64) {
        console.warn('[Chunk TTS Primary Failed - Attempting Fallback]', res.status, data.error || data.message || rawText.slice(0, 150));
        const fbRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textChunk,
            provider: 'edge_tts',
            edgeVoice: currentSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
            ttsSpeed: speed,
          }),
        });
        const fbData = await fbRes.json().catch(() => ({}));
        if (fbData && fbData.audioBase64) {
          return { b64: fbData.audioBase64 };
        }
        return {
          b64: null,
          httpStatus: res.status,
          rawResponse: rawText,
          error: new Error(data.error || data.message || `Lỗi HTTP ${res.status} từ máy chủ giọng đọc`),
        };
      }

      return { b64: data.audioBase64 };
    } catch (e: any) {
      console.error('Error fetching chunk TTS:', e);
      return { b64: null, error: e };
    }
  };

  const handlePlayTTS = async (
    text: string,
    speed: number = appSettingsRef.current?.ttsSpeed || 1.0,
    pitch: number = appSettingsRef.current?.ttsPitch || 0,
    providerOverride?: TTSProviderOption,
    voiceOverride?: string
  ) => {
    if (!text || !text.trim()) return;

    // Save retry parameters
    setLastTtsRetryParams({ text, speed, pitch, providerOverride, voiceOverride });

    // Cancel previous playback pipeline
    if (activeAudioSourceRef.current) {
      try {
        activeAudioSourceRef.current.stop();
      } catch {}
    }

    const currentPipelineId = Date.now();
    ttsPipelineIdRef.current = currentPipelineId;

    const currentSettings = appSettingsRef.current || appSettings;
    const provider = providerOverride || currentSettings.ttsProvider || 'capcut_tts';
    const voiceName = voiceOverride || (
      provider === 'vieneu_tts'
        ? (currentSettings.vieneuVoice || 'Minh Đức')
        : (provider === 'capcut_tts' ? (currentSettings.capcutVoice || 'BV074_streaming') : 'MacDinh')
    );

    const chunks = splitTextIntoSentenceChunks(text);
    if (chunks.length === 0) return;

    // Single short sentence: simple immediate fetch & play
    if (chunks.length === 1) {
      const fetchRes = await fetchChunkAudioBase64(chunks[0], speed, provider, voiceOverride);
      if (ttsPipelineIdRef.current !== currentPipelineId) return;

      if (fetchRes.b64) {
        await playBase64AudioWithControls(fetchRes.b64, speed, pitch);
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window && provider === 'browser') {
        const utterance = new SpeechSynthesisUtterance(chunks[0]);
        utterance.rate = Math.max(0.5, Math.min(2.0, speed));
        utterance.pitch = Math.max(0.5, Math.min(1.5, 1 + pitch / 10));
        utterance.lang = 'vi-VN';
        window.speechSynthesis.speak(utterance);
      } else {
        // Detailed error diagnoser modal instead of generic unhelpful alert!
        const diagInfo = await diagnoseTtsError({
          provider,
          voiceName,
          textSnippet: text,
          error: fetchRes.error,
          httpStatus: fetchRes.httpStatus,
          rawResponseBody: fetchRes.rawResponse,
        });
        setTtsErrorInfo(diagInfo);
        setIsTtsErrorModalOpen(true);
      }
      return;
    }

    // Paragraph Chunking Pipeline
    let lastError: any = null;
    let lastHttpStatus: number | undefined = undefined;
    let lastRawResp: string | undefined = undefined;
    let hasFailedChunk = false;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch {}
    }

    const chunkAudioPromises = new Map<number, Promise<AudioBuffer | null>>();

    const getOrFetchChunkBuffer = (index: number): Promise<AudioBuffer | null> => {
      if (index >= chunks.length) return Promise.resolve(null);
      if (chunkAudioPromises.has(index)) {
        return chunkAudioPromises.get(index)!;
      }

      const promise = (async () => {
        const fetchRes = await fetchChunkAudioBase64(chunks[index], speed, provider, voiceOverride);
        if (!fetchRes.b64 || ttsPipelineIdRef.current !== currentPipelineId) {
          if (fetchRes.error) lastError = fetchRes.error;
          if (fetchRes.httpStatus) lastHttpStatus = fetchRes.httpStatus;
          if (fetchRes.rawResponse) lastRawResp = fetchRes.rawResponse;
          return null;
        }
        try {
          const binaryStr = atob(fetchRes.b64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let k = 0; k < len; k++) {
            bytes[k] = binaryStr.charCodeAt(k);
          }
          return await audioCtx.decodeAudioData(bytes.buffer);
        } catch (e) {
          console.warn(`Failed to decode chunk ${index}:`, e);
          lastError = e;
          return null;
        }
      })();

      chunkAudioPromises.set(index, promise);
      return promise;
    };

    getOrFetchChunkBuffer(0);
    getOrFetchChunkBuffer(1);

    for (let i = 0; i < chunks.length; i++) {
      if (ttsPipelineIdRef.current !== currentPipelineId) break;

      if (i + 1 < chunks.length) getOrFetchChunkBuffer(i + 1);
      if (i + 2 < chunks.length) getOrFetchChunkBuffer(i + 2);

      const buffer = await getOrFetchChunkBuffer(i);
      if (ttsPipelineIdRef.current !== currentPipelineId) break;

      if (buffer) {
        await new Promise<void>((resolve) => {
          if (ttsPipelineIdRef.current !== currentPipelineId) {
            resolve();
            return;
          }
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = Math.max(0.95, Math.min(1.25, speed));
          source.detune.value = Math.max(-1200, Math.min(1200, pitch * 100));
          source.connect(audioCtx.destination);

          source.onended = () => resolve();
          source.start(0);
          activeAudioSourceRef.current = source;
        });
      } else {
        hasFailedChunk = true;
      }
    }

    if (hasFailedChunk && ttsPipelineIdRef.current === currentPipelineId) {
      const diagInfo = await diagnoseTtsError({
        provider,
        voiceName,
        textSnippet: text,
        error: lastError || new Error('Không thể nạp được phân đoạn âm thanh'),
        httpStatus: lastHttpStatus,
        rawResponseBody: lastRawResp,
      });
      setTtsErrorInfo(diagInfo);
      setIsTtsErrorModalOpen(true);
    }
  };

  // Gộp Phụ Đề Ngắn (Merge short consecutive subtitles)
  const handleMergeShortSubtitles = () => {
    if (subtitles.length < 2) return;
    const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    const merged: SubtitleItem[] = [];
    let i = 0;

    while (i < sorted.length) {
      let curr = { ...sorted[i] };
      let j = i + 1;

      while (j < sorted.length) {
        const next = sorted[j];
        const gap = next.startTime - curr.endTime;
        const words = (curr.translatedText || curr.originalText).trim().split(/\s+/).filter(Boolean).length;
        const duration = curr.endTime - curr.startTime;

        // Merge if gap <= 1.2s and (current sub is short <= 4 words or <= 1.8s) and combined length <= 7s
        if (gap <= 1.2 && (words <= 4 || duration <= 1.8) && (next.endTime - curr.startTime) <= 7.0) {
          curr.endTime = next.endTime;
          curr.originalText = `${curr.originalText} ${next.originalText}`.trim();
          curr.translatedText = `${curr.translatedText || curr.originalText} ${next.translatedText || next.originalText}`.trim();
          curr.audioUrl = undefined;
          j++;
        } else {
          break;
        }
      }
      merged.push(curr);
      i = j;
    }

    setSubtitles(merged);
  };

  // Tạo Audio Thuyết Minh Toàn Bộ (Generate TTS for all subtitles using safe client-side chunked batching)
  const handleGenerateAllAudio = async () => {
    if (subtitles.length === 0) return;
    setIsGeneratingAllAudio(true);
    setAudioGenProgress({ current: 0, total: subtitles.length });

    const itemsToGen = subtitles.map((s, idx) => ({
      id: (s.id !== undefined && s.id !== null && String(s.id).trim() !== '') ? String(s.id) : String(idx),
      text: (s.translatedText || s.originalText || '').trim(),
      targetDuration: Math.max(0.5, (s.endTime - s.startTime) || 2.0),
    })).filter((item) => item.text.length > 0);

    if (itemsToGen.length === 0) {
      setIsGeneratingAllAudio(false);
      return;
    }

    const currentSettings = appSettingsRef.current || appSettings;
    const provider = currentSettings.ttsProvider || 'capcut_tts';
    const speed = currentSettings.ttsSpeed || 1.0;

    // Native Android VieNeu-TTS Offline Batch Generation
    if (provider === 'vieneu_tts' && Capacitor.isNativePlatform()) {
      let completedCount = 0;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      let tempCtx: AudioContext | null = null;
      if (AudioCtx) tempCtx = new AudioCtx();

      try {
        for (const item of itemsToGen) {
          try {
            const fetchRes = await fetchChunkAudioBase64(item.text, speed, 'vieneu_tts', currentSettings.vieneuVoice);
            if (fetchRes.b64) {
              const audioUrl = `data:audio/wav;base64,${fetchRes.b64}`;
              const binaryStr = atob(fetchRes.b64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let k = 0; k < binaryStr.length; k++) {
                bytes[k] = binaryStr.charCodeAt(k);
              }
              let roundedDuration = 1.5;
              if (tempCtx) {
                try {
                  const decoded = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
                  roundedDuration = Math.round(decoded.duration * 1000) / 1000;
                } catch {}
              }
              setSubtitles((prev) => updateSubtitleAudioAndRippleTimeline(prev, item.id, audioUrl, roundedDuration));
            } else if (fetchRes.error) {
              console.warn('[VieNeu Native Generate All Error for item]', item.id, fetchRes.error);
            }
          } catch (itemErr) {
            console.warn('[VieNeu Native Generate All Exception]', itemErr);
          }
          completedCount++;
          setAudioGenProgress({ current: completedCount, total: itemsToGen.length });
        }
        setSubtitles((prev) => normalizeSubtitles(prev));
      } finally {
        if (tempCtx) {
          try { tempCtx.close(); } catch {}
        }
        setIsGeneratingAllAudio(false);
      }
      return;
    }

    let completedCount = 0;
    const CHUNK_SIZE = 10; // Process 10 items per batch to prevent HTTP timeouts & rate limits
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    let tempCtx: AudioContext | null = null;

    try {
      if (AudioCtx) {
        tempCtx = new AudioCtx();
      }

      for (let i = 0; i < itemsToGen.length; i += CHUNK_SIZE) {
        const chunkItems = itemsToGen.slice(i, i + CHUNK_SIZE);

        try {
          const res = await fetch('/api/tts/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: chunkItems,
              provider: currentSettings.ttsProvider || 'capcut_tts',
              vieneuVoice: currentSettings.vieneuVoice || 'Minh Đức',
              capcutVoice: currentSettings.capcutVoice || 'BV074_streaming',
              nghiVoice: currentSettings.nghiVoice || 'lacphi',
              edgeVoice: currentSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
              tiktokSessionId: currentSettings.tiktokSessionId,
              tiktokVoice: currentSettings.tiktokVoice || 'BV074_streaming',
              voice: currentSettings.geminiVoice || 'Kore',
              ttsSpeed: currentSettings.ttsSpeed || 1.0,
              enableAudioSync: currentSettings.enableAudioSync !== false,
              apiMode: currentSettings?.apiMode,
              apiKey: currentSettings?.apiKey,
              proxyUrl: currentSettings?.proxyUrl,
              proxyKey: currentSettings?.proxyKey,
              proxyTargetModel: currentSettings?.proxyTargetModel,
              customModelName: currentSettings?.customModelName,
              proxyNoApiKey: currentSettings?.proxyNoApiKey,
              tiktokProxyUrl: currentSettings?.tiktokProxyUrl,
            }),
          });

          if (!res.ok) {
            console.warn(`[Batch TTS Chunk Error] Chunk ${i / CHUNK_SIZE + 1} status: ${res.status}`);
            completedCount += chunkItems.length;
            setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });
            continue;
          }

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('<') || !trimmed.startsWith('{')) continue;
                try {
                  const r = JSON.parse(trimmed);
                  if (r && r.audioBase64) {
                    const base64Data = r.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
                    const binaryStr = atob(base64Data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let k = 0; k < binaryStr.length; k++) {
                      bytes[k] = binaryStr.charCodeAt(k);
                    }

                    let roundedDuration = r.duration || 1.5;

                    if (tempCtx) {
                      try {
                        const decodedBuffer = await tempCtx.decodeAudioData(bytes.buffer.slice(0));
                        roundedDuration = Math.round(decodedBuffer.duration * 1000) / 1000;
                      } catch (decErr) {
                        console.warn('[Smart Audio Fit] Failed to decode audio for', r.id, decErr);
                      }
                    }

                    setSubtitles((prev) =>
                      updateSubtitleAudioAndRippleTimeline(
                        prev,
                        r.id,
                        r.audioBase64,
                        roundedDuration,
                        r.timestamps
                      )
                    );
                  }

                  completedCount++;
                  setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });

                } catch (lineErr) {
                  // Silent ignore or debug log non-JSON lines
                }
              }
            }
          }
        } catch (chunkErr) {
          console.warn('[Batch TTS Chunk Exception]', chunkErr);
          completedCount += chunkItems.length;
          setAudioGenProgress({ current: Math.min(completedCount, itemsToGen.length), total: itemsToGen.length });
        }

        // Small pause between chunks to give network/servers a breathing room
        await new Promise((res) => setTimeout(res, 200));
      }

      // Final pass to normalize timestamps and layout
      setSubtitles((prev) => normalizeSubtitles(prev));

    } catch (err) {
      console.warn('Error progressive batch generating TTS:', err);
    } finally {
      if (tempCtx) {
        try { tempCtx.close(); } catch {}
      }
      setIsGeneratingAllAudio(false);
    }
  };

  // Clear all cached audio
  const handleClearAllAudio = async () => {
    audioBufferCacheRef.current.clear();
    setSubtitles((prev) => prev.map((s) => ({ ...s, audioUrl: undefined })));
    try {
      await fetch('/api/tts/clear-cache', { method: 'POST' });
    } catch {}
  };

  // Generate TTS audio for a single selected subtitle item
  const handleGenerateSingleAudio = async (subId: string) => {
    const sub = subtitles.find((s) => s.id === subId);
    if (!sub) return;
    const text = (sub.translatedText || sub.originalText || '').trim();
    if (!text) return;

    setIsGeneratingSingleAudio(subId);

    const targetDuration = Math.max(0.5, (sub.endTime - sub.startTime) || 2.0);

    try {
      const currentSettings = appSettingsRef.current || appSettings;
      const provider = currentSettings.ttsProvider || 'capcut_tts';
      const speed = currentSettings.ttsSpeed || 1.0;

      // Native Android VieNeu-TTS Single Item Synthesis
      if (provider === 'vieneu_tts' && Capacitor.isNativePlatform()) {
        const fetchRes = await fetchChunkAudioBase64(text, speed, 'vieneu_tts', currentSettings.vieneuVoice);
        if (fetchRes.b64) {
          const audioUrl = `data:audio/wav;base64,${fetchRes.b64}`;
          const binaryStr = atob(fetchRes.b64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let k = 0; k < binaryStr.length; k++) {
            bytes[k] = binaryStr.charCodeAt(k);
          }
          let roundedDuration = 1.5;
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            try {
              const ctx = new AudioCtx();
              const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0));
              roundedDuration = Math.round(decoded.duration * 1000) / 1000;
              ctx.close();
            } catch {}
          }
          setSubtitles((prev) => updateSubtitleAudioAndRippleTimeline(prev, subId, audioUrl, roundedDuration));
        } else if (fetchRes.error) {
          throw fetchRes.error;
        }
        setIsGeneratingSingleAudio(null);
        return;
      }

      const res = await fetch('/api/tts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: sub.id, text, targetDuration }],
          provider: currentSettings.ttsProvider || 'capcut_tts',
          vieneuVoice: currentSettings.vieneuVoice || 'Minh Đức',
          capcutVoice: currentSettings.capcutVoice || 'BV074_streaming',
          nghiVoice: currentSettings.nghiVoice || 'lacphi',
          edgeVoice: currentSettings.edgeVoice || 'vi-VN-HoaiMyNeural',
          tiktokSessionId: currentSettings.tiktokSessionId,
          tiktokVoice: currentSettings.tiktokVoice || 'BV074_streaming',
          voice: currentSettings.geminiVoice || 'Kore',
          ttsSpeed: currentSettings.ttsSpeed || 1.0,
          apiMode: currentSettings?.apiMode,
          apiKey: currentSettings?.apiKey,
          proxyUrl: currentSettings?.proxyUrl,
          proxyKey: currentSettings?.proxyKey,
          proxyTargetModel: currentSettings?.proxyTargetModel,
          customModelName: currentSettings?.customModelName,
          proxyNoApiKey: currentSettings?.proxyNoApiKey,
          tiktokProxyUrl: currentSettings?.tiktokProxyUrl,
        }),
      });

      if (!res.ok) {
        console.warn('[Single TTS Server Error]', res.status);
        setIsGeneratingSingleAudio(null);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      if (!reader) {
        setIsGeneratingSingleAudio(null);
        return;
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const tempCtx = new AudioCtx();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line);
            if (r && r.audioBase64) {
              const base64Data = r.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
              const binaryStr = atob(base64Data);
              const bytes = new Uint8Array(binaryStr.length);
              for (let k = 0; k < binaryStr.length; k++) {
                bytes[k] = binaryStr.charCodeAt(k);
              }

              let roundedDuration = r.duration || 1.5;
              let speedMultiplier = 1.0;

              try {
                const decodedBuffer = await tempCtx.decodeAudioData(bytes.buffer);
                roundedDuration = Math.round(decodedBuffer.duration * 1000) / 1000;
              } catch (_) {}

              setSubtitles((prev) =>
                updateSubtitleAudioAndRippleTimeline(
                  prev,
                  subId,
                  r.audioBase64,
                  roundedDuration,
                  r.timestamps
                )
              );
            }
          } catch (e) {
            console.warn('[Single TTS Parse Error]', e);
          }
        }
      }
    } catch (err) {
      console.error('Error generating single audio:', err);
    } finally {
      setIsGeneratingSingleAudio(null);
    }
  };

  const handlePlaySingleAudio = (sub: SubtitleItem) => {
    if (sub.audioUrl) {
      const base64 = sub.audioUrl.replace(/^data:audio\/\w+;base64,/, '');
      playBase64AudioWithControls(
        base64,
        sub.speed || appSettings.ttsSpeed || 1.0,
        appSettings.ttsPitch || 0,
        sub.id,
        sub.audioVolume ?? 1.0
      );
    } else {
      handlePlayTTS(sub.translatedText || sub.originalText, sub.speed || appSettings.ttsSpeed || 1.0, appSettings.ttsPitch || 0);
    }
  };

  const handleDeleteSingleAudio = (subId: string) => {
    setSubtitles((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, audioUrl: undefined, audioDeleted: true } : s))
    );
    if (selectedAudioId === subId) {
      setSelectedAudioId(null);
    }
  };

  // Synchronize TTS audio playback with video play timeline (Robust range-based matching)
  useEffect(() => {
    if (!isPlaying || !audioPlayWithVideo) {
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }
      lastPlayedSubIdRef.current = null;
      prevTimeRef.current = currentTime;
      return;
    }

    const timeDelta = currentTime - prevTimeRef.current;
    // Detect seek or rewind (time jumped backwards or jumped forward by > 1.5s)
    const isSeeking = timeDelta < -0.1 || timeDelta > 1.5;
    prevTimeRef.current = currentTime;

    if (isSeeking) {
      lastPlayedSubIdRef.current = null;
      if (activeAudioSourceRef.current) {
        try {
          activeAudioSourceRef.current.stop();
          activeAudioSourceRef.current.disconnect();
        } catch {}
        activeAudioSourceRef.current = null;
      }
    }

    // Match active subtitle covering currentTime [startTime, endTime]
    // Fixes skipped audio on heavy/long videos where frame drops cause time updates to jump past startTime + 0.4s
    const currentActive = subtitles.find(
      (s) => !s.audioDeleted && currentTime >= s.startTime && currentTime <= s.endTime
    );

    if (currentActive) {
      if (currentActive.audioUrl && lastPlayedSubIdRef.current !== currentActive.id) {
        lastPlayedSubIdRef.current = currentActive.id;
        const base64 = currentActive.audioUrl.replace(/^data:audio\/\w+;base64,/, '');
        const playbackSpeed = currentActive.speed || appSettings.ttsSpeed || 1.0;
        const playbackVolume = currentActive.audioVolume ?? 1.0;
        playBase64AudioWithControls(base64, playbackSpeed, appSettings.ttsPitch || 0, currentActive.id, playbackVolume);
      }
    } else {
      // In gap between subtitles, reset lastPlayedSubIdRef so next subtitle triggers cleanly
      lastPlayedSubIdRef.current = null;
    }
  }, [currentTime, isPlaying, audioPlayWithVideo, subtitles, appSettings.ttsSpeed, appSettings.ttsPitch]);

  const handleSeek = (time: number) => {
    stopAllAudioPlayback();
    if (videoRef.current) {
      if (clips && clips.length > 1) {
        let targetIndex = 0;
        let relativeTime = time;
        for (let i = 0; i < clips.length; i++) {
          const start = clipStartTimes[i];
          const end = start + clips[i].duration;
          if (time >= start && time <= end) {
            targetIndex = i;
            relativeTime = time - start;
            break;
          }
        }

        if (activeClipIndex !== targetIndex) {
          setActiveClipIndex(targetIndex);
          videoRef.current.src = clips[targetIndex].url;
        }

        videoRef.current.currentTime = relativeTime;
        setCurrentTime(time);
      } else {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
      }
    }
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.volume = videoVolume;
      videoRef.current.playbackRate = videoSpeed;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err: any) => {
            const errStr = (err?.message || String(err || '')).toLowerCase();
            const isAborted =
              err?.name === 'AbortError' ||
              errStr.includes('interrupted') ||
              errStr.includes('abort') ||
              errStr.includes('interrupted by a new load request');
            if (isAborted) {
              console.warn('[Editor] Video play request interrupted cleanly:', err?.message || err);
            } else {
              console.warn('[Editor] Video play could not start (autoplay policy or media loading):', err);
            }
            setIsPlaying(false);
          });
      }
    }
  };

  // Split subtitle at current time
  const handleSplitSubtitle = (splitTime: number) => {
    const target = subtitles.find((s) => splitTime > s.startTime + 0.3 && splitTime < s.endTime - 0.3);
    if (!target) return;

    const firstSub: SubtitleItem = {
      ...target,
      endTime: splitTime,
    };

    const secondSub: SubtitleItem = {
      ...target,
      id: `split-${Date.now()}`,
      startTime: splitTime,
    };

    setSubtitles((prev) =>
      normalizeSubtitles(
        prev.map((s) => (s.id === target.id ? firstSub : s)).concat(secondSub)
      )
    );
  };

  const handleUpdateActiveSubtitleBox = React.useCallback(
    (newBox: { x: number; y: number; width: number; height: number }) => {
      setRoi(newBox);
      setSubtitles((prev) =>
        prev.map((sub) => ({ ...sub, boundingBox: newBox }))
      );
    },
    []
  );

  return (
    <div className="min-h-[100dvh] bg-black text-slate-100 flex justify-center font-sans antialiased overflow-hidden">
      {/* Smartphone / PC Responsive Container Viewport */}
      <div className="w-full max-w-md md:max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl bg-black h-[100dvh] flex flex-col relative shadow-2xl border-x border-zinc-900 overflow-hidden">
        
        {/* 1. CapCut Navigation Header - Safe-area aware */}
        <header
          className={`bg-black flex flex-col relative shrink-0 ${showExportSettingsDropdown ? 'z-[150]' : 'z-40'}`}
          style={{ paddingTop: 'var(--app-safe-top)' }}
        >
          <div className="w-full px-2.5 sm:px-3 h-[46px] flex items-center justify-between gap-1.5">
            {/* Left: Close Button */}
            <button
              onClick={onBackToHome}
              className="p-1.5 -ml-1 text-white hover:text-slate-300 transition cursor-pointer shrink-0 rounded-lg flex items-center justify-center"
              title="Đóng / Trở về Trang Chủ"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* Center/Right: Admin VIP, '+ Tạo mới', Resolution '480P', Settings, and Vivid Red 'Xuất' Button */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              {/* Admin Control Panel Button (Only for Whitelisted Super Admin MEM-0DF9-EB1B) */}
              {onOpenLicense && isWhitelistedAdminMember(licenseState) && (
                <button
                  onClick={onOpenLicense}
                  className="flex items-center gap-1 px-2 sm:px-2.5 h-[30px] rounded-lg text-[10px] font-black transition-all shadow-sm active:scale-95 cursor-pointer bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 hover:brightness-110 shrink-0 whitespace-nowrap"
                  title="Trung Tâm Quản Trị Super Admin & Buff VIP (MEM-0DF9-EB1B)"
                >
                  <Crown className="w-3 h-3 fill-slate-950 shrink-0" />
                  <span>ADMIN<span className="hidden sm:inline"> VIP</span></span>
                </button>
              )}

              {/* + Tạo mới Button */}
              <button
                onClick={handleTriggerNewVideo}
                className="px-2.5 sm:px-3 h-[30px] rounded-lg bg-[#222226] hover:bg-[#2c2c31] text-white text-[11px] sm:text-xs font-semibold border border-white/10 transition active:scale-95 cursor-pointer flex items-center shrink-0 whitespace-nowrap"
                title="Tạo mới / Chọn video khác"
              >
                <span>+ Tạo mới</span>
              </button>

              {/* Resolution Badge (e.g. 480P / 720P / 1080P) */}
              <div 
                className="px-2 sm:px-2.5 h-[30px] rounded-lg bg-[#222226] text-white text-[11px] sm:text-xs font-bold font-mono border border-white/10 select-none flex items-center justify-center cursor-default shrink-0 whitespace-nowrap"
                title={videoDimensions ? `Độ phân giải: ${videoDimensions.width} × ${videoDimensions.height}` : '480P'}
              >
                <span>{getResolutionBadge() || '480P'}</span>
              </div>

              {/* Top Export Settings Dropdown (Bên phải độ phân giải, bên trái nút xuất) */}
              <TopExportSettingsDropdown
                settings={exportSettings}
                onChangeSettings={handleUpdateExportSettings}
                videoDimensions={videoDimensions}
                isOpen={showExportSettingsDropdown}
                onToggleOpen={() => setShowExportSettingsDropdown((prev) => !prev)}
                onClose={() => setShowExportSettingsDropdown(false)}
              />

              {/* Vivid Red / Coral Red 'Xuất' Button */}
              <button
                onClick={() => setIsExportOpen(true)}
                className="px-3 sm:px-3.5 h-[30px] rounded-lg bg-[#ff2442] hover:bg-[#e0203a] text-white text-[11px] sm:text-xs font-bold transition active:scale-95 shadow-md shadow-red-500/20 cursor-pointer flex items-center justify-center gap-1 min-w-[58px] sm:min-w-[70px] shrink-0 whitespace-nowrap"
                title={exportProgress ? `Đang xuất video thực tế: ${exportProgress.percentage >= 100 ? '100%' : `${exportProgress.percentage.toFixed(1)}%`}` : 'Xuất video đã xử lý'}
              >
                {exportProgress && exportProgress.percentage < 100 ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                    <span>Xuất {exportProgress.percentage.toFixed(1)}%</span>
                  </>
                ) : (
                  <span>Xuất</span>
                )}
              </button>
            </div>
          </div>
        </header>



        {/* 2. Editor Main Canvas Body */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-[#0b0b0d]">
          {/* License Lock Overlay if license is invalid or expired */}
          {licenseState && !licenseState.isPro && !licenseState.isAdmin && (
            <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-400 to-yellow-200 border border-amber-300/60 flex items-center justify-center text-slate-950 mb-4 shadow-2xl shadow-amber-500/20">
                <Crown className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Trình Biên Tập Đã Bị Khóa Bản Quyền</h2>
              <p className="text-xs text-slate-300 max-w-md mb-6 leading-relaxed">
                Thiết bị chưa được kích hoạt bản quyền hợp lệ hoặc giấy phép đã hết hạn. Vui lòng kích hoạt mã bản quyền hoặc liên hệ Quản trị viên để tiếp tục sử dụng tính năng bóc tách, dịch thuật và xuất video.
              </p>
              <div className="flex items-center space-x-3">
                <button
                  onClick={onBackToHome}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
                >
                  Về Trang Chủ
                </button>
                {onOpenLicense && (
                  <button
                    onClick={onOpenLicense}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:brightness-110 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/20 transition active:scale-95"
                  >
                    Kích Hoạt Bản Quyền Ngay
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Responsive Video Canvas Container */}
          <div className="flex-1 min-h-0 p-1 sm:p-1.5 flex items-center justify-center overflow-hidden bg-black relative">
            <div className="w-full h-full max-h-full flex items-center justify-center min-h-0">
              <VideoPlayer
                videoUrl={videoUrl}
                projectId={project.id}
                roi={roi}
                onChangeRoi={setRoi}
                showRoiBox={activeTab === 'extract' && extractSubTab === 'image'}
                activeSubtitle={activeSubtitle}
                isSubtitleSelected={Boolean(selectedSubtitleId && activeSubtitle && selectedSubtitleId === activeSubtitle.id)}
                onSelectSubtitle={(sub) => {
                  if (sub) {
                    setSelectedSubtitleId(sub.id);
                    setIsVideoSelected(false);
                    setSelectedBlurOverlayId(null);
                  }
                }}
                onUpdateActiveSubtitleBox={handleUpdateActiveSubtitleBox}
                styleConfig={styleConfig}
                onChangeStyleConfig={setStyleConfig}
                onExtractSingleFrame={handleExtractSingleFrame}
                isExtractingSingle={isExtractingSingle}
                onAutoDetectRoi={handleAutoDetectRoi}
                isDetectingRoi={isDetectingRoi}
                onTimeUpdate={setCurrentTime}
                onLoadedMetadata={handleLoadedMetadata}
                videoRef={videoRef}
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
                onImportVideo={(url, title, file, preserveSubs) => handleImportVideo(url, title, undefined, file, preserveSubs)}
                onOpenImportModal={handleTriggerReplaceVideo}
                scanProgress={scanProgress}
                blurOverlays={blurOverlays}
                onChangeBlurOverlays={setBlurOverlays}
                showBlurVirtualBorder={showBlurVirtualBorder}
                selectedBlurOverlayId={selectedBlurOverlayId}
                onSelectBlurOverlay={(id) => {
                  setSelectedBlurOverlayId(id);
                  if (id) {
                    setSelectedSubtitleId(null);
                    setSelectedTextOverlayId(null);
                    setSelectedAudioId(null);
                    setIsVideoSelected(false);
                  }
                }}
                logoOverlays={logoOverlays}
                onChangeLogoOverlays={setLogoOverlays}
                textOverlays={textOverlays}
                onChangeTextOverlays={setTextOverlays}
                selectedTextOverlayId={selectedTextOverlayId}
                onSelectTextOverlay={(t) => {
                  setSelectedTextOverlayId(t ? t.id : null);
                  if (t) {
                    setSelectedSubtitleId(null);
                    setSelectedAudioId(null);
                    setSelectedBlurOverlayId(null);
                    setIsVideoSelected(false);
                  }
                }}
                onEditTextOverlay={(t) => {
                  setSelectedTextOverlayId(t.id);
                  setSelectedSubtitleId(null);
                  setSelectedAudioId(null);
                  setSelectedBlurOverlayId(null);
                  setIsVideoSelected(false);
                  setTriggerTextOverlayAction({ id: t.id, action: 'edit' });
                }}
                onOpenTextOverlayConfig={(t) => {
                  setSelectedTextOverlayId(t.id);
                  setSelectedSubtitleId(null);
                  setSelectedAudioId(null);
                  setSelectedBlurOverlayId(null);
                  setIsVideoSelected(false);
                  setTriggerTextOverlayAction({ id: t.id, action: 'config' });
                }}
                onDeleteTextOverlay={(id) => {
                  setTextOverlays((prev) => prev.filter((t) => t.id !== id));
                  if (selectedTextOverlayId === id) setSelectedTextOverlayId(null);
                }}
                clips={clips}
                activeClipIndex={activeClipIndex}
                onChangeActiveClipIndex={setActiveClipIndex}
              />
            </div>
          </div>

          {/* CapCut Multi-track Timeline Track - Constant DOM slot height prevents video preview layout jitter */}
          <div className={`h-[200px] shrink-0 border-t border-zinc-800/80 bg-[#121217] transition-opacity duration-200 ${
            isFullToolSheetActive ? 'opacity-20 pointer-events-none' : 'opacity-100'
          }`}>
            <CapCutTimeline
              appSettings={appSettings}
              duration={videoDuration}
              currentTime={currentTime}
              subtitles={subtitles}
              selectedSubtitleId={selectedSubtitleId}
              isVideoSelected={isVideoSelected}
              onSelectVideoBlock={(selected) => {
                setIsVideoSelected(selected);
                if (selected) {
                  setSelectedSubtitleId(null);
                  setSelectedBlurOverlayId(null);
                }
              }}
              onSeek={handleSeek}
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onSplitSubtitle={handleSplitSubtitle}
              onSelectSubtitle={(sub) => {
                setSelectedSubtitleId(sub ? sub.id : null);
                if (sub) {
                  setIsVideoSelected(false);
                  setSelectedBlurOverlayId(null);
                }
              }}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={historyIndex > 0}
              canRedo={historyIndex < history.length - 1}
              onUpdateSubtitle={(updated) =>
                setSubtitles((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s))
                )
              }
              hasVideo={Boolean(videoUrl)}
              videoTitle={projectTitle || 'imported_video.mp4'}
              onOpenImportModal={handleTriggerReplaceVideo}
              onImportVideo={(url, title) => handleImportVideo(url, title)}
              onPlayTTS={(text) => handlePlayTTS(text)}
              onExtractSRT={() => {
                handleStartFullScan(0, Math.ceil(videoDuration) || 300, 1.0, '');
              }}
              onImportSRT={(file) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                  const content = e.target?.result as string;
                  if (content) {
                    const parsed = parseSRT(content);
                    if (parsed.length > 0) {
                      setSubtitles(parsed);
                    }
                  }
                };
                reader.readAsText(file);
              }}
              onExtractAudio={() => {
                handleGenerateAllAudio();
              }}
              onImportAudio={(file) => {
                alert(`Đã nhập file audio: ${file.name}`);
              }}
              bgMusicTitle={bgMusicTitle || undefined}
              onImportBgMusic={(file) => {
                setBgMusicTitle(file.name);
              }}
              textOverlays={textOverlays}
              onUpdateTextOverlay={(updated) => {
                setTextOverlays((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
              }}
              onDeleteTextOverlay={(id) => {
                setTextOverlays((prev) => prev.filter((t) => t.id !== id));
                if (selectedTextOverlayId === id) setSelectedTextOverlayId(null);
              }}
              selectedTextOverlayId={selectedTextOverlayId}
              onSelectTextOverlay={(t) => {
                setSelectedTextOverlayId(t ? t.id : null);
                if (t) {
                  setSelectedSubtitleId(null);
                  setSelectedAudioId(null);
                  setIsVideoSelected(false);
                }
              }}
              selectedAudioId={selectedAudioId}
              onSelectAudio={(audioSub) => {
                setSelectedAudioId(audioSub ? audioSub.id : null);
                if (audioSub) {
                  setSelectedSubtitleId(null);
                  setIsVideoSelected(false);
                  setSelectedTextOverlayId(null);
                }
              }}
              onAddSubtitle={(t) =>
                setSubtitles((prev) => {
                  const targetTime = t || currentTime;
                  const newSub = {
                    id: `manual-${Date.now()}`,
                    startTime: targetTime,
                    endTime: targetTime + 2.5,
                    originalText: 'Nhập văn bản...',
                    translatedText: 'Nhập bản dịch...',
                  };
                  const newList = [...prev, newSub].sort((a, b) => a.startTime - b.startTime);
                  return resolveOverlapsWithPriority(newList, newSub.id);
                })
              }
            />
          </div>
        </div>

        {/* 3. CapCut Bottom Function Bar */}
        <CapCutBottomBar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          extractSubTab={extractSubTab}
          onExtractSubTabChange={setExtractSubTab}
          onActiveSheetChange={setActiveBottomBarSheet}
          projectTitle={projectTitle}
          triggerTextOverlayAction={triggerTextOverlayAction}
          isVideoSelected={isVideoSelected}
          onSelectVideoBlock={(selected) => {
            setIsVideoSelected(selected);
            if (selected) {
              setSelectedSubtitleId(null);
              setSelectedAudioId(null);
              setSelectedBlurOverlayId(null);
            }
          }}
          onOpenImportModal={handleTriggerReplaceVideo}
          selectedSubtitle={selectedSubtitle}
          onSelectSubtitle={(sub) => {
            setSelectedSubtitleId(sub ? sub.id : null);
            if (sub) {
              setIsVideoSelected(false);
              setSelectedAudioId(null);
              setSelectedBlurOverlayId(null);
            }
          }}
          selectedAudio={selectedAudio}
          onSelectAudio={(audioSub) => {
            setSelectedAudioId(audioSub ? audioSub.id : null);
            if (audioSub) {
              setSelectedSubtitleId(null);
              setIsVideoSelected(false);
              setSelectedTextOverlayId(null);
              setSelectedBlurOverlayId(null);
            }
          }}
          onUpdateAudioVolume={(subId, vol) => {
            setSubtitles((prev) =>
              prev.map((s) => (s.id === subId ? { ...s, audioVolume: vol } : s))
            );
          }}
          videoVolume={videoVolume}
          onChangeVideoVolume={setVideoVolume}
          videoSpeed={videoSpeed}
          onChangeVideoSpeed={setVideoSpeed}
          videoAudioEffect={videoAudioEffect}
          onChangeVideoAudioEffect={setVideoAudioEffect}
          onUpdateSubtitle={(updated) =>
            setSubtitles((prev) => {
              const updatedList = prev.map((s) => (s.id === updated.id ? updated : s));
              return resolveOverlapsWithPriority(updatedList, updated.id);
            })
          }
          onDeleteSubtitle={(id) => {
            setSubtitles((prev) => prev.filter((s) => s.id !== id));
            if (selectedSubtitleId === id) setSelectedSubtitleId(null);
          }}
          onExtractSingleFrame={handleExtractSingleFrame}
          isExtractingSingle={isExtractingSingle}
          onStartFullScan={handleStartFullScan}
          scanProgress={scanProgress}
          onCancelScan={handleCancelScan}
          videoDuration={videoDuration}
          onStartCapCutStt={handleStartCapCutStt}
          isSttRunning={isSttRunning}
          sttProgress={sttProgress}
          onCancelStt={handleCancelStt}
          targetLang={targetLang}
          onSelectTargetLang={setTargetLang}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onReTranslateAll={handleReTranslateAll}
          customContext={customContext}
          globalContext={globalContext}
          isTranslatingBatch={isTranslatingBatch}
          translationProgressMsg={translationProgressMsg}
          activeSubtitle={activeSubtitle}
          appSettings={appSettings}
          onSaveSettings={onSaveSettings}
          onPlayTTS={handlePlayTTS}
          onMergeShortSubtitles={handleMergeShortSubtitles}
          onGenerateAllAudio={handleGenerateAllAudio}
          isGeneratingAllAudio={isGeneratingAllAudio}
          onGenerateSingleAudio={handleGenerateSingleAudio}
          isGeneratingSingleAudio={isGeneratingSingleAudio}
          onPlaySingleAudio={handlePlaySingleAudio}
          onDeleteSingleAudio={handleDeleteSingleAudio}
          audioGenProgress={audioGenProgress}
          audioPlayWithVideo={audioPlayWithVideo}
          onToggleAudioPlayWithVideo={setAudioPlayWithVideo}
          onClearAllAudio={handleClearAllAudio}
          subtitles={subtitles}
          onAddSubtitle={() =>
            setSubtitles((prev) => {
              const newSub = {
                id: `manual-${Date.now()}`,
                startTime: currentTime,
                endTime: currentTime + 2.5,
                originalText: 'Nhập văn bản gốc...',
                translatedText: 'Nhập bản dịch...',
              };
              const newList = [...prev, newSub].sort((a, b) => a.startTime - b.startTime);
              return resolveOverlapsWithPriority(newList, newSub.id);
            })
          }
          styleConfig={styleConfig}
          onChangeStyle={setStyleConfig}
          onChangeRoi={setRoi}
          onOpenConfigDrawer={() => setShowConfigDrawer(true)}
          onReScanSubtitle={handleReScanSubtitle}
          onUpdateSubtitles={setSubtitles}
          blurOverlays={blurOverlays}
          onChangeBlurOverlays={setBlurOverlays}
          showBlurVirtualBorder={showBlurVirtualBorder}
          onToggleBlurVirtualBorder={setShowBlurVirtualBorder}
          logoOverlays={logoOverlays}
          onChangeLogoOverlays={setLogoOverlays}
          textOverlays={textOverlays}
          onChangeTextOverlays={setTextOverlays}
          currentTime={currentTime}
          onImportSRT={(file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              const content = e.target?.result as string;
              if (content) {
                const parsed = parseSRT(content);
                if (parsed.length > 0) {
                  setSubtitles(parsed);
                }
              }
            };
            reader.readAsText(file);
          }}
          onImportAudio={(file) => {
            alert(`Đã nhập file audio: ${file.name}`);
          }}
          onImportBgMusic={(file) => {
            setBgMusicTitle(file.name);
          }}
          bgMusicTitle={bgMusicTitle || undefined}
          selectedBlurOverlayId={selectedBlurOverlayId}
          onSelectBlurOverlay={setSelectedBlurOverlayId}
          selectedTextOverlayId={selectedTextOverlayId}
          onSelectTextOverlay={(overlay) => {
            setSelectedTextOverlayId(overlay ? overlay.id : null);
            if (overlay) setSelectedBlurOverlayId(null);
          }}
        />

        {/* Native File Pickers for '+ Tạo mới' and 'Thay thế' */}
        <input
          ref={newVideoFileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          className="hidden"
          onChange={handleNewVideoFileSelect}
        />
        <input
          ref={replaceVideoFileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          className="hidden"
          onChange={handleReplaceVideoFileSelect}
        />

        {(isExportOpen || (exportProgress && exportProgress.percentage < 100)) && (
          <div className={isExportOpen ? 'contents' : 'hidden'}>
            <ExportModal
              isOpen={isExportOpen || Boolean(exportProgress && exportProgress.percentage < 100)}
              onClose={() => setIsExportOpen(false)}
              subtitles={subtitles}
              onImportSubtitles={setSubtitles}
              videoUrl={videoUrl}
              videoDuration={videoDuration}
              styleConfig={{ ...styleConfig, roi } as any}
              projectTitle={projectTitle}
              onGenerateAllAudio={handleGenerateAllAudio}
              isGeneratingAllAudio={isGeneratingAllAudio}
              ttsSpeed={appSettings?.ttsSpeed || 1.0}
              ttsPitch={appSettings?.ttsPitch || 0}
              videoVolume={videoVolume}
              videoAudioEffect={videoAudioEffect}
              blurOverlays={blurOverlays}
              logoOverlays={logoOverlays}
              textOverlays={textOverlays}
              exportSettings={exportSettings}
              onOpenExportSettings={() => setShowExportSettingsDropdown(true)}
              onExportProgress={setExportProgress}
            />
          </div>
        )}

        {/* Inline Config Drawer styled matching Home screen cards */}
        {showConfigDrawer && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-[#121215] border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-4 pb-[calc(1rem+var(--app-safe-bottom))] sm:pb-4 max-h-[85dvh] overflow-y-auto shadow-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cấu Hình Hệ Thống</h3>
                    <p className="text-[10px] text-slate-400">Thay đổi API Key, Engine OCR, Proxy</p>
                  </div>
                </div>

                <button
                  onClick={() => setShowConfigDrawer(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <ConfigView
                settings={appSettings}
                onSaveSettings={onSaveSettings}
                onOpenLicense={onOpenLicense}
              />
            </div>
          </div>
        )}

        {/* TTS Audition Diagnostic Error Modal */}
        <TtsErrorModal
          isOpen={isTtsErrorModalOpen}
          onClose={() => setIsTtsErrorModalOpen(false)}
          errorInfo={ttsErrorInfo}
          onRetry={() => {
            if (lastTtsRetryParams) {
              handlePlayTTS(
                lastTtsRetryParams.text,
                lastTtsRetryParams.speed,
                lastTtsRetryParams.pitch,
                lastTtsRetryParams.providerOverride,
                lastTtsRetryParams.voiceOverride
              );
            }
          }}
          onOpenVieNeuDownloadModal={() => setIsVieNeuModalOpen(true)}
        />

        {/* VieNeu Model Download Management Modal */}
        <VieNeuModelDownloadModal
          isOpen={isVieNeuModalOpen}
          onClose={() => setIsVieNeuModalOpen(false)}
        />

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      </div>
    </div>
  );
};
