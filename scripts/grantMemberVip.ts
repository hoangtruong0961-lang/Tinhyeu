import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import firebaseConfigJson from '../firebase-applet-config.json';
import * as fs from 'fs';
import * as path from 'path';

async function grantVip() {
  const memberCodesToGrant = ['MEM-9278-05EA', 'VT-9278-05EA'];
  const now = Date.now();
  const days = 7;
  const expiresAt = now + days * 24 * 60 * 60 * 1000; // 7 days from now
  const expiresDateStr = new Date(expiresAt).toLocaleDateString('vi-VN');

  console.log(`[Grant VIP Script] Starting VIP grant for member: ${memberCodesToGrant.join(', ')}...`);
  console.log(`[Grant VIP Script] Expiration timestamp: ${expiresAt} (${expiresDateStr})`);

  // Initialize Firebase App
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

  for (const code of memberCodesToGrant) {
    try {
      // 1. Update in "users" collection
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
        plan: 'trial',
        status: 'active',
        expiresAt: expiresAt,
        createdAt: existingData.createdAt || now,
        lastLoginAt: now,
        maxDevices: 5,
        note: `Đã cấp VIP 7 ngày bởi Admin vào ${new Date().toLocaleString('vi-VN')}`
      };

      await setDoc(userRef, userPayload, { merge: true });
      console.log(`✓ [Firestore users] Cấp VIP 7 ngày thành công cho document: ${code}`);

      // Query if there's any document where memberCode == code or uid == code
      const q = query(collection(db, 'users'), where('memberCode', '==', code));
      const qSnap = await getDocs(q);
      for (const d of qSnap.docs) {
        if (d.id !== code) {
          await setDoc(d.ref, { role: 'pro', plan: 'trial', status: 'active', expiresAt }, { merge: true });
          console.log(`✓ [Firestore users query] Cập nhật document ${d.id} cho ${code}`);
        }
      }

      // 2. Update in "cloud_licenses" collection
      const licRef = doc(db, 'cloud_licenses', code);
      const licPayload = {
        key: code,
        role: 'pro',
        plan: 'trial',
        status: 'active',
        expiresAt: expiresAt,
        maxDevices: 5,
        updatedAt: now,
        note: `Admin cấp VIP 7 ngày (${expiresDateStr})`
      };
      await setDoc(licRef, licPayload, { merge: true });
      console.log(`✓ [Firestore cloud_licenses] Cấp VIP 7 ngày thành công cho license key: ${code}`);
    } catch (err: any) {
      console.error(`❌ Error updating Firestore for ${code}:`, err?.message || err);
    }
  }

  // 3. Update server local licenses.json if present
  try {
    const dataDir = path.join(process.cwd(), 'server_data');
    const licensesFile = path.join(dataDir, 'licenses.json');
    if (fs.existsSync(licensesFile)) {
      const raw = fs.readFileSync(licensesFile, 'utf8');
      const store = JSON.parse(raw);
      if (store && Array.isArray(store.licenses)) {
        for (const code of memberCodesToGrant) {
          let lic = store.licenses.find((l: any) => l.key.toUpperCase() === code.toUpperCase());
          if (!lic) {
            lic = {
              id: `lic-granted-${now}-${code}`,
              key: code,
              plan: 'trial',
              role: 'pro',
              maxDevices: 5,
              activatedDevices: [],
              createdAt: now,
              expiresAt: expiresAt,
              status: 'active',
              note: `Cấp VIP 7 ngày bởi Admin`
            };
            store.licenses.unshift(lic);
          } else {
            lic.plan = 'trial';
            lic.role = 'pro';
            lic.status = 'active';
            lic.expiresAt = expiresAt;
            lic.note = `Cấp VIP 7 ngày bởi Admin (${expiresDateStr})`;
          }
        }
        fs.writeFileSync(licensesFile, JSON.stringify(store, null, 2), 'utf8');
        console.log(`✓ [Server File] Cập nhật licenses.json thành công!`);
      }
    }
  } catch (err: any) {
    console.warn(`[Local licenses.json] Skip/Error:`, err?.message || err);
  }

  console.log(`\n🎉 HOÀN TẤT CẤP BẢN QUYỀN 7 NGÀY CHO ${memberCodesToGrant.join(', ')}! HẠN DÙNG ĐẾN: ${expiresDateStr}`);
  process.exit(0);
}

grantVip().catch((err) => {
  console.error('Fatal script error:', err);
  process.exit(1);
});
