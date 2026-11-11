import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import defaultCapcutVoices from '../data/capcutVoices.json';

export interface CapCutVoiceInfo {
  voice_type: string;
  display_name: string;
  resource_id: string;
  lang: string;
  lan: string;
  captured_at?: string;
}

const BASE_URL = 'https://editor-api-sg.capcutapi.com';

const DEFAULT_DEVICE = {
  aid: '359289',
  app_name: 'CapCut',
  appvr: '8.7.0',
  version_name: '8.7.0',
  version_code: '8.7.0',
  channel: 'capcutpc_google',
  device_platform: 'mac',
  device_type: 'MacBookPro17,4',
  device_brand: 'MacBookPro17,4',
  os_version: '15.7.4',
  device_id: '76471456455646328721',
  iid: '76471456455646328721',
  region: 'VN',
  loc: 'VN',
  lan: 'vi-VN',
  pf: '3',
  tdid: '76471456455646328721',
};

const TTS_SIGN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zYCMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guAZ4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zhD/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36mwIDAQAB
-----END PUBLIC KEY-----`;

let cachedVoices: CapCutVoiceInfo[] | null = null;

export function loadCapCutVoices(): CapCutVoiceInfo[] {
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  if (Array.isArray(defaultCapcutVoices) && defaultCapcutVoices.length > 0) {
    cachedVoices = defaultCapcutVoices as CapCutVoiceInfo[];
    return cachedVoices;
  }
  return [];
}

export function getCapCutVoices(lang?: string): CapCutVoiceInfo[] {
  const all = loadCapCutVoices();
  if (!lang) return all;
  const l = lang.toLowerCase().trim();
  return all.filter(
    (v) =>
      v.lan.toLowerCase().includes(l) ||
      v.lang.toLowerCase().includes(l) ||
      (l === 'vi' && (v.lan.toLowerCase() === 'vi' || v.display_name.toLowerCase().includes('vn')))
  );
}

export function resolveCapCutVoice(voiceInput?: string): { voiceType: string; resourceId: string; displayName: string } {
  const defaultFemaleVoice = {
    voiceType: 'BV074_streaming',
    resourceId: '7102355709945188865',
    displayName: 'Cô Gái Hoạt Ngôn',
  };
  const defaultMaleVoice = {
    voiceType: 'BV075_streaming',
    resourceId: '7102355803792740865',
    displayName: 'Thanh Niên Tự Tin',
  };

  if (!voiceInput || !voiceInput.trim()) return defaultFemaleVoice;

  const all = loadCapCutVoices();
  const target = voiceInput.trim().toLowerCase();

  // Cross-provider aliases & common fallback mappings
  const aliasMap: Record<string, { voiceType: string; resourceId: string; displayName: string }> = {
    // Direct Vietnamese nam thanh niên & nam trầm mappings
    'nam thanh niên': defaultMaleVoice,
    'giọng nam thanh niên': defaultMaleVoice,
    'thanh niên': defaultMaleVoice,
    'thanh niên tự tin': defaultMaleVoice,
    'nam trẻ': defaultMaleVoice,
    'nam trẻ sôi nổi': defaultMaleVoice,
    'nam trầm': {
      voiceType: 'multi_male_felipe_uranus_bigtts',
      resourceId: '7637456729696996628',
      displayName: 'Giọng Nam Trầm',
    },
    'giọng nam trầm': {
      voiceType: 'multi_male_felipe_uranus_bigtts',
      resourceId: '7637456729696996628',
      displayName: 'Giọng Nam Trầm',
    },
    'nữ hoạt ngôn': defaultFemaleVoice,
    'giọng nữ hoạt ngôn': defaultFemaleVoice,
    'cô gái hoạt ngôn': defaultFemaleVoice,
    'nữ phổ thông': {
      voiceType: 'vi_female_huong',
      resourceId: '7264854897953083905',
      displayName: 'Giọng Nữ Phổ Thông',
    },
    'giọng nữ phổ thông': {
      voiceType: 'vi_female_huong',
      resourceId: '7264854897953083905',
      displayName: 'Giọng Nữ Phổ Thông',
    },
    'thuyết minh ngọt ngào': {
      voiceType: 'multi_female_tianmeijieshuo_uranus_bigtts',
      resourceId: '7637460417295469832',
      displayName: 'Thuyết Minh Ngọt Ngào',
    },
    'bản tin thời sự': {
      voiceType: 'multi_female_xinwenjieshuo_uranus_bigtts',
      resourceId: '7637455039719640327',
      displayName: 'Bản Tin Thời Sự',
    },
    'mai': {
      voiceType: 'BV562_streaming',
      resourceId: '7483736254694035984',
      displayName: 'Mai',
    },
    // Edge TTS voices
    'vi-vn-hoaimyneural': defaultFemaleVoice,
    'hoaimy': defaultFemaleVoice,
    'hoài mỹ': defaultFemaleVoice,
    'vi-vn-namminhneural': defaultMaleVoice,
    'namminh': defaultMaleVoice,
    'nam minh': defaultMaleVoice,
    'en-us-jennymultilingualneural': {
      voiceType: 'BV029_streaming',
      resourceId: '7102356024924701185',
      displayName: 'American Female',
    },
    'jenny': {
      voiceType: 'BV029_streaming',
      resourceId: '7102356024924701185',
      displayName: 'American Female',
    },
    // TikTok aliases
    'vi_001': defaultFemaleVoice,
    'vi_female': defaultFemaleVoice,
    'vi_002': defaultMaleVoice,
    'vi_male': defaultMaleVoice,
    // Piper / Nghi TTS aliases
    'ngochuyennew': defaultFemaleVoice,
    'maiphuong': defaultFemaleVoice,
    'minhthu': defaultFemaleVoice,
    'lacphi': defaultMaleVoice,
    'ngocngan': defaultMaleVoice,
    'duyoryx': {
      voiceType: 'multi_male_felipe_uranus_bigtts',
      resourceId: '7637456729696996628',
      displayName: 'Giọng Nam Trầm',
    },
    'minhquang': {
      voiceType: 'multi_male_felipe_uranus_bigtts',
      resourceId: '7637456729696996628',
      displayName: 'Giọng Nam Trầm',
    },
    // Gemini voices
    'kore': defaultFemaleVoice,
    'aoede': defaultFemaleVoice,
    'puck': defaultMaleVoice,
    'charon': {
      voiceType: 'multi_male_felipe_uranus_bigtts',
      resourceId: '7637456729696996628',
      displayName: 'Giọng Nam Trầm',
    },
  };

  if (aliasMap[target]) {
    return aliasMap[target];
  }

  // 1. Exact match on voice_type
  for (const v of all) {
    if (v.voice_type.toLowerCase() === target) {
      return { voiceType: v.voice_type, resourceId: v.resource_id, displayName: v.display_name };
    }
  }

  // 2. Match on display_name or resource_id
  for (const v of all) {
    if (v.display_name.toLowerCase() === target || v.resource_id === voiceInput.trim()) {
      return { voiceType: v.voice_type, resourceId: v.resource_id, displayName: v.display_name };
    }
  }

  // 3. Substring match on display_name or voice_type
  for (const v of all) {
    if (v.display_name.toLowerCase().includes(target) || v.voice_type.toLowerCase().includes(target)) {
      return { voiceType: v.voice_type, resourceId: v.resource_id, displayName: v.display_name };
    }
  }

  // 4. Safe recovery: Never return an invalid/unregistered voiceType to CapCut API.
  // Returning an unknown voiceType with an arbitrary resourceId guarantees a 40402004 TTSInvalidSpeaker error.
  console.warn(`[CapCutTTS] Voice "${voiceInput}" not found in CapCut catalog, safely routing to verified CapCut voice.`);
  const isMale = target.includes('nam') || target.includes('male') || target.includes('men') || target.includes('boy');
  return isMale ? defaultMaleVoice : defaultFemaleVoice;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeTraceId(): string {
  const seed = crypto.randomUUID().replace(/-/g, '');
  return `00-${seed}-${seed.slice(0, 16)}-01`;
}

function makeSignHeader(url: string, appvr: string, deviceTime: string, tdid: string): string {
  const pathPart = url.split('?')[0];
  const signStr = `9e2c|${pathPart.slice(-7)}|3|${appvr}|${deviceTime}|${tdid}|11ac`;
  return crypto.createHash('md5').update(signStr, 'utf8').digest('hex');
}

function makeTtsPayloadSign(ssml: string, extraInfo: string, deviceId: string, appId: string): string {
  const ssmlMd5 = crypto.createHash('md5').update(ssml, 'utf8').digest('hex');
  let signInput = `appid:${appId}&did:${deviceId}&creditDisable:false&ssml:${ssmlMd5}`;
  if (extraInfo) {
    signInput += `&extraInfo:${extraInfo}`;
  }
  return crypto.publicEncrypt(
    {
      key: TTS_SIGN_PUBLIC_KEY_PEM,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(signInput, 'utf8')
  ).toString('base64');
}

export interface CapCutTtsOptions {
  voice?: string;
  rate?: number | string;
  timeoutMs?: number;
}

export async function generateCapCutTTS(
  text: string,
  options: CapCutTtsOptions = {}
): Promise<{
  audioBuffer: Buffer;
  durationMs: number;
  speechUrl: string;
  voiceType: string;
  displayName: string;
}> {
  const cleanText = text
    .replace(/<[^>]*>/g, '')
    .replace(/["“”'«»`]/g, ' ')
    .replace(/\.{2,}/g, ', ')
    .replace(/[?!]/g, '.')
    .replace(/\s+([.,?!;:])/g, '$1')
    .replace(/([.,?!;:_-])\1+/g, '$1')
    .trim();
  if (!cleanText) {
    throw new Error('Text to synthesize cannot be empty');
  }

  const { voiceType, resourceId, displayName } = resolveCapCutVoice(options.voice);
  const rawRate = Number(options.rate) || 1.0;
  // CapCut prosody rate: NEVER slow down below 1.0x to eliminate slow motion distortion; cap speedup at 1.25x
  const rateStr = Math.max(1.0, Math.min(1.25, rawRate)).toFixed(1);

  const device = DEFAULT_DEVICE;
  const babi = {
    feature_entrance: 'editor',
    feature_entrance_detail: 'editor-feature-text_to_speech',
    feature_key: 'text_to_speech',
    scenario: 'video_editor',
  };

  const voiceBlock = `    <voice name="${voiceType}" mock_tone_info="" platform="sami" resource_id="${resourceId}" emotion="" emotion_scale="0" style="" role="" moyin_emotion="" is_clone_tone="false" need_subtitle_timestamp="false">\n        <prosody rate="${rateStr}">${escapeXml(cleanText)}</prosody>\n    </voice>`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">\n${voiceBlock}\n</speak>`;
  const extraInfo = JSON.stringify({ benefit_info: {} });

  const payload = {
    audio_format: 'mp3',
    babi_param: JSON.stringify(babi),
    credit_disable: false,
    extra_info: extraInfo,
    need_merge_voice: false,
    need_subtitle_timestamp: false,
    scene: 'text_to_speech',
    ssml: ssml,
    sign: makeTtsPayloadSign(ssml, extraInfo, device.device_id, device.aid),
  };

  const body = {
    bind_id: crypto.randomUUID(),
    can_queue: true,
    enter_from: 'text_to_speech',
    tasks: [
      {
        context: crypto.randomUUID(),
        payload: JSON.stringify(payload),
        req_key: 'sami_text_to_speech',
        task_version: 'v3',
      },
    ],
  };

  const bodyText = JSON.stringify(body);
  const qParams = new URLSearchParams({
    app_name: device.app_name,
    device_type: device.device_type,
    os_version: device.os_version,
    channel: device.channel,
    version_name: device.version_name,
    device_brand: device.device_brand,
    device_id: device.device_id,
    iid: device.iid,
    version_code: device.version_code,
    device_platform: device.device_platform,
    aid: device.aid,
    region: device.region,
    babi_param: JSON.stringify(babi),
  });

  const url = `${BASE_URL}/lv/v1/common_task/new?${qParams.toString()}`;
  const now = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    appvr: device.appvr,
    ch: device.channel,
    'device-time': now,
    lan: device.lan,
    loc: device.loc,
    pf: device.pf,
    'sign-ver': '1',
    tdid: device.tdid,
    'x-ss-stub': crypto.createHash('md5').update(bodyText, 'utf8').digest('hex'),
    'x-ss-dp': device.aid,
    'x-khronos': now,
    'x-tt-trace-id': makeTraceId(),
    'user-agent': 'Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03',
    'accept-encoding': 'gzip, deflate',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
    'app-sdk-version': device.appvr,
    appid: device.aid,
    sign: makeSignHeader(url, device.appvr, now, device.tdid),
  };

  const createResp = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyText,
  });

  if (!createResp.ok) {
    throw new Error(`CapCut API create task failed: HTTP ${createResp.status}`);
  }

  const createJson = (await createResp.json()) as any;
  const tasks = createJson.data?.tasks || [];
  if (!tasks.length) {
    throw new Error(`CapCut API returned no tasks: ${JSON.stringify(createJson)}`);
  }

  const taskId = tasks[0].id;
  const token = tasks[0].token;

  // Poll for completion
  const maxAttempts = 15;
  const timeoutLimit = options.timeoutMs || 25000;
  const startTime = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() - startTime > timeoutLimit) {
      throw new Error(`CapCut TTS timed out after ${timeoutLimit}ms`);
    }

    await new Promise((r) => setTimeout(r, 800 + attempt * 200));

    const queryBody = JSON.stringify({
      tasks: [
        {
          bind_id: '',
          id: taskId,
          req_key: 'sami_text_to_speech',
          task_version: 'v3',
          token,
        },
      ],
    });

    const qParamsQuery = new URLSearchParams({
      app_name: device.app_name,
      device_type: device.device_type,
      os_version: device.os_version,
      channel: device.channel,
      version_name: device.version_name,
      device_brand: device.device_brand,
      device_id: device.device_id,
      iid: device.iid,
      version_code: device.version_code,
      device_platform: device.device_platform,
      aid: device.aid,
    });

    const queryUrl = `${BASE_URL}/lv/v1/common_task/query?${qParamsQuery.toString()}`;
    const qNow = String(Math.floor(Date.now() / 1000));
    const qHeaders = {
      ...headers,
      'device-time': qNow,
      'x-khronos': qNow,
      'x-ss-stub': crypto.createHash('md5').update(queryBody, 'utf8').digest('hex'),
      sign: makeSignHeader(queryUrl, device.appvr, qNow, device.tdid),
    };

    const qResp = await fetch(queryUrl, {
      method: 'POST',
      headers: qHeaders,
      body: queryBody,
    });

    if (!qResp.ok) continue;

    const qJson = (await qResp.json()) as any;
    const qTask = qJson.data?.tasks?.[0];
    const status = qTask?.status;

    if (status === 'success' || status === 'succeed') {
      let p = qTask.payload;
      if (typeof p === 'string') {
        try {
          p = JSON.parse(p);
        } catch {
          // ignore
        }
      }

      const audioSub = p?.audio_subtitles?.[0];
      const speechUrl = audioSub?.speech_url;
      const durationMs = Number(audioSub?.duration) || 0;

      if (!speechUrl) {
        throw new Error('CapCut TTS returned no speech_url in payload');
      }

      // Download audio buffer from TikTok CDN
      const audioResp = await fetch(speechUrl);
      if (!audioResp.ok) {
        throw new Error(`Failed to download audio from CapCut CDN: HTTP ${audioResp.status}`);
      }

      const arrayBuf = await audioResp.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuf);

      return {
        audioBuffer,
        durationMs,
        speechUrl,
        voiceType,
        displayName,
      };
    }

    if (status === 'failed') {
      throw new Error(`CapCut TTS task failed: ${JSON.stringify(qTask)}`);
    }
  }

  throw new Error('CapCut TTS task polling exceeded max attempts');
}
