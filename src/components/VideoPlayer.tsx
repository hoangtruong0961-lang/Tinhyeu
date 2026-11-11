import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Crop,
  Play,
  Pause,
  Camera,
  AlertCircle,
  RefreshCw,
  Upload,
  Film,
  Cpu,
  Zap,
  Activity,
  Gauge,
  Edit3,
  Palette,
  Trash2,
  X,
  Maximize2,
  Move,
} from 'lucide-react';
import { RegionROI, SubtitleItem, SubtitleStyleConfig, OCRScanProgress, BlurOverlay, LogoOverlay, TextOverlay, VideoClip } from '../types';
import { wrapSubtitleText } from '../utils/srtParser';
import { buildTextShadowStyle, getSubtitleCssStyle } from '../utils/textEffectUtils';
import { renderCompositedFrame, wrapCanvasText, calculateRenderedSubtitleRect } from '../utils/canvasRenderer';
import { OutlinedSubtitleText } from './OutlinedSubtitleText';
import { getMediaFileUrlDB } from '../utils/idbStorage';
import { resolveApiUrl } from '../utils/apiUrl';

/**
 * Calculates accurate text bounding box based on canvas typography, font size,
 * line wrapping, and padding so the interactive selection box tightly hugs the rendered text.
 * Never collapses to a 1-word skinny column and never leaves empty space or distorted gaps.
 */
export const calculateTextOverlayBounds = (
  textItem: TextOverlay,
  vWidth: number,
  vHeight: number
): { widthPercent: number; heightPercent: number } => {
  const safeVWidth = Math.max(100, vWidth || 720);
  const safeVHeight = Math.max(100, vHeight || 1280);
  const scaleFactor = safeVHeight / 720;
  const fontSize = Math.max(8, Math.round((textItem.fontSize || 28) * scaleFactor));
  const fontFamily = textItem.fontFamily || 'Montserrat, sans-serif';
  const fontWeight = textItem.fontWeight || 'bold';
  const fontStyle = textItem.fontStyle || 'normal';
  const padding = (textItem.hasBackground !== false ? 6 : 2) * scaleFactor;

  const safeWrapPercent = Math.max(25, textItem.width || 50);

  let canvas = (calculateTextOverlayBounds as any)._canvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    (calculateTextOverlayBounds as any)._canvas = canvas;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const maxWrapWidth = Math.max(40, (safeWrapPercent / 100) * safeVWidth - padding * 2);
    const lines = wrapCanvasText(ctx, textItem.text || '', maxWrapWidth);
    const numLines = Math.max(1, lines.length);
    let maxLineWidth = 0;
    lines.forEach((line) => {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    });
    const boxWidth = maxLineWidth + padding * 2;
    const widthPercent = Math.min(96, Math.max(5, (boxWidth / safeVWidth) * 100));
    const lineHeight = fontSize * 1.25;
    const totalHeight = (numLines - 1) * lineHeight + fontSize * 0.95 + padding * 2;
    const heightPercent = Math.min(95, Math.max(2.0, (totalHeight / safeVHeight) * 100));
    return {
      widthPercent: Math.round(widthPercent * 10) / 10,
      heightPercent: Math.round(heightPercent * 10) / 10,
    };
  }

  const estLines = Math.max(1, Math.ceil((textItem.text || '').length / 18));
  const estHeight = ((estLines - 1) * fontSize * 1.25 + fontSize * 0.95 + padding * 2) / safeVHeight * 100;
  return {
    widthPercent: safeWrapPercent,
    heightPercent: Math.round(Math.max(2.0, estHeight) * 10) / 10,
  };
};

interface VideoPlayerProps {
  videoUrl: string;
  projectId?: string;
  roi: RegionROI;
  onChangeRoi: (newRoi: RegionROI) => void;
  activeSubtitle?: SubtitleItem | null;
  isSubtitleSelected?: boolean;
  onSelectSubtitle?: (sub: SubtitleItem | null) => void;
  onUpdateActiveSubtitleBox?: (newBox: { x: number; y: number; width: number; height: number }) => void;
  styleConfig: SubtitleStyleConfig;
  onChangeStyleConfig?: (newStyle: SubtitleStyleConfig) => void;
  onExtractSingleFrame: (currentTime: number, croppedBase64: string) => void;
  isExtractingSingle: boolean;
  onAutoDetectRoi?: () => void;
  isDetectingRoi?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onImportVideo?: (url: string, title?: string, file?: File, preserveExistingSubtitles?: boolean) => void;
  onOpenImportModal?: () => void;
  showRoiBox?: boolean;
  scanProgress?: OCRScanProgress;
  blurOverlays?: BlurOverlay[];
  onChangeBlurOverlays?: (overlays: BlurOverlay[]) => void;
  showBlurVirtualBorder?: boolean;
  selectedBlurOverlayId?: string | null;
  onSelectBlurOverlay?: (id: string | null) => void;
  logoOverlays?: LogoOverlay[];
  onChangeLogoOverlays?: (overlays: LogoOverlay[]) => void;
  textOverlays?: TextOverlay[];
  onChangeTextOverlays?: (overlays: TextOverlay[]) => void;
  selectedTextOverlayId?: string | null;
  onSelectTextOverlay?: (overlay: TextOverlay | null) => void;
  onEditTextOverlay?: (textItem: TextOverlay) => void;
  onOpenTextOverlayConfig?: (textItem: TextOverlay) => void;
  onDeleteTextOverlay?: (id: string) => void;
  clips?: VideoClip[];
  activeClipIndex?: number;
  onChangeActiveClipIndex?: (index: number) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  projectId,
  roi,
  onChangeRoi,
  activeSubtitle,
  isSubtitleSelected = false,
  onSelectSubtitle,
  onUpdateActiveSubtitleBox,
  styleConfig,
  onChangeStyleConfig,
  onExtractSingleFrame,
  isExtractingSingle,
  onAutoDetectRoi,
  isDetectingRoi,
  onTimeUpdate,
  onLoadedMetadata,
  videoRef,
  isPlaying = false,
  onTogglePlay,
  onImportVideo,
  onOpenImportModal,
  showRoiBox = false,
  scanProgress,
  blurOverlays = [],
  onChangeBlurOverlays,
  showBlurVirtualBorder = true,
  selectedBlurOverlayId = null,
  onSelectBlurOverlay,
  logoOverlays = [],
  onChangeLogoOverlays,
  textOverlays = [],
  onChangeTextOverlays,
  selectedTextOverlayId = null,
  onSelectTextOverlay,
  onEditTextOverlay,
  onOpenTextOverlayConfig,
  onDeleteTextOverlay,
  clips,
  activeClipIndex,
  onChangeActiveClipIndex,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fittedBox, setFittedBox] = useState<{ width: number; height: number } | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const [internalActiveClipIndex, setInternalActiveClipIndex] = useState<number>(0);
  const activeClipIndexActual = activeClipIndex !== undefined ? activeClipIndex : internalActiveClipIndex;
  const setActiveClipIndexActual = onChangeActiveClipIndex !== undefined ? onChangeActiveClipIndex : setInternalActiveClipIndex;

  const clipStartTimes = React.useMemo(() => {
    if (!clips || clips.length === 0) return [0];
    const starts: number[] = [];
    let accum = 0;
    for (const c of clips) {
      starts.push(accum);
      accum += c.duration;
    }
    return starts;
  }, [clips]);

  const totalDuration = React.useMemo(() => {
    if (!clips || clips.length === 0) return 0;
    return clips.reduce((sum, c) => sum + c.duration, 0);
  }, [clips]);

  // Exact rendered bounding box of <video> inside containerRef (accounting for object-contain letterboxing/pillarboxing)
  const [videoDisplayRect, setVideoDisplayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>({ left: 0, top: 0, width: 0, height: 0 });
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const videoDisplayRectRef = useRef(videoDisplayRect);
  useEffect(() => {
    videoDisplayRectRef.current = videoDisplayRect;
  }, [videoDisplayRect]);

  const updateVideoDisplayRect = useCallback(() => {
    if (!containerRef.current || !videoRef.current) return;
    const video = videoRef.current;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const cWidth = containerRect.width;
    const cHeight = containerRect.height;
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;

    if (vWidth > 0 && vHeight > 0) {
      const vAspect = vWidth / vHeight;
      setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
    }

    if (!cWidth || !cHeight || !vWidth || !vHeight) {
      if (cWidth && cHeight) {
        setVideoDisplayRect((prev) => {
          if (
            prev.left === 0 &&
            prev.top === 0 &&
            Math.abs(prev.width - cWidth) < 0.5 &&
            Math.abs(prev.height - cHeight) < 0.5
          ) {
            return prev;
          }
          return { left: 0, top: 0, width: cWidth, height: cHeight };
        });
      }
      return;
    }

    const containerAspect = cWidth / cHeight;
    const videoAspect = vWidth / vHeight;

    let renderWidth = cWidth;
    let renderHeight = cHeight;
    let renderLeft = 0;
    let renderTop = 0;

    if (Math.abs(videoAspect - containerAspect) > 0.005) {
      if (videoAspect > containerAspect) {
        // Video is wider than container -> letterbox top & bottom
        renderHeight = cWidth / videoAspect;
        renderTop = (cHeight - renderHeight) / 2;
      } else {
        // Video is taller/narrower than container -> pillarbox left & right
        renderWidth = cHeight * videoAspect;
        renderLeft = (cWidth - renderWidth) / 2;
      }
    }

    setVideoDisplayRect((prev) => {
      if (
        Math.abs(prev.left - renderLeft) < 0.5 &&
        Math.abs(prev.top - renderTop) < 0.5 &&
        Math.abs(prev.width - renderWidth) < 0.5 &&
        Math.abs(prev.height - renderHeight) < 0.5
      ) {
        return prev;
      }
      return {
        left: renderLeft,
        top: renderTop,
        width: renderWidth,
        height: renderHeight,
      };
    });
  }, [videoRef]);

  const calculateFittedBox = useCallback(() => {
    if (!wrapperRef.current) return;
    const w = wrapperRef.current.clientWidth;
    const h = wrapperRef.current.clientHeight;
    if (w <= 0 || h <= 0) return;

    if (!videoAspectRatio || videoAspectRatio <= 0) {
      setFittedBox({ width: w, height: h });
      return;
    }

    const wrapperAspect = w / h;
    if (videoAspectRatio >= wrapperAspect) {
      const targetW = w;
      const targetH = Math.round(w / videoAspectRatio);
      setFittedBox({ width: targetW, height: targetH });
    } else {
      const targetH = h;
      const targetW = Math.round(h * videoAspectRatio);
      setFittedBox({ width: targetW, height: targetH });
    }
  }, [videoAspectRatio]);

  useEffect(() => {
    calculateFittedBox();
  }, [calculateFittedBox]);

  // Keep videoDisplayRect synchronized on resize, metadata load, video events, or orientation change
  useEffect(() => {
    calculateFittedBox();
    updateVideoDisplayRect();
    const video = videoRef.current;

    const handleVideoSync = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const vAspect = video.videoWidth / video.videoHeight;
        setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
      }
      calculateFittedBox();
      updateVideoDisplayRect();
    };

    if (video) {
      video.addEventListener('loadedmetadata', handleVideoSync);
      video.addEventListener('loadeddata', handleVideoSync);
      video.addEventListener('canplay', handleVideoSync);
      video.addEventListener('playing', handleVideoSync);
      video.addEventListener('resize', handleVideoSync);
    }

    let animFrameId: number;
    const pollForDimensions = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const vAspect = video.videoWidth / video.videoHeight;
        setVideoAspectRatio((prev) => (prev !== vAspect ? vAspect : prev));
        calculateFittedBox();
        updateVideoDisplayRect();
      } else {
        animFrameId = requestAnimationFrame(pollForDimensions);
      }
    };
    pollForDimensions();

    let resizeRafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        calculateFittedBox();
        updateVideoDisplayRect();
      });
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    const handleWindowResize = () => {
      calculateFittedBox();
      updateVideoDisplayRect();
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      if (video) {
        video.removeEventListener('loadedmetadata', handleVideoSync);
        video.removeEventListener('loadeddata', handleVideoSync);
        video.removeEventListener('canplay', handleVideoSync);
        video.removeEventListener('playing', handleVideoSync);
        video.removeEventListener('resize', handleVideoSync);
      }
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [calculateFittedBox, updateVideoDisplayRect, videoUrl]);

  // High-performance cached geometry metrics to avoid DOM reflows during active touch/mouse dragging
  interface DragMetrics {
    rectLeft: number;
    rectTop: number;
    vLeft: number;
    vTop: number;
    finalWidth: number;
    finalHeight: number;
  }
  const dragMetricsRef = useRef<DragMetrics | null>(null);

  const captureDragMetrics = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const video = videoRef.current;
    const vRect = videoDisplayRectRef.current;

    let vLeft = vRect.left;
    let vTop = vRect.top;
    let vWidth = vRect.width;
    let vHeight = vRect.height;

    if ((!vWidth || !vHeight) && video && video.videoWidth > 0 && video.videoHeight > 0 && rect.width > 0 && rect.height > 0) {
      const containerAspect = rect.width / rect.height;
      const videoAspect = video.videoWidth / video.videoHeight;
      if (videoAspect > containerAspect) {
        vWidth = rect.width;
        vHeight = rect.width / videoAspect;
        vLeft = 0;
        vTop = (rect.height - vHeight) / 2;
      } else {
        vWidth = rect.height * videoAspect;
        vHeight = rect.height;
        vLeft = (rect.width - vWidth) / 2;
        vTop = 0;
      }
    }

    const finalWidth = vWidth || rect.width || 1;
    const finalHeight = vHeight || rect.height || 1;

    dragMetricsRef.current = {
      rectLeft: rect.left,
      rectTop: rect.top,
      vLeft,
      vTop,
      finalWidth,
      finalHeight,
    };
  };

  const getFastRelativePos = (clientX: number, clientY: number) => {
    let m = dragMetricsRef.current;
    if (!m) {
      captureDragMetrics();
      m = dragMetricsRef.current;
    }
    if (!m) return { xPercent: 0, yPercent: 0 };

    const clickX = clientX - (m.rectLeft + m.vLeft);
    const clickY = clientY - (m.rectTop + m.vTop);

    const xPercent = (clickX / m.finalWidth) * 100;
    const yPercent = (clickY / m.finalHeight) * 100;

    return { xPercent, yPercent };
  };

  const getContainerRelativePosFromClient = (clientX: number, clientY: number) => {
    return getFastRelativePos(clientX, clientY);
  };

  // Synchronized refs for fast 60fps drag without re-attaching event listeners
  const blurOverlaysRef = useRef(blurOverlays);
  const logoOverlaysRef = useRef(logoOverlays);
  const textOverlaysRef = useRef(textOverlays);
  const onChangeBlurOverlaysRef = useRef(onChangeBlurOverlays);
  const onChangeLogoOverlaysRef = useRef(onChangeLogoOverlays);
  const onChangeTextOverlaysRef = useRef(onChangeTextOverlays);
  const styleConfigRef = useRef(styleConfig);
  const onChangeStyleConfigRef = useRef(onChangeStyleConfig);

  useEffect(() => {
    blurOverlaysRef.current = blurOverlays;
    logoOverlaysRef.current = logoOverlays;
    textOverlaysRef.current = textOverlays;
    onChangeBlurOverlaysRef.current = onChangeBlurOverlays;
    onChangeLogoOverlaysRef.current = onChangeLogoOverlays;
    onChangeTextOverlaysRef.current = onChangeTextOverlays;
    styleConfigRef.current = styleConfig;
    onChangeStyleConfigRef.current = onChangeStyleConfig;
  });

  // Dragging states for custom overlays (Blur, Logo, Text)
  const [dragOverlay, setDragOverlay] = useState<{
    type: 'blur' | 'logo' | 'text';
    id: string;
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'pinch' | 'scale' | 'width-e' | 'width-w';
    startPos: { x: number; y: number };
    startRect: { x: number; y: number; width: number; height: number };
    startFontSize?: number;
  } | null>(null);

  // Local live state for zero-latency 60fps preview rendering during drag
  const [liveOverlay, setLiveOverlay] = useState<{
    id: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const lastOverlayRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const initialTextPinchDistRef = useRef<number>(0);
  const initialTextPinchFontSizeRef = useRef<number>(24);

  const handleStartDragOverlay = (
    e: React.MouseEvent | React.TouchEvent,
    type: 'blur' | 'logo' | 'text',
    id: string,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'pinch' | 'scale' | 'width-e' | 'width-w',
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    captureDragMetrics();

    let clientX = 0;
    let clientY = 0;
    const actualMode = type === 'text' ? 'move' : mode;

    if ('touches' in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        return;
      }
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return;
    }

    const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
    const currentText = textOverlaysRef.current.find(t => t.id === id);
    setDragOverlay({
      type,
      id,
      mode: actualMode,
      startPos: { x: xPercent, y: yPercent },
      startRect: { ...rect },
      startFontSize: currentText?.fontSize || 28,
    });
    setLiveOverlay({
      id,
      rect: { ...rect },
    });
    lastOverlayRectRef.current = { ...rect };
  };

  useEffect(() => {
    if (!dragOverlay) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      // Prevent browser native scrolling or pull-to-refresh during drag
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }

      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
      const deltaX = xPercent - dragOverlay.startPos.x;
      const deltaY = yPercent - dragOverlay.startPos.y;

      const nextRect = { ...dragOverlay.startRect };

      if (dragOverlay.type === 'text') {
        // Text overlay on preview is strictly move-only
        const itemWidth = dragOverlay.startRect.width || 40;
        let newX = Math.max(0, Math.min(100 - itemWidth, dragOverlay.startRect.x + deltaX));
        let newY = Math.max(0, Math.min(95, dragOverlay.startRect.y + deltaY));

        // Center snap guide for text overlay positioning (horizontal center of box = 50%)
        const currentCenterX = newX + itemWidth / 2;
        if (Math.abs(currentCenterX - 50) < 2.0) {
          newX = 50 - itemWidth / 2;
          setShowSubSubCenterGuide(true);
        } else {
          setShowSubSubCenterGuide(false);
        }

        nextRect.x = Math.round(newX * 10) / 10;
        nextRect.y = Math.round(newY * 10) / 10;
      } else {
        // Standard rectangular resize for blur and logo overlays
        if (dragOverlay.mode === 'move') {
          nextRect.x = Math.max(0, Math.min(100 - dragOverlay.startRect.width, dragOverlay.startRect.x + deltaX));
          nextRect.y = Math.max(0, Math.min(100 - dragOverlay.startRect.height, dragOverlay.startRect.y + deltaY));
          nextRect.x = Math.round(nextRect.x * 10) / 10;
          nextRect.y = Math.round(nextRect.y * 10) / 10;
        } else if (dragOverlay.mode === 'se') {
          nextRect.width = Math.max(5, Math.min(100 - dragOverlay.startRect.x, dragOverlay.startRect.width + deltaX));
          nextRect.height = Math.max(5, Math.min(100 - dragOverlay.startRect.y, dragOverlay.startRect.height + deltaY));
          nextRect.width = Math.round(nextRect.width * 10) / 10;
          nextRect.height = Math.round(nextRect.height * 10) / 10;
        } else if (dragOverlay.mode === 'sw') {
          const newX = Math.max(0, Math.min(dragOverlay.startRect.x + dragOverlay.startRect.width - 5, dragOverlay.startRect.x + deltaX));
          nextRect.width = dragOverlay.startRect.width + (dragOverlay.startRect.x - newX);
          nextRect.x = newX;
          nextRect.height = Math.max(5, Math.min(100 - dragOverlay.startRect.y, dragOverlay.startRect.height + deltaY));
          nextRect.x = Math.round(nextRect.x * 10) / 10;
          nextRect.width = Math.round(nextRect.width * 10) / 10;
          nextRect.height = Math.round(nextRect.height * 10) / 10;
        } else if (dragOverlay.mode === 'ne') {
          const newY = Math.max(0, Math.min(dragOverlay.startRect.y + dragOverlay.startRect.height - 5, dragOverlay.startRect.y + deltaY));
          nextRect.height = dragOverlay.startRect.height + (dragOverlay.startRect.y - newY);
          nextRect.y = newY;
          nextRect.width = Math.max(5, Math.min(100 - dragOverlay.startRect.x, dragOverlay.startRect.width + deltaX));
          nextRect.y = Math.round(nextRect.y * 10) / 10;
          nextRect.width = Math.round(nextRect.width * 10) / 10;
          nextRect.height = Math.round(nextRect.height * 10) / 10;
        } else if (dragOverlay.mode === 'nw') {
          const newX = Math.max(0, Math.min(dragOverlay.startRect.x + dragOverlay.startRect.width - 5, dragOverlay.startRect.x + deltaX));
          const newY = Math.max(0, Math.min(dragOverlay.startRect.y + dragOverlay.startRect.height - 5, dragOverlay.startRect.y + deltaY));
          nextRect.width = dragOverlay.startRect.width + (dragOverlay.startRect.x - newX);
          nextRect.height = dragOverlay.startRect.height + (dragOverlay.startRect.y - newY);
          nextRect.x = newX;
          nextRect.y = newY;
          nextRect.x = Math.round(nextRect.x * 10) / 10;
          nextRect.y = Math.round(nextRect.y * 10) / 10;
          nextRect.width = Math.round(nextRect.width * 10) / 10;
          nextRect.height = Math.round(nextRect.height * 10) / 10;
        }
      }

      // 1. Instant local visual update for zero-latency dragging
      setLiveOverlay({ id: dragOverlay.id, rect: nextRect });
      lastOverlayRectRef.current = nextRect;

      // 2. Throttle parent state update via requestAnimationFrame
      if (overlayRafRef.current) {
        cancelAnimationFrame(overlayRafRef.current);
      }
      overlayRafRef.current = requestAnimationFrame(() => {
        if (dragOverlay.type === 'blur' && onChangeBlurOverlaysRef.current) {
          onChangeBlurOverlaysRef.current(blurOverlaysRef.current.map(b => b.id === dragOverlay.id ? { ...b, ...nextRect } : b));
        } else if (dragOverlay.type === 'logo' && onChangeLogoOverlaysRef.current) {
          onChangeLogoOverlaysRef.current(logoOverlaysRef.current.map(l => l.id === dragOverlay.id ? { ...l, ...nextRect } : l));
        } else if (dragOverlay.type === 'text' && onChangeTextOverlaysRef.current) {
          const fs = (nextRect as any).fontSize;
          onChangeTextOverlaysRef.current(
            textOverlaysRef.current.map(t =>
              t.id === dragOverlay.id
                ? { ...t, ...nextRect, ...(fs ? { fontSize: fs } : {}) }
                : t
            )
          );
        }
      });
    };

    const handlePointerUp = () => {
      if (overlayRafRef.current) {
        cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      // Guaranteed final commit on pointer release
      if (lastOverlayRectRef.current) {
        const finalRect = lastOverlayRectRef.current;
        if (dragOverlay.type === 'blur' && onChangeBlurOverlaysRef.current) {
          onChangeBlurOverlaysRef.current(blurOverlaysRef.current.map(b => b.id === dragOverlay.id ? { ...b, ...finalRect } : b));
        } else if (dragOverlay.type === 'logo' && onChangeLogoOverlaysRef.current) {
          onChangeLogoOverlaysRef.current(logoOverlaysRef.current.map(l => l.id === dragOverlay.id ? { ...l, ...finalRect } : l));
        } else if (dragOverlay.type === 'text' && onChangeTextOverlaysRef.current) {
          const fs = (finalRect as any).fontSize;
          onChangeTextOverlaysRef.current(
            textOverlaysRef.current.map(t =>
              t.id === dragOverlay.id
                ? { ...t, ...finalRect, ...(fs ? { fontSize: fs } : {}) }
                : t
            )
          );
        }
      }
      setDragOverlay(null);
      setLiveOverlay(null);
      lastOverlayRectRef.current = null;
      setShowSubSubCenterGuide(false);
      dragMetricsRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
      if (overlayRafRef.current) {
        cancelAnimationFrame(overlayRafRef.current);
      }
    };
  }, [dragOverlay]);

  // Active target box for mask and subtitle auto-alignment
  const activeBox = activeSubtitle?.boundingBox || roi;

  // Detect if videoUrl is an iframe embed URL (e.g. YouTube embed)
  const isEmbedUrl = Boolean(
    videoUrl &&
    (videoUrl.includes('youtube.com/embed/') ||
     videoUrl.includes('youtube-nocookie.com/embed/') ||
     videoUrl.includes('player.vimeo.com/video/'))
  );

  // Video fallback CORS and error management
  const [useCrossOrigin, setUseCrossOrigin] = useState<boolean>(
    Boolean(videoUrl && !videoUrl.startsWith('blob:') && !isEmbedUrl)
  );
  const [hasLoadError, setHasLoadError] = useState<boolean>(false);

  useEffect(() => {
    setHasLoadError(false);
    setUseCrossOrigin(Boolean(videoUrl && !videoUrl.startsWith('blob:') && !isEmbedUrl));
  }, [videoUrl, isEmbedUrl]);

  const handleVideoError = async () => {
    // Media error code 1 is MEDIA_ERR_ABORTED (interrupted by new load or user navigation)
    if (videoRef.current?.error?.code === 1) {
      console.warn('[VideoPlayer] Video load aborted cleanly, skipping error state.');
      return;
    }

    if (useCrossOrigin) {
      console.warn('Video load error with crossOrigin="anonymous", retrying without crossOrigin...');
      setUseCrossOrigin(false);
      if (videoRef.current) {
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, 50);
      }
      return;
    }

    // Auto-recovery 1: Try restoring video blob from IndexedDB (check active clip, project ID, and all clips)
    const activeClip = (clips && clips.length > 0 && clips[activeClipIndexActual]) ? clips[activeClipIndexActual] : null;
    const candidateIds = [
      activeClip?.id,
      projectId,
      ...(clips || []).map((c) => c.id),
    ].filter(Boolean) as string[];

    if (candidateIds.length > 0) {
      try {
        const restoredUrl = await getMediaFileUrlDB(candidateIds[0], candidateIds.slice(1));
        if (restoredUrl && restoredUrl !== videoUrl && onImportVideo) {
          console.log(`[VideoPlayer] Successfully auto-recovered video from IndexedDB for ${candidateIds[0]}`);
          setHasLoadError(false);
          onImportVideo(restoredUrl, undefined, undefined, true);
          return;
        }
      } catch (err) {
        console.warn('[VideoPlayer] IndexedDB video recovery attempt failed:', err);
      }
    }

    // Auto-recovery 2: If it's a remote URL, auto-retry via streaming proxy
    if (
      videoUrl &&
      (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) &&
      !videoUrl.includes('/api/proxy-video') &&
      onImportVideo
    ) {
      console.warn('Direct video URL failed to stream, auto-retrying via /api/proxy-video proxy stream...');
      const proxiedUrl = resolveApiUrl(`/api/proxy-video?url=${encodeURIComponent(videoUrl)}`);
      onImportVideo(proxiedUrl, undefined, undefined, true);
      return;
    }

    console.error('Video element failed to load source:', videoUrl);
    setHasLoadError(true);
  };

  // Helper to calculate RGBA background with opacity
  const getBgColorWithOpacity = (hexColor: string, opacity: number = 65) => {
    if (!hexColor) return `rgba(0, 0, 0, ${opacity / 100})`;
    if (hexColor.startsWith('rgba')) return hexColor;
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const num = parseInt(hex, 16);
    if (isNaN(num)) return `rgba(0, 0, 0, ${opacity / 100})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${(opacity / 100).toFixed(2)})`;
  };

  // Dragging states for ROI box
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragMode, setDragMode] = useState<
    'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null
  >(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [startRoi, setStartRoi] = useState<RegionROI>(roi);
  const [liveRoi, setLiveRoi] = useState<RegionROI | null>(null);
  const roiRafRef = useRef<number | null>(null);
  const lastRoiRef = useRef<RegionROI | null>(null);

  // Subtitle Overlay Interactive Drag Handling (Mouse & Touch) - Strictly move-only on video preview
  const [isSubDragging, setIsSubDragging] = useState<boolean>(false);
  const [showSubCenterGuide, setShowSubSubCenterGuide] = useState<boolean>(false);
  const [subDragMode, setSubDragMode] = useState<'move' | null>(null);
  const [subDragStart, setSubDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [subStartBox, setSubStartBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 10,
    y: 76,
    width: 80,
    height: 20,
  });
  // Instant visual box for subtitle zero-latency touch updates
  const [subLiveBox, setSubLiveBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const subRafRef = useRef<number | null>(null);
  const lastSubBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const startDraggingSub = (
    clientX: number,
    clientY: number
  ) => {
    captureDragMetrics();
    setIsSubDragging(true);
    setSubDragMode('move');
    const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
    setSubDragStart({ x: xPercent, y: yPercent });
    const currentBox = subLiveBox || activeSubtitle?.boundingBox || roi;
    setSubStartBox(currentBox);
    setSubLiveBox(currentBox);
    lastSubBoxRef.current = currentBox;
  };

  const handleStartDragSubtitle = (
    e: React.MouseEvent | React.TouchEvent,
    _mode: 'move' = 'move'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if ('touches' in e) {
      if (e.touches.length > 0) {
        startDraggingSub(e.touches[0].clientX, e.touches[0].clientY);
      }
    } else if ('clientX' in e) {
      startDraggingSub(e.clientX, e.clientY);
    }
  };

  useEffect(() => {
    if (!isSubDragging || !subDragMode) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      // Prevent browser pull-to-refresh or page dragging during subtitle interaction
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }

      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
      const deltaX = xPercent - subDragStart.x;
      const deltaY = yPercent - subDragStart.y;

      const subText = activeSubtitle ? (activeSubtitle.translatedText || activeSubtitle.originalText || '') : '';
      if (subDragMode === 'move') {
        const rendered = calculateRenderedSubtitleRect(
          subText,
          styleConfigRef.current,
          subStartBox,
          videoDisplayRect.width || 720,
          videoDisplayRect.height || 1280
        );
        const subWidth = rendered.widthPercent || 40;
        let newX = Math.max(0, Math.min(100 - subWidth, subStartBox.x + deltaX));
        let newY = Math.max(0, Math.min(95, subStartBox.y + deltaY));

        // Center snap guide (horizontal center = 50%)
        const currentCenterX = newX + (subStartBox.width ? subStartBox.width / 2 : subWidth / 2);
        if (Math.abs(currentCenterX - 50) < 2.0) {
          newX = 50 - (subStartBox.width ? subStartBox.width / 2 : subWidth / 2);
          setShowSubSubCenterGuide(true);
        } else {
          setShowSubSubCenterGuide(false);
        }

        const nextBox = {
          ...subStartBox,
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
        };

        setSubLiveBox(nextBox);
        lastSubBoxRef.current = nextBox;

        if (subRafRef.current) {
          cancelAnimationFrame(subRafRef.current);
        }
        subRafRef.current = requestAnimationFrame(() => {
          if (onUpdateActiveSubtitleBox) {
            onUpdateActiveSubtitleBox(nextBox);
          }
        });
      }
    };

    const handlePointerUp = () => {
      if (subRafRef.current) {
        cancelAnimationFrame(subRafRef.current);
        subRafRef.current = null;
      }
      if (lastSubBoxRef.current && onUpdateActiveSubtitleBox) {
        onUpdateActiveSubtitleBox(lastSubBoxRef.current);
      }
      setIsSubDragging(false);
      setSubDragMode(null);
      setSubLiveBox(null);
      lastSubBoxRef.current = null;
      setShowSubSubCenterGuide(false);
      dragMetricsRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
      if (subRafRef.current) {
        cancelAnimationFrame(subRafRef.current);
      }
    };
  }, [isSubDragging, subDragMode, subDragStart, subStartBox, onUpdateActiveSubtitleBox, activeSubtitle, videoDisplayRect]);

  const handleTimeUpdateInternal = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    
    if (clips && clips.length > 1) {
      const absoluteTime = (clipStartTimes[activeClipIndexActual] || 0) + t;
      setCurrentTime(absoluteTime);
      if (onTimeUpdate) onTimeUpdate(absoluteTime);
    } else {
      setCurrentTime(t);
      if (onTimeUpdate) onTimeUpdate(t);
    }
  };

  const handleLoadedMetadataInternal = () => {
    if (!videoRef.current) return;
    setHasLoadError(false);
    updateVideoDisplayRect();
    const d = videoRef.current.duration;
    if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      setVideoAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
    }
    
    if (clips && clips.length > 1) {
      if (onLoadedMetadata) onLoadedMetadata(totalDuration);
    } else {
      if (onLoadedMetadata && !isNaN(d)) onLoadedMetadata(d);
    }
  };

  const handleVideoEndedInternal = () => {
    if (clips && clips.length > 1 && activeClipIndexActual < clips.length - 1) {
      const nextIndex = activeClipIndexActual + 1;
      setActiveClipIndexActual(nextIndex);
      
      const nextClip = clips[nextIndex];
      if (videoRef.current) {
        videoRef.current.src = nextClip.url;
        videoRef.current.currentTime = 0;
        if (isPlaying) {
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((err: any) => {
              if (err?.name !== 'AbortError' && !err?.message?.includes('interrupted')) {
                console.warn('[VideoPlayer] Play failed:', err);
              }
            });
          }
        }
      }
    }
  };

  // Unified WebGL / Canvas Viewport Engine (100% pixel parity with Export)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoBitmapsRef = useRef<Record<string, HTMLImageElement>>({});

  // Preload logo images into bitmaps cache for real-time canvas rendering
  useEffect(() => {
    logoOverlays.forEach((logo) => {
      if (logo.url && !logoBitmapsRef.current[logo.id]) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = logo.url;
        img.onload = () => {
          logoBitmapsRef.current[logo.id] = img;
          renderCanvas();
        };
      }
    });
  }, [logoOverlays]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const rect = videoDisplayRectRef.current;
    if (!rect || !rect.width || !rect.height) return;

    // High-definition subtitle resolution engine: render preview canvas at native video resolution
    // or super-sampled pixel density (up to 3840px / 4K) so subtitle text, vector outlines, and OCR previews are crystal sharp.
    const vNatW = video.videoWidth || 1080;
    const vNatH = video.videoHeight || 1920;
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    const calcW = Math.max(vNatW, Math.round(rect.width * dpr * 1.5));
    const calcH = Math.max(vNatH, Math.round(rect.height * dpr * 1.5));
    const targetW = Math.max(1, Math.min(calcW, 3840));
    const targetH = Math.max(1, Math.min(calcH, 3840));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    } catch (_) {}

    try {
      renderCompositedFrame(ctx, {
        videoSource: video.readyState >= 2 && video.videoWidth > 0 ? video : undefined,
        vWidth: targetW,
        vHeight: targetH,
        curTime: video.currentTime || 0,
        subtitles: activeSubtitle ? [activeSubtitle] : [],
        activeSubtitle,
        styleConfig,
        blurOverlays,
        logoOverlays,
        textOverlays,
        logoBitmaps: logoBitmapsRef.current,
        subLiveBox,
        liveRoi,
        liveOverlay,
        skipBaseVideo: true,
      });
    } catch (renderErr) {
      console.warn('[VideoPlayer] renderCanvas safe catch:', renderErr);
    }
  }, [
    activeSubtitle,
    styleConfig,
    blurOverlays,
    logoOverlays,
    textOverlays,
    subLiveBox,
    liveRoi,
    liveOverlay,
    videoRef,
  ]);

  // Continuous RAF loop during playback & reactive redraw on prop/time update
  useEffect(() => {
    let animId: number;
    let isMounted = true;

    const loop = () => {
      if (!isMounted) return;
      renderCanvas();
      if (isPlaying) {
        animId = requestAnimationFrame(loop);
      }
    };

    renderCanvas();

    if (isPlaying) {
      animId = requestAnimationFrame(loop);
    }

    return () => {
      isMounted = false;
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, renderCanvas]);

  useEffect(() => {
    renderCanvas();
  }, [
    videoDisplayRect,
    currentTime,
    activeSubtitle,
    styleConfig,
    blurOverlays,
    logoOverlays,
    textOverlays,
    subLiveBox,
    liveRoi,
    liveOverlay,
    renderCanvas,
  ]);

  // Helper to crop video frame according to current ROI
  const captureCroppedFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    const cropX = (roi.x / 100) * vWidth;
    const cropY = (roi.y / 100) * vHeight;
    const cropW = (roi.width / 100) * vWidth;
    const cropH = (roi.height / 100) * vHeight;

    const targetW = Math.max(1280, Math.round(cropW * 2.0));
    const targetH = Math.max(256, Math.round(cropH * 2.0));

    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        video,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        canvas.width,
        canvas.height
      );
      return canvas.toDataURL('image/jpeg', 0.95);
    } catch (e) {
      console.error('Error rendering cropped frame to canvas:', e);
      return null;
    }
  }, [roi, videoRef]);

  const handleExtractClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cropped = captureCroppedFrame();
    if (cropped) {
      onExtractSingleFrame(currentTime, cropped);
    }
  };

  // ROI Interactive Drag & Scale Handling (Mouse & Touch)
  const startDraggingROI = (
    clientX: number,
    clientY: number,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  ) => {
    captureDragMetrics();
    setIsDragging(true);
    setDragMode(mode);
    const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
    setDragStart({ x: xPercent, y: yPercent });
    setStartRoi({ ...roi });
    setLiveRoi({ ...roi });
    lastRoiRef.current = { ...roi };
  };

  const handleStartDrag = (
    e: React.MouseEvent | React.TouchEvent,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if ('touches' in e && e.touches.length > 0) {
      startDraggingROI(e.touches[0].clientX, e.touches[0].clientY, mode);
    } else if ('clientX' in e) {
      startDraggingROI(e.clientX, e.clientY, mode);
    }
  };

  // Global pointer listeners during active ROI drag
  useEffect(() => {
    if (!isDragging || !dragMode) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }

      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      } else {
        return;
      }

      const { xPercent, yPercent } = getFastRelativePos(clientX, clientY);
      const deltaX = xPercent - dragStart.x;
      const deltaY = yPercent - dragStart.y;

      const nextRoi = { ...startRoi };

      if (dragMode === 'move') {
        nextRoi.x = Math.max(0, Math.min(100 - startRoi.width, startRoi.x + deltaX));
        nextRoi.y = Math.max(0, Math.min(100 - startRoi.height, startRoi.y + deltaY));
      } else if (dragMode === 'se') {
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'sw') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.x = newX;
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'ne') {
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.y = newY;
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
      } else if (dragMode === 'nw') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.x = newX;
        nextRoi.y = newY;
      } else if (dragMode === 'n') {
        const newY = Math.max(0, Math.min(startRoi.y + startRoi.height - 3, startRoi.y + deltaY));
        nextRoi.height = startRoi.height + (startRoi.y - newY);
        nextRoi.y = newY;
      } else if (dragMode === 's') {
        nextRoi.height = Math.max(3, Math.min(100 - startRoi.y, startRoi.height + deltaY));
      } else if (dragMode === 'w') {
        const newX = Math.max(0, Math.min(startRoi.x + startRoi.width - 4, startRoi.x + deltaX));
        nextRoi.width = startRoi.width + (startRoi.x - newX);
        nextRoi.x = newX;
      } else if (dragMode === 'e') {
        nextRoi.width = Math.max(4, Math.min(100 - startRoi.x, startRoi.width + deltaX));
      }

      nextRoi.x = Math.round(nextRoi.x * 10) / 10;
      nextRoi.y = Math.round(nextRoi.y * 10) / 10;
      nextRoi.width = Math.round(nextRoi.width * 10) / 10;
      nextRoi.height = Math.round(nextRoi.height * 10) / 10;

      // 1. Instant local visual update
      setLiveRoi(nextRoi);
      lastRoiRef.current = nextRoi;

      // 2. Throttle parent update via RAF
      if (roiRafRef.current) {
        cancelAnimationFrame(roiRafRef.current);
      }
      roiRafRef.current = requestAnimationFrame(() => {
        onChangeRoi(nextRoi);
      });
    };

    const handlePointerUp = () => {
      if (roiRafRef.current) {
        cancelAnimationFrame(roiRafRef.current);
        roiRafRef.current = null;
      }
      if (lastRoiRef.current) {
        onChangeRoi(lastRoiRef.current);
      }
      setIsDragging(false);
      setDragMode(null);
      setLiveRoi(null);
      lastRoiRef.current = null;
      dragMetricsRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
      if (roiRafRef.current) {
        cancelAnimationFrame(roiRafRef.current);
      }
    };
  }, [isDragging, dragMode, dragStart, startRoi, onChangeRoi]);

  return (
    <div 
      ref={wrapperRef}
      className="w-full h-full max-h-full flex items-center justify-center flex-1 relative isolate min-h-0 overflow-hidden p-0 sm:p-0.5"
    >
      {/* Dynamic Video Preview Frame - Automatically scales and adapts to the video aspect ratio */}
      <div
        ref={containerRef}
        onClick={() => {
          if (!isDragging) {
            if (selectedBlurOverlayId) {
              onSelectBlurOverlay?.(null);
            } else {
              onTogglePlay?.();
            }
          }
        }}
        style={{
          aspectRatio: videoAspectRatio ? `${videoAspectRatio}` : undefined,
          width: fittedBox ? `${fittedBox.width}px` : (videoAspectRatio && videoAspectRatio >= 1 ? '100%' : 'auto'),
          height: fittedBox ? `${fittedBox.height}px` : (videoAspectRatio && videoAspectRatio < 1 ? '100%' : 'auto'),
          maxWidth: '100%',
          maxHeight: '100%',
        }}
        className="relative bg-black rounded-lg shadow-2xl overflow-hidden select-none cursor-pointer group flex items-center justify-center min-h-0"
      >
        {!videoUrl ? (
          <div className="absolute inset-0 z-40 bg-[#0d0e12] flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400 shadow-xl shadow-sky-500/10">
              <Upload className="w-8 h-8" />
            </div>
            <div className="space-y-1 max-w-xs">
              <h3 className="text-base font-extrabold text-white">Import Video</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Vui lòng import file video (MP4/WebM) từ thiết bị hoặc chọn từ thư viện để bắt đầu chỉnh sửa.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <label className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs px-4 py-2.5 rounded-xl transition shadow-lg shadow-sky-500/20 flex items-center space-x-1.5 active:scale-95">
                <Upload className="w-4 h-4" />
                <span>Import Video Từ Máy</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && onImportVideo) {
                      const url = URL.createObjectURL(file);
                      onImportVideo(url, file.name.replace(/\.[^/.]+$/, ''), file, true);
                    }
                  }}
                  className="hidden"
                />
              </label>
              {onOpenImportModal && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenImportModal();
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2.5 rounded-xl transition border border-slate-700 active:scale-95"
                >
                  Chọn Nguồn Khác
                </button>
              )}
            </div>
          </div>
        ) : isEmbedUrl ? (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden">
            <iframe
              src={videoUrl.includes('?') ? videoUrl : `${videoUrl}?autoplay=1`}
              title="Embedded Video Player"
              className="w-full h-full border-0 pointer-events-auto"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
            <div className="absolute top-2 left-2 z-30 bg-slate-900/90 backdrop-blur-md text-amber-300 border border-amber-500/30 text-[11px] px-2.5 py-1 rounded-lg shadow-md flex items-center space-x-1.5 pointer-events-none">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Chế độ phát Embed Web (YouTube)</span>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={clips && clips.length > 1 ? clips[activeClipIndexActual].url : videoUrl}
            onTimeUpdate={handleTimeUpdateInternal}
            onLoadedMetadata={handleLoadedMetadataInternal}
            onEnded={handleVideoEndedInternal}
            onError={handleVideoError}
            className="w-full h-full object-contain pointer-events-auto"
            crossOrigin={useCrossOrigin ? 'anonymous' : undefined}
            playsInline
          />
        )}

        {/* Video Load Error Overlay */}
        {hasLoadError && (
          <div className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-amber-400 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">Link video gốc đã hết hạn hoặc không tải được</h4>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                Link video từ mạng (TikTok/Douyin) có token bảo mật hết hạn theo thời gian. Bạn có thể chọn file từ máy hoặc dán link mới để thay thế video nền mà <strong>không bị mất phụ đề</strong>!
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onImportVideo && (
                <label className="cursor-pointer bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-xl transition flex items-center space-x-1.5 shadow-md active:scale-95">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Chọn File Từ Máy (Giữ Phụ Đề)</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setHasLoadError(false);
                        const url = URL.createObjectURL(file);
                        onImportVideo(url, file.name.replace(/\.[^/.]+$/, ''), file, true);
                      }
                    }}
                    className="hidden"
                  />
                </label>
              )}
              {onOpenImportModal && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenImportModal();
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs flex items-center space-x-1.5 transition border border-slate-700 active:scale-95"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Dán Link Mới</span>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHasLoadError(false);
                  handleVideoError();
                }}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs flex items-center space-x-1.5 transition border border-slate-700/60 active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Khôi Phục Từ Bộ Nhớ</span>
              </button>
            </div>
          </div>
        )}




        {/* Unified Canvas Viewport Engine (1:1 with Export Engine) */}
        {!hasLoadError && videoUrl && (
          <canvas
            ref={canvasRef}
            className="absolute z-10 pointer-events-none"
            style={{
              left: `${videoDisplayRect.left}px`,
              top: `${videoDisplayRect.top}px`,
              width: `${videoDisplayRect.width || '100%'}px`,
              height: `${videoDisplayRect.height || '100%'}px`,
            }}
          />
        )}

        {/* Rendered Video Surface Interactive HUD Container (1:1 aligned with canvas) */}
        {!hasLoadError && videoUrl && (
          <div
            className="absolute z-20 pointer-events-none overflow-hidden"
            style={{
              left: `${videoDisplayRect.left}px`,
              top: `${videoDisplayRect.top}px`,
              width: `${videoDisplayRect.width || '100%'}px`,
              height: `${videoDisplayRect.height || '100%'}px`,
            }}
          >
            {/* Blur Overlays */}
            {blurOverlays.map((blur, idx) => {
              const currentBlur = (liveOverlay && liveOverlay.id === blur.id) ? { ...blur, ...liveOverlay.rect } : blur;
              const isSelected = selectedBlurOverlayId === blur.id;
              const isDraggingThis = dragOverlay?.id === blur.id;

              return (
                <div
                  key={blur.id}
                  onMouseDown={(e) => {
                    onSelectBlurOverlay?.(blur.id);
                    onSelectSubtitle?.(null);
                    onSelectTextOverlay?.(null);
                    handleStartDragOverlay(e, 'blur', blur.id, 'move', blur);
                  }}
                  onTouchStart={(e) => {
                    onSelectBlurOverlay?.(blur.id);
                    onSelectSubtitle?.(null);
                    onSelectTextOverlay?.(null);
                    handleStartDragOverlay(e, 'blur', blur.id, 'move', blur);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectBlurOverlay?.(blur.id);
                    onSelectSubtitle?.(null);
                    onSelectTextOverlay?.(null);
                  }}
                  className={`absolute z-21 pointer-events-auto touch-none cursor-grab active:cursor-grabbing group/blur ${
                    isDraggingThis ? '' : 'transition-[border-color,box-shadow]'
                  } ${
                    isSelected
                      ? 'border-2 border-dashed border-[#00c5d7] bg-[#00c5d7]/15 shadow-[0_0_12px_rgba(0,197,215,0.5)] ring-1 ring-[#00c5d7]/40'
                      : 'border border-transparent hover:border-[#00c5d7]/40'
                  }`}
                  style={{
                    left: `${currentBlur.x}%`,
                    top: `${currentBlur.y}%`,
                    width: `${currentBlur.width}%`,
                    height: `${currentBlur.height}%`,
                  }}
                  title="Vùng làm mờ (Chạm để chỉnh sửa)"
                >
                  {/* Virtual border badge tag for recognition - ONLY WHEN SELECTED */}
                  {isSelected && (
                    <div className="absolute -top-5 left-0 bg-[#00c5d7] text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded-t shadow pointer-events-none flex items-center space-x-1 whitespace-nowrap select-none">
                      <span>Vùng làm mờ #{idx + 1}</span>
                    </div>
                  )}

                  {/* 4 Corner Touch Handles for Resizing - ONLY WHEN SELECTED */}
                  {isSelected && (
                    <>
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'nw', currentBlur);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'nw', currentBlur);
                        }}
                        className="absolute -top-2 -left-2 w-5 h-5 flex items-center justify-center cursor-nwse-resize z-30 pointer-events-auto touch-none"
                      >
                        <div className="w-2.5 h-2.5 bg-[#00c5d7] border border-slate-950 rounded-full shadow" />
                      </div>
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'ne', currentBlur);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'ne', currentBlur);
                        }}
                        className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center cursor-nesw-resize z-30 pointer-events-auto touch-none"
                      >
                        <div className="w-2.5 h-2.5 bg-[#00c5d7] border border-slate-950 rounded-full shadow" />
                      </div>
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'sw', currentBlur);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'sw', currentBlur);
                        }}
                        className="absolute -bottom-2 -left-2 w-5 h-5 flex items-center justify-center cursor-nesw-resize z-30 pointer-events-auto touch-none"
                      >
                        <div className="w-2.5 h-2.5 bg-[#00c5d7] border border-slate-950 rounded-full shadow" />
                      </div>
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'se', currentBlur);
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                          handleStartDragOverlay(e, 'blur', blur.id, 'se', currentBlur);
                        }}
                        className="absolute -bottom-2 -right-2 w-5 h-5 flex items-center justify-center cursor-nwse-resize z-30 pointer-events-auto touch-none"
                      >
                        <div className="w-2.5 h-2.5 bg-[#00c5d7] border border-slate-950 rounded-full shadow" />
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Logo Overlays */}
            {logoOverlays.map((logo) => {
              const currentLogo = (liveOverlay && liveOverlay.id === logo.id) ? { ...logo, ...liveOverlay.rect } : logo;
              return (
                <div
                  key={logo.id}
                  onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'move', currentLogo)}
                  onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'move', currentLogo)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute z-22 pointer-events-auto touch-none cursor-grab active:cursor-grabbing border border-transparent hover:border-sky-400/80 group/logo"
                  style={{
                    left: `${currentLogo.x}%`,
                    top: `${currentLogo.y}%`,
                    width: `${currentLogo.width}%`,
                    height: `${currentLogo.height}%`,
                  }}
                  title="Logo (Kéo để di chuyển / Kéo góc để chỉnh kích thước)"
                >
                  {/* 4 Corner Touch Handles for Resizing */}
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'nw', currentLogo)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'nw', currentLogo)}
                    className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/logo:opacity-100 transition-opacity z-30"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'ne', currentLogo)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'ne', currentLogo)}
                    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/logo:opacity-100 transition-opacity z-30"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'sw', currentLogo)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'sw', currentLogo)}
                    className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-sky-400 border border-slate-950 rounded-full cursor-nesw-resize opacity-0 group-hover/logo:opacity-100 transition-opacity z-30"
                  />
                  <div
                    onMouseDown={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'se', currentLogo)}
                    onTouchStart={(e) => handleStartDragOverlay(e, 'logo', logo.id, 'se', currentLogo)}
                    className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-400 border border-slate-950 rounded-full cursor-nwse-resize opacity-0 group-hover/logo:opacity-100 transition-opacity z-30"
                  />
                </div>
              );
            })}

            {/* Text Overlays */}
            {textOverlays.map((textItem) => {
              const isTimeMatch = textItem.isTitle || (
                (textItem.startTime === undefined || currentTime >= textItem.startTime) &&
                (textItem.endTime === undefined || currentTime <= textItem.endTime)
              );
              if (!isTimeMatch) return null;

              const currentText = (liveOverlay && liveOverlay.id === textItem.id) ? { ...textItem, ...liveOverlay.rect } : textItem;
              const isSelected = selectedTextOverlayId === textItem.id;
              const isDraggingThis = dragOverlay?.id === textItem.id;
              const isTitle = Boolean(textItem.isTitle);

              // Calculate tight fitting bounds that match the canvas rendered text lines perfectly
              const bounds = calculateTextOverlayBounds(
                currentText,
                videoDisplayRect.width || 720,
                videoDisplayRect.height || 1280
              );

              // Expand interactive bounding border outward for comfortable breathing room and easier grabbing (viền thao tác rộng hơn)
              const padX = (24 / (videoDisplayRect.width || 720)) * 100;
              const padY = (16 / (videoDisplayRect.height || 1280)) * 100;

              return (
                <div
                  key={textItem.id}
                  id={`text-overlay-${textItem.id}`}
                  onMouseDown={(e) => {
                    if (onSelectTextOverlay) onSelectTextOverlay(textItem);
                    if (onSelectSubtitle) onSelectSubtitle(null);
                    if (onSelectBlurOverlay) onSelectBlurOverlay(null);
                    handleStartDragOverlay(e, 'text', textItem.id, 'move', { ...currentText, width: bounds.widthPercent, height: bounds.heightPercent });
                  }}
                  onTouchStart={(e) => {
                    if (onSelectTextOverlay) onSelectTextOverlay(textItem);
                    if (onSelectSubtitle) onSelectSubtitle(null);
                    if (onSelectBlurOverlay) onSelectBlurOverlay(null);
                    handleStartDragOverlay(e, 'text', textItem.id, 'move', { ...currentText, width: bounds.widthPercent, height: bounds.heightPercent });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectTextOverlay) onSelectTextOverlay(textItem);
                    if (onSelectSubtitle) onSelectSubtitle(null);
                    if (onSelectBlurOverlay) onSelectBlurOverlay(null);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onEditTextOverlay) onEditTextOverlay(textItem);
                  }}
                  className={`group/text absolute z-30 pointer-events-auto touch-none select-none rounded-xl ${
                    isDraggingThis ? 'cursor-grabbing' : 'cursor-grab'
                  } ${
                    isDraggingThis ? '' : 'transition-[border-color,box-shadow] duration-150'
                  } ${
                    isSelected
                      ? 'border-2 border-[#0099ff] bg-[#0099ff]/15 shadow-[0_0_14px_rgba(0,153,255,0.7)] ring-2 ring-[#0099ff]/50'
                      : 'border-2 border-transparent'
                  }`}
                  style={{
                    left: `${Math.max(0, currentText.x - padX)}%`,
                    top: `${Math.max(0, currentText.y - padY)}%`,
                    width: `${Math.min(100, bounds.widthPercent + padX * 2)}%`,
                    height: `${Math.min(100, bounds.heightPercent + padY * 2)}%`,
                  }}
                  title={`${isTitle ? 'Tiêu đề' : 'Văn bản'}: Chạm và kéo để di chuyển vị trí`}
                >
                  {/* Corner handles for visual guidance */}
                  {isSelected && (
                    <>
                      <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-[#0099ff] border-2 border-white rounded-full shadow-md pointer-events-none" />
                      <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-[#0099ff] border-2 border-white rounded-full shadow-md pointer-events-none" />
                      <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-[#0099ff] border-2 border-white rounded-full shadow-md pointer-events-none" />
                      <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-[#0099ff] border-2 border-white rounded-full shadow-md pointer-events-none" />
                    </>
                  )}

                  {/* Visual mode indicator pill when dragging */}
                  {isDraggingThis && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight shadow-md flex items-center gap-1.5 pointer-events-none whitespace-nowrap z-50 animate-in fade-in zoom-in-95">
                      <div className="bg-zinc-900/95 text-[#0099ff] border border-[#0099ff]/50 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                        <Move className="w-3 h-3 text-[#0099ff]" />
                        <span>Di chuyển vị trí</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ROI Box Overlay (Cyan Fine Dashed Border with Dimension Badge & Dimmed Mask) - ONLY shown in Extract mode */}
            {showRoiBox && (() => {
              const currentRoi = liveRoi || roi;
              return (
              <div className="absolute inset-0 z-20 pointer-events-none">
                {/* 1. Dimmed backdrop outside ROI region (Xám đen những vùng ngoài ROI để nổi bật vùng ROI cho người dùng) */}
                <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden select-none">
                  {/* Top dark block */}
                  <div
                    className="absolute left-0 right-0 top-0 bg-black/65 backdrop-brightness-75 pointer-events-none"
                    style={{ height: `${Math.max(0, currentRoi.y)}%` }}
                  />
                  {/* Bottom dark block */}
                  <div
                    className="absolute left-0 right-0 bottom-0 bg-black/65 backdrop-brightness-75 pointer-events-none"
                    style={{ height: `${Math.max(0, 100 - (currentRoi.y + currentRoi.height))}%` }}
                  />
                  {/* Left dark block */}
                  <div
                    className="absolute left-0 bg-black/65 backdrop-brightness-75 pointer-events-none"
                    style={{
                      top: `${Math.max(0, currentRoi.y)}%`,
                      height: `${Math.max(0, currentRoi.height)}%`,
                      width: `${Math.max(0, currentRoi.x)}%`,
                    }}
                  />
                  {/* Right dark block */}
                  <div
                    className="absolute right-0 bg-black/65 backdrop-brightness-75 pointer-events-none"
                    style={{
                      top: `${Math.max(0, currentRoi.y)}%`,
                      height: `${Math.max(0, currentRoi.height)}%`,
                      width: `${Math.max(0, 100 - (currentRoi.x + currentRoi.width))}%`,
                    }}
                  />
                </div>

                {/* 2. Top Right Dimension Badge (Nhỏ lại, màu trắng nền đen mờ) */}
                <div className="absolute top-2 right-2 z-30 bg-black/75 backdrop-blur-md border border-white/20 text-white px-1.5 py-0.5 rounded text-[8.5px] font-mono tracking-tight shadow-md pointer-events-none flex items-center space-x-1 select-none">
                  <span className="text-white/60 text-[8px]">ROI</span>
                  <span className="font-semibold text-white">{Math.round((currentRoi.width / 100) * (videoRef.current?.videoWidth || 1080))}×{Math.round((currentRoi.height / 100) * (videoRef.current?.videoHeight || 1920))} px</span>
                </div>

                {/* 3. Interactive ROI Crop Box (Đường nét đứt nhỏ lại, sắc nét và tinh tế) */}
                <div
                  onMouseDown={(e) => handleStartDrag(e, 'move')}
                  onTouchStart={(e) => handleStartDrag(e, 'move')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute z-20 cursor-move pointer-events-auto rounded-none touch-none group/roi box-border"
                  style={{
                    left: `${currentRoi.x}%`,
                    top: `${currentRoi.y}%`,
                    width: `${currentRoi.width}%`,
                    height: `${currentRoi.height}%`,
                    boxSizing: 'border-box',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
                  }}
                >
                  {/* Speech-bubble Callout Tooltip matching Screenshot 1 */}
                  <div className="absolute -top-14 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center pointer-events-none w-max max-w-[280px] sm:max-w-[320px] select-none animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-[#00bcd4] text-white text-[11px] sm:text-xs font-bold px-3.5 py-2 rounded-xl shadow-xl text-center leading-snug">
                      Ô vuông bao phủ phụ đề dài nhất, ô càng nhỏ tốc độ càng nhanh
                    </div>
                    <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-[#00bcd4]" />
                  </div>

                  {/* Crisp green dashed border matching Screenshot 1 */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                    <rect
                      x="1"
                      y="1"
                      width="calc(100% - 2px)"
                      height="calc(100% - 2px)"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="2"
                      strokeDasharray="6 4"
                    />
                  </svg>

                  {/* Corner Accent Marks */}
                  <div className="absolute -top-px -left-px w-2.5 h-2.5 border-t-2 border-l-2 border-[#22c55e] pointer-events-none" />
                  <div className="absolute -top-px -right-px w-2.5 h-2.5 border-t-2 border-r-2 border-[#22c55e] pointer-events-none" />
                  <div className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b-2 border-l-2 border-[#22c55e] pointer-events-none" />
                  <div className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b-2 border-r-2 border-[#22c55e] pointer-events-none" />

                  {/* 4 Invisible Corner Resize Hit Areas (No bulky knobs, clean cursor-based resize) */}
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'nw')}
                    onTouchStart={(e) => handleStartDrag(e, 'nw')}
                    className="absolute -top-3 -left-3 w-7 h-7 cursor-nwse-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc trên-trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'ne')}
                    onTouchStart={(e) => handleStartDrag(e, 'ne')}
                    className="absolute -top-3 -right-3 w-7 h-7 cursor-nesw-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc trên-phải"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'sw')}
                    onTouchStart={(e) => handleStartDrag(e, 'sw')}
                    className="absolute -bottom-3 -left-3 w-7 h-7 cursor-nesw-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc dưới-trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'se')}
                    onTouchStart={(e) => handleStartDrag(e, 'se')}
                    className="absolute -bottom-3 -right-3 w-7 h-7 cursor-nwse-resize pointer-events-auto touch-none z-30"
                    title="Thu phóng góc dưới-phải"
                  />

                  {/* 4 Invisible Edge Resize Hit Areas (Top, Bottom, Left, Right) */}
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'n')}
                    onTouchStart={(e) => handleStartDrag(e, 'n')}
                    className="absolute -top-2 inset-x-4 h-4 cursor-ns-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh trên"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 's')}
                    onTouchStart={(e) => handleStartDrag(e, 's')}
                    className="absolute -bottom-2 inset-x-4 h-4 cursor-ns-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh dưới"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'w')}
                    onTouchStart={(e) => handleStartDrag(e, 'w')}
                    className="absolute -left-2 inset-y-4 w-4 cursor-ew-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh trái"
                  />
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'e')}
                    onTouchStart={(e) => handleStartDrag(e, 'e')}
                    className="absolute -right-2 inset-y-4 w-4 cursor-ew-resize pointer-events-auto touch-none z-20"
                    title="Kéo chỉnh cạnh phải"
                  />
                </div>
              </div>
              );
            })()}

            {/* Center Alignment Snap Guide Line for Subtitle Positioning */}
            {showSubCenterGuide && (
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1.5px] bg-[#00bcd4] z-40 pointer-events-none" />
            )}

            {/* Active Subtitle Overlay - Touch Draggable & Scalable */}
            {activeSubtitle && (() => {
              const baseBox = subLiveBox || activeSubtitle.boundingBox || roi;
              const subText = activeSubtitle.translatedText || activeSubtitle.originalText || '';
              const renderedRect = calculateRenderedSubtitleRect(
                subText,
                styleConfig,
                baseBox,
                videoDisplayRect.width || 720,
                videoDisplayRect.height || 1280
              );

              const isInteracting = isSubtitleSelected || isSubDragging;
              // Gentle breathing room padding so the cyan box isn't choked against text
              const subPadX = (12 / (videoDisplayRect.width || 720)) * 100;
              const subPadY = (6 / (videoDisplayRect.height || 1280)) * 100;

              return (
                <div
                  key={`sub-${activeSubtitle.id}`}
                  id={`subtitle-overlay-${activeSubtitle.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectSubtitle && activeSubtitle) {
                      onSelectSubtitle(activeSubtitle);
                    }
                    if (onSelectTextOverlay) {
                      onSelectTextOverlay(null);
                    }
                    if (onSelectBlurOverlay) {
                      onSelectBlurOverlay(null);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (onSelectSubtitle && activeSubtitle && !isSubtitleSelected) {
                      onSelectSubtitle(activeSubtitle);
                    }
                    if (onSelectTextOverlay) {
                      onSelectTextOverlay(null);
                    }
                    if (onSelectBlurOverlay) {
                      onSelectBlurOverlay(null);
                    }
                    handleStartDragSubtitle(e, 'move');
                  }}
                  onTouchStart={(e) => {
                    if (onSelectSubtitle && activeSubtitle && !isSubtitleSelected) {
                      onSelectSubtitle(activeSubtitle);
                    }
                    if (onSelectTextOverlay) {
                      onSelectTextOverlay(null);
                    }
                    if (onSelectBlurOverlay) {
                      onSelectBlurOverlay(null);
                    }
                    handleStartDragSubtitle(e, 'move');
                  }}
                  className={`group/sub absolute z-30 pointer-events-auto touch-none select-none rounded-none box-border transition-all duration-150 ${
                    isSubDragging
                      ? 'cursor-grabbing border-[1.5px] border-[#00bcd4] bg-[#00bcd4]/10'
                      : isInteracting
                      ? 'cursor-grab border-[1.5px] border-[#00bcd4] bg-[#00bcd4]/10'
                      : 'cursor-grab border-[1.5px] border-transparent hover:border-[#00bcd4]/60'
                  }`}
                  style={{
                    left: `${Math.max(0, renderedRect.xPercent - subPadX)}%`,
                    top: `${Math.max(0, renderedRect.yPercent - subPadY)}%`,
                    width: `${Math.min(100, renderedRect.widthPercent + subPadX * 2)}%`,
                    height: `${Math.min(100, renderedRect.heightPercent + subPadY * 2)}%`,
                  }}
                  title="Phụ đề: Chạm và kéo để di chuyển vị trí"
                >
                  {/* Mode indicator pill when dragging */}
                  {isSubDragging && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight shadow-md flex items-center gap-1.5 pointer-events-none whitespace-nowrap z-50 animate-in fade-in zoom-in-95">
                      <div className="bg-zinc-900/95 text-[#00bcd4] border border-[#00bcd4]/50 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
                        <Move className="w-3 h-3 text-[#00bcd4]" />
                        <span>Di chuyển vị trí</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* CapCut-style AI Laser Scanning Overlay HUD during OCR analysis */}
        {scanProgress && (scanProgress.status === 'scanning' || scanProgress.status === 'translating') && (
          <div className="absolute inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white select-none pointer-events-auto">
            {/* Animated Laser Grid & Scanner Beam */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
              <div className="w-full h-full bg-[linear-gradient(to_right,#0284c7_1px,transparent_1px),linear-gradient(to_bottom,#0284c7_1px,transparent_1px)] bg-[size:24px_24px]" />
              <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-pulse" style={{ top: `${(scanProgress.percentage || 10) % 100}%` }} />
            </div>

            {/* Glowing Spinner Center */}
            <div className="relative mb-5 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
              <div className="absolute w-10 h-10 rounded-full border-2 border-emerald-500/30 border-b-emerald-400 animate-spin" style={{ animationDirection: 'reverse' }} />
              <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin absolute" />
            </div>

            {/* Message & Stats */}
            <div className="text-center w-full max-w-md space-y-4 relative z-10">
              <div>
                <h3 className="text-sm font-black tracking-wide text-cyan-300 uppercase flex items-center justify-center gap-1.5">
                  <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                  <span>Hệ thống phân tích PaddleOCR Wasm</span>
                </h3>
                <p className="text-xs text-slate-300 font-medium line-clamp-2 px-2 mt-1 min-h-[2rem]">
                  {scanProgress.message}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full bg-slate-800/80 h-2.5 rounded-full overflow-hidden border border-slate-700/50 shadow-inner">
                  <div
                    className="bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-300 h-full transition-all duration-300"
                    style={{ width: `${scanProgress.percentage}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-0.5">
                  <span className="text-cyan-400 font-bold">{scanProgress.percentage}% HOÀN THÀNH</span>
                  <span>Khung: {scanProgress.currentFrame}/{Math.max(scanProgress.currentFrame, scanProgress.totalFrames)}</span>
                </div>
              </div>

              {/* Real-time Diagnostics Monitor Panel */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* 1. FPS / Speed Card */}
                <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-3 text-left space-y-1.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 opacity-[0.03]">
                    <Gauge className="w-12 h-12 text-white" />
                  </div>
                  <div className="flex items-center space-x-1.5 text-[9px] uppercase tracking-wider text-slate-400 font-bold">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tốc độ quét</span>
                  </div>
                  <div className="flex items-baseline space-x-1">
                    <span className="text-lg font-extrabold font-mono text-white">
                      {typeof scanProgress.fps === 'number' ? scanProgress.fps.toFixed(1) : '0.0'}
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold">FPS</span>
                  </div>
                  {/* Performance drop warnings */}
                  {typeof scanProgress.fps === 'number' && (
                    <div className="flex items-center space-x-1 text-[8px] font-bold">
                      {scanProgress.fps < 10 ? (
                        <span className="text-rose-400 bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/30">
                          ⚠️ Trễ hệ thống (Yếu)
                        </span>
                      ) : scanProgress.fps < 20 ? (
                        <span className="text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/30">
                          ⚡ Ổn định (Trung bình)
                        </span>
                      ) : (
                        <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/30">
                          🚀 Tối ưu (Cực nhanh)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. Worker Thread CPU Usage Card */}
                <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-3 text-left space-y-1.5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-1 opacity-[0.03]">
                    <Cpu className="w-12 h-12 text-white" />
                  </div>
                  <div className="flex items-center space-x-1.5 text-[9px] uppercase tracking-wider text-slate-400 font-bold">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span>Hiệu dụng CPU</span>
                  </div>
                  <div className="flex items-baseline space-x-1">
                    <span className="text-lg font-extrabold font-mono text-white">
                      {typeof scanProgress.cpuUsage === 'number' ? scanProgress.cpuUsage : '0'}%
                    </span>
                    <span className="text-[9px] text-slate-400 font-semibold">TẢI TRỌNG</span>
                  </div>
                  <div className="space-y-1">
                    {/* Tiny visual progress bar representing worker CPU threads */}
                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all duration-300"
                        style={{ width: `${scanProgress.cpuUsage || 0}%` }}
                      />
                    </div>
                    {typeof scanProgress.activeWorkers === 'number' && typeof scanProgress.totalWorkers === 'number' && (
                      <div className="text-[8px] text-slate-400 font-semibold font-mono flex justify-between">
                        <span>Luồng bận:</span>
                        <span className="text-cyan-300">{scanProgress.activeWorkers}/{scanProgress.totalWorkers}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
