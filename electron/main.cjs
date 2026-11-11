const { app, BrowserWindow, ipcMain, dialog, shell, Notification, powerSaveBlocker, Menu, nativeTheme } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

// Ensure Single Instance Lock on Desktop PC
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Set Dark Mode integration for Windows native dialogs and titlebars
if (nativeTheme) {
  nativeTheme.themeSource = 'dark';
}

// Optimize Chromium Engine & GPU Hardware Acceleration (Safe defaults to avoid black screen)
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Check if user launched with debug flag (e.g. app.exe --debug)
const isDebugMode = process.argv.includes('--debug') || process.argv.includes('--enable-devtools');

let mainWindow = null;
let activePowerSaveBlockerId = null;
let activeFfmpegProcess = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b',
    title: 'Gemini Video Subtitles Studio',
    show: false, // Prevent black screen flash while loading assets
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow local file:// asset resolution and wasm/onnx models seamlessly
      devTools: true, // Allow DevTools so user can inspect console errors
      backgroundThrottling: false, // Prevents throttling rendering tasks when minimized or backgrounded
    },
    autoHideMenuBar: false,
  });

  // Smoothly show window once content is painted to avoid black flash
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  // Fallback timer to ensure window shows even if DOMContentLoaded is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3500);

  // Diagnostic logging if page fails to load
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Page failed to load (${errorCode}): ${errorDescription} at ${validatedURL}`);
  });

  // Support F12 and Ctrl+Shift+I to toggle DevTools console anytime for debugging
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const key = input.key.toLowerCase();
      if (input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      } else if ((input.control || input.meta) && input.shift && (key === 'i' || key === 'j' || key === 'c')) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
  });

  // Handle second instance activation
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Custom Application Menu with shortcuts
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Video...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow && mainWindow.webContents.send('menu:open-video'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        {
          label: 'Bật / Tắt DevTools Console (F12)',
          accelerator: 'F12',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools(),
        },
        {
          label: 'Inspect Elements (Ctrl+Shift+I)',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Mở Console xem lỗi (F12)',
          click: () => mainWindow && mainWindow.webContents.openDevTools(),
        },
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com')
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Gemini Video Subtitles Studio',
              message: 'Gemini Video Subtitles Studio (Desktop Edition)',
              detail: `Electron: ${process.versions.electron}\nNode: ${process.versions.node}\nChromium: ${process.versions.chrome}\nOS: ${os.type()} ${os.arch()}`,
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  if (isDev) {
    const devUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:3000';
    mainWindow.loadURL(devUrl);
  } else {
    // Try multiple candidate paths for dist/index.html to ensure 100% compatibility with all packaging modes
    const candidatePaths = [
      path.join(app.getAppPath(), 'dist', 'index.html'),
      path.join(__dirname, '..', 'dist', 'index.html'),
      path.join(__dirname, 'dist', 'index.html'),
      path.join(process.resourcesPath || '', 'app.asar', 'dist', 'index.html'),
    ];

    let resolvedPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];

    mainWindow.loadFile(resolvedPath).catch((err) => {
      console.error(`[Electron] Failed to load index file at ${resolvedPath}:`, err);
      mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {
        mainWindow.loadURL('http://localhost:3000').catch((netErr) => {
          console.error('[Electron] All load attempts failed:', netErr);
        });
      });
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (activePowerSaveBlockerId !== null && powerSaveBlocker.isStarted(activePowerSaveBlockerId)) {
      powerSaveBlocker.stop(activePowerSaveBlockerId);
      activePowerSaveBlockerId = null;
    }
    if (activeFfmpegProcess) {
      try { activeFfmpegProcess.kill('SIGKILL'); } catch (e) {}
      activeFfmpegProcess = null;
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('dialog:openFile', async (event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'ts', 'm4v'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] },
      { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    ...options,
  });
});

ipcMain.handle('dialog:saveFile', async (event, options = {}) => {
  if (!mainWindow) return { canceled: true, filePath: '' };
  return dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
      { name: 'MKV Video', extensions: ['mkv'] },
      { name: 'Subtitle File', extensions: ['srt', 'vtt', 'ass'] },
      { name: 'Audio File', extensions: ['mp3', 'wav'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    ...options,
  });
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    return shell.openExternal(url);
  }
  return false;
});

ipcMain.handle('shell:openPath', async (event, targetPath) => {
  if (targetPath) {
    return shell.openPath(targetPath);
  }
  return '';
});

ipcMain.handle('shell:showItemInFolder', async (event, targetPath) => {
  if (targetPath) {
    shell.showItemInFolder(targetPath);
    return true;
  }
  return false;
});

// Taskbar / Dock progress (0.0 to 1.0, or -1 to clear)
ipcMain.handle('app:setProgressBar', async (event, progress, options = {}) => {
  if (!mainWindow) return false;
  mainWindow.setProgressBar(progress, options);
  return true;
});

// Native OS Notification
ipcMain.handle('app:showNotification', async (event, { title, body, silent = false }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || 'Gemini Video Subtitles',
      body: body || '',
      silent,
    });
    notification.show();
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    return true;
  }
  return false;
});

// Developer Tools / F12 Console Control
ipcMain.handle('app:toggleDevTools', async () => {
  if (mainWindow) {
    mainWindow.webContents.toggleDevTools();
    return true;
  }
  return false;
});

ipcMain.handle('app:openDevTools', async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
    return true;
  }
  return false;
});

// Prevent sleep / suspension during long video export
ipcMain.handle('power:preventSleep', async () => {
  if (activePowerSaveBlockerId === null || !powerSaveBlocker.isStarted(activePowerSaveBlockerId)) {
    activePowerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }
  return { active: true, id: activePowerSaveBlockerId };
});

ipcMain.handle('power:releaseSleep', async () => {
  if (activePowerSaveBlockerId !== null && powerSaveBlocker.isStarted(activePowerSaveBlockerId)) {
    powerSaveBlocker.stop(activePowerSaveBlockerId);
    activePowerSaveBlockerId = null;
  }
  return { active: false };
});

ipcMain.handle('system:getInfo', async () => {
  let nativeHardwareId = '';
  let motherboardSerial = '';

  // Retrieve native hardware UUID on Windows / Mac / Linux
  try {
    if (process.platform === 'win32') {
      // 1. Motherboard Serial / UUID
      try {
        const mb = execSync('wmic baseboard get serialnumber', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });
        motherboardSerial = mb.replace(/SerialNumber/i, '').trim();
      } catch (_) {}

      // 2. Windows MachineGuid from Registry (Immutable across OS reinstallation / hardware changes)
      if (!nativeHardwareId) {
        try {
          const regOut = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 3000
          });
          const match = regOut.match(/MachineGuid\s+REG_SZ\s+([a-zA-Z0-9\-]+)/i);
          if (match && match[1]) {
            nativeHardwareId = match[1].trim();
          }
        } catch (_) {}
      }
    } else if (process.platform === 'darwin') {
      try {
        const ioreg = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep -E "IOPlatformUUID"', { encoding: 'utf-8', timeout: 3000 });
        const match = ioreg.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
        if (match && match[1]) nativeHardwareId = match[1].trim();
      } catch (_) {}
    } else if (process.platform === 'linux') {
      try {
        if (fs.existsSync('/etc/machine-id')) {
          nativeHardwareId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Deterministic seed hash
  const rawHardwareCombined = [
    nativeHardwareId || '',
    motherboardSerial || '',
    os.cpus()[0]?.model || '',
    os.arch(),
    os.hostname()
  ].join('###');

  const hardwareHash = crypto.createHash('sha256').update(rawHardwareCombined).digest('hex').slice(0, 8).toUpperCase();

  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    totalMemoryGB: Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
    freeMemoryGB: Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    nativeHardwareId,
    motherboardSerial,
    hardwareHash,
    memberCode: `MEM-${hardwareHash.slice(0, 4)}-${hardwareHash.slice(4, 8)}`,
    deviceId: `DEV-${hardwareHash.slice(0, 4)}-${hardwareHash.slice(4, 8)}`,
  };
});

// Write data to temporary file
ipcMain.handle('fs:writeTempFile', async (event, { filename, content, isBase64 = false }) => {
  try {
    const tempDir = path.join(os.tmpdir(), 'gemini_subtitles');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const filePath = path.join(tempDir, filename);
    if (isBase64) {
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// FFmpeg checks and Hardware GPU Encoders detection
ipcMain.handle('ffmpeg:check', async () => {
  try {
    const versionOutput = execSync('ffmpeg -version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const firstLine = versionOutput.split('\n')[0] || '';
    
    // Detect hardware encoders
    let encodersOutput = '';
    try {
      encodersOutput = execSync('ffmpeg -encoders', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {}

    const hwEncoders = {
      nvenc_h264: encodersOutput.includes('h264_nvenc'),
      nvenc_hevc: encodersOutput.includes('hevc_nvenc'),
      qsv_h264: encodersOutput.includes('h264_qsv'),
      qsv_hevc: encodersOutput.includes('hevc_qsv'),
      videotoolbox_h264: encodersOutput.includes('h264_videotoolbox'),
      videotoolbox_hevc: encodersOutput.includes('hevc_videotoolbox'),
      vaapi_h264: encodersOutput.includes('h264_vaapi'),
    };

    return {
      available: true,
      version: firstLine,
      hardwareAcceleration: hwEncoders,
    };
  } catch (err) {
    return { available: false, error: err.message, hardwareAcceleration: {} };
  }
});

// Cancel active FFmpeg render
ipcMain.handle('ffmpeg:cancel', async () => {
  if (activeFfmpegProcess) {
    try {
      activeFfmpegProcess.kill('SIGKILL');
      activeFfmpegProcess = null;
      if (mainWindow) {
        mainWindow.setProgressBar(-1);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: true };
});

// Run arbitrary FFmpeg command natively on Desktop (C/C++ binary)
ipcMain.handle('ffmpeg:run', async (event, payload) => {
  let args = [];
  if (Array.isArray(payload)) {
    args = payload;
  } else if (payload && Array.isArray(payload.args)) {
    args = payload.args;
  } else if (payload && typeof payload.command === 'string') {
    // Parse command string into arguments safely
    args = payload.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    args = args.map(arg => arg.replace(/^["']|["']$/g, ''));
    if (args[0] === 'ffmpeg') args.shift();
  } else if (typeof payload === 'string') {
    args = payload.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    args = args.map(arg => arg.replace(/^["']|["']$/g, ''));
    if (args[0] === 'ffmpeg') args.shift();
  }

  return new Promise((resolve) => {
    try {
      console.log('[Native FFmpeg PC] Running:', args.join(' '));
      const proc = spawn('ffmpeg', args);
      activeFfmpegProcess = proc;
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (mainWindow) {
          mainWindow.webContents.send('ffmpeg:progress', { chunk });
        }
      });

      proc.on('close', (code) => {
        activeFfmpegProcess = null;
        resolve({
          success: code === 0,
          code,
          stdout,
          stderr,
        });
      });

      proc.on('error', (err) => {
        activeFfmpegProcess = null;
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: stderr + '\n' + err.message,
          error: err.message,
        });
      });
    } catch (err) {
      activeFfmpegProcess = null;
      resolve({
        success: false,
        code: -1,
        stdout: '',
        stderr: err.message,
        error: err.message,
      });
    }
  });
});

// High-speed native audio extraction (bypassing browser memory limits)
ipcMain.handle('ffmpeg:extractAudio', async (event, { inputPath, outputPath, sampleRate = 16000, channels = 1 }) => {
  try {
    const targetOutput = outputPath || path.join(os.tmpdir(), `gemini_audio_${Date.now()}.wav`);
    const args = ['-y', '-i', inputPath, '-vn', '-acodec', 'pcm_s16le', '-ar', String(sampleRate), '-ac', String(channels), targetOutput];
    
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', args);
      activeFfmpegProcess = proc;
      let stderr = '';

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        activeFfmpegProcess = null;
        if (code === 0 && fs.existsSync(targetOutput)) {
          resolve({ success: true, outputPath: targetOutput });
        } else {
          resolve({ success: false, code, error: stderr.slice(-300) });
        }
      });
      proc.on('error', (err) => {
        activeFfmpegProcess = null;
        resolve({ success: false, error: err.message });
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Helper to strip ASS syntax to simple SRT for MP4 mov_text softsubs
function convertAssToSrt(assText) {
  if (!assText) return '';
  const lines = assText.split(/\r?\n/);
  let inEvents = false;
  let srtIndex = 1;
  const srtBlocks = [];

  for (const line of lines) {
    if (line.trim().startsWith('[Events]')) {
      inEvents = true;
      continue;
    }
    if (inEvents && line.startsWith('Dialogue:')) {
      const parts = line.split(',');
      if (parts.length >= 10) {
        const start = parts[1]?.trim() || '0:00:00.00';
        const end = parts[2]?.trim() || '0:00:00.00';
        const text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
        if (text) {
          const formatTime = (t) => {
            const p = t.split(':');
            const h = (p[0] || '0').padStart(2, '0');
            const m = (p[1] || '0').padStart(2, '0');
            const secParts = (p[2] || '00.00').split('.');
            const s = (secParts[0] || '00').padStart(2, '0');
            const ms = (secParts[1] || '00').padEnd(3, '0').slice(0, 3);
            return `${h}:${m}:${s},${ms}`;
          };
          srtBlocks.push(`${srtIndex++}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n`);
        }
      }
    }
  }
  return srtBlocks.join('\n');
}

// High-level Subtitled Video Render with FFmpeg and GPU Acceleration
ipcMain.handle('ffmpeg:renderSubtitledVideo', async (event, payload) => {
  const {
    inputVideoPath,
    inputVideoBufferBase64,
    assContent,
    srtContent,
    audioWavBase64,
    outputPath,
    videoDuration = 0,
    options = {}
  } = payload;

  const tempFilesToClean = [];
  const tempDir = path.join(os.tmpdir(), 'gemini_subtitles_render');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    let finalInputVideoPath = inputVideoPath;

    // If input video is passed as base64 buffer, write to disk
    if (!finalInputVideoPath && inputVideoBufferBase64) {
      finalInputVideoPath = path.join(tempDir, `temp_input_${Date.now()}.mp4`);
      fs.writeFileSync(finalInputVideoPath, Buffer.from(inputVideoBufferBase64, 'base64'));
      tempFilesToClean.push(finalInputVideoPath);
    }

    if (!finalInputVideoPath || !fs.existsSync(finalInputVideoPath)) {
      throw new Error('Không tìm thấy file video nguồn hợp lệ.');
    }

    const subMode = options.subMode || 'hardsub';

    // Write Subtitle file appropriately:
    // Softsub in MP4 mov_text requires standard SRT (ASS formatting tags cause FFmpeg error -22)
    let subFilePath = null;
    if (subMode === 'softsub') {
      if (srtContent && srtContent.trim()) {
        subFilePath = path.join(tempDir, `sub_${Date.now()}.srt`);
        fs.writeFileSync(subFilePath, srtContent, 'utf-8');
        tempFilesToClean.push(subFilePath);
      } else if (assContent && assContent.trim()) {
        subFilePath = path.join(tempDir, `sub_${Date.now()}.srt`);
        fs.writeFileSync(subFilePath, convertAssToSrt(assContent), 'utf-8');
        tempFilesToClean.push(subFilePath);
      }
    } else {
      // Hardsub: prefer ASS for rich styles (colors, positions, outlines)
      if (assContent && assContent.trim()) {
        subFilePath = path.join(tempDir, `sub_${Date.now()}.ass`);
        fs.writeFileSync(subFilePath, assContent, 'utf-8');
        tempFilesToClean.push(subFilePath);
      } else if (srtContent && srtContent.trim()) {
        subFilePath = path.join(tempDir, `sub_${Date.now()}.srt`);
        fs.writeFileSync(subFilePath, srtContent, 'utf-8');
        tempFilesToClean.push(subFilePath);
      }
    }

    // Write TTS Dubbing audio if provided
    let voiceoverAudioPath = null;
    if (audioWavBase64) {
      voiceoverAudioPath = path.join(tempDir, `dub_${Date.now()}.wav`);
      fs.writeFileSync(voiceoverAudioPath, Buffer.from(audioWavBase64, 'base64'));
      tempFilesToClean.push(voiceoverAudioPath);
    }

    // Inspect available hardware encoders
    let encodersOutput = '';
    try {
      encodersOutput = execSync('ffmpeg -encoders', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {}

    const hasNvenc = encodersOutput.includes('h264_nvenc');
    const hasQsv = encodersOutput.includes('h264_qsv');
    const hasVideotoolbox = encodersOutput.includes('h264_videotoolbox');

    // Check if input video has an audio stream
    let hasVideoAudio = true;
    try {
      const probeOut = execSync(`ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${finalInputVideoPath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000
      });
      hasVideoAudio = probeOut.trim().length > 0;
    } catch (_) {
      hasVideoAudio = true;
    }

    const videoVolume = options.videoVolume ?? (voiceoverAudioPath ? 0.35 : 1.0);
    const ttsVolume = options.ttsVolume ?? 1.0;

    // Helper to construct FFmpeg argument list with strict input-first ordering
    const buildFfmpegArgs = (encoderType) => {
      const args = ['-y'];

      // Input 0: Main Video
      args.push('-i', finalInputVideoPath);
      let currentInputIndex = 1;

      // Input 1 (optional): Voiceover Audio
      let voiceoverInputIndex = -1;
      if (voiceoverAudioPath) {
        args.push('-i', voiceoverAudioPath);
        voiceoverInputIndex = currentInputIndex++;
      }

      // Input 2 (optional): Subtitle file for Softsub (All -i must precede output mappings)
      let softsubInputIndex = -1;
      if (subMode === 'softsub' && subFilePath) {
        args.push('-i', subFilePath);
        softsubInputIndex = currentInputIndex++;
      }

      // Stream Mappings and Filtergraph
      if (subMode === 'hardsub' && subFilePath) {
        const escapedSubPath = subFilePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");

        if (voiceoverAudioPath) {
          if (hasVideoAudio) {
            args.push(
              '-filter_complex',
              `[0:v]subtitles='${escapedSubPath}'[vout];[0:a]volume=${videoVolume}[a0];[${voiceoverInputIndex}:a]volume=${ttsVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
              '-map', '[vout]',
              '-map', '[aout]'
            );
          } else {
            args.push(
              '-filter_complex',
              `[0:v]subtitles='${escapedSubPath}'[vout];[${voiceoverInputIndex}:a]volume=${ttsVolume}[aout]`,
              '-map', '[vout]',
              '-map', '[aout]'
            );
          }
        } else {
          args.push(
            '-filter_complex',
            `[0:v]subtitles='${escapedSubPath}'[vout]`,
            '-map', '[vout]',
            '-map', '0:a?'
          );
        }
      } else {
        // Softsub or None
        args.push('-map', '0:v:0');

        if (voiceoverAudioPath) {
          if (hasVideoAudio) {
            args.push(
              '-filter_complex',
              `[0:a]volume=${videoVolume}[a0];[${voiceoverInputIndex}:a]volume=${ttsVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
              '-map', '[aout]'
            );
          } else {
            args.push(
              '-filter_complex',
              `[${voiceoverInputIndex}:a]volume=${ttsVolume}[aout]`,
              '-map', '[aout]'
            );
          }
        } else {
          args.push('-map', '0:a?');
        }

        // Map Softsub stream cleanly
        if (subMode === 'softsub' && softsubInputIndex !== -1) {
          args.push('-map', `${softsubInputIndex}:0`);
          args.push('-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie');
        }
      }

      // Video Encoder Selection
      if (encoderType === 'nvenc') {
        args.push('-c:v', 'h264_nvenc', '-preset', 'medium', '-cq', String(options.crf || 20), '-pix_fmt', 'yuv420p');
      } else if (encoderType === 'qsv') {
        args.push('-c:v', 'h264_qsv', '-global_quality', String(options.crf || 20), '-pix_fmt', 'nv12');
      } else if (encoderType === 'videotoolbox') {
        args.push('-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p');
      } else {
        // Safe CPU libx264
        args.push('-c:v', 'libx264', '-preset', options.preset || 'fast', '-crf', String(options.crf || 20), '-pix_fmt', 'yuv420p');
      }

      // Audio & Container Flags
      args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);
      return args;
    };

    // Determine initial encoder to try
    const chosenGpu = options.gpuEncoder || 'auto';
    let primaryEncoder = 'cpu';
    if (chosenGpu === 'nvenc' || (chosenGpu === 'auto' && hasNvenc)) {
      primaryEncoder = 'nvenc';
    } else if (chosenGpu === 'qsv' || (chosenGpu === 'auto' && hasQsv)) {
      primaryEncoder = 'qsv';
    } else if (chosenGpu === 'videotoolbox' || (chosenGpu === 'auto' && hasVideotoolbox)) {
      primaryEncoder = 'videotoolbox';
    }

    // Execute FFmpeg with progress monitoring
    const runFfmpegSpawn = (encoderToUse) => {
      return new Promise((resolve) => {
        const args = buildFfmpegArgs(encoderToUse);
        console.log(`[FFmpeg] Launching (${encoderToUse}): ffmpeg ${args.join(' ')}`);
        const proc = spawn('ffmpeg', args);
        activeFfmpegProcess = proc;
        let stderrLogs = '';

        proc.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          stderrLogs += text;

          const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
          if (timeMatch && videoDuration > 0) {
            const hours = parseFloat(timeMatch[1]);
            const minutes = parseFloat(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentSeconds = hours * 3600 + minutes * 60 + seconds;
            const percentage = Math.min(100, Math.round((currentSeconds / videoDuration) * 100));

            if (mainWindow) {
              mainWindow.setProgressBar(percentage / 100);
              mainWindow.webContents.send('ffmpeg:render-progress', {
                percentage,
                currentTime: currentSeconds,
                duration: videoDuration,
                timeStr: `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`,
                encoder: encoderToUse,
              });
            }
          }
        });

        proc.on('close', (code) => {
          activeFfmpegProcess = null;
          resolve({ success: code === 0, code, logs: stderrLogs, encoderUsed: encoderToUse });
        });

        proc.on('error', (err) => {
          activeFfmpegProcess = null;
          resolve({ success: false, code: -1, error: err.message, logs: stderrLogs, encoderUsed: encoderToUse });
        });
      });
    };

    // First attempt with primary chosen encoder
    let result = await runFfmpegSpawn(primaryEncoder);

    // Automatic Fallback: If GPU encoder fails (e.g. NVENC driver error or code -22), retry with CPU libx264
    if (!result.success && primaryEncoder !== 'cpu') {
      console.warn(`[FFmpeg] GPU encoder '${primaryEncoder}' failed with code ${result.code}. Retrying automatically with CPU libx264...`);
      if (mainWindow) {
        mainWindow.webContents.send('ffmpeg:render-progress', {
          percentage: 0,
          currentTime: 0,
          duration: videoDuration,
          timeStr: '00:00:00',
          fallbackNotice: 'Tự động chuyển sang CPU libx264...',
          encoder: 'cpu',
        });
      }
      result = await runFfmpegSpawn('cpu');
    }

    if (mainWindow) mainWindow.setProgressBar(-1);

    // Clean up temporary files
    for (const f of tempFilesToClean) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }

    if (result.success) {
      return { success: true, outputPath, encoderUsed: result.encoderUsed, logs: result.logs };
    } else {
      const errorSummary = (result.logs || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('frame=') && !l.startsWith('size=') && !l.startsWith('Press [q]'))
        .slice(-5)
        .join('\n');

      return {
        success: false,
        code: result.code,
        error: `FFmpeg lỗi (mã ${result.code}): ${errorSummary || 'Lỗi không xác định khi xuất video'}`,
        logs: result.logs
      };
    }
  } catch (err) {
    if (mainWindow) mainWindow.setProgressBar(-1);
    for (const f of tempFilesToClean) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
    return { success: false, error: err.message };
  }
});

// Check yt-dlp availability on PC
ipcMain.handle('ytdlp:check', async () => {
  try {
    const version = execSync('yt-dlp --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return { available: true, version };
  } catch (e) {
    // Check if local bin exists
    const localBinWin = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
    const localBinLinux = path.join(process.cwd(), 'bin', 'yt-dlp');
    if (fs.existsSync(localBinWin) || fs.existsSync(localBinLinux)) {
      return { available: true, version: 'bundled' };
    }
    return { available: false, error: e.message };
  }
});

// Direct yt-dlp extraction on PC
ipcMain.handle('ytdlp:extract', async (event, { url }) => {
  try {
    const bin = fs.existsSync(path.join(process.cwd(), 'bin', 'yt-dlp.exe'))
      ? path.join(process.cwd(), 'bin', 'yt-dlp.exe')
      : (fs.existsSync(path.join(process.cwd(), 'bin', 'yt-dlp')) ? path.join(process.cwd(), 'bin', 'yt-dlp') : 'yt-dlp');

    const output = execSync(`${bin} --dump-json --no-playlist --no-warnings --all-subs --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${url}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });

    const data = JSON.parse(output.trim());
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

