const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),

  // Local track cache
  cacheCheck:  (key)  => ipcRenderer.invoke('cache-check', key),
  cacheList:   ()     => ipcRenderer.invoke('cache-list'),
  cacheDelete: (key)  => ipcRenderer.invoke('cache-delete', key),
  cacheSize:   ()     => ipcRenderer.invoke('cache-size'),

  // Download a stream URL to local cache
  downloadTrack: (opts) => ipcRenderer.invoke('download-track', opts),

  // Auth cookie
  setAuthCookie:      (c) => ipcRenderer.send('set-auth-cookie', c),
  refreshAuthCookie:  ()  => ipcRenderer.invoke('refresh-auth-cookie'),

  // Google OAuth
  openAuthWindow: () => ipcRenderer.invoke('open-auth-window'),
  onAuthDone:  (cb) => ipcRenderer.on('auth-done',  (_, d) => cb(d)),
  onAuthToken: (cb) => ipcRenderer.on('auth-token', (_, t) => cb(t)),

  // Tray: update tooltip with current track
  trayUpdate: (info) => ipcRenderer.send('tray-update', info),

  // Auto-updater
  onUpdateAvailable:    (cb) => ipcRenderer.on('update-available',     (_, i) => cb(i)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', ()     => cb()),
  onUpdateProgress:     (cb) => ipcRenderer.on('update-progress',      (_, p) => cb(p)),
  onUpdateDownloaded:   (cb) => ipcRenderer.on('update-downloaded',    ()     => cb()),
  onUpdateError:        (cb) => ipcRenderer.on('update-error',         (_, e) => cb(e)),
  downloadUpdate: () => ipcRenderer.send('update-download'),
  installUpdate:  () => ipcRenderer.send('update-install'),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  platform:   process.platform,
  appVersion: ipcRenderer.sendSync('app-version'),
});
