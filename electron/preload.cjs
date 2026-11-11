const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // File dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),

  // Native shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  showItemInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path),

  // OS Integration & Taskbar
  setProgressBar: (progress, options) => ipcRenderer.invoke('app:setProgressBar', progress, options),
  showNotification: (options) => ipcRenderer.invoke('app:showNotification', options),
  preventSleep: () => ipcRenderer.invoke('power:preventSleep'),
  releaseSleep: () => ipcRenderer.invoke('power:releaseSleep'),
  toggleDevTools: () => ipcRenderer.invoke('app:toggleDevTools'),
  openDevTools: () => ipcRenderer.invoke('app:openDevTools'),

  // System specs & Hardware Info
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),

  // File helpers
  writeTempFile: (options) => ipcRenderer.invoke('fs:writeTempFile', options),

  // Native FFmpeg execution (with hardware encoders detection)
  checkFfmpegInstalled: () => ipcRenderer.invoke('ffmpeg:check'),
  cancelFfmpegRender: () => ipcRenderer.invoke('ffmpeg:cancel'),
  renderSubtitledVideo: (payload) => ipcRenderer.invoke('ffmpeg:renderSubtitledVideo', payload),
  runFfmpeg: (args) => ipcRenderer.invoke('ffmpeg:run', args),
  extractAudio: (options) => ipcRenderer.invoke('ffmpeg:extractAudio', options),
  onFfmpegProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('ffmpeg:progress', subscription);
    return () => ipcRenderer.removeListener('ffmpeg:progress', subscription);
  },
  onFfmpegRenderProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('ffmpeg:render-progress', subscription);
    return () => ipcRenderer.removeListener('ffmpeg:render-progress', subscription);
  },

  // App Menu events
  onOpenVideoMenu: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('menu:open-video', subscription);
    return () => ipcRenderer.removeListener('menu:open-video', subscription);
  }
});
