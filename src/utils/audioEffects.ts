import * as Tone from 'tone';
import { AudioEffectType } from '../types';

export interface AudioEffectPreset {
  id: AudioEffectType;
  name: string;
  label: string;
  icon: string;
  badge: string;
  description: string;
  ffmpegFilter: string;
}

export const AUDIO_EFFECTS_LIST: AudioEffectPreset[] = [
  {
    id: 'none',
    name: 'Bình thường',
    label: 'Bình thường (Gốc)',
    icon: '🎵',
    badge: 'Original',
    description: 'Âm thanh tự nhiên sắc nét, không qua bộ lọc biến đổi',
    ffmpegFilter: 'anull',
  },
  {
    id: 'chipmunk',
    name: 'Sóc chuột',
    label: 'Sóc chuột (Chipmunk)',
    icon: '🐿️',
    badge: 'Pitch High',
    description: 'Tăng cao độ the thé vui nhộn, phong cách hoạt hình đáng yêu',
    ffmpegFilter: 'asetrate=48000*1.42,aresample=48000,atempo=1/1.42,equalizer=f=3200:t=q:w=1:g=3',
  },
  {
    id: 'deep',
    name: 'Trầm khàn',
    label: 'Trầm khàn (Deep Bass)',
    icon: '🐻',
    badge: 'Pitch Low',
    description: 'Hạ trầm nam tính, ấm dày và gia tăng nội lực âm sắc',
    ffmpegFilter: 'asetrate=48000*0.76,aresample=48000,atempo=1/0.76,bass=g=6:f=120,equalizer=f=250:t=q:w=1.2:g=4',
  },
  {
    id: 'robot',
    name: 'Robot',
    label: 'Robot (Kim khí)',
    icon: '🤖',
    badge: 'Metallic',
    description: 'Âm thanh dao động kim khí điện tử, máy móc công nghệ tương lai',
    ffmpegFilter: 'flanger=delay=2.5:depth=2:speed=5:width=80,tremolo=f=45:d=0.75,volume=1.2',
  },
  {
    id: 'walkie_talkie',
    name: 'Bộ đàm',
    label: 'Bộ đàm (Radio)',
    icon: '📻',
    badge: 'Bandpass',
    description: 'Âm thanh máy bộ đàm tần số hẹp, méo tiếng nhẹ chân thực',
    ffmpegFilter: 'highpass=f=450,lowpass=f=3100,volume=2.2,overdrive=12:12,equalizer=f=1200:t=q:w=2:g=4',
  },
  {
    id: 'echo',
    name: 'Vang vọng',
    label: 'Vang vọng (Echo)',
    icon: '🌊',
    badge: 'Delay',
    description: 'Tiếng vọng ngân dài đa tầng, tạo cảm giác âm thanh lan tỏa',
    ffmpegFilter: 'aecho=0.8:0.85:350|700:0.4|0.25,volume=1.1',
  },
  {
    id: 'cave',
    name: 'Trong hang',
    label: 'Trong hang (Cavern Reverb)',
    icon: '🏔️',
    badge: 'Cathedral',
    description: 'Không gian hang động kỳ vĩ, âm thanh dội lại từ vách đá sâu',
    ffmpegFilter: 'aecho=0.8:0.88:80|160|320|640:0.5|0.35|0.25|0.15,lowpass=f=4000,volume=1.15',
  },
];

/**
 * Normalizes effect identifiers (e.g. 'cave_echo' -> 'cave')
 */
export function normalizeAudioEffectType(eff?: string): AudioEffectType {
  if (!eff) return 'none';
  const clean = eff.trim().toLowerCase();
  if (clean === 'cave_echo' || clean === 'cave') return 'cave';
  if (clean === 'walkie_talkie' || clean === 'radio' || clean === 'telephone') return 'walkie_talkie';
  if (clean === 'echo') return 'echo';
  if (clean === 'chipmunk') return 'chipmunk';
  if (clean === 'deep') return 'deep';
  if (clean === 'robot') return 'robot';
  return 'none';
}

/**
 * Returns the exact FFmpeg audio filter string for an effect
 */
export function getFfmpegAudioFilter(effect: AudioEffectType = 'none', volumeMultiplier: number = 1.0): string {
  const norm = normalizeAudioEffectType(effect);
  const found = AUDIO_EFFECTS_LIST.find((e) => e.id === norm);
  const filter = found && found.id !== 'none' ? found.ffmpegFilter : '';

  if (volumeMultiplier === 1.0) {
    return filter || 'anull';
  }

  const volStr = `volume=${Math.max(0, Math.min(3, volumeMultiplier)).toFixed(2)}`;
  if (!filter || filter === 'anull') {
    return volStr;
  }
  return `${filter},${volStr}`;
}

// -------------------------------------------------------------
// Tone.js Real-Time Engine & Live Preview
// -------------------------------------------------------------

let activeTonePlayer: Tone.Player | null = null;
let activeToneSynth: Tone.PolySynth | null = null;
let activeToneNodes: Tone.ToneAudioNode[] = [];
let cachedVoiceBuffer: AudioBuffer | null = null;

/**
 * Stops any ongoing Tone.js preview playback and cleans up audio nodes
 */
export function stopAudioEffectTonePreview(): void {
  try {
    if (activeTonePlayer) {
      activeTonePlayer.stop();
      activeTonePlayer.dispose();
      activeTonePlayer = null;
    }
    if (activeToneSynth) {
      activeToneSynth.triggerRelease(Tone.now());
      activeToneSynth.dispose();
      activeToneSynth = null;
    }
    for (const node of activeToneNodes) {
      try {
        node.dispose();
      } catch {}
    }
    activeToneNodes = [];
  } catch (e) {
    console.warn('[Tone.js AudioEffects] Cleanup error:', e);
  }
}

/**
 * Generates or returns a high-clarity voice speech sample buffer for real-time previewing
 */
async function getPreviewVoiceBuffer(): Promise<AudioBuffer> {
  if (cachedVoiceBuffer) return cachedVoiceBuffer;

  const audioCtx = Tone.getContext().rawContext as AudioContext;
  const sampleRate = audioCtx.sampleRate || 44100;
  const duration = 2.4; // 2.4 seconds rich voice sample
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);

  // Synthesize a natural human vocal formant sequence ("A - E - O - U" cadence)
  // Fundamental frequency ~130 Hz (male/neutral speaking pitch) with speech harmonics and vocal envelope
  for (let i = 0; i < frameCount; i++) {
    const t = i / sampleRate;
    // Word rhythm envelope (3 distinct syllables)
    const env1 = Math.exp(-Math.pow((t - 0.4) / 0.22, 2));
    const env2 = Math.exp(-Math.pow((t - 1.1) / 0.25, 2));
    const env3 = Math.exp(-Math.pow((t - 1.8) / 0.28, 2));
    const amp = Math.max(0.01, env1 * 0.85 + env2 * 0.95 + env3 * 0.9);

    // Glottal fundamental pulse with voice formants F1 (700Hz), F2 (1200Hz), F3 (2500Hz)
    const f0 = 135 + 15 * Math.sin(2 * Math.PI * 1.8 * t);
    const harmonic1 = Math.sin(2 * Math.PI * f0 * t) * 0.45;
    const harmonic2 = Math.sin(2 * Math.PI * f0 * 2 * t) * 0.3;
    const formant1 = Math.sin(2 * Math.PI * 720 * t) * 0.25;
    const formant2 = Math.sin(2 * Math.PI * 1280 * t) * 0.15;
    const formant3 = Math.sin(2 * Math.PI * 2600 * t) * 0.08;

    data[i] = (harmonic1 + harmonic2 + formant1 + formant2 + formant3) * amp * 0.85;
  }

  cachedVoiceBuffer = buffer;
  return buffer;
}

/**
 * Plays an audio effect preview using Tone.js!
 * "Kéo chọn là nghe thử ngay"
 */
export async function previewAudioEffectWithTone(
  effect: AudioEffectType,
  options?: {
    customBuffer?: AudioBuffer | null;
    customBase64?: string | null;
    onStart?: () => void;
    onEnd?: () => void;
  }
): Promise<void> {
  // 1. Ensure Tone.js audio context is running
  await Tone.start();
  stopAudioEffectTonePreview();

  options?.onStart?.();

  const norm = normalizeAudioEffectType(effect);
  const destination = Tone.getDestination();

  // 2. Build Tone.js processing chain based on requested effect
  const effectNodes: Tone.ToneAudioNode[] = [];

  switch (norm) {
    case 'chipmunk': {
      // Sóc chuột: +8 semitones pitch shift + Treble boost
      const pitch = new Tone.PitchShift({ pitch: 8.5, windowSize: 0.08 });
      const eq = new Tone.EQ3({ high: 4, mid: 2, low: -6 });
      effectNodes.push(pitch, eq);
      break;
    }

    case 'deep': {
      // Trầm khàn: -6 semitones pitch shift + Sub/Bass boost
      const pitch = new Tone.PitchShift({ pitch: -6.5, windowSize: 0.12 });
      const eq = new Tone.EQ3({ high: -2, mid: 1, low: 7 });
      effectNodes.push(pitch, eq);
      break;
    }

    case 'robot': {
      // Robot: High-frequency Tremolo ring modulation + Flanger/Chorus
      const tremolo = new Tone.Tremolo({ frequency: 45, depth: 0.85 }).start();
      const chorus = new Tone.Chorus({ frequency: 3.5, delayTime: 3.0, depth: 0.8, wet: 0.7 }).start();
      const gain = new Tone.Gain(1.3);
      effectNodes.push(tremolo, chorus, gain);
      break;
    }

    case 'walkie_talkie': {
      // Bộ đàm: Bandpass 450Hz - 3100Hz + Distortion + Overdrive
      const filterHighpass = new Tone.Filter({ frequency: 450, type: 'highpass', rolloff: -24 });
      const filterLowpass = new Tone.Filter({ frequency: 3100, type: 'lowpass', rolloff: -24 });
      const distortion = new Tone.Distortion({ distortion: 0.38, wet: 0.8 });
      const gain = new Tone.Gain(1.6);
      effectNodes.push(filterHighpass, filterLowpass, distortion, gain);
      break;
    }

    case 'echo': {
      // Vang vọng: Feedback delay 320ms with 42% feedback
      const delay = new Tone.FeedbackDelay({ delayTime: 0.32, feedback: 0.45, wet: 0.5 });
      const gain = new Tone.Gain(1.15);
      effectNodes.push(delay, gain);
      break;
    }

    case 'cave': {
      // Trong hang: Deep cave reverb with multi-delay
      const reverb = new Tone.Reverb({ decay: 4.8, preDelay: 0.08, wet: 0.65 });
      const delay = new Tone.FeedbackDelay({ delayTime: 0.18, feedback: 0.35, wet: 0.35 });
      const lowpass = new Tone.Filter({ frequency: 4200, type: 'lowpass' });
      await reverb.generate();
      effectNodes.push(delay, reverb, lowpass);
      break;
    }

    case 'none':
    default: {
      // Bình thường: Clean passthrough with slight transparent limiter
      const gain = new Tone.Gain(1.0);
      effectNodes.push(gain);
      break;
    }
  }

  // 3. Connect nodes in series: Node[0] -> Node[1] -> ... -> Destination
  if (effectNodes.length > 0) {
    for (let i = 0; i < effectNodes.length - 1; i++) {
      effectNodes[i].connect(effectNodes[i + 1]);
    }
    effectNodes[effectNodes.length - 1].connect(destination);
    activeToneNodes = effectNodes;
  }

  // 4. Resolve audio source: custom buffer or high-quality vocal sample
  let finalBuffer: AudioBuffer | null = options?.customBuffer || null;

  if (!finalBuffer && options?.customBase64) {
    try {
      const audioCtx = Tone.getContext().rawContext as AudioContext;
      const bin = atob(options.customBase64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      finalBuffer = await audioCtx.decodeAudioData(u8.buffer);
    } catch {}
  }

  if (!finalBuffer) {
    finalBuffer = await getPreviewVoiceBuffer();
  }

  // 5. Play using Tone.Player
  const toneBuffer = new Tone.ToneAudioBuffer(finalBuffer);
  const player = new Tone.Player(toneBuffer);
  activeTonePlayer = player;

  if (effectNodes.length > 0) {
    player.connect(effectNodes[0]);
  } else {
    player.connect(destination);
  }

  player.onstop = () => {
    options?.onEnd?.();
  };

  player.start();
}

// -------------------------------------------------------------
// Web Audio API Native Graph (for Offline Audio Exporter & Video)
// -------------------------------------------------------------

/**
 * Builds standard Web Audio nodes for rendering or video routing without Tone runtime
 */
export function applyAudioEffectChain(
  ctx: BaseAudioContext,
  sourceNode: AudioNode,
  effect: AudioEffectType = 'none',
  volume: number = 1.0
): { outputNode: AudioNode; detuneOffsetCents: number } {
  const norm = normalizeAudioEffectType(effect);
  let detuneOffsetCents = 0;
  let lastNode: AudioNode = sourceNode;

  switch (norm) {
    case 'chipmunk': {
      detuneOffsetCents = 850; // +8.5 semitones
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 250;

      const treble = ctx.createBiquadFilter();
      treble.type = 'peaking';
      treble.frequency.value = 3200;
      treble.gain.value = 3.5;

      lastNode.connect(highpass);
      highpass.connect(treble);
      lastNode = treble;
      break;
    }

    case 'deep': {
      detuneOffsetCents = -650; // -6.5 semitones
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 180;
      bass.gain.value = 6;

      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 400;
      body.gain.value = 3;

      lastNode.connect(bass);
      bass.connect(body);
      lastNode = body;
      break;
    }

    case 'robot': {
      // Ring modulation / Tremolo using wave shaper distortion and mid-range peak
      const band = ctx.createBiquadFilter();
      band.type = 'peaking';
      band.frequency.value = 1400;
      band.Q.value = 4.0;
      band.gain.value = 5.0;

      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        const x = (i * 2) / 512 - 1;
        curve[i] = Math.sin(x * Math.PI * 1.5) * 0.9;
      }
      shaper.curve = curve;

      lastNode.connect(band);
      band.connect(shaper);
      lastNode = shaper;
      break;
    }

    case 'walkie_talkie': {
      // Narrow bandpass 500Hz - 2800Hz with overdrive
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;

      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1200;
      peak.gain.value = 4;

      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = (3 * x) / (2 + Math.abs(x) * 2);
      }
      shaper.curve = curve;

      lastNode.connect(hp);
      hp.connect(lp);
      lp.connect(peak);
      peak.connect(shaper);
      lastNode = shaper;
      break;
    }

    case 'echo': {
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.32;

      const feedback = ctx.createGain();
      feedback.gain.value = 0.42;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.95;

      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.65;

      const merger = ctx.createGain();

      lastNode.connect(dryGain);
      dryGain.connect(merger);

      lastNode.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wetGain);
      wetGain.connect(merger);

      lastNode = merger;
      break;
    }

    case 'cave': {
      const delay1 = ctx.createDelay();
      delay1.delayTime.value = 0.12;
      const feedback1 = ctx.createGain();
      feedback1.gain.value = 0.35;

      const delay2 = ctx.createDelay();
      delay2.delayTime.value = 0.28;
      const feedback2 = ctx.createGain();
      feedback2.gain.value = 0.45;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3500;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.8;

      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.7;

      const merger = ctx.createGain();

      lastNode.connect(dryGain);
      dryGain.connect(merger);

      lastNode.connect(delay1);
      delay1.connect(feedback1);
      feedback1.connect(delay1);
      delay1.connect(delay2);
      delay2.connect(feedback2);
      feedback2.connect(delay2);

      delay2.connect(lowpass);
      lowpass.connect(wetGain);
      wetGain.connect(merger);

      lastNode = merger;
      break;
    }

    case 'none':
    default:
      break;
  }

  // Final Master Volume Gain Node
  const masterGain = ctx.createGain();
  masterGain.gain.value = Math.max(0, Math.min(3, volume));
  lastNode.connect(masterGain);

  return {
    outputNode: masterGain,
    detuneOffsetCents,
  };
}
