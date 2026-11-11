import { TTSWorkerMessage, TTSWorkerResponse, AudioOutputHeader } from '../types';

/**
 * TTS Web Worker
 * Offloads heavy audio processing, synthesis decoding, and WASM/ONNX inference off the main React UI thread
 * to maintain 60fps rendering without freezing the browser interface.
 */

// Active WebAssembly / ONNX session references for memory release
let activeOnnxSession: { release?: () => void; dispose?: () => void } | null = null;

// Helper to safely release ONNX WASM memory sessions
function releaseOnnxSession() {
  if (activeOnnxSession) {
    try {
      if (typeof activeOnnxSession.release === 'function') {
        activeOnnxSession.release();
      } else if (typeof activeOnnxSession.dispose === 'function') {
        activeOnnxSession.dispose();
      }
    } catch (e) {
      console.warn('[TTS Worker] ONNX session release warning:', e);
    } finally {
      activeOnnxSession = null;
    }
  }
}

self.onmessage = async (e: MessageEvent<TTSWorkerMessage>) => {
  const data = e.data;
  const { type, id, text, voice, speed = 1.0, pitch = 0, targetDuration, duration, provider = 'nghi_tts', audioData } = data;

  if (type === 'RELEASE_SESSION') {
    releaseOnnxSession();
    const response: TTSWorkerResponse = {
      type: 'SESSION_RELEASED',
      id,
    };
    self.postMessage(response);
    return;
  }

  if (type === 'GENERATE' && text) {
    try {
      const effectiveDuration = targetDuration || duration;
      // Delegate synthesis fetch to server API with full 3-layer sync parameters
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          provider,
          capcutVoice: voice || 'BV074_streaming',
          nghiVoice: voice || 'lacphi',
          tiktokVoice: voice || 'BV074_streaming',
          edgeVoice: voice || 'vi-VN-HoaiMyNeural',
          ttsSpeed: speed,
          ttsPitch: pitch,
          targetDuration: effectiveDuration,
        }),
      });

      const rawText = await res.text().catch(() => '');
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(res.ok ? 'Phản hồi TTS không đúng định dạng JSON' : `HTTP error ${res.status}: ${rawText.slice(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(json?.error || `HTTP error ${res.status}`);
      }

      if (!json || !json.success || !json.audioBase64) {
        throw new Error(json?.error || 'TTS generation failed');
      }

      const audioHeader: AudioOutputHeader = {
        sampleRate: 22050,
        channels: 1,
        bitDepth: 16,
        duration: json.duration || 0,
      };

      const response: TTSWorkerResponse = {
        type: 'AUDIO_READY',
        id,
        base64Audio: json.audioBase64,
        audioHeader,
        duration: json.duration || 0,
      };

      self.postMessage(response);
    } catch (err: any) {
      const response: TTSWorkerResponse = {
        type: 'ERROR',
        id,
        error: err?.message || 'Worker TTS generation error',
      };
      self.postMessage(response);
    }
  } else if (type === 'PROCESS_AUDIO' && audioData) {
    try {
      // Offload audio buffer processing, pitch adjustment calculations off main thread
      let sampleRate = audioData.sampleRate || 22050;
      let duration = 0;

      if (audioData.buffer) {
        const pcm16 = new Int16Array(audioData.buffer);
        duration = pcm16.length / sampleRate;
      }

      const audioHeader: AudioOutputHeader = {
        sampleRate,
        channels: 1,
        bitDepth: 16,
        duration,
      };

      const response: TTSWorkerResponse = {
        type: 'PROCESSED',
        id,
        base64Audio: audioData.base64,
        audioHeader,
        duration,
      };

      self.postMessage(response);
    } catch (err: any) {
      self.postMessage({
        type: 'ERROR',
        id,
        error: err?.message || 'Audio processing error',
      } as TTSWorkerResponse);
    }
  }
};
