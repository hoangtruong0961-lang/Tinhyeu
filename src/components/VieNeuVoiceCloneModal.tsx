import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
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
  AlertTriangle
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { VieNeuNative } from '../plugins/vieneuPlugin';
import { resolveApiUrl } from '../utils/apiUrl';
import { cloneVoiceLocally } from '../utils/localVoiceCloner';
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

  useEffect(() => {
    if (!isOpen) {
      handleReset();
    }
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
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
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

  const handleStartClone = async () => {
    const activeBlob = tab === 'record' ? recordedBlob : uploadedFile;
    if (!activeBlob) {
      setError('Vui lòng ghi âm hoặc tải lên tệp âm thanh mẫu (tối thiểu 3 giây).');
      return;
    }

    const cleanName = voiceName.trim() || `Giọng của tôi ${customVoices.length + 1}`;

    try {
      setIsProcessing(true);
      setError(null);
      setDetailedError(null);
      setSuccessMsg(null);
      setProcessStep('1/3: Đang phân tích sóng âm thanh offline trên thiết bị...');

      // 1. Perform 100% Client-Side Local Voice Profile Extraction
      const localResult = await cloneVoiceLocally(activeBlob, {
        voiceName: cleanName,
        gender,
        accent,
      });

      setProcessStep('2/3: Đang trích xuất đặc trưng âm sắc 192 chiều & mã hóa 16 RVQ codebooks...');

      const created: CustomVoiceItem = {
        id: localResult.id,
        name: localResult.name,
        gender: localResult.gender,
        accent: localResult.accent,
        style: localResult.style,
        description: localResult.description,
        speaker_emb: localResult.speaker_emb,
        codes: localResult.codes,
        createdAt: localResult.createdAt,
      };

      // 2. Save locally in localStorage for immediate offline discovery
      saveLocalCustomVoice(created as any);

      // 3. If running on Android Native APK, sync into native VieNeuEngine
      if (Capacitor.isNativePlatform() && created.speaker_emb && created.codes) {
        try {
          await VieNeuNative.saveCustomVoice({
            name: created.name,
            speakerEmb: created.speaker_emb,
            codes: created.codes,
          });
          console.log('[VieNeuVoiceCloneModal] Saved custom voice to Android Native engine successfully');
        } catch (nativeSaveErr) {
          console.warn('[VieNeuVoiceCloneModal] Native save custom voice notice:', nativeSaveErr);
        }
      }

      setProcessStep('3/3: Đang hoàn tất lưu giọng nhân bản...');

      // 4. Background sync to server if server endpoint is available (completely non-blocking)
      try {
        const formData = new FormData();
        formData.append('audio', activeBlob, 'voice_sample.wav');
        formData.append('voiceName', cleanName);
        formData.append('gender', gender);
        formData.append('accent', accent);
        const serverUrl = resolveApiUrl('/api/vieneu/clone-voice');
        fetch(serverUrl, { method: 'POST', body: formData }).catch(() => {});
      } catch (_) {}

      setSuccessMsg(`Nhân bản thành công giọng "${created.name}" (Lưu offline trực tiếp)!`);
      onVoiceCreated(created);

      setTimeout(() => {
        onClose();
      }, 1000);

    } catch (err: any) {
      console.error('Local clone voice failure:', err);
      setDetailedError({
        title: 'Lỗi Xử Lý Âm Thanh Local',
        message: err?.message || 'Không thể trích xuất đặc trưng giọng nói từ mẫu âm thanh.',
        cause: 'Tệp âm thanh tải lên hoặc bản ghi âm có định dạng không đọc được hoặc quá ngắn (dưới 1 giây).',
        suggestion: '1. Vui lòng ghi âm lại hoặc chọn tệp âm thanh WAV, MP3, WebM có tiếng nói rõ ràng.\n2. Đảm bảo âm thanh có độ dài từ 2 đến 10 giây.',
        technicalDetails: `Chi tiết lỗi: ${err?.stack || err?.message || String(err)}`,
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
              disabled={isProcessing || (tab === 'record' && !recordedBlob) || (tab === 'upload' && !uploadedFile)}
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
