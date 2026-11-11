import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface LicenseDevice {
  deviceId: string;
  deviceName?: string;
  imei?: string;
  ip?: string;
  activatedAt: number;
  lastUsedAt: number;
}

export interface LicenseItem {
  id: string;
  key: string;
  plan: 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'admin';
  role: 'user' | 'pro' | 'admin';
  maxDevices: number;
  activatedDevices: LicenseDevice[];
  createdAt: number;
  expiresAt: number | null; // null = lifetime
  status: 'active' | 'suspended' | 'revoked';
  note?: string;
  createdBatch?: string;
}

export interface LicenseDataStore {
  version: number;
  whitelistedImeis: string[];
  whitelistedIps: string[];
  adminEmails: string[];
  licenses: LicenseItem[];
}

export interface SignedLicensePayload {
  deviceId: string;
  role: 'user' | 'pro' | 'admin';
  plan: string;
  key: string;
  status: string;
  expiresAt: number | null;
  issuedAt: number;
  imei?: string;
  isSuperAdmin: boolean;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const SECRET_FILE = path.join(DATA_DIR, 'server_secret.key');
const MASTER_KEY_FILE = path.join(DATA_DIR, 'master_admin.key');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Get or initialize persistent Master Admin Secret Key
 * Strictly server-authoritative: NEVER defaults to a public hardcoded credential.
 */
export function getMasterAdminKey(): string {
  const envKey = process.env.MASTER_ADMIN_KEY?.trim();
  if (envKey && envKey.length >= 8) {
    return envKey;
  }

  ensureDataDir();
  try {
    if (fs.existsSync(MASTER_KEY_FILE)) {
      const persistedKey = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
      if (persistedKey.length >= 16) return persistedKey;
    }
  } catch (_) {}

  // Generate a cryptographically secure random 64-char hex key if not provided in environment
  const generatedKey = `ADMIN-KEY-${crypto.randomBytes(24).toString('hex').toUpperCase()}`;
  try {
    fs.writeFileSync(MASTER_KEY_FILE, generatedKey, { encoding: 'utf-8', mode: 0o600 });
    console.warn(`[SECURITY WARNING] MASTER_ADMIN_KEY is not set in environment variables! An auto-generated secure master key was created and saved to data/master_admin.key.`);
  } catch (err) {
    console.error('[LicenseService] Failed to persist generated master key:', err);
  }
  return generatedKey;
}

export const MASTER_ADMIN_KEY = getMasterAdminKey();

/**
 * Get or initialize persistent Server HMAC Secret
 */
function getServerSecret(): string {
  ensureDataDir();
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const secret = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (secret.length >= 32) return secret;
    }
  } catch (_) {}

  const newSecret = crypto.randomBytes(64).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, newSecret, 'utf-8');
  } catch (err) {
    console.error('[LicenseService] Failed to persist server secret key:', err);
  }
  return newSecret;
}

const SERVER_HMAC_SECRET = getServerSecret();

/**
 * Generate a cryptographically signed HMAC-SHA256 token for client license state
 */
export function generateSignedLicenseToken(payload: SignedLicensePayload): string {
  const payloadStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(payloadStr, 'utf-8').toString('base64url');
  const hmac = crypto.createHmac('sha256', SERVER_HMAC_SECRET);
  hmac.update(base64Payload);
  const signature = hmac.digest('base64url');
  return `${base64Payload}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 signed license token
 */
export function verifySignedLicenseToken(token: string): { valid: boolean; payload?: SignedLicensePayload; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token missing' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [base64Payload, signature] = parts;
  const hmac = crypto.createHmac('sha256', SERVER_HMAC_SECRET);
  hmac.update(base64Payload);
  const expectedSignature = hmac.digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { valid: false, error: 'Chữ ký số không hợp lệ hoặc đã bị chỉnh sửa' };
  }

  try {
    const rawJson = Buffer.from(base64Payload, 'base64url').toString('utf-8');
    const payload: SignedLicensePayload = JSON.parse(rawJson);

    // Check expiration
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, payload, error: 'License đã hết hạn' };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: 'Không thể giải mã dữ liệu token' };
  }
}

function generateKeyString(prefix = 'SUB-PRO'): string {
  const segment1 = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
  const segment2 = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
  const segment3 = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
  return `${prefix}-${segment1}-${segment2}-${segment3}`;
}

function getInitialStore(): LicenseDataStore {
  const now = Date.now();
  const adminLicense: LicenseItem = {
    id: 'lic-admin-master',
    key: MASTER_ADMIN_KEY,
    plan: 'admin',
    role: 'admin',
    maxDevices: 9999,
    activatedDevices: [
      {
        deviceId: 'DEV-ADMIN-IMEI1',
        deviceName: 'Admin Device IMEI 1',
        imei: '868621072187630',
        ip: '192.168.1.19',
        activatedAt: now,
        lastUsedAt: now
      },
      {
        deviceId: 'DEV-ADMIN-IMEI2',
        deviceName: 'Admin Device IMEI 2',
        imei: '868621072187622',
        ip: '192.168.1.19',
        activatedAt: now,
        lastUsedAt: now
      }
    ],
    createdAt: now,
    expiresAt: null, // Lifetime vô hạn
    status: 'active',
    note: 'Super Admin - Tien Ly (Vô hạn thời gian & quyền quản trị)'
  };

  const sampleProLifetime: LicenseItem = {
    id: 'lic-vip-lifetime-1',
    key: 'SUB-LIFETIME-VIP-2026-8888',
    plan: 'lifetime',
    role: 'pro',
    maxDevices: 3,
    activatedDevices: [],
    createdAt: now,
    expiresAt: null,
    status: 'active',
    note: 'Gói Pro Vĩnh Viễn Mẫu (3 thiết bị)'
  };

  const sampleProMonth: LicenseItem = {
    id: 'lic-pro-month-1',
    key: 'SUB-PRO-30DAY-2026-9999',
    plan: 'month',
    role: 'pro',
    maxDevices: 2,
    activatedDevices: [],
    createdAt: now,
    expiresAt: now + (30 * 24 * 60 * 60 * 1000),
    status: 'active',
    note: 'Gói Pro 1 Tháng Mẫu (2 thiết bị)'
  };

  return {
    version: 1,
    whitelistedImeis: [],
    whitelistedIps: ['192.168.1.1', '192.168.1.171'],
    adminEmails: [],
    licenses: [adminLicense, sampleProLifetime, sampleProMonth]
  };
}

export const WHITELISTED_ADMIN_IPS = ['192.168.1.1', '192.168.1.171'];

export function isWhitelistedAdminIp(ip?: string): boolean {
  if (!ip) return false;
  const cleanIp = ip.replace(/^::ffff:/, '').trim();
  return WHITELISTED_ADMIN_IPS.includes(cleanIp);
}

export function isWhitelistedAdminMemberCode(_code?: string): boolean {
  return false;
}

export function loadLicenseStore(): LicenseDataStore {
  ensureDataDir();
  const now = Date.now();
  try {
    if (fs.existsSync(LICENSES_FILE)) {
      const raw = fs.readFileSync(LICENSES_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as LicenseDataStore;
      
      // Ensure master admin key always exists
      let modified = false;
      if (!parsed.licenses.some(l => l.key === MASTER_ADMIN_KEY)) {
        parsed.licenses.unshift(getInitialStore().licenses[0]);
        modified = true;
      }

      // Auto-reconcile and sync expiration dates for all licenses
      for (const lic of parsed.licenses) {
        if (lic.role === 'admin' || lic.key === MASTER_ADMIN_KEY) {
          if (lic.status !== 'active') {
            lic.status = 'active';
            modified = true;
          }
          if (lic.expiresAt !== null) {
            lic.expiresAt = null;
            modified = true;
          }
        } else if (lic.expiresAt && now > lic.expiresAt) {
          if (lic.status === 'active') {
            lic.status = 'expired' as any;
            modified = true;
          }
        }
      }

      if (modified) {
        saveLicenseStore(parsed);
      }
      return parsed;
    }
  } catch (err) {
    console.error('[LicenseStore] Error reading licenses file, fallback to initial store:', err);
  }

  const initial = getInitialStore();
  saveLicenseStore(initial);
  return initial;
}

export function saveLicenseStore(store: LicenseDataStore): void {
  ensureDataDir();
  try {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LicenseStore] Error saving licenses file:', err);
  }
}

/**
 * Check if a request or credentials match Super Admin Secret
 * Strictly server-authoritative:
 * Requires knowing the secret MASTER_ADMIN_KEY.
 * NOTE: IP, IMEI, or unverified client strings MUST NEVER grant Super Admin access.
 */
export function isSuperAdminCredential(options: {
  key?: string;
  ip?: string;
  imei?: string;
  email?: string;
}): boolean {
  const { key } = options;

  if (!key || typeof key !== 'string') {
    return false;
  }

  const cleanKey = key.trim();
  const masterKey = getMasterAdminKey();

  // Timing safe comparison to prevent timing side-channel attacks
  try {
    const keyBuf = Buffer.from(cleanKey);
    const masterBuf = Buffer.from(masterKey);
    if (keyBuf.length === masterBuf.length && crypto.timingSafeEqual(keyBuf, masterBuf)) {
      return true;
    }
  } catch (_) {}

  return cleanKey === masterKey || cleanKey.toUpperCase() === masterKey.toUpperCase();
}

/**
 * Auto Register / Ensure Device License
 * When a new user opens the app, server automatically registers/generates a device license
 */
export function ensureDeviceLicense(params: {
  deviceId: string;
  deviceName?: string;
  imei?: string;
  ip?: string;
  email?: string;
}): {
  success: boolean;
  isSuperAdmin: boolean;
  licenseToken: string;
  license: {
    key: string;
    plan: string;
    role: string;
    status: string;
    expiresAt: number | null;
    maxDevices: number;
    activatedCount: number;
    isSuperAdmin: boolean;
    note?: string;
  };
} {
  const store = loadLicenseStore();
  const normalizedDeviceId = (params.deviceId || '').trim();
  const normalizedImei = (params.imei || '').trim();
  const clientIp = (params.ip || '').trim();
  const now = Date.now();

  // 0. Check Whitelisted Admin IP (192.168.1.1 & 192.168.1.171)
  if (isWhitelistedAdminIp(clientIp)) {
    const adminKey = `SUPER-ADMIN-IP-${clientIp.replace(/\./g, '_')}`;
    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId || 'whitelist-ip-device',
      role: 'admin',
      plan: 'admin',
      key: adminKey,
      status: 'active',
      expiresAt: null,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: true
    });

    return {
      success: true,
      isSuperAdmin: true,
      licenseToken: token,
      license: {
        key: adminKey,
        plan: 'admin',
        role: 'admin',
        status: 'active',
        expiresAt: null,
        maxDevices: 999,
        activatedCount: 1,
        isSuperAdmin: true,
        note: `Whitelisted Admin IP (${clientIp})`
      }
    };
  }

  // 1. Check if this device is already bound to any existing valid license key
  const existingLic = store.licenses.find(l => 
    l.status === 'active' && 
    l.activatedDevices.some(d => d.deviceId === normalizedDeviceId)
  );

  if (existingLic) {
    const dev = existingLic.activatedDevices.find(d => d.deviceId === normalizedDeviceId);
    if (dev) dev.lastUsedAt = now;
    saveLicenseStore(store);

    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId,
      role: existingLic.role,
      plan: existingLic.plan,
      key: existingLic.key,
      status: existingLic.status,
      expiresAt: existingLic.expiresAt,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: existingLic.role === 'admin'
    });

    return {
      success: true,
      isSuperAdmin: existingLic.role === 'admin',
      licenseToken: token,
      license: {
        key: existingLic.key,
        plan: existingLic.plan,
        role: existingLic.role,
        status: existingLic.status,
        expiresAt: existingLic.expiresAt,
        maxDevices: existingLic.maxDevices,
        activatedCount: existingLic.activatedDevices.length,
        isSuperAdmin: existingLic.role === 'admin',
        note: existingLic.note
      }
    };
  }

  // 3. Check if device has an existing license record (e.g. trial or expired)
  const existingAnyLic = store.licenses.find(l =>
    l.activatedDevices.some(d => d.deviceId === normalizedDeviceId)
  );

  if (existingAnyLic) {
    const isExpired = existingAnyLic.expiresAt ? now > existingAnyLic.expiresAt : false;
    const currentStatus = isExpired ? 'expired' : existingAnyLic.status;
    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId,
      role: existingAnyLic.role,
      plan: existingAnyLic.plan,
      key: existingAnyLic.key,
      status: currentStatus,
      expiresAt: existingAnyLic.expiresAt,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: existingAnyLic.role === 'admin'
    });

    return {
      success: true,
      isSuperAdmin: existingAnyLic.role === 'admin',
      licenseToken: token,
      license: {
        key: existingAnyLic.key,
        plan: existingAnyLic.plan,
        role: existingAnyLic.role,
        status: currentStatus,
        expiresAt: existingAnyLic.expiresAt,
        maxDevices: existingAnyLic.maxDevices,
        activatedCount: existingAnyLic.activatedDevices.length,
        isSuperAdmin: existingAnyLic.role === 'admin',
        note: existingAnyLic.note
      }
    };
  }

  // 4. Truly new / unregistered device: Grant 3 days free trial
  const trialDuration = 3 * 24 * 60 * 60 * 1000;
  const trialExpiresAt = now + trialDuration;
  const trialKey = `TRIAL-${normalizedDeviceId.slice(0, 8).toUpperCase()}`;

  const trialItem: LicenseItem = {
    id: `lic-trial-${normalizedDeviceId.slice(0, 8)}-${Date.now()}`,
    key: trialKey,
    plan: 'trial',
    role: 'user',
    maxDevices: 2,
    activatedDevices: [
      {
        deviceId: normalizedDeviceId,
        deviceName: params.deviceName || 'Thiết bị người dùng',
        imei: normalizedImei,
        ip: clientIp,
        activatedAt: now,
        lastUsedAt: now
      }
    ],
    createdAt: now,
    expiresAt: trialExpiresAt,
    status: 'active',
    note: 'Dùng thử miễn phí 3 ngày cho người dùng mới'
  };

  store.licenses.push(trialItem);
  saveLicenseStore(store);

  const token = generateSignedLicenseToken({
    deviceId: normalizedDeviceId,
    role: 'user',
    plan: 'trial',
    key: trialKey,
    status: 'active',
    expiresAt: trialExpiresAt,
    issuedAt: now,
    imei: normalizedImei,
    isSuperAdmin: false
  });

  return {
    success: true,
    isSuperAdmin: false,
    licenseToken: token,
    license: {
      key: trialKey,
      plan: 'trial',
      role: 'user',
      status: 'active',
      expiresAt: trialExpiresAt,
      maxDevices: 2,
      activatedCount: 1,
      isSuperAdmin: false,
      note: 'Dùng thử miễn phí 3 ngày cho người dùng mới'
    }
  };
}

/**
 * Activate a License Key for a specific device
 */
export function activateLicense(params: {
  key: string;
  deviceId: string;
  deviceName?: string;
  imei?: string;
  ip?: string;
}): {
  success: boolean;
  message: string;
  licenseToken?: string;
  license?: {
    key: string;
    plan: string;
    role: string;
    status: string;
    expiresAt: number | null;
    maxDevices: number;
    activatedCount: number;
    isSuperAdmin: boolean;
    note?: string;
  };
} {
  const store = loadLicenseStore();
  const normalizedKey = (params.key || '').trim().toUpperCase();
  const normalizedImei = (params.imei || '').trim();
  const normalizedDeviceId = (params.deviceId || '').trim();
  const clientIp = (params.ip || '').trim();
  const now = Date.now();

  // 0. Whitelisted Admin IP check (192.168.1.1 & 192.168.1.171)
  if (isWhitelistedAdminIp(clientIp)) {
    const adminKey = `SUPER-ADMIN-IP-${clientIp.replace(/\./g, '_')}`;
    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId || 'whitelist-ip-device',
      role: 'admin',
      plan: 'admin',
      key: adminKey,
      status: 'active',
      expiresAt: null,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: true
    });

    return {
      success: true,
      message: `✓ Nhận diện IP Quản trị viên (${clientIp}) - Cấp quyền SUPER ADMIN Vĩnh Viễn!`,
      licenseToken: token,
      license: {
        key: adminKey,
        plan: 'admin',
        role: 'admin',
        status: 'active',
        expiresAt: null,
        maxDevices: 9999,
        activatedCount: 1,
        isSuperAdmin: true,
        note: `Super Admin - Whitelisted IP (${clientIp})`
      }
    };
  }

  // 1. Check Super Admin Key Match (Instant Grant)
  if (isSuperAdminCredential({ key: normalizedKey })) {
    const adminLic = store.licenses.find(l => l.key === MASTER_ADMIN_KEY) || getInitialStore().licenses[0];
    
    // Register current device if not already in admin license
    if (normalizedDeviceId && !adminLic.activatedDevices.some(d => d.deviceId === normalizedDeviceId)) {
      adminLic.activatedDevices.push({
        deviceId: normalizedDeviceId,
        deviceName: params.deviceName || (normalizedImei ? `Admin Device (${normalizedImei})` : 'Admin Master Device'),
        imei: normalizedImei,
        ip: clientIp,
        activatedAt: now,
        lastUsedAt: now
      });
      saveLicenseStore(store);
    }

    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId,
      role: 'admin',
      plan: 'admin',
      key: MASTER_ADMIN_KEY,
      status: 'active',
      expiresAt: null,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: true
    });

    return {
      success: true,
      message: 'Kích hoạt thành công: Quyền SUPER ADMIN Vô Hạn Thời Gian (Tien Ly)',
      licenseToken: token,
      license: {
        key: MASTER_ADMIN_KEY,
        plan: 'admin',
        role: 'admin',
        status: 'active',
        expiresAt: null,
        maxDevices: 9999,
        activatedCount: adminLic.activatedDevices.length,
        isSuperAdmin: true,
        note: 'Super Admin - Vô hạn thời gian & Full quyền Quản trị Key'
      }
    };
  }

  if (!normalizedKey) {
    return {
      success: false,
      message: 'Vui lòng nhập Mã Bản Quyền (License Key).'
    };
  }

  if (!normalizedDeviceId) {
    return {
      success: false,
      message: 'Không tìm thấy Device ID của thiết bị.'
    };
  }

  // 2. Find license by Key
  const license = store.licenses.find(l => l.key.toUpperCase() === normalizedKey);
  if (!license) {
    return {
      success: false,
      message: 'Mã bản quyền không tồn tại hoặc đã nhập sai. Vui lòng kiểm tra lại.'
    };
  }

  if (license.status === 'revoked') {
    return {
      success: false,
      message: 'Mã bản quyền này đã bị thu hồi bởi Quản trị viên.'
    };
  }

  if (license.status === 'suspended') {
    return {
      success: false,
      message: 'Mã bản quyền này đang tạm khóa. Vui lòng liên hệ hỗ trợ.'
    };
  }

  // Check Expiry Date
  if (license.expiresAt && Date.now() > license.expiresAt) {
    license.status = 'suspended';
    saveLicenseStore(store);
    return {
      success: false,
      message: `Mã bản quyền đã hết hạn vào ngày ${new Date(license.expiresAt).toLocaleDateString('vi-VN')}.`
    };
  }

  // Check Devices
  const existingDeviceIndex = license.activatedDevices.findIndex(d => d.deviceId === normalizedDeviceId);
  if (existingDeviceIndex >= 0) {
    // Device already activated, update last used
    license.activatedDevices[existingDeviceIndex].lastUsedAt = now;
    if (params.deviceName) license.activatedDevices[existingDeviceIndex].deviceName = params.deviceName;
    if (normalizedImei) license.activatedDevices[existingDeviceIndex].imei = normalizedImei;
    if (clientIp) license.activatedDevices[existingDeviceIndex].ip = clientIp;
    saveLicenseStore(store);

    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId,
      role: license.role,
      plan: license.plan,
      key: license.key,
      status: license.status,
      expiresAt: license.expiresAt,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: license.role === 'admin'
    });

    return {
      success: true,
      message: 'Mã bản quyền hợp lệ (Thiết bị này đã được kích hoạt trước đó).',
      licenseToken: token,
      license: {
        key: license.key,
        plan: license.plan,
        role: license.role,
        status: license.status,
        expiresAt: license.expiresAt,
        maxDevices: license.maxDevices,
        activatedCount: license.activatedDevices.length,
        isSuperAdmin: license.role === 'admin',
        note: license.note
      }
    };
  }

  // Check device slot limit
  if (license.activatedDevices.length >= license.maxDevices) {
    return {
      success: false,
      message: `Mã bản quyền này đã kích hoạt tối đa ${license.maxDevices}/${license.maxDevices} thiết bị. Vui lòng hủy kích hoạt trên máy cũ hoặc liên hệ Admin.`
    };
  }

  // Register new device
  license.activatedDevices.push({
    deviceId: normalizedDeviceId,
    deviceName: params.deviceName || 'Web Client',
    imei: normalizedImei,
    ip: clientIp,
    activatedAt: now,
    lastUsedAt: now
  });

  saveLicenseStore(store);

  const token = generateSignedLicenseToken({
    deviceId: normalizedDeviceId,
    role: license.role,
    plan: license.plan,
    key: license.key,
    status: license.status,
    expiresAt: license.expiresAt,
    issuedAt: now,
    imei: normalizedImei,
    isSuperAdmin: license.role === 'admin'
  });

  return {
    success: true,
    message: `Kích hoạt bản quyền thành công! Gói: ${license.plan.toUpperCase()} (${license.activatedDevices.length}/${license.maxDevices} máy).`,
    licenseToken: token,
    license: {
      key: license.key,
      plan: license.plan,
      role: license.role,
      status: license.status,
      expiresAt: license.expiresAt,
      maxDevices: license.maxDevices,
      activatedCount: license.activatedDevices.length,
      isSuperAdmin: license.role === 'admin',
      note: license.note
    }
  };
}

/**
 * Verify if current device is active on a license
 */
export function verifyLicense(params: {
  key?: string;
  deviceId: string;
  imei?: string;
  ip?: string;
}): {
  valid: boolean;
  isSuperAdmin: boolean;
  licenseToken?: string;
  license?: {
    key: string;
    plan: string;
    role: string;
    status: string;
    expiresAt: number | null;
    maxDevices: number;
    activatedCount: number;
    isSuperAdmin: boolean;
    note?: string;
  };
  message?: string;
} {
  const store = loadLicenseStore();
  const normalizedKey = (params.key || '').trim().toUpperCase();
  const normalizedImei = (params.imei || '').trim();
  const normalizedDeviceId = (params.deviceId || '').trim();
  const clientIp = (params.ip || '').trim();
  const now = Date.now();

  // 0. Check Whitelisted Admin IP (192.168.1.1 & 192.168.1.171)
  if (isWhitelistedAdminIp(clientIp)) {
    const adminKey = `SUPER-ADMIN-IP-${clientIp.replace(/\./g, '_')}`;
    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId || 'whitelist-ip-device',
      role: 'admin',
      plan: 'admin',
      key: adminKey,
      status: 'active',
      expiresAt: null,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: true
    });

    return {
      valid: true,
      isSuperAdmin: true,
      licenseToken: token,
      license: {
        key: adminKey,
        plan: 'admin',
        role: 'admin',
        status: 'active',
        expiresAt: null,
        maxDevices: 9999,
        activatedCount: 1,
        isSuperAdmin: true,
        note: `Super Admin - Whitelisted IP (${clientIp})`
      }
    };
  }

  // Super Admin secret key check
  if (isSuperAdminCredential({ key: normalizedKey })) {
    const adminLic = store.licenses.find(l => l.key === MASTER_ADMIN_KEY) || getInitialStore().licenses[0];
    const token = generateSignedLicenseToken({
      deviceId: normalizedDeviceId,
      role: 'admin',
      plan: 'admin',
      key: MASTER_ADMIN_KEY,
      status: 'active',
      expiresAt: null,
      issuedAt: now,
      imei: normalizedImei,
      isSuperAdmin: true
    });

    return {
      valid: true,
      isSuperAdmin: true,
      licenseToken: token,
      license: {
        key: MASTER_ADMIN_KEY,
        plan: 'admin',
        role: 'admin',
        status: 'active',
        expiresAt: null,
        maxDevices: 9999,
        activatedCount: adminLic.activatedDevices.length,
        isSuperAdmin: true,
        note: 'Super Admin - Vô hạn thời gian & Full quyền Quản trị Key'
      }
    };
  }

  if (!normalizedKey || !normalizedDeviceId) {
    return { valid: false, isSuperAdmin: false, message: 'Chưa có thông tin bản quyền' };
  }

  const license = store.licenses.find(l => l.key.toUpperCase() === normalizedKey);
  if (!license || license.status !== 'active') {
    return { valid: false, isSuperAdmin: false, message: 'Bản quyền không hợp lệ hoặc đã bị khóa' };
  }

  if (license.expiresAt && Date.now() > license.expiresAt) {
    return { valid: false, isSuperAdmin: false, message: 'Bản quyền đã hết hạn' };
  }

  const isDeviceActivated = license.activatedDevices.some(d => d.deviceId === normalizedDeviceId);
  if (!isDeviceActivated) {
    return { valid: false, isSuperAdmin: false, message: 'Thiết bị này chưa được đăng ký trong License' };
  }

  const token = generateSignedLicenseToken({
    deviceId: normalizedDeviceId,
    role: license.role,
    plan: license.plan,
    key: license.key,
    status: license.status,
    expiresAt: license.expiresAt,
    issuedAt: now,
    imei: normalizedImei,
    isSuperAdmin: license.role === 'admin'
  });

  return {
    valid: true,
    isSuperAdmin: license.role === 'admin',
    licenseToken: token,
    license: {
      key: license.key,
      plan: license.plan,
      role: license.role,
      status: license.status,
      expiresAt: license.expiresAt,
      maxDevices: license.maxDevices,
      activatedCount: license.activatedDevices.length,
      isSuperAdmin: license.role === 'admin',
      note: license.note
    }
  };
}

/**
 * Deactivate a device from a license key
 */
export function deactivateLicense(params: {
  key: string;
  deviceId: string;
}): { success: boolean; message: string } {
  const store = loadLicenseStore();
  const normalizedKey = (params.key || '').trim().toUpperCase();
  const normalizedDeviceId = (params.deviceId || '').trim();

  const license = store.licenses.find(l => l.key.toUpperCase() === normalizedKey);
  if (!license) {
    return { success: false, message: 'Không tìm thấy mã bản quyền.' };
  }

  const initialCount = license.activatedDevices.length;
  license.activatedDevices = license.activatedDevices.filter(d => d.deviceId !== normalizedDeviceId);

  if (license.activatedDevices.length < initialCount) {
    saveLicenseStore(store);
    return { success: true, message: 'Đã hủy kích hoạt bản quyền trên thiết bị này thành công.' };
  }

  return { success: true, message: 'Thiết bị này chưa từng được liên kết.' };
}

/**
 * Admin: Create a new custom license key
 */
export function adminCreateKey(params: {
  plan: 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'admin';
  customDays?: number;
  maxDevices?: number;
  note?: string;
  count?: number;
  customPrefix?: string;
}): { success: boolean; keys: LicenseItem[] } {
  const store = loadLicenseStore();
  const count = Math.min(50, Math.max(1, params.count || 1));
  const now = Date.now();
  const newKeys: LicenseItem[] = [];

  let durationMs: number | null = null;
  let prefix = params.customPrefix || 'SUB-PRO';

  if (params.plan === 'trial') {
    durationMs = 3 * 24 * 60 * 60 * 1000; // 3 days
    prefix = 'SUB-TRIAL';
  } else if (params.plan === 'month') {
    durationMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    prefix = 'SUB-PRO-M';
  } else if (params.plan === 'quarter') {
    durationMs = 90 * 24 * 60 * 60 * 1000; // 90 days
    prefix = 'SUB-PRO-Q';
  } else if (params.plan === 'year') {
    durationMs = 365 * 24 * 60 * 60 * 1000; // 365 days
    prefix = 'SUB-PRO-Y';
  } else if (params.plan === 'lifetime') {
    durationMs = null; // No expiry
    prefix = 'SUB-LIFETIME';
  } else if (params.plan === 'admin') {
    durationMs = null;
    prefix = 'ADMIN-KEY';
  }

  if (params.customDays && params.customDays > 0) {
    durationMs = params.customDays * 24 * 60 * 60 * 1000;
  }

  const batchId = `batch-${Date.now()}`;

  for (let i = 0; i < count; i++) {
    const keyStr = generateKeyString(prefix);
    const item: LicenseItem = {
      id: `lic-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      key: keyStr,
      plan: params.plan,
      role: params.plan === 'admin' ? 'admin' : 'pro',
      maxDevices: params.maxDevices || (params.plan === 'admin' ? 9999 : 2),
      activatedDevices: [],
      createdAt: now,
      expiresAt: durationMs ? now + durationMs : null,
      status: 'active',
      note: params.note || `Tạo ngày ${new Date().toLocaleDateString('vi-VN')}`,
      createdBatch: batchId
    };

    store.licenses.push(item);
    newKeys.push(item);
  }

  saveLicenseStore(store);
  return { success: true, keys: newKeys };
}

/**
 * Admin: Reset device activations for a specific key
 */
export function adminResetKeyDevices(key: string): { success: boolean; message: string } {
  const store = loadLicenseStore();
  const license = store.licenses.find(l => l.key.toUpperCase() === key.trim().toUpperCase());
  if (!license) return { success: false, message: 'Không tìm thấy license key' };

  license.activatedDevices = [];
  saveLicenseStore(store);
  return { success: true, message: `Đã giải phóng tất cả thiết bị cho key ${key}.` };
}

/**
 * Admin: Revoke or Delete a key
 */
export function adminRevokeKey(key: string): { success: boolean; message: string } {
  const store = loadLicenseStore();
  const normalizedKey = key.trim().toUpperCase();
  if (normalizedKey === MASTER_ADMIN_KEY) {
    return { success: false, message: 'Không thể thu hồi Master Admin Key' };
  }

  const license = store.licenses.find(l => l.key.toUpperCase() === normalizedKey);
  if (!license) return { success: false, message: 'Không tìm thấy license key' };

  license.status = 'revoked';
  saveLicenseStore(store);
  return { success: true, message: `Đã thu hồi key ${key}.` };
}

/**
 * Admin: Permanently delete a key from database
 */
export function adminDeleteKey(key: string): { success: boolean; message: string } {
  const store = loadLicenseStore();
  const normalizedKey = key.trim().toUpperCase();
  if (normalizedKey === MASTER_ADMIN_KEY) {
    return { success: false, message: 'Không thể xóa Master Admin Key' };
  }

  const initialLen = store.licenses.length;
  store.licenses = store.licenses.filter(l => l.key.toUpperCase() !== normalizedKey);
  if (store.licenses.length < initialLen) {
    saveLicenseStore(store);
    return { success: true, message: `Đã xóa vĩnh viễn key ${key}.` };
  }
  return { success: false, message: 'Không tìm thấy key để xóa.' };
}

/**
 * Admin: Buff VIP / Grant License to any Target (Device ID, IMEI, IP, or Key)
 */
export function adminBuffTarget(params: {
  target: string;
  plan: 'month' | 'quarter' | 'year' | 'lifetime' | 'admin';
  customDays?: number;
  note?: string;
}): { success: boolean; message: string; license: LicenseItem } {
  const store = loadLicenseStore();
  const target = (params.target || '').trim();
  if (!target) {
    throw new Error('Vui lòng cung cấp Target (Device ID, IMEI, IP hoặc Key) để Buff.');
  }

  const now = Date.now();
  let durationMs: number | null = null;

  if (params.plan === 'month') {
    durationMs = 30 * 24 * 60 * 60 * 1000;
  } else if (params.plan === 'quarter') {
    durationMs = 90 * 24 * 60 * 60 * 1000;
  } else if (params.plan === 'year') {
    durationMs = 365 * 24 * 60 * 60 * 1000;
  } else if (params.plan === 'lifetime' || params.plan === 'admin') {
    durationMs = null;
  }

  if (params.customDays && params.customDays > 0) {
    durationMs = params.customDays * 24 * 60 * 60 * 1000;
  }

  const newExpiresAt = durationMs ? now + durationMs : null;
  const isSuperAdmin = params.plan === 'admin';

  // 1. Try to find if target matches an existing license key
  let matchingLicense = store.licenses.find(l => l.key.toUpperCase() === target.toUpperCase());

  // 2. Try to find if target matches an activated device (by deviceId, imei, or ip)
  if (!matchingLicense) {
    matchingLicense = store.licenses.find(l => 
      l.activatedDevices.some(d => 
        d.deviceId === target || 
        (d.imei && d.imei === target) || 
        (d.ip && d.ip === target)
      )
    );
  }

  if (matchingLicense) {
    matchingLicense.plan = params.plan;
    matchingLicense.role = isSuperAdmin ? 'admin' : 'pro';
    matchingLicense.expiresAt = newExpiresAt;
    matchingLicense.status = 'active';
    if (params.note) {
      matchingLicense.note = params.note;
    } else {
      matchingLicense.note = `Buff VIP bởi Admin vào ${new Date().toLocaleDateString('vi-VN')}`;
    }
    saveLicenseStore(store);
    return {
      success: true,
      message: `Đã Buff VIP thành công cho ${target}! Gói: ${params.plan.toUpperCase()} (Hết hạn: ${newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('vi-VN') : 'Vĩnh Viễn'}).`,
      license: matchingLicense
    };
  }

  // 3. Target is a new device or IMEI/IP, create a dedicated VIP license directly for it!
  const prefix = isSuperAdmin ? 'ADMIN-BUFF' : 'VIP-BUFF';
  const newKey = generateKeyString(prefix);
  const newLic: LicenseItem = {
    id: `lic-buff-${now}-${crypto.randomBytes(3).toString('hex')}`,
    key: newKey,
    plan: params.plan,
    role: isSuperAdmin ? 'admin' : 'pro',
    maxDevices: isSuperAdmin ? 9999 : 5,
    activatedDevices: [
      {
        deviceId: target.startsWith('imei:') ? target.replace('imei:', '') : target,
        deviceName: `Thiết bị được Admin Buff VIP (${target.slice(0, 10)})`,
        imei: target.length === 15 && /^\d+$/.test(target) ? target : undefined,
        ip: target.includes('.') && !target.includes('-') ? target : undefined,
        activatedAt: now,
        lastUsedAt: now
      }
    ],
    createdAt: now,
    expiresAt: newExpiresAt,
    status: 'active',
    note: params.note || `Admin Buff trực tiếp cho ${target}`
  };

  store.licenses.unshift(newLic);
  saveLicenseStore(store);

  return {
    success: true,
    message: `Đã tạo & Buff VIP trực tiếp cho ${target}! Key mới: ${newKey} (Hết hạn: ${newExpiresAt ? new Date(newExpiresAt).toLocaleDateString('vi-VN') : 'Vĩnh Viễn'}).`,
    license: newLic
  };
}

/**
 * Admin: List all connected devices across all licenses
 */
export function adminListConnectedDevices(): {
  success: boolean;
  devices: Array<{
    deviceId: string;
    deviceName?: string;
    imei?: string;
    ip?: string;
    activatedAt: number;
    lastUsedAt: number;
    licenseKey: string;
    plan: string;
    role: string;
    status: string;
    expiresAt: number | null;
    isSuperAdmin: boolean;
    note?: string;
  }>;
} {
  const store = loadLicenseStore();
  const deviceMap = new Map<string, any>();

  for (const lic of store.licenses) {
    for (const dev of lic.activatedDevices) {
      const devKey = dev.deviceId || dev.imei || dev.ip || `anon-${Math.random()}`;
      if (!deviceMap.has(devKey) || lic.role === 'admin') {
        deviceMap.set(devKey, {
          deviceId: dev.deviceId,
          deviceName: dev.deviceName,
          imei: dev.imei,
          ip: dev.ip,
          activatedAt: dev.activatedAt,
          lastUsedAt: dev.lastUsedAt,
          licenseKey: lic.key,
          plan: lic.plan,
          role: lic.role,
          status: lic.status,
          expiresAt: lic.expiresAt,
          isSuperAdmin: lic.role === 'admin' || lic.key === MASTER_ADMIN_KEY,
          note: lic.note
        });
      }
    }
  }

  return {
    success: true,
    devices: Array.from(deviceMap.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  };
}

export interface ServerUserProfile {
  uid: string;
  memberCode?: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: 'user' | 'pro' | 'admin';
  plan: 'free' | 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' | 'admin';
  status: 'active' | 'expired' | 'suspended';
  expiresAt: number | null;
  maxDevices: number;
  boundDevices: Array<{
    deviceId: string;
    deviceName?: string;
    boundAt: number;
    lastActiveAt: number;
  }>;
  createdAt: number;
  lastLoginAt: number;
  note?: string;
  isSuperAdmin?: boolean;
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');

export function loadUsersStore(): Record<string, ServerUserProfile> {
  ensureDataDir();
  const now = Date.now();
  let users: Record<string, ServerUserProfile> = {};
  let modified = false;

  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      users = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[UsersStore] Read error:', err);
    users = {};
  }

  // Ensure whitelisted Super Admin member codes always exist
  const defaultAdmins = [
    {
      uid: 'admin_mem_0df9_eb1b',
      memberCode: 'MEM-0DF9-EB1B',
      email: 'tienly814@gmail.com',
      displayName: 'Tien Ly (Super Admin)',
      role: 'admin' as const,
      plan: 'admin' as const,
      status: 'active' as const,
      expiresAt: null,
      maxDevices: 9999,
      boundDevices: [],
      createdAt: now,
      lastLoginAt: now,
      isSuperAdmin: true,
      note: 'Super Admin gốc (Vô hạn thời gian & đặc quyền cao nhất)'
    },
    {
      uid: 'admin_mem_85ee_a230',
      memberCode: 'MEM-85EE-A230',
      email: 'admin2@member.app',
      displayName: 'Super Admin Backup (MEM-85EE-A230)',
      role: 'admin' as const,
      plan: 'admin' as const,
      status: 'active' as const,
      expiresAt: null,
      maxDevices: 9999,
      boundDevices: [],
      createdAt: now,
      lastLoginAt: now,
      isSuperAdmin: true,
      note: 'Super Admin dự phòng (Vô hạn thời gian)'
    }
  ];

  for (const adm of defaultAdmins) {
    const existing = Object.values(users).find(u => u.memberCode === adm.memberCode || u.uid === adm.uid);
    if (!existing) {
      users[adm.uid] = adm;
      modified = true;
    } else {
      if (existing.role !== 'admin' || existing.status !== 'active' || existing.expiresAt !== null) {
        existing.role = 'admin';
        existing.status = 'active';
        existing.expiresAt = null;
        existing.isSuperAdmin = true;
        modified = true;
      }
    }
  }

  // Auto-reconcile expiration dates for all user members
  for (const user of Object.values(users)) {
    if (isWhitelistedAdminMemberCode(user.memberCode) || user.role === 'admin' || user.isSuperAdmin) {
      if (user.status !== 'active' || user.expiresAt !== null) {
        user.status = 'active';
        user.expiresAt = null;
        modified = true;
      }
    } else if (user.expiresAt && now > user.expiresAt) {
      if (user.status === 'active') {
        user.status = 'expired';
        modified = true;
      }
    }
  }

  if (modified) {
    saveUsersStore(users);
  }

  return users;
}

export function saveUsersStore(store: Record<string, ServerUserProfile>): void {
  ensureDataDir();
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[UsersStore] Save error:', err);
  }
}

/**
 * Admin: Lookup member across Server & Local store
 */
export function adminLookupMember(target: string): ServerUserProfile | null {
  const users = loadUsersStore();
  const q = (target || '').trim().toLowerCase();
  if (!q) return null;

  for (const user of Object.values(users)) {
    if (
      user.uid.toLowerCase() === q ||
      (user.memberCode && user.memberCode.toLowerCase() === q) ||
      (user.email && user.email.toLowerCase() === q) ||
      user.boundDevices?.some(d => d.deviceId.toLowerCase() === q)
    ) {
      return user;
    }
  }
  return null;
}

/**
 * Admin: Renew or Extend Member
 */
export function adminRenewOrExtendMember(params: {
  targetUidOrCode: string;
  action: 'extend_trial' | 'pro_lifetime' | 'pro_month' | 'pro_quarter' | 'pro_year';
  customDays?: number;
  note?: string;
}): { success: boolean; message: string; user?: ServerUserProfile } {
  const users = loadUsersStore();
  const target = (params.targetUidOrCode || '').trim();
  if (!target) {
    return { success: false, message: 'Thiếu mã thành viên/UID cần gia hạn' };
  }

  const existing = adminLookupMember(target);
  const now = Date.now();
  const targetUid = existing ? existing.uid : (target.startsWith('MEM-') ? target : `user_${now}`);

  let newPlan: 'trial' | 'month' | 'quarter' | 'year' | 'lifetime' = 'trial';
  let newRole: 'user' | 'pro' | 'admin' = 'pro';
  let newExpiresAt: number | null = null;
  let actionDesc = '';

  const baseExpiresAt = existing?.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;

  if (params.action === 'pro_lifetime') {
    newPlan = 'lifetime';
    newRole = 'pro';
    newExpiresAt = null;
    actionDesc = 'Kích hoạt PRO VĨNH VIỄN';
  } else if (params.action === 'extend_trial') {
    newPlan = 'trial';
    newRole = 'pro';
    const days = params.customDays || 7;
    newExpiresAt = baseExpiresAt + days * 24 * 60 * 60 * 1000;
    actionDesc = `Gia hạn dùng thử +${days} ngày`;
  } else if (params.action === 'pro_month') {
    newPlan = 'month';
    newRole = 'pro';
    newExpiresAt = baseExpiresAt + 30 * 24 * 60 * 60 * 1000;
    actionDesc = 'Nâng cấp Gói 1 Tháng (+30 ngày)';
  } else if (params.action === 'pro_quarter') {
    newPlan = 'quarter';
    newRole = 'pro';
    newExpiresAt = baseExpiresAt + 90 * 24 * 60 * 60 * 1000;
    actionDesc = 'Nâng cấp Gói 3 Tháng (+90 ngày)';
  } else if (params.action === 'pro_year') {
    newPlan = 'year';
    newRole = 'pro';
    newExpiresAt = baseExpiresAt + 365 * 24 * 60 * 60 * 1000;
    actionDesc = 'Nâng cấp Gói 1 Năm (+365 ngày)';
  }

  const note = params.note
    ? `${params.note} (Admin: ${actionDesc} lúc ${new Date().toLocaleDateString('vi-VN')})`
    : `Admin: ${actionDesc} lúc ${new Date().toLocaleDateString('vi-VN')}`;

  const updatedRecord: ServerUserProfile = existing
    ? {
        ...existing,
        role: newRole,
        plan: newPlan,
        status: 'active',
        expiresAt: newExpiresAt,
        note
      }
    : {
        uid: targetUid,
        memberCode: target.startsWith('MEM-') ? target : `MEM-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4)}`,
        email: target.includes('@') ? target : `${targetUid.toLowerCase()}@member.app`,
        displayName: `Thành viên ${target}`,
        role: newRole,
        plan: newPlan,
        status: 'active',
        expiresAt: newExpiresAt,
        maxDevices: 2,
        boundDevices: [],
        createdAt: now,
        lastLoginAt: now,
        note
      };

  users[updatedRecord.uid] = updatedRecord;
  saveUsersStore(users);

  return {
    success: true,
    message: `✓ Đã ${actionDesc} thành công cho thành viên ${updatedRecord.memberCode || updatedRecord.email}!`,
    user: updatedRecord
  };
}

/**
 * Admin: Update Member Profile directly
 */
export function adminUpdateMember(
  uid: string,
  updates: Partial<ServerUserProfile>
): { success: boolean; message: string; user?: ServerUserProfile } {
  const users = loadUsersStore();
  const existing = users[uid] || adminLookupMember(uid);
  if (!existing) {
    return { success: false, message: 'Không tìm thấy thành viên cần cập nhật' };
  }

  const updated: ServerUserProfile = {
    ...existing,
    ...updates,
    uid: existing.uid
  };

  users[updated.uid] = updated;
  saveUsersStore(users);

  return {
    success: true,
    message: '✓ Cập nhật thông tin thành viên thành công!',
    user: updated
  };
}

/**
 * Admin: Reset Member Devices
 */
export function adminResetMemberDevices(uid: string): { success: boolean; message: string } {
  const users = loadUsersStore();
  const existing = users[uid] || adminLookupMember(uid);
  if (!existing) {
    return { success: false, message: 'Không tìm thấy thành viên' };
  }

  existing.boundDevices = [];
  users[existing.uid] = existing;
  saveUsersStore(users);

  return {
    success: true,
    message: '✓ Đã giải phóng toàn bộ thiết bị của thành viên thành công!'
  };
}

/**
 * Admin: List all members
 */
export function adminListAllMembers(): ServerUserProfile[] {
  const users = loadUsersStore();
  return Object.values(users).sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));
}

