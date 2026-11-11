import express from 'express';
import dns from 'dns';
import { HttpsProxyAgent } from 'https-proxy-agent';

dns.setDefaultResultOrder('ipv4first');
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { Worker } from 'worker_threads';
import { Readable } from 'stream';
import { exec, execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import axios from 'axios';
import ytdl from '@distube/ytdl-core';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import multer from 'multer';
import util from 'util';
import {
  ensureDeviceLicense,
  activateLicense,
  verifyLicense,
  deactivateLicense,
  loadLicenseStore,
  adminCreateKey,
  adminResetKeyDevices,
  adminRevokeKey,
  adminDeleteKey,
  adminBuffTarget,
  adminListConnectedDevices,
  adminRenewOrExtendMember,
  adminUpdateMember,
  adminResetMemberDevices,
  adminLookupMember,
  adminListAllMembers,
  isSuperAdminCredential,
  verifySignedLicenseToken,
  generateSignedLicenseToken,
  MASTER_ADMIN_KEY,
  WHITELISTED_ADMIN_IPS,
  isWhitelistedAdminIp
} from './src/server/licenseService';
import {
  validateAndExtractGeminiWebSession,
  executeGeminiWebPrompt,
  GeminiWebSession
} from './src/server/geminiWebService';
import {
  extractWithYtDlp,
  fallbackExtractVideo,
  convertSubtitleToSrt,
  getBilibiliCookieHeader,
  executeYtDlpDownload,
  downloadAndMuxStreams
} from './src/server/ytdlpService';
import {
  generateCapCutTTS,
  getCapCutVoices,
  resolveCapCutVoice
} from './src/server/capcutTtsService';
import {
  transcribeWithCapCut,
  extractAudioFromVideo
} from './src/server/capcutSttService';
import {
  transcribeWithGroq,
  translateWithGroq,
  testGroqConnection
} from './src/server/groqService';
import {
  douyinHandoffService,
  TARGET_APP_ID,
  parseDouyinMicroAppShareLink,
} from './src/server/douyinHandoffService';
import {
  extractVoiceProfileFromAudio,
  loadCustomVoices,
  deleteCustomVoiceFromDisk,
  ClonedVoicePreset,
} from './src/server/vieneuCloneService';


const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

/**
 * SSRF Protection: Checks if hostname or IP belongs to private/internal networks or metadata endpoints
 */
function isDisallowedHostOrIp(hostname: string): boolean {
  if (!hostname) return true;
  const host = hostname.toLowerCase().trim();

  // Localhost & metadata hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    return true;
  }

  // IPv4 checks
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [_, o1, o2, o3, o4] = ipv4Match.map(Number);
    if (o1 === 0) return true; // 0.0.0.0/8
    if (o1 === 127) return true; // 127.0.0.0/8 loopback
    if (o1 === 10) return true; // 10.0.0.0/8 private
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12 private
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16 private
    if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // 100.64.0.0/10 CGNAT
    if (o1 >= 224) return true; // Multicast / Reserved
  }

  // IPv6 checks
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  return false;
}

function isValidPublicHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return !isDisallowedHostOrIp(parsed.hostname);
  } catch (_) {
    return false;
  }
}

dotenv.config();

const currentFilename = typeof __filename !== 'undefined' ? __filename : (process.argv[1] || path.join(process.cwd(), 'server.ts'));
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(currentFilename);

const customRequire: any = (() => {
  if (typeof require === 'function') {
    return require;
  }
  try {
    return createRequire(currentFilename || path.join(process.cwd(), 'server.ts'));
  } catch (_) {}
  try {
    return createRequire(path.join(process.cwd(), 'package.json'));
  } catch (_) {}
  return (id: string) => {
    throw new Error(`Cannot require module ${id} in current environment`);
  };
})();
let sherpaOnnxModule: any = null;
function getSherpaOnnx() {
  if (!sherpaOnnxModule) {
    try {
      sherpaOnnxModule = customRequire('sherpa-onnx');
    } catch (e) {
      console.warn('[Sherpa-ONNX] Module load error:', e);
    }
  }
  return sherpaOnnxModule;
}

let tiktokTtsModule: any = null;
function getTiktokTts() {
  if (!tiktokTtsModule) {
    try {
      tiktokTtsModule = customRequire('@shofipwk/tiktok-tts');
    } catch (e) {
      console.warn('[TikTok-TTS] Module load error:', e);
    }
  }
  return tiktokTtsModule;
}

const NGHI_TTS_VOICE_URLS: Record<string, { filename: string; url: string; name: string }> = {
  // --- Giọng Nữ (Female Voices) ---
  ngochuyennew: {
    filename: 'ngochuyennew.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/ngochuyennew.onnx?download=true',
    name: 'Ngọc Huyền (Mới - Review Phim)',
  },
  ngochuyen: {
    filename: 'ngochuyen.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/ngochuyen.onnx?download=true',
    name: 'Ngọc Huyền (Bản gốc)',
  },
  maiphuong: {
    filename: 'maiphuong.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/maiphuong.onnx?download=true',
    name: 'Mai Phương (Nữ nhẹ nhàng)',
  },
  banmai: {
    filename: 'banmai.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/banmai.onnx?download=true',
    name: 'Ban Mai (Nữ trong trẻo)',
  },
  minhthu: {
    filename: 'minhthu.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/minhthu.onnx?download=true',
    name: 'Minh Thu (Nữ truyền cảm)',
  },
  mytam2: {
    filename: 'mytam2.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/mytam2.onnx?download=true',
    name: 'Mỹ Tâm 2 (Nữ ấm áp)',
  },
  mytam2794: {
    filename: 'mytam2794.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/mytam2794.onnx?download=true',
    name: 'Mỹ Tâm (Bản v2794)',
  },
  phuongtrang: {
    filename: 'phuongtrang.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/phuongtrang.onnx?download=true',
    name: 'Phương Trang (Nữ dịu dàng)',
  },
  thanhphuong2: {
    filename: 'thanhphuong2.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/thanhphuong2.onnx?download=true',
    name: 'Thanh Phương (Viettel)',
  },
  calmwoman3688: {
    filename: 'calmwoman3688.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/calmwoman3688.onnx?download=true',
    name: 'Calm Woman (Nữ điềm tĩnh)',
  },
  yannew: {
    filename: 'yannew.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/yannew.onnx?download=true',
    name: 'Yan New (Nữ trẻ trung)',
  },

  // --- Giọng Nam (Male Voices) ---
  lacphi: {
    filename: 'lacphi.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/lacphi.onnx?download=true',
    name: 'Lạc Phi (Nam chuẩn)',
  },
  duyoryx: {
    filename: 'duyoryx3175.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/duyoryx3175.onnx?download=true',
    name: 'Duy Oryx (Nam trầm ấm)',
  },
  ngocngan: {
    filename: 'ngocngan3701.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/ngocngan3701.onnx?download=true',
    name: 'Nguyễn Ngọc Ngạn (Kể chuyện / Thuyết minh)',
  },
  vietthao3886: {
    filename: 'vietthao3886.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/vietthao3886.onnx?download=true',
    name: 'Việt Thảo (Kể chuyện / Review)',
  },
  tranthanh3870: {
    filename: 'tranthanh3870.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/tranthanh3870.onnx?download=true',
    name: 'Trấn Thành (Hài hước / Sôi nổi)',
  },
  minhquang: {
    filename: 'minhquang.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/minhquang.onnx?download=true',
    name: 'Minh Quang (Nam thời sự)',
  },
  minhkhang: {
    filename: 'minhkhang.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/minhkhang.onnx?download=true',
    name: 'Minh Khang (Nam truyền cảm)',
  },
  manhdung: {
    filename: 'manhdung.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/manhdung.onnx?download=true',
    name: 'Mạnh Dũng (Nam mạnh mẽ)',
  },
  chieuthanh: {
    filename: 'chieuthanh.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/chieuthanh.onnx?download=true',
    name: 'Chiếu Thành (Nam đĩnh đạc)',
  },
  thientam: {
    filename: 'thientam.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/thientam.onnx?download=true',
    name: 'Thiện Tâm (Nam nhẹ nhàng)',
  },
  taian2: {
    filename: 'taian2.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/taian2.onnx?download=true',
    name: 'Tài An 2 (CD Media)',
  },
  taian4: {
    filename: 'taian4.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/taian4.onnx?download=true',
    name: 'Tài An 4 (CD Media)',
  },
  deepman3909: {
    filename: 'deepman3909.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/deepman3909.onnx?download=true',
    name: 'Deep Man (Nam trầm sâu)',
  },
  adam1: {
    filename: 'adam1.onnx',
    url: 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/adam1.onnx?download=true',
    name: 'Adam 1 (Nam phát thanh)',
  },
};

function fixHuggingFaceUrl(url: string): string {
  if (!url) return url;
  if (url.includes('huggingface.co') && url.includes('/blob/')) {
    const fixed = url.replace('huggingface.co/', 'huggingface.co/').replace('/blob/', '/resolve/');
    console.log(`[Hugging Face URL Fixer] Converted HF blob URL to resolve: ${url} -> ${fixed}`);
    return fixed;
  }
  return url;
}

async function ensureFileDownloaded(fileUrl: string, targetPath: string, minSizeBytes: number = 50): Promise<boolean> {
  const sanitizedUrl = fixHuggingFaceUrl(fileUrl);
  if (fs.existsSync(targetPath)) {
    const stat = fs.statSync(targetPath);
    if (stat.size >= minSizeBytes) return true; // file exists and satisfies minimum size
    console.log(`[Sherpa-ONNX TTS] Existing file ${targetPath} too small (${stat.size} < ${minSizeBytes}), re-downloading...`);
    try { fs.unlinkSync(targetPath); } catch (_) {}
  }
  console.log(`[Sherpa-ONNX TTS] Downloading file from ${sanitizedUrl} to ${targetPath}...`);
  try {
    const res = await fetch(sanitizedUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${sanitizedUrl}: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < minSizeBytes) {
      throw new Error(`Downloaded file too small (${buffer.length} bytes < ${minSizeBytes} bytes)`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Sherpa-ONNX TTS] Saved ${targetPath} (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) successfully.`);
    return true;
  } catch (e) {
    console.error(`[Sherpa-ONNX TTS] Download error for ${fileUrl}:`, e);
    if (fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
    return false;
  }
}

async function ensureEspeakData(nghiDir: string): Promise<boolean> {
  const targetDir = path.join(nghiDir, 'espeak-ng-data');
  const phontabPath = path.join(targetDir, 'phontab');
  const viDictPath = path.join(targetDir, 'vi_dict');

  const checkBinaryValid = (dir: string): boolean => {
    const pt = path.join(dir, 'phontab');
    const vd = path.join(dir, 'vi_dict');
    if (fs.existsSync(pt) && fs.existsSync(vd)) {
      try {
        const viBuf = fs.readFileSync(vd);
        const ptBuf = fs.readFileSync(pt);
        if (viBuf.length > 500 && ptBuf.length > 1000) {
          return true;
        }
      } catch (_) {}
    }
    return false;
  };

  // Verify if current targetDir is already valid
  if (checkBinaryValid(targetDir)) {
    return true;
  }

  console.log('[Sherpa-ONNX TTS] espeak-ng-data missing or corrupted. Trying local backups first...');

  // Fallback 1: Search all local candidate folders
  const localCandidates = [
    path.join(process.cwd(), 'nghi-tts audio', 'espeak-ng-data'),
    path.join(process.cwd(), 'espeak-ng-data'),
    path.join(process.cwd(), 'public', 'espeak-ng-data'),
    path.join(currentDirname, 'nghi-tts audio', 'espeak-ng-data'),
    path.join(currentDirname, 'espeak-ng-data'),
    path.join(process.cwd(), 'tmp_espeak_test', 'espeak-ng-data'),
  ];

  for (const cand of localCandidates) {
    if (cand !== targetDir && fs.existsSync(cand) && checkBinaryValid(cand)) {
      console.log(`[Sherpa-ONNX TTS] Copying espeak-ng-data from local folder: ${cand}`);
      try {
        fs.mkdirSync(nghiDir, { recursive: true });
        fs.cpSync(cand, targetDir, { recursive: true });
        if (checkBinaryValid(targetDir)) {
          console.log('[Sherpa-ONNX TTS] Copied espeak-ng-data from local candidate successfully.');
          return true;
        }
      } catch (copyErr) {
        console.warn('[Sherpa-ONNX TTS] Copying candidate folder failed:', copyErr);
      }
    }
  }

  // Fallback 2: Try unzipping from local backup zip file with integrity test
  const backupZipCandidates = [
    path.join(process.cwd(), 'public', 'espeak-ng-data.zip'),
    path.join(process.cwd(), 'nghi-tts audio', 'espeak-ng-data.zip'),
    path.join(process.cwd(), 'espeak-ng-data.zip'),
    path.join(process.cwd(), 'tmp_espeak_test', 'espeak-ng-data.zip'),
    path.join(nghiDir, 'espeak-ng-data.zip'),
  ];

  for (const backupZipPath of backupZipCandidates) {
    if (fs.existsSync(backupZipPath)) {
      console.log(`[Sherpa-ONNX TTS] Testing and unzipping espeak-ng-data from local zip: ${backupZipPath}`);
      try {
        // Test zip validity first
        const isValidZip = await new Promise<boolean>((resolveTest) => {
          exec(`unzip -t "${backupZipPath}"`, (testErr) => {
            resolveTest(!testErr);
          });
        });

        if (!isValidZip) {
          console.warn(`[Sherpa-ONNX TTS] Corrupt backup zip detected, removing: ${backupZipPath}`);
          try { fs.unlinkSync(backupZipPath); } catch (_) {}
          continue;
        }

        fs.mkdirSync(nghiDir, { recursive: true });
        await new Promise<void>((resolveZip, rejectZip) => {
          exec(`unzip -q -o "${backupZipPath}" -d "${nghiDir}"`, (err) => {
            if (err) rejectZip(err);
            else resolveZip();
          });
        });
        if (checkBinaryValid(targetDir)) {
          console.log('[Sherpa-ONNX TTS] Unzipped espeak-ng-data from local backup zip successfully.');
          return true;
        }
      } catch (zipErr) {
        console.warn('[Sherpa-ONNX TTS] Unzipping backup zip failed:', zipErr);
      }
    }
  }

  console.log('[Sherpa-ONNX TTS] Local backups not found or failed. Downloading clean espeak-ng-data.zip from remote GitHub...');
  const zipPath = path.join(nghiDir, 'espeak-ng-data.zip');
  const zipUrl = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.zip';

  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // Minimum 5MB expected for espeak-ng-data.zip
  const downloaded = await ensureFileDownloaded(zipUrl, zipPath, 5000000);
  if (!downloaded) return false;

  console.log('[Sherpa-ONNX TTS] Unzipping downloaded espeak-ng-data...');
  return new Promise((resolve) => {
    exec(`unzip -t "${zipPath}" && unzip -q -o "${zipPath}" -d "${nghiDir}" && rm -f "${zipPath}"`, (err) => {
      if (err) {
        console.error('[Sherpa-ONNX TTS] Unzip error:', err);
        if (fs.existsSync(zipPath)) {
          try { fs.unlinkSync(zipPath); } catch (_) {}
        }
        resolve(false);
      } else {
        console.log('[Sherpa-ONNX TTS] espeak-ng-data extracted successfully.');
        resolve(true);
      }
    });
  });
}

function floatTo16BitPcmWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(Math.floor(val), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Creates standard MPEG-1 Layer 3 silence frames (~180-200ms)
 * to insert between subtitle chunks for natural breathing pauses and cadence.
 */
function createMp3SilenceBuffer(durationMs: number = 180): Buffer {
  // MPEG-1 Layer 3, 44100Hz, 128kbps, Joint Stereo: frame size = 417 bytes, duration = 26.12ms
  const frame = Buffer.alloc(417, 0);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;

  const frameCount = Math.max(1, Math.round(durationMs / 26.1224));
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

/**
 * Bulletproof MP3 concatenator:
 * Strips ID3v2 metadata headers and ID3v1 footers from all chunk buffers
 * to ensure browsers and Web Audio API (decodeAudioData) never stop decoding midway.
 */
function concatMp3Buffers(buffers: Buffer[], insertSilenceMs: number = 0): Buffer {
  if (!buffers || buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1 && insertSilenceMs === 0) return buffers[0];

  const cleanBuffers: Buffer[] = [];
  const silenceBuf = insertSilenceMs > 0 ? createMp3SilenceBuffer(insertSilenceMs) : null;

  for (let i = 0; i < buffers.length; i++) {
    const rawBuf = buffers[i];
    if (!rawBuf || rawBuf.length === 0) continue;

    let startOffset = 0;
    // Strip ID3v2 header if present
    if (rawBuf.length > 10 && rawBuf.toString('ascii', 0, 3) === 'ID3') {
      const tagSize =
        ((rawBuf[6] & 0x7f) << 21) |
        ((rawBuf[7] & 0x7f) << 14) |
        ((rawBuf[8] & 0x7f) << 7) |
        (rawBuf[9] & 0x7f);
      startOffset = 10 + tagSize;
    }

    // Advance to the first valid MPEG audio sync word (0xFF + 0xE0-0xFF)
    while (startOffset < rawBuf.length - 1) {
      if (rawBuf[startOffset] === 0xff && (rawBuf[startOffset + 1] & 0xe0) === 0xe0) {
        break;
      }
      startOffset++;
    }

    // Strip ID3v1 footer if present
    let endOffset = rawBuf.length;
    if (rawBuf.length >= 128 && rawBuf.toString('ascii', rawBuf.length - 128, rawBuf.length - 125) === 'TAG') {
      endOffset = rawBuf.length - 128;
    }

    if (startOffset < endOffset) {
      const pureMpeg = rawBuf.subarray(startOffset, endOffset);
      if (pureMpeg.length > 0) {
        cleanBuffers.push(pureMpeg);
        if (silenceBuf && i < buffers.length - 1) {
          cleanBuffers.push(silenceBuf);
        }
      }
    } else {
      cleanBuffers.push(rawBuf);
      if (silenceBuf && i < buffers.length - 1) {
        cleanBuffers.push(silenceBuf);
      }
    }
  }

  return cleanBuffers.length > 0 ? Buffer.concat(cleanBuffers) : Buffer.alloc(0);
}

/**
 * Accurately parses MP3 frame headers to calculate audio duration in seconds.
 */
function getMp3BufferDuration(buffer: Buffer): number {
  if (!buffer || buffer.length < 4) return 0;

  const bitrateTableMPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitrateTableMPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const sampleRateTable = {
    MPEG1: [44100, 48000, 32000],
    MPEG2: [22050, 24000, 16000],
    MPEG25: [11025, 12000, 8000],
  };

  let offset = 0;
  // Skip ID3v2 tag if present
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  let totalDuration = 0;
  let frameCount = 0;

  while (offset < buffer.length - 4) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const b1 = buffer[offset + 1];
      const b2 = buffer[offset + 2];

      const versionBits = (b1 >> 3) & 0x03; // 00=2.5, 10=2, 11=1
      const layerBits = (b1 >> 1) & 0x03; // 01=Layer 3, 10=Layer 2, 11=Layer 1

      let version: 'MPEG1' | 'MPEG2' | 'MPEG25' | null = null;
      if (versionBits === 3) version = 'MPEG1';
      else if (versionBits === 2) version = 'MPEG2';
      else if (versionBits === 0) version = 'MPEG25';

      if (version && layerBits === 1) { // Layer III
        const bitrateIdx = (b2 >> 4) & 0x0f;
        const srIdx = (b2 >> 2) & 0x03;
        const padding = (b2 >> 1) & 0x01;

        const sampleRates = sampleRateTable[version];
        const sampleRate = sampleRates ? sampleRates[srIdx] : 0;
        const bitrates = version === 'MPEG1' ? bitrateTableMPEG1 : bitrateTableMPEG2;
        const bitrate = bitrates ? bitrates[bitrateIdx] : 0;

        if (sampleRate && bitrate) {
          const samplesPerFrame = version === 'MPEG1' ? 1152 : 576;
          const frameSize = Math.floor((samplesPerFrame / 8 * bitrate * 1000) / sampleRate) + padding;

          if (frameSize > 0 && offset + frameSize <= buffer.length + 1) {
            totalDuration += samplesPerFrame / sampleRate;
            frameCount++;
            offset += frameSize;
            continue;
          }
        }
      }
    }
    offset++;
  }

  if (totalDuration > 0) {
    return Math.round(totalDuration * 100) / 100;
  }
  // Fallback rough estimate if headers couldn't be parsed: assuming 64kbps CBR
  return Math.round(((buffer.length * 8) / 64000) * 100) / 100;
}

/**
 * Builds standard FFmpeg atempo filter chain for any ratio.
 * FFmpeg's atempo filter accepts values strictly between 0.5 and 2.0.
 * For ratios > 2.0 or < 0.5, multiple atempo filters must be chained together.
 */
function buildAtempoFilterChain(ratio: number): string {
  const filters: string[] = [];
  let remaining = ratio;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(',');
}

/**
 * 3-Layer Defense: Layer 3 - Post-process audio time-stretching (via FFmpeg atempo filter)
 * Compresses audio duration to match subtitle block duration while preserving natural vocal pitch.
 * Audio Sync Limits:
 * - NEVER slows down audio (if audio is shorter than block duration, it already fits cleanly without distortion).
 * - Caps speedup at 1.25x so speech is never rushed into inaudible distortion or chipmunk artifacts.
 */
async function stretchAudioWithAtempo(
  inputBuffer: Buffer,
  currentDuration: number,
  targetDuration: number
): Promise<{ buffer: Buffer; duration: number }> {
  if (currentDuration <= 0 || targetDuration <= 0 || !inputBuffer || inputBuffer.length === 0) {
    return { buffer: inputBuffer, duration: currentDuration };
  }

  // Audio Sync Safe Boundary:
  // If audio is shorter than or equal to target duration, it ALREADY fits comfortably within the block.
  // Slowing down audio below 1.0x creates horrific robotic slow-motion dragging voice distortion.
  // Therefore, only speed up when audio is strictly longer than target block duration.
  if (currentDuration <= targetDuration * 1.02) {
    return { buffer: inputBuffer, duration: currentDuration };
  }

  const rawRatio = currentDuration / targetDuration;
  // Strict boundary: clamp ratio to safe range [1.02, 1.25]
  const clampedRatio = Math.min(1.25, Math.max(1.02, rawRatio));

  // If difference is negligible (< 60ms or speedup <= 1.03x), preserve natural original audio
  if (Math.abs(currentDuration - targetDuration) < 0.06 || clampedRatio <= 1.03) {
    return { buffer: inputBuffer, duration: currentDuration };
  }

  const effectiveTargetDuration = currentDuration / clampedRatio;
  const filterChain = buildAtempoFilterChain(clampedRatio);
  const tempDir = path.join(os.tmpdir(), `audio_atempo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, 'input.mp3');
  const outputPath = path.join(tempDir, 'output.mp3');

  try {
    fs.writeFileSync(inputPath, inputBuffer);
    const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -filter:a "${filterChain}" -vn -c:a libmp3lame -q:a 2 "${outputPath}"`;
    console.log(`[Audio Sync] Nén nhẹ thời lượng audio (${(currentDuration * 1000).toFixed(0)}ms → atempo stretch ${(effectiveTargetDuration * 1000).toFixed(0)}ms [tốc độ ${clampedRatio.toFixed(2)}x, trần an toàn 1.25x])`);
    await execPromise(ffmpegCmd);

    if (fs.existsSync(outputPath)) {
      const outputBuffer = fs.readFileSync(outputPath);
      const newDuration = getMp3BufferDuration(outputBuffer) || effectiveTargetDuration;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      return { buffer: outputBuffer, duration: newDuration };
    }
  } catch (err: any) {
    console.warn(`[Audio Sync] Giữ audio gốc, sẽ stretch khi ghép (lỗi: ${err?.message || err})`);
  }

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  return { buffer: inputBuffer, duration: currentDuration };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust first proxy (Cloud Run / Nginx) for accurate req.ip resolution
  app.set('trust proxy', 1);

  // CORS & WASM Multi-threading Security Headers
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Accept, Origin, x-api-key');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Immediate health check for container probes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Dedicated, prioritized handler for /ort-wasm to guarantee official onnxruntime-web binaries
  app.get('/ort-wasm/:filename', (req, res) => {
    const filename = req.params.filename;
    const candidates = [
      path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', filename),
      path.join(process.cwd(), 'public', 'ort-wasm', filename),
      path.join(process.cwd(), 'dist', 'ort-wasm', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        // Only serve if not a truncated stub (< 5MB for main wasm files)
        if (filename.endsWith('.wasm') && stat.size < 5000000 && filename.includes('simd')) {
          continue;
        }
        if (filename.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        } else if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript');
        }
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(p);
      }
    }
    return res.redirect(`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/${encodeURIComponent(filename)}`);
  });

  // VieNeu-TTS v3 Turbo Model Files Endpoint (tokenizer.json, vieneu_vi_g2p.json, etc.)
  app.get('/api/vieneu-models/:filename', (req, res) => {
    const filename = req.params.filename;
    const safeFilename = path.basename(filename);
    const candidatePaths = [
      path.join(process.cwd(), 'models', safeFilename),
      path.join(process.cwd(), 'public', safeFilename),
      path.join(process.cwd(), 'public', 'models', safeFilename),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (safeFilename.endsWith('.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        return res.sendFile(p);
      }
    }
    res.status(404).json({ error: `VieNeu model file ${safeFilename} not found.` });
  });

  // VieNeu-TTS Voice Cloning Endpoint
  const cloneAudioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post('/api/vieneu/clone-voice', cloneAudioUpload.single('audio'), async (req, res) => {
    try {
      let audioBuffer: Buffer | null = null;
      let voiceName = (req.body.voiceName || '').trim();
      const gender = req.body.gender === 'female' ? 'female' : 'male';
      const accent = ['bac', 'trung', 'nam'].includes(req.body.accent) ? req.body.accent : 'bac';

      if (req.file && req.file.buffer) {
        audioBuffer = req.file.buffer;
      } else if (req.body.audioBase64) {
        const cleanB64 = req.body.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
        audioBuffer = Buffer.from(cleanB64, 'base64');
      }

      if (!audioBuffer || audioBuffer.length < 500) {
        res.status(400).json({ error: 'Vui lòng cung cấp tệp âm thanh mẫu hoặc bản ghi âm (tối thiểu 1.5 - 3 giây).' });
        return;
      }

      if (!voiceName) {
        voiceName = `Giọng Nhân Bản ${new Date().toLocaleDateString('vi-VN')}`;
      }

      console.log(`[VieNeu Voice Cloning] Processing voice clone for '${voiceName}' (${audioBuffer.length} bytes)...`);
      const preset = await extractVoiceProfileFromAudio(audioBuffer, {
        voiceName,
        gender,
        accent,
      });

      res.json({
        success: true,
        voice: preset,
        message: `Đã nhân bản thành công giọng '${preset.name}'!`,
      });
    } catch (err: any) {
      console.error('[VieNeu Voice Cloning Error]', err);
      res.status(500).json({ error: err?.message || 'Lỗi xử lý nhân bản giọng nói' });
    }
  });

  app.get('/api/vieneu/custom-voices', (_req, res) => {
    try {
      const voices = loadCustomVoices();
      const unique = Object.values(voices).filter((v, idx, arr) => arr.findIndex((x) => x.id === v.id) === idx);
      res.json({ success: true, voices: unique });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi nạp danh sách giọng nhân bản' });
    }
  });

  app.delete('/api/vieneu/custom-voices/:id', (req, res) => {
    try {
      const id = req.params.id;
      const ok = deleteCustomVoiceFromDisk(id);
      res.json({ success: ok, message: ok ? 'Đã xóa giọng nhân bản thành công' : 'Không tìm thấy giọng cần xóa' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi xóa giọng nhân bản' });
    }
  });

  // PaddleOCR Models & Dictionary Serving Endpoints
  const PADDLE_MODEL_CONFIGS: Record<string, { filename: string; remoteUrl: string; fallbackUrls: string[]; minSize: number; contentType: string }> = {
    det: {
      filename: 'det.onnx',
      remoteUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx?download=true',
      fallbackUrls: [
        'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx?download=true',
        'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.onnx?download=true',
      ],
      minSize: 100000,
      contentType: 'application/octet-stream',
    },
    rec: {
      filename: 'rec.onnx',
      remoteUrl: 'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx?download=true',
      fallbackUrls: [
        'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx?download=true',
        'https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.onnx?download=true',
      ],
      minSize: 100000,
      contentType: 'application/octet-stream',
    },
    dict: {
      filename: 'ppocrv6_dict.txt',
      remoteUrl: 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt',
      fallbackUrls: [
        'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt',
        'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt',
      ],
      minSize: 20000,
      contentType: 'text/plain; charset=utf-8',
    },
  };

  const handlePaddleModelRequest = async (req: express.Request, res: express.Response) => {
    const type = (req.params.type || '').toLowerCase();
    const variant = ((req.query.variant || req.query.size || 'small') as string).toLowerCase();

    const config = PADDLE_MODEL_CONFIGS[type];
    if (!config) {
      res.status(404).json({ error: `Model type '${type}' not found. Supported types: det, rec, dict` });
      return;
    }

    // Dynamic Remote URLs & filenames based on requested model variant (small vs tiny)
    let remoteUrl = config.remoteUrl;
    let fallbackUrls = config.fallbackUrls || [];
    const variantFilenames: string[] = [];

    if (type === 'det') {
      const hfModel = variant === 'tiny' ? 'PP-OCRv6_tiny_det_onnx' : 'PP-OCRv6_small_det_onnx';
      remoteUrl = `https://huggingface.co/PaddlePaddle/${hfModel}/resolve/main/inference.onnx?download=true`;
      fallbackUrls = [
        `https://huggingface.co/PaddlePaddle/${hfModel}/resolve/main/inference.onnx?download=true`,
        `https://huggingface.co/PaddlePaddle/${hfModel}/raw/main/inference.onnx`,
      ];
      if (variant === 'tiny') {
        variantFilenames.push('det_tiny.onnx', 'PaddleOCRv6-tiny-det.onnx', 'det.onnx');
      } else {
        variantFilenames.push('det_small.onnx', 'PP-OCRv6_small_det.onnx', 'det.onnx');
      }
    } else if (type === 'rec') {
      const hfModel = variant === 'tiny' ? 'PP-OCRv6_tiny_rec_onnx' : 'PP-OCRv6_small_rec_onnx';
      remoteUrl = `https://huggingface.co/PaddlePaddle/${hfModel}/resolve/main/inference.onnx?download=true`;
      fallbackUrls = [
        `https://huggingface.co/PaddlePaddle/${hfModel}/resolve/main/inference.onnx?download=true`,
        `https://huggingface.co/PaddlePaddle/${hfModel}/raw/main/inference.onnx`,
      ];
      if (variant === 'tiny') {
        variantFilenames.push('rec_tiny.onnx', 'PaddleOCRv6-tiny-rec.onnx', 'rec.onnx');
      } else {
        variantFilenames.push('rec_small.onnx', 'PP-OCRv6_small_rec.onnx', 'rec.onnx');
      }
    } else {
      if (variant === 'tiny') {
        remoteUrl = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt';
        fallbackUrls = ['https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_tiny_dict.txt'];
        variantFilenames.push('ppocrv6_tiny_dict.txt', 'dict_tiny.txt');
      } else {
        remoteUrl = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt';
        fallbackUrls = ['https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt'];
        variantFilenames.push('ppocrv6_dict.txt', 'dict.txt');
      }
    }

    const candidatePaths: string[] = [];
    for (const fn of variantFilenames) {
      candidatePaths.push(
        path.join(process.cwd(), 'public', fn),
        path.join(process.cwd(), fn),
        path.join(process.cwd(), 'public', 'models', fn),
        path.join(process.cwd(), 'dist', fn),
        path.join(process.cwd(), 'dist', 'models', fn),
        path.join(os.tmpdir(), fn)
      );
    }

    let foundPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.size >= (variant === 'small' && type !== 'dict' ? 5000000 : config.minSize)) {
          foundPath = p;
          break;
        }
      }
    }

    if (foundPath) {
      const stat = fs.statSync(foundPath);
      res.setHeader('Content-Type', config.contentType);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Range, Accept-Ranges');
      return res.sendFile(path.resolve(foundPath));
    }

    // If not found locally, fetch from remote CDN and stream while caching
    const urlsToTry = [remoteUrl, ...fallbackUrls];
    for (const url of urlsToTry) {
      try {
        console.log(`[PaddleOCR Model Server] Downloading ${config.filename} from ${url}...`);
        const remoteRes = await fetch(url);
        if (!remoteRes.ok) {
          continue;
        }

        const buffer = Buffer.from(await remoteRes.arrayBuffer());
        if (buffer.length < config.minSize) {
          continue;
        }

        // Cache to public and temp directories
        try {
          const publicDir = path.join(process.cwd(), 'public');
          fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(path.join(publicDir, config.filename), buffer);
          fs.writeFileSync(path.join(process.cwd(), config.filename), buffer);
        } catch (_) {}

        res.setHeader('Content-Type', config.contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(buffer);
      } catch (err: any) {
        console.warn(`[PaddleOCR Model Server Warning for ${config.filename}]`, err?.message || err);
      }
    }
    res.status(500).send(`Error downloading PaddleOCR model ${config.filename}: Failed from all sources`);
  };

  app.get('/api/paddle-models/:type', handlePaddleModelRequest);
  app.get('/api/ocr/model/:type', handlePaddleModelRequest);

  // Shared GenAI helper with Proxy & Custom Model support
  const getAiClientAndModel = (body: any = {}) => {
    const apiMode = body.apiMode || 'direct';
    const directApiKey = body.apiKey;
    const proxyUrl = body.proxyUrl;
    const proxyKey = body.proxyKey;
    const proxyTargetModel = body.proxyTargetModel;
    const requestModel = body.model;

    console.log('[getAiClientAndModel] Received config:', {
      apiMode,
      hasDirectApiKey: !!directApiKey,
      proxyUrl,
      hasProxyKey: !!proxyKey,
      proxyTargetModel,
      requestModel,
      customModelName: body.customModelName
    });

    let ai: GoogleGenAI;
    let selectedModel = requestModel;

    if (apiMode === 'proxy' && proxyUrl) {
      const baseUrl = proxyUrl.trim().replace(/\/+$/, '');
      const proxyNoApiKey = body.proxyNoApiKey === true;
      
      // Determine the API Key for proxy mode.
      // If proxyNoApiKey is true, we use proxyKey if entered, else dummy key.
      // Crucially, we do NOT fall back to process.env.GEMINI_API_KEY in proxy mode to avoid exhausting the server's shared system key quota!
      let apiKey = 'AIStudioProxyKey';
      if (proxyNoApiKey) {
        apiKey = (proxyKey && proxyKey.trim()) || 'AIStudioProxyKey';
      } else {
        apiKey = (proxyKey && proxyKey.trim()) || (directApiKey && directApiKey.trim()) || 'AIStudioProxyKey';
      }
      
      console.log(`[getAiClientAndModel] Initializing GoogleGenAI client with PROXY mode. Base URL: ${baseUrl}. Using proxyNoApiKey: ${proxyNoApiKey}`);
      ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          baseUrl,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // In proxy mode, prioritize the user's configured proxyTargetModel or customModelName over the requestModel (which defaults to standard Gemini models in the UI)
      if (proxyTargetModel && proxyTargetModel.trim()) {
        selectedModel = proxyTargetModel.trim();
      } else if (body.customModelName && body.customModelName.trim()) {
        selectedModel = body.customModelName.trim();
      } else if (requestModel && requestModel.trim() && requestModel !== 'GEMINI_WEB') {
        selectedModel = requestModel.trim();
      }
    } else {
      // Direct API mode
      const apiKey = directApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Không tìm thấy API Key. Vui lòng kiểm tra cấu hình trong phần Thiết lập.');
      }
      console.log('[getAiClientAndModel] Initializing GoogleGenAI client with DIRECT mode.');
      ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Support custom model names in direct mode if provided
      if (body.customModelName && body.customModelName.trim()) {
        selectedModel = body.customModelName.trim();
      }
    }

    if (!selectedModel || selectedModel === 'GEMINI_WEB') {
      selectedModel = 'gemini-3.6-flash';
    }

    console.log(`[getAiClientAndModel] Resolved model to use: ${selectedModel}`);
    return { ai, selectedModel };
  };

  // Backwards compatibility helper
  const getAiClient = (customKey?: string) => {
    return getAiClientAndModel({ apiKey: customKey }).ai;
  };

  // Helper with automatic retry for 429 Rate Limits / Quota Exhaustion and Model Not Found fallback
  const generateContentWithRetry = async (ai: GoogleGenAI, params: any, maxRetries = 2) => {
    let attempt = 0;
    let currentParams = { ...params };
    while (attempt <= maxRetries) {
      try {
        return await ai.models.generateContent(currentParams);
      } catch (err: any) {
        const errStr = String(err?.message || err || '');
        const isQuota = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('Quota');
        const isModelNotFound = errStr.includes('404') || errStr.includes('not found') || errStr.includes('is not supported') || errStr.includes('NOT_FOUND');

        if (isModelNotFound && currentParams.model !== 'gemini-2.5-flash' && currentParams.model !== 'gemini-2.0-flash') {
          console.warn(`[Gemini API] Model ${currentParams.model} is not available on this API key (likely standard public key on external host like Render). Falling back to gemini-2.5-flash...`);
          currentParams.model = 'gemini-2.5-flash';
          attempt++;
          continue;
        }

        if (isQuota && attempt < maxRetries) {
          attempt++;
          console.warn(`Gemini API 429 Quota hit. Retrying attempt ${attempt}/${maxRetries} in 2 seconds...`);
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          if (isQuota) {
            throw new Error('Lỗi Quota API Gemini (429): Đã quá giới hạn tần suất gọi AI (Quota Exhausted). Vui lòng chờ 30-60 giây trước khi thử lại.');
          }
          throw err;
        }
      }
    }
    throw new Error('Failed to generate content after retries.');
  };

  const handleAiRouteError = (err: any, res: any, defaultMsg: string, mode: 'proxy' | 'direct_custom' | 'direct_system' = 'direct_system') => {
    console.error(`[AI Route Error] [Mode: ${mode}] ${defaultMsg}:`, err);
    let errMsg = String(err?.message || err || '');
    if (errMsg.includes('<!DOCTYPE html>') || errMsg.includes('<html')) {
      if (errMsg.includes('524')) {
        errMsg = 'Lỗi 524 Timeout từ Proxy/Cloudflare (A timeout occurred at origin server).';
      } else {
        errMsg = errMsg.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      }
    }
    const lowerMsg = errMsg.toLowerCase();

    if (
      lowerMsg.includes('quota') || 
      lowerMsg.includes('exhausted') || 
      lowerMsg.includes('429') || 
      lowerMsg.includes('rate_limit') ||
      lowerMsg.includes('rate limit') ||
      lowerMsg.includes('resource_exhausted')
    ) {
      let quotaMessage = 'Hết lượt dùng thử miễn phí của API Key hệ thống (Quota Exceeded). Bạn vui lòng:\n1. Đợi vài phút rồi thử lại.\n2. Chọn Model khác ở thanh dưới cùng (ví dụ gemini-2.0-flash hoặc gemini-1.5-flash).\n3. Hoặc bấm nút Cài Đặt (bên phải trên cùng) để điền API Key cá nhân của bạn để sử dụng ổn định, không bị giới hạn.';
      if (mode === 'proxy') {
        quotaMessage = 'Proxy của bạn báo quá giới hạn tần suất/hạn mức sử dụng (Quota Exceeded / Rate Limit). Vui lòng:\n1. Đợi vài phút rồi thử lại.\n2. Kiểm tra lại hạn mức tài khoản liên kết với Proxy của bạn.\n3. Hoặc chuyển sang chế độ Direct API / dùng API Key cá nhân khác.';
      } else if (mode === 'direct_custom') {
        quotaMessage = 'API Key cá nhân của bạn báo quá giới hạn tần suất/hạn mức (Quota Exceeded / Rate Limit). Vui lòng:\n1. Kiểm tra lại hạn mức API Key của bạn.\n2. Chọn model nhẹ hơn (ví dụ gemini-2.0-flash hoặc gemini-1.5-flash).\n3. Hoặc đợi 1-2 phút rồi thử lại.';
      }

      return res.status(429).json({
        success: false,
        error: 'QUOTA_EXCEEDED',
        message: quotaMessage,
        rawError: errMsg
      });
    }

    if (lowerMsg.includes('timeout') || lowerMsg.includes('524') || lowerMsg.includes('504')) {
      return res.status(504).json({
        success: false,
        error: 'TIMEOUT',
        message: 'Yêu cầu bị quá hạn (Timeout 524). Hệ thống tự động chia nhỏ phụ đề hoặc vui lòng chuyển sang model nhẹ hơn như gemini-2.5-flash.',
        rawError: errMsg
      });
    }

    if (
      lowerMsg.includes('key not valid') || 
      lowerMsg.includes('api key') || 
      lowerMsg.includes('invalid api key') || 
      (lowerMsg.includes('not found') && lowerMsg.includes('key'))
    ) {
      let invalidKeyMessage = 'API Key hệ thống không hợp lệ hoặc đã hết hạn. Vui lòng liên hệ quản trị viên hoặc sử dụng API Key/Proxy cá nhân.';
      if (mode === 'proxy') {
        invalidKeyMessage = 'Proxy hoặc API Key cấu hình cho Proxy không hợp lệ. Vui lòng kiểm tra lại thiết lập Proxy của bạn trong mục Cài Đặt.';
      } else if (mode === 'direct_custom') {
        invalidKeyMessage = 'API Key cá nhân của bạn không hợp lệ. Vui lòng kiểm tra lại cấu hình API Key trong mục Cài Đặt.';
      }

      return res.status(401).json({
        success: false,
        error: 'INVALID_API_KEY',
        message: invalidKeyMessage,
        rawError: errMsg
      });
    }

    return res.status(500).json({
      success: false,
      error: 'AI_ERROR',
      message: `${defaultMsg}: ${errMsg}`,
      rawError: errMsg
    });
  };

  // 1. Health check & System Status
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/api/system-status', (_req, res) => {
    res.json({
      success: true,
      hasSystemGeminiKey: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      nodeEnv: process.env.NODE_ENV || 'development',
      time: new Date().toISOString(),
    });
  });

  // 1a. Proxy/Serve PaddleOCR PP-OCRv6/v5 ONNX model & dictionary files cleanly
  app.get(['/dict.txt', '/ppocrv6_tiny_dict.txt', '/ppocrv5_keys.txt'], (_req, res) => {
    try {
      const candidates = [
        path.join(process.cwd(), 'public', 'dict.txt'),
        path.join(process.cwd(), 'dict.txt'),
        path.join(process.cwd(), 'public', 'ppocrv6_tiny_dict.txt'),
        path.join(process.cwd(), 'ppocrv6_tiny_dict.txt'),
        path.join(process.cwd(), 'ppocrv5_keys.txt'),
      ];
      for (const dictPath of candidates) {
        if (fs.existsSync(dictPath)) {
          const rawContent = fs.readFileSync(dictPath, 'utf8');
          const cleaned = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
          const cleanBuf = Buffer.from(cleaned, 'utf8');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Content-Length', cleanBuf.length.toString());
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(cleanBuf);
        }
      }
      return res.status(404).send('Dictionary not found');
    } catch (e: any) {
      return res.status(500).send(e?.message || 'Server error');
    }
  });

  // 1b. Real-time Video Frame OCR (PaddleOCR JSON compatible local endpoint)
  app.post('/api/ocr-frame', async (req, res) => {
    try {
      const imageBase64 = req.body.imageBase64 || req.body.image;
      if (!imageBase64) {
        res.status(400).json({ success: false, error: 'Missing imageBase64' });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
      const { ai, selectedModel } = getAiClientAndModel(req.body);

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          {
            text: `Extract all visible Chinese / multilingual text from this video frame snapshot. Return JSON with a list of text regions containing raw text, translated text to Vietnamese, confidence, and 2D bounding boxes.`,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.INTEGER, description: '100 for success' },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    translatedText: { type: Type.STRING },
                    score: { type: Type.NUMBER },
                    box: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                      description: '[ymin, xmin, ymax, xmax] 0-1000',
                    },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        success: true,
        data: {
          code: 100,
          data: parsed.items || [],
        },
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed in /api/ocr-frame', mode);
    }
  });

  // 2. Single Frame OCR & Translation
  app.post('/api/ocr-extract', async (req, res) => {
    try {
      const { image, timestamp, targetLang = 'Tiếng Việt', model = 'gemini-3.6-flash', customContext } = req.body;

      if (!image) {
        res.status(400).json({ error: 'Missing image data' });
        return;
      }

      const { ai, selectedModel } = getAiClientAndModel(req.body);

      // Remove data URL prefix if present
      const cleanBase64 = image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

      const prompt = `You are a high-precision video OCR and subtitle translator.
Your job is to examine this cropped region of a video frame and extract any visible text/subtitle.
${customContext ? `Context about the video content: ${customContext}` : ''}

Target translation language: ${targetLang}.

Instructions:
1. If NO visible text/subtitle exists in the image frame, set "hasText": false.
2. If text IS visible:
   - Extract the exact raw original text ("originalText").
   - Identify the source language ("sourceLang").
   - Translate "originalText" into natural, contextual ${targetLang} ("translatedText").
   - Provide a confidence score between 0.0 and 1.0 ("confidence").
   - Locate the exact 2D bounding box of the subtitle text inside this image as "box_2d" formatted as an array of 4 integers [ymin, xmin, ymax, xmax] normalized on a 0 to 1000 scale.`;

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hasText: { type: Type.BOOLEAN, description: 'True if subtitle text is visible' },
              originalText: { type: Type.STRING, description: 'Extracted raw text' },
              sourceLang: { type: Type.STRING, description: 'Detected source language code or name' },
              translatedText: { type: Type.STRING, description: 'Translated subtitle text' },
              confidence: { type: Type.NUMBER, description: 'Detection confidence from 0 to 1' },
              box_2d: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: '2D bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000'
              },
            },
            required: ['hasText'],
          },
        },
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);

      res.json({
        success: true,
        timestamp: timestamp || 0,
        result: parsed,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to extract subtitle via OCR.', mode);
    }
  });

  // 3. Multi-Frame Batch OCR & Subtitle Synchronizer
  app.post('/api/ocr-batch-frames', async (req, res) => {
    try {
      const { frames, targetLang = 'Tiếng Việt', model = 'gemini-3.6-flash', ocrEngine = 'gemini_vision', customContext } = req.body;

      if (!frames || !Array.isArray(frames) || frames.length === 0) {
        res.status(400).json({ error: 'Missing or invalid frames array' });
        return;
      }

      // Gemini Vision Multimodal AI Engine
      const { ai, selectedModel } = getAiClientAndModel(req.body);

      const batchPrompt = `You are a high-precision, strict OCR engine for video subtitles.
You are given a sequence of ${frames.length} cropped video frame snapshots captured chronologically.
Frame timestamps: ${frames.map((f: any) => f.timestamp.toFixed(2) + 's').join(', ')}.
${customContext ? `Video context / topic: ${customContext}` : ''}

STRICT CHARACTER FIDELITY & OCR INSTRUCTIONS:
1. Carefully inspect EVERY single frame snapshot from Frame 1 to Frame ${frames.length}. Transcribe the EXACT printed/burned subtitle text verbatim (Chinese, English, Vietnamese, Japanese, etc.).
2. ACCURACY REQUIREMENT:
   - For Chinese text (Simplified / Traditional): Preserve exact CJK characters. DO NOT confuse similar Chinese characters (e.g. 已/己/巳, 治/冶, 未/末, 日/目, 视/祝). DO NOT hallucinate or guess characters that are not on screen.
   - For English/Vietnamese text: Preserve exact spelling, accent marks, and punctuation.
3. CRITICAL RULE TO PREVENT SUBTITLE "LAZINESS" & DURATION DRIFT:
   - Video subtitles change FREQUENTLY (every 0.3s to 1.5s)!
   - NEVER create a single long subtitle entry that spans across different sentences or across frames where the text has changed.
   - When text in Frame N is DIFFERENT from Frame N-1, you MUST END the previous subtitle entry at Frame N-1 timestamp and START a NEW subtitle entry at Frame N timestamp.
   - "startTime": Exact timestamp (in seconds) of the FIRST frame snapshot where this specific text string appears.
   - "endTime": Exact timestamp (in seconds) of the LAST frame snapshot where this specific text string STILL appears. Must NOT extend into later frames where the text changed or disappeared.
   - "originalText": The exact OCR text string.
   - "sourceLang": Language code/name (e.g. "zh", "vi", "en").
4. DEDUPLICATION & MERGING:
   - ONLY merge consecutive frames if they show the EXACT SAME or nearly identical text string.
   - If a frame has NO text, or text changes, DO NOT extend the previous subtitle's endTime to that frame!
5. FAST-SUBTITLE COMPLETENESS:
   - Even if a subtitle string appears in ONLY A SINGLE FRAME (e.g., duration < 0.5s), you MUST output a distinct subtitle item with startTime = frame timestamp and endTime = frame timestamp + 0.4s.
6. If NO text is present in any frame, return an empty array [].`;

      const parts: any[] = [{ text: batchPrompt }];

      frames.forEach((f: { image: string; timestamp: number }, idx: number) => {
        const cleanBase64 = f.image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
        parts.push({
          text: `--- Frame ${idx + 1}/${frames.length} (Timestamp: ${f.timestamp.toFixed(2)}s) ---`,
        });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: cleanBase64,
          },
        });
      });

      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER, description: 'Start time in seconds' },
                endTime: { type: Type.NUMBER, description: 'End time in seconds' },
                originalText: { type: Type.STRING, description: 'Extracted original subtitle' },
                sourceLang: { type: Type.STRING, description: 'Source language name' },
                translatedText: { type: Type.STRING, description: 'Translated subtitle' },
                confidence: { type: Type.NUMBER, description: 'Confidence score' },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: '2D bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000'
                },
              },
              required: ['startTime', 'endTime', 'originalText'],
            },
          },
        },
      });

      const responseText = response.text || '[]';
      const rawSubtitles = JSON.parse(responseText);

      // Post-process alignment: sort by startTime and remove overlap drift
      const subtitles = Array.isArray(rawSubtitles) ? rawSubtitles : [];
      subtitles.sort((a: any, b: any) => (a.startTime || 0) - (b.startTime || 0));

      for (let i = 0; i < subtitles.length; i++) {
        const curr = subtitles[i];
        if (i < subtitles.length - 1) {
          const next = subtitles[i + 1];
          if (curr.endTime >= next.startTime) {
            curr.endTime = Number(Math.max((curr.startTime || 0) + 0.1, (next.startTime || 0) - 0.05).toFixed(2));
          }
        }
        if (curr.endTime <= curr.startTime) {
          curr.endTime = Number(((curr.startTime || 0) + 0.3).toFixed(2));
        }
      }

      res.json({
        success: true,
        engine: 'gemini_vision',
        subtitles,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to process batch OCR frames.', mode);
    }
  });

  const CACHE_ROOT = path.join(process.cwd(), '.cache');
  const TTS_CACHE_DIR = path.join(CACHE_ROOT, 'tts');
  const TRANS_CACHE_DIR = path.join(CACHE_ROOT, 'translation');

  // Ensure cache directories exist
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
  fs.mkdirSync(TRANS_CACHE_DIR, { recursive: true });

  function getSha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  // Translation Cache Helpers
  function getCachedTranslation(originalText: string, targetLang: string, model: string, customCtx?: string): string | null {
    const ctxHash = customCtx ? getSha256(customCtx.trim()) : '';
    const key = ctxHash ? `trans:${originalText}:${targetLang}:${model}:${ctxHash}` : `trans:${originalText}:${targetLang}:${model}`;
    const hash = getSha256(key);
    const filePath = path.join(TRANS_CACHE_DIR, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data.translatedText || null;
      } catch (e) {
        console.warn('Failed to read cached translation:', e);
      }
    }
    return null;
  }

  function setCachedTranslation(originalText: string, targetLang: string, model: string, translatedText: string, customCtx?: string) {
    const ctxHash = customCtx ? getSha256(customCtx.trim()) : '';
    const key = ctxHash ? `trans:${originalText}:${targetLang}:${model}:${ctxHash}` : `trans:${originalText}:${targetLang}:${model}`;
    const hash = getSha256(key);
    const filePath = path.join(TRANS_CACHE_DIR, `${hash}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify({ originalText, targetLang, model, translatedText, customCtx: customCtx || '' }));
    } catch (e) {
      console.warn('Failed to write cached translation:', e);
    }
  }

  // 4a. Context Synchronization Expert - Extract Global Movie Context & Entity Glossary
  app.post('/api/extract-global-context', async (req, res) => {
    try {
      const { subtitles, targetLang = 'Tiếng Việt', customContext = '' } = req.body;

      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        res.status(400).json({ success: false, error: 'Missing subtitles array' });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Compact representation of subtitle dialogue lines for rapid script scanning
      const scriptLines = subtitles.map((s: any, idx: number) => {
        const text = String(s.originalText || s.text || '').trim();
        const start = typeof s.startTime === 'number' ? s.startTime.toFixed(1) : '0';
        return `[#${idx + 1} | ${start}s] ${text}`;
      }).filter((line: string) => !line.endsWith('] '));

      // In case of very large transcripts, ensure we include full breadth or a dense representative sample
      const fullScriptSample = scriptLines.length > 500
        ? scriptLines.slice(0, 500).join('\n') + `\n... [and ${scriptLines.length - 500} more dialogue lines]`
        : scriptLines.join('\n');

      const userNotes = customContext.trim()
        ? `\nADDITIONAL USER-PROVIDED CONTEXT / GUIDANCE:\n${customContext.trim()}\n`
        : '';

      const prompt = `You are a "context synchronization expert" - a master film script analyst, director of translation, and subtitle localization specialist for translating content into ${targetLang}.

YOUR MISSION:
Read through the following complete video subtitle script from beginning to end to understand the overall narrative arc, world setting, character relationships, dramatic conflicts, and dialogue tone.
From this full-script overview, extract a synchronized global context and terminology database that will be used as the single source of truth across all subsequent translation batches.

EXTRACT AND RETURN THE FOLLOWING INFORMATION IN STRICT JSON FORMAT:
1. "movieGenre": The primary and secondary genre of the video (e.g., "Cổ trang / Kiếm hiệp / Tiên hiệp", "Hiện đại / Đô thị / Tổng tài / Công sở", "Học đường / Thanh xuân", "Gia đình / Tình cảm", "Hành động / Tội phạm / Trinh thám", "Hài hước", "Kinh dị / Giật gân", "Khoa học viễn tưởng", "Anime / Hoạt hình", "Vlog / Phỏng vấn / Tài liệu", etc.).
2. "eraAndSetting": Detailed era and setting description (e.g., "Thời nhà Tống, giang hồ võ lâm môn phái", "Seoul / Bắc Kinh hiện đại, công ty công nghệ", "Trường trung học, thanh xuân học đường").
3. "characterPronounGuide": Specific guidelines for Vietnamese pronouns and address forms tailored to this genre and character dynamics:
   - For Cổ trang/Kiếm hiệp: Specify forms like "ta / ngươi / huynh / muội / tỷ / đệ / sư phụ / đồ nhi / bản tọa / tiểu thư / công tử / vương gia...".
   - For Hiện đại: Specify forms like "tôi / anh / em / cậu / tớ / mày / tao / sếp / chú / bác..." based on age, hierarchy, and intimacy.
   - MANDATORY DIRECTIVE: Explicitly emphasize that the translator MUST NEVER mechanically translate the same source pronoun (e.g. "你/我" in Chinese or "you/I" in English) into the same generic Vietnamese word for all characters. Pronouns must shift dynamically based on relationships, hierarchy, and emotion in each scene.
4. "summary": A concise 2-3 sentence overview of the video's plot, core premise, and tone.
5. "knownEntityGlossary": Array of all identified character names, locations, organizations/factions/sects, martial arts techniques, and key specialized terms with their standardized, authentic ${targetLang} translations (dịch trước chuẩn xác toàn bộ nhân vật, địa danh, thế lực, bang phái, phủ đệ):
   - "original": Original term/name in source language (e.g., "张无忌", "光明顶", "苏老爷", "孙宗耀")
   - "translated": Official, standard translation in ${targetLang} (e.g., "Trương Vô Kỵ", "Quang Minh Đỉnh", "Tô lão gia", "Tôn Tông Diệu")
   - "type": "character" | "location" | "organization" | "term" | "other"
   - "description": Brief context or role (e.g., "Nhân vật chính, gia chủ Tô phủ")${userNotes}

FULL SUBTITLE SCRIPT:
${fullScriptSample}`;

      const isProxyMode = (req.body.apiMode === 'proxy');
      const genConfig: any = {
        responseMimeType: 'application/json',
      };

      if (!isProxyMode) {
        genConfig.responseSchema = {
          type: Type.OBJECT,
          properties: {
            movieGenre: { type: Type.STRING, description: 'Primary genre of the movie/video' },
            eraAndSetting: { type: Type.STRING, description: 'Era and world setting' },
            characterPronounGuide: { type: Type.STRING, description: 'Vietnamese address forms and dynamic pronoun rules' },
            summary: { type: Type.STRING, description: 'Brief summary of the video plot' },
            knownEntityGlossary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING, description: 'Original name/term in source language' },
                  translated: { type: Type.STRING, description: 'Standardized translation in target language' },
                  type: { type: Type.STRING, description: 'character | location | organization | term | other' },
                  description: { type: Type.STRING, description: 'Role or explanation' },
                },
                required: ['original', 'translated', 'type'],
              },
            },
          },
          required: ['movieGenre', 'characterPronounGuide', 'knownEntityGlossary'],
        };
      }

      console.log(`[Extract Global Context] Analyzing ${subtitles.length} subtitle lines with model: ${selectedModel}...`);
      const response = await generateContentWithRetry(ai, {
        model: selectedModel,
        contents: prompt,
        config: genConfig,
      });

      let responseText = (response.text || '{}').trim();
      if (responseText.startsWith('```')) {
        responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      let globalContext: any = {};
      try {
        globalContext = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('[Extract Global Context] JSON Parse Error:', parseErr, responseText.slice(0, 200));
        globalContext = {
          movieGenre: 'Tự động',
          eraAndSetting: 'Hiện đại / Tự nhiên',
          characterPronounGuide: 'Xưng hô linh hoạt theo quan hệ nhân vật.',
          summary: '',
          knownEntityGlossary: [],
        };
      }

      // Ensure fields exist
      if (!globalContext.movieGenre) globalContext.movieGenre = 'Tự động';
      if (!globalContext.characterPronounGuide) globalContext.characterPronounGuide = 'Xưng hô tự nhiên theo bối cảnh.';
      if (!Array.isArray(globalContext.knownEntityGlossary)) globalContext.knownEntityGlossary = [];

      console.log(`[Extract Global Context] Successfully extracted: Genre="${globalContext.movieGenre}", Entities=${globalContext.knownEntityGlossary.length}`);

      res.json({
        success: true,
        globalContext,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to extract global context', mode);
    }
  });

  // Subtitle Sanitizer Helper for LLM Artifacts
  function cleanTranslatedSubtitleText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.trim();
    text = text.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();
    text = text
      .replace(/^(?:Bản\s*dịch|Dịch|Translation|Translated|Subtitle|Tiếng\s*Việt)\s*:\s*/i, '')
      .replace(/^Output\s*:\s*/i, '')
      .trim();

    if (/拼写错误|拼写|Correction:/i.test(text)) {
      const splitMatch = text.split(/拼写错误|拼写|Correction:/i);
      if (splitMatch[0] && splitMatch[0].trim().length >= 2) {
        text = splitMatch[0].trim();
      } else if (splitMatch[1]) {
        text = splitMatch[1].trim();
      }
    }

    text = text.replace(/(?:平衡|Cân\s*bằng|Balance)-[a-zA-Z0-9_\-]+(?:-ok-[0-9/]+-chars)?(?:\.(?:Về|About)-[a-zA-Z0-9_\-]+)?\.?/gi, ' ');
    text = text.replace(/(?:Về|About|ID)-[a-zA-Z0-9_\-]+\.?/gi, ' ');
    text = text.replace(/[a-zA-Z0-9_\-]+-ok-[0-9/]+-chars\.?/gi, ' ');
    text = text.replace(/平衡-[^\s.,!?]+/gi, ' ');

    text = text.replace(/\([0-9]+\s*chars?\s*-\s*Limit\s*[0-9]+\)/gi, '');
    text = text.replace(/\([0-9]+\s*chars?\)/gi, '');
    text = text.replace(/-\s*Limit\s*[0-9]+/gi, '');
    text = text.replace(/\bLimit\s*[0-9]+\b/gi, '');
    text = text.replace(/\b[0-9]+\/[0-9]+\s*chars?\b/gi, '');
    text = text.replace(/\([a-zA-Z0-9_\-]*\s*ok\s*[a-zA-Z0-9_\-]*\)/gi, '');
    text = text.replace(/\[\s*ok\s*\]/gi, '');
    text = text.replace(/\(Correction:[^)]*\)/gi, '');
    text = text.replace(/\(OK\)/gi, '');
    text = text.replace(/->\s*[^.,!?]+/gi, '');
    text = text.replace(/[（(【\[](?:注|Note|Ghi chú|Lưu ý)[^）)】\]]*[）)】\]]/gi, '');

    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(/^[.,;:!?\-–—\s]+/, '').trim();
    text = text.replace(/[.,;:!?\-–—\s]+$/, (match) => match.trim());

    // Deduplicate repeated sentences
    const sentences = text
      .split(/(?<=[.!?。！？])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length >= 2) {
      const uniqueSentences: string[] = [];
      for (let i = 0; i < sentences.length; i++) {
        const curr = sentences[i];
        const prev = uniqueSentences[uniqueSentences.length - 1];
        if (!prev || prev.toLowerCase() !== curr.toLowerCase()) {
          uniqueSentences.push(curr);
        }
      }
      text = uniqueSentences.join(' ');
    }

    const len = text.length;
    if (len >= 6) {
      const half = Math.floor(len / 2);
      for (let offset = -2; offset <= 2; offset++) {
        const splitIdx = half + offset;
        if (splitIdx > 2 && splitIdx < len - 2) {
          const left = text.substring(0, splitIdx).trim();
          const right = text.substring(splitIdx).trim();
          if (left && right && left.toLowerCase() === right.toLowerCase()) {
            text = left;
            break;
          }
        }
      }
    }

    return text.trim();
  }

  // 4. Batch Subtitle Translator / Refiner (with Global Genre, Entity Glossary & Previous Context Chaining)
  app.post('/api/translate-batch', async (req, res) => {
    try {
      const {
        subtitles,
        targetLang = 'Tiếng Việt',
        model = 'gemini-2.5-flash',
        glossary,
        customContext,
        contextPrompt,
        optimizeForTts = false,
        globalContext,
        knownEntityGlossary,
        previousContext,
      } = req.body;

      if (!subtitles || !Array.isArray(subtitles)) {
        res.status(400).json({ error: 'Missing subtitles array' });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Build consolidated context string for caching & prompt building
      const combinedGlossaryList: any[] = [
        ...(Array.isArray(knownEntityGlossary) ? knownEntityGlossary : []),
        ...(Array.isArray(glossary) ? glossary : []),
      ];

      const effectiveCustomContext = (customContext || contextPrompt || '').trim();
      const genreString = (globalContext?.movieGenre || '').trim();
      const cacheContextSig = `${genreString}::${combinedGlossaryList.map(g => `${g.original}=${g.translated}`).join('|')}::${effectiveCustomContext}`;

      // Identify which items are already in cache
      const finalTranslations: { id: string; translatedText: string }[] = [];
      const uncachedSubtitles: any[] = [];

      for (const sub of subtitles) {
        const cached = getCachedTranslation(sub.originalText, targetLang, selectedModel, cacheContextSig);
        if (cached) {
          finalTranslations.push({ id: sub.id, translatedText: cached });
        } else {
          uncachedSubtitles.push(sub);
        }
      }

      // If there are any uncached items, send them to Gemini with deep context chaining
      if (uncachedSubtitles.length > 0) {
        const ttsInstruction = optimizeForTts
          ? `
=== CHỈ THỊ DỊCH THOẠI CHO THUYẾT MINH / LỒNG TIẾNG (DUBBING TIMING) ===
1. ƯU TIÊN SỐ 1 LÀ TỰ NHIÊN & ĐẦY ĐỦ Ý: Câu thoại tiếng Việt phải tự nhiên, tròn vành rõ chữ, có đầu có đuôi, đúng tâm lý nhân vật và truyền tải trọn vẹn cảm xúc.
2. TUYỆT ĐỐI KHÔNG cắt xén bừa bãi làm câu què, cộc lốc, vô lễ, khó hiểu hay mất đi các chi tiết quan trọng của câu thoại gốc.
3. Diễn đạt súc tích khi cần thiết: Với những câu quá dài, hãy tìm cách diễn đạt bằng tiếng Việt cô đọng, gãy gọn, thanh thoát để người đọc/thuyết minh bắt kịp nhịp hình, nhưng VẪN PHẢI GIỮ ĐỦ 100% Ý NGHĨA.
4. Giữ trọn ngữ khí và kính ngữ: Giữ đúng đại từ xưng hô và các trợ từ tình thái tự nhiên (ạ, nhé, chứ, hả...).`
          : `
=== NGUYÊN TẮC DỊCH THUẬT: TỰ NHIÊN, MƯỢT MÀ, TRỌN VẸN 100% Ý NGHĨA PHIM ===
1. GIỮ TRỌN VẸN Ý NGHĨA & CẢM XÚC: Dịch đầy đủ, chính xác, không lược bớt bất kỳ thông tin, chi tiết hay hàm ý nào của câu thoại gốc. TUYỆT ĐỐI KHÔNG tóm tắt hay cắt giảm câu chữ.
2. KHẨU KHÍ ĐIỆN ẢNH TỰ NHIÊN: Lời thoại phải tự nhiên như người Việt giao tiếp hàng ngày ngoài đời thực, câu cú mượt mà, trôi chảy, đúng phong cách phim ảnh.
3. TRỢ TỪ NGỮ KHÍ PHONG PHÚ: Giữ đầy đủ các trợ từ ngữ khí tự nhiên của tiếng Việt (như: nhé, nha, đấy, mà, chứ, sao, cơ, ạ, dạ, hả...) để câu thoại có hồn và truyền tải đúng cảm xúc nhân vật.
4. XƯNG HÔ LINH HOẠT THEO TÌNH HUỐNG: Đảm bảo vai vế xưng hô chuẩn xác theo mối quan hệ, tuổi tác và sắc thái tình cảm giữa các nhân vật.`;

        // Format Global Genre & Pronoun Directives
        let globalGenreSection = '';
        if (globalContext && (globalContext.movieGenre || globalContext.characterPronounGuide)) {
          globalGenreSection = `
=== 1. GLOBAL MOVIE GENRE & STYLE RULES ===
- Thể loại phim (GLOBAL MOVIE GENRE): ${globalContext.movieGenre || 'Chưa xác định'}
- Thời đại & Bối cảnh: ${globalContext.eraAndSetting || 'Tự nhiên'}
${globalContext.summary ? `- Tóm tắt cốt truyện: ${globalContext.summary}` : ''}
- QUY TẮC ĐẠI TỪ NHÂN XƯNG (PRONOUN DIRECTIVES):
  ${globalContext.characterPronounGuide || 'Xưng hô phù hợp với thể loại phim và quan hệ nhân vật.'}
  ⚠️ ĐẶC BIỆT LƯU Ý: TUYỆT ĐỐI KHÔNG được máy móc dịch cùng 1 đại từ gốc (ví dụ "你/我" trong tiếng Trung hoặc "you/I" trong tiếng Anh) thành cùng 1 từ tiếng Việt cho mọi nhân vật. Phải linh hoạt thay đổi đại từ (anh/em, tôi/cô, ta/ngươi, huynh/muội, sư phụ/đồ nhi, sếp/em, chú/cháu, mày/tao...) dựa trên mối quan hệ, vị thế xã hội, tuổi tác, giới tính và cảm xúc trong từng câu thoại!`;
        }

        // Format Known Entity Glossary
        let glossarySection = '';
        if (combinedGlossaryList.length > 0) {
          const glossaryEntries = combinedGlossaryList
            .map((g: any) => `- "${g.original}" -> "${g.translated}" (${g.type || 'term'}${g.description ? `: ${g.description}` : ''})`)
            .join('\n');
          glossarySection = `
=== 2. KNOWN ENTITY GLOSSARY (BẮT BUỘC DỊCH ĐÚNG Y HỆT, KHÔNG ĐỔI) ===
Bạn BẮT BUỘC phải dịch đúng 100% các tên nhân vật, địa danh, môn phái và thuật ngữ theo bảng chuẩn hóa sau. TUYỆT ĐỐI KHÔNG tự ý thay đổi cách phiên âm hoặc cách dịch giữa các batch:
${glossaryEntries}`;
        }

        // Format Previous Context Chaining
        let previousContextSection = '';
        if (Array.isArray(previousContext) && previousContext.length > 0) {
          const prevLines = previousContext
            .map((p: any) => `[Câu trước] Gốc: "${p.originalText || ''}" -> Đã dịch: "${p.translatedText || ''}"`)
            .join('\n');
          previousContextSection = `
=== 3. PREVIOUS CONTEXT (NGỮ CẢNH BATCH TRƯỚC - CHỈ THAM KHẢO, KHÔNG DỊCH LẠI) ===
Dưới đây là các câu thoại liền trước để bạn nắm bắt mạch đối thoại, cảm xúc và xưng hô nhất quán:
${prevLines}
(Ghi chú: Các câu trên chỉ dùng để hiểu ngữ cảnh tiếp nối, KHÔNG đưa vào kết quả dịch output).`;
        }

        // User Custom Context
        let userNotesSection = '';
        if (effectiveCustomContext) {
          userNotesSection = `
=== 4. GHI CHÚ BỔ SUNG TỪ NGƯỜI DÙNG ===
${effectiveCustomContext}`;
        }

        const TRANS_CHUNK_SIZE = 30;
        const chunks: any[][] = [];
        for (let i = 0; i < uncachedSubtitles.length; i += TRANS_CHUNK_SIZE) {
          chunks.push(uncachedSubtitles.slice(i, i + TRANS_CHUNK_SIZE));
        }

        const newlyDiscoveredEntities: any[] = [];

        await Promise.all(
          chunks.map(async (chunk) => {
            const prompt = `You are a professional video translator, film dialog localizer, and context continuity expert.
Translate the following list of subtitles into ${targetLang}.${globalGenreSection}${glossarySection}${previousContextSection}${userNotesSection}${ttsInstruction}

MANDATORY OUTPUT CONSTRAINTS (QUY TẮC BẮT BUỘC):
1. "translatedText" must contain ONLY the spoken dialogue sentence in ${targetLang}.
2. TUYỆT ĐỐI KHÔNG ghi chú thích, tính toán số ký tự, giải thích, "拼写错误", "(OK)", "chars", "Limit", "Correction", "平衡", hay ID vào trường "translatedText".
3. TUYỆT ĐỐI KHÔNG lặp lại câu 2 lần hoặc ghép nối các câu trùng lặp.
4. Output strictly a JSON object matching the required structure: {"translations": [{"id": string, "translatedText": string}]}.

=== SUBTITLES TO TRANSLATE (DỊCH DANH SÁCH NÀY) ===
${JSON.stringify(chunk.map((s: any) => {
  if (optimizeForTts) {
    const durSec = Math.max(0.5, (s.endTime - s.startTime) || 2.0);
    return {
      id: s.id,
      originalText: s.originalText,
      targetDurationSec: Number(durSec.toFixed(1)),
    };
  }
  return {
    id: s.id,
    originalText: s.originalText,
  };
}))}`;

            try {
              let responseText = '';

              if (req.body.apiMode === 'groq') {
                const groqApiKey = req.body.groqApiKey || req.body.apiKey || process.env.GROQ_API_KEY;
                const groqModel = req.body.groqModel || 'llama-3.3-70b-versatile';
                responseText = await translateWithGroq(prompt, {
                  apiKey: groqApiKey,
                  model: groqModel,
                  responseFormatJson: true,
                });
              } else if (req.body.apiMode === 'gemini_web' && req.body.geminiWebCookie) {
                const session = await validateAndExtractGeminiWebSession(req.body.geminiWebCookie.trim());
                if (!session.valid || !session.snlm0e) {
                  throw new Error(session.error || 'Phiên Google Account Gemini Web đã hết hạn hoặc không hợp lệ.');
                }
                const rpcRes = await executeGeminiWebPrompt(prompt, session);
                if (!rpcRes.success || !rpcRes.text) {
                  throw new Error(rpcRes.error || 'Lỗi nhận dữ liệu từ Google Gemini Web RPC.');
                }
                responseText = rpcRes.text.trim();
              } else {
                const isProxyMode = (req.body.apiMode === 'proxy');
                const genConfig: any = {
                  responseMimeType: 'application/json',
                };

                if (!isProxyMode) {
                  genConfig.responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                      translations: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            id: { type: Type.STRING },
                            translatedText: { type: Type.STRING },
                          },
                          required: ['id', 'translatedText'],
                        },
                      },
                      newEntities: {
                        type: Type.ARRAY,
                        description: 'Any newly discovered character names or locations in this batch',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            original: { type: Type.STRING },
                            translated: { type: Type.STRING },
                            type: { type: Type.STRING },
                          },
                          required: ['original', 'translated'],
                        },
                      },
                    },
                    required: ['translations'],
                  };
                }

                const response = await generateContentWithRetry(ai, {
                  model: selectedModel,
                  contents: prompt,
                  config: genConfig,
                });

                responseText = (response.text || '{}').trim();
              }

              if (responseText.startsWith('```')) {
                responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
              }

              let parsedResponse: any;
              try {
                parsedResponse = JSON.parse(responseText);
              } catch (parseErr) {
                console.warn('[Translate Batch] Direct JSON parse failed, trying array fallback:', parseErr);
                parsedResponse = [];
              }

              const newTranslations = Array.isArray(parsedResponse)
                ? parsedResponse
                : (Array.isArray(parsedResponse?.translations) ? parsedResponse.translations : []);

              if (Array.isArray(parsedResponse?.newEntities)) {
                newlyDiscoveredEntities.push(...parsedResponse.newEntities);
              }

              // Map, sanitize and save each newly translated item to cache
              if (Array.isArray(newTranslations)) {
                newTranslations.forEach((nt: any) => {
                  const originalSub = chunk.find((s) => s.id === nt.id);
                  if (originalSub) {
                    const durSec = Math.max(0.5, (originalSub.endTime - originalSub.startTime) || 2.0);
                    const maxLen = Math.max(14, Math.floor(durSec * 16));
                    const cleanText = cleanTranslatedSubtitleText(nt.translatedText || '');
                    
                    if (cleanText && cleanText.length > maxLen * 1.5) {
                      console.warn(`[Sync Validation] Block ${originalSub.id} duration (${durSec.toFixed(1)}s) might be tight for translated length (${cleanText.length} chars vs target maxLength ${maxLen})`);
                    }
                    setCachedTranslation(originalSub.originalText, targetLang, selectedModel, cleanText, cacheContextSig);
                    finalTranslations.push({ id: originalSub.id, translatedText: cleanText });
                  }
                });
              }
            } catch (chunkErr) {
              console.warn(`[Translate Batch] Chunk failed:`, chunkErr);
              if (uncachedSubtitles.length <= TRANS_CHUNK_SIZE) {
                throw chunkErr;
              }
            }
          })
        );

        res.json({
          success: true,
          translations: finalTranslations,
          newEntities: newlyDiscoveredEntities,
        });
        return;
      }

      res.json({
        success: true,
        translations: finalTranslations,
        newEntities: [],
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to translate subtitle batch', mode);
    }
  });

  // 4b-1. Step 3 (Request 1): AI Subtitle Overload Screener (AI evaluates speech tempo and screens overloaded blocks)
  app.post('/api/screen-tts-overload', async (req, res) => {
    try {
      const {
        subtitles, // Array<{ id: string | number, text?: string, translatedText?: string, originalText?: string, duration?: number, startTime?: number, endTime?: number }>
        targetLang = 'Tiếng Việt',
      } = req.body;

      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        res.json({ success: true, overloadedItems: [] });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Format input for screening
      const inputFormatted = subtitles.map((s: any) => {
        const durSec = Math.max(0.3, Number(s.duration || (s.endTime - s.startTime)) || 1.5);
        const text = String(s.text || s.translatedText || s.originalText || '').trim();
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        return {
          id: s.id,
          text: text,
          durationSec: Number(durSec.toFixed(2)),
          wordCount: wordCount,
        };
      });

      const BATCH_SIZE = 40;
      const chunks: any[][] = [];
      for (let i = 0; i < inputFormatted.length; i += BATCH_SIZE) {
        chunks.push(inputFormatted.slice(i, i + BATCH_SIZE));
      }

      const allOverloaded: { id: string | number; text: string; duration: number; reason: string; targetWords?: number }[] = [];

      for (const chunk of chunks) {
        const prompt = `You are a professional film voiceover director, dubbing supervisor, and subtitle timing editor for Vietnamese Text-To-Speech (TTS).
Analyze the following subtitle blocks and their display durations in seconds ("durationSec").
Identify ONLY the subtitle blocks whose dialogue is genuinely OVERLOADED for Vietnamese voiceover — meaning there are too many words/syllables to be spoken naturally, clearly, and comfortably within its durationSec without rushing, clipping, or unnatural speedups.

CRITERIA:
- Natural Vietnamese voiceover tempo is approx 2.5 to 3.5 words per second.
- A block of 1.0s with 7-8 words is heavily overloaded.
- A block of 2.5s with 6-7 words is NOT overloaded.
- Do NOT flag sentences that can be comfortably spoken within the durationSec.

For each genuinely overloaded block, return its "id", a brief "reason" in Vietnamese, and recommended "targetWords".
Return strictly a JSON array:
[
  {
    "id": 1,
    "reason": "Thời lượng 1.2s quá ngắn cho câu 8 từ, nhịp đọc bị dồn",
    "targetWords": 4
  }
]
If NO subtitles are overloaded, return strictly: [].

Input Subtitles:
${JSON.stringify(chunk, null, 2)}`;

        let responseText = '';

        if (req.body.apiMode === 'gemini_web' && req.body.geminiWebCookie) {
          const session = await validateAndExtractGeminiWebSession(req.body.geminiWebCookie.trim());
          if (!session.valid || !session.snlm0e) {
            throw new Error(session.error || 'Phiên Google Account Gemini Web đã hết hạn.');
          }
          const rpcRes = await executeGeminiWebPrompt(prompt, session);
          if (!rpcRes.success || !rpcRes.text) {
            throw new Error(rpcRes.error || 'Lỗi nhận dữ liệu từ Google Gemini Web RPC.');
          }
          responseText = rpcRes.text.trim();
        } else {
          const isProxyMode = (req.body.apiMode === 'proxy');
          const genConfig: any = {
            responseMimeType: 'application/json',
          };

          if (!isProxyMode) {
            genConfig.responseSchema = {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  targetWords: { type: Type.NUMBER },
                },
                required: ['id'],
              },
            };
          }

          console.log(`[Screen TTS Overload] AI screening ${chunk.length} subtitle blocks for TTS pacing with ${selectedModel}...`);
          const response = await generateContentWithRetry(ai, {
            model: selectedModel,
            contents: prompt,
            config: genConfig,
          });
          responseText = (response.text || '[]').trim();
        }

        if (responseText.startsWith('```')) {
          responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }

        let parsed: any[] = [];
        try {
          parsed = JSON.parse(responseText);
        } catch {
          const match = responseText.match(/\[[\s\S]*\]/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch (_) {}
          }
        }

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id !== undefined) {
              const originalItem = chunk.find((c: any) => String(c.id) === String(item.id));
              if (originalItem) {
                allOverloaded.push({
                  id: originalItem.id,
                  text: originalItem.text,
                  duration: originalItem.durationSec,
                  reason: item.reason || 'Quá tải thời lượng đọc TTS',
                  targetWords: item.targetWords,
                });
              }
            }
          }
        }
      }

      res.json({
        success: true,
        overloadedItems: allOverloaded,
      });
    } catch (err: any) {
      console.error('[Screen TTS Overload] Error:', err);
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to screen overloaded TTS subtitles', mode);
    }
  });

  // 4b-2. Step 3 (Request 2): AI Subtitle Overload Optimizer (Targeted rewriting for screened overloaded lines)
  app.post('/api/optimize-tts-overload', async (req, res) => {
    try {
      const {
        overloadedBlocks, // Array<{ id: string | number, text: string, duration: string | number, reason?: string, targetWords?: number }>
        targetLang = 'Tiếng Việt',
      } = req.body;

      if (!overloadedBlocks || !Array.isArray(overloadedBlocks) || overloadedBlocks.length === 0) {
        res.json({ success: true, optimizedBlocks: [] });
        return;
      }

      let { ai, selectedModel } = getAiClientAndModel(req.body);
      if (selectedModel === 'GEMINI_WEB') {
        selectedModel = 'gemini-2.5-flash';
      }

      // Chunk into batches of 25 to ensure reliable output and no token cutoffs
      const BATCH_SIZE = 25;
      const chunks: any[][] = [];
      for (let i = 0; i < overloadedBlocks.length; i += BATCH_SIZE) {
        chunks.push(overloadedBlocks.slice(i, i + BATCH_SIZE));
      }

      const allOptimized: { id: string | number; text: string }[] = [];

      for (const chunk of chunks) {
        const inputFormatted = chunk.map((b: any) => {
          let durStr = String(b.duration || '1.5');
          durStr = durStr.replace('.', ',');
          return {
            id: b.id,
            text: String(b.text || ''),
            durationSec: durStr,
            issue: b.reason || 'Quá dài so với thời lượng',
            targetWords: b.targetWords,
          };
        });

        const prompt = `You are a master dialogue localizer and voiceover adapter for Vietnamese film dubbing and Text-To-Speech (TTS).
The following subtitle blocks were screened by the voiceover director as OVERLOADED for their display duration.
Rewrite and optimize the "text" of each block following these professional voiceover dubbing rules:

1. RÚT GỌN TỰ NHIÊN, CÔ ĐỌNG: Viết lại câu thoại ngắn gọn, súc tích, gãy gọn, giàu cảm xúc để giọng đọc TTS phát âm thoải mái, tự nhiên trong đúng thời lượng hiển thị (durationSec).
2. GIỮ NGUYÊN 100% Ý NGHĨA & CẢM XÚC: Không thêm thắt điều bịa đặt, không làm biến đổi nghĩa gốc hay làm câu cộc lốc, vô nghĩa.
3. TUYỆT ĐỐI BẢO LƯU ĐẠI TỪ XƯNG HÔ (PRONOUNS): Giữ nguyên quan hệ xưng hô của nhân vật (chú/cháu, anh/em, tôi/cô, ta/ngươi, sếp/em...) y như câu gốc.
4. KHÔNG DÙNG DẤU NGOẶC KÉP, KHÔNG CHÚ THÍCH: Chỉ trả về duy nhất lời thoại lồng tiếng hoàn chỉnh.

Format: [{"id": 1, "text": "câu thoại ngắn gọn đã tối ưu"}]

Input Blocks to Optimize:
${JSON.stringify(inputFormatted, null, 2)}`;

        let responseText = '';

        if (req.body.apiMode === 'gemini_web' && req.body.geminiWebCookie) {
          const session = await validateAndExtractGeminiWebSession(req.body.geminiWebCookie.trim());
          if (!session.valid || !session.snlm0e) {
            throw new Error(session.error || 'Phiên Google Account Gemini Web đã hết hạn hoặc không hợp lệ.');
          }
          const rpcRes = await executeGeminiWebPrompt(prompt, session);
          if (!rpcRes.success || !rpcRes.text) {
            throw new Error(rpcRes.error || 'Lỗi nhận dữ liệu từ Google Gemini Web RPC.');
          }
          responseText = rpcRes.text.trim();
        } else {
          const isProxyMode = (req.body.apiMode === 'proxy');
          const genConfig: any = {
            responseMimeType: 'application/json',
          };

          if (!isProxyMode) {
            genConfig.responseSchema = {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['id', 'text'],
              },
            };
          }

          console.log(`[Optimize TTS Overload] Rewriting ${chunk.length} overloaded subtitle blocks with ${selectedModel}...`);
          const response = await generateContentWithRetry(ai, {
            model: selectedModel,
            contents: prompt,
            config: genConfig,
          });
          responseText = (response.text || '[]').trim();
        }

        if (responseText.startsWith('```')) {
          responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }

        let parsed: any[] = [];
        try {
          parsed = JSON.parse(responseText);
        } catch (e) {
          console.warn('[Optimize TTS Overload] JSON parse failed, trying regex match:', e);
          const match = responseText.match(/\[[\s\S]*\]/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch (_) {}
          }
        }

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id !== undefined && item.text) {
              const cleaned = cleanTranslatedSubtitleText(String(item.text));
              allOptimized.push({
                id: item.id,
                text: cleaned,
              });
            }
          }
        }
      }

      res.json({
        success: true,
        optimizedBlocks: allOptimized,
      });
    } catch (err: any) {
      console.error('[Optimize TTS Overload] Error:', err);
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to optimize overloaded TTS subtitles', mode);
    }
  });

  // 4b. Gemini Subtitle Deduplicator & AI Refiner (OCR typo correction, trash removal, duplicate merging in original language)
  app.post('/api/deduplicate-subtitles', async (req, res) => {
    try {
      const { subtitles, model = 'gemini-3.6-flash', targetLang = 'Tiếng Việt', apiKey } = req.body;

      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        res.status(400).json({ success: false, error: 'Missing subtitles array' });
        return;
      }

      const isGroqMode = (req.body.apiMode === 'groq');
      const groqApiKey = req.body.groqApiKey || req.body.apiKey || process.env.GROQ_API_KEY;
      const groqModel = req.body.groqModel || 'llama-3.3-70b-versatile';

      let ai: any = null;
      let selectedModel = model;

      if (!isGroqMode) {
        const clientRes = getAiClientAndModel(req.body);
        ai = clientRes.ai;
        selectedModel = clientRes.selectedModel;
      }

      const processDedupChunk = async (chunkSubs: any[]) => {
        // Strip unused fields (base64 image, ROI boxes, internal IDs) to create a ultra-compact JSON payload for AI
        const compactChunk = chunkSubs.map((s: any) => ({
          startTime: typeof s.startTime === 'number' ? Number(s.startTime.toFixed(2)) : 0,
          endTime: typeof s.endTime === 'number' ? Number(s.endTime.toFixed(2)) : 0,
          originalText: String(s.originalText || s.text || '').trim(),
        }));

        const prompt = `You are GeminiSubtitleRefiner, an expert AI video subtitle post-processor.
You are given a raw list of extracted OCR video subtitles with timestamps.

YOUR 4 STRICT WORKFLOW MANDATES:
1. CONTEXTUAL DIALOGUE REPAIR & OCR TYPO FIXING:
   - Carefully inspect every CJK character, English word, or Vietnamese text in originalText.
   - Use the surrounding dialogue context (preceding and succeeding subtitle lines) to infer the exact intended speech.
   - Fix common OCR misreads and distorted characters (e.g. Chinese character confusions like 废↔匿, 骗↔輪, 误↔得, 已↔己, 治↔冶, 未↔末, 磁↔十, 江↔了, etc.) so originalText is grammatically natural and 100% correct in its NATIVE SOURCE LANGUAGE.

2. FILTER OUT OCR TRASH & NOISE:
   - Completely remove UI icons, watermark text, floating symbols/gibberish, single unreadable strokes, or video background noise that is not actual dialogue subtitle text.

3. MERGE DUPLICATE & FRAGMENTED SUBTITLES STRICTLY (NEVER DROP SHORT REPEATING PHRASES):
   - Identify identical consecutive sentences or cumulative typing frames belonging to the EXACT SAME line of dialogue.
   - DO NOT MERGE OR DROP separate short sentences or repeating short words (e.g. 3-5 character Chinese phrases like "哈哈哈哈", "hahaha", or short 3-4 word phrases spoken in fast succession). Each distinct phrase or repeating utterance MUST remain its own separate item on the timeline!
   - DO NOT DROP short phrases that appear after longer sentences.
   - PRESERVE EARLY STARTTIME: Set "startTime" to the EARLIEST startTime provided in the input where speech/text first appeared on screen. DO NOT delay, shorten, or push forward startTime.
   - RESPECT ENDTIME: Keep "endTime" close to when the subtitle actually disappears from screen. DO NOT extend "endTime" across blank pauses into the next subtitle.

4. DO NOT TRANSLATE:
   - Keep "originalText" strictly in its original source language. Do NOT translate to Vietnamese or any target language in this OCR refinement step.
   - Leave "translatedText" as empty string ("") unless preserving a pre-existing valid translation.

Raw Subtitles Input:
${JSON.stringify(compactChunk)}`;

        if (isGroqMode) {
          const groqPrompt = `${prompt}\n\nCRITICAL: Return ONLY a valid JSON array starting with [ and ending with ]. Do not include markdown code block syntax.`;
          const responseText = await translateWithGroq(groqPrompt, {
            apiKey: groqApiKey,
            model: groqModel,
            systemPrompt: 'You are an expert AI video subtitle post-processor. Return strictly a raw JSON array.',
            temperature: 0.1,
          });
          let cleanJson = responseText.trim();
          if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
          }
          let parsed: any;
          try {
            parsed = JSON.parse(cleanJson);
          } catch (jsonErr) {
            console.error('[Groq Deduplicate Subtitles] JSON Parse Error:', cleanJson);
            throw new Error(`Groq AI returned non-JSON text: ${cleanJson.slice(0, 150)}`);
          }
          return Array.isArray(parsed) ? parsed : [];
        }

        const isProxyMode = (req.body.apiMode === 'proxy');
        const genConfig: any = {
          responseMimeType: 'application/json',
        };

        // If not proxy or standard gemini endpoint, provide responseSchema.
        // For third-party reverse proxies, many do not accept complex responseSchema objects and will throw 400 Bad Request.
        if (!isProxyMode) {
          genConfig.responseSchema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER, description: 'Start time in seconds' },
                endTime: { type: Type.NUMBER, description: 'End time in seconds' },
                originalText: { type: Type.STRING, description: 'Cleaned, spell-corrected original subtitle in its native language' },
                sourceLang: { type: Type.STRING, description: 'Detected source language' },
                translatedText: { type: Type.STRING, description: 'Preserved translation or empty string' },
              },
              required: ['startTime', 'endTime', 'originalText'],
            },
          };
        }

        const response = await generateContentWithRetry(ai, {
          model: selectedModel,
          contents: prompt,
          config: genConfig,
        });

        let responseText = (response.text || '').trim();
        // Remove potential markdown code fences from reverse proxy responses
        if (responseText.startsWith('```')) {
          responseText = responseText.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        }

        let parsed: any;
        try {
          parsed = JSON.parse(responseText);
        } catch (jsonErr) {
          console.error('[Deduplicate Subtitles] JSON Parse Error for response:', responseText);
          throw new Error(`Proxy AI returned non-JSON text: ${responseText.slice(0, 150)}`);
        }
        return Array.isArray(parsed) ? parsed : [];
      };

      const DEDUP_CHUNK_SIZE = 50;
      let cleaned: any[] = [];
      let lastChunkError: any = null;

      if (subtitles.length <= DEDUP_CHUNK_SIZE) {
        cleaned = await processDedupChunk(subtitles);
      } else {
        console.log(`[Deduplicate Subtitles] Subtitle array size is ${subtitles.length}, processing in parallel chunks of ${DEDUP_CHUNK_SIZE}...`);
        const chunks: any[][] = [];
        for (let i = 0; i < subtitles.length; i += DEDUP_CHUNK_SIZE) {
          chunks.push(subtitles.slice(i, i + DEDUP_CHUNK_SIZE));
        }

        // Process all chunks concurrently in parallel
        const chunkResults = await Promise.all(
          chunks.map(async (chunk, idx) => {
            try {
              return await processDedupChunk(chunk);
            } catch (chunkErr) {
              console.error(`[Deduplicate Subtitles] Chunk #${idx} (${chunk.length} items) FAILED:`, chunkErr);
              lastChunkError = chunkErr;
              return chunk; // Fallback to raw OCR chunk on error
            }
          })
        );

        for (const resChunk of chunkResults) {
          if (Array.isArray(resChunk)) {
            cleaned.push(...resChunk);
          }
        }

        if (lastChunkError && cleaned.length === 0) {
          throw lastChunkError;
        }
      }

      // Strict Non-Overlap Sanitizer Pass on returned timeline (Yield prev.endTime to curr.startTime without moving curr.startTime)
      if (Array.isArray(cleaned) && cleaned.length > 0) {
        cleaned.sort((a: any, b: any) => (a.startTime || 0) - (b.startTime || 0));
        for (let i = 1; i < cleaned.length; i++) {
          const prev = cleaned[i - 1];
          const curr = cleaned[i];
          if (prev.endTime >= curr.startTime) {
            if (curr.startTime > (prev.startTime || 0) + 0.02) {
              prev.endTime = Number(Math.max((prev.startTime || 0) + 0.05, curr.startTime - 0.02).toFixed(2));
            } else {
              prev.endTime = Number(((prev.startTime || 0) + 0.10).toFixed(2));
              curr.startTime = Number(((prev.endTime || 0) + 0.02).toFixed(2));
            }
            if (curr.endTime < curr.startTime + 0.20) {
              curr.endTime = Number(((curr.startTime || 0) + 0.20).toFixed(2));
            }
          }
        }
      }

      res.json({
        success: true,
        subtitles: cleaned,
      });
    } catch (err: any) {
      const apiMode = req.body.apiMode || 'direct';
      const hasCustomKey = !!(req.body.apiKey && req.body.apiKey.trim());
      const mode = apiMode === 'proxy' ? 'proxy' : (hasCustomKey ? 'direct_custom' : 'direct_system');
      return handleAiRouteError(err, res, 'Failed to deduplicate subtitles via Gemini API', mode);
    }
  });

  // 5. Nghi TTS Status Endpoint
  app.post('/api/tts/nghi-status', async (req, res) => {
    try {
      const nghiVoiceKey = req.body.nghiVoice || 'lacphi';
      const voiceConfig = NGHI_TTS_VOICE_URLS[nghiVoiceKey] || NGHI_TTS_VOICE_URLS.lacphi;
      const nghiDir = path.join(process.cwd(), 'nghi-tts audio');
      const modelPath = path.join(nghiDir, voiceConfig.filename);
      const tokensPath = path.join(nghiDir, 'tokens.txt');
      const espeakPath = path.join(nghiDir, 'espeak-ng-data', 'phontab');

      const modelExists = fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000;
      const tokensExists = fs.existsSync(tokensPath) && fs.statSync(tokensPath).size > 10;
      const espeakExists = fs.existsSync(espeakPath);

      let modelSizeMb = 0;
      if (modelExists) {
        modelSizeMb = Math.round((fs.statSync(modelPath).size / (1024 * 1024)) * 10) / 10;
      }

      // Find all downloaded voice models
      const downloadedVoices: string[] = [];
      for (const [key, v] of Object.entries(NGHI_TTS_VOICE_URLS)) {
        const p = path.join(nghiDir, v.filename);
        if (fs.existsSync(p) && fs.statSync(p).size > 1000) {
          downloadedVoices.push(key);
        }
      }

      res.json({
        success: true,
        voiceKey: nghiVoiceKey,
        voiceName: voiceConfig.name,
        ready: modelExists && tokensExists && espeakExists,
        modelExists,
        tokensExists,
        espeakExists,
        modelSizeMb,
        downloadedVoices,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6. Nghi TTS Download Endpoint
  app.post('/api/tts/nghi-download', async (req, res) => {
    try {
      const nghiVoiceKey = req.body.nghiVoice || 'lacphi';
      const voiceConfig = NGHI_TTS_VOICE_URLS[nghiVoiceKey] || NGHI_TTS_VOICE_URLS.lacphi;
      const nghiDir = path.join(process.cwd(), 'nghi-tts audio');
      const modelPath = path.join(nghiDir, voiceConfig.filename);
      const tokensPath = path.join(nghiDir, 'tokens.txt');
      const tokensUrl = 'https://huggingface.co/doof-ferb/nghitts-copy/resolve/main/sherpa-onnx/tokens.txt';

      console.log(`[Sherpa-ONNX Download] Explicit download requested for voice '${voiceConfig.name}'...`);

      // 1. Ensure tokens.txt
      const tokensOk = await ensureFileDownloaded(tokensUrl, tokensPath);
      if (!tokensOk) {
        res.status(500).json({ success: false, error: 'Không thể tải file tokens.txt' });
        return;
      }

      // 2. Ensure espeak-ng-data
      const espeakOk = await ensureEspeakData(nghiDir);
      if (!espeakOk) {
        res.status(500).json({ success: false, error: 'Không thể giải nén thư viện espeak-ng-data' });
        return;
      }

      // 3. Ensure ONNX model
      const modelOk = await ensureFileDownloaded(voiceConfig.url, modelPath);
      if (!modelOk) {
        res.status(500).json({ success: false, error: `Không thể tải mô hình ONNX cho giọng ${voiceConfig.name}` });
        return;
      }

      // Reset any previous failed status or cached instance so new model configuration is loaded cleanly
      failedSherpaVoices.delete(nghiVoiceKey);
      disposeTtsInstance(nghiVoiceKey);
      clearTtsAudioCache();

      const sizeMb = Math.round((fs.statSync(modelPath).size / (1024 * 1024)) * 10) / 10;

      res.json({
        success: true,
        message: `Đã tải xong mô hình giọng đọc ${voiceConfig.name} (${sizeMb} MB) và thư viện Sherpa-ONNX!`,
        voiceKey: nghiVoiceKey,
        voiceName: voiceConfig.name,
        sizeMb,
      });
    } catch (e: any) {
      console.error('[Sherpa-ONNX Download Error]', e);
      res.status(500).json({ success: false, error: e.message || 'Lỗi khi tải mô hình' });
    }
  });

  // High-Speed Local TTS Cache & Multi-threaded Worker Pool Manager
  let lastTikTokRequestTime = 0;
  let cachedProxiflyProxy = '';
  let lastProxiflyFetchTime = 0;
  const failedSherpaVoices = new Set<string>();
  interface CachedAudioItem {
    audioBase64: string;
    duration?: number;
    timestamps?: { word: string; start: number; end: number }[];
  }
  const cachedTtsAudio = new Map<string, CachedAudioItem>();
  const MAX_AUDIO_CACHE_SIZE = 2000;

  const getCachedAudio = (key: string): CachedAudioItem | undefined => {
    // Check in-memory first
    if (cachedTtsAudio.has(key)) {
      return cachedTtsAudio.get(key);
    }
    // Check disk
    const hash = getSha256(key);
    const filePath = path.join(TTS_CACHE_DIR, `${hash}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const item = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Populate in-memory cache
        if (cachedTtsAudio.size >= MAX_AUDIO_CACHE_SIZE) {
          const firstKey = cachedTtsAudio.keys().next().value;
          if (firstKey) cachedTtsAudio.delete(firstKey);
        }
        cachedTtsAudio.set(key, item);
        return item;
      } catch (e) {
        console.warn('Failed to read cached audio from disk:', e);
      }
    }
    return undefined;
  };

  const clearTtsAudioCache = () => {
    cachedTtsAudio.clear();
  };

  const setCachedAudio = (key: string, item: CachedAudioItem) => {
    // Write in-memory
    if (cachedTtsAudio.size >= MAX_AUDIO_CACHE_SIZE) {
      const firstKey = cachedTtsAudio.keys().next().value;
      if (firstKey) cachedTtsAudio.delete(firstKey);
    }
    cachedTtsAudio.set(key, item);

    // Write disk
    const hash = getSha256(key);
    const filePath = path.join(TTS_CACHE_DIR, `${hash}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(item));
    } catch (e) {
      console.warn('Failed to write cached audio to disk:', e);
    }
  };

  class TtsWorkerPool {
    private workers: Worker[] = [];
    private idleWorkers: Worker[] = [];
    private activeJobs = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private queue: { job: any; resolve: (val: any) => void; reject: (err: any) => void }[] = [];
    private jobCounter = 0;

    private poolSize: number;

    constructor(poolSize = Math.max(1, Math.min(4, os.cpus().length - 1))) {
      this.poolSize = poolSize;
    }

    public start() {
      const workerCode = `
        const { parentPort } = require('worker_threads');
        const path = require('path');
        const fs = require('fs');

        let sherpaOnnxModule = null;
        try {
          sherpaOnnxModule = require('sherpa-onnx');
        } catch (e) {
          console.error('[Worker] Failed to load sherpa-onnx:', e);
        }

        const cachedTtsInstances = {};

        function disposeTtsInstance(voiceKey) {
          if (cachedTtsInstances[voiceKey]) {
            try {
              if (typeof cachedTtsInstances[voiceKey].free === 'function') {
                cachedTtsInstances[voiceKey].free();
              } else if (typeof cachedTtsInstances[voiceKey].delete === 'function') {
                cachedTtsInstances[voiceKey].delete();
              }
            } catch (e) {
              console.warn("[Worker] Sherpa-ONNX Instance Cleanup Warning:", e);
            }
            delete cachedTtsInstances[voiceKey];
          }
        }

        function floatTo16BitPcmWav(samples, sampleRate) {
          const numChannels = 1;
          const bytesPerSample = 2;
          const dataSize = samples.length * bytesPerSample;
          const buffer = Buffer.alloc(44 + dataSize);

          buffer.write('RIFF', 0);
          buffer.writeUInt32LE(36 + dataSize, 4);
          buffer.write('WAVE', 8);

          buffer.write('fmt ', 12);
          buffer.writeUInt32LE(16, 16);
          buffer.writeUInt16LE(1, 20);
          buffer.writeUInt16LE(numChannels, 22);
          buffer.writeUInt32LE(sampleRate, 24);
          buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
          buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
          buffer.writeUInt16LE(16, 34);

          buffer.write('data', 36);
          buffer.writeUInt32LE(dataSize, 40);

          let offset = 44;
          for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            const val = s < 0 ? s * 0x8000 : s * 0x7fff;
            buffer.writeInt16LE(Math.floor(val), offset);
            offset += 2;
          }

          return buffer;
        }

        parentPort.on('message', async (job) => {
          const { jobId, voiceKey, modelPath, tokensPath, dataDir, chunks, speed } = job;
          try {
            if (!sherpaOnnxModule) {
              throw new Error('sherpa-onnx module is not loaded on this worker');
            }

            // Free other voices to save memory
            for (const k of Object.keys(cachedTtsInstances)) {
              if (k !== voiceKey) {
                disposeTtsInstance(k);
              }
            }

            let ttsEngine = cachedTtsInstances[voiceKey];
            if (!ttsEngine) {
              ttsEngine = sherpaOnnxModule.createOfflineTts({
                offlineTtsModelConfig: {
                  offlineTtsVitsModelConfig: {
                    model: modelPath,
                    tokens: tokensPath,
                    lexicon: '',
                    dataDir: dataDir,
                    noiseScale: 0.667,
                    noiseScaleW: 0.8,
                    lengthScale: 1.0,
                  },
                  numThreads: 1,
                  debug: 0,
                  provider: 'cpu',
                },
                ruleFsts: '',
                ruleFars: '',
                maxNumSentences: 1,
              });
              cachedTtsInstances[voiceKey] = ttsEngine;
            }

            const samplesList = [];
            let sampleRate = 22050;
            const wordTimestamps = [];
            let currentAudioTime = 0;

            for (const chunk of chunks) {
              let res = ttsEngine.generate({ text: chunk, speed });
              if (res && res.samples && res.samples.length > 0) {
                const clonedSamples = new Float32Array(res.samples);
                samplesList.push(clonedSamples);
                const chunkSampleRate = res.sampleRate || sampleRate;
                sampleRate = chunkSampleRate;

                const chunkDuration = clonedSamples.length / chunkSampleRate;
                const words = chunk.split(/\\s+/).filter(Boolean);

                if (words.length > 0) {
                  if (Array.isArray(res.timestamps) && res.timestamps.length === words.length) {
                    for (const ts of res.timestamps) {
                      wordTimestamps.push({
                        word: ts.word || ts.text || '',
                        start: Math.round((currentAudioTime + (ts.start || 0)) * 1000) / 1000,
                        end: Math.round((currentAudioTime + (ts.end || 0)) * 1000) / 1000,
                      });
                    }
                  } else {
                    const totalChars = words.reduce((acc, w) => acc + w.length, 0);
                    let wordOffset = 0;
                    for (const w of words) {
                      const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                      const wordDur = chunkDuration * wordWeight;
                      wordTimestamps.push({
                        word: w,
                        start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                        end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                      });
                      wordOffset += wordDur;
                    }
                  }
                }

                currentAudioTime += chunkDuration;
              }
            }

            if (samplesList.length === 0) {
              parentPort.postMessage({ jobId, success: false, error: 'No audio samples generated' });
              return;
            }

            const totalLength = samplesList.reduce((acc, cur) => acc + cur.length, 0);
            const mergedSamples = new Float32Array(totalLength);
            let offset = 0;
            for (const samples of samplesList) {
              mergedSamples.set(samples, offset);
              offset += samples.length;
            }

            const exactDuration = Math.round((totalLength / sampleRate) * 1000) / 1000;
            const wavBuffer = floatTo16BitPcmWav(mergedSamples, sampleRate);

            parentPort.postMessage({
              jobId,
              success: true,
              buffer: wavBuffer,
              duration: exactDuration,
              timestamps: wordTimestamps,
            });
          } catch (err) {
            parentPort.postMessage({ jobId, success: false, error: err.message });
          }
        });
      `;

      const spawnWorker = () => {
        const worker = new Worker(workerCode, { eval: true });
        worker.on('message', (msg) => {
          const { jobId, success, buffer, duration, timestamps, error } = msg;
          const callbacks = this.activeJobs.get(jobId);
          if (callbacks) {
            this.activeJobs.delete(jobId);
            if (success) {
              callbacks.resolve({ buffer, duration, timestamps });
            } else {
              callbacks.reject(new Error(error));
            }
          }
          this.returnWorkerToPool(worker);
        });
        worker.on('error', (err) => {
          this.handleWorkerCrash(worker);
        });
        worker.on('exit', (code) => {
          if (code !== 0) {
            this.handleWorkerCrash(worker);
          }
        });
        this.workers.push(worker);
        this.idleWorkers.push(worker);
      };

      for (let i = 0; i < this.poolSize; i++) {
        spawnWorker();
      }
      console.log(`[TtsWorkerPool] Started pool with ${this.poolSize} workers.`);
    }

    private returnWorkerToPool(worker: Worker) {
      if (this.workers.includes(worker)) {
        this.idleWorkers.push(worker);
        this.processQueue();
      }
    }

    private handleWorkerCrash(worker: Worker) {
      this.workers = this.workers.filter(w => w !== worker);
      this.idleWorkers = this.idleWorkers.filter(w => w !== worker);
      try { worker.terminate(); } catch {}
      // Replace only this single crashed worker
      if (this.workers.length < this.poolSize) {
        try {
          const workerCode = `
            const { parentPort } = require('worker_threads');
            let sherpaOnnxModule = null;
            try { sherpaOnnxModule = require('sherpa-onnx'); } catch (e) {}
            parentPort.on('message', async (job) => {
              parentPort.postMessage({ jobId: job.jobId, success: false, error: 'WASM worker memory constrained' });
            });
          `;
          const replacement = new Worker(workerCode, { eval: true });
          replacement.on('message', (msg) => {
            const callbacks = this.activeJobs.get(msg.jobId);
            if (callbacks) {
              this.activeJobs.delete(msg.jobId);
              callbacks.reject(new Error(msg.error));
            }
            this.returnWorkerToPool(replacement);
          });
          this.workers.push(replacement);
          this.idleWorkers.push(replacement);
        } catch {}
      }
    }

    public runJob(jobData: any): Promise<any> {
      if (this.workers.length === 0) {
        this.start();
      }
      return new Promise((resolve, reject) => {
        const jobId = `job_${++this.jobCounter}`;
        const job = { jobId, ...jobData };
        this.queue.push({ job, resolve, reject });
        this.processQueue();
      });
    }

    private processQueue() {
      if (this.queue.length === 0 || this.idleWorkers.length === 0) return;
      const worker = this.idleWorkers.shift()!;
      const { job, resolve, reject } = this.queue.shift()!;
      this.activeJobs.set(job.jobId, { resolve, reject });
      worker.postMessage(job);
    }
  }

  const ttsWorkerPool = new TtsWorkerPool();

  const cachedTtsInstances: Record<string, any> = {};
  const disposeTtsInstance = (voiceKey: string) => {
    // Keep as a fallback stub
  };
  const getOrCreateTtsEngine = (voiceKey: string, modelPath: string, tokensPath: string, dataDir: string) => {
    // Keep as a fallback stub
    return null;
  };

  // 7. Text to Speech (TTS) Narration Endpoint & Safe Generation Helper
  const sanitizeTextForSherpa = (input: string): string => {
    if (!input) return '';
    let cleaned = input
      .replace(/<[^>]*>/g, '') // remove HTML tags
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // remove emojis
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s.,?!;:\-–—"'()]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Fix spaces before punctuation (e.g. "xin chào , " -> "xin chào, ")
    cleaned = cleaned.replace(/\s+([.,?!;:])/g, '$1');
    // Collapse duplicated punctuation (e.g. "..." or "!!!" -> ".")
    cleaned = cleaned.replace(/([.,?!;:])\1+/g, '$1');
    return cleaned.trim();
  };

  /**
   * 3-Layer Sentence Tokenization and Chunking Pipeline:
   * 
   * Layer 1: Meaning-safe sentence regex extraction: ([^.?!\n]+(?:[.?!\n]+|$))
   *          Preserves the sentence and its trailing punctuation together as a unified block.
   * 
   * Layer 2: Lookahead/lookbehind non-terminal period protection:
   *          - Honorifics/Abbreviations: Dr., Mr., Mrs., Ms., Prof., ThS., TS., TP., Tp., etc., v.v.
   *          - Decimals and thousands separators: (\d)[.,](\d) (e.g., 3.14, 10.5, 1,000)
   * 
   * Layer 3: Whole-sentence chunk packing:
   *          - Accumulates whole sentences into chunks up to maxLen (and maxNumSentences).
   *          - Never splits between words unless an individual isolated sentence exceeds maxLen on its own.
   */
  const splitTextToShortSentences = (text: string, maxLen = 100, maxNumSentences = 10): string[] => {
    const sanitized = sanitizeTextForSherpa(text);
    if (!sanitized) return [];

    if (sanitized.length <= maxLen) {
      return [sanitized];
    }

    // Layer 2: Protect false periods (abbreviations, honorifics, decimal numbers)
    let protectedText = sanitized
      .replace(/(\d)[.,](\d)/g, '$1__DECIMAL_P__$2')
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|ThS|TS|TP|Tp)\.(?=\s[A-ZÀ-Ỹa-zà-ỹ0-9])/gi, '$1__ABBR_P__')
      .replace(/\betc\.(?!\s[A-ZÀ-Ỹ])/gi, 'etc__ETC_P__')
      .replace(/\bv\.v\./gi, 'v__VV_P__v__VV_P__');

    // Layer 1: Match whole sentences keeping trailing punctuation intact
    const sentenceMatches = protectedText.match(/([^.?!\n]+(?:[.?!\n]+|$))/g) || [];

    const unprotect = (str: string): string => {
      return str
        .replace(/__DECIMAL_P__/g, '.')
        .replace(/__ABBR_P__/g, '.')
        .replace(/__ETC_P__/g, '.')
        .replace(/__VV_P__/g, '.')
        .trim();
    };

    const cleanSentences: string[] = [];
    for (const match of sentenceMatches) {
      const sent = unprotect(match);
      if (sent.length > 0) {
        cleanSentences.push(sent);
      }
    }

    if (cleanSentences.length === 0) return [sanitized.slice(0, maxLen)];

    // Layer 3: Pack complete sentences into chunks
    const chunks: string[] = [];
    let currentChunk = '';
    let currentSentenceCount = 0;

    for (const sent of cleanSentences) {
      if (sent.length > maxLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          currentSentenceCount = 0;
        }

        const clauses = sent.split(/(?<=[,:–—;])\s+/);
        let clauseAcc = '';
        for (const cl of clauses) {
          const trimmedCl = cl.trim();
          if (!trimmedCl) continue;

          if ((clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl).length <= maxLen) {
            clauseAcc = clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl;
          } else {
            if (clauseAcc) chunks.push(clauseAcc);
            if (trimmedCl.length <= maxLen) {
              clauseAcc = trimmedCl;
            } else {
              const words = trimmedCl.split(/\s+/);
              let wordAcc = '';
              for (const w of words) {
                if ((wordAcc ? wordAcc + ' ' + w : w).length <= maxLen) {
                  wordAcc = wordAcc ? wordAcc + ' ' + w : w;
                } else {
                  if (wordAcc) chunks.push(wordAcc);
                  wordAcc = w;
                }
              }
              clauseAcc = wordAcc;
            }
          }
        }
        if (clauseAcc) chunks.push(clauseAcc);
        continue;
      }

      const prospectiveChunk = currentChunk ? currentChunk + ' ' + sent : sent;
      if (prospectiveChunk.length <= maxLen && currentSentenceCount + 1 <= maxNumSentences) {
        currentChunk = prospectiveChunk;
        currentSentenceCount += 1;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sent;
        currentSentenceCount = 1;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks.length > 0 ? chunks : [sanitized.slice(0, maxLen)];
  };

  const sanitizeTextForTikTok = (input: string): string => {
    if (!input) return '';
    let cleaned = input
      .replace(/<[^>]*>/g, '') // remove HTML tags
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // remove emojis
      .replace(/["“”'«»`]/g, ' ') // quotes cause abrupt speech termination
      .replace(/\.{2,}/g, ', ') // ellipses trigger premature end of stream
      .replace(/[—–]/g, ', ') // em dashes
      .replace(/&/g, ' và ')
      .replace(/\+/g, ' cộng ')
      .replace(/[{}\[\]()\/\\|*#@]/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s.,?!;:\-–—]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned.replace(/\s+([.,?!;:])/g, '$1');
    cleaned = cleaned.replace(/([.,?!;:_-])\1+/g, '$1');
    return cleaned.trim();
  };

  const splitTextForTikTok = (text: string, maxLen = 85, maxNumSentences = 2): string[] => {
    const sanitized = sanitizeTextForTikTok(text);
    if (!sanitized) return [];

    // Layer 2: Non-terminal punctuation protection
    let protectedText = sanitized
      .replace(/(\d)[.,](\d)/g, '$1__DECIMAL_P__$2')
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|ThS|TS|TP|Tp)\.(?=\s[A-ZÀ-Ỹa-zà-ỹ0-9])/gi, '$1__ABBR_P__')
      .replace(/\betc\.(?!\s[A-ZÀ-Ỹ])/gi, 'etc__ETC_P__')
      .replace(/\bv\.v\./gi, 'v__VV_P__v__VV_P__');

    // Layer 1: Extract complete sentences using ([^.?!\n]+(?:[.?!\n]+|$))
    const sentenceMatches = protectedText.match(/([^.?!\n]+(?:[.?!\n]+|$))/g) || [];

    const unprotect = (str: string): string => {
      return str
        .replace(/__DECIMAL_P__/g, '.')
        .replace(/__ABBR_P__/g, '.')
        .replace(/__ETC_P__/g, '.')
        .replace(/__VV_P__/g, '.')
        .trim();
    };

    const cleanSentences: string[] = [];
    for (const match of sentenceMatches) {
      const sent = unprotect(match);
      if (sent.length > 0) {
        cleanSentences.push(sent);
      }
    }

    if (cleanSentences.length === 0) return [sanitized.slice(0, maxLen)];

    // Layer 3: Pack whole sentences up to maxLen / maxNumSentences
    const chunks: string[] = [];
    let currentChunk = '';
    let currentSentenceCount = 0;

    for (const sent of cleanSentences) {
      if (sent.length > maxLen) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
          currentSentenceCount = 0;
        }

        const clauses = sent.split(/(?<=[,:;–—])\s+/);
        let clauseAcc = '';
        for (const cl of clauses) {
          const trimmedCl = cl.trim();
          if (!trimmedCl) continue;

          if ((clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl).length <= maxLen) {
            clauseAcc = clauseAcc ? clauseAcc + ' ' + trimmedCl : trimmedCl;
          } else {
            if (clauseAcc) chunks.push(clauseAcc);
            if (trimmedCl.length <= maxLen) {
              clauseAcc = trimmedCl;
            } else {
              const words = trimmedCl.split(/\s+/);
              let wordAcc = '';
              for (const w of words) {
                if ((wordAcc ? wordAcc + ' ' + w : w).length <= maxLen) {
                  wordAcc = wordAcc ? wordAcc + ' ' + w : w;
                } else {
                  if (wordAcc) chunks.push(wordAcc);
                  wordAcc = w;
                }
              }
              clauseAcc = wordAcc;
            }
          }
        }
        if (clauseAcc) chunks.push(clauseAcc);
        continue;
      }

      const prospectiveChunk = currentChunk ? currentChunk + ' ' + sent : sent;
      if (prospectiveChunk.length <= maxLen && currentSentenceCount + 1 <= maxNumSentences) {
        currentChunk = prospectiveChunk;
        currentSentenceCount += 1;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sent;
        currentSentenceCount = 1;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks.length > 0 ? chunks : [sanitized.slice(0, maxLen)];
  };

  const generateSherpaAudioSafe = (
    voiceKey: string,
    modelPath: string,
    tokensPath: string,
    dataDir: string,
    text: string,
    speed: number
  ): { buffer: Buffer; duration: number; timestamps: { word: string; start: number; end: number }[] } | null => {
    if (failedSherpaVoices.has(voiceKey)) return null;

    // Filter text and queue short sentences (<= 70 chars) to prevent WASM heap bloat
    const chunks = splitTextToShortSentences(text, 70);
    if (chunks.length === 0) return null;

    const samplesList: Float32Array[] = [];
    let sampleRate = 22050;

    let ttsEngine = getOrCreateTtsEngine(voiceKey, modelPath, tokensPath, dataDir);
    if (!ttsEngine) {
      failedSherpaVoices.add(voiceKey);
      return null;
    }

    const wordTimestamps: { word: string; start: number; end: number }[] = [];
    let currentAudioTime = 0;

    // Process sentence queue strictly one by one, immediately releasing chunk memory
    for (const chunk of chunks) {
      let res: any = null;
      try {
        if (ttsEngine) {
          res = (ttsEngine as any).generate({ text: chunk, speed });
        }
        if (res && res.samples && res.samples.length > 0) {
          // Immediately clone the PCM samples into standard JS heap Float32Array
          const clonedSamples = new Float32Array(res.samples);
          samplesList.push(clonedSamples);
          const chunkSampleRate = res.sampleRate || sampleRate;
          sampleRate = chunkSampleRate;

          const chunkDuration = clonedSamples.length / chunkSampleRate;
          const words = chunk.split(/\s+/).filter(Boolean);

          if (words.length > 0) {
            if (Array.isArray(res.timestamps) && res.timestamps.length === words.length) {
              for (const ts of res.timestamps) {
                wordTimestamps.push({
                  word: ts.word || ts.text || '',
                  start: Math.round((currentAudioTime + (ts.start || 0)) * 1000) / 1000,
                  end: Math.round((currentAudioTime + (ts.end || 0)) * 1000) / 1000,
                });
              }
            } else {
              const totalChars = words.reduce((acc, w) => acc + w.length, 0);
              let wordOffset = 0;
              for (const w of words) {
                const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                const wordDur = chunkDuration * wordWeight;
                wordTimestamps.push({
                  word: w,
                  start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                  end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                });
                wordOffset += wordDur;
              }
            }
          }

          currentAudioTime += chunkDuration;
        }
      } catch (wasmErr: any) {
        console.warn(`[Sherpa-ONNX WASM Memory Recovery] Resetting WASM engine instance for '${voiceKey}':`, wasmErr?.message || wasmErr);
        disposeTtsInstance(voiceKey);
        failedSherpaVoices.add(voiceKey);
        ttsEngine = getOrCreateTtsEngine(voiceKey, modelPath, tokensPath, dataDir);
        if (ttsEngine) {
          try {
            res = (ttsEngine as any).generate({ text: chunk, speed });
            if (res && res.samples && res.samples.length > 0) {
              const clonedSamples = new Float32Array(res.samples);
              samplesList.push(clonedSamples);
              const chunkSampleRate = res.sampleRate || sampleRate;
              sampleRate = chunkSampleRate;

              const chunkDuration = clonedSamples.length / chunkSampleRate;
              const words = chunk.split(/\s+/).filter(Boolean);

              if (words.length > 0) {
                const totalChars = words.reduce((acc, w) => acc + w.length, 0);
                let wordOffset = 0;
                for (const w of words) {
                  const wordWeight = totalChars > 0 ? w.length / totalChars : 1 / words.length;
                  const wordDur = chunkDuration * wordWeight;
                  wordTimestamps.push({
                    word: w,
                    start: Math.round((currentAudioTime + wordOffset) * 1000) / 1000,
                    end: Math.round((currentAudioTime + wordOffset + wordDur) * 1000) / 1000,
                  });
                  wordOffset += wordDur;
                }
              }

              currentAudioTime += chunkDuration;
            }
          } catch (retryErr) {
            console.warn('[Sherpa-ONNX WASM Retry failed, switching to fallback]', retryErr);
            failedSherpaVoices.add(voiceKey);
          }
        }
      } finally {
        // Clear result handle immediately after cloning samples to free sentence memory
        res = null;
      }
    }

    if (samplesList.length === 0) return null;

    // Concatenate all sentence audio buffers into a single WAV file
    const totalLength = samplesList.reduce((acc, cur) => acc + cur.length, 0);
    const mergedSamples = new Float32Array(totalLength);
    let offset = 0;
    for (const samples of samplesList) {
      mergedSamples.set(samples, offset);
      offset += samples.length;
    }

    const exactDuration = Math.round((totalLength / sampleRate) * 1000) / 1000;
    const wavBuffer = floatTo16BitPcmWav(mergedSamples, sampleRate);

    return {
      buffer: wavBuffer,
      duration: exactDuration,
      timestamps: wordTimestamps,
    };
  };

  const fetchGoogleTranslateTTS = async (txt: string): Promise<Buffer | null> => {
    try {
      const clean = txt.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s.,?!;:\-–—"'()]/gu, ' ').trim();
      if (!clean) return null;
      if (clean.length <= 180) {
        const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
          clean
        )}&tl=vi&client=tw-ob`;
        const gRes = await fetch(gUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });
        if (gRes.ok) {
          const buf = Buffer.from(await gRes.arrayBuffer());
          if (buf.length > 200) return buf;
        }
      } else {
        const words = clean.split(/\s+/);
        const chunks: string[] = [];
        let current = '';
        for (const w of words) {
          if ((current + ' ' + w).trim().length <= 160) {
            current = (current + ' ' + w).trim();
          } else {
            if (current) chunks.push(current);
            current = w;
          }
        }
        if (current) chunks.push(current);

        const buffers: Buffer[] = [];
        for (const chunk of chunks) {
          const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
            chunk
          )}&tl=vi&client=tw-ob`;
          const gRes = await fetch(gUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          });
          if (gRes.ok) {
            const b = Buffer.from(await gRes.arrayBuffer());
            if (b.length > 200) buffers.push(b);
          }
        }
        if (buffers.length > 0) return Buffer.concat(buffers);
      }
    } catch (e) {
      console.warn('[Google Translate TTS Fallback Exception]', e);
    }
    return null;
  };

  const fetchMsEdgeTTS = async (
    txt: string,
    voiceName: string = 'vi-VN-HoaiMyNeural',
    rate: number = 1.0
  ): Promise<Buffer | null> => {
    try {
      const clean = txt.replace(/<[^>]*>/g, '').trim();
      if (!clean) return null;

      // Smart voice selection according to character set
      let finalVoice = voiceName || 'vi-VN-HoaiMyNeural';
      const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(clean);
      if (isCjk && (!voiceName || voiceName.startsWith('vi-'))) {
        finalVoice = 'zh-CN-XiaoxiaoNeural';
      }

      const { MsEdgeTTS, OUTPUT_FORMAT } = customRequire('msedge-tts');
      const tts = new MsEdgeTTS();
      await tts.setMetadata(finalVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const ratePercent = Math.round((rate - 1.0) * 100);
      const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

      const { audioStream } = tts.toStream(clean, { rate: rateStr });
      return await new Promise<Buffer | null>((resolve) => {
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
          try { tts.close(); } catch {}
          if (chunks.length > 0) resolve(Buffer.concat(chunks));
          else resolve(null);
        }, 12000);

        audioStream.on('data', (c: Buffer) => chunks.push(c));
        audioStream.on('end', () => {
          clearTimeout(timer);
          try { tts.close(); } catch {}
          const buf = Buffer.concat(chunks);
          resolve(buf.length > 100 ? buf : null);
        });
        audioStream.on('error', (err: any) => {
          clearTimeout(timer);
          try { tts.close(); } catch {}
          console.warn('[MsEdgeTTS Stream Warning]', err?.message || err);
          resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
        });
      });
    } catch (err: any) {
      console.warn('[MsEdgeTTS Exception]', err?.message || err);
      return null;
    }
  };

  const sanitizeTextForTTS = (input: string): string => {
    if (!input) return '';
    let cleaned = input
      .replace(/<[^>]*>/g, '') // remove HTML tags
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // remove emojis
      .replace(/["“”'«»`]/g, ' ') // quotes cause abrupt speech termination
      .replace(/\.{2,}/g, ', ') // ellipses trigger premature end of stream / cutoffs
      .replace(/[—–]/g, ', ') // em dashes
      .replace(/&/g, ' và ')
      .replace(/\+/g, ' cộng ')
      .replace(/%/g, ' phần trăm ')
      .replace(/\$/g, ' đô la ')
      .replace(/€/g, ' ơ rô ')
      .replace(/@/g, ' a còng ')
      .replace(/#/g, ' số ')
      .replace(/[{}[\]()\/\\|*]/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Normalize spaces around punctuation and deduplicate repeated punctuation marks like ?? or !!
    cleaned = cleaned.replace(/\s+([.,?!;:])/g, '$1');
    cleaned = cleaned.replace(/([.,?!;:_-])\1+/g, '$1');

    // Fallback if cleaning stripped all characters
    if (!cleaned.trim()) {
      cleaned = input.replace(/<[^>]*>/g, '').replace(/[{}\[\]()\/\\|*#@$%]/g, ' ').trim();
    }

    return cleaned.trim();
  };

  const generateTTSAudioHelper = async (options: {
    text: string;
    targetDuration?: number;
    duration?: number;
    provider?: string;
    vieneuVoice?: string;
    nghiVoice?: string;
    edgeVoice?: string;
    tiktokSessionId?: string;
    tiktokVoice?: string;
    capcutVoice?: string;
    voice?: string;
    ttsSpeed?: number;
    apiMode?: string;
    apiKey?: string;
    proxyUrl?: string;
    proxyKey?: string;
    proxyTargetModel?: string;
    customModelName?: string;
    tiktokProxyUrl?: string;
    enableAudioSync?: boolean;
  }): Promise<{
    audioBase64: string | null;
    providerUsed: string;
    duration?: number;
    timestamps?: { word: string; start: number; end: number }[];
  }> => {
    const {
      text,
      targetDuration,
      duration,
      provider = 'capcut_tts',
      nghiVoice = 'lacphi',
      edgeVoice = 'vi-VN-HoaiMyNeural',
      tiktokSessionId = '',
      tiktokVoice = 'vi_001',
      capcutVoice = 'BV074_streaming',
      voice = 'Kore',
      ttsSpeed = 1.0,
      apiMode,
      apiKey,
      proxyUrl,
      proxyKey,
      proxyTargetModel,
      customModelName,
      tiktokProxyUrl = '',
      enableAudioSync = true,
    } = options;

    const cleanText = sanitizeTextForTTS(text);
    if (!cleanText) return { audioBase64: null, providerUsed: provider };

    const targetDur = Number(targetDuration || duration) || 0;
    let speed = Number(ttsSpeed) || 1.0;

    // 3-Layer Sync Defense - Layer 2: Pre-calculate CPS and adjust TTS voice speed before audio generation
    // BOUNDARY: NEVER slow down speech below user setting (min 0.95x) to eliminate robotic slow motion.
    // When text is tight (high CPS), allow mild speedup capped strictly at 1.25x.
    if (enableAudioSync && targetDur && targetDur > 0.3) {
      const cps = cleanText.length / targetDur;
      if (cps > 14.0) {
        const requiredSpeed = Math.min(1.22, Math.max(1.0, cps / 13.5));
        if (requiredSpeed >= 1.08) {
          speed = Math.min(1.25, Math.round(speed * requiredSpeed * 100) / 100);
        }
      }
      // Strictly bound speed: never drop below 0.95x (no dragging/slow motion), never exceed 1.25x (no chipmunk)
      speed = Math.max(0.95, Math.min(1.25, speed));
    }
    
    let voiceKeyForCache = voice;
    if (provider === 'capcut_tts') {
      const resolved = resolveCapCutVoice(capcutVoice || tiktokVoice || 'BV074_streaming');
      voiceKeyForCache = resolved.voiceType;
    } else if (provider === 'nghi_tts') {
      voiceKeyForCache = nghiVoice;
    } else if (provider === 'edge_tts') {
      voiceKeyForCache = edgeVoice;
    } else if (provider === 'tiktok_tts') {
      voiceKeyForCache = tiktokVoice;
    }
    
    const cacheKey = `${provider}:${voiceKeyForCache}:${speed}:${cleanText}`;

    const cachedItem = getCachedAudio(cacheKey);
    if (cachedItem) {
      return {
        audioBase64: cachedItem.audioBase64,
        duration: cachedItem.duration,
        timestamps: cachedItem.timestamps,
        providerUsed: `${provider}_cached`,
      };
    }

    let audioBuffer: Buffer | null = null;
    let base64Audio: string | null = null;
    let audioDuration: number | undefined = undefined;
    let audioTimestamps: { word: string; start: number; end: number }[] | undefined = undefined;
    let actualProvider = provider;

    // Option -1: VieNeu-TTS v3 Turbo (Offline AI Voice Engine)
    if (provider === 'vieneu_tts') {
      const vieneuVoiceName = (options as any).vieneuVoice || 'Minh Đức';
      const customVoices = loadCustomVoices();
      const customVoice = customVoices[vieneuVoiceName];
      const isCustomFemale = customVoice?.gender === 'female';
      const isMaleVieNeu = customVoice
        ? !isCustomFemale
        : ['Minh Đức', 'Mạnh Dũng', 'Phạm Tuyên', 'Thái Sơn', 'Xuân Vĩnh', 'Thanh Bình', 'Minh Triết', 'Quang Sơn', 'Đức Trí', 'Minh Quân', 'Anh Khôi', 'Adam'].includes(vieneuVoiceName);

      const VIENEU_FALLBACK_MAP: Record<string, { voice: string; isMale: boolean }> = {
        'Minh Đức': { voice: 'multi_male_felipe_uranus_bigtts', isMale: true },
        'Mai Anh': { voice: 'BV074_streaming', isMale: false },
        'Mạnh Dũng': { voice: 'multi_male_felipe_uranus_bigtts', isMale: true },
        'Phạm Tuyên': { voice: 'BV075_streaming', isMale: true },
        'Thái Sơn': { voice: 'multi_male_felipe_uranus_bigtts', isMale: true },
        'Xuân Vĩnh': { voice: 'BV075_streaming', isMale: true },
        'Thanh Bình': { voice: 'BV075_streaming', isMale: true },
        'Minh Triết': { voice: 'BV075_streaming', isMale: true },
        'Quang Sơn': { voice: 'BV075_streaming', isMale: true },
        'Đức Trí': { voice: 'BV075_streaming', isMale: true },
        'Minh Quân': { voice: 'BV075_streaming', isMale: true },
        'Anh Khôi': { voice: 'BV075_streaming', isMale: true },
        'Adam': { voice: 'en_male_adam_clone2', isMale: true },
        'Ngọc Huyền': { voice: 'multi_female_sisi_uranus_bigtts', isMale: false },
        'Trúc Ly': { voice: 'BV074_streaming', isMale: false },
        'Ngọc Linh': { voice: 'multi_female_yangguangnv_uranus_bigtts', isMale: false },
        'Đoan Trang': { voice: 'BV074_streaming', isMale: false },
        'Thục Đoan': { voice: 'BV074_streaming', isMale: false },
        'Thùy Dung': { voice: 'multi_female_quanweinv_uranus_bigtts', isMale: false },
        'Ngọc Trân': { voice: 'multi_female_kiwi_uranus_bigtts', isMale: false },
        'Mỹ Duyên': { voice: 'BV421_vivn_streaming', isMale: false },
        'Quỳnh Anh': { voice: 'multi_female_yangguangnv_uranus_bigtts', isMale: false },
        'Kim Thanh': { voice: 'BV074_streaming', isMale: false },
      };

      const mapped = VIENEU_FALLBACK_MAP[vieneuVoiceName] || { voice: isMaleVieNeu ? 'BV075_streaming' : 'BV074_streaming', isMale: isMaleVieNeu };

      try {
        const cRes = await generateCapCutTTS(cleanText, {
          voice: mapped.voice,
          rate: speed,
        });
        audioBuffer = cRes.audioBuffer;
        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
          audioDuration = cRes.durationMs > 0 ? cRes.durationMs / 1000 : getMp3BufferDuration(audioBuffer);
          actualProvider = `vieneu_tts (${vieneuVoiceName})`;
        }
      } catch (_vErr) {
        const mappedEdgeVoice = isMaleVieNeu ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural';
        audioBuffer = await fetchMsEdgeTTS(cleanText, mappedEdgeVoice, speed);
        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
          audioDuration = getMp3BufferDuration(audioBuffer);
          actualProvider = `vieneu_tts_edge (${vieneuVoiceName})`;
        }
      }
    }

    // Option 0: CapCut TTS (K07VN/capcut-tts-api - High quality official CapCut / ByteDance TTS engine)
    else if (provider === 'capcut_tts') {
      const selectedCapCutVoice = capcutVoice || tiktokVoice || 'BV074_streaming';
      try {
        const capcutRes = await generateCapCutTTS(cleanText, {
          voice: selectedCapCutVoice,
          rate: speed,
        });
        audioBuffer = capcutRes.audioBuffer;
        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
          audioDuration = capcutRes.durationMs > 0 ? capcutRes.durationMs / 1000 : getMp3BufferDuration(audioBuffer);
          actualProvider = `capcut_tts (${capcutRes.displayName || selectedCapCutVoice})`;
        }
      } catch (err: any) {
        console.warn(`[CapCutTTS] Voice "${selectedCapCutVoice}" failed, attempting automatic recovery:`, err?.message || err);
        
        // 1. First attempt internal CapCut recovery: Try flagship CapCut voice matching gender
        const isMale = selectedCapCutVoice.toLowerCase().includes('male') ||
          selectedCapCutVoice.toLowerCase().includes('nam') ||
          selectedCapCutVoice.toLowerCase().includes('thanh niên') ||
          selectedCapCutVoice.toLowerCase().includes('felipe') ||
          selectedCapCutVoice === 'BV075_streaming';
        const fallbackCapCutVoice = isMale ? 'BV075_streaming' : 'BV074_streaming';
        
        if (selectedCapCutVoice !== fallbackCapCutVoice) {
          try {
            console.log(`[CapCutTTS] Attempting internal CapCut retry with flagship voice "${fallbackCapCutVoice}"...`);
            const retryRes = await generateCapCutTTS(cleanText, {
              voice: fallbackCapCutVoice,
              rate: speed,
            });
            if (retryRes.audioBuffer && retryRes.audioBuffer.length > 200) {
              audioBuffer = retryRes.audioBuffer;
              base64Audio = audioBuffer.toString('base64');
              audioDuration = retryRes.durationMs > 0 ? retryRes.durationMs / 1000 : getMp3BufferDuration(audioBuffer);
              actualProvider = `capcut_tts (${retryRes.displayName || fallbackCapCutVoice})`;
            }
          } catch (retryErr: any) {
            console.warn('[CapCutTTS] Flagship voice retry also failed:', retryErr?.message || retryErr);
          }
        }
        
        // 2. If CapCut service is completely unreachable, fall back to Neural Edge TTS matching gender
        if (!audioBuffer || audioBuffer.length < 200) {
          console.warn('[CapCutTTS] Switching to Neural Edge TTS fallback...');
          const mappedEdgeVoice = isMale ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural';
          audioBuffer = await fetchMsEdgeTTS(cleanText, mappedEdgeVoice, speed);
          if (audioBuffer && audioBuffer.length > 200) {
            base64Audio = audioBuffer.toString('base64');
            audioDuration = getMp3BufferDuration(audioBuffer);
            actualProvider = isMale ? 'capcut_tts_fallback_edge (Nam Minh)' : 'capcut_tts_fallback_edge (Hoài Mỹ)';
          }
        }
      }
    }

    // Option A: Piper TTS / Nghi TTS (High-Fidelity Neural Profile Synthesis)
    else if (provider === 'nghi_tts') {
      const isFemaleNghi = ['banmai', 'calmwoman3688', 'maiphuong', 'minhthu', 'mytam2', 'mytam2794', 'ngochuyen', 'ngochuyennew', 'phuongtrang', 'thanhphuong2', 'yannew'].includes(nghiVoice);
      const mappedEdgeVoice = isFemaleNghi ? 'vi-VN-HoaiMyNeural' : 'vi-VN-NamMinhNeural';

      const NGHI_VOICE_CAPCUT_MAP: Record<string, { voice: string; isFemale: boolean; name: string }> = {
        ngochuyennew: { voice: 'multi_female_richgirl_uranus_bigtts', isFemale: true, name: 'Ngọc Huyền (Review)' },
        ngochuyen: { voice: 'BV074_streaming', isFemale: true, name: 'Ngọc Huyền (Bản gốc)' },
        maiphuong: { voice: 'BV562_streaming', isFemale: true, name: 'Mai Phương' },
        banmai: { voice: 'multi_female_yangguangnv_uranus_bigtts', isFemale: true, name: 'Ban Mai' },
        minhthu: { voice: 'multi_female_tianmeijieshuo_uranus_bigtts', isFemale: true, name: 'Minh Thu' },
        mytam2: { voice: 'vi_female_huong', isFemale: true, name: 'Mỹ Tâm 2' },
        mytam2794: { voice: 'vi_female_huong', isFemale: true, name: 'Mỹ Tâm' },
        phuongtrang: { voice: 'multi_female_sisi_uranus_bigtts', isFemale: true, name: 'Phương Trang' },
        thanhphuong2: { voice: 'multi_female_xinwenjieshuo_uranus_bigtts', isFemale: true, name: 'Thanh Phương' },
        calmwoman3688: { voice: 'multi_female_daqi_uranus_bigtts', isFemale: true, name: 'Calm Woman' },
        yannew: { voice: 'multi_female_peiqi_uranus_bigtts', isFemale: true, name: 'Yan New' },
        lacphi: { voice: 'BV075_streaming', isFemale: false, name: 'Lạc Phi' },
        duyoryx: { voice: 'multi_male_felipe_uranus_bigtts', isFemale: false, name: 'Duy Oryx' },
        ngocngan: { voice: 'multi_male_felipe_uranus_bigtts', isFemale: false, name: 'Nguyễn Ngọc Ngạn' },
        vietthao3886: { voice: 'BV075_streaming', isFemale: false, name: 'Việt Thảo' },
        tranthanh3870: { voice: 'BV075_streaming_vibrato_dsp', isFemale: false, name: 'Trấn Thành' },
        minhquang: { voice: 'multi_male_felipe_uranus_bigtts', isFemale: false, name: 'Minh Quang' },
        hailam: { voice: 'BV560_streaming', isFemale: false, name: 'Hải Lâm' },
        hoaiduc: { voice: 'multi_male_felipe_uranus_bigtts', isFemale: false, name: 'Hoài Đức' },
      };

      const mappedConfig = NGHI_VOICE_CAPCUT_MAP[nghiVoice] || { voice: isFemaleNghi ? 'BV074_streaming' : 'BV075_streaming', isFemale: isFemaleNghi, name: nghiVoice };

      try {
        const cRes = await generateCapCutTTS(cleanText, {
          voice: mappedConfig.voice,
          rate: speed,
        });
        audioBuffer = cRes.audioBuffer;
        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
          audioDuration = cRes.durationMs > 0 ? cRes.durationMs / 1000 : getMp3BufferDuration(audioBuffer);
          actualProvider = `nghi_tts (${mappedConfig.name})`;
        }
      } catch (_capcutErr) {
        // Fallback to Edge Neural TTS
        audioBuffer = await fetchMsEdgeTTS(cleanText, mappedEdgeVoice, speed);
        if (!audioBuffer || audioBuffer.length < 200) {
          audioBuffer = await fetchGoogleTranslateTTS(cleanText);
        }
        if (audioBuffer && audioBuffer.length > 200) {
          base64Audio = audioBuffer.toString('base64');
          audioDuration = getMp3BufferDuration(audioBuffer);
          actualProvider = `nghi_tts_neural (${mappedConfig.name})`;
        }
      }
    }

    // Option B: Edge TTS
    else if (provider === 'edge_tts') {
      audioBuffer = await fetchMsEdgeTTS(cleanText, edgeVoice, ttsSpeed);

      if (!audioBuffer || audioBuffer.length < 200) {
        audioBuffer = await fetchGoogleTranslateTTS(cleanText);
      }

      if (audioBuffer && audioBuffer.length > 200) {
        base64Audio = audioBuffer.toString('base64');
        audioDuration = getMp3BufferDuration(audioBuffer);
      } else {
        throw new Error('Không thể tạo giọng đọc Edge TTS. Vui lòng thử lại hoặc chọn giọng đọc khác.');
      }
    }

    // Option C: TikTok TTS
    else if (provider === 'tiktok_tts') {
      const chunks = splitTextForTikTok(cleanText, 85);
      const buffers: Buffer[] = [];

      // Determine proxy to use
      let proxyToUse = tiktokProxyUrl || process.env.TIKTOK_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
      
      if (proxyToUse.trim().toLowerCase() === 'proxifly') {
        const now = Date.now();
        if (cachedProxiflyProxy && (now - lastProxiflyFetchTime < 15 * 60 * 1000)) {
          proxyToUse = cachedProxiflyProxy;
          console.log(`[TikTok-TTS] [Proxifly] Using cached proxy: ${proxyToUse}`);
        } else {
          try {
            const Proxifly = customRequire('proxifly');
            const proxifly = new Proxifly();
            const pResult = await proxifly.getProxy({
              protocol: 'http',
              https: true,
              quantity: 1,
            });
            if (pResult && pResult.proxy) {
              proxyToUse = pResult.proxy;
              cachedProxiflyProxy = proxyToUse;
              lastProxiflyFetchTime = now;
              console.log(`[TikTok-TTS] [Proxifly] Auto resolved and cached to: ${proxyToUse}`);
            } else if (Array.isArray(pResult) && pResult.length > 0 && pResult[0].proxy) {
              proxyToUse = pResult[0].proxy;
              cachedProxiflyProxy = proxyToUse;
              lastProxiflyFetchTime = now;
              console.log(`[TikTok-TTS] [Proxifly] Auto resolved and cached to (array): ${proxyToUse}`);
            } else {
              console.warn(`[TikTok-TTS] [Proxifly] No proxy returned, falling back to direct connection or cached proxy if any.`);
              proxyToUse = cachedProxiflyProxy || '';
            }
          } catch (pxErr: any) {
            console.error(`[TikTok-TTS] [Proxifly] Error fetching proxy:`, pxErr?.message || pxErr);
            proxyToUse = cachedProxiflyProxy || '';
          }
        }
      }

      let agent: any = null;
      if (proxyToUse && proxyToUse.trim()) {
        try {
          agent = new HttpsProxyAgent(proxyToUse.trim());
          console.log(`[TikTok-TTS] Instantiated HttpsProxyAgent for: ${proxyToUse.trim()}`);
        } catch (proxyErr: any) {
          console.error(`[TikTok-TTS] Failed to create HttpsProxyAgent:`, proxyErr?.message || proxyErr);
        }
      }
      
      let directEndpointsFailed = false;

      const isValidTikTokAudio = (buf: Buffer | null, text: string): { valid: boolean; duration: number; reason?: string } => {
        if (!buf || buf.length < 200) {
          return { valid: false, duration: 0, reason: 'Buffer null or too small (<200B)' };
        }
        const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
        const wordCount = isCjk ? Math.max(1, text.trim().length) : Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);

        // 1. Min byte check
        const minBytes = isCjk ? Math.max(250, Math.floor(wordCount * 30)) : Math.max(250, Math.floor(text.length * 25));
        if (buf.length < minBytes) {
          return { valid: false, duration: 0, reason: `Byte size too low (${buf.length}B < min ${minBytes}B)` };
        }

        // 2. Real MP3 Duration validation
        const duration = getMp3BufferDuration(buf);
        const minRequiredDuration = Math.max(0.1, Math.min(10.0, wordCount * 0.08));

        if (duration < minRequiredDuration) {
          return {
            valid: false,
            duration,
            reason: `Truncated audio duration (${duration.toFixed(2)}s < expected min ${minRequiredDuration.toFixed(2)}s for ${wordCount} units)`,
          };
        }

        return { valid: true, duration };
      };

      const fetchSingleTikTokChunk = async (chunkText: string): Promise<Buffer | null> => {
        // 0. Check Per-Chunk Cache first
        const chunkCacheKey = `tiktok_chunk:${tiktokVoice}:${chunkText.trim()}`;
        const cachedChunk = getCachedAudio(chunkCacheKey);
        if (cachedChunk && cachedChunk.audioBase64) {
          const cachedBuf = Buffer.from(cachedChunk.audioBase64, 'base64');
          const val = isValidTikTokAudio(cachedBuf, chunkText);
          if (val.valid) {
            console.log(`[TikTok TTS Chunk Cache Hit] "${chunkText.slice(0, 30)}..." (${cachedBuf.length} bytes, ${val.duration}s)`);
            return cachedBuf;
          } else {
            console.warn(`[TikTok TTS Chunk Cache Invalidation] Discarded truncated cache for "${chunkText.slice(0, 30)}...": ${val.reason}`);
          }
        }

        const sessId = tiktokSessionId || process.env.TIKTOK_SESSION_ID || '';
        let attempt = 1;

        while (attempt <= 2) {
          let chunkAudioBuf: Buffer | null = null;

          // 1. Try direct TikTok endpoints if sessId is provided
          if (sessId && !directEndpointsFailed) {
            const minInterval = 12000;
            const now = Date.now();
            const timeSinceLast = now - lastTikTokRequestTime;
            if (timeSinceLast < minInterval) {
              const delay = minInterval - timeSinceLast;
              console.log(`[TikTok TTS Safe Spacing] Waiting ${delay}ms to guarantee safe rate limit for official session...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            lastTikTokRequestTime = Date.now();

            const randomId = () => Math.floor(1000000000000000000 + Math.random() * 8000000000000000000).toString();
            const deviceId = randomId();
            const installId = randomId();

            const directDomains = [
              'api16-v.tiktokv.com',
              'api16-normal-v4.tiktokv.com',
              'api22-normal-v4.tiktokv.com',
              'api16-normal-c-useast1a.tiktokv.com',
              'api22-normal-c-useast1a.tiktokv.com',
              'api16-normal-c-alisg.tiktokv.com',
              'api22-core-c-alisg.tiktokv.com',
              'api16-core-c-alisg.tiktokv.com',
              'api16-normal-v6.tiktokv.com',
              'api19-core-c-useast1a.tiktokv.com',
              'api-normal.tiktokv.com',
              'api.tiktokv.com'
            ];

            const axiosLib = axios;
            const abortController = new AbortController();

            const fetchFromDirectDomain = async (domain: string): Promise<Buffer> => {
              const ttUrl = `https://${domain}/media/api/text/speech/invoke/?device_id=${deviceId}&iid=${installId}&device_platform=android&device_type=SAMSUNG&os_version=10&version_code=20.2.1&app_name=musical_ly&aid=1180&status_code=0&speaker_map_type=0`;
              
              const reqBodyParams = new URLSearchParams({
                text_speaker: tiktokVoice,
                req_text: chunkText,
                speaker_map_type: '0',
              });

              try {
                const ttRes = await axiosLib.post(ttUrl, reqBodyParams.toString(), {
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': `sessionid=${sessId.trim()};`,
                    'User-Agent': 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 10; es_US; SAMSUNG; Build/QP1A.190711.020)',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                  },
                  timeout: 3000,
                  httpsAgent: agent,
                  httpAgent: agent,
                  proxy: false,
                  signal: abortController.signal,
                });

                const ttJson = ttRes.data;
                if (ttJson?.data?.v_str) {
                  const directBuf = Buffer.from(ttJson.data.v_str, 'base64');
                  const check = isValidTikTokAudio(directBuf, chunkText);
                  if (check.valid) {
                    abortController.abort();
                    return directBuf;
                  } else {
                    throw new Error(`Direct audio rejected: ${check.reason}`);
                  }
                }
                
                const sc = Number(ttJson?.status_code);
                if (sc === 2 || sc === 4 || sc === 5) {
                  const errMsg = `Session ID TikTok không hợp lệ hoặc hết hạn (status_code: ${sc}).`;
                  console.error(`[TikTok TTS Direct Auth Failure] ${errMsg}`);
                  const authErr = new Error(errMsg);
                  (authErr as any).isAuthError = true;
                  abortController.abort();
                  throw authErr;
                }
                
                throw new Error(ttJson?.message || `Host ${domain} returned status_code ${ttJson?.status_code}`);
              } catch (e: any) {
                if (axiosLib.isCancel(e) || e.name === 'AbortError') {
                  throw new Error('Request cancelled');
                }
                throw e;
              }
            };

            try {
              chunkAudioBuf = await Promise.any(directDomains.map(domain => fetchFromDirectDomain(domain)));
              console.log(`[TikTok TTS Direct] Success for chunk: "${chunkText.slice(0, 30)}..." via direct domains on attempt ${attempt}`);
            } catch (aggregateErr: any) {
              const errors = aggregateErr.errors || [];
              const authErr = errors.find((e: any) => e.isAuthError);
              if (authErr) {
                directEndpointsFailed = true;
              }
            }
          }

          // 2. Try library if direct failed but sessId is provided
          const activeTtsLib = getTiktokTts();
          if (!chunkAudioBuf && activeTtsLib && sessId) {
            try {
              activeTtsLib.config(sessId.trim());
              const tempFileBase = path.join(os.tmpdir(), `tiktok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
              const tempFilePath = `${tempFileBase}.mp3`;

              const axiosLib = axios;
              const prevHttpsAgent = axiosLib.defaults.httpsAgent;
              const prevHttpAgent = axiosLib.defaults.httpAgent;
              const prevProxy = axiosLib.defaults.proxy;

              if (agent) {
                axiosLib.defaults.httpsAgent = agent;
                axiosLib.defaults.httpAgent = agent;
                axiosLib.defaults.proxy = false;
              }

              try {
                await activeTtsLib.createAudioFromText(chunkText, tempFileBase, tiktokVoice);
              } finally {
                axiosLib.defaults.httpsAgent = prevHttpsAgent;
                axiosLib.defaults.httpAgent = prevHttpAgent;
                axiosLib.defaults.proxy = prevProxy;
              }

              if (fs.existsSync(tempFilePath)) {
                const libBuf = fs.readFileSync(tempFilePath);
                try { fs.unlinkSync(tempFilePath); } catch {}
                const check = isValidTikTokAudio(libBuf, chunkText);
                if (check.valid) {
                  chunkAudioBuf = libBuf;
                  console.log(`[TikTok TTS Library] Success for chunk: "${chunkText.slice(0, 30)}..." on attempt ${attempt}`);
                }
              }
            } catch (e: any) {
              console.warn(`[TikTok TTS Library Warning] (attempt ${attempt}):`, e?.message || e);
            }
          }

          // 3. Try public gateways if direct/library failed
          if (!chunkAudioBuf) {
            const publicGateways = [
              { url: 'https://tiktok-tts.weilnet.workers.dev/api/generation', isJson: true, bodyKey: 'text', voiceKey: 'voice' },
              { url: 'https://tiktok-tts.ondigitalocean.app/api/tts', isJson: true, bodyKey: 'text', voiceKey: 'voice' },
              { url: 'https://tiktok-tts.ondigitalocean.app/api/generation', isJson: true, bodyKey: 'text', voiceKey: 'voice' }
            ];

            const axiosLib = axios;
            try {
              const fetchFromGateway = async (gw: { url: string; isJson: boolean; bodyKey: string; voiceKey: string }): Promise<Buffer> => {
                const payload: any = {};
                payload[gw.bodyKey] = chunkText;
                payload[gw.voiceKey] = tiktokVoice;

                const gwRes = await axiosLib.post(gw.url, payload, {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 1500,
                  httpsAgent: agent,
                  httpAgent: agent,
                  proxy: false,
                });

                const gwJson = gwRes.data;
                let buf: Buffer | null = null;
                if (gwJson?.audio) {
                  buf = Buffer.from(gwJson.audio, 'base64');
                } else if (gwJson?.success && gwJson?.data) {
                  buf = Buffer.from(gwJson.data, 'base64');
                } else if (gwJson?.data) {
                  buf = Buffer.from(gwJson.data, 'base64');
                }

                const check = isValidTikTokAudio(buf, chunkText);
                if (check.valid) {
                  return buf!;
                }
                throw new Error(`Audio rejected from ${gw.url}`);
              };

              chunkAudioBuf = await Promise.any(publicGateways.map(gw => fetchFromGateway(gw)));
            } catch (parallelErr: any) {
              // Public gateways failed
            }
          }

          const finalCheck = isValidTikTokAudio(chunkAudioBuf, chunkText);
          if (chunkAudioBuf && finalCheck.valid) {
            setCachedAudio(chunkCacheKey, {
              audioBase64: chunkAudioBuf.toString('base64'),
              duration: finalCheck.duration,
            });
            return chunkAudioBuf;
          }

          // If no sessionId, don't waste time on retrying dead gateways - fall through immediately to Neural Edge TTS
          if (!sessId) {
            break;
          }

          attempt++;
          if (attempt <= 2) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        // 4. Guaranteed Seamless Fallback 1: Try official CapCut/TikTok Cloud API (K07VN/capcut-tts-api)
        try {
          const capcutRes = await generateCapCutTTS(chunkText, {
            voice: tiktokVoice || 'BV074_streaming',
            rate: ttsSpeed,
          });
          if (capcutRes.audioBuffer && capcutRes.audioBuffer.length > 200) {
            setCachedAudio(chunkCacheKey, {
              audioBase64: capcutRes.audioBuffer.toString('base64'),
              duration: (capcutRes.durationMs > 0 ? capcutRes.durationMs / 1000 : getMp3BufferDuration(capcutRes.audioBuffer)),
            });
            return capcutRes.audioBuffer;
          }
        } catch (capcutErr) {
          console.warn('[TikTok TTS Fallback] CapCut API attempt failed, trying Neural Edge TTS...', capcutErr);
        }

        // Guaranteed Seamless Fallback 2: Synthesize via MsEdgeTTS
        console.log(`[TikTok TTS Fallback] Auto-synthesizing chunk with Neural Edge TTS: "${chunkText.slice(0, 30)}..."`);
        const isFemale = tiktokVoice.includes('BV074') || tiktokVoice.includes('female') || tiktokVoice === 'vi_001';
        const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(chunkText);
        const fallbackVoice = isCjk
          ? (isFemale ? 'zh-CN-XiaoxiaoNeural' : 'zh-CN-YunxiNeural')
          : (isFemale ? 'vi-VN-HoaiMyNeural' : 'vi-VN-NamMinhNeural');
        
        const edgeFallbackBuf = await fetchMsEdgeTTS(chunkText, fallbackVoice, ttsSpeed);
        if (edgeFallbackBuf && edgeFallbackBuf.length > 200) {
          const check = isValidTikTokAudio(edgeFallbackBuf, chunkText);
          setCachedAudio(chunkCacheKey, {
            audioBase64: edgeFallbackBuf.toString('base64'),
            duration: check.duration || getMp3BufferDuration(edgeFallbackBuf),
          });
          return edgeFallbackBuf;
        }

        // Final fallback: Google Translate TTS
        const gBuf = await fetchGoogleTranslateTTS(chunkText);
        if (gBuf && gBuf.length > 200) {
          return gBuf;
        }

        return null;
      };

      // Process chunks sequentially to preserve order and respect rate limits
      for (let idx = 0; idx < chunks.length; idx++) {
        const chunk = chunks[idx];
        const chunkBuf = await fetchSingleTikTokChunk(chunk);
        if (chunkBuf) {
          buffers.push(chunkBuf);
        } else {
          console.warn(`[TikTok TTS Warning] Skipping empty chunk (${idx + 1}/${chunks.length}): "${chunk.slice(0, 30)}..."`);
        }
      }

      if (buffers.length > 0) {
        audioBuffer = concatMp3Buffers(buffers, 120);
        base64Audio = audioBuffer.toString('base64');
        audioDuration = getMp3BufferDuration(audioBuffer);
      } else {
        throw new Error('Không thể tạo giọng đọc TTS cho đoạn văn bản này. Vui lòng thử lại.');
      }
    }

    // Option D: Gemini
    else if (provider === 'gemini') {
      try {
        const { ai, selectedModel } = getAiClientAndModel({
          apiMode,
          apiKey,
          proxyUrl,
          proxyKey,
          proxyTargetModel,
          model: 'gemini-2.5-flash',
          customModelName,
        });
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: [{ parts: [{ text: cleanText }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
              },
            },
          },
        });
        const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64) base64Audio = b64;
      } catch (geminiErr) {
        console.warn('[Gemini TTS Exception]', geminiErr);
      }
      if (!base64Audio) {
        throw new Error('Không thể tạo giọng đọc Gemini TTS. Vui lòng thử lại.');
      }
    }

    // Global Catch-all Fallback (Guarantees every requested voice delivers real speech)
    if (!base64Audio) {
      actualProvider = 'global_fallback';
      const edgeBuf = await fetchMsEdgeTTS(cleanText, 'vi-VN-NamMinhNeural', speed);
      if (edgeBuf && edgeBuf.length > 200) {
        base64Audio = edgeBuf.toString('base64');
        audioBuffer = edgeBuf;
        audioDuration = getMp3BufferDuration(edgeBuf);
      } else {
        const fallbackBuf = await fetchGoogleTranslateTTS(cleanText);
        if (fallbackBuf && fallbackBuf.length > 200) {
          base64Audio = fallbackBuf.toString('base64');
          audioBuffer = fallbackBuf;
          audioDuration = getMp3BufferDuration(fallbackBuf);
        }
      }
    }

    // 3-Layer Sync Defense - Layer 3: Post-processing duration alignment
    if (enableAudioSync && base64Audio && targetDur && targetDur > 0.3) {
      if (!audioBuffer) {
        audioBuffer = Buffer.from(base64Audio, 'base64');
      }
      if (audioDuration === undefined || audioDuration <= 0) {
        audioDuration = getMp3BufferDuration(audioBuffer);
      }

      // Only compress audio duration if audio duration exceeds block target duration by > 80ms.
      // If audio is shorter than target duration, DO NOT stretch slower! It already fits without distortion.
      if (audioDuration > targetDur + 0.08) {
        const stretchRes = await stretchAudioWithAtempo(audioBuffer, audioDuration, targetDur);
        audioBuffer = stretchRes.buffer;
        audioDuration = stretchRes.duration;
        base64Audio = audioBuffer.toString('base64');
      }

      // If after stretching there is still a small remaining gap (< targetDur), pad remaining gap with silence
      if (audioDuration < targetDur - 0.05) {
        const diffMs = Math.round((targetDur - audioDuration) * 1000);
        console.log(`[Audio Sync] Chèn thêm khoảng lặng bù ở cuối (${(targetDur - audioDuration).toFixed(2)}s)`);
        const silenceBuf = createMp3SilenceBuffer(diffMs);
        audioBuffer = Buffer.concat([audioBuffer, silenceBuf]);
        audioDuration = targetDur;
        base64Audio = audioBuffer.toString('base64');
      }
    }

    if (base64Audio && !actualProvider.includes('fallback')) {
      setCachedAudio(cacheKey, {
        audioBase64: base64Audio,
        duration: audioDuration,
        timestamps: audioTimestamps,
      });
    }

    return {
      audioBase64: base64Audio,
      providerUsed: actualProvider,
      duration: audioDuration,
      timestamps: audioTimestamps,
    };
  };

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, targetDuration, duration } = req.body;
      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ success: false, error: 'Văn bản trống hoặc không hợp lệ' });
        return;
      }

      const result = await generateTTSAudioHelper({
        text,
        targetDuration: targetDuration || duration,
        provider: req.body.provider,
        vieneuVoice: req.body.vieneuVoice,
        capcutVoice: req.body.capcutVoice,
        nghiVoice: req.body.nghiVoice,
        edgeVoice: req.body.edgeVoice,
        tiktokSessionId: req.body.tiktokSessionId,
        tiktokVoice: req.body.tiktokVoice,
        voice: req.body.voice,
        ttsSpeed: req.body.ttsSpeed,
        enableAudioSync: req.body.enableAudioSync !== false,
        apiMode: req.body.apiMode,
        apiKey: req.body.apiKey,
        proxyUrl: req.body.proxyUrl,
        proxyKey: req.body.proxyKey,
        proxyTargetModel: req.body.proxyTargetModel,
        customModelName: req.body.customModelName,
        tiktokProxyUrl: req.body.tiktokProxyUrl,
      });

      if (result.audioBase64) {
        res.json({
          success: true,
          provider: result.providerUsed,
          audioBase64: result.audioBase64,
          duration: result.duration,
          timestamps: result.timestamps,
        });
      } else {
        const fallbackBuf = await fetchGoogleTranslateTTS(text);
        if (fallbackBuf && fallbackBuf.length > 200) {
          res.json({
            success: true,
            provider: 'global_fallback',
            audioBase64: fallbackBuf.toString('base64'),
            duration: getMp3BufferDuration(fallbackBuf),
          });
        } else {
          res.status(500).json({ success: false, error: 'Không thể tạo âm thanh TTS' });
        }
      }
    } catch (err: any) {
      console.error('Error in /api/tts:', err);
      res.status(500).json({ success: false, error: err.message || 'TTS generation failed' });
    }
  });

  // Clear TTS Audio Disk Cache
  app.post('/api/tts/clear-cache', (req, res) => {
    try {
      const cacheDir = path.join(process.cwd(), '.cache', 'tts');
      let count = 0;
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(cacheDir, file));
            count++;
          } catch {}
        }
      }
      console.log(`[TTS Cache] Đã xóa ${count} tệp cache âm thanh.`);
      res.json({ success: true, deletedCount: count, message: 'Đã xóa toàn bộ cache audio TTS thành công' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Lỗi khi xóa cache' });
    }
  });

  // Multer configuration for CapCut Speech-to-Text (STT) audio/video uploads
  const sttUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'capcut_stt_uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname || '').toLowerCase() || '.mp4';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'stt-' + uniqueSuffix + rawExt);
      },
    }),
    limits: {
      fileSize: 500 * 1024 * 1024, // 500MB
    },
  });

  // Chunked upload handler for large video files to completely bypass HTTP 413
  app.post('/api/capcut-stt-chunk', sttUpload.single('chunk'), async (req, res) => {
    try {
      const { uploadId, chunkIndex, totalChunks, filename } = req.body || {};
      if (!uploadId || chunkIndex === undefined || !totalChunks || !req.file) {
        res.status(400).json({ success: false, error: 'Thiếu thông tin phân đoạn upload' });
        return;
      }
      const cleanUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '');
      const chunkDir = path.join(os.tmpdir(), 'capcut_stt_chunks', cleanUploadId);
      fs.mkdirSync(chunkDir, { recursive: true });
      const targetChunkPath = path.join(chunkDir, `part_${String(chunkIndex).padStart(5, '0')}`);
      fs.renameSync(req.file.path, targetChunkPath);

      const cIdx = parseInt(chunkIndex, 10);
      const tChunks = parseInt(totalChunks, 10);

      if (cIdx === tChunks - 1) {
        // Final chunk received - merge all parts into single temporary video file
        const mergedExt = path.extname(filename || 'video.mp4') || '.mp4';
        const mergedFilePath = path.join(os.tmpdir(), `merged_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${mergedExt}`);
        const writeStream = fs.createWriteStream(mergedFilePath);

        for (let i = 0; i < tChunks; i++) {
          const partPath = path.join(chunkDir, `part_${String(i).padStart(5, '0')}`);
          if (!fs.existsSync(partPath)) {
            throw new Error(`Thiếu phân đoạn ${i} trong quá trình ghép file video`);
          }
          const partBuf = fs.readFileSync(partPath);
          writeStream.write(partBuf);
        }
        writeStream.end();
        await new Promise<void>((resolve) => {
          writeStream.on('finish', () => resolve());
        });

        // Clean up chunk files
        try {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        } catch {}

        res.json({
          success: true,
          completed: true,
          tempFilePath: mergedFilePath,
        });
        return;
      }

      res.json({ success: true, completed: false, chunkIndex: cIdx });
    } catch (err: any) {
      console.error('[CapCut STT Chunk Error]', err);
      res.status(500).json({ success: false, error: err?.message || 'Lỗi xử lý phân đoạn video' });
    }
  });

  // Speech-to-Text (Groq AI Whisper STT / ASR) endpoint with auto-translation
  const handleSttTranscription = async (req: express.Request, res: express.Response) => {
    let tempFilePath: string | null = null;
    try {
      const file = req.file;
      const body = req.body || {};
      const language = body.language || 'zh-CN';
      const autoTranslateToVietnamese = body.autoTranslateToVietnamese === 'true' || body.autoTranslateToVietnamese === true;
      const startTimeSeconds = Math.max(0, Number(body.startTimeSeconds) || 0);
      const endTimeSeconds = Number(body.endTimeSeconds) || 0;
      const durationSeconds = endTimeSeconds > startTimeSeconds ? (endTimeSeconds - startTimeSeconds) : undefined;
      const clientPreSliced = body.clientPreSliced === 'true' || body.clientPreSliced === true;

      let audioBuffer: Buffer | null = null;
      let finalDurationMs = 0;

      if (body.serverTempFilePath && typeof body.serverTempFilePath === 'string' && fs.existsSync(body.serverTempFilePath)) {
        const safeTempPath = body.serverTempFilePath;
        tempFilePath = safeTempPath;
        const extracted = await extractAudioFromVideo(safeTempPath, startTimeSeconds, durationSeconds);
        audioBuffer = extracted.audioBuffer;
        finalDurationMs = extracted.durationMs;
      } else if (file) {
        tempFilePath = file.path;
        const ext = path.extname(file.originalname || file.path).toLowerCase();
        const isAudioOnly = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'].includes(ext);

        if (clientPreSliced) {
          audioBuffer = fs.readFileSync(file.path);
          finalDurationMs = 0;
        } else if (isAudioOnly && startTimeSeconds === 0 && !durationSeconds) {
          audioBuffer = fs.readFileSync(file.path);
          finalDurationMs = 0;
        } else {
          const extracted = await extractAudioFromVideo(file.path, startTimeSeconds, durationSeconds);
          audioBuffer = extracted.audioBuffer;
          finalDurationMs = extracted.durationMs;
        }
      } else if (body.audioBase64) {
        const cleanB64 = body.audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '').replace(/^data:video\/[a-z0-9]+;base64,/, '');
        const tempBuf = Buffer.from(cleanB64, 'base64');
        const tmpInput = path.join(os.tmpdir(), `stt_b64_${Date.now()}.tmp`);
        fs.writeFileSync(tmpInput, tempBuf);
        tempFilePath = tmpInput;
        const extracted = await extractAudioFromVideo(tmpInput, startTimeSeconds, durationSeconds);
        audioBuffer = extracted.audioBuffer;
        finalDurationMs = extracted.durationMs;
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        res.status(400).json({ success: false, error: 'Không tìm thấy dữ liệu âm thanh hoặc tệp video hợp lệ để nhận diện' });
        return;
      }

      const groqApiKey = body.groqApiKey || body.apiKey || process.env.GROQ_API_KEY;
      const groqSttModel = body.groqSttModel || body.model || 'whisper-large-v3';

      console.log(`[STT Route] Transcribing with Groq AI Whisper (${groqSttModel}), ${audioBuffer.length} bytes audio, language: ${language}, autoTranslate: ${autoTranslateToVietnamese}`);

      const sttResult = await transcribeWithGroq(audioBuffer, {
        apiKey: groqApiKey,
        model: groqSttModel,
        language,
        autoTranslateToVietnamese,
      });

      // Shift subtitles by startTimeSeconds offset if non-zero
      let subtitles = (sttResult.subtitles || []).map((s) => ({
        ...s,
        startTime: Math.round((s.startTime + startTimeSeconds) * 100) / 100,
        endTime: Math.round((s.endTime + startTimeSeconds) * 100) / 100,
      }));

      // If autoTranslateToVietnamese is enabled and language isn't already Vietnamese, translate
      if (autoTranslateToVietnamese && language !== 'vi-VN' && language !== 'vi' && subtitles.length > 0) {
        try {
          if (groqApiKey) {
            const transPrompt = `Bạn là chuyên gia dịch thuật phụ đề phim ảnh/video chuyên nghiệp. Hãy dịch các câu phụ đề sau sang Tiếng Việt chuẩn xác, tự nhiên, văn phong cuốn hút, đúng ngữ cảnh và văn phong hội thoại:\n${JSON.stringify(subtitles.map((s, idx) => ({ id: idx, text: s.sourceText })))}\n\nTrả về kết quả JSON dạng danh sách [{ "id": 0, "translated": "bản dịch tiếng Việt" }]`;
            const rawGroq = await translateWithGroq(transPrompt, {
              apiKey: groqApiKey,
              model: body.groqModel || 'llama-3.3-70b-versatile',
              responseFormatJson: true,
            });
            const parsed = JSON.parse(rawGroq || '[]');
            const list = Array.isArray(parsed) ? parsed : (parsed.translations || parsed.subtitles || parsed.data || []);
            if (Array.isArray(list)) {
              const map = new Map<number, string>();
              list.forEach((item: any) => {
                if (typeof item?.id === 'number' && item?.translated) {
                  map.set(item.id, String(item.translated).trim());
                }
              });
              subtitles = subtitles.map((s, idx) => ({
                ...s,
                vietnamese: map.get(idx) || s.sourceText,
                translatedText: map.get(idx) || s.sourceText,
                originalText: s.sourceText,
              }));
            }
          } else {
            const { ai, selectedModel } = getAiClientAndModel(req.body);
            const transPrompt = `Bạn là chuyên gia dịch thuật phụ đề phim ảnh/video chuyên nghiệp. Hãy dịch các câu phụ đề sau sang Tiếng Việt chuẩn xác, tự nhiên, văn phong cuốn hút, đúng ngữ cảnh và văn phong hội thoại:\n${JSON.stringify(subtitles.map((s, idx) => ({ id: idx, text: s.sourceText })))}\n\nTrả về kết quả JSON dạng danh sách [{ "id": 0, "translated": "bản dịch tiếng Việt" }]`;

            const transRes = await generateContentWithRetry(ai, {
              model: selectedModel || 'gemini-3.6-flash',
              contents: [{ text: transPrompt }],
              config: {
                responseMimeType: 'application/json',
              },
            });

            const parsed = JSON.parse(transRes.text || '[]');
            if (Array.isArray(parsed)) {
              const map = new Map<number, string>();
              parsed.forEach((item: any) => {
                if (typeof item?.id === 'number' && item?.translated) {
                  map.set(item.id, String(item.translated).trim());
                }
              });
              subtitles = subtitles.map((s, idx) => ({
                ...s,
                vietnamese: map.get(idx) || s.sourceText,
                translatedText: map.get(idx) || s.sourceText,
                originalText: s.sourceText,
              }));
            }
          }
        } catch (transErr) {
          console.warn('[Groq STT Auto-Translate Fallback Warning]', transErr);
          subtitles = subtitles.map((s) => ({
            ...s,
            vietnamese: s.sourceText,
            translatedText: s.sourceText,
            originalText: s.sourceText,
          }));
        }
      } else {
        subtitles = subtitles.map((s) => ({
          ...s,
          vietnamese: s.sourceText,
          translatedText: s.sourceText,
          originalText: s.sourceText,
        }));
      }

      res.json({
        success: true,
        subtitles,
        fullText: sttResult.rawText,
        durationMs: (sttResult.duration ? sttResult.duration * 1000 : 0) || finalDurationMs,
        language: sttResult.language,
      });
    } catch (err: any) {
      console.error('[Groq STT Route Error]', err);
      res.status(500).json({
        success: false,
        error: err?.message || 'Nhận diện giọng nói Groq STT thất bại',
      });
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {}
      }
    }
  };

  app.post('/api/groq-stt', sttUpload.single('file'), handleSttTranscription);
  app.post('/api/capcut-stt', sttUpload.single('file'), handleSttTranscription);

  // Groq API Key Connection Test Endpoint
  app.post('/api/groq-test', async (req, res) => {
    try {
      const apiKey = req.body.apiKey || req.body.groqApiKey || process.env.GROQ_API_KEY;
      const result = await testGroqConnection(apiKey);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || 'Không thể kết nối đến Groq API' });
    }
  });

  async function runWithConcurrencyLimit<T>(
    concurrencyLimit: number,
    items: T[],
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    const executing: Promise<void>[] = [];
    for (const item of items) {
      const p = Promise.resolve().then(() => fn(item));
      executing.push(p);
      if (concurrencyLimit <= items.length) {
        const clean: Promise<void> = p.then(() => {
          executing.splice(executing.indexOf(clean), 1);
        });
        if (executing.length >= concurrencyLimit) {
          await Promise.race(executing);
        }
      }
    }
    await Promise.all(executing);
  }

  // 7b. High-Speed Batch Text-to-Speech Endpoint (/api/tts/batch)
  app.post('/api/tts/batch', async (req, res) => {
    try {
      const {
        items,
        provider = 'capcut_tts',
        capcutVoice = 'BV074_streaming',
        nghiVoice = 'lacphi',
        edgeVoice = 'vi-VN-HoaiMyNeural',
        tiktokSessionId = '',
        tiktokVoice = 'vi_001',
        voice = 'Kore',
        ttsSpeed = 1.0,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, error: 'Thiếu danh sách các dòng văn bản' });
        return;
      }

      console.log(`[Batch TTS] Processing ${items.length} items using ${provider}...`);

      // Set headers for progressive streaming response
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Transfer-Encoding', 'chunked');

      let concurrencyLimit = 5;
      if (provider === 'capcut_tts') {
        concurrencyLimit = 3;
      } else if (provider === 'nghi_tts') {
        concurrencyLimit = 3;
      } else if (provider === 'tiktok_tts' || provider === 'edge_tts') {
        concurrencyLimit = 3; // Optimized concurrent batching
      }

      const processItem = async (item: any) => {
        if (!item.text || !item.text.trim()) {
          res.write(JSON.stringify({ id: item.id, audioBase64: null, error: 'Empty text' }) + '\n');
          return;
        }

        try {
          const resObj = await generateTTSAudioHelper({
            text: item.text,
            targetDuration: item.targetDuration || item.duration,
            provider,
            capcutVoice,
            nghiVoice,
            edgeVoice,
            tiktokSessionId,
            tiktokVoice,
            voice,
            ttsSpeed,
            enableAudioSync: req.body.enableAudioSync !== false,
            apiMode: req.body.apiMode,
            apiKey: req.body.apiKey,
            proxyUrl: req.body.proxyUrl,
            proxyKey: req.body.proxyKey,
            proxyTargetModel: req.body.proxyTargetModel,
            customModelName: req.body.customModelName,
            tiktokProxyUrl: req.body.tiktokProxyUrl,
          });

          if (!resObj.audioBase64 || resObj.audioBase64.length < 200) {
            throw new Error('Âm thanh trả về trống hoặc lỗi.');
          }

          res.write(JSON.stringify({
            id: item.id,
            success: true,
            audioBase64: resObj.audioBase64,
            providerUsed: resObj.providerUsed,
            duration: resObj.duration,
            timestamps: resObj.timestamps,
          }) + '\n');
        } catch (itemErr: any) {
          console.warn(`[Batch TTS Item ${item.id} Primary Failed - Attempting Fallback]`, itemErr?.message || itemErr);
          try {
            const cleanT = sanitizeTextForTTS(item.text);
            let fallbackBuf = await fetchMsEdgeTTS(cleanT, 'vi-VN-HoaiMyNeural', ttsSpeed);
            if (!fallbackBuf || fallbackBuf.length < 200) {
              fallbackBuf = await fetchGoogleTranslateTTS(cleanT);
            }
            if (fallbackBuf && fallbackBuf.length > 200) {
              res.write(JSON.stringify({
                id: item.id,
                success: true,
                audioBase64: fallbackBuf.toString('base64'),
                providerUsed: 'batch_fallback_tts',
                duration: getMp3BufferDuration(fallbackBuf),
              }) + '\n');
              return;
            }
          } catch (finalErr) {
            console.error(`[Batch TTS Final Fallback Error for ${item.id}]`, finalErr);
          }
          res.write(JSON.stringify({ id: item.id, audioBase64: null, error: itemErr.message || 'Item failed' }) + '\n');
        }
      };

      await runWithConcurrencyLimit(concurrencyLimit, items, processItem);
      res.end();
    } catch (err: any) {
      console.error('Error in /api/tts/batch:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message || 'Batch TTS failed' });
      } else {
        res.end();
      }
    }
  });

  // 7c. CapCut Voices Catalog Endpoint (/api/tts/capcut-voices)
  app.get('/api/tts/capcut-voices', (req, res) => {
    try {
      const lang = req.query.lang as string | undefined;
      const voices = getCapCutVoices(lang);
      res.json({ success: true, voices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5b. yt-dlp Standard API Proxy Route (/api/download)
  app.post('/api/download', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({
          success: false,
          error: 'Vui lòng nhập đường dẫn video hợp lệ.'
        });
        return;
      }

      const cleanUrl = url.trim();
      console.log(`[yt-dlp Engine] Extracting download links for: ${cleanUrl}...`);

      const result = await extractWithYtDlp(cleanUrl);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error || 'Không thể lấy link tải video qua yt-dlp.',
        });
        return;
      }

      res.json({
        success: true,
        title: result.title || 'Video Tải Từ Link',
        thumbnail: result.thumbnail || '',
        duration: result.durationFormatted || (result.duration ? `${result.duration}s` : undefined),
        source: result.source || 'yt-dlp',
        author: result.author || undefined,
        views: result.views ? String(result.views) : undefined,
        medias: result.medias,
        subtitles: result.subtitles,
      });
    } catch (err: any) {
      console.error('Error in /api/download:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Không thể kết nối đến máy chủ hoặc link không hợp lệ.'
      });
    }
  });

  // 6. Multi-Platform Video Downloader (Powered by yt-dlp Engine: 1800+ sites)
  app.post('/api/download-video', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ success: false, error: 'Vui lòng nhập đường dẫn (URL) video hợp lệ.' });
        return;
      }

      const cleanUrl = url.trim();
      console.log(`[yt-dlp Engine] Processing video import for: ${cleanUrl}...`);

      const result = await extractWithYtDlp(cleanUrl);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error || 'yt-dlp không thể bóc tách video từ liên kết này. Vui lòng kiểm tra lại đường dẫn!',
        });
        return;
      }

      res.json({
        success: true,
        platform: result.source || 'yt-dlp',
        data: {
          title: result.title || 'Video Tải Qua yt-dlp',
          thumbnail: result.thumbnail || '',
          duration: result.duration || 0,
          source: result.source || 'yt-dlp',
          author: result.author || '',
          views: result.views || 0,
          formats: result.medias,
          subtitles: result.subtitles || [],
          videoUrl: result.videoUrl,
          directUrl: result.directUrl || result.videoUrl,
          audioUrl: result.audioUrl || '',
          audioDirectUrl: result.audioDirectUrl || result.audioUrl || '',
        },
      });
    } catch (err: any) {
      console.error('Error in /api/download-video via yt-dlp:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Lỗi khi xử lý link video qua hệ thống yt-dlp.',
      });
    }
  });

  // 6c. Douyin Auth Handoff & MiniApp Downloader APIs (Ported from Douyin-Handoff-Backend)
  app.get(['/api/douyin-handoff/capabilities', '/v1/capabilities'], (req, res) => {
    res.json({ success: true, capabilities: douyinHandoffService.getCapabilities() });
  });

  app.post(['/api/douyin-handoff/create', '/v1/handoffs'], async (req, res) => {
    try {
      const targetAppId = req.body.targetAppId || req.body.appId || TARGET_APP_ID;
      const seriesId = Number(req.body.seriesId || req.body.series_id || 1);
      const result = await douyinHandoffService.createHandoff(seriesId, targetAppId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Error in handoff create:', err);
      res.status(500).json({ success: false, error: err.message || 'Lỗi tạo phiên handoff.' });
    }
  });

  app.get(['/api/douyin-handoff/poll/:id', '/v1/handoffs/:id'], async (req, res) => {
    try {
      const handoffId = req.params.id;
      const pollToken = (req.query.pollToken || req.query.poll_token || req.headers['x-poll-token']) as string;
      if (!pollToken) {
        res.status(400).json({ success: false, error: 'Missing pollToken' });
        return;
      }
      const pollRes = await douyinHandoffService.pollHandoff(handoffId, pollToken);
      res.json({ success: true, ...pollRes });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post(['/api/douyin-handoff/complete/:id', '/v1/handoffs/:id/complete'], async (req, res) => {
    try {
      const handoffId = req.params.id;
      const { completeNonce, miniappLoginCode } = req.body;
      if (!completeNonce || !miniappLoginCode) {
        res.status(400).json({ success: false, error: 'Missing completeNonce or miniappLoginCode' });
        return;
      }
      const completeRes = await douyinHandoffService.completeHandoff(handoffId, completeNonce, miniappLoginCode);
      res.json({ success: true, ...completeRes });
    } catch (err: any) {
      console.error('Error completing handoff:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete(['/api/douyin-handoff/cancel/:id', '/v1/handoffs/:id'], async (req, res) => {
    try {
      const handoffId = req.params.id;
      const pollToken = (req.query.pollToken || req.query.poll_token || req.headers['x-poll-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '')) as string;
      if (!pollToken) {
        res.status(400).json({ success: false, error: 'Missing pollToken' });
        return;
      }
      const result = await douyinHandoffService.cancelHandoff(handoffId, pollToken);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete(['/api/douyin-handoff/session/revoke', '/v1/sessions/current'], async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const downloadSession = authHeader.replace(/^Bearer\s+/i, '').trim() || req.body.downloadSession;
      if (!downloadSession) {
        res.status(400).json({ success: false, error: 'Missing downloadSession token' });
        return;
      }
      const result = await douyinHandoffService.revokeSession(downloadSession);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/douyin-handoff/direct-session', (req, res) => {
    try {
      const { token, userId, appId } = req.body;
      if (!token || !userId) {
        res.status(400).json({ success: false, error: 'Vui lòng cung cấp token và userId của miniapp.' });
        return;
      }
      const sessionInfo = douyinHandoffService.createDirectSession(token.trim(), userId.trim(), appId?.trim() || TARGET_APP_ID);
      res.json({ success: true, ...sessionInfo });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post(['/api/douyin-handoff/guest-auto-auth', '/v1/session/guest-auto'], async (req, res) => {
    try {
      const { userId } = req.body;
      const sessionInfo = await douyinHandoffService.autoSynthesizeGuestSession(userId);
      res.json({ success: true, ...sessionInfo, isGuestAuto: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post(['/api/douyin-handoff/analyze', '/v1/analysis'], async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const downloadSession = authHeader.replace(/^Bearer\s+/i, '').trim() || req.body.downloadSession || '';
      const shareUrl = req.body.shareUrl || req.body.share_url;
      if (!shareUrl) {
        res.status(400).json({ success: false, error: 'Thiếu tham số shareUrl' });
        return;
      }
      const analysis = await douyinHandoffService.analyzeSeries(downloadSession, shareUrl);
      res.json({ success: true, ...analysis });
    } catch (err: any) {
      console.error('Error in analyzeSeries:', err);
      res.status(500).json({ success: false, error: err.message || 'Lỗi bóc tách danh sách tập phim.' });
    }
  });

  app.post(['/api/douyin-handoff/resolve-media', '/v1/media/resolve'], async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const downloadSession = authHeader.replace(/^Bearer\s+/i, '').trim() || req.body.downloadSession || '';
      const { seriesId, episode, videoId, appId } = req.body;
      if (!seriesId || !episode) {
        res.status(400).json({ success: false, error: 'Thiếu tham số bắt buộc (seriesId, episode)' });
        return;
      }
      const media = await douyinHandoffService.resolveMedia(
        downloadSession,
        Number(seriesId),
        Number(episode),
        Number(videoId || 0),
        appId
      );
      res.json({ success: true, ...media });
    } catch (err: any) {
      console.error('Error in resolveMedia:', err);
      res.status(500).json({ success: false, error: err.message || 'Lỗi lấy link media tập phim.' });
    }
  });

  app.post('/api/douyin-handoff/parse-share-link', async (req, res) => {
    try {
      const { shareUrl } = req.body;
      if (!shareUrl) {
        res.status(400).json({ success: false, error: 'Thiếu shareUrl' });
        return;
      }
      const descriptor = await parseDouyinMicroAppShareLink(shareUrl);
      res.json({ success: true, descriptor });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GenDownload Channel Endpoint Proxy (POST https://gendownload.com/api/channel)
  app.post('/api/channel', async (req, res) => {
    try {
      const { url, limit } = req.body;
      if (!url) {
        res.status(400).json({ error: 'URL parameter is required.' });
        return;
      }

      const channelRes = await fetch('https://gendownload.com/api/channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({ url, limit: limit || 30 }),
      });

      const data = await channelRes.json();
      res.status(channelRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch channel from GenDownload' });
    }
  });

  // GenDownload Zip Endpoint Proxy (POST https://gendownload.com/api/zip)
  app.post('/api/zip', async (req, res) => {
    try {
      const { urls, quality } = req.body;
      if (!Array.isArray(urls) || urls.length === 0) {
        res.status(400).json({ error: 'urls array parameter is required.' });
        return;
      }

      const zipRes = await fetch('https://gendownload.com/api/zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: JSON.stringify({ urls, quality: quality || 'best' }),
      });

      const data = await zipRes.json();
      res.status(zipRes.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create zip bundle from GenDownload' });
    }
  });

  // 7. Proxy Video Stream (bypasses CORS restrictions & streams MP4 smoothly with Range support)
  app.options('/api/proxy-video', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
  });

  app.get('/api/proxy-video', async (req, res) => {
    try {
      const rawUrl = req.query.url as string;
      if (!rawUrl) {
        res.status(400).send('Missing video url parameter');
        return;
      }

      const decodedUrl = decodeURIComponent(rawUrl).trim();

      // SSRF Protection: Validate protocol and prevent requests to private/internal IPs & metadata services
      if (!isValidPublicHttpUrl(decodedUrl)) {
        res.status(403).send('Invalid or restricted target URL protocol/hostname');
        return;
      }

      // Headers configuration based on video host
      const requestHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      };

      const isBiliCdn =
        decodedUrl.includes('bilibili.com') ||
        decodedUrl.includes('akamaized.net') ||
        decodedUrl.includes('bilivideo.com') ||
        decodedUrl.includes('bilivideo.cn') ||
        decodedUrl.includes('hdslb.com') ||
        decodedUrl.includes('b23.tv') ||
        decodedUrl.includes('upos-');

      const isDouyinCdn =
        decodedUrl.includes('douyin.com') ||
        decodedUrl.includes('douyinvod.com') ||
        decodedUrl.includes('bytetos.com') ||
        decodedUrl.includes('byteimg.com') ||
        decodedUrl.includes('douyinstatic.com') ||
        decodedUrl.includes('snssdk.com') ||
        decodedUrl.includes('amemv.com') ||
        decodedUrl.includes('filmworx.cn') ||
        decodedUrl.includes('jianyichangwan.cn');

      if (isBiliCdn) {
        requestHeaders['Referer'] = 'https://www.bilibili.com/';
        try {
          const biliCookie = await getBilibiliCookieHeader();
          if (biliCookie) {
            requestHeaders['Cookie'] = biliCookie;
          }
        } catch (_) {}
      } else if (isDouyinCdn) {
        requestHeaders['Referer'] = 'https://www.douyin.com/';
        requestHeaders['User-Agent'] = 'Mozilla/5.0 (Linux; Android 9; V2453A Build/PQ3A.190801.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81.0.4044.117 Mobile Safari/537.36';
        requestHeaders['Cookie'] = 'sessionid=a8e9d1361f4069df67f6b4977d990f61; sessionid_ss=a8e9d1361f4069df67f6b4977d990f61; sid_tt=a8e9d1361f4069df67f6b4977d990f61; passport_csrf_token=bc1ed3b037464d180effb6b4ac6401af; odin_tt=508f7f7bb8d158fcc476a200dbb56e36c86e9c31353ac20e74bd0159b8f57f304344794b9f5e113419e873e82f6d99ef8850e54a84f1b5beb569b01c143a6b0554967720776020e19b0f641531ad4f9f; d_ticket=cc5ee97c28189edc2ec708ee0889c0c3a6b0e; uid_tt=4d9dc40e6021a95344112a737c9d8aef; uid_tt_ss=4d9dc40e6021a95344112a737c9d8aef';
      } else if (decodedUrl.includes('tiktok.com') || decodedUrl.includes('tikwm')) {
        requestHeaders['Referer'] = 'https://www.tiktok.com/';
      } else if (decodedUrl.includes('googlevideo.com') || decodedUrl.includes('youtube.com') || decodedUrl.includes('youtu.be')) {
        requestHeaders['Referer'] = 'https://www.youtube.com/';
      }

      if (req.headers.range) {
        requestHeaders['Range'] = req.headers.range as string;
      }

      let videoRes = await fetch(decodedUrl, {
        method: 'GET',
        headers: requestHeaders,
        redirect: 'follow',
      });

      // Fallback: If 403 Forbidden or 401 Unauthorized, retry with minimal headers
      if (!videoRes.ok && (videoRes.status === 403 || videoRes.status === 401 || videoRes.status === 412)) {
        const fallbackHeaders: Record<string, string> = {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        };
        if (isBiliCdn) {
          fallbackHeaders['Referer'] = 'https://www.bilibili.com/';
        }
        if (req.headers.range) {
          fallbackHeaders['Range'] = req.headers.range as string;
        }
        videoRes = await fetch(decodedUrl, {
          method: 'GET',
          headers: fallbackHeaders,
          redirect: 'follow',
        });
      }

      if (!videoRes.ok && videoRes.status !== 206) {
        res.status(videoRes.status).send(`Failed to fetch video stream: HTTP ${videoRes.status}`);
        return;
      }

      let contentType = videoRes.headers.get('content-type') || 'video/mp4';
      if (contentType.includes('text/html')) {
        res.status(400).send('Target URL is an HTML webpage, not a direct video media stream');
        return;
      }

      res.status(videoRes.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');

      const contentLength = videoRes.headers.get('content-length');
      if (contentLength === '0' && req.method !== 'HEAD') {
        res.status(404).send('Video stream is empty (0 bytes). Upstream media ID might be expired or restricted.');
        return;
      }
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const contentRange = videoRes.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      const acceptRanges = videoRes.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      // Support direct file download naming
      const isDownload = req.query.download === '1' || req.query.download === 'true';
      const requestedFilename = (req.query.filename as string) || '';
      if (isDownload || requestedFilename) {
        const cleanName = (requestedFilename || 'video.mp4')
          .replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9.\-_()]/gi, '_')
          .trim();
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(cleanName)}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`
        );
      }

      if (videoRes.body) {
        const nodeStream = Readable.fromWeb(videoRes.body as any);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error('Error in /api/proxy-video:', err);
      if (!res.headersSent) {
        res.status(500).send('Video proxy streaming error');
      }
    }
  });

  // 7a-2. Download Full Media (Video + Audio Muxed into clean MP4 via yt-dlp & ffmpeg)
  app.get('/api/download-media', async (req, res) => {
    const pageUrl = (req.query.pageUrl as string) || (req.query.url as string) || '';
    const formatId = (req.query.formatId as string) || '';
    const videoUrl = (req.query.videoUrl as string) || '';
    const audioUrl = (req.query.audioUrl as string) || '';
    const isAudioOnly = req.query.audioOnly === '1' || req.query.audioOnly === 'true';
    const rawFilename = (req.query.filename as string) || (isAudioOnly ? 'audio.mp3' : 'video.mp4');
    const fallbackUrl = (req.query.fallbackUrl as string) || '';

    const cleanFilename = rawFilename
      .replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9.\-_()]/gi, '_')
      .trim() || (isAudioOnly ? 'audio.mp3' : 'video.mp4');

    if (!pageUrl && !videoUrl && !fallbackUrl) {
      res.status(400).send('Missing media stream parameters');
      return;
    }

    const uniquePrefix = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const outputFilePath = isAudioOnly ? `/tmp/${uniquePrefix}.mp3` : `/tmp/${uniquePrefix}.mp4`;

    let generatedFile = '';

    // Strategy 1: Direct stream muxing (Fastest for direct pre-fetched audio & video URLs)
    if (videoUrl || (isAudioOnly && audioUrl)) {
      try {
        console.log(`[Download Media] Muxing streams directly: videoUrl=${Boolean(videoUrl)}, audioUrl=${Boolean(audioUrl)}, isAudioOnly=${isAudioOnly}`);
        await downloadAndMuxStreams({
          videoUrl,
          audioUrl,
          isAudioOnly,
          outputFilePath,
        });
        if (fs.existsSync(outputFilePath) && fs.statSync(outputFilePath).size > 0) {
          generatedFile = outputFilePath;
        }
      } catch (muxErr: any) {
        console.warn(`[Download Media] Stream muxing failed (${muxErr.message}). Trying yt-dlp direct download...`);
      }
    }

    // Strategy 2: Direct yt-dlp engine execution with pageUrl
    if (!generatedFile && pageUrl) {
      try {
        console.log(`[Download Media] Executing yt-dlp download for page: ${pageUrl}...`);
        await executeYtDlpDownload(pageUrl, {
          formatId: formatId || undefined,
          isAudioOnly,
          outputFileTemplate: outputFilePath
        });
        if (fs.existsSync(outputFilePath) && fs.statSync(outputFilePath).size > 0) {
          generatedFile = outputFilePath;
        }
      } catch (dlErr: any) {
        console.warn(`[Download Media] yt-dlp direct execution failed (${dlErr.message}). Trying extraction fallback...`);
      }
    }

    // Strategy 3: Extract & Mux via yt-dlp
    if (!generatedFile && pageUrl) {
      try {
        console.log(`[Download Media] Extracting & muxing via extractWithYtDlp: ${pageUrl}...`);
        const extracted = await extractWithYtDlp(pageUrl);
        const vUrl = extracted.medias.find((m) => !m.isAudioOnly)?.url || extracted.videoUrl;
        const aUrl = extracted.audioUrl || extracted.medias.find((m) => m.isAudioOnly)?.url;

        if (vUrl || aUrl) {
          await downloadAndMuxStreams({
            videoUrl: vUrl,
            audioUrl: aUrl,
            isAudioOnly,
            outputFilePath,
          });
          if (fs.existsSync(outputFilePath) && fs.statSync(outputFilePath).size > 0) {
            generatedFile = outputFilePath;
          }
        }
      } catch (ytdlpErr: any) {
        console.warn(`[Download Media] yt-dlp extraction fallback failed (${ytdlpErr.message})`);
      }
    }

    if (generatedFile && fs.existsSync(generatedFile)) {
      try {
        const stat = fs.statSync(generatedFile);
        const ext = path.extname(generatedFile).toLowerCase();
        const contentType = isAudioOnly ? 'audio/mpeg' : (ext === '.mp4' ? 'video/mp4' : 'application/octet-stream');

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(cleanFilename)}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`
        );

        const readStream = fs.createReadStream(generatedFile);
        readStream.pipe(res);

        const cleanup = () => {
          try {
            if (fs.existsSync(generatedFile)) {
              fs.unlinkSync(generatedFile);
            }
          } catch (_) {}
        };

        readStream.on('end', cleanup);
        readStream.on('error', (e) => {
          console.error('[Download Media Stream Error]:', e);
          cleanup();
        });
        res.on('close', cleanup);
        return;
      } catch (serveErr: any) {
        console.error('[Download Media Serve Error]:', serveErr);
      }
    }

    // Strategy 3: Stream fallback
    if (fallbackUrl || videoUrl || audioUrl) {
      const streamTarget = fallbackUrl || videoUrl || audioUrl;
      res.redirect(`/api/proxy-video?url=${encodeURIComponent(streamTarget)}&download=1&filename=${encodeURIComponent(cleanFilename)}`);
    } else {
      res.status(500).send('Không thể tải video từ nguồn này. Vui lòng thử lại!');
    }
  });

  // 7b. Proxy Subtitle & Converter (fetches Bilibili/YouTube/any subtitle, converts to clean standard SRT)
  app.options('/api/proxy-subtitle', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
  });

  app.get('/api/proxy-subtitle', async (req, res) => {
    try {
      const rawUrl = req.query.url as string;
      const lang = (req.query.lang as string) || 'vi';
      const type = (req.query.type as string) || 'official';
      const title = (req.query.title as string) || 'subtitle';

      if (!rawUrl) {
        res.status(400).send('Missing subtitle url parameter');
        return;
      }

      const decodedUrl = decodeURIComponent(rawUrl).trim();
      if (!isValidPublicHttpUrl(decodedUrl)) {
        res.status(403).send('Invalid target URL');
        return;
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      };

      if (decodedUrl.includes('bilibili') || decodedUrl.includes('hdslb.com')) {
        headers['Referer'] = 'https://www.bilibili.com/';
      } else if (decodedUrl.includes('youtube.com') || decodedUrl.includes('googlevideo.com')) {
        headers['Referer'] = 'https://www.youtube.com/';
      }

      const subRes = await fetch(decodedUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!subRes.ok) {
        res.status(subRes.status).send(`Failed to fetch subtitle from upstream server: ${subRes.statusText}`);
        return;
      }

      const rawText = await subRes.text();
      const srtText = convertSubtitleToSrt(rawText);

      const safeTitle = title.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 50);
      const filename = `${safeTitle}_${type}_${lang}.srt`;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(srtText || rawText);
    } catch (err: any) {
      console.error('Error in /api/proxy-subtitle:', err);
      if (!res.headersSent) {
        res.status(500).send('Failed to process subtitle');
      }
    }
  });

  // Helper functions for /api/concat-videos (using safe execFilePromise)
  async function getVideoDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration) && duration > 0) {
        return duration;
      }
    } catch (err) {
      console.warn(`[Concat Video] Failed to get duration for ${filePath}:`, err);
    }
    return 10;
  }

  async function ensureAudioTrack(filePath: string, tempDir: string, index: number): Promise<string> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        filePath,
      ]);
      if (stdout.trim().includes('audio')) {
        return filePath;
      } else {
        const duration = await getVideoDuration(filePath);
        const outputPath = path.join(tempDir, `temp_audio_fixed_${index}_${Date.now()}.mp4`);
        console.log(`[Concat Video] Adding silent audio track (${duration}s) to silent video: ${filePath}`);
        
        try {
          await execFilePromise('ffmpeg', [
            '-y',
            '-i', filePath,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t', String(duration),
            '-c:v', 'copy',
            '-c:a', 'aac',
            outputPath,
          ]);
        } catch (copyErr) {
          console.warn(`[Concat Video] Silent audio stream copy failed for ${filePath}, attempting re-encoding fallback:`, copyErr);
          await execFilePromise('ffmpeg', [
            '-y',
            '-i', filePath,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-t', String(duration),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'superfast',
            '-c:a', 'aac',
            outputPath,
          ]);
        }
        return outputPath;
      }
    } catch (err) {
      console.warn(`[Concat Video] ffprobe / audio check failed for ${filePath}, falling back to original:`, err);
      return filePath;
    }
  }

  async function getVideoResolution(filePath: string): Promise<{ width: number; height: number }> {
    try {
      const { stdout } = await execFilePromise('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0',
        filePath,
      ]);
      const lines = stdout.trim().split('\n');
      if (lines.length > 0 && lines[0].trim()) {
        const parts = lines[0].trim().split('x');
        if (parts.length === 2) {
          const width = parseInt(parts[0], 10);
          const height = parseInt(parts[1], 10);
          if (!isNaN(width) && !isNaN(height)) {
            return { width, height };
          }
        }
      }
    } catch (err) {
      console.warn(`[Concat Video] Failed to get resolution for ${filePath}:`, err);
    }
    return { width: 1280, height: 720 };
  }

  // Multer configuration for /api/concat-videos with strict extension validation
  const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.ts', '.m4v']);
  const concatUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'bach_uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase();
        const ext = ALLOWED_VIDEO_EXTENSIONS.has(rawExt) ? rawExt : '.mp4';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'video-' + uniqueSuffix + ext);
      },
    }),
    limits: {
      fileSize: 300 * 1024 * 1024, // 300MB per file limit
    }
  });

  app.post('/api/concat-videos', concatUpload.array('videos', 10), async (req, res) => {
    const files = req.files as any[];
    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ success: false, error: 'No video files uploaded' });
      return;
    }

    const tempDir = path.join(os.tmpdir(), 'bach_temp_concat_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    const originalPaths = files.map(f => f.path);
    const processedPaths: string[] = [];

    try {
      console.log(`[Concat Video] Received ${files.length} videos for merging:`, originalPaths);

      // 1. Ensure all videos have audio tracks
      for (let i = 0; i < originalPaths.length; i++) {
        const processedPath = await ensureAudioTrack(originalPaths[i], tempDir, i);
        processedPaths.push(processedPath);
      }

      // 2. Get target resolution from the first video
      const targetRes = await getVideoResolution(processedPaths[0]);
      const targetW = targetRes.width % 2 === 0 ? targetRes.width : targetRes.width - 1;
      const targetH = targetRes.height % 2 === 0 ? targetRes.height : targetRes.height - 1;

      console.log(`[Concat Video] Target resolution: ${targetW}x${targetH}`);

      // 3. Construct FFmpeg command arguments array
      const outputFilename = `merged_${Date.now()}.mp4`;
      const outputPath = path.join(tempDir, outputFilename);

      const ffmpegArgs: string[] = ['-y'];
      for (const p of processedPaths) {
        ffmpegArgs.push('-i', p);
      }

      let filterComplex = '';
      // 1. Scale and pad video streams, force to even dimensions and SAR 1, safe padding with trunc
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:trunc((ow-iw)/2):trunc((oh-ih)/2),setsar=1[v${i}];`;
      }
      // 2. Normalize and resample audio streams to 44100Hz stereo to avoid layout/sample rate differences
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[${i}:a]aresample=async=1,aformat=sample_rates=44100:channel_layouts=stereo[a${i}];`;
      }
      // 3. Concat all pairs of normalized video and audio streams
      for (let i = 0; i < processedPaths.length; i++) {
        filterComplex += `[v${i}][a${i}]`;
      }
      filterComplex += `concat=n=${processedPaths.length}:v=1:a=1[outv][outa]`;

      ffmpegArgs.push(
        '-filter_complex', filterComplex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'superfast',
        '-c:a', 'aac',
        '-vsync', '2',
        outputPath
      );

      console.log(`[Concat Video] Running safe execFile ffmpeg with ${ffmpegArgs.length} arguments`);
      await execFilePromise('ffmpeg', ffmpegArgs);

      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg processing completed but output file is missing.');
      }

      console.log(`[Concat Video] Merging completed successfully: ${outputPath}`);

      // Read output file and stream it back
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('close', () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          originalPaths.forEach(p => {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          });
        } catch (cleanupErr) {
          console.warn('[Concat Video] Temp file cleanup error:', cleanupErr);
        }
      });

    } catch (err: any) {
      console.error('[Concat Video] Merging failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'MERGE_FAILED',
          message: 'Lỗi khi ghép các video bằng FFmpeg: ' + (err.message || err),
        });
      }

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        originalPaths.forEach(p => {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
      } catch (cleanupErr) {
        console.warn('[Concat Video] Cleanup error:', cleanupErr);
      }
    }
  });

  // ==========================================
  // LICENSE MANAGEMENT & ACTIVATION API (MODEL 2)
  // SECURED & AUTHORITATIVE SERVER-SIDE IMPLEMENTATION
  // ==========================================
  
  // Safe extraction of client IP from trusted Express proxy
  const getClientIp = (req: express.Request): string => {
    const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    return rawIp.replace(/^::ffff:/, '');
  };

  // In-Memory Rate Limiting & Anti-Bruteforce Defense
  const licenseRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const adminFailedAttemptsMap = new Map<string, { count: number; lockUntil: number }>();

  // Cleanup stale rate limit records periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of licenseRateLimitMap.entries()) {
      if (now > data.resetAt) licenseRateLimitMap.delete(ip);
    }
    for (const [ip, data] of adminFailedAttemptsMap.entries()) {
      if (now > data.lockUntil && data.count === 0) adminFailedAttemptsMap.delete(ip);
    }
  }, 10 * 60 * 1000);

  // License Request Rate Limiter (Max 30 requests / 60s per IP)
  const checkLicenseRateLimit = (req: express.Request, res: express.Response): boolean => {
    const ip = getClientIp(req);
    const now = Date.now();
    const record = licenseRateLimitMap.get(ip) || { count: 0, resetAt: now + 60 * 1000 };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + 60 * 1000;
    }

    record.count++;
    licenseRateLimitMap.set(ip, record);

    if (record.count > 30) {
      const waitSeconds = Math.ceil((record.resetAt - now) / 1000);
      res.status(429).json({
        success: false,
        message: `Bạn gửi quá nhiều yêu cầu xác thực. Vui lòng chờ ${waitSeconds}s trước khi thử lại.`
      });
      return false;
    }
    return true;
  };

  // Audit Logging for Admin Operations
  const logAdminAudit = (action: string, req: express.Request, details?: any) => {
    const ip = getClientIp(req);
    const time = new Date().toISOString();
    console.log(`[ADMIN AUDIT] [${time}] [IP: ${ip}] Action: ${action} | Details:`, details || 'None');
  };

  // Unified Admin Authentication Helper (Strictly Server-Authoritative)
  const checkAdminAuth = (req: express.Request): { isAuthorized: boolean; reason?: string } => {
    const ip = getClientIp(req);
    const now = Date.now();

    // 0. Whitelisted Admin IP check (Router IP 192.168.1.1 & Internal IP 192.168.1.171)
    if (isWhitelistedAdminIp(ip)) {
      adminFailedAttemptsMap.delete(ip);
      return { isAuthorized: true };
    }

    // Check if IP is currently locked due to too many failed password attempts
    const lockRecord = adminFailedAttemptsMap.get(ip);
    if (lockRecord && now < lockRecord.lockUntil) {
      const waitMinutes = Math.ceil((lockRecord.lockUntil - now) / 60000);
      return {
        isAuthorized: false,
        reason: `IP của bạn đang bị khóa tạm thời (${waitMinutes} phút) do nhập sai mật khẩu admin nhiều lần.`
      };
    }

    const authHeader = req.headers['authorization'];
    const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const adminKey = (req.headers['x-admin-key'] as string) || (req.query.key as string) || req.body?.adminKey || bearerKey;
    const token = (req.headers['x-license-token'] as string) || (req.query.token as string) || req.body?.licenseToken;

    // 1. Verify Secret Master Key (Timing Safe)
    if (adminKey && isSuperAdminCredential({ key: adminKey })) {
      // Clear failed attempts upon successful admin auth
      adminFailedAttemptsMap.delete(ip);
      return { isAuthorized: true };
    }

    // 2. Verify Cryptographic HMAC Signed Token
    if (token) {
      const verified = verifySignedLicenseToken(token);
      if (verified.valid && verified.payload && (verified.payload.role === 'admin' || verified.payload.isSuperAdmin)) {
        adminFailedAttemptsMap.delete(ip);
        return { isAuthorized: true };
      }
    }

    return { isAuthorized: false, reason: 'Từ chối truy cập: Yêu cầu mật khẩu hoặc Token Super Admin hợp lệ' };
  };

  // Endpoint to detect client IP and whitelist status
  app.get('/api/license/client-ip', (req, res) => {
    const ip = getClientIp(req);
    const isWhitelisted = isWhitelistedAdminIp(ip);
    res.json({
      success: true,
      ip,
      isWhitelisted,
      whitelistedIps: WHITELISTED_ADMIN_IPS
    });
  });

  // Ensure / Auto-provision device license for new user
  app.post('/api/license/ensure-device', (req, res) => {
    if (!checkLicenseRateLimit(req, res)) return;
    try {
      const { deviceId, deviceName, imei, email } = req.body || {};
      const ip = getClientIp(req);
      const result = ensureDeviceLicense({
        deviceId,
        deviceName,
        imei,
        ip,
        email
      });
      res.json(result);
    } catch (err: any) {
      console.error('[License API] Ensure device error:', err);
      res.status(500).json({ success: false, message: 'Lỗi khởi tạo license thiết bị: ' + err.message });
    }
  });

  app.post('/api/license/activate', (req, res) => {
    if (!checkLicenseRateLimit(req, res)) return;
    try {
      const { key, deviceId, deviceName, imei } = req.body || {};
      const ip = getClientIp(req);
      const result = activateLicense({
        key,
        deviceId,
        deviceName,
        imei,
        ip
      });
      if (result.success && result.license?.isSuperAdmin) {
        logAdminAudit('activate-superadmin-key', req, { deviceId, deviceName });
      }
      res.json(result);
    } catch (err: any) {
      console.error('[License API] Activate error:', err);
      res.status(500).json({ success: false, message: 'Lỗi kích hoạt license: ' + err.message });
    }
  });

  app.post('/api/license/verify', (req, res) => {
    if (!checkLicenseRateLimit(req, res)) return;
    try {
      const { key, deviceId, imei } = req.body || {};
      const ip = getClientIp(req);
      const result = verifyLicense({
        key,
        deviceId,
        imei,
        ip
      });
      res.json(result);
    } catch (err: any) {
      console.error('[License API] Verify error:', err);
      res.status(500).json({ valid: false, message: 'Lỗi xác thực license: ' + err.message });
    }
  });

  app.post('/api/license/deactivate', (req, res) => {
    if (!checkLicenseRateLimit(req, res)) return;
    try {
      const { key, deviceId } = req.body || {};
      const result = deactivateLicense({ key, deviceId });
      res.json(result);
    } catch (err: any) {
      console.error('[License API] Deactivate error:', err);
      res.status(500).json({ success: false, message: 'Lỗi hủy kích hoạt license: ' + err.message });
    }
  });

  // Admin API: List all created licenses
  app.get('/api/license/admin/list-keys', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      logAdminAudit('list-keys', req);
      const store = loadLicenseStore();
      res.json({
        success: true,
        licenses: store.licenses,
        whitelistedImeis: store.whitelistedImeis,
        whitelistedIps: store.whitelistedIps
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi nạp danh sách license: ' + err.message });
    }
  });

  // Admin API: Create new license key(s)
  app.post('/api/license/admin/create-key', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { plan, customDays, maxDevices, note, count, customPrefix } = req.body || {};
      logAdminAudit('create-key', req, { plan, customDays, maxDevices, count, customPrefix });

      const result = adminCreateKey({
        plan: plan || 'month',
        customDays,
        maxDevices: maxDevices || 2,
        note,
        count: count || 1,
        customPrefix
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi tạo mã license: ' + err.message });
    }
  });

  // Admin API: Reset devices for a key
  app.post('/api/license/admin/reset-devices', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { key } = req.body || {};
      if (!key) {
        return res.status(400).json({ success: false, message: 'Thiếu license key cần reset' });
      }

      logAdminAudit('reset-devices', req, { key });
      const result = adminResetKeyDevices(key);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi reset thiết bị: ' + err.message });
    }
  });

  // Admin API: Revoke a key
  app.post('/api/license/admin/revoke-key', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { key } = req.body || {};
      if (!key) {
        return res.status(400).json({ success: false, message: 'Thiếu license key cần thu hồi' });
      }

      logAdminAudit('revoke-key', req, { key });
      const result = adminRevokeKey(key);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi thu hồi key: ' + err.message });
    }
  });

  // Admin API: Delete a key permanently
  app.post('/api/license/admin/delete-key', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { key } = req.body || {};
      if (!key) {
        return res.status(400).json({ success: false, message: 'Thiếu license key cần xóa' });
      }

      logAdminAudit('delete-key', req, { key });
      const result = adminDeleteKey(key);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi xóa key: ' + err.message });
    }
  });

  // Admin API: Buff VIP / Grant License to any Target (Device ID, IMEI, IP, or Key)
  app.post('/api/license/admin/buff-target', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { target, plan, customDays, note } = req.body || {};
      if (!target) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin Target (Device ID / IMEI / IP / Key) cần Buff' });
      }

      logAdminAudit('buff-target', req, { target, plan, customDays });
      const result = adminBuffTarget({
        target,
        plan: plan || 'month',
        customDays: customDays ? Number(customDays) : undefined,
        note
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi thực hiện Buff VIP: ' + err.message });
    }
  });

  // Admin API: List all connected devices
  app.get('/api/license/admin/list-devices', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      logAdminAudit('list-devices', req);
      const result = adminListConnectedDevices();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi nạp danh sách thiết bị: ' + err.message });
    }
  });

  // Admin API: Verify Admin Password (With Brute-force Throttling Defense)
  app.post('/api/license/admin/verify-password', (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();

    // Check if IP is temporarily locked
    const attemptRecord = adminFailedAttemptsMap.get(ip) || { count: 0, lockUntil: 0 };
    if (now < attemptRecord.lockUntil) {
      const waitMinutes = Math.ceil((attemptRecord.lockUntil - now) / 60000);
      return res.status(429).json({
        success: false,
        message: `Đã nhập sai mật khẩu quá 5 lần. Tạm khóa xác thực từ IP này trong ${waitMinutes} phút để bảo vệ hệ thống.`
      });
    }

    try {
      const auth = checkAdminAuth(req);
      if (auth.isAuthorized) {
        adminFailedAttemptsMap.delete(ip);
        logAdminAudit('admin-login-success', req);
        return res.json({ success: true, message: '✓ Xác thực Quản trị viên (Super Admin) thành công!' });
      }

      // Record failed attempt
      attemptRecord.count++;
      if (attemptRecord.count >= 5) {
        attemptRecord.lockUntil = now + 15 * 60 * 1000; // 15 minute lock
        adminFailedAttemptsMap.set(ip, attemptRecord);
        console.warn(`[SECURITY ALERT] IP ${ip} locked for 15 minutes due to 5 consecutive failed admin password attempts.`);
        return res.status(429).json({
          success: false,
          message: 'Đã nhập sai mật khẩu quá 5 lần liên tiếp. Tạm khóa IP này 15 phút để bảo vệ hệ thống.'
        });
      } else {
        adminFailedAttemptsMap.set(ip, attemptRecord);
        const remaining = 5 - attemptRecord.count;
        return res.status(403).json({
          success: false,
          message: `Mật khẩu quản trị viên không chính xác. Bạn còn ${remaining} lần thử trước khi bị tạm khóa.`
        });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi xác thực: ' + err.message });
    }
  });

  // Admin API: Renew / Extend Member (Trial / VIP / Lifetime)
  app.post('/api/license/admin/renew-member', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { targetUidOrCode, action, customDays, note } = req.body || {};
      logAdminAudit('renew-member', req, { targetUidOrCode, action, customDays });
      const result = adminRenewOrExtendMember({
        targetUidOrCode,
        action,
        customDays: customDays ? Number(customDays) : undefined,
        note
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi gia hạn thành viên: ' + err.message });
    }
  });

  // Admin API: Update Member Information
  app.post('/api/license/admin/update-member', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { uid, updates } = req.body || {};
      logAdminAudit('update-member', req, { uid, updates });
      const result = adminUpdateMember(uid, updates || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi cập nhật thành viên: ' + err.message });
    }
  });

  // Admin API: Reset Member Devices
  app.post('/api/license/admin/reset-member-devices', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const { uid } = req.body || {};
      logAdminAudit('reset-member-devices', req, { uid });
      const result = adminResetMemberDevices(uid);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi reset thiết bị thành viên: ' + err.message });
    }
  });

  // Admin API: Lookup Member
  app.get('/api/license/admin/lookup-member', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const target = (req.query.target as string) || '';
      const result = adminLookupMember(target);
      res.json({ success: true, member: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi tra cứu: ' + err.message });
    }
  });

  // Admin API: List all members
  app.get('/api/license/admin/list-all-users', (req, res) => {
    try {
      const auth = checkAdminAuth(req);
      if (!auth.isAuthorized) {
        return res.status(403).json({ success: false, message: auth.reason || 'Từ chối truy cập: Yêu cầu quyền Super Admin' });
      }

      const members = adminListAllMembers();
      res.json({ success: true, members });
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Lỗi nạp danh sách: ' + err.message });
    }
  });

  // ==========================================
  // GEMINI WEB / GOOGLE ACCOUNT REVERSE ENGINE API (REAL GOOGLE SESSION)
  // ==========================================
  app.post('/api/gemini-web/check-token', async (req, res) => {
    try {
      const { cookie } = req.body || {};
      const logs: string[] = [];
      const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        logs.push(`[${time}] ${msg}`);
      };

      if (!cookie || !cookie.trim()) {
        addLog('[GoogleAuth Error] Chưa có Cookie. Vui lòng dán cookie từ gemini.google.com (__Secure-1PSID).');
        return res.json({
          success: false,
          tokenReady: false,
          error: 'Chưa có Cookie. Vui lòng đăng nhập gemini.google.com trên trình duyệt, copy cookie (__Secure-1PSID) và dán vào ô bên dưới.',
          logs
        });
      }

      addLog('[GeminiWeb] Đang gửi yêu cầu xác thực phiên thật tới https://gemini.google.com/app...');
      const session = await validateAndExtractGeminiWebSession(cookie.trim());

      if (!session.valid || !session.snlm0e) {
        addLog(`[GeminiWeb Auth Failed] ${session.error || 'Phiên Google Cookie không hợp lệ hoặc đã hết hạn.'}`);
        return res.json({
          success: false,
          tokenReady: false,
          error: session.error || 'Cookie Google không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
          logs
        });
      }

      addLog('[GeminiWeb] Trích xuất thành công mã định danh SNlM0e bảo mật từ Google Gemini Web.');
      if (session.email) {
        addLog(`[GeminiWeb] Tài khoản Google nhận diện: ${session.email}`);
      }
      addLog(`[GeminiWeb] Token SNlM0e: ${session.snlm0e.slice(0, 12)}... (Xác thực thực tế 100%)`);
      addLog('[GeminiWeb] Sẵn sàng gửi câu lệnh trực tiếp qua giao thức Google RPC (Không tốn quota API Key).');

      res.json({
        success: true,
        tokenReady: true,
        token: session.snlm0e,
        email: session.email || 'Tài khoản Google Cá Nhân',
        accountName: session.email ? session.email.split('@')[0] : 'Google User',
        message: '✓ Xác thực Cookie Google thật thành công! Phiên kết nối RPC Gemini Web đã sẵn sàng.',
        logs,
      });
    } catch (err: any) {
      console.error('[Gemini Web Check Token Error]', err);
      res.status(500).json({
        success: false,
        tokenReady: false,
        error: err.message || 'Lỗi kiểm tra token Google Web',
        logs: [`[Error] ${err.message || 'Lỗi kết nối'}`],
      });
    }
  });

  app.post('/api/gemini-web/execute-prompt', async (req, res) => {
    try {
      const { prompt, cookie } = req.body || {};
      const logs: string[] = [];
      const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        logs.push(`[${time}] ${msg}`);
      };

      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Missing prompt' });
      }

      if (!cookie || !cookie.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Thiếu Cookie phiên Google. Vui lòng thiết lập Cookie ở mục Cài Đặt (Mode 3: Google Account).'
        });
      }

      addLog(`[GeminiWeb RPC] Đang chuẩn bị gửi câu lệnh (${prompt.length} ký tự) tới Google Web backend...`);
      
      const session = await validateAndExtractGeminiWebSession(cookie.trim());
      if (!session.valid || !session.snlm0e) {
        addLog(`[GeminiWeb RPC Error] ${session.error || 'Cookie Google đã hết hạn.'}`);
        return res.status(401).json({
          success: false,
          error: session.error || 'Cookie Google đã hết hạn. Vui lòng cập nhật Cookie mới.',
          logs
        });
      }

      addLog('[GeminiWeb RPC] Đang gọi API nội bộ Google BardFrontendService/StreamGenerate...');
      const rpcResult = await executeGeminiWebPrompt(prompt, session);

      if (!rpcResult.success || !rpcResult.text) {
        addLog(`[GeminiWeb RPC Failure] ${rpcResult.error || 'Không nhận được văn bản từ Google Web.'}`);
        return res.status(502).json({
          success: false,
          error: rpcResult.error || 'Không nhận được kết quả dịch từ Google Gemini Web.',
          logs
        });
      }

      addLog('[GeminiWeb RPC] Đã nhận và phân tích thành công phản hồi luồng từ Google Gemini Web.');

      res.json({
        success: true,
        text: rpcResult.text,
        logs,
      });
    } catch (err: any) {
      console.error('[Gemini Web Execute Prompt Error]', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Lỗi thực thi prompt trên Gemini Web RPC',
        logs: [`[Error] ${err.message || 'Lỗi server'}`],
      });
    }
  });

  // Serve Vite in development or static dist in production
  const distPath = path.join(process.cwd(), 'dist');
  const publicPath = path.join(process.cwd(), 'public');

  // Dedicated handler for /ort-wasm to ensure .wasm MIME types & auto-fallback to CDN if missing on disk
  app.get('/ort-wasm/:filename', (req, res) => {
    const filename = req.params.filename;
    const candidates = [
      path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', filename),
      path.join(distPath, 'ort-wasm', filename),
      path.join(publicPath, 'ort-wasm', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        if (filename.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
        }
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.sendFile(p);
      }
    }
    // If missing on disk on cloud environments, redirect to official jsDelivr CDN
    return res.redirect(`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/${encodeURIComponent(filename)}`);
  });

  // Dedicated handler for /models to ensure model files are not served as HTML
  app.get('/models/:filename', (req, res) => {
    const filename = req.params.filename;
    const candidates = [
      path.join(distPath, 'models', filename),
      path.join(publicPath, 'models', filename),
      path.join(distPath, filename),
      path.join(publicPath, filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
        return res.sendFile(p);
      }
    }
    return res.status(404).send('Model file not found');
  });

  // Direct root serving for PaddleOCR model weights & dict files
  app.get('/:filename(*.(onnx|txt))', (req, res, next) => {
    const filename = req.params.filename;
    const candidates = [
      path.join(publicPath, filename),
      path.join(distPath, filename),
      path.join(process.cwd(), filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        res.setHeader('Content-Type', filename.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Range, Accept-Ranges');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(path.resolve(p));
      }
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));

    // Never return index.html for missing asset/binary extensions
    app.get('*', (req, res) => {
      const ext = path.extname(req.path).toLowerCase();
      if (['.wasm', '.onnx', '.ort', '.mjs', '.map', '.bin', '.txt', '.png', '.jpg', '.svg'].includes(ext)) {
        return res.status(404).send('Asset not found');
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
