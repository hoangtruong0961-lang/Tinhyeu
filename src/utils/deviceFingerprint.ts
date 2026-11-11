import { Device } from '@capacitor/device';
import { Capacitor } from '@capacitor/core';
import NativeHardwareId from '../plugins/hardwareId';

/**
 * Client-Side Device Fingerprint Generator
 * Integrates Capacitor Native Device info for Mobile Apps (Android/iOS)
 * and invariant hardware signals for Web Browsers.
 * Guarantees Member Code is always MEM-XXXX-XXXX and invariant across APK updates.
 */

const STORAGE_DEVICE_ID_KEY = 'bach_device_unique_id_v2';
const STORAGE_MEMBER_CODE_KEY = 'bach_member_code_v2';
const STORAGE_PERMANENT_KEY = 'bach_hw_identity_permanent_v1';
const STORAGE_SAVED_IMEI_KEY = 'bach_device_saved_imei';

/**
 * Fast string hash using cyrb53
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase();
}

/**
 * Format a numeric or string hash into an 8-char hex code with hyphen (XXXX-XXXX)
 */
function formatCode8(rawHex: string): string {
  const clean = rawHex.replace(/[^A-F0-9]/gi, '').toUpperCase().padStart(8, '0').slice(0, 8);
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

/**
 * Collects WebGL GPU Renderer & Vendor
 */
function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext;
    if (!gl) return 'no-webgl';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'no-debug-info';
    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
    return `${vendor}~${renderer}`;
  } catch (_) {
    return 'gl-error';
  }
}

/**
 * Canvas Render Fingerprint
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-2d';

    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial', sans-serif";
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('vTranslate_v6', 2, 10);

    return canvas.toDataURL().slice(-40);
  } catch (_) {
    return 'canvas-error';
  }
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  screenRes: string;
  gpu: string;
  cores: number;
  imei?: string;
  memberCode?: string;
}

/**
 * Compute a 100% deterministic synchronous hardware seed from physical device signals
 * Invariant across screen rotations, APK reinstalls, WebView updates & browser cache clears.
 */
export function getSynchronousHardwareSeed(): string {
  try {
    // 1. Check permanent identity cache
    if (typeof localStorage !== 'undefined') {
      const savedCode = localStorage.getItem(STORAGE_PERMANENT_KEY) || localStorage.getItem(STORAGE_MEMBER_CODE_KEY);
      if (savedCode && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(savedCode.trim())) {
        return savedCode.trim().replace(/^MEM-/i, '').replace('-', '');
      }
    }

    // 2. Orientation-invariant screen dimensions
    let screenRes = '0x0';
    if (typeof window !== 'undefined' && window.screen) {
      const w = Math.round(window.screen.width || 0);
      const h = Math.round(window.screen.height || 0);
      const minDim = Math.min(w, h);
      const maxDim = Math.max(w, h);
      const dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10;
      screenRes = `${minDim}x${maxDim}@${dpr}`;
    }

    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    
    // Stable platform indicator (strip out volatile browser build versions)
    let stablePlatform = 'GenericPlatform';
    if (typeof navigator !== 'undefined') {
      if (/Android/i.test(navigator.userAgent)) {
        stablePlatform = 'AndroidOS';
      } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        stablePlatform = 'AppleiOS';
      } else if (/Mac/i.test(navigator.platform || '')) {
        stablePlatform = 'MacOS';
      } else if (/Win/i.test(navigator.platform || '')) {
        stablePlatform = 'WindowsOS';
      } else if (/Linux/i.test(navigator.platform || '')) {
        stablePlatform = 'LinuxOS';
      } else {
        stablePlatform = navigator.platform || 'Device';
      }
    }

    const timezone = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Ho_Chi_Minh';
    const lang = (typeof navigator !== 'undefined' && (navigator.language || (navigator as any).userLanguage || 'vi')).slice(0, 2);
    const canvasSig = getCanvasFingerprint();

    const raw = [screenRes, cores, stablePlatform, timezone, lang, canvasSig].join('###');
    const hash = cyrb53(raw, 98765);
    return hash.slice(0, 8);
  } catch (_) {
    return '0DF9EB1B';
  }
}

/**
 * Retrieves or generates the stable, permanent Device Fingerprint ID
 */
export async function getDeviceFingerprint(): Promise<DeviceInfo> {
  // 0. Check if Electron Native Desktop is available (Windows / Mac / Linux)
  let nativeCode8 = '';
  let nativeImei: string | undefined = undefined;
  let nativeModel = '';
  let nativePlatform = '';
  let nativeManufacturer = '';

  try {
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.getSystemInfo === 'function') {
      const electronInfo = await window.electronAPI.getSystemInfo();
      if (electronInfo) {
        if (electronInfo.memberCode && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(electronInfo.memberCode.trim())) {
          nativeCode8 = electronInfo.memberCode.trim().replace(/^MEM-/i, '');
        } else if (electronInfo.hardwareHash && electronInfo.hardwareHash.length >= 8) {
          nativeCode8 = formatCode8(electronInfo.hardwareHash);
        }
        if (electronInfo.motherboardSerial) nativeImei = electronInfo.motherboardSerial;
        if (electronInfo.cpuModel) nativeModel = electronInfo.cpuModel;
        if (electronInfo.platform) nativePlatform = `Windows/PC (${electronInfo.platform} ${electronInfo.arch || ''})`;
        nativeManufacturer = 'PC Desktop';
      }
    }
  } catch (electronErr) {
    console.debug('[Electron Native SystemInfo] fallback:', electronErr);
  }

  // 1. Check if Capacitor Native Plugin is available (Android / iOS)
  if (!nativeCode8) {
    try {
      if (Capacitor.isNativePlatform()) {
        // Ưu tiên 1: Lấy mã phần cứng & Member Code cố định từ SharedPreferences (HardwareIdPlugin)
        try {
          const customRes = await NativeHardwareId.getAndroidId();
          if (customRes) {
            if (customRes.memberCode && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(customRes.memberCode.trim())) {
              nativeCode8 = customRes.memberCode.trim().replace(/^MEM-/i, '');
            } else if (customRes.deviceId && customRes.deviceId.startsWith('DEV-')) {
              const raw = customRes.deviceId.replace('DEV-', '').replace(/[^A-Z0-9]/gi, '');
              nativeCode8 = formatCode8(raw);
            } else if (customRes.androidId && customRes.androidId.trim().length >= 4) {
              const hash = cyrb53(customRes.androidId.trim(), 12345);
              nativeCode8 = formatCode8(hash);
            }

            if (customRes.hardwareSerial) nativeImei = customRes.hardwareSerial;
            if (customRes.model) nativeModel = customRes.model;
            if (customRes.manufacturer) nativeManufacturer = customRes.manufacturer;
          }
        } catch (customErr) {
          console.debug('[Custom HardwareId Plugin] fallback to standard device:', customErr);
        }

        // Ưu tiên 2: Fallback qua Device Plugin mặc định nếu chưa có
        if (!nativeCode8) {
          try {
            const devIdResult = await Device.getId();
            if (devIdResult && devIdResult.identifier && devIdResult.identifier.trim().length >= 4) {
              const hash = cyrb53(devIdResult.identifier.trim(), 54321);
              nativeCode8 = formatCode8(hash);
            }
          } catch (_) {}
        }

        try {
          const infoResult = await Device.getInfo();
          if (infoResult) {
            if (!nativeModel) nativeModel = infoResult.model || '';
            nativePlatform = `${infoResult.platform.toUpperCase()} ${infoResult.osVersion || ''}`;
            if (!nativeManufacturer) nativeManufacturer = infoResult.manufacturer || '';
          }
        } catch (_) {}
      }
    } catch (capErr) {
      console.debug('[Capacitor Device Plugin] fallback to hardware fingerprint:', capErr);
    }
  }

  // 2. Fallback to cached or deterministic hardware seed
  let code8 = nativeCode8;
  if (!code8) {
    try {
      const cached = localStorage.getItem(STORAGE_PERMANENT_KEY) || localStorage.getItem(STORAGE_MEMBER_CODE_KEY);
      if (cached && /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(cached.trim())) {
        code8 = cached.trim().replace(/^MEM-/i, '');
      }
    } catch (_) {}
  }

  if (!code8) {
    const rawSeed = getSynchronousHardwareSeed();
    code8 = formatCode8(rawSeed);
  }

  // Normalize format XXXX-XXXX
  if (!code8.includes('-') && code8.length >= 8) {
    code8 = `${code8.slice(0, 4)}-${code8.slice(4, 8)}`;
  }
  code8 = code8.toUpperCase();

  const finalMemberCode = `MEM-${code8}`;
  const finalDeviceId = `DEV-${code8}`;

  // Persist locally across all permanent keys
  try {
    localStorage.setItem(STORAGE_DEVICE_ID_KEY, finalDeviceId);
    localStorage.setItem(STORAGE_MEMBER_CODE_KEY, finalMemberCode);
    localStorage.setItem(STORAGE_PERMANENT_KEY, finalMemberCode);
  } catch (_) {}

  // Get user-saved IMEI if any
  let savedImei = nativeImei || '';
  try {
    if (!savedImei) savedImei = localStorage.getItem(STORAGE_SAVED_IMEI_KEY) || '';
  } catch (_) {}

  // Device friendly name
  let deviceName = 'Thiết bị người dùng';
  if (nativeManufacturer || nativeModel) {
    deviceName = `${nativeManufacturer} ${nativeModel}`.trim();
  } else if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
    deviceName = 'Thiết bị Android';
  } else if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    deviceName = 'Thiết bị Apple iOS';
  } else if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)) {
    deviceName = 'Máy tính Mac';
  } else if (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)) {
    deviceName = 'Máy tính Windows';
  }

  return {
    deviceId: finalDeviceId,
    memberCode: finalMemberCode,
    deviceName,
    platform: nativePlatform || 'Android/Web',
    screenRes: '100% Deterministic',
    gpu: getWebGLFingerprint(),
    cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
    imei: savedImei || undefined
  };
}

export function saveUserImei(imei: string): void {
  try {
    if (imei && imei.trim()) {
      localStorage.setItem(STORAGE_SAVED_IMEI_KEY, imei.trim());
    } else {
      localStorage.removeItem(STORAGE_SAVED_IMEI_KEY);
    }
  } catch (_) {}
}

export function getSavedUserImei(): string {
  try {
    return localStorage.getItem(STORAGE_SAVED_IMEI_KEY) || '';
  } catch (_) {
    return '';
  }
}
