import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Upload,
  Play,
  Square,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  Volume2,
  Trash2,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  AlertTriangle,
  Download
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { VieNeuNative, VieNeuStatus, VieNeuProgressEvent } from '../plugins/vieneuPlugin';
import { saveLocalCustomVoice } from '../data/vieneuVoices';

export interface CustomVoiceItem {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'bac' | 'trung' | 'nam';
  style: string;
  description: string;
  speaker_emb?: number[];
  codes?: number[][];
  createdAt?: string;
}

interface VieNeuVoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceCreated: (newVoice: CustomVoiceItem) => void;
  customVoices: CustomVoiceItem[];
  onDeleteCustomVoice: (id: string) => void;
}

export interface DetailedErrorInfo {
  title: string;
  statusCode?: number;
  message: string;
  cause?: string;
  suggestion?: string;
  technicalDetails?: string;
  urlsTried?: string[];
}

export const VieNeuVoiceCloneModal: React.FC<VieNeuVoiceCloneModalProps> = ({
  isOpen,
  onClose,
  onVoiceCreated,
  customVoices,
  onDeleteCustomVoice,
}) => {
  const [tab, setTab] = useState<'record' | 'upload' | 'list'>('record');
  const [voiceName, setVoiceName] = useState<string>('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [accent, setAccent] = useState<'bac' | 'trung' | 'nam'>('bac');

  // Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio preview playback
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Submission & Error state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processStep, setProcessStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [detailedError, setDetailedError] = useState<DetailedErrorInfo | null>(null);
  const [showTechDetails, setShowTechDetails] = useState<boolean>(false);
  const [copiedTechDetails, setCopiedTechDetails] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Native ONNX cloning model readiness & download state
  const [nativeStatus, setNativeStatus] = useState<VieNeuStatus | null>(null);
  const [checkingModels, setCheckingModels] = useState<boolean>(false);
  const [isDownloadingCloning, setIsDownloadingCloning] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadMessage, setDownloadMessage] = useState<string>('');

  const refreshNativeStatus = async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      setCheckingModels(true);
      const st = await VieNeuNative.checkStatus();
      setNativeStatus(st);
    } catch (e) {
      console.warn('[VieNeuVoiceCloneModal] checkStatus error:', e);
    } finally {
      setCheckingModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      handleReset();
      return;
    }

    if (!Capacitor.isNativePlatform()) return;

    refreshNativeStatus();
    let removeSub: (() => Promise<void>) | null = null;
    VieNeuNative.addListener('vieneu_download_progress', (event: VieNeuProgressEvent) => {
      setDownloadProgress(event.percent);
      setDownloadMessage(event.message);
      if (event.status === 'completed') {
        setIsDownloadingCloning(false);
        refreshNativeStatus();
      } else if (event.status === 'error') {
        setIsDownloadingCloning(false);
        setError(event.message || 'Lỗi tải gói AI Clone Giọng.');
      } else if (event.status === 'cancelled') {
        setIsDownloadingCloning(false);
      }
    })
      .then((sub) => {
        removeSub = sub.remove;
      })
      .catch(() => {});

    return () => {
      if (removeSub) removeSub();
    };
  }, [isOpen]);

  const handleReset = () => {
    if (isRecording) {
      stopRecording();
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordedAudioUrl(null);
    setRecordedBlob(null);
    setUploadedFile(null);
    setUploadedAudioUrl(null);
    setIsPlayingPreview(false);
    setIsProcessing(false);
    setError(null);
    setDetailedError(null);
    setShowTechDetails(false);
    setCopiedTechDetails(false);
    setSuccessMsg(null);
    setProcessStep('');
  };

  // Start Mic Recording
  const startRecording = async () => {
    try {
      setError(null);
      setDetailedError(null);
      setSuccessMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const actualMime = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        setRecordedBlob(audioBlob);
        const url = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(url);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 15) {
            stopRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('Mic access error:', err);
      setError('Không thể truy cập Microphone. Vui lòng cấp quyền ghi âm cho trình duyệt/ứng dụng.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDetailedError(null);
    setSuccessMsg(null);
    setUploadedFile(file);
    const url = URL.createObjectURL(file);
    setUploadedAudioUrl(url);
    if (!voiceName) {
      const clean = file.name.replace(/\.[^/.]+$/, '').trim();
      setVoiceName(clean);
    }
  };

  const togglePlayAudio = (url: string) => {
    if (!url) return;
    if (audioPreviewRef.current) {
      if (isPlayingPreview) {
        audioPreviewRef.current.pause();
        setIsPlayingPreview(false);
        return;
      }
    }
    const audio = new Audio(url);
    audioPreviewRef.current = audio;
    audio.onended = () => setIsPlayingPreview(false);
    audio.onerror = () => setIsPlayingPreview(false);
    audio.play();
    setIsPlayingPreview(true);
  };

  const handleDownloadCloningPack = async () => {
    try {
      setIsDownloadingCloning(true);
      setError(null);
      setDetailedError(null);
      setDownloadProgress(2);
      setDownloadMessage('Đang kết nối kho mô hình HuggingFace...');

      if (nativeStatus?.isReady) {
        const res = await VieNeuNative.downloadCloningModels();
        if (res.isCloningReady) {
          setDownloadProgress(100);
          await refreshNativeStatus();
        }
      } else {
        const res = await VieNeuNative.downloadModels({ includeCloning: true });
        if (res.isReady) {
          setDownloadProgress(100);
          await refreshNativeStatus();
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải gói mô hình AI Clone Giọng.');
      setIsDownloadingCloning(false);
    }
  };

  const encodeMonoWav48k = (samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const prepareSampleForNativeClone = async (
    blob: Blob
  ): Promise<{ blob: Blob; fileName: string; mimeType: string }> => {
    const fallbackName = blob instanceof File ? blob.name : 'recorded_sample.webm';
    const fallbackMime = blob.type || 'audio/webm';
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      if (blob.size > 20 * 1024 * 1024) {
        throw new Error('Tệp âm thanh vượt quá 20 MB. Vui lòng chọn đoạn ngắn từ 3 đến 12 giây.');
      }
      return { blob, fileName: fallbackName, mimeType: fallbackMime };
    }

    let ctx: AudioContext | null = null;
    try {
      const rawBuf = await blob.arrayBuffer();
      ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(rawBuf.slice(0));
      const targetSr = 48000;
      const maxDurationSec = Math.min(12.0, Math.max(0.5, decoded.duration));
      const targetLen = Math.max(1, Math.floor(maxDurationSec * targetSr));

      const offline = new OfflineAudioContext(1, targetLen, targetSr);
      const src = offline.createBufferSource();
      src.buffer = decoded;

      const hp = offline.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 75;

      src.connect(hp);
      hp.connect(offline.destination);
      src.start(0, 0, maxDurationSec);

      const rendered = await offline.startRendering();
      const channelData = rendered.getChannelData(0);
      const wavBlob = encodeMonoWav48k(channelData, targetSr);
      return {
        blob: wavBlob,
        fileName: 'clone_sample_48k.wav',
        mimeType: 'audio/wav',
      };
    } catch (decodeErr) {
      console.warn('[VieNeuVoiceCloneModal] WebAudio WAV conversion fallback to native MediaCodec:', decodeErr);
      if (blob.size > 20 * 1024 * 1024) {
        throw new Error('Tệp âm thanh quá lớn (> 20 MB) hoặc định dạng không hợp lệ. Vui lòng cắt đoạn 3–12 giây.');
      }
      return { blob, fileName: fallbackName, mimeType: fallbackMime };
    } finally {
      if (ctx) {
        ctx.close().catch(() => {});
      }
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (!dataUrl) {
          reject(new Error('Không đọc được dữ liệu âm thanh đầu vào.'));
          return;
        }
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        resolve(b64);
      };
      reader.onerror = () => reject(new Error('Lỗi đọc dữ liệu FileReader từ âm thanh mẫu.'));
      reader.readAsDataURL(blob);
    });
  };

  const handleStartClone = async () => {
    const activeBlob = tab === 'record' ? recordedBlob : uploadedFile;
    if (!activeBlob) {
      setError('Vui lòng ghi âm hoặc tải lên tệp âm thanh mẫu (tối thiểu 3 giây).');
      return;
    }

    if (!Capacitor.isNativePlatform()) {
      setDetailedError({
        title: 'Chỉ Hỗ Trợ Nhân Bản Giọng Thật Trên Android APK',
        message: 'Tính năng trích xuất Speaker Embedding 192 chiều & MOSS Audio Tokenizer ONNX chạy trực tiếp trên thiết bị Android.',
        cause: 'Bạn đang mở trong trình duyệt web xem trước không có Native ONNX Engine.',
        suggestion: 'Vui lòng sử dụng trực tiếp trên bản Android APK để nhân bản giọng thật.',
      });
      return;
    }

    const cleanName = voiceName.trim() || `Giọng của tôi ${customVoices.length + 1}`;

    try {
      setIsProcessing(true);
      setError(null);
      setDetailedError(null);
      setSuccessMsg(null);

      setProcessStep('1/3: Đang kiểm tra gói AI Clone ONNX trên thiết bị...');
      const currentStatus = await VieNeuNative.checkStatus();
      setNativeStatus(currentStatus);

      if (!currentStatus.isCloningReady) {
        throw new Error(
          'Chưa cài đặt gói AI Clone Giọng thật (~64 MB: speaker_encoder.onnx + moss_audio_tokenizer_encode). Vui lòng bấm nút "Tải gói AI Clone Giọng" phía trên trước.'
        );
      }

      setProcessStep('2/3: Đang chuẩn hóa sóng âm 48kHz & chạy ONNX (Speaker Encoder + MOSS)...');
      const prepared = await prepareSampleForNativeClone(activeBlob);
      const audioBase64 = await blobToBase64(prepared.blob);

      const cloneRes = await VieNeuNative.cloneVoice({
        audioBase64,
        voiceName: cleanName,
        gender,
        accent,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
      });

      if (!cloneRes?.success || !cloneRes.voice) {
        throw new Error('Không nhận được kết quả vector giọng nói từ Native ONNX Engine.');
      }

      setProcessStep('3/3: Đang lưu giọng nhân bản chuẩn vào bộ nhớ máy...');
      const created: CustomVoiceItem = {
        id: cloneRes.voice.id || cleanName,
        name: cloneRes.voice.name || cleanName,
        gender: (cloneRes.voice.gender === 'female' ? 'female' : 'male'),
        accent: (cloneRes.voice.accent === 'nam' || cloneRes.voice.accent === 'trung') ? cloneRes.voice.accent : 'bac',
        style: cloneRes.voice.style || 'Nhân bản AI ONNX (Offline)',
        description: cloneRes.voice.description || `Giọng nhân bản AI thật (${cloneRes.voice.numFrames || cloneRes.voice.codes?.length || 0} khung RVQ)`,
        speaker_emb: cloneRes.voice.speaker_emb,
        codes: cloneRes.voice.codes,
        createdAt: cloneRes.voice.createdAt || new Date().toISOString(),
      };

      saveLocalCustomVoice(created as any);
      const framesCount = cloneRes.voice.numFrames || created.codes?.length || 0;
      setSuccessMsg(`Nhân bản giọng thật thành công "${created.name}" (${framesCount} khung tham chiếu ONNX)!`);
      onVoiceCreated(created);

      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Native ONNX clone voice failure:', err);
      const rawMsg = err?.message || String(err);
      const isMissingModel = rawMsg.includes('CLONING_MODELS_MISSING') || rawMsg.includes('Thiếu tệp mô hình') || rawMsg.includes('Chưa cài đặt gói AI Clone');
      setDetailedError({
        title: isMissingModel ? 'Thiếu Gói Mô Hình AI Clone Giọng (~64 MB)' : 'Lỗi Nhân Bản Giọng AI (ONNX)',
        message: rawMsg,
        cause: isMissingModel
          ? 'Thiết bị chưa có 2 mô hình ONNX thật để trích xuất đặc trưng giọng (speaker_encoder.onnx và moss_audio_tokenizer_encode.onnx).'
          : rawMsg,
        suggestion: isMissingModel
          ? 'Bấm nút "Tải gói AI Clone Giọng (~64 MB)" ở banner màu vàng ngay phía trên để tải về máy.'
          : '1. Ghi âm hoặc chọn đoạn nói rõ ràng dài từ 3 đến 8 giây, không lẫn nhạc nền.\n2. Đặt micro cách miệng 15–20cm để giọng rõ ràng, không bị rè.\n3. Nếu gặp lỗi bộ nhớ (OOM), hãy thử chọn đoạn ngắn 4–6 giây hoặc khởi động lại ứng dụng.',
        technicalDetails: `Platform: Android Native ONNX\nDetails: ${err?.stack || rawMsg}`,
      });
    } finally {
      setIsProcessing(false);
      setProcessStep('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-[#14151a] border border-amber-500/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Nhân Bản Giọng Nói AI (Voice Clone)
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  VieNeu-TTS v3 Turbo
                </span>
              </h3>
              <p className="text-xs text-zinc-400">
                Tạo giọng đọc mang âm sắc của riêng bạn chỉ từ 3 - 10 giây audio mẫu
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-white/10 px-5 pt-3 gap-2 bg-[#181920]">
          <button
            onClick={() => { setTab('record'); setError(null); }}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors cursor-pointer ${
              tab === 'record'
                ? 'bg-[#14151a] text-amber-400 border-t-2 border-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Mic className="w-3.5 h-3.5" /> Ghi âm trực tiếp
          </button>
          <button
            onClick={() => { setTab('upload'); setError(null); }}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors cursor-pointer ${
              tab === 'upload'
                ? 'bg-[#14151a] text-amber-400 border-t-2 border-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" /> Tải tệp âm thanh
          </button>
          {customVoices.length > 0 && (
            <button
              onClick={() => { setTab('list'); setError(null); }}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors cursor-pointer ml-auto ${
                tab === 'list'
                  ? 'bg-[#14151a] text-amber-400 border-t-2 border-amber-400 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" /> Giọng đã nhân bản ({customVoices.length})
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {Capacitor.isNativePlatform() && tab !== 'list' && (
            checkingModels ? (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2 text-xs text-zinc-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Đang kiểm tra mô hình AI Clone Giọng trên máy...</span>
              </div>
            ) : nativeStatus?.isCloningReady ? (
              <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2 text-[11px] text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Đã sẵn sàng động cơ AI Clone Giọng thật (Speaker Encoder + MOSS ONNX Offline)</span>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-amber-300">
                      {nativeStatus?.isReady
                        ? 'Cần tải gói AI Clone Giọng thật (~64 MB)'
                        : 'Cần tải bộ mô hình VieNeu + Clone Giọng (~211 MB)'}
                    </p>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">
                      Gói này chứa 2 mạng nơ-ron thật (Speaker Encoder &amp; MOSS Tokenizer) giúp nhân bản đúng chất giọng của bạn.
                    </p>
                  </div>
                </div>

                {isDownloadingCloning ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-200 flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin text-amber-400" />
                        {downloadMessage || 'Đang tải xuống...'}
                      </span>
                      <span className="font-mono text-amber-400 font-bold">{downloadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDownloadCloningPack}
                    className="w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {nativeStatus?.isReady
                      ? 'Tải ngay gói AI Clone Giọng (~64 MB)'
                      : 'Tải trọn bộ VieNeu + Clone Giọng (~211 MB)'}
                  </button>
                )}
              </div>
            )
          )}
          {tab === 'record' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-white/10 bg-black/40 flex flex-col items-center justify-center text-center space-y-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg cursor-pointer ${
                      isRecording
                        ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30'
                        : 'bg-amber-500 text-black hover:bg-amber-400'
                    }`}
                  >
                    {isRecording ? <Square className="w-6 h-6" /> : <Mic className="w-7 h-7" />}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-semibold text-white">
                    {isRecording ? `Đang ghi âm: ${recordingSeconds}s / 15s` : 'Bấm để bắt đầu thu âm mẫu'}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Hãy đọc một câu ngắn (khoảng 3 đến 8 giây) bằng giọng tự nhiên, rõ ràng, ít tiếng ồn.
                  </p>
                </div>

                {recordedAudioUrl && !isRecording && (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => togglePlayAudio(recordedAudioUrl)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium cursor-pointer"
                    >
                      {isPlayingPreview ? <Square className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-amber-400" />}
                      {isPlayingPreview ? 'Dừng phát' : 'Nghe lại bản thu'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecordedAudioUrl(null);
                        setRecordedBlob(null);
                        setRecordingSeconds(0);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs font-medium cursor-pointer"
                    >
                      Thu lại
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="p-6 rounded-xl border-2 border-dashed border-white/10 hover:border-amber-500/40 bg-black/40 hover:bg-amber-500/5 transition-all flex flex-col items-center justify-center text-center cursor-pointer space-y-2"
              >
                <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {uploadedFile ? uploadedFile.name : 'Chọn tệp âm thanh mẫu từ thiết bị'}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Hỗ trợ định dạng MP3, WAV, M4A, WebM (Khuyến nghị 3 - 10 giây âm thanh trong trẻo)
                  </p>
                </div>
              </div>

              {uploadedAudioUrl && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Volume2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-zinc-200 truncate">{uploadedFile?.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePlayAudio(uploadedAudioUrl)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium cursor-pointer"
                  >
                    {isPlayingPreview ? <Square className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-amber-400" />}
                    {isPlayingPreview ? 'Dừng' : 'Nghe thử'}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'list' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Danh sách các giọng bạn đã nhân bản thành công. Bạn có thể sử dụng các giọng này ngay trong thanh công cụ tạo giọng đọc:
              </p>
              <div className="space-y-2">
                {customVoices.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-amber-500/30 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold">
                        {v.gender === 'female' ? '🌸' : '🎙️'}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white flex items-center gap-1.5">
                          {v.name}
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                            {v.accent === 'nam' ? 'Miền Nam' : v.accent === 'trung' ? 'Miền Trung' : 'Miền Bắc'}
                          </span>
                        </p>
                        <p className="text-[10px] text-zinc-400 mt-0.5">{v.description}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCustomVoice(v.id)}
                      className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Xóa giọng nhân bản"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Voice Metadata Configuration (shown for Record & Upload tabs) */}
          {tab !== 'list' && (
            <div className="space-y-3 pt-2 border-t border-white/10">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1">
                  Tên giọng nhân bản <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="Ví dụ: Giọng đọc của tôi, Giọng MC Nam..."
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Giới tính</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    <option value="male" className="bg-[#1e1e24]">🎙️ Nam (Male)</option>
                    <option value="female" className="bg-[#1e1e24]">🌸 Nữ (Female)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Vùng miền / Ngữ điệu</label>
                  <select
                    value={accent}
                    onChange={(e) => setAccent(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    <option value="bac" className="bg-[#1e1e24]">🌟 Miền Bắc</option>
                    <option value="nam" className="bg-[#1e1e24]">✨ Miền Nam</option>
                    <option value="trung" className="bg-[#1e1e24]">🌿 Miền Trung</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-2 text-xs text-amber-200/90">
                <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Mẹo AI:</strong> Sử dụng đoạn âm thanh không lẫn nhạc nền hoặc tạp âm, nói tốc độ vừa phải sẽ giúp mô hình trích xuất chuẩn xác chất giọng và ngữ điệu chân thực nhất.
                </span>
              </div>
            </div>
          )}

          {/* Detailed Error Diagnosis Card */}
          {detailedError && (
            <div className="p-4 rounded-xl bg-gradient-to-br from-rose-950/50 via-rose-900/30 to-black border border-rose-500/40 text-xs text-rose-200 space-y-3 shadow-2xl animate-in fade-in duration-200">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 flex-shrink-0 shadow-inner">
                    <AlertTriangle className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-bold text-rose-100 text-xs flex items-center gap-2">
                      {detailedError.title}
                      {detailedError.statusCode ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-500/30 text-rose-300 font-bold border border-rose-500/40">
                          HTTP {detailedError.statusCode}
                        </span>
                      ) : null}
                    </h4>
                    <p className="text-[11px] text-rose-300/80 mt-0.5">{detailedError.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailedError(null)}
                  className="text-rose-400 hover:text-white p-1 rounded-md hover:bg-rose-500/20 transition-colors cursor-pointer"
                  title="Đóng thông báo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {detailedError.cause && (
                <div className="p-2.5 rounded-lg bg-black/50 border border-rose-500/20 space-y-1">
                  <span className="font-semibold text-rose-300 block text-[11px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block"></span>
                    Nguyên nhân phát sinh:
                  </span>
                  <p className="text-zinc-300 leading-relaxed text-[11px] whitespace-pre-wrap pl-2.5">{detailedError.cause}</p>
                </div>
              )}

              {detailedError.suggestion && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 space-y-1 text-amber-200">
                  <span className="font-semibold text-amber-300 block text-[11px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                    Gợi ý hướng xử lý:
                  </span>
                  <p className="text-amber-100/90 leading-relaxed text-[11px] whitespace-pre-wrap pl-2.5">{detailedError.suggestion}</p>
                </div>
              )}

              {detailedError.technicalDetails && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowTechDetails(!showTechDetails)}
                    className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 font-mono py-1 cursor-pointer select-none"
                  >
                    {showTechDetails ? <ChevronUp className="w-3.5 h-3.5 text-rose-400" /> : <ChevronDown className="w-3.5 h-3.5 text-rose-400" />}
                    {showTechDetails ? 'Ẩn nhật ký kỹ thuật (Diagnostic Logs)' : 'Xem chi tiết kỹ thuật & Nhật ký Endpoint máy chủ'}
                  </button>

                  {showTechDetails && (
                    <div className="relative mt-2 p-3 rounded-xl bg-black/90 border border-zinc-800 font-mono text-[10px] text-zinc-300 overflow-x-auto max-h-48 leading-relaxed shadow-inner">
                      <button
                        type="button"
                        onClick={() => {
                          if (detailedError.technicalDetails) {
                            navigator.clipboard.writeText(detailedError.technicalDetails);
                            setCopiedTechDetails(true);
                            setTimeout(() => setCopiedTechDetails(false), 2000);
                          }
                        }}
                        className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[9px] flex items-center gap-1 border border-zinc-700 transition-colors cursor-pointer"
                      >
                        {copiedTechDetails ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                        {copiedTechDetails ? 'Đã sao chép' : 'Sao chép Log'}
                      </button>
                      <pre className="whitespace-pre-wrap break-all pr-16 text-zinc-400">{detailedError.technicalDetails}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Feedback & Simple Status Message */}
          {error && !detailedError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {isProcessing && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-300">
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
              <span>{processStep || 'Đang xử lý nhân bản...'}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {tab !== 'list' && (
          <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10 bg-[#14151a]">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl transition-colors cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              onClick={handleStartClone}
              disabled={
                isProcessing ||
                isDownloadingCloning ||
                (tab === 'record' && !recordedBlob) ||
                (tab === 'upload' && !uploadedFile) ||
                (Capacitor.isNativePlatform() && nativeStatus !== null && !nativeStatus.isCloningReady)
              }
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-xs shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Đang nhân bản...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Bắt đầu nhân bản giọng
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
