const https = require('https');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
const apiKey = firebaseConfig.apiKey;

const targets = [
  "MEM-9278-05EA",
  "VT-9278-05EA"
];

const now = Date.now();
const days = 30; // 1 tháng
const expiresAt = now + days * 86400 * 1000;
const expiresDateStr = new Date(expiresAt).toLocaleDateString('vi-VN');

function updateDoc(collection, docId, fields) {
  return new Promise((resolve, reject) => {
    const encodedDbId = encodeURIComponent(databaseId);
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodedDbId}/documents/${collection}/${docId}?key=${apiKey}`;
    const payload = JSON.stringify({ fields });

    const req = https.request(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`[${res.statusCode}] ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log(`=======================================================`);
  console.log(`[REST SYNC] Cấp VIP 1 tháng cho Firestore (All Collections)`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);
  console.log(`Hạn mới: ${expiresDateStr} (${expiresAt})`);
  console.log(`=======================================================\n`);

  const collections = ['users', 'devices', 'licenses', 'cloud_licenses'];

  for (const t of targets) {
    for (const col of collections) {
      console.log(`--> Syncing '${col}/${t}'...`);
      try {
        await updateDoc(col, t, {
          uid: { stringValue: t },
          key: { stringValue: t },
          memberCode: { stringValue: t },
          deviceId: { stringValue: t },
          email: { stringValue: `${t.toLowerCase()}@member.app` },
          displayName: { stringValue: `Thành viên ${t}` },
          role: { stringValue: 'pro' },
          plan: { stringValue: 'month' },
          status: { stringValue: 'active' },
          expiresAt: { integerValue: String(expiresAt) },
          maxDevices: { integerValue: '5' },
          createdAt: { integerValue: String(now) },
          lastLoginAt: { integerValue: String(now) },
          updatedAt: { integerValue: String(now) },
          note: { stringValue: `Cấp VIP 1 tháng bởi Admin (${expiresDateStr})` }
        });
        console.log(`  ✓ '${col}/${t}' updated successfully.`);
      } catch (err) {
        console.error(`  ❌ Error updating '${col}/${t}':`, err.message);
      }
    }
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 HOÀN TẤT TẤT CẢ COLLECTIONS CẤP 1 THÁNG VIP CHO ${targets.join(', ')}!`);
  console.log(`=======================================================\n`);
}

main().catch(err => {
  console.error('Fatal error in REST sync:', err);
  process.exit(1);
});
