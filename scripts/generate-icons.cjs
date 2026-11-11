const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const srcImage = path.resolve(__dirname, '../IMG_20261005_010549.png');
if (!fs.existsSync(srcImage)) {
  console.error('Source image not found:', srcImage);
  process.exit(1);
}

console.log('Generating Android Launcher Icons from:', srcImage);

const resDir = path.resolve(__dirname, '../android/app/src/main/res');

// Density mappings
const densities = [
  { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108, logoInFg: 76 },
  { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162, logoInFg: 114 },
  { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216, logoInFg: 152 },
  { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324, logoInFg: 228 },
  { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432, logoInFg: 304 },
];

for (const d of densities) {
  const targetDir = path.join(resDir, d.dir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const icLauncher = path.join(targetDir, 'ic_launcher.png');
  const icLauncherRound = path.join(targetDir, 'ic_launcher_round.png');
  const icLauncherFg = path.join(targetDir, 'ic_launcher_foreground.png');

  // 1. Standard square launcher icon
  execSync(`convert "${srcImage}" -resize ${d.iconSize}x${d.iconSize} "${icLauncher}"`);

  // 2. Round launcher icon (masked to circle)
  execSync(
    `convert "${srcImage}" -resize ${d.iconSize}x${d.iconSize} ` +
    `\\( +clone -alpha extract -draw "fill black polygon 0,0 0,${d.iconSize} ${d.iconSize},${d.iconSize} ${d.iconSize},0 fill white circle ${d.iconSize/2},${d.iconSize/2} ${d.iconSize/2},1" \\) ` +
    `-alpha off -compose CopyOpacity -composite "${icLauncherRound}"`
  );

  // 3. Adaptive icon foreground (padded logo placed inside 108dp canvas on transparent background)
  execSync(
    `convert "${srcImage}" -resize ${d.logoInFg}x${d.logoInFg} ` +
    `-background none -gravity center -extent ${d.fgSize}x${d.fgSize} "${icLauncherFg}"`
  );

  console.log(`✓ Generated icons for ${d.dir} (${d.iconSize}px, fg: ${d.fgSize}px)`);
}

// Update ic_launcher_background.xml
const bgValuePath = path.join(resDir, 'values/ic_launcher_background.xml');
fs.writeFileSync(
  bgValuePath,
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#E1E5E7</color>
</resources>
`
);

const bgDrawablePath = path.join(resDir, 'drawable/ic_launcher_background.xml');
fs.writeFileSync(
  bgDrawablePath,
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportHeight="108"
    android:viewportWidth="108">
    <path
        android:fillColor="#E1E5E7"
        android:pathData="M0,0h108v108h-108z" />
</vector>
`
);

// Update web/PWA/Electron assets in public/
const publicDir = path.resolve(__dirname, '../public');
execSync(`convert "${srcImage}" -resize 512x512 "${path.join(publicDir, 'icon-512.png')}"`);
execSync(`convert "${srcImage}" -resize 512x512 "${path.join(publicDir, 'icon.png')}"`);
execSync(`convert "${srcImage}" -resize 512x512 "${path.join(publicDir, 'logo.png')}"`);
execSync(`convert "${srcImage}" -resize 64x64 "${path.join(publicDir, 'favicon.png')}"`);
execSync(`convert "${srcImage}" -resize 32x32 "${path.join(publicDir, 'favicon.ico')}"`);
console.log('✓ Updated public/ icons (icon.png, icon-512.png, favicon.ico, logo.png)');

// Update assets/ directory for Capacitor
const assetsDir = path.resolve(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
execSync(`convert "${srcImage}" -resize 1024x1024 "${path.join(assetsDir, 'logo.png')}"`);
execSync(`convert "${srcImage}" -resize 1024x1024 "${path.join(assetsDir, 'icon-only.png')}"`);
execSync(`convert "${srcImage}" -resize 1024x1024 "${path.join(assetsDir, 'icon-foreground.png')}"`);
execSync(`convert -size 1024x1024 xc:"#E1E5E7" "${path.join(assetsDir, 'icon-background.png')}"`);
console.log('✓ Updated assets/ directory for Capacitor');

console.log('All APK & App icons successfully generated!');
