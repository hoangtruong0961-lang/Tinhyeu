const https = require('https');

const projectId = "gen-lang-client-0806844075";
const databaseId = "ai-studio-remixremixbch60-83a3dc79-63a7-4182-916c-220cc7b217fb";
const apiKey = "AIzaSyBJZrKmSNqgw7MTJqzxy7OKhbxuDMEEpkc";

const targets = [
  "MEM-9278-05EA",
  "VT-9278-05EA",
  "VT-7DE2-4F7D",
  "MEM-7DE2-4F7D",
  "MEM-C877-FC40",
  "MEM-5412-6A50"
];

const now = Date.now();
const expiresAt = now + 7 * 86400 * 1000;

function updateDoc(collection, docId, fields) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/${docId}?key=${apiKey}`;
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
  console.log(`Syncing targets to Live Firestore (${databaseId})...`);
  for (const t of targets) {
    console.log(`Writing live user document for ${t}...`);
    await updateDoc('users', t, {
      uid: { stringValue: t },
      memberCode: { stringValue: t },
      email: { stringValue: `${t.toLowerCase()}@member.app` },
      displayName: { stringValue: `Thành viên ${t}` },
      role: { stringValue: 'pro' },
      plan: { stringValue: 'month' },
      status: { stringValue: 'active' },
      expiresAt: { integerValue: String(expiresAt) },
      maxDevices: { integerValue: '5' },
      createdAt: { integerValue: String(now) },
      lastLoginAt: { integerValue: String(now) },
      note: { stringValue: 'Cấp 7 ngày VIP bởi Admin (Live Cloud Sync)' }
    });

    console.log(`Writing live device document for ${t}...`);
    await updateDoc('devices', t, {
      deviceId: { stringValue: t },
      deviceName: { stringValue: `Thiết bị ${t}` },
      plan: { stringValue: 'month' },
      role: { stringValue: 'pro' },
      status: { stringValue: 'active' },
      expiresAt: { integerValue: String(expiresAt) },
      lastActiveAt: { integerValue: String(now) },
      createdAt: { integerValue: String(now) },
      note: { stringValue: 'Cấp 7 ngày VIP bởi Admin (Live Cloud Sync)' }
    });
  }
  console.log(`✓ All live documents successfully created/updated on Firestore Database!`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
