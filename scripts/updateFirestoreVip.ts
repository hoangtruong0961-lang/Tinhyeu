import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import firebaseConfigJson from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfigJson);
const db = getFirestore(app, firebaseConfigJson.firestoreDatabaseId);

async function updateFirestoreVip() {
  const targets = ['MEM-9278-05EA', 'VT-9278-05EA', 'VT-7DE2-4F7D', 'MEM-C877-FC40', 'MEM-5412-6A50'];
  const now = Date.now();
  const days7Ms = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = now + days7Ms;

  console.log(`Updating Live Firestore DB: ${firebaseConfigJson.firestoreDatabaseId}`);
  console.log(`Current Time: ${new Date(now).toISOString()}`);
  console.log(`VIP Expiry Time (+7 days): ${new Date(expiresAt).toLocaleDateString('vi-VN')} ${new Date(expiresAt).toLocaleTimeString('vi-VN')}`);

  for (const target of targets) {
    const userRef = doc(db, 'users', target);
    const userDoc: any = {
      uid: target,
      memberCode: target,
      email: `${target.toLowerCase()}@member.app`,
      displayName: `Thành viên ${target}`,
      role: 'pro',
      plan: 'month',
      status: 'active',
      expiresAt: expiresAt,
      maxDevices: 5,
      boundDevices: [],
      createdAt: now,
      lastLoginAt: now,
      note: 'Cấp 7 ngày VIP bởi Admin (Live Cloud Sync)',
      isSuperAdmin: false
    };

    await setDoc(userRef, userDoc, { merge: true });
    console.log(`✓ [USERS] Live Firestore updated for ${target}: VIP active until ${new Date(expiresAt).toLocaleDateString('vi-VN')}`);

    // Also update devices collection
    const devRef = doc(db, 'devices', target);
    const devDoc: any = {
      deviceId: target,
      deviceName: `Thiết bị ${target}`,
      plan: 'month',
      role: 'pro',
      status: 'active',
      expiresAt: expiresAt,
      lastActiveAt: now,
      createdAt: now,
      note: 'Cấp 7 ngày VIP bởi Admin (Live Cloud Sync)',
      isSuperAdmin: false
    };
    await setDoc(devRef, devDoc, { merge: true });
    console.log(`✓ [DEVICES] Live Firestore updated for ${target}`);
  }

  console.log('\nAll targets updated in Live Firestore Cloud DB successfully!');
}

updateFirestoreVip().catch((err) => {
  console.error('Error updating Live Firestore:', err);
  process.exit(1);
});
