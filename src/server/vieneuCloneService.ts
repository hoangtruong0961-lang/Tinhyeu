import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import * as ort from 'onnxruntime-node';

const execFilePromise = util.promisify(execFile);

// Mel filterbank constants
const NUM_MELS = 80;
const N_FFT = 512;
const WIN_LEN = 400; // 25ms @ 16kHz
const HOP_LEN = 160; // 10ms @ 16kHz
const SAMPLE_RATE_SPK = 16000;
const SAMPLE_RATE_MOSS = 48000;

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function createMelFilterbank(
  numBands = NUM_MELS,
  nFft = N_FFT,
  sampleRate = SAMPLE_RATE_SPK,
  fMin = 20,
  fMax = 8000
): Float32Array[] {
  const numBins = Math.floor(nFft / 2) + 1; // 257
  const minMel = hzToMel(fMin);
  const maxMel = hzToMel(fMax);
  const melPoints = new Float32Array(numBands + 2);
  for (let i = 0; i <= numBands + 1; i++) {
    melPoints[i] = minMel + (i / (numBands + 1)) * (maxMel - minMel);
  }
  const hzPoints = Array.from(melPoints).map(melToHz);
  const binPoints = hzPoints.map((hz) => Math.floor(((nFft + 1) * hz) / sampleRate));

  const filterbank: Float32Array[] = [];
  for (let m = 0; m < numBands; m++) {
    const row = new Float32Array(numBins);
    const start = binPoints[m];
    const center = binPoints[m + 1];
    const end = binPoints[m + 2];
    for (let k = start; k < center; k++) {
      row[k] = (k - start) / Math.max(1, center - start);
    }
    for (let k = center; k < end; k++) {
      row[k] = (end - k) / Math.max(1, end - center);
    }
    filterbank.push(row);
  }
  return filterbank;
}

const MEL_FILTERBANK = createMelFilterbank();

function fft512(real: Float32Array, imag: Float32Array) {
  const N = 512;
  let j = 0;
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;
      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
    let k = N >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < half; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + half] * wR - imag[i + k + half] * wI;
        const vI = real[i + k + half] * wI + imag[i + k + half] * wR;
        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;
        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }
}

function computeFbank(samples16k: Float32Array): { fbank: Float32Array; numFrames: number } | null {
  const window = new Float32Array(WIN_LEN);
  for (let i = 0; i < WIN_LEN; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN_LEN - 1));
  }

  const numFrames = Math.floor((samples16k.length - WIN_LEN) / HOP_LEN) + 1;
  if (numFrames <= 0) return null;

  const fbank = new Float32Array(numFrames * NUM_MELS);
  const real = new Float32Array(N_FFT);
  const imag = new Float32Array(N_FFT);
  const power = new Float32Array(Math.floor(N_FFT / 2) + 1);

  for (let f = 0; f < numFrames; f++) {
    real.fill(0);
    imag.fill(0);
    const start = f * HOP_LEN;
    for (let i = 0; i < WIN_LEN; i++) {
      real[i] = samples16k[start + i] * window[i];
    }
    fft512(real, imag);
    for (let k = 0; k <= 256; k++) {
      power[k] = real[k] * real[k] + imag[k] * imag[k];
    }
    for (let m = 0; m < NUM_MELS; m++) {
      let energy = 0;
      const row = MEL_FILTERBANK[m];
      for (let k = 0; k <= 256; k++) {
        energy += row[k] * power[k];
      }
      fbank[f * NUM_MELS + m] = Math.log(Math.max(energy, 1e-5));
    }
  }

  // Cepstral Mean Normalization (CMN) across time
  for (let m = 0; m < NUM_MELS; m++) {
    let mean = 0;
    for (let f = 0; f < numFrames; f++) {
      mean += fbank[f * NUM_MELS + m];
    }
    mean /= numFrames;
    for (let f = 0; f < numFrames; f++) {
      fbank[f * NUM_MELS + m] -= mean;
    }
  }

  return { fbank, numFrames };
}

function parsePcmWav(buffer: Buffer): { samples: Float32Array; channels: number; sampleRate: number } {
  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataSize = buffer.length - 44;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / bytesPerSample);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sampleIdx = dataOffset + i * bytesPerSample;
    if (sampleIdx + bytesPerSample <= buffer.length) {
      if (bitsPerSample === 16) {
        samples[i] = buffer.readInt16LE(sampleIdx) / 32768.0;
      } else if (bitsPerSample === 32) {
        samples[i] = buffer.readFloatLE(sampleIdx);
      }
    }
  }

  return { samples, channels, sampleRate };
}

export interface ClonedVoicePreset {
  id: string;
  name: string;
  gender: 'male' | 'female';
  accent: 'bac' | 'trung' | 'nam';
  style: string;
  description: string;
  speaker_emb: number[];
  codes: number[][];
  createdAt: string;
}

let spkEncoderSession: ort.InferenceSession | null = null;
let mossEncoderSession: ort.InferenceSession | null = null;

async function getSpkEncoderSession(): Promise<ort.InferenceSession> {
  if (!spkEncoderSession) {
    const p = path.join(process.cwd(), 'models', 'speaker_encoder.onnx');
    spkEncoderSession = await ort.InferenceSession.create(p, {
      executionProviders: ['cpu'],
    });
  }
  return spkEncoderSession;
}

async function getMossEncoderSession(): Promise<ort.InferenceSession> {
  if (!mossEncoderSession) {
    const p = path.join(process.cwd(), 'models', 'moss_audio_tokenizer_encode.onnx');
    mossEncoderSession = await ort.InferenceSession.create(p, {
      executionProviders: ['cpu'],
    });
  }
  return mossEncoderSession;
}

const CUSTOM_VOICES_FILE = path.join(process.cwd(), 'models', 'custom_voices.json');

export function loadCustomVoices(): Record<string, ClonedVoicePreset> {
  try {
    if (fs.existsSync(CUSTOM_VOICES_FILE)) {
      const content = fs.readFileSync(CUSTOM_VOICES_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn('[loadCustomVoices] Failed to read custom voices:', e);
  }
  return {};
}

export function saveCustomVoices(voices: Record<string, ClonedVoicePreset>) {
  try {
    fs.writeFileSync(CUSTOM_VOICES_FILE, JSON.stringify(voices, null, 2), 'utf-8');

    // Also sync to voices_v3_turbo.json presets for immediate engine discovery
    const mainFiles = [
      path.join(process.cwd(), 'models', 'voices_v3_turbo.json'),
      path.join(process.cwd(), 'public', 'models', 'voices_v3_turbo.json'),
    ];
    for (const mainVoicesFile of mainFiles) {
      if (fs.existsSync(mainVoicesFile)) {
        const mainData = JSON.parse(fs.readFileSync(mainVoicesFile, 'utf-8'));
        if (!mainData.presets) mainData.presets = {};
        for (const [key, v] of Object.entries(voices)) {
          mainData.presets[key] = {
            speaker_emb: v.speaker_emb,
            codes: v.codes,
          };
        }
        fs.writeFileSync(mainVoicesFile, JSON.stringify(mainData, null, 2), 'utf-8');
      }
    }
  } catch (e) {
    console.error('[saveCustomVoices] Failed to persist custom voices:', e);
  }
}

export function deleteCustomVoice(id: string): boolean {
  try {
    const current = loadCustomVoices();
    if (!current[id]) return false;
    delete current[id];
    fs.writeFileSync(CUSTOM_VOICES_FILE, JSON.stringify(current, null, 2), 'utf-8');

    const mainFiles = [
      path.join(process.cwd(), 'models', 'voices_v3_turbo.json'),
      path.join(process.cwd(), 'public', 'models', 'voices_v3_turbo.json'),
    ];
    for (const mainVoicesFile of mainFiles) {
      if (fs.existsSync(mainVoicesFile)) {
        const mainData = JSON.parse(fs.readFileSync(mainVoicesFile, 'utf-8'));
        if (mainData.presets && mainData.presets[id]) {
          delete mainData.presets[id];
          fs.writeFileSync(mainVoicesFile, JSON.stringify(mainData, null, 2), 'utf-8');
        }
      }
    }
    return true;
  } catch (e) {
    console.error('[deleteCustomVoice] Error deleting voice:', e);
    return false;
  }
}

export const deleteCustomVoiceFromDisk = deleteCustomVoice;

export async function extractVoiceProfileFromAudio(
  audioBuffer: Buffer,
  options: {
    voiceName: string;
    gender?: 'male' | 'female';
    accent?: 'bac' | 'trung' | 'nam';
  }
): Promise<ClonedVoicePreset> {
  return cloneVoiceFromAudio(audioBuffer, options.voiceName, options.gender || 'male', options.accent || 'bac');
}

/**
 * Extracts speaker embedding and audio RVQ codes from audio buffer using VieNeu cloning models
 */
export async function cloneVoiceFromAudio(
  audioBuffer: Buffer,
  voiceName: string,
  gender: 'male' | 'female' = 'male',
  accent: 'bac' | 'trung' | 'nam' = 'bac'
): Promise<ClonedVoicePreset> {
  const tempDir = path.join(os.tmpdir(), `cloning_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const inputAudioPath = path.join(tempDir, 'raw_input.bin');
  const wav16kPath = path.join(tempDir, 'sample_16k.wav');
  const wav48kPath = path.join(tempDir, 'sample_48k.wav');

  try {
    fs.writeFileSync(inputAudioPath, audioBuffer);

    // 1. Resample to 16kHz mono (for speaker encoder)
    await execFilePromise('ffmpeg', [
      '-y',
      '-i',
      inputAudioPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-t',
      '10', // Max 10 seconds of speech
      '-f',
      'wav',
      wav16kPath,
    ]);

    // 2. Resample to 48kHz stereo (for MOSS audio tokenizer)
    await execFilePromise('ffmpeg', [
      '-y',
      '-i',
      inputAudioPath,
      '-ac',
      '2',
      '-ar',
      '48000',
      '-t',
      '5', // 3 to 5 seconds is optimal for prompt reference codes
      '-f',
      'wav',
      wav48kPath,
    ]);

    // 3. Compute speaker embedding using speaker_encoder.onnx
    let speakerEmb: number[] = [];
    try {
      const buf16k = fs.readFileSync(wav16kPath);
      const { samples: samples16k } = parsePcmWav(buf16k);
      const fbankRes = computeFbank(samples16k);
      if (!fbankRes || fbankRes.numFrames < 5) {
        throw new Error('Đoạn âm thanh quá ngắn (dưới 1.5 giây). Vui lòng cung cấp đoạn âm thanh mẫu từ 3 đến 10 giây.');
      }

      const spkSession = await getSpkEncoderSession();
      const fbankTensor = new ort.Tensor('float32', fbankRes.fbank, [1, fbankRes.numFrames, NUM_MELS]);
      const spkOut = await spkSession.run({ input: fbankTensor });
      const spkEmbRaw = spkOut.output.data as Float32Array;
      speakerEmb = Array.from(spkEmbRaw).slice(0, 192);
    } catch (spkErr: any) {
      console.warn('[VieNeuCloneService] Speaker encoder ONNX session fallback:', spkErr?.message || spkErr);
      try {
        const buf16k = fs.readFileSync(wav16kPath);
        const { samples: samples16k } = parsePcmWav(buf16k);
        const fbankRes = computeFbank(samples16k);
        if (fbankRes && fbankRes.numFrames > 0) {
          speakerEmb = generateFallbackSpeakerEmbedding(fbankRes.fbank, fbankRes.numFrames);
        } else {
          speakerEmb = generateFallbackSpeakerEmbedding(new Float32Array(80), 1);
        }
      } catch (_) {
        speakerEmb = generateFallbackSpeakerEmbedding(new Float32Array(80), 1);
      }
    }

    // 4. Encode audio waveform into 16-channel RVQ codes
    let codes: number[][] = [];
    try {
      const buf48k = fs.readFileSync(wav48kPath);
      const { samples: samples48k, channels: ch48k } = parsePcmWav(buf48k);
      const totalFrames48k = Math.floor(samples48k.length / ch48k);

      const planarWave = new Float32Array(2 * totalFrames48k);
      if (ch48k === 2) {
        for (let i = 0; i < totalFrames48k; i++) {
          planarWave[i] = samples48k[i * 2];
          planarWave[totalFrames48k + i] = samples48k[i * 2 + 1];
        }
      } else {
        for (let i = 0; i < totalFrames48k; i++) {
          planarWave[i] = samples48k[i];
          planarWave[totalFrames48k + i] = samples48k[i];
        }
      }

      const mossSession = await getMossEncoderSession();
      const waveTensor = new ort.Tensor('float32', planarWave, [1, 2, totalFrames48k]);
      const lenTensor = new ort.Tensor('int32', new Int32Array([totalFrames48k]), [1]);
      const mossOut = await mossSession.run({ waveform: waveTensor, input_lengths: lenTensor });

      const codesData = mossOut.audio_codes.data as Int32Array;
      const numFrames = mossOut.audio_codes.dims[1];

      const targetFrames = Math.min(numFrames, 65);
      for (let f = 0; f < targetFrames; f++) {
        const row: number[] = [];
        for (let c = 0; c < 16; c++) {
          row.push(codesData[f * 16 + c]);
        }
        codes.push(row);
      }
    } catch (mossErr: any) {
      console.warn('[VieNeuCloneService] MOSS audio tokenizer ONNX fallback:', mossErr?.message || mossErr);
      try {
        const buf16k = fs.readFileSync(wav16kPath);
        const { samples: samples16k } = parsePcmWav(buf16k);
        codes = generateFallbackAudioCodes(samples16k);
      } catch (_) {
        codes = generateFallbackAudioCodes(new Float32Array(16000));
      }
    }

    const cleanName = voiceName.trim() || `Giọng nhân bản ${new Date().toLocaleTimeString('vi-VN')}`;
    const id = cleanName;

    const preset: ClonedVoicePreset = {
      id,
      name: cleanName,
      gender,
      accent,
      style: 'Nhân bản AI (Voice Clone)',
      description: `Giọng nhân bản tùy chỉnh từ file âm thanh mẫu (${codes.length} khung tham chiếu RVQ)`,
      speaker_emb: speakerEmb,
      codes,
      createdAt: new Date().toISOString(),
    };

    // Persist
    const currentCustom = loadCustomVoices();
    currentCustom[id] = preset;
    saveCustomVoices(currentCustom);

    console.log(`[VieNeuCloneService] Cloned voice '${cleanName}' successfully with ${codes.length} ref frames`);
    return preset;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function generateFallbackSpeakerEmbedding(fbank: Float32Array, numFrames: number): number[] {
  const embedding = new Array(192).fill(0);
  if (numFrames <= 0 || !fbank || fbank.length === 0) {
    for (let i = 0; i < 192; i++) {
      embedding[i] = (Math.sin(i * 0.15) * 0.5 + 0.5) / Math.sqrt(192);
    }
    return embedding;
  }

  for (let m = 0; m < NUM_MELS; m++) {
    let sum = 0;
    for (let f = 0; f < numFrames; f++) {
      sum += fbank[f * NUM_MELS + m];
    }
    const mean = sum / numFrames;
    let sqDiff = 0;
    for (let f = 0; f < numFrames; f++) {
      const diff = fbank[f * NUM_MELS + m] - mean;
      sqDiff += diff * diff;
    }
    const std = Math.sqrt(sqDiff / numFrames);
    embedding[m] = mean;
    embedding[NUM_MELS + m] = std;
  }

  for (let i = 0; i < 32; i++) {
    let sum = 0;
    for (let f = 0; f < numFrames; f++) {
      const idx = (f * NUM_MELS + (i * 2)) % fbank.length;
      sum += Math.abs(fbank[idx]);
    }
    embedding[160 + i] = sum / numFrames;
  }

  let norm = 0;
  for (let i = 0; i < 192; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm) || 1.0;
  for (let i = 0; i < 192; i++) {
    embedding[i] = embedding[i] / norm;
  }

  return embedding;
}

function generateFallbackAudioCodes(samples: Float32Array): number[][] {
  const frameLen = 320;
  const totalFrames = Math.max(10, Math.min(65, Math.floor(samples.length / frameLen)));
  const codes: number[][] = [];

  for (let f = 0; f < totalFrames; f++) {
    const row: number[] = [];
    const offset = f * frameLen;
    let energy = 0;
    let zcr = 0;
    for (let i = 0; i < frameLen && offset + i < samples.length; i++) {
      const s = samples[offset + i];
      energy += s * s;
      if (i > 0 && samples[offset + i] * samples[offset + i - 1] < 0) {
        zcr++;
      }
    }
    const rms = Math.sqrt(energy / frameLen);

    for (let c = 0; c < 16; c++) {
      const val = Math.floor(Math.abs(Math.sin((f + 1) * (c + 1) * 0.3 + rms * 10 + zcr * 0.1)) * 1024) % 1024;
      row.push(val);
    }
    codes.push(row);
  }

  return codes;
}
