import { SubtitleItem } from '../types';

/**
 * Encodes an AudioBuffer into a WAV format Blob (16-bit PCM)
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const length = buffer.length;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  /* RIFF identifier */
  writeString(0, 'RIFF');
  /* RIFF chunk size */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type */
  writeString(8, 'WAVE');
  /* format chunk identifier */
  writeString(12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(36, 'data');
  /* data chunk length */
  view.setUint32(40, dataSize, true);
  
  // Write interleaved PCM audio samples
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp float sample to [-1, 1]
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to 16-bit signed integer [-32768, 32767]
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Generates and renders a single synchronized AudioBuffer of the TTS voiceover.
 */
export async function generateVoiceoverAudioBuffer(
  subtitles: SubtitleItem[],
  totalVideoDuration: number = 0,
  speedMultiplier: number = 1.0,
  ttsPitch: number = 0
): Promise<{ buffer: AudioBuffer; count: number; totalDuration: number }> {
  const subsWithAudio = subtitles.filter((s) => s.audioUrl && s.audioUrl.trim().length > 0);
  
  if (subsWithAudio.length === 0) {
    throw new Error('Chưa có phụ đề nào được tạo audio thuyết minh. Vui lòng bấm "Tạo Tất Cả Audio" trước khi xuất.');
  }

  const sampleRate = 24000; // Standard TTS audio sample rate
  const channels = 1;       // Mono channel output

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const tempCtx = new AudioCtx();

  // Decode each subtitle audio URL into AudioBuffer
  const decodedBuffers: { startTime: number; buffer: AudioBuffer; speed: number; finalDuration: number }[] = [];

  // Helper to decode any audio URL / Base64 format safely
  async function decodeAudioUrlSafely(ctx: AudioContext, rawUrl: string): Promise<AudioBuffer> {
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('http') || trimmed.startsWith('/')) {
      try {
        const response = await fetch(trimmed);
        const arrayBuf = await response.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuf.slice(0));
      } catch (fetchErr) {
        // Fallback to manual base64 parsing if data URL fetch fails
        if (trimmed.startsWith('data:audio/')) {
          const base64Data = trimmed.replace(/^data:audio\/\w+;base64,/, '');
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          return await ctx.decodeAudioData(bytes.buffer.slice(0));
        }
        throw fetchErr;
      }
    } else {
      // Raw Base64 string without data: header
      const binaryStr = atob(trimmed);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    }
  }

  for (const sub of subsWithAudio) {
    try {
      const decoded = await decodeAudioUrlSafely(tempCtx, sub.audioUrl!);
      const normalDuration = decoded.duration;
      
      // Calculate original target duration
      const targetDuration = sub.endTime - sub.startTime;
      
      // Smart Audio Fit Logic: Strict safe boundary [0.95, 1.25]
      let appliedSpeed = sub.speed || speedMultiplier || 1.0;
      if (!sub.speed) {
        if (normalDuration > targetDuration) {
          const requiredSpeed = normalDuration / targetDuration;
          appliedSpeed = Math.min(1.25, Math.max(1.0, requiredSpeed));
        }
      }
      appliedSpeed = Math.max(0.95, Math.min(1.25, appliedSpeed));
      
      const finalDuration = normalDuration / appliedSpeed;

      decodedBuffers.push({
        startTime: sub.startTime,
        buffer: decoded,
        speed: appliedSpeed,
        finalDuration,
      });
    } catch (err) {
      console.warn(`[Audio Exporter] Unable to decode TTS audio for sub ${sub.id}:`, err);
    }
  }

  if (decodedBuffers.length === 0) {
    throw new Error('Không thể giải mã dữ liệu audio thuyết minh.');
  }

  // Calculate maximum timeline duration needed based on the fitted end times
  let maxEndTime = totalVideoDuration || 0;
  for (const item of decodedBuffers) {
    const estimatedEnd = item.startTime + item.finalDuration;
    if (estimatedEnd > maxEndTime) {
      maxEndTime = estimatedEnd;
    }
  }

  // Ensure minimum duration of 1 second
  maxEndTime = Math.max(1, maxEndTime + 1);

  // Create OfflineAudioContext to render full concatenated audio track
  const offlineCtx = new OfflineAudioContext(
    channels,
    Math.ceil(sampleRate * maxEndTime),
    sampleRate
  );

  // Schedule each audio buffer at its specified startTime with its calculated playbackRate and pitch shift
  for (const item of decodedBuffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = item.buffer;
    
    // Set custom playback rate within strict safe bounds [0.95, 1.25]
    if (item.speed !== 1.0) {
      source.playbackRate.value = Math.max(0.95, Math.min(1.25, item.speed));
    }

    // Apply manual ttsPitch detuning + optional pitch compensation for playback speedup (1 semitone = 100 cents)
    // If speed > 1.0, we slightly compensate pitch downwards (-cents) to neutralize the "chipmunk" shift if desired,
    // or apply exact user-configured ttsPitch detune.
    let totalDetuneCents = ttsPitch * 100;
    if (item.speed > 1.0) {
      // Natural pitch compensation: counter playbackRate pitch shift (cents = 1200 * log2(1/speed))
      const pitchCompensationCents = -1200 * Math.log2(item.speed);
      totalDetuneCents += pitchCompensationCents;
    }

    const clampedDetune = Math.max(-1200, Math.min(1200, totalDetuneCents));
    if (clampedDetune !== 0) {
      source.detune.value = clampedDetune;
    }
    
    source.connect(offlineCtx.destination);
    source.start(item.startTime);
  }

  // Render composite audio
  const renderedBuffer = await offlineCtx.startRendering();

  return {
    buffer: renderedBuffer,
    count: decodedBuffers.length,
    totalDuration: maxEndTime,
  };
}

/**
 * Merges all available TTS audio clips from subtitles into a single synchronized WAV file.
 */
export async function generateVoiceoverWav(
  subtitles: SubtitleItem[],
  totalVideoDuration: number = 0,
  speedMultiplier: number = 1.0,
  ttsPitch: number = 0
): Promise<{ blob: Blob; count: number; totalDuration: number }> {
  const { buffer, count, totalDuration } = await generateVoiceoverAudioBuffer(
    subtitles,
    totalVideoDuration,
    speedMultiplier,
    ttsPitch
  );

  // Convert to WAV Blob
  const wavBlob = audioBufferToWavBlob(buffer);

  return {
    blob: wavBlob,
    count,
    totalDuration,
  };
}

/**
 * Extracts a lightweight, compact 16kHz mono WAV audio Blob from a video Blob or URL.
 * Resamples to 16,000 Hz Mono, reducing size by ~98% compared to the original video
 * (e.g., a 100MB video becomes ~1.9MB per minute of 16kHz mono audio).
 * This completely avoids HTTP 413 Payload Too Large errors when sending to speech-to-text.
 */
export async function extractAudioFromVideoBlob(
  videoBlobOrUrl: Blob | string,
  startSeconds: number = 0,
  endSeconds?: number,
  onProgress?: (message: string) => void
): Promise<{ audioBlob: Blob; durationSeconds: number }> {
  onProgress?.('Đang chuẩn bị dữ liệu video...');
  let blob: Blob;
  if (typeof videoBlobOrUrl === 'string') {
    const res = await fetch(videoBlobOrUrl);
    blob = await res.blob();
  } else {
    blob = videoBlobOrUrl;
  }

  // If already an audio file and no slicing requested
  if (blob.type.startsWith('audio/') && startSeconds === 0 && !endSeconds) {
    return { audioBlob: blob, durationSeconds: 0 };
  }

  onProgress?.('Đang giải mã và tách dải âm thanh 16kHz từ video...');
  const arrayBuffer = await blob.arrayBuffer();

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const tempCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  } finally {
    try {
      await tempCtx.close();
    } catch {}
  }

  const totalDuration = decodedBuffer.duration;
  const actualStart = Math.max(0, Math.min(startSeconds, totalDuration));
  const actualEnd = endSeconds && endSeconds > actualStart ? Math.min(endSeconds, totalDuration) : totalDuration;
  const targetDuration = Math.max(0.1, actualEnd - actualStart);

  // Resample & downmix to 16,000 Hz Mono (CapCut / Whisper ASR optimal standard)
  const targetSampleRate = 16000;
  const targetLength = Math.max(1, Math.ceil(targetDuration * targetSampleRate));
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0, actualStart, targetDuration);

  onProgress?.('Đang tối ưu hóa định dạng âm thanh cho AI CapCut STT...');
  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWavBlob(renderedBuffer);

  return { audioBlob: wavBlob, durationSeconds: targetDuration };
}

/**
 * Uploads a large video/audio file in small chunks (e.g. 5MB) to avoid HTTP 413 Payload Too Large
 */
export async function uploadFileInChunks(
  fileBlob: Blob,
  fileName: string = 'video.mp4',
  chunkSize: number = 5 * 1024 * 1024,
  onProgress?: (progressPercent: number, message: string) => void,
  signal?: AbortSignal
): Promise<{ serverTempFilePath: string }> {
  const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const totalSize = fileBlob.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);

  let mergedPath = '';
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }
    const start = i * chunkSize;
    const end = Math.min(totalSize, start + chunkSize);
    const chunkBlob = fileBlob.slice(start, end);

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(i));
    formData.append('totalChunks', String(totalChunks));
    formData.append('filename', fileName);
    formData.append('chunk', chunkBlob, `${fileName}.part${i}`);

    const percent = Math.round(((i + 1) / totalChunks) * 100);
    onProgress?.(
      percent,
      `Đang tải lên phân đoạn ${i + 1}/${totalChunks} (${(end / (1024 * 1024)).toFixed(1)}MB / ${(totalSize / (1024 * 1024)).toFixed(1)}MB)...`
    );

    const res = await fetch('/api/capcut-stt-chunk', {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Lỗi tải phân đoạn ${i + 1}: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.completed && data.tempFilePath) {
      mergedPath = data.tempFilePath;
    }
  }

  if (!mergedPath) {
    throw new Error('Không nhận được đường dẫn tệp ghép sau khi upload phân đoạn');
  }

  return { serverTempFilePath: mergedPath };
}

