/**
 * Client-Side License Manager (Secured & Firebase Cloud Authoritative)
 * All license validation and elevation are governed strictly by Firebase Firestore Cloud Database
 * with fallback to backend server and cryptographically signed tokens.
 */

import { getDeviceFingerprint, getSavedUserImei, saveUserImei, DeviceInfo } from './deviceFingerprint';
import {
  syncDeviceToCloudFirestore,
  getCloudLicenseByKey,
  verifyDeviceLicenseWithFirestore,
  activateCloudLicenseInFirestore,
  subscribeRealtimeCloudLicense,
  subscribeRealtimeUserLicense,
  syncUserProfileOnLogin,
  signInWithGoogle,
  logOutFirebase,
  getFirebaseUser,
  initFirebaseAuthListener,
  ResolvedCloudLicenseState,
  getOrCreateLocalMemberCode,
  ensureMemberTrialInFirestore,
  WHITELISTED_ADMIN_IPS,
  isWhitelistedAdminIp,
  WHITELISTED_ADMIN_MEMBER_CODE,
  WHITELISTED_ADMIN_MEMBER_CODES,
  isWhitelistedAdminMember
} from '../services/firebaseLicenseService';

export {
  WHITELISTED_ADMIN_IPS,
  isWhitelistedAdminIp,
  WHITELISTED_ADMIN_MEMBER_CODE,
  WHITELISTED_ADMIN_MEMBER_CODES,
  isWhitelistedAdminMember
};

export interface LicenseState {
  isPro: boolean;
  isAdmin: boolean;
  plan: 'free' | 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'admin';
  role: 'user' | 'pro' | 'admin';
  memberCode?: string;
  key?: string;
  token?: string;
  status: 'inactive' | 'active' | 'expired' | 'suspended';
  expiresAt: number | null; // null = lifetime
  remainingDays?: number;
  trialDays?: number;
  maxDevices: number;
  activatedCount: number;
  note?: string;
  deviceId: string;
  imei?: string;
  isWhitelistedAdmin?: boolean;
  cloudSynced?: boolean;
  userUid?: string;
  userEmail?: string;
  userDisplayName?: string;
  userPhotoURL?: string;
}

const STORAGE_LICENSE_STATE_KEY = 'bach_active_license_state_v3';
const STORAGE_LICENSE_KEY = 'bach_active_license_key_v3';
const STORAGE_LICENSE_TOKEN_KEY = 'bach_license_token_v3';

type LicenseChangeListener = (state: LicenseState) => void;
const listeners: Set<LicenseChangeListener> = new Set();
let isCloudListenerStarted = false;
let isAuthListenerStarted = false;
let userUnsubscribe: (() => void) | null = null;

export function subscribeLicenseState(fn: LicenseChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(state: LicenseState) {
  listeners.forEach(fn => {
    try { fn(state); } catch (e) { console.error('[LicenseManager] listener error:', e); }
  });
}

/**
 * Returns default Free / Trial Tier state (3 days free trial on first launch)
 */
export function getDefaultFreeState(deviceId: string, imei?: string): LicenseState {
  const memberCode = getOrCreateLocalMemberCode(deviceId);
  const isWhitelisted = isWhitelistedAdminMember(memberCode);
  if (isWhitelisted) {
    return {
      isPro: true,
      isAdmin: true,
      plan: 'admin',
      role: 'admin',
      memberCode,
      status: 'active',
      expiresAt: null,
      remainingDays: 99999,
      maxDevices: 5,
      activatedCount: 1,
      deviceId,
      imei,
      note: 'Quản trị viên hệ thống',
      cloudSynced: true
    };
  }

  // Check if first launch timestamp exists locally to provide smooth instant experience while Firestore/Server loads
  const FIRST_LAUNCH_KEY = 'bach_app_first_launch_v3';
  let firstLaunch = 0;
  try {
    const raw = localStorage.getItem(FIRST_LAUNCH_KEY);
    if (raw) {
      firstLaunch = parseInt(raw, 10);
    } else {
      firstLaunch = Date.now();
      localStorage.setItem(FIRST_LAUNCH_KEY, String(firstLaunch));
    }
  } catch (_) {
    firstLaunch = Date.now();
  }

  const trialDuration = 3 * 24 * 60 * 60 * 1000;
  const trialExpiresAt = firstLaunch + trialDuration;
  const now = Date.now();
  const isTrialActive = now <= trialExpiresAt;
  const remainingDays = isTrialActive ? Math.max(0, Math.ceil((trialExpiresAt - now) / 86400000)) : 0;

  return {
    isPro: isTrialActive,
    isAdmin: false,
    plan: 'trial',
    role: 'user',
    memberCode,
    status: isTrialActive ? 'active' : 'expired',
    expiresAt: trialExpiresAt,
    remainingDays,
    maxDevices: 2,
    activatedCount: 1,
    deviceId,
    imei,
    note: isTrialActive ? `Dùng thử miễn phí 3 ngày (${remainingDays} ngày còn lại)` : 'Đã hết hạn 3 ngày dùng thử. Vui lòng liên hệ Admin.',
    cloudSynced: false
  };
}

/**
 * Perform Google Sign-In and retrieve Google UID license
 */
export async function loginWithGoogleAccount(): Promise<{ success: boolean; message: string; state?: LicenseState }> {
  try {
    const user = await signInWithGoogle();
    if (!user) {
      return { success: false, message: 'Đăng nhập Google không thành công.' };
    }

    const deviceInfo = await getDeviceFingerprint();
    const cloudState = await syncUserProfileOnLogin(user, deviceInfo);

    const fullState: LicenseState = {
      ...cloudState,
      token: getStoredLicenseToken()
    };

    saveLocalState(fullState);

    // Setup user realtime listener
    if (userUnsubscribe) {
      userUnsubscribe();
    }
    userUnsubscribe = subscribeRealtimeUserLicense(user.uid, (updatedState) => {
      if (updatedState) {
        saveLocalState({
          ...updatedState,
          deviceId: deviceInfo.deviceId,
          token: getStoredLicenseToken()
        });
      }
    });

    return {
      success: true,
      message: `✓ Đăng nhập thành công với tài khoản ${user.email}!`,
      state: fullState
    };
  } catch (err: any) {
    console.error('[LicenseManager] Google Sign In error:', err);
    return {
      success: false,
      message: 'Lỗi đăng nhập Google: ' + (err.message || 'Hủy thao tác')
    };
  }
}

/**
 * Logout Google Account and reset to local free state
 */
export async function logoutGoogleAccount(): Promise<{ success: boolean; message: string }> {
  try {
    await logOutFirebase();
    if (userUnsubscribe) {
      userUnsubscribe();
      userUnsubscribe = null;
    }

    const current = await getCurrentLicenseState();
    const freeState = getDefaultFreeState(current.deviceId, current.imei);
    saveLocalState(freeState);

    return { success: true, message: 'Đã đăng xuất tài khoản Google.' };
  } catch (err: any) {
    return { success: false, message: 'Lỗi đăng xuất: ' + (err.message || 'Lỗi mạng') };
  }
}

/**
 * Get stored cryptographic license token for authenticated API calls
 */
export function getStoredLicenseToken(): string {
  try {
    return localStorage.getItem(STORAGE_LICENSE_TOKEN_KEY) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Saves verified license state and signed token to local storage
 */
export function saveLocalState(state: LicenseState, token?: string) {
  try {
    localStorage.setItem(STORAGE_LICENSE_STATE_KEY, JSON.stringify(state));
    if (state.key) {
      localStorage.setItem(STORAGE_LICENSE_KEY, state.key);
    }
    if (token) {
      localStorage.setItem(STORAGE_LICENSE_TOKEN_KEY, token);
    }
  } catch (_) {}
  notifyListeners(state);
}

/**
 * Auto-ensure device license with Firebase Firestore Cloud & Server on startup
 */
export async function ensureAndSyncDeviceLicense(): Promise<LicenseState> {
  const deviceInfo = await getDeviceFingerprint();
  const currentImei = getSavedUserImei() || deviceInfo.imei || '';
  const storedToken = getStoredLicenseToken();

  // 1. Start live Real-time Firestore Listener if not yet started
  if (!isCloudListenerStarted && deviceInfo.deviceId) {
    isCloudListenerStarted = true;
    subscribeRealtimeCloudLicense(deviceInfo.deviceId, (cloudState) => {
      if (cloudState) {
        console.log('[Firebase Realtime] Live License Update received from Firestore:', cloudState);
        const fullState: LicenseState = {
          ...cloudState,
          token: getStoredLicenseToken()
        };
        saveLocalState(fullState);
      }
    });
  }

  // 2. Direct Cloud Verification with Firebase Firestore
  try {
    const cloudVerified = await verifyDeviceLicenseWithFirestore(deviceInfo);
    if (cloudVerified) {
      console.log('[Firebase Cloud] Device verified directly via Firestore Cloud:', cloudVerified);
      const cloudState: LicenseState = {
        ...cloudVerified,
        token: storedToken
      };
      saveLocalState(cloudState);
      return cloudState;
    }
  } catch (err) {
    console.warn('[Firebase Cloud] Direct Firestore check warning:', err);
  }

  // 3. Sync with local server API
  try {
    const res = await fetch('/api/license/ensure-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-license-token': storedToken
      },
      body: JSON.stringify({
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        imei: currentImei
      })
    });
    const data = await res.json();
    if (data.success && data.license) {
      const lic = data.license;
      let remainingDays: number | undefined = undefined;
      if (lic.expiresAt) {
        remainingDays = Math.max(0, Math.ceil((lic.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      }

      const isProOrAdmin = lic.status === 'active' && (!lic.expiresAt || Date.now() <= lic.expiresAt);
      const memberCode = lic.memberCode || getOrCreateLocalMemberCode(deviceInfo.deviceId);

      const state: LicenseState = {
        isPro: isProOrAdmin,
        isAdmin: lic.role === 'admin' || lic.isSuperAdmin,
        plan: lic.plan,
        role: lic.role,
        memberCode,
        key: lic.key,
        token: data.licenseToken || storedToken,
        status: isProOrAdmin ? 'active' : 'expired',
        expiresAt: lic.expiresAt,
        remainingDays,
        maxDevices: lic.maxDevices || 1,
        activatedCount: lic.activatedCount || 1,
        note: lic.note,
        deviceId: deviceInfo.deviceId,
        imei: currentImei,
        isWhitelistedAdmin: lic.isSuperAdmin,
        cloudSynced: true
      };

      saveLocalState(state, data.licenseToken);

      // Auto mirror to Firestore Cloud
      syncDeviceToCloudFirestore({
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        imei: currentImei,
        licenseKey: lic.key,
        plan: lic.plan,
        role: lic.role,
        status: isProOrAdmin ? 'active' : 'expired',
        expiresAt: lic.expiresAt,
        note: lic.note,
        isSuperAdmin: lic.isSuperAdmin
      }).catch(() => {});

      return state;
    }
  } catch (e) {
    console.warn('[LicenseManager] Server ensure-device fallback:', e);
  }

  // 4. Ensure Member Profile & Member Code in Firestore
  try {
    const trialInfo = await ensureMemberTrialInFirestore(deviceInfo.deviceId, deviceInfo.deviceName);
    if (trialInfo) {
      const trialState: LicenseState = {
        isPro: trialInfo.isPro,
        isAdmin: false,
        plan: trialInfo.isPro ? 'trial' : 'free',
        role: 'user',
        memberCode: trialInfo.memberCode,
        status: trialInfo.status,
        expiresAt: trialInfo.expiresAt,
        remainingDays: trialInfo.remainingDays,
        maxDevices: 2,
        activatedCount: 1,
        note: trialInfo.isPro ? 'Dùng thử' : 'Chưa kích hoạt bản quyền',
        deviceId: deviceInfo.deviceId,
        imei: currentImei,
        cloudSynced: true
      };
      saveLocalState(trialState);
      return trialState;
    }
  } catch (err) {
    console.warn('[LicenseManager] Member ensure warning:', err);
  }

  return getCurrentLicenseState();
}

/**
 * Retrieves the cached License State (falls back to safe default if unverified)
 */
export async function getCurrentLicenseState(): Promise<LicenseState> {
  const deviceInfo = await getDeviceFingerprint();
  const currentImei = getSavedUserImei() || deviceInfo.imei || '';
  const memberCode = getOrCreateLocalMemberCode(deviceInfo.deviceId);

  if (isWhitelistedAdminMember(memberCode)) {
    return {
      isPro: true,
      isAdmin: true,
      plan: 'admin',
      role: 'admin',
      memberCode,
      status: 'active',
      expiresAt: null,
      remainingDays: 99999,
      maxDevices: 5,
      activatedCount: 1,
      deviceId: deviceInfo.deviceId,
      imei: currentImei,
      note: 'Quản trị viên hệ thống',
      cloudSynced: true
    };
  }

  let localState: LicenseState | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_LICENSE_STATE_KEY);
    if (raw) {
      localState = JSON.parse(raw);
    }
  } catch (_) {}

  if (localState) {
    if (localState.isAdmin || isWhitelistedAdminMember(localState.memberCode)) {
      return { ...localState, isPro: true, isAdmin: true, status: 'active', remainingDays: 99999 };
    }

    if (localState.status === 'active') {
      // Check if expired
      if (localState.expiresAt && Date.now() > localState.expiresAt) {
        localState.status = 'expired';
        localState.isPro = false;
        localState.isAdmin = false;
        localState.remainingDays = 0;
        saveLocalState(localState);
        return localState;
      }

      // Calculate remaining days
      if (localState.expiresAt) {
        const ms = localState.expiresAt - Date.now();
        localState.remainingDays = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
      } else {
        localState.remainingDays = 99999;
      }

      localState.token = getStoredLicenseToken();
      return localState;
    }
  }

  return getDefaultFreeState(deviceInfo.deviceId, currentImei);
}

/**
 * Activate a License Key using Firebase Firestore Cloud & Server
 */
export async function activateLicenseKey(
  key: string,
  options?: { imei?: string; deviceName?: string }
): Promise<{ success: boolean; message: string; state?: LicenseState }> {
  const deviceInfo = await getDeviceFingerprint();
  const inputImei = options?.imei?.trim() || getSavedUserImei() || deviceInfo.imei || '';
  const cleanKey = key.trim().toUpperCase();

  if (inputImei) {
    saveUserImei(inputImei);
  }

  // 1. Try Firebase Firestore Cloud Activation First
  try {
    const cloudRes = await activateCloudLicenseInFirestore(cleanKey, deviceInfo);
    if (cloudRes.success && cloudRes.record) {
      const lic = cloudRes.record;
      let remainingDays: number | undefined = undefined;
      if (lic.expiresAt) {
        remainingDays = Math.max(0, Math.ceil((lic.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      }

      const isProOrAdmin = lic.status === 'active' && (!lic.expiresAt || Date.now() <= lic.expiresAt);
      const newState: LicenseState = {
        isPro: isProOrAdmin,
        isAdmin: lic.role === 'admin',
        plan: lic.plan,
        role: lic.role,
        key: lic.key,
        status: 'active',
        expiresAt: lic.expiresAt,
        remainingDays,
        maxDevices: lic.maxDevices || 2,
        activatedCount: lic.activatedDevices?.length || 1,
        note: lic.note,
        deviceId: deviceInfo.deviceId,
        imei: inputImei,
        cloudSynced: true
      };

      saveLocalState(newState);

      // Also notify backend server for token signing
      fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: cleanKey,
          deviceId: deviceInfo.deviceId,
          deviceName: options?.deviceName || deviceInfo.deviceName,
          imei: inputImei
        })
      }).then(async (res) => {
        const d = await res.json();
        if (d.licenseToken) {
          saveLocalState(newState, d.licenseToken);
        }
      }).catch(() => {});

      return {
        success: true,
        message: '✓ Kích hoạt bản quyền qua Firebase Firestore thành công!',
        state: newState
      };
    }
  } catch (cloudErr) {
    console.warn('[Firebase Cloud] Firestore activation warning:', cloudErr);
  }

  // 2. Fallback to Local Server Activation
  try {
    const response = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: cleanKey,
        deviceId: deviceInfo.deviceId,
        deviceName: options?.deviceName || deviceInfo.deviceName,
        imei: inputImei
      })
    });

    const data = await response.json();
    if (!data.success || !data.license) {
      return { success: false, message: data.message || 'Kích hoạt bản quyền thất bại' };
    }

    const lic = data.license;
    let remainingDays: number | undefined = undefined;
    if (lic.expiresAt) {
      remainingDays = Math.max(0, Math.ceil((lic.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
    }

    const newState: LicenseState = {
      isPro: true,
      isAdmin: lic.role === 'admin' || lic.isSuperAdmin,
      plan: lic.plan,
      role: lic.role,
      key: lic.key,
      token: data.licenseToken,
      status: 'active',
      expiresAt: lic.expiresAt,
      remainingDays,
      maxDevices: lic.maxDevices || 2,
      activatedCount: lic.activatedCount || 1,
      note: lic.note,
      deviceId: deviceInfo.deviceId,
      imei: inputImei,
      isWhitelistedAdmin: lic.isSuperAdmin,
      cloudSynced: true
    };

    saveLocalState(newState, data.licenseToken);

    // Sync active license & device to Firebase Firestore Cloud
    syncDeviceToCloudFirestore({
      deviceId: deviceInfo.deviceId,
      deviceName: options?.deviceName || deviceInfo.deviceName,
      imei: inputImei,
      licenseKey: lic.key,
      plan: lic.plan,
      role: lic.role,
      status: 'active',
      expiresAt: lic.expiresAt
    }).catch(() => {});

    return {
      success: true,
      message: data.message || 'Kích hoạt bản quyền thành công!',
      state: newState
    };
  } catch (err: any) {
    console.error('[LicenseManager] activate error:', err);
    return {
      success: false,
      message: 'Không thể kết nối đến máy chủ xác thực bản quyền: ' + (err.message || 'Lỗi mạng')
    };
  }
}

/**
 * Verify current License state with Firebase Firestore & Server
 */
export async function syncVerifyLicense(): Promise<LicenseState> {
  const current = await getCurrentLicenseState();
  const token = getStoredLicenseToken();
  const deviceInfo = await getDeviceFingerprint();

  // 1. Check with Firestore Cloud first
  try {
    const cloudVerified = await verifyDeviceLicenseWithFirestore(deviceInfo);
    if (cloudVerified && cloudVerified.isPro) {
      const updatedState: LicenseState = {
        ...cloudVerified,
        token
      };
      saveLocalState(updatedState);
      return updatedState;
    }
  } catch (err) {
    console.warn('[Firebase Cloud] syncVerifyLicense check warning:', err);
  }

  if (!current.key && !token) {
    return current;
  }

  // 2. Fallback to Server verify
  try {
    const response = await fetch('/api/license/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-license-token': token
      },
      body: JSON.stringify({
        key: current.key,
        deviceId: current.deviceId,
        imei: current.imei
      })
    });
    const data = await response.json();
    if (data.valid && data.license) {
      const lic = data.license;
      let remainingDays: number | undefined = undefined;
      if (lic.expiresAt) {
        remainingDays = Math.max(0, Math.ceil((lic.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
      }

      const updatedState: LicenseState = {
        ...current,
        isPro: true,
        isAdmin: lic.role === 'admin' || lic.isSuperAdmin,
        plan: lic.plan,
        role: lic.role,
        status: lic.status,
        expiresAt: lic.expiresAt,
        remainingDays,
        maxDevices: lic.maxDevices,
        activatedCount: lic.activatedCount,
        note: lic.note,
        token: data.licenseToken || token,
        cloudSynced: true
      };
      saveLocalState(updatedState, data.licenseToken);
      return updatedState;
    } else {
      const freeState = getDefaultFreeState(current.deviceId, current.imei);
      saveLocalState(freeState);
      return freeState;
    }
  } catch (_) {
    return current;
  }
}

/**
 * Deactivate license on this device
 */
export async function deactivateCurrentLicense(): Promise<{ success: boolean; message: string }> {
  const current = await getCurrentLicenseState();
  const token = getStoredLicenseToken();

  if (current.key) {
    try {
      await fetch('/api/license/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-license-token': token
        },
        body: JSON.stringify({
          key: current.key,
          deviceId: current.deviceId
        })
      });
    } catch (_) {}
  }

  // Remove from Firestore device doc licenseKey
  if (current.deviceId) {
    syncDeviceToCloudFirestore({
      deviceId: current.deviceId,
      licenseKey: '',
      plan: 'trial',
      role: 'user',
      status: 'inactive',
      expiresAt: null
    }).catch(() => {});
  }

  try {
    localStorage.removeItem(STORAGE_LICENSE_KEY);
    localStorage.removeItem(STORAGE_LICENSE_STATE_KEY);
    localStorage.removeItem(STORAGE_LICENSE_TOKEN_KEY);
  } catch (_) {}

  const freeState = getDefaultFreeState(current.deviceId, current.imei);
  notifyListeners(freeState);

  return { success: true, message: 'Đã hủy kích hoạt bản quyền trên thiết bị này.' };
}
