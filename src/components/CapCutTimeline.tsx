import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Scissors,
  Type,
  Volume2,
  Subtitles,
  Film,
  Upload,
  Mic,
  Headphones,
  Music2,
  ChevronDown,
  Undo,
  Redo,
  Captions,
  Lock,
  Unlock,
  Maximize2,
} from 'lucide-react';
import { SubtitleItem, TextOverlay, AppSettings } from '../types';

interface CapCutTimelineProps {
  appSettings?: AppSettings;
  duration: number;
  currentTime: number;
  subtitles: SubtitleItem[];
  selectedSubtitleId: string | null;
  selectedAudioId?: string | null;
  onSelectAudio?: (sub: SubtitleItem | null) => void;
  onPlaySingleAudio?: (sub: SubtitleItem) => void;
  isVideoSelected?: boolean;
  onSelectVideoBlock?: (selected: boolean) => void;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onAddSubtitle?: (time?: number) => void;
  onSplitSubtitle?: (time: number) => void;
  onSelectSubtitle?: (sub: SubtitleItem | null) => void;
  onUpdateSubtitle?: (updated: SubtitleItem) => void;
  hasVideo?: boolean;
  videoTitle?: string;
  onOpenImportModal?: () => void;
  onImportVideo?: (url: string, title?: string) => void;
  onPlayTTS?: (text: string) => void;
  // Track Popover Actions
  onExtractSRT?: () => void;
  onImportSRT?: (file: File) => void;
  onExtractAudio?: () => void;
  onImportAudio?: (file: File) => void;
  bgMusicTitle?: string;
  onImportBgMusic?: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // Timeline Văn bản (Text Overlays)
  textOverlays?: TextOverlay[];
  selectedTextOverlayId?: string | null;
  onSelectTextOverlay?: (overlay: TextOverlay | null) => void;
  onUpdateTextOverlay?: (updated: TextOverlay) => void;
  onDeleteTextOverlay?: (id: string) => void;
}

const formatMMSS = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  return `${mm}:${ss}`;
};

const formatTimeLabel = (seconds: number, step: number): string => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;

  if (step < 1) {
    const tenths = Math.floor((seconds % 1) * 10);
    return `${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}`;
};

/**
 * Renders audio waveform with vertical bars ("đường gạch gạch")
 * matching CapCut audio clips as shown in Screenshot_20260906_000630.jpg
 */
const renderAudioWaveform = (widthPx: number, blockHeight: number = 24) => {
  const barWidth = 1.6;
  const barGap = 1.8;
  const step = barWidth + barGap;
  const count = Math.max(1, Math.floor((widthPx - 4) / step));
  const innerH = Math.max(6, blockHeight - 4);

  // Number of speech envelope cycles along block (approx 1 cycle per 75px)
  const cycles = Math.max(1, Math.round(widthPx / 75));

  const bars = [];
  for (let i = 0; i < count; i++) {
    const x = 2 + i * step;
    const t = count > 1 ? (i / (count - 1)) * cycles : 0.5;
    // Acoustic wave matching Screenshot_20260906_000630.jpg:
    // Waveform envelope dips in middle and rises at ends, with subtle harmonic texture
    const envelope = 0.28 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
    const harmonic = 0.88 + 0.12 * Math.sin(i * 0.45);
    const barHeight = Math.max(3, Math.min(innerH, envelope * harmonic * innerH));
    const y = (blockHeight - barHeight) / 2;

    bars.push(
      <rect
        key={i}
        x={x.toFixed(1)}
        y={y.toFixed(1)}
        width={barWidth}
        height={barHeight.toFixed(1)}
        rx="0.8"
        fill="#006064"
      />
    );
  }

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ overflow: 'hidden' }}
    >
      {bars}
    </svg>
  );
};

export const CapCutTimeline: React.FC<CapCutTimelineProps> = ({
  appSettings,
  duration,
  currentTime,
  subtitles,
  selectedSubtitleId,
  selectedAudioId = null,
  onSelectAudio,
  onPlaySingleAudio,
  isVideoSelected = false,
  onSelectVideoBlock,
  onSeek,
  isPlaying,
  onTogglePlay,
  onAddSubtitle,
  onSplitSubtitle,
  onSelectSubtitle,
  onUpdateSubtitle,
  hasVideo = true,
  videoTitle = 'imported_video.mp4',
  onOpenImportModal,
  onImportVideo,
  onPlayTTS,
  onExtractSRT,
  onImportSRT,
  onExtractAudio,
  onImportAudio,
  bgMusicTitle,
  onImportBgMusic,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  textOverlays = [],
  selectedTextOverlayId = null,
  onSelectTextOverlay,
  onUpdateTextOverlay,
  onDeleteTextOverlay,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Hidden File Inputs
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const bgMusicInputRef = useRef<HTMLInputElement | null>(null);

  // Track header popover dropdown state
  const [activeHeaderPopover, setActiveHeaderPopover] = useState<'subtitle' | 'audio' | 'music' | 'text' | null>(null);

  // Zoom scale multiplier (1x = fit, 1.5x, up to 75x)
  const [zoom, setZoom] = useState<number>(20);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  // Programmatic scroll flag to avoid scroll feedback loops
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const lastProgrammaticScrollTimeRef = useRef<number>(0);
  const isUserScrollingRef = useRef<boolean>(false);
  const userScrollTimeoutRef = useRef<any>(null);

  // Mouse drag-to-scroll scrubbing state
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startScrollLeftRef = useRef<number>(0);

  // Measure timeline container width dynamically for pixel-perfect playhead alignment
  useEffect(() => {
    if (!containerRef.current) return;
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth || 800);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate playhead offset: playhead aligns with exactly 50% center of the timeline bar
  const playheadOffset = containerWidth / 2;

  // Dragging state for Left/Right handles or whole block move on selected subtitle clip
  const [draggingState, setDraggingState] = useState<{
    subId: string;
    type: 'left' | 'right' | 'move';
    initialClickTime?: number;
    initialStartTime?: number;
    initialEndTime?: number;
  } | null>(null);

  const subtitlesRef = useRef<SubtitleItem[]>(subtitles);
  useEffect(() => {
    subtitlesRef.current = subtitles;
  }, [subtitles]);

  const hasDraggedRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);

  // Touch gesture state for pinch-to-zoom vs pan
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const touchStartPositionsRef = useRef<{ x: number; y: number }[]>([]);
  const touchStartScrollLeftRef = useRef<number>(0);
  const gestureModeRef = useRef<'undetermined' | 'pan' | 'pinch'>('undetermined');

  const safeDuration = duration && duration > 0 ? duration : 60;

  // Sync scrollLeft with currentTime so the white playhead remains fixed in the center
  useEffect(() => {
    if (!containerRef.current) return;
    // Skip programmatic scroll if the user is actively scrolling/scrubbing and the video is paused
    if (isUserScrollingRef.current && !isPlaying) return;

    const trackWidth = containerWidth * zoom;
    const targetScroll = Math.max(0, (currentTime / safeDuration) * trackWidth);

    if (Math.abs(containerRef.current.scrollLeft - targetScroll) > 0.5) {
      isProgrammaticScrollRef.current = true;
      lastProgrammaticScrollTimeRef.current = Date.now();
      containerRef.current.scrollLeft = targetScroll;
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [currentTime, safeDuration, zoom, containerWidth, isPlaying]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle user timeline scrolling / scrubbing to seek currentTime
  const handleScroll = () => {
    if (!containerRef.current) return;

    // Reject delayed browser scroll events from programmatic scrolling
    const timeSinceProgrammatic = Date.now() - lastProgrammaticScrollTimeRef.current;
    if (isProgrammaticScrollRef.current || timeSinceProgrammatic < 80) {
      return;
    }

    // IF VIDEO IS PLAYING AND USER STARTS SCROLLING/DRAGGING, IMMEDIATELY PAUSE VIDEO!
    if (isPlaying) {
      onTogglePlay();
      return;
    }

    // Set scrubbing state so programmatic scroll sync yields
    isUserScrollingRef.current = true;
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 150);

    // HARD LOCK: Never allow scrollLeft < 0 (before 00:00)
    if (containerRef.current.scrollLeft < 0) {
      containerRef.current.scrollLeft = 0;
      onSeek(0);
      return;
    }

    const trackWidth = containerWidth * zoom;
    if (trackWidth <= 0) return;

    const currentScroll = Math.max(0, containerRef.current.scrollLeft);
    const calculatedTime = (currentScroll / trackWidth) * safeDuration;
    const clampedTime = Math.max(0, Math.min(safeDuration, calculatedTime));

    onSeek(Number(clampedTime.toFixed(2)));
  };

  // Mouse drag to scroll / scrub timeline on desktop
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isPlaying) {
      onTogglePlay();
    }
    setIsMouseDown(true);
    startXRef.current = e.clientX;
    if (containerRef.current) {
      startScrollLeftRef.current = Math.max(0, containerRef.current.scrollLeft);
    }
  };

  useEffect(() => {
    if (!isMouseDown) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const dx = e.clientX - startXRef.current;
      // HARD LOCK: Clamp newScrollLeft to minimum 0 so user cannot scrub before 00:00
      const newScrollLeft = Math.max(0, startScrollLeftRef.current - dx);
      containerRef.current.scrollLeft = newScrollLeft;
    };

    const handleMouseUp = () => {
      setIsMouseDown(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMouseDown]);

  // Handle drag handles for adjusting subtitle start/end times directly on timeline
  const handleStartDragHandle = (
    e: React.MouseEvent | React.TouchEvent,
    sub: SubtitleItem,
    type: 'left' | 'right' | 'move'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if (isPlaying) {
      onTogglePlay();
    }
    if (!trackRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = trackRef.current.getBoundingClientRect();
    const trackWidth = containerWidth * zoom;

    const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
    const clickTime = (clickX / trackWidth) * safeDuration;

    hasDraggedRef.current = false;
    dragStartXRef.current = clientX;

    setDraggingState({
      subId: sub.id,
      type,
      initialClickTime: clickTime,
      initialStartTime: sub.startTime,
      initialEndTime: sub.endTime,
    });
    if (onSelectSubtitle) onSelectSubtitle(sub);
    if (onSelectAudio) onSelectAudio(null);
  };

  useEffect(() => {
    if (!draggingState) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }
      if (!trackRef.current || !onUpdateSubtitle) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      if (Math.abs(clientX - dragStartXRef.current) > 3) {
        hasDraggedRef.current = true;
      }

      const rect = trackRef.current.getBoundingClientRect();
      const trackWidth = containerWidth * zoom;

      const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
      const targetTime = (clickX / trackWidth) * safeDuration;

      const currentSub = subtitlesRef.current.find((s) => s.id === draggingState.subId);
      if (!currentSub) return;

      // FLEXIBLE DRAGGING: Subtitles can be moved and resized freely across the safe duration boundary, utilizing dynamic lanes
      if (draggingState.type === 'left') {
        const newStart = Math.max(0, Math.min(targetTime, currentSub.endTime - 0.1));
        onUpdateSubtitle({ ...currentSub, startTime: Number(newStart.toFixed(2)) });
      } else if (draggingState.type === 'right') {
        const newEnd = Math.min(safeDuration, Math.max(targetTime, currentSub.startTime + 0.1));
        onUpdateSubtitle({ ...currentSub, endTime: Number(newEnd.toFixed(2)) });
      } else if (
        draggingState.type === 'move' &&
        draggingState.initialClickTime !== undefined &&
        draggingState.initialStartTime !== undefined &&
        draggingState.initialEndTime !== undefined
      ) {
        const delta = targetTime - draggingState.initialClickTime;
        const dur = draggingState.initialEndTime - draggingState.initialStartTime;

        let newStart = Math.max(0, draggingState.initialStartTime! + delta);
        let newEnd = newStart + dur;

        if (newEnd > safeDuration) {
          newEnd = safeDuration;
          newStart = Math.max(0, safeDuration - dur);
        }

        onUpdateSubtitle({
          ...currentSub,
          startTime: Number(newStart.toFixed(2)),
          endTime: Number(newEnd.toFixed(2)),
        });
      }
    };

    const handlePointerUp = () => {
      setDraggingState(null);
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 150);
    };

    window.addEventListener('mousemove', handlePointerMove);
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
    };
  }, [draggingState, safeDuration, onUpdateSubtitle, containerWidth, zoom, playheadOffset]);

  // Dragging state for Left/Right handles or whole block move on selected Text Overlay
  const [draggingTextState, setDraggingTextState] = useState<{
    textId: string;
    type: 'left' | 'right' | 'move';
    initialClickTime?: number;
    initialStartTime?: number;
    initialEndTime?: number;
  } | null>(null);

  const textOverlaysRef = useRef<TextOverlay[]>(textOverlays);
  useEffect(() => {
    textOverlaysRef.current = textOverlays;
  }, [textOverlays]);

  const handleStartDragTextHandle = (
    e: React.MouseEvent | React.TouchEvent,
    textItem: TextOverlay,
    type: 'left' | 'right' | 'move'
  ) => {
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) {
      e.preventDefault();
    }
    if (isPlaying) {
      onTogglePlay();
    }
    if (!trackRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = trackRef.current.getBoundingClientRect();
    const trackWidth = containerWidth * zoom;

    const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
    const clickTime = (clickX / trackWidth) * safeDuration;

    hasDraggedRef.current = false;
    dragStartXRef.current = clientX;

    setDraggingTextState({
      textId: textItem.id,
      type,
      initialClickTime: clickTime,
      initialStartTime: textItem.startTime ?? 0,
      initialEndTime: textItem.endTime ?? ((textItem.startTime ?? 0) + 3),
    });
    if (onSelectTextOverlay) onSelectTextOverlay(textItem);
  };

  useEffect(() => {
    if (!draggingTextState) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if ('cancelable' in e && e.cancelable) {
        e.preventDefault();
      }
      if (!trackRef.current || !onUpdateTextOverlay) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      if (Math.abs(clientX - dragStartXRef.current) > 3) {
        hasDraggedRef.current = true;
      }

      const rect = trackRef.current.getBoundingClientRect();
      const trackWidth = containerWidth * zoom;

      const clickX = Math.max(0, Math.min(trackWidth, clientX - rect.left - playheadOffset));
      const targetTime = (clickX / trackWidth) * safeDuration;

      const currentText = textOverlaysRef.current.find((t) => t.id === draggingTextState.textId);
      if (!currentText) return;

      const sTime = currentText.startTime ?? 0;
      const eTime = currentText.endTime ?? sTime + 3;

      if (draggingTextState.type === 'left') {
        const newStart = Math.max(0, Math.min(targetTime, eTime - 0.2));
        onUpdateTextOverlay({ ...currentText, startTime: Number(newStart.toFixed(2)) });
      } else if (draggingTextState.type === 'right') {
        const newEnd = Math.min(safeDuration, Math.max(targetTime, sTime + 0.2));
        onUpdateTextOverlay({ ...currentText, endTime: Number(newEnd.toFixed(2)) });
      } else if (
        draggingTextState.type === 'move' &&
        draggingTextState.initialClickTime !== undefined &&
        draggingTextState.initialStartTime !== undefined &&
        draggingTextState.initialEndTime !== undefined
      ) {
        const delta = targetTime - draggingTextState.initialClickTime;
        const dur = Math.max(0.5, draggingTextState.initialEndTime - draggingTextState.initialStartTime);

        let newStart = Math.max(0, draggingTextState.initialStartTime + delta);
        let newEnd = newStart + dur;

        if (newEnd > safeDuration) {
          newEnd = safeDuration;
          newStart = Math.max(0, safeDuration - dur);
        }

        onUpdateTextOverlay({
          ...currentText,
          startTime: Number(newStart.toFixed(2)),
          endTime: Number(newEnd.toFixed(2)),
        });
      }
    };

    const handlePointerUp = () => {
      setDraggingTextState(null);
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 150);
    };

    window.addEventListener('mousemove', handlePointerMove);
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
    };
  }, [draggingTextState, safeDuration, onUpdateTextOverlay, containerWidth, zoom, playheadOffset]);

  // Handle click on timeline to seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingState || !trackRef.current) return;
    if (isPlaying) {
      onTogglePlay();
    }
    const rect = trackRef.current.getBoundingClientRect();
    const trackWidth = containerWidth * zoom;

    const clickX = e.clientX - rect.left - playheadOffset;
    const clampedX = Math.max(0, Math.min(trackWidth, clickX));
    const targetTime = (clampedX / trackWidth) * safeDuration;
    onSeek(Math.max(0, Number(targetTime.toFixed(2))));
  };

  // Wheel zoom handling: Ctrl/Cmd + wheel/trackpad pinch zooms smoothly, normal wheel scrolls
  const handleWheel = (e: React.WheelEvent) => {
    // Prevent zoom when dragging to scroll or dragging block/handle
    if (isMouseDown || draggingState) {
      return;
    }

    // If Ctrl/Cmd is pressed (trackpad pinch-to-zoom)
    if (e.ctrlKey || e.metaKey) {
      // If horizontal delta is dominant or vertical delta is negligible, do NOT zoom (user is panning/swiping sideways)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2 || Math.abs(e.deltaY) < 1) {
        if (containerRef.current && Math.abs(e.deltaX) > 0) {
          containerRef.current.scrollLeft += e.deltaX;
          e.preventDefault();
        }
        return;
      }

      e.preventDefault();
      const zoomFactor = -e.deltaY * 0.0025;
      setZoom((prev) => {
        const factor = Math.exp(zoomFactor);
        const nextZoom = prev * factor;
        return Math.max(2, Math.min(80, Number(nextZoom.toFixed(1))));
      });
      return;
    }

    // Standard horizontal scrolling
    if (containerRef.current) {
      const scrollDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(scrollDelta) > 0) {
        containerRef.current.scrollLeft += scrollDelta;
        e.preventDefault();
      }
    }
  };

  // Robust Touch Gesture Handlers: Differentiate between 2-finger panning vs intentional pinch-to-zoom
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isPlaying) {
      onTogglePlay();
    }
    if (draggingState) return;

    if (e.touches.length === 2) {
      const p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const p1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
      const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y);

      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoom;
      touchStartPositionsRef.current = [p0, p1];
      touchStartScrollLeftRef.current = containerRef.current ? containerRef.current.scrollLeft : 0;
      gestureModeRef.current = 'undetermined';
    } else {
      touchStartDistRef.current = null;
      gestureModeRef.current = 'undetermined';
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (draggingState) return;

    if (e.touches.length === 2 && touchStartDistRef.current !== null && touchStartPositionsRef.current.length === 2) {
      const p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const p1 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
      const start0 = touchStartPositionsRef.current[0];
      const start1 = touchStartPositionsRef.current[1];

      const dx0 = p0.x - start0.x;
      const dx1 = p1.x - start1.x;
      const currentDist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      const initialDist = touchStartDistRef.current;
      const distChange = Math.abs(currentDist - initialDist);

      // Determine gesture if not locked yet
      if (gestureModeRef.current === 'undetermined') {
        // If both fingers moved horizontally in the same direction -> PAN/SCROLL ONLY
        if (dx0 * dx1 > 0 && Math.abs(dx0) > 12 && Math.abs(dx1) > 12) {
          gestureModeRef.current = 'pan';
        }
        // Only if distance changed significantly and ratio deviates noticeably (>25px change & >20% scale change) -> PINCH
        else if (distChange > 30 && (currentDist / initialDist > 1.2 || currentDist / initialDist < 0.8)) {
          gestureModeRef.current = 'pinch';
        }
      }

      // Handle based on locked gesture
      if (gestureModeRef.current === 'pan') {
        if (containerRef.current) {
          const avgDx = (dx0 + dx1) / 2;
          containerRef.current.scrollLeft = Math.max(0, touchStartScrollLeftRef.current - avgDx);
        }
      } else if (gestureModeRef.current === 'pinch') {
        if (initialDist > 0) {
          const scale = currentDist / initialDist;
          const newZoom = Math.max(2, Math.min(80, touchStartZoomRef.current * scale));
          setZoom(Number(newZoom.toFixed(1)));
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      touchStartDistRef.current = null;
      gestureModeRef.current = 'undetermined';
      touchStartPositionsRef.current = [];
    }
  };

  // Generate timeline ruler time marks cleanly and dynamically according to zoom (Memoized to avoid thrashing during playback)
  const rulerTicks = React.useMemo(() => {
    const trackWidth = containerWidth * zoom;
    const pxPerSec = trackWidth / Math.max(0.1, safeDuration);

    // Minimum label width in pixels (56px) to prevent text collision
    const minLabelPx = 56;
    const minSecInterval = minLabelPx / pxPerSec;

    // Step increments in seconds based on zoom level for timestamp labels (strictly even numbers: 2, 4, 6, 10, 20...)
    // This ensures intermediate seconds (like 00:01 between 00:00 and 00:02) are never displayed
    const steps = [2, 4, 6, 10, 20, 30, 60, 120, 300, 600];
    const rawInterval = steps.find((s) => s >= minSecInterval) || 2;
    const tickInterval = Math.max(2, rawInterval % 2 === 0 ? rawInterval : rawInterval + 1);

    const ticks: {
      sec: number;
      startPercent: number;
      label: string;
      tickInterval: number;
    }[] = [];
    const totalSecs = Math.ceil(safeDuration);

    // Only generate timestamps on even tickInterval (00:00, 00:02, 00:04, 00:06...)
    // Intermediate seconds in between (e.g. 00:01) are omitted completely
    for (let sec = 0; sec <= totalSecs; sec += tickInterval) {
      const startPercent = (sec / safeDuration) * 100;
      ticks.push({
        sec,
        startPercent,
        label: formatTimeLabel(sec, tickInterval),
        tickInterval,
      });
    }
    return ticks;
  }, [containerWidth, zoom, safeDuration]);

  // Filter rulerTicks to only render the ones visible in the current scroll viewport (+ margin) to maximize zoom and playhead performance
  const visibleRulerTicks = React.useMemo(() => {
    // Determine visible time window bounds in seconds
    const visibleDuration = safeDuration / zoom;
    const margin = visibleDuration * 0.5;
    const startT = Math.max(0, currentTime - visibleDuration / 2 - margin);
    const endT = Math.min(safeDuration, currentTime + visibleDuration / 2 + margin);

    return rulerTicks.filter((tick) => tick.sec >= startT && tick.sec <= endT);
  }, [rulerTicks, currentTime, safeDuration, zoom]);

  // Filter subtitles to only render those in or close to the visible timeline viewport (+ a generous margin) to prevent DOM bloat and lagging on long videos
  const visibleSubtitles = React.useMemo(() => {
    const visibleDuration = safeDuration / zoom;
    const margin = Math.max(visibleDuration, 30); // 30 seconds or visibleDuration
    const startT = Math.max(0, currentTime - visibleDuration / 2 - margin);
    const endT = Math.min(safeDuration, currentTime + visibleDuration / 2 + margin);

    return subtitles.filter((sub) => {
      if (sub.id === selectedSubtitleId) return true;
      if (currentTime >= sub.startTime && currentTime <= sub.endTime) return true;
      return sub.startTime <= endT && sub.endTime >= startT;
    });
  }, [subtitles, currentTime, safeDuration, zoom, selectedSubtitleId]);

  // Dynamic multi-lane layout calculation for subtitles and audios to support overlapping segments seamlessly
  const subtitleLanes = React.useMemo(() => {
    const lanes: { id: string; laneIndex: number }[] = [];
    const laneEndTimes: number[] = [];
    
    // Sort subs by startTime to assign lanes deterministically
    const sortedSubs = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    
    for (const sub of sortedSubs) {
      let assignedLane = -1;
      for (let j = 0; j < laneEndTimes.length; j++) {
        // Allow a tiny gap of 0.05s to prevent overlap bugs
        if (sub.startTime >= laneEndTimes[j] - 0.05) {
          assignedLane = j;
          laneEndTimes[j] = sub.endTime;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = laneEndTimes.length;
        laneEndTimes.push(sub.endTime);
      }
      lanes.push({ id: sub.id, laneIndex: assignedLane });
    }
    
    const laneMap = new Map<string, number>();
    lanes.forEach((item) => laneMap.set(item.id, item.laneIndex));
    return laneMap;
  }, [subtitles]);

  const numSubtitleLanes = React.useMemo(() => {
    if (subtitles.length === 0) return 1;
    let maxLane = 0;
    subtitleLanes.forEach((val) => {
      if (val > maxLane) {
        maxLane = val;
      }
    });
    return maxLane + 1;
  }, [subtitleLanes, subtitles]);

  // Timeline văn bản: Tiêu đề video (isTitle = true) không xuất hiện trên timeline văn bản, chỉ hiển thị các text overlay thông thường
  const visibleTextOverlays = React.useMemo(() => {
    return (textOverlays || []).filter((t) => !t.isTitle);
  }, [textOverlays]);

  const textLanes = React.useMemo(() => {
    const sorted = [...visibleTextOverlays].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    const laneEndTimes: number[] = [];
    const lanes: { id: string; laneIndex: number }[] = [];

    for (const textItem of sorted) {
      const sTime = textItem.startTime ?? 0;
      const eTime = textItem.endTime ?? (sTime + 3);
      let assignedLane = -1;

      for (let j = 0; j < laneEndTimes.length; j++) {
        if (laneEndTimes[j] <= sTime + 0.05) {
          assignedLane = j;
          laneEndTimes[j] = eTime;
          break;
        }
      }
      if (assignedLane === -1) {
        assignedLane = laneEndTimes.length;
        laneEndTimes.push(eTime);
      }
      lanes.push({ id: textItem.id, laneIndex: assignedLane });
    }

    const laneMap = new Map<string, number>();
    lanes.forEach((item) => laneMap.set(item.id, item.laneIndex));
    return laneMap;
  }, [visibleTextOverlays]);

  const numTextLanes = React.useMemo(() => {
    if (visibleTextOverlays.length === 0) return 1;
    let maxLane = 0;
    textLanes.forEach((val) => {
      if (val > maxLane) maxLane = val;
    });
    return maxLane + 1;
  }, [textLanes, visibleTextOverlays]);

  // Generate 2-second division cut lines on the video block (aligning with even seconds as requested)
  const videoSecondSlices = React.useMemo(() => {
    const totalSecs = Math.floor(safeDuration);
    if (totalSecs <= 0) return [];

    const visibleDuration = safeDuration / zoom;
    const margin = Math.max(visibleDuration, 40);
    const rawStart = Math.max(2, Math.floor(currentTime - visibleDuration / 2 - margin));
    const startSec = rawStart % 2 === 0 ? rawStart : rawStart + 1;
    const endSec = Math.min(totalSecs, Math.ceil(currentTime + visibleDuration / 2 + margin));

    const slices: number[] = [];
    for (let s = startSec; s <= endSec; s += 2) {
      if (s < safeDuration) {
        slices.push(s);
      }
    }
    return slices;
  }, [safeDuration, zoom, currentTime]);

  return (
    <div className="bg-[#0a0a0c] w-full flex flex-col select-none text-slate-200 relative">
      {/* Hidden File Inputs for SRT, Audio, and Background Music */}
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportSRT) {
            onImportSRT(file);
          }
          if (e.target) e.target.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportAudio) {
            onImportAudio(file);
          }
          if (e.target) e.target.value = '';
        }}
      />
      <input
        ref={bgMusicInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onImportBgMusic) {
            onImportBgMusic(file);
          }
          if (e.target) e.target.value = '';
        }}
      />

      {/* Top Control Bar - Pure black header */}
      <div className="px-3.5 py-1.5 flex items-center justify-between text-xs relative min-h-[36px] h-[36px] bg-black border-b border-zinc-900 shadow-xs z-20">
        {/* Left: Time indicator '01:03 / 03:14' */}
        <div className="flex items-center space-x-1.5 font-mono text-xs text-slate-300 font-medium tracking-wide select-none">
          <span className="text-white font-bold">{formatMMSS(currentTime)}</span>
          <span className="text-zinc-500 font-normal">/</span>
          <span className="text-zinc-400">{formatMMSS(safeDuration)}</span>
        </div>

        {/* Center: Play / Pause Solid White Triangle */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
          <button
            onClick={onTogglePlay}
            className="p-1.5 text-white hover:scale-110 active:scale-90 transition cursor-pointer flex items-center justify-center"
            title={isPlaying ? 'Tạm dừng video' : 'Phát video'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-white text-white" />
            ) : (
              <Play className="w-4 h-4 fill-white text-white ml-0.5" />
            )}
          </button>
        </div>

        {/* Right: Undo, Redo */}
        <div className="flex items-center space-x-1 sm:space-x-1.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-1.5 text-zinc-300 hover:text-white transition disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer active:scale-90`}
            title="Hoàn tác (Undo)"
          >
            <Undo className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-1.5 text-zinc-300 hover:text-white transition disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer active:scale-90`}
            title="Làm lại (Redo)"
          >
            <Redo className="w-4 h-4" />
          </button>

          {/* Subtitles CC Toggle Badge matching screenshot */}
          <div 
            className="px-1.5 py-0.5 rounded border border-white/80 text-white font-bold text-[10px] tracking-tight leading-none select-none flex items-center justify-center cursor-default ml-1"
            title="Phụ đề (Captions)"
          >
            CC
          </div>
        </div>
      </div>

      {/* CapCut Timeline Track Container - Gray Background with Gradient Shading */}
      <div 
        className="relative overflow-hidden flex flex-col border-0 rounded-none"
        style={{ background: 'linear-gradient(180deg, #1c1c20 0%, #141417 50%, #101013 100%)' }}
      >
        {/* Scrollable Tracks Canvas Viewport */}
        <div
          className="relative w-full overflow-hidden"
          onClick={() => setActiveHeaderPopover(null)}
        >
          {/* PLAYHEAD VERTICAL NEEDLE - Đường trắng thẳng tắp */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-white z-40 pointer-events-none shadow-[0_0_8px_rgba(255,255,255,0.95)]" />

          <div
            ref={containerRef}
            onScroll={handleScroll}
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="w-full overflow-x-auto relative custom-scrollbar bg-[#0a0a0c] touch-pan-x overscroll-x-none cursor-grab active:cursor-grabbing select-none pb-0"
            style={{ overscrollBehaviorX: 'contain' }}
          >
            <div
              ref={trackRef}
              onClick={handleTimelineClick}
              className="relative box-border"
              style={{
                width: `${containerWidth * zoom + containerWidth}px`,
                paddingLeft: `${playheadOffset}px`,
                paddingRight: `${containerWidth - playheadOffset}px`,
              }}
            >
              {/* Inner Track Content Wrapper - Tracks are stacked flush with 0 spacing */}
              <div className="relative w-full space-y-0">

                {/* CONTINUOUS VERTICAL GRID LINES */}
                <div className="absolute inset-y-0 left-0 right-0 pointer-events-none z-0">
                  {visibleRulerTicks.map((tick, idx) => {
                    const leftPx = (tick.sec / safeDuration) * (containerWidth * zoom);
                    return (
                      <div
                        key={`grid-${idx}`}
                        className="absolute top-0 bottom-0 w-px bg-zinc-800/40"
                        style={{ left: `${leftPx}px` }}
                      />
                    );
                  })}
                </div>

                {/* ROW 1: TIME RULER - Clean Header with Even Seconds (00:00, 00:02, 00:04...) */}
                <div className="h-[16px] border-b border-zinc-800/60 mb-0.5 relative overflow-hidden select-none z-10" style={{ background: 'rgba(25,25,30,0.85)' }}>
                  {visibleRulerTicks.map((tick, idx) => {
                    const leftPx = (tick.sec / safeDuration) * (containerWidth * zoom);
                    return (
                      <div
                        key={`ruler-label-${idx}`}
                        className={`absolute inset-y-0 flex items-center pointer-events-none ${
                          tick.sec === 0 || leftPx === 0
                            ? 'justify-start pl-0.5'
                            : 'justify-start -translate-x-1/2'
                        }`}
                        style={{ left: `${leftPx}px` }}
                      >
                        <span className="text-[7.5px] font-mono text-zinc-400 font-medium whitespace-nowrap px-0.5 leading-none">
                          {tick.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* ROW 2: VIDEO TRACK */}
                <div className="h-[34px] border-b border-zinc-800/60 mb-0.5 relative flex items-center px-0 z-10" style={{ background: 'rgba(38,38,46,0.3)' }}>
                  {/* Video Track Rail Bar - Fading Shadow Gradient */}
                  <div
                    className="absolute inset-y-0 rounded-none z-0 pointer-events-none"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                      background: 'linear-gradient(180deg, rgba(70,70,82,0.35) 0%, rgba(28,28,34,0.12) 100%)',
                    }}
                  />

                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectVideoBlock) onSelectVideoBlock(!isVideoSelected);
                    }}
                    className={`absolute left-0 w-full h-[30px] font-medium overflow-hidden flex items-center justify-between px-2 rounded-[4px] cursor-pointer transition-all z-10 ${
                      isVideoSelected
                        ? 'bg-[#22b8cf] ring-2 ring-white border-2 border-white shadow-lg brightness-105'
                        : 'bg-[#22b8cf] hover:bg-[#20b2aa] border border-[#1796aa]/40 shadow-sm'
                    }`}
                    style={{
                      top: '2px',
                    }}
                  >
                    {/* Vertical division cut lines every 1 second across the video block as requested */}
                    {videoSecondSlices.map((sec) => {
                      const sliceLeftPx = (sec / safeDuration) * (containerWidth * zoom);
                      return (
                        <div
                          key={`vid-cut-${sec}`}
                          className="absolute top-0 bottom-0 w-px bg-black/35 pointer-events-none z-0"
                          style={{ left: `${sliceLeftPx}px` }}
                        />
                      );
                    })}

                    {/* Dark Filename Badge inside Video Track matching screenshot */}
                    <div className="relative z-10 bg-black/60 backdrop-blur-xs px-2.5 py-1 rounded-[5px] text-xs font-bold text-white flex items-center space-x-1.5 max-w-[320px] truncate shadow-xs">
                      <span className="truncate">{videoTitle || 'imported_video_1788567319567.mp4'}</span>
                    </div>

                    {isVideoSelected && (
                      <span className="relative z-10 text-[10px] bg-black text-white font-extrabold px-2 py-0.5 rounded-[4px] shadow-sm">
                        Đang chọn
                      </span>
                    )}

                    {/* Left & Right Selection Trim Handles */}
                    {isVideoSelected && (
                      <>
                        <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-white rounded-none border-r border-zinc-400 shadow-md flex items-center justify-center z-30 pointer-events-none">
                          <div className="w-0.5 h-5 bg-zinc-900" />
                        </div>
                        <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-white rounded-none border-l border-zinc-400 shadow-md flex items-center justify-center z-30 pointer-events-none">
                          <div className="w-0.5 h-5 bg-zinc-900" />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ROW 3: SUBTITLE TRACK */}
                <div 
                  className="bg-[#0a0a0c] border-b border-zinc-900/90 mb-1 relative flex items-center z-10"
                  style={{
                    height: `${Math.max(32, numSubtitleLanes * 30 + 4)}px`,
                  }}
                >
                  {/* Subtitle Track Rail Bar - Darkened */}
                  <div
                    className="absolute inset-y-0 bg-[#101014] rounded-none z-0 pointer-events-none"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {visibleSubtitles.map((sub) => {
                    const startPx = (sub.startTime / safeDuration) * (containerWidth * zoom);
                    const endPx = (sub.endTime / safeDuration) * (containerWidth * zoom);
                    const widthPx = Math.max(8, endPx - startPx);

                    const isSelected = selectedSubtitleId === sub.id;
                    const lane = subtitleLanes.get(sub.id) || 0;
                    const topOffset = 2 + lane * 30;

                    const subDur = Math.max(0.4, (sub.endTime - sub.startTime));
                    const subText = (sub.translatedText || sub.originalText || '').trim();

                    return (
                      <div
                        key={sub.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasDraggedRef.current) return;
                          onSeek(sub.startTime);
                          if (onSelectSubtitle) onSelectSubtitle(sub);
                          if (onSelectAudio) onSelectAudio(null);
                        }}
                        className={`absolute rounded-[4px] text-[11px] font-bold flex items-center justify-between transition-all cursor-pointer select-none touch-none ${
                          isSelected
                            ? 'bg-[#ea8f13] text-white z-30 font-bold shadow-lg border-2 border-white'
                            : 'bg-[#ea8f13] hover:brightness-110 text-white z-10 border border-white/20 shadow-xs'
                        }`}
                        style={{
                          left: `${startPx}px`,
                          width: `${widthPx - 2}px`,
                          top: `${topOffset}px`,
                          height: '28px',
                        }}
                        title={`[${formatTimeLabel(sub.startTime, 0.1)} - ${formatTimeLabel(sub.endTime, 0.1)}]: ${subText}`}
                      >
                        {/* Left White Drag Handle - Co giãn chiều ngang đầu block (chỉ hiện khi chọn) */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragHandle(e, sub, 'left')}
                            onTouchStart={(e) => handleStartDragHandle(e, sub, 'left')}
                            className="absolute left-0 top-0 bottom-0 w-3 bg-white rounded-l-[2px] border-r border-zinc-400 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-200 transition-colors"
                            title="Kéo mốc bắt đầu phụ đề (co giãn chiều ngang)"
                            style={{ height: '24px' }}
                          >
                            <div className="w-[1.5px] h-3 bg-zinc-800 rounded-full pointer-events-none" />
                          </div>
                        )}

                        {/* Subtitle Text Content */}
                        <div className={`flex items-center min-w-0 flex-1 pointer-events-none ${isSelected ? 'px-3.5' : 'px-2'}`}>
                          <span className="truncate select-none text-[11px] font-bold text-white leading-tight tracking-wide">
                            {subText}
                          </span>
                        </div>

                        {/* Right White Drag Handle - Co giãn chiều ngang cuối block (chỉ hiện khi chọn) */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragHandle(e, sub, 'right')}
                            onTouchStart={(e) => handleStartDragHandle(e, sub, 'right')}
                            className="absolute right-0 top-0 bottom-0 w-3 bg-white rounded-r-[2px] border-l border-zinc-400 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-200 transition-colors"
                            title="Kéo mốc kết thúc phụ đề (co giãn chiều ngang)"
                            style={{ height: '24px' }}
                          >
                            <div className="w-[1.5px] h-3 bg-zinc-800 rounded-full pointer-events-none" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ROW 4: TIMELINE VĂN BẢN */}
                <div 
                  className="bg-[#0a0a0c] border-b border-zinc-900/90 mb-1 relative flex items-center z-10"
                  style={{
                    height: `${Math.max(30, numTextLanes * 28 + 4)}px`,
                  }}
                >
                  {/* Text Track Rail Bar - Darkened */}
                  <div
                    className="absolute inset-y-0 bg-[#101014] rounded-none z-0 pointer-events-none"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {visibleTextOverlays.map((t) => {
                    const sTime = t.startTime ?? 0;
                    const eTime = t.endTime ?? (sTime + 3);
                    const startPx = (sTime / safeDuration) * (containerWidth * zoom);
                    const endPx = (eTime / safeDuration) * (containerWidth * zoom);
                    const widthPx = Math.max(12, endPx - startPx);

                    const isSelected = selectedTextOverlayId === t.id;
                    const lane = textLanes.get(t.id) || 0;
                    const topOffset = 2 + lane * 28;

                    return (
                      <div
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasDraggedRef.current) return;
                          onSeek(sTime);
                          if (onSelectTextOverlay) onSelectTextOverlay(t);
                        }}
                        onMouseDown={(e) => handleStartDragTextHandle(e, t, 'move')}
                        onTouchStart={(e) => handleStartDragTextHandle(e, t, 'move')}
                        className={`absolute rounded-[5px] text-[10.5px] font-bold px-2 flex items-center justify-between transition-all cursor-grab active:cursor-grabbing select-none touch-none ${
                          isSelected
                            ? 'bg-[#0284c7] text-white z-30 font-black shadow-lg ring-2 ring-white border-2 border-white'
                            : 'bg-[#0369a1] text-white z-10 border border-white/20 shadow-xs hover:bg-[#0284c7]'
                        }`}
                        style={{
                          left: `${startPx}px`,
                          width: `${widthPx - 2}px`,
                          top: `${topOffset}px`,
                          height: '26px',
                        }}
                        title={`[Văn bản: ${formatTimeLabel(sTime, 0.1)} - ${formatTimeLabel(eTime, 0.1)}]: ${t.text}`}
                      >
                        {/* Left White Drag Handle */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragTextHandle(e, t, 'left')}
                            onTouchStart={(e) => handleStartDragTextHandle(e, t, 'left')}
                            className="absolute -left-2 top-0 bottom-0 w-2.5 bg-white rounded-l-[4px] border-r border-zinc-400 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-100 transition-transform"
                            title="Kéo mốc bắt đầu văn bản"
                            style={{ height: '26px' }}
                          >
                            <div className="w-0.5 h-2.5 bg-zinc-900 rounded-full" />
                          </div>
                        )}

                        {/* Text Content */}
                        <div className="flex flex-col min-w-0 flex-1 justify-center">
                          <span className="truncate select-none pointer-events-none text-[10.5px] font-bold text-white leading-tight">
                            {t.text}
                          </span>
                        </div>

                        {/* Right White Drag Handle */}
                        {isSelected && (
                          <div
                            onMouseDown={(e) => handleStartDragTextHandle(e, t, 'right')}
                            onTouchStart={(e) => handleStartDragTextHandle(e, t, 'right')}
                            className="absolute -right-2 top-0 bottom-0 w-2.5 bg-white rounded-r-[4px] border-l border-zinc-400 shadow-md flex items-center justify-center cursor-ew-resize z-40 touch-none active:bg-sky-100 transition-transform"
                            title="Kéo mốc kết thúc văn bản"
                            style={{ height: '26px' }}
                          >
                            <div className="w-0.5 h-2.5 bg-zinc-900 rounded-full" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ROW 5: AUDIO TRACK LANE */}
                <div 
                  className="h-[32px] bg-[#0a0a0c] border-b border-zinc-900/90 mb-1 relative flex items-center z-10"
                >
                  {/* Audio Track Rail Bar - Darkened */}
                  <div
                    className="absolute inset-y-0 bg-[#101014] rounded-none z-0 pointer-events-none"
                    style={{
                      left: `-${playheadOffset}px`,
                      width: `calc(100% + ${playheadOffset}px)`,
                    }}
                  />

                  {visibleSubtitles
                    .filter((sub) => sub.audioUrl && !sub.audioDeleted)
                    .map((sub) => {
                      const startPx = (sub.startTime / safeDuration) * (containerWidth * zoom);
                      const endPx = (sub.endTime / safeDuration) * (containerWidth * zoom);
                      const widthPx = Math.max(8, endPx - startPx);

                      const isSelected = selectedAudioId === sub.id;

                      const speedVal = sub.speed !== undefined && sub.speed > 0
                        ? sub.speed
                        : (appSettings?.ttsSpeed || 1.0);
                      const pitchVal = sub.pitch !== undefined
                        ? sub.pitch
                        : (appSettings?.ttsPitch || 0);

                      const speedText = `${speedVal.toFixed(1)}x`;
                      const pitchText = `P:${pitchVal >= 0 ? '+' : ''}${pitchVal}`;

                      return (
                        <div
                          key={`dub-${sub.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSeek(sub.startTime);
                            if (onSelectAudio) onSelectAudio(sub);
                            if (onSelectSubtitle) onSelectSubtitle(null);
                            if (onSelectVideoBlock) onSelectVideoBlock(false);
                            if (onSelectTextOverlay) onSelectTextOverlay(null);
                            if (onPlaySingleAudio) {
                              onPlaySingleAudio(sub);
                            } else if (onPlayTTS) {
                              onPlayTTS(sub.translatedText || sub.originalText);
                            }
                          }}
                          className={`absolute rounded-[5px] overflow-hidden transition-all cursor-pointer select-none flex items-center px-1.5 ${
                            isSelected
                              ? 'bg-[#22b8cf] ring-2 ring-white border-2 border-white shadow-md z-30 brightness-110'
                              : 'bg-[#22b8cf] hover:brightness-105 border border-white/20 shadow-xs z-20'
                          }`}
                          style={{
                            left: `${startPx}px`,
                            width: `${widthPx - 2}px`,
                            top: '2px',
                            height: '28px',
                          }}
                          title={`[Audio TTS] Tốc độ: ${speedText} | Cao độ: ${pitchText} | Nội dung: ${sub.translatedText || sub.originalText}`}
                        >
                          {/* Audio Waveform with Vertical Bars */}
                          <div className="absolute inset-0 opacity-35 pointer-events-none">
                            {renderAudioWaveform(widthPx - 2, 28)}
                          </div>

                          {/* Speed & Pitch Badge Overlay */}
                          <div className="relative z-10 flex items-center justify-between w-full text-[10px] font-mono font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] truncate pointer-events-none leading-none">
                            {widthPx >= 40 ? (
                              <>
                                <span className="bg-black/50 text-white px-1.5 py-0.5 rounded-[3px] leading-none">
                                  {speedText}
                                </span>
                                {widthPx >= 72 && (
                                  <span className="bg-black/50 text-cyan-200 px-1.5 py-0.5 rounded-[3px] leading-none ml-1">
                                    {pitchText}
                                  </span>
                                )}
                              </>
                            ) : widthPx >= 20 ? (
                              <span className="bg-black/50 text-white px-1 py-0.5 rounded-[3px] text-[8.5px] leading-none">
                                {speedText}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* ROW 6: NHẠC NỀN TRACK LANE (Chỉ hiển thị khi đã chọn nhạc nền) */}
                {Boolean(bgMusicTitle) && (
                  <div className="h-[28px] bg-[#0a0a0c] border-b border-zinc-900/90 relative flex items-center px-0 z-10">
                    {/* Nhạc nền Track Rail Bar - Darkened */}
                    <div
                      className="absolute inset-y-0 bg-[#101014] rounded-none z-0 pointer-events-none"
                      style={{
                        left: `-${playheadOffset}px`,
                        width: `calc(100% + ${playheadOffset}px)`,
                      }}
                    />

                    <div
                      className="absolute left-0 right-0 h-[24px] bg-[#14171d] border border-zinc-800 rounded-[4px] flex items-center justify-between px-2.5 overflow-hidden z-10"
                      style={{
                        top: '2px',
                      }}
                    >
                      <div className="flex items-center space-x-1.5 relative z-10 truncate">
                        <Music2 className="w-3 h-3 text-zinc-300 flex-shrink-0" />
                        <span className="text-[9.5px] font-medium text-zinc-200 truncate">
                          {bgMusicTitle}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
