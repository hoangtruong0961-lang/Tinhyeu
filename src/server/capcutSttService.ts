import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import util from 'util';
import { execFile } from 'child_process';

const execFilePromise = util.promisify(execFile);

const BASE_URL = 'https://editor-api-sg.capcutapi.com';
const VOD_REGION = 'sdwdmwlll';
const VOD_SERVICE = 'vod';

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

// Standard CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table[i] = c >>> 0;
}

export function crc32Hex(buf: Buffer): string {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, '0');
}

export function fileMd5(filePath: string): string {
  const hash = crypto.createHash('md5');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

export function bufferMd5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function compactJson(obj: any): string {
  return JSON.stringify(obj);
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

function commonQuery(device: Record<string, string>, babiParam: any = null, includeRegion = true): Record<string, string> {
  const q: Record<string, string> = {
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
  };
  if (includeRegion) {
    q.region = device.region;
  }
  if (babiParam !== null) {
    q.babi_param = compactJson(babiParam);
  }
  return q;
}

function baseHeaders(device: Record<string, string>, bodyText: string, appid = false): Record<string, string> {
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
  };
  if (appid) {
    headers['app-sdk-version'] = device.appvr;
    headers.appid = device.aid;
  }
  return headers;
}

// AWS SigV4 Helpers
function utcNowForVod(): { amzDate: string; httpDate: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const min = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  const amzDate = `${y}${m}${d}T${h}${min}${s}Z`;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const httpDate = `${days[now.getUTCDay()]}, ${d} ${months[now.getUTCMonth()]} ${y} ${h}:${min}:${s} GMT`;

  return { amzDate, httpDate };
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, msg: string | Buffer): Buffer {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function aws4SigningKey(secretAccessKey: string, dateStamp: string, region = VOD_REGION, service = VOD_SERVICE): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalQuery(urlStr: string): string {
  const parsed = new URL(urlStr);
  const pairs: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    pairs.push([rfc3986Encode(key), rfc3986Encode(value)]);
  });
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function aws4Authorization(
  method: string,
  urlStr: string,
  body: Buffer | string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  amzDate: string
): string {
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${VOD_REGION}/${VOD_SERVICE}/aws4_request`;
  const signedHeaders = 'x-amz-date;x-amz-security-token';
  const canonicalHeaders = `x-amz-date:${amzDate}\nx-amz-security-token:${sessionToken}\n`;
  const parsed = new URL(urlStr);
  const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const canonicalRequest = [
    method,
    parsed.pathname,
    canonicalQuery(urlStr),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(bodyBuf),
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = aws4SigningKey(secretAccessKey, dateStamp);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export interface CapCutUploadResult {
  vid: string;
  md5: string;
  durationMs: number;
  format?: string;
  size: number;
  storeUri?: string;
}

export interface CapCutSttWord {
  text: string;
  start_time: number;
  end_time: number;
  blank_duration?: number;
}

export interface CapCutSttUtterance {
  text: string;
  start_time: number;
  end_time: number;
  words?: CapCutSttWord[];
}

export interface CapCutSttSubtitleItem {
  id: string;
  startTime: number;
  endTime: number;
  sourceText: string;
  vietnamese: string;
  words?: CapCutSttWord[];
}

export interface CapCutSttOptions {
  language?: string; // 'zh-CN', 'vi-VN', 'en-US', etc.
  translationLanguage?: string; // 'vi-VN'
  useTranslation?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  onProgress?: (stage: string, progress: number, message: string) => void;
}

/**
 * Upload an audio file/buffer to ByteDance VOD storage for CapCut ASR
 */
export async function uploadAudioToCapCutVod(
  audioBuffer: Buffer,
  device = DEFAULT_DEVICE
): Promise<CapCutUploadResult> {
  const localMd5 = bufferMd5(audioBuffer);
  const partCrc32 = crc32Hex(audioBuffer);

  // 1. Request Upload Sign
  const signBody = { biz: 'cc_pc_text_recognize', key_version: 'v5' };
  const signBodyText = compactJson(signBody);
  const qParams = new URLSearchParams(commonQuery(device, null, false));
  const signUrl = `${BASE_URL}/lv/v1/upload_sign?${qParams.toString()}`;

  const headers = baseHeaders(device, signBodyText, true);
  const signHeader = makeSignHeader(signUrl, device.appvr, headers['device-time'], device.tdid);
  headers.sign = signHeader;

  const signResp = await fetch(signUrl, {
    method: 'POST',
    headers,
    body: signBodyText,
  });

  if (!signResp.ok) {
    throw new Error(`CapCut upload_sign failed: HTTP ${signResp.status}`);
  }

  const signData = (await signResp.json()) as any;
  const creds = signData?.data || {};
  for (const key of ['domain', 'access_key_id', 'secret_access_key', 'session_token', 'space_name']) {
    if (!creds[key]) {
      throw new Error(`CapCut upload_sign missing credentials field '${key}': ${JSON.stringify(signData)}`);
    }
  }

  // 2. Apply Upload Inner
  const { amzDate, httpDate } = utcNowForVod();
  const applyQuery = new URLSearchParams({
    Action: 'ApplyUploadInner',
    SpaceName: creds.space_name,
    UseQuic: 'false',
    Version: '2020-11-19',
    device_platform: 'win',
  });
  const applyUrl = `https://${creds.domain}/top/v1?${applyQuery.toString()}`;

  const applyAuth = aws4Authorization('GET', applyUrl, Buffer.alloc(0), creds.access_key_id, creds.secret_access_key, creds.session_token, amzDate);
  const applyHeaders = {
    Authorization: applyAuth,
    Date: httpDate,
    'User-Agent': `BDFileUpload(${Date.now()})`,
    'X-Amz-Date': amzDate,
    'X-Amz-Security-Token': creds.session_token,
    'accept-encoding': 'identity',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
    tdid: device.tdid,
    pf: device.pf,
  };

  const applyResp = await fetch(applyUrl, {
    method: 'GET',
    headers: applyHeaders,
  });

  if (!applyResp.ok) {
    throw new Error(`CapCut ApplyUploadInner failed: HTTP ${applyResp.status}`);
  }

  const applyData = (await applyResp.json()) as any;
  const node = applyData?.Result?.InnerUploadAddress?.UploadNodes?.[0];
  if (!node) {
    throw new Error(`CapCut ApplyUploadInner invalid response: ${JSON.stringify(applyData)}`);
  }

  const store = node.StoreInfos?.[0];
  const uploadHost = node.UploadHost;
  const storeUri = store?.StoreUri;
  const uploadId = store?.UploadID;
  const uploadAuth = store?.Auth;
  const vid = node.Vid || (node.Vids && node.Vids[0]);

  if (!uploadHost || !storeUri || !uploadId || !uploadAuth) {
    throw new Error(`CapCut ApplyUploadInner missing node store details`);
  }

  // 3. Transfer binary chunk
  const transferQuery = new URLSearchParams({
    uploadid: uploadId,
    part_number: '0',
    phase: 'transfer',
  });
  const transferUrl = `https://${uploadHost}/upload/v1/${storeUri}?${transferQuery.toString()}`;
  const nowTransfer = utcNowForVod();
  const transferHeaders: Record<string, string> = {
    Authorization: uploadAuth,
    Date: nowTransfer.httpDate,
    'User-Agent': `BDFileUpload(${Date.now()})`,
    'accept-encoding': 'identity',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
    tdid: device.tdid,
    pf: device.pf,
    'X-Upload-Content-CRC32': partCrc32,
  };

  const transferResp = await fetch(transferUrl, {
    method: 'POST',
    headers: transferHeaders,
    body: audioBuffer as unknown as BodyInit,
  });

  if (!transferResp.ok) {
    throw new Error(`CapCut upload transfer failed: HTTP ${transferResp.status}`);
  }

  // 4. Finish upload
  const finishQuery = new URLSearchParams({
    uploadmode: 'part',
    phase: 'finish',
    uploadid: uploadId,
  });
  const finishUrl = `https://${uploadHost}/upload/v1/${storeUri}?${finishQuery.toString()}`;
  const nowFinish = utcNowForVod();
  const finishHeaders: Record<string, string> = {
    Authorization: uploadAuth,
    Date: nowFinish.httpDate,
    'User-Agent': `BDFileUpload(${Date.now()})`,
    'accept-encoding': 'identity',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
    tdid: device.tdid,
    pf: device.pf,
  };

  const finishBody = `0:${partCrc32}`;
  const finishResp = await fetch(finishUrl, {
    method: 'POST',
    headers: finishHeaders,
    body: finishBody,
  });

  if (!finishResp.ok) {
    throw new Error(`CapCut upload finish failed: HTTP ${finishResp.status}`);
  }

  // 5. Commit Upload Inner
  const commitQuery = new URLSearchParams({
    Action: 'CommitUploadInner',
    SpaceName: creds.space_name,
    Version: '2020-11-19',
    device_platform: 'win',
  });
  const commitUrl = `https://${creds.domain}/top/v1?${commitQuery.toString()}`;
  const commitBodyObj = {
    Functions: [{ Input: { SnapshotTime: 0.0 }, Name: 'Snapshot' }],
    SessionKey: node.SessionKey,
  };
  const commitBodyText = compactJson(commitBodyObj);
  const nowCommit = utcNowForVod();
  const commitAuth = aws4Authorization('POST', commitUrl, Buffer.from(commitBodyText, 'utf8'), creds.access_key_id, creds.secret_access_key, creds.session_token, nowCommit.amzDate);

  const commitHeaders: Record<string, string> = {
    Authorization: commitAuth,
    Date: nowCommit.httpDate,
    'User-Agent': `BDFileUpload(${Date.now()})`,
    'X-Amz-Date': nowCommit.amzDate,
    'X-Amz-Expires': '31536000',
    'X-Amz-Security-Token': creds.session_token,
    'accept-encoding': 'identity',
    'store-country-code': device.loc.toLowerCase(),
    'store-country-code-src': 'did',
    'is-dispatch-us-ttp': '0',
    'is-app-region-us-ttp': '0',
    tdid: device.tdid,
    pf: device.pf,
    'content-type': 'application/json',
  };

  const commitResp = await fetch(commitUrl, {
    method: 'POST',
    headers: commitHeaders,
    body: commitBodyText,
  });

  if (!commitResp.ok) {
    throw new Error(`CapCut CommitUploadInner failed: HTTP ${commitResp.status}`);
  }

  const commitData = (await commitResp.json()) as any;
  const result = commitData?.Result?.Results?.[0] || {};
  const meta = result.VideoMeta || {};
  const durationMs = meta.Duration ? Math.round(parseFloat(meta.Duration) * 1000) : 0;

  return {
    vid: result.Vid || vid,
    md5: meta.Md5 || localMd5,
    durationMs: durationMs || 10000,
    format: meta.Format,
    size: meta.Size || audioBuffer.length,
    storeUri: meta.Uri || storeUri,
  };
}

/**
 * Extract audio from a local video file using ffmpeg
 */
export async function extractAudioFromVideo(
  videoPath: string,
  startTimeSeconds = 0,
  durationSeconds?: number
): Promise<{ audioBuffer: Buffer; durationMs: number }> {
  const tmpAudioPath = path.join(os.tmpdir(), `capcut_stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.m4a`);
  try {
    const args: string[] = ['-y'];
    if (startTimeSeconds > 0) {
      args.push('-ss', String(startTimeSeconds));
    }
    args.push('-i', videoPath);
    if (durationSeconds && durationSeconds > 0) {
      args.push('-t', String(durationSeconds));
    }
    // High quality compact AAC/M4A 128k 44.1kHz mono/stereo for CapCut STT
    args.push('-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', tmpAudioPath);

    await execFilePromise('ffmpeg', args, { timeout: 120000 });

    if (!fs.existsSync(tmpAudioPath)) {
      throw new Error('ffmpeg failed to extract audio from video');
    }

    const audioBuffer = fs.readFileSync(tmpAudioPath);
    const stat = fs.statSync(tmpAudioPath);

    // Get exact audio duration via ffprobe
    let durationMs = 0;
    try {
      const probeRes = await execFilePromise('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        tmpAudioPath,
      ]);
      const durSec = parseFloat(probeRes.stdout.trim());
      if (!isNaN(durSec) && durSec > 0) {
        durationMs = Math.round(durSec * 1000);
      }
    } catch {
      // Fallback duration estimation if ffprobe fails
      durationMs = durationSeconds ? Math.round(durationSeconds * 1000) : 30000;
    }

    return { audioBuffer, durationMs };
  } finally {
    if (fs.existsSync(tmpAudioPath)) {
      try {
        fs.unlinkSync(tmpAudioPath);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Full CapCut Speech-to-Text (STT) pipeline:
 * 1. Upload audio to ByteDance VOD
 * 2. Create STT task with language
 * 3. Poll for result & parse utterances
 */
export async function transcribeWithCapCut(
  audioBuffer: Buffer,
  options: CapCutSttOptions = {}
): Promise<{
  subtitles: CapCutSttSubtitleItem[];
  fullText: string;
  durationMs: number;
  language: string;
}> {
  const device = DEFAULT_DEVICE;
  const language = options.language || 'zh-CN';
  const translationLanguage = options.translationLanguage || 'vi-VN';
  const useTranslation = !!options.useTranslation;
  const timeoutMs = options.timeoutMs || 120000;
  const pollIntervalMs = options.pollIntervalMs || 2000;

  options.onProgress?.('uploading', 15, 'Đang tải âm thanh lên máy chủ CapCut VOD...');

  // 1. Upload audio to CapCut VOD
  const uploadRes = await uploadAudioToCapCutVod(audioBuffer, device);
  const durationMs = uploadRes.durationMs || 10000;

  options.onProgress?.('creating_task', 40, 'Đang khởi tạo tác vụ nhận diện giọng nói ASR...');

  // 2. Build and send STT new request
  const babi = {
    feature_entrance: 'editor',
    feature_entrance_detail: 'editor-elements-captions-subtitle_recognition',
    feature_key: 'subtitle_recognition',
    scenario: 'video_editor',
  };

  const capJson = {
    adjust_endtime: 200,
    audio: uploadRes.vid,
    audio_type: 'vid',
    caption_type: 0,
    client_request_id: crypto.randomUUID(),
    duration: durationMs,
    enable_cache: true,
    enter_from: 'asr',
    language,
    max_lines: 1,
    md5: uploadRes.md5,
    pack_options: { need_attribute: true },
    songs_info: [{ end_time: Math.max(0, durationMs - 10.334), id: '', start_time: 0 }],
    translation_language: translationLanguage,
    use_translation: useTranslation,
    words_per_line: 15,
  };

  const body = {
    bind_id: crypto.randomUUID().toUpperCase(),
    can_queue: true,
    enter_from: 'asr',
    tasks: [
      {
        context: crypto.randomUUID(),
        payload: compactJson({ cap_json: capJson }),
        req_key: 'cc_audio_subtitle_asr',
        task_version: 'v3',
      },
    ],
  };

  const bodyText = compactJson(body);
  const query = commonQuery(device, babi, true);
  const qParams = new URLSearchParams(query);
  const url = `${BASE_URL}/lv/v1/common_task/new?${qParams.toString()}`;

  const headers = baseHeaders(device, bodyText, false);
  const signHeader = makeSignHeader(url, device.appvr, headers['device-time'], device.tdid);
  headers.sign = signHeader;

  const createResp = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyText,
  });

  if (!createResp.ok) {
    throw new Error(`CapCut STT create task failed: HTTP ${createResp.status}`);
  }

  const createJson = (await createResp.json()) as any;
  const tasks = createJson?.data?.tasks || [];
  if (!tasks.length) {
    throw new Error(`CapCut STT API returned no tasks: ${JSON.stringify(createJson)}`);
  }

  const taskId = tasks[0].id;
  const token = tasks[0].token;

  options.onProgress?.('polling', 60, 'Đang xử lý nhận diện lời nói thành văn bản...');

  // 3. Poll for completion
  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempt++;
    const progressPercent = Math.min(95, 60 + Math.round(attempt * 4));
    options.onProgress?.('polling', progressPercent, `Đang phân tích âm thanh & tạo phụ đề (${Math.round((Date.now() - startTime) / 1000)}s)...`);

    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const queryBody = compactJson({
      tasks: [
        {
          bind_id: body.bind_id,
          id: taskId,
          req_key: 'cc_audio_subtitle_asr',
          task_version: 'v3',
          token,
        },
      ],
    });

    const qParamsQuery = new URLSearchParams(commonQuery(device, null, false));
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
    const qTasks = qJson?.data?.tasks || [];
    if (!qTasks.length) continue;

    const qTask = qTasks[0];
    const status = qTask.status;

    if (status === 'success' || status === 'succeed') {
      let rawPayload = qTask.payload;
      if (typeof rawPayload === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload);
        } catch {
          rawPayload = {};
        }
      }

      const utterances: CapCutSttUtterance[] = rawPayload?.utterances || [];
      const subtitleItems: CapCutSttSubtitleItem[] = [];
      const fullTextParts: string[] = [];

      for (const utt of utterances) {
        const text = (utt.text || '').trim();
        if (!text) continue;
        fullTextParts.push(text);

        const startTimeSec = (utt.start_time || 0) / 1000;
        const endTimeSec = (utt.end_time || 0) / 1000;

        subtitleItems.push({
          id: crypto.randomUUID(),
          startTime: startTimeSec,
          endTime: endTimeSec,
          sourceText: text,
          vietnamese: text,
          words: utt.words || [],
        });
      }

      options.onProgress?.('done', 100, `Hoàn tất nhận diện ${subtitleItems.length} câu phụ đề!`);

      return {
        subtitles: subtitleItems,
        fullText: fullTextParts.join(' '),
        durationMs,
        language,
      };
    }

    if (status === 'failed') {
      throw new Error(`CapCut STT task failed: ${JSON.stringify(qTask)}`);
    }
  }

  throw new Error(`CapCut STT timed out after ${Math.round(timeoutMs / 1000)} seconds`);
}
