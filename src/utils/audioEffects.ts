import { AudioEffectType } from '../types';

export interface AudioEffectDefinition {
  id: AudioEffectType;
  name: string;
  shortName: string;
  emoji: string;
  tagline: string;
  category: 'natural' | 'pitch' | 'environment' | 'device' | 'creative';
  detuneCents: number;
  ffmpegFilter: string;
}

export const AUDIO_EFFECTS_LIST: AudioEffectDefinition[] = [
  {
    id: 'none',
    name: 'Gốc (Chuẩn)',
    shortName: 'Gốc',
    emoji: '🎙️',
    tagline: 'Âm thanh tự nhiên, chuẩn phòng thu',
    category: 'natural',
    detuneCents: 0,
    ffmpegFilter: '',
  },
  {
    id: 'chipmunk',
    name: 'Sóc chuột (Chipmunk)',
    shortName: 'Sóc chuột',
    emoji: '🐿️',
    tagline: 'Tông the thé nhí nhảnh, vui nhộn hài hước',
    category: 'pitch',
    detuneCents: 700,
    ffmpegFilter: 'asetrate=48000*1.38,atempo=1/1.38,highpass=f=120,equalizer=f=3200:t=q:w=1.5:g=3',
  },
  {
    id: 'deep',
    name: 'Trầm quái vật (Deep Voice)',
    shortName: 'Trầm khàn',
    emoji: '👹',
    tagline: 'Giọng trầm bí ẩn, uy lực nguy hiểm',
    category: 'pitch',
    detuneCents: -700,
    ffmpegFilter: 'asetrate=48000*0.72,atempo=1/0.72,lowpass=f=5500,bass=g=5:f=160',
  },
  {
    id: 'robot',
    name: 'Người máy (Robot)',
    shortName: 'Robot',
    emoji: '🤖',
    tagline: 'Âm sắc kim loại cơ khí tương lai',
    category: 'creative',
    detuneCents: -120,
    ffmpegFilter: 'flanger=delay=8:speed=2,equalizer=f=1100:t=q:w=2.5:g=5,equalizer=f=2400:t=q:w=2:g=4',
  },
  {
    id: 'walkie_talkie',
    name: 'Bộ đàm (Walkie-Talkie)',
    shortName: 'Bộ đàm',
    emoji: '📻',
    tagline: 'Tần số rè đục cảnh sát, bộ đàm chiến thuật',
    category: 'device',
    detuneCents: 0,
    ffmpegFilter: 'highpass=f=450,lowpass=f=2600,equalizer=f=1200:t=q:w=1.8:g=5,volume=1.35',
  },
  {
    id: 'telephone',
    name: 'Điện thoại bàn',
    shortName: 'Điện thoại',
    emoji: '☎️',
    tagline: 'Giọng qua đường dây điện thoại cổ điển',
    category: 'device',
    detuneCents: 0,
    ffmpegFilter: 'highpass=f=350,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=3,volume=1.2',
  },
  {
    id: 'cave_echo',
    name: 'Vang vòm (Cave Echo)',
    shortName: 'Vang vòm',
    emoji: '🏔️',
    tagline: 'Tiếng vọng không gian hang động, sảnh lớn',
    category: 'environment',
    detuneCents: 0,
    ffmpegFilter: 'aecho=0.85:0.75:240:0.45',
  },
  {
    id: 'underwater',
    name: 'Dưới nước (Underwater)',
    shortName: 'Dưới nước',
    emoji: '🌊',
    tagline: 'Âm đục nghẹt như nói dưới nước hoặc phòng kín',
    category: 'environment',
    detuneCents: 0,
    ffmpegFilter: 'lowpass=f=420,bass=g=4:f=150,volume=1.4',
  },
  {
    id: 'chorus',
    name: 'Đồng ca (Chorus)',
    shortName: 'Đồng ca',
    emoji: '👥',
    tagline: 'Hiệu ứng phân thân nhiều người nói cùng lúc',
    category: 'creative',
    detuneCents: 0,
    ffmpegFilter: 'chorus=0.7:0.9:55:0.4:0.25:2',
  },
  {
    id: 'megaphone',
    name: 'Loa phóng thanh',
    shortName: 'Loa phóng',
    emoji: '📢',
    tagline: 'Tiếng loa phát thanh thông báo công cộng',
    category: 'device',
    detuneCents: 0,
    ffmpegFilter: 'highpass=f=600,equalizer=f=2100:t=q:w=2.2:g=7,volume=1.25',
  },
  {
    id: 'radio',
    name: 'Radio cổ thập niên 80',
    shortName: 'Radio cổ',
    emoji: '📻',
    tagline: 'Âm sắc cassette đài phát thanh hoài niệm',
    category: 'device',
    detuneCents: 0,
    ffmpegFilter: 'highpass=f=320,lowpass=f=3700,equalizer=f=1100:t=q:w=1:g=3.5,volume=1.15',
  },
];

/**
 * Generates an audio distortion curve for WaveShaperNode
 */
function makeDistortionCurve(amount: number = 20, nSamples: number = 256): Float32Array {
  const curve = new Float32Array(nSamples);
  const deg = Math.PI / 180;
  const k = typeof amount === 'number' ? amount : 20;
  for (let i = 0; i < nSamples; ++i) {
    const x = (i * 2) / nSamples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export function getFfmpegAudioFilterForEffect(effect?: AudioEffectType): string {
  if (!effect || effect === 'none') return '';
  const def = AUDIO_EFFECTS_LIST.find((e) => e.id === effect);
  return def ? def.ffmpegFilter : '';
}

export interface AppliedEffectGraph {
  outputNode: AudioNode;
  detuneOffsetCents: number;
}

/**
 * Builds and connects Web Audio API nodes corresponding to the selected effect.
 * Fully compatible with BOTH AudioContext and OfflineAudioContext.
 */
export function applyAudioEffectChain(
  ctx: BaseAudioContext,
  inputNode: AudioNode,
  effect: AudioEffectType = 'none',
  masterVolume: number = 1.0
): AppliedEffectGraph {
  const def = AUDIO_EFFECTS_LIST.find((e) => e.id === effect) || AUDIO_EFFECTS_LIST[0];
  const detuneOffsetCents = def.detuneCents || 0;

  // Master GainNode for final volume control
  const masterGain = ctx.createGain();
  masterGain.gain.value = Math.max(0, Math.min(3.0, masterVolume));

  if (effect === 'none') {
    inputNode.connect(masterGain);
    return { outputNode: masterGain, detuneOffsetCents: 0 };
  }

  try {
    switch (effect) {
      case 'chipmunk': {
        // Highpass at 140Hz to eliminate low boom + bright peak at 3200Hz
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 140;

        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 3200;
        peak.Q.value = 1.5;
        peak.gain.value = 3.5;

        inputNode.connect(hp);
        hp.connect(peak);
        peak.connect(masterGain);
        break;
      }

      case 'deep': {
        // Lowpass filter at 5200Hz + low shelf bass boost at 160Hz
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 5200;

        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 160;
        bass.gain.value = 5.0;

        inputNode.connect(lp);
        lp.connect(bass);
        bass.connect(masterGain);
        break;
      }

      case 'robot': {
        // Metallic filter chain: peaking at 1100Hz and 2400Hz + mild WaveShaper clipping
        const peak1 = ctx.createBiquadFilter();
        peak1.type = 'peaking';
        peak1.frequency.value = 1100;
        peak1.Q.value = 3.5;
        peak1.gain.value = 6;

        const peak2 = ctx.createBiquadFilter();
        peak2.type = 'peaking';
        peak2.frequency.value = 2400;
        peak2.Q.value = 2.5;
        peak2.gain.value = 5;

        const shaper = ctx.createWaveShaper();
        shaper.curve = makeDistortionCurve(18) as any;
        shaper.oversample = '2x';

        inputNode.connect(peak1);
        peak1.connect(peak2);
        peak2.connect(shaper);
        shaper.connect(masterGain);
        break;
      }

      case 'walkie_talkie': {
        // Bandpass 450Hz - 2600Hz + resonant mid peak + grit saturation
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 450;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1200;
        mid.Q.value = 2.0;
        mid.gain.value = 5;

        const shaper = ctx.createWaveShaper();
        shaper.curve = makeDistortionCurve(22) as any;
        shaper.oversample = '2x';

        inputNode.connect(hp);
        hp.connect(lp);
        lp.connect(mid);
        mid.connect(shaper);
        shaper.connect(masterGain);
        break;
      }

      case 'telephone': {
        // Classic landline telephone: Highpass 350Hz + Lowpass 3400Hz + Mid resonance
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 350;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3400;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1500;
        mid.Q.value = 1.2;
        mid.gain.value = 3.5;

        inputNode.connect(hp);
        hp.connect(lp);
        lp.connect(mid);
        mid.connect(masterGain);
        break;
      }

      case 'cave_echo': {
        // Feedback Delay with dampening lowpass filter inside feedback loop
        const delay = ctx.createDelay(1.0);
        delay.delayTime.value = 0.24; // 240ms delay

        const feedback = ctx.createGain();
        feedback.gain.value = 0.44; // 44% echo decay

        const dampener = ctx.createBiquadFilter();
        dampener.type = 'lowpass';
        dampener.frequency.value = 2200; // Dampen high freqs in reflections

        // Dry connection
        inputNode.connect(masterGain);

        // Wet feedback loop
        inputNode.connect(delay);
        delay.connect(dampener);
        dampener.connect(feedback);
        feedback.connect(delay);

        // Connect wet signal to master
        const wetGain = ctx.createGain();
        wetGain.gain.value = 0.55;
        dampener.connect(wetGain);
        wetGain.connect(masterGain);
        break;
      }

      case 'underwater': {
        // Two cascaded steep 12dB lowpass filters at 420Hz + slight bass boost
        const lp1 = ctx.createBiquadFilter();
        lp1.type = 'lowpass';
        lp1.frequency.value = 420;
        lp1.Q.value = 1.2;

        const lp2 = ctx.createBiquadFilter();
        lp2.type = 'lowpass';
        lp2.frequency.value = 420;
        lp2.Q.value = 1.0;

        const bass = ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 150;
        bass.gain.value = 4.0;

        // Boost gain slightly to compensate steep cutoff
        const boostGain = ctx.createGain();
        boostGain.gain.value = 1.4;

        inputNode.connect(lp1);
        lp1.connect(lp2);
        lp2.connect(bass);
        bass.connect(boostGain);
        boostGain.connect(masterGain);
        break;
      }

      case 'chorus': {
        // Chorus effect: parallel slight delay lines
        const delay1 = ctx.createDelay(0.1);
        delay1.delayTime.value = 0.022; // 22ms

        const delayGain = ctx.createGain();
        delayGain.gain.value = 0.5;

        // Dry signal
        inputNode.connect(masterGain);

        // Wet signal
        inputNode.connect(delay1);
        delay1.connect(delayGain);
        delayGain.connect(masterGain);
        break;
      }

      case 'megaphone': {
        // Public address horn: Highpass 600Hz + High peak at 2100Hz + Saturation
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 600;

        const hornPeak = ctx.createBiquadFilter();
        hornPeak.type = 'peaking';
        hornPeak.frequency.value = 2100;
        hornPeak.Q.value = 2.4;
        hornPeak.gain.value = 7.5;

        const shaper = ctx.createWaveShaper();
        shaper.curve = makeDistortionCurve(28) as any;
        shaper.oversample = '2x';

        inputNode.connect(hp);
        hp.connect(hornPeak);
        hornPeak.connect(shaper);
        shaper.connect(masterGain);
        break;
      }

      case 'radio': {
        // 1980s Vintage AM radio: Highpass 320Hz + Lowpass 3700Hz + Warm mid peak
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 320;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3700;

        const mid = ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1100;
        mid.Q.value = 1.0;
        mid.gain.value = 3.5;

        const shaper = ctx.createWaveShaper();
        shaper.curve = makeDistortionCurve(14) as any;
        shaper.oversample = '2x';

        inputNode.connect(hp);
        hp.connect(lp);
        lp.connect(mid);
        mid.connect(shaper);
        shaper.connect(masterGain);
        break;
      }

      default:
        inputNode.connect(masterGain);
        break;
    }
  } catch (err) {
    console.warn('[AudioEffects] Fallback to direct routing on error:', err);
    try {
      inputNode.connect(masterGain);
    } catch {}
  }

  return {
    outputNode: masterGain,
    detuneOffsetCents,
  };
}
