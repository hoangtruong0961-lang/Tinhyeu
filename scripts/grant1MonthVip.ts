import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import firebaseConfigJson from '../firebase-applet-config.json';
import { adminRenewOrExtendMember, adminBuffTarget } from '../src/server/licenseService';
import * as fs from 'fs';
import * as path from 'path';

async function grant1MonthVip() {
  const targetCode = 'MEM-9278-05EA';
  const relatedTargets = ['MEM-9278-05EA', 'VT-9278-05EA'];
  
  const now = Date.now();
  const days = 30; // 1 tháng
  const durationMs = days * 24 * 60 * 60 * 1000;
  const expiresAt = now + durationMs;
  const expiresDateStr = new Date(expiresAt).toLocaleDateString('vi-VN');

  console.log(`=======================================================`);
  console.log(`[CẤP BẢN QUYỀN VIP 1 THÁNG] Target: ${targetCode}`);
  console.log(`Thời gian cấp: ${new Date(now).toLocaleString('vi-VN')}`);
  console.log(`Hạn sử dụng mới (+30 ngày): ${expiresDateStr} (${expiresAt})`);
  console.log(`=======================================================\n`);

  // 1. Cập nhật Server Local Member Store & License Store via licenseService
  for (const target of relatedTargets) {
    console.log(`--- [Local LicenseService] Processing: ${target} ---`);
    const resMember = adminRenewOrExtendMember({
      targetUidOrCode: target,
      action: 'pro_month',
      note: `Admin cấp VIP 1 tháng (30 ngày) đến ${expiresDateStr}`
    });
    console.log('  -> Member Store:', resMember.message);

    const resLicense = adminBuffTarget({
      target: target,
      plan: 'month',
      customDays: days,
      note: `Admin cấp VIP 1 tháng (30 ngày) đến ${expiresDateStr}`
    });
    console.log('  -> License Store:', resLicense.message);
  }

  // 2. Cập nhật Live Firestore Cloud DB
  console.log(`\n--- [Firestore Live DB Sync] Database: ${firebaseConfigJson.firestoreDatabaseId} ---`);
  const firebaseConfig = {
    apiKey: firebaseConfigJson.apiKey,
    authDomain: firebaseConfigJson.authDomain,
    projectId: firebaseConfigJson.projectId,
    storageBucket: firebaseConfigJson.storageBucket,
    messagingSenderId: firebaseConfigJson.messagingSenderId,
    appId: firebaseConfigJson.appId,
  };

  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  }, firebaseConfigJson.firestoreDatabaseId || '(default)');

  for (const code of relatedTargets) {
    try {
      // 2a. Collection "users"
      const userRef = doc(db, 'users', code);
      const userSnap = await getDoc(userRef);
      const existingData = userSnap.exists() ? userSnap.data() : {};
      
      const userPayload = {
        ...existingData,
        uid: code,
        memberCode: code,
        email: existingData.email || `${code.toLowerCase()}@member.app`,
        displayName: existingData.displayName || `Thành viên ${code}`,
        role: 'pro',
        plan: 'month',
        status: 'active',
        expiresAt: expiresAt,
        createdAt: existingData.createdAt || now,
        lastLoginAt: now,
        maxDevices: 5,
        note: `Cấp VIP 1 tháng bởi Admin (${expiresDateStr})`
      };

      await setDoc(userRef, userPayload, { merge: true });
      console.log(`  ✓ [users] Live Firestore doc updated for: ${code}`);

      // Query sub-documents if any match memberCode
      const q = query(collection(db, 'users'), where('memberCode', '==', code));
      const qSnap = await getDocs(q);
      for (const d of qSnap.docs) {
        if (d.id !== code) {
          await setDoc(d.ref, { role: 'pro', plan: 'month', status: 'active', expiresAt }, { merge: true });
          console.log(`  ✓ [users query match] Updated doc ${d.id}`);
        }
      }

      // 2b. Collection "devices"
      const devRef = doc(db, 'devices', code);
      const devPayload = {
        deviceId: code,
        deviceName: `Thiết bị ${code}`,
        plan: 'month',
        role: 'pro',
        status: 'active',
        expiresAt: expiresAt,
        lastActiveAt: now,
        createdAt: existingData.createdAt || now,
        note: `Cấp VIP 1 tháng bởi Admin (${expiresDateStr})`
      };
      await setDoc(devRef, devPayload, { merge: true });
      console.log(`  ✓ [devices] Live Firestore doc updated for: ${code}`);

      // 2c. Collection "cloud_licenses"
      const licRef = doc(db, 'cloud_licenses', code);
      const licPayload = {
        key: code,
        role: 'pro',
        plan: 'month',
        status: 'active',
        expiresAt: expiresAt,
        maxDevices: 5,
        updatedAt: now,
        note: `Admin cấp VIP 1 tháng (${expiresDateStr})`
      };
      await setDoc(licRef, licPayload, { merge: true });
      console.log(`  ✓ [cloud_licenses] Live Firestore doc updated for: ${code}`);

    } catch (err: any) {
      console.error(`  ❌ Error updating Firestore for ${code}:`, err?.message || err);
    }
  }

  // 3. Update server_data/licenses.json if exists
  try {
    const dataDir = path.join(process.cwd(), 'server_data');
    const licensesFile = path.join(dataDir, 'licenses.json');
    if (fs.existsSync(licensesFile)) {
      const raw = fs.readFileSync(licensesFile, 'utf8');
      const store = JSON.parse(raw);
      if (store && Array.isArray(store.licenses)) {
        for (const code of relatedTargets) {
          let lic = store.licenses.find((l: any) => l.key.toUpperCase() === code.toUpperCase());
          if (!lic) {
            lic = {
              id: `lic-granted-${now}-${code}`,
              key: code,
              plan: 'month',
              role: 'pro',
              maxDevices: 5,
              activatedDevices: [],
              createdAt: now,
              expiresAt: expiresAt,
              status: 'active',
              note: `Cấp VIP 1 tháng bởi Admin (${expiresDateStr})`
            };
            store.licenses.unshift(lic);
          } else {
            lic.plan = 'month';
            lic.role = 'pro';
            lic.status = 'active';
            lic.expiresAt = expiresAt;
            lic.note = `Cấp VIP 1 tháng bởi Admin (${expiresDateStr})`;
          }
        }
        fs.writeFileSync(licensesFile, JSON.stringify(store, null, 2), 'utf8');
        console.log(`\n  ✓ [server_data/licenses.json] Local file updated!`);
      }
    }
  } catch (err: any) {
    console.warn(`  [server_data/licenses.json] Skip:`, err?.message || err);
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 HOÀN TẤT CẤP BẢN QUYỀN VIP 1 THÁNG CHO MÃ ${targetCode}!`);
  console.log(`HẠN SỬ DỤNG MỚI: ${expiresDateStr}`);
  console.log(`=======================================================\n`);
  process.exit(0);
}

grant1MonthVip().catch((err) => {
  console.error('Fatal error in grant1MonthVip script:', err);
  process.exit(1);
});
