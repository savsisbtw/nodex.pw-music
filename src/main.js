'use strict';

const { app, BrowserWindow, ipcMain, session, shell, nativeTheme, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');
const http = require('http');

nativeTheme.themeSource = 'dark';

// Windows taskbar / notification area name
if (process.platform === 'win32') {
  app.setAppUserModelId('Nodex.pw LTD');
}

const CACHE_DIR = path.join(app.getPath('userData'), 'track_cache');
const API_BASE  = 'https://music.nodex.pw';
const ICON_ICO  = path.join(__dirname, '..', 'assets', 'icon.ico');
const ICON_PNG  = path.join(__dirname, '..', 'assets', 'tray-icon.png');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let mainWin = null;
let tray    = null;

/* ── Tray ────────────────────────────────────────────────── */
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'nodex.pw',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Показать',
      click: () => { mainWin?.show(); mainWin?.focus(); },
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => { app.isQuiting = true; app.quit(); },
    },
  ]);
}

function createTray() {
  // Use PNG for tray (better on Win11), fall back to ICO
  const imgPath = fs.existsSync(ICON_PNG) ? ICON_PNG : ICON_ICO;
  const img = nativeImage.createFromPath(imgPath);
  // Resize to 16x16 for tray — Win11 prefers this
  const trayImg = img.resize({ width: 16, height: 16 });

  tray = new Tray(trayImg);
  tray.setToolTip('nodex.pw');
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => {
    if (!mainWin) return;
    if (mainWin.isVisible()) {
      mainWin.focus();
    } else {
      mainWin.show();
    }
  });

  tray.on('double-click', () => {
    mainWin?.show(); mainWin?.focus();
  });
}

/* ── Window ──────────────────────────────────────────────── */
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 540,
    frame: false,
    transparent: false,
    backgroundColor: '#050508',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: 'persist:main',
    },
    icon: ICON_ICO,
    show: false,
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open external links in browser, not in the app
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });

  mainWin.once('ready-to-show', () => {
    mainWin.show();
    setupUpdater();
  });

  // Minimize to tray on close
  mainWin.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWin.hide();
      if (process.platform === 'win32') {
        tray?.displayBalloon({
          iconType: 'none',
          title: 'nodex.pw',
          content: 'Работает в фоне. Нажмите на иконку в трее.',
          noSound: true,
        });
      }
    }
  });

  mainWin.on('closed', () => { mainWin = null; });
}

/* ── IPC: Window controls ────────────────────────────────── */
ipcMain.on('app-version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('win-minimize', () => mainWin?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWin?.isMaximized()) mainWin.unmaximize();
  else mainWin?.maximize();
});
ipcMain.on('win-close', () => {
  // Close button → hide to tray
  mainWin?.hide();
});

/* ── IPC: Tray state update (play/pause title) ───────────── */
ipcMain.on('tray-update', (_, { title, artist, playing }) => {
  if (!tray) return;
  const label = title ? `${title}${artist ? ' — ' + artist : ''}` : 'nodex.pw';
  tray.setToolTip(label);
});

/* ── IPC: Cache management ───────────────────────────────── */
ipcMain.handle('cache-check', (_, cacheKey) => {
  for (const ext of ['mp3', 'm4a', 'opus', 'ogg', 'webm']) {
    const p = path.join(CACHE_DIR, `${cacheKey}.${ext}`);
    if (fs.existsSync(p)) return { exists: true, path: p, ext };
  }
  return { exists: false };
});

ipcMain.handle('cache-list', () => {
  try {
    return fs.readdirSync(CACHE_DIR).map(f => {
      const fp = path.join(CACHE_DIR, f);
      const st = fs.statSync(fp);
      return { file: f, size: st.size, mtime: st.mtimeMs };
    });
  } catch { return []; }
});

ipcMain.handle('cache-delete', (_, cacheKey) => {
  for (const ext of ['mp3', 'm4a', 'opus', 'ogg', 'webm']) {
    const p = path.join(CACHE_DIR, `${cacheKey}.${ext}`);
    if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  }
  return false;
});

ipcMain.handle('cache-size', () => {
  try {
    return fs.readdirSync(CACHE_DIR).reduce((s, f) => {
      try { return s + fs.statSync(path.join(CACHE_DIR, f)).size; } catch { return s; }
    }, 0);
  } catch { return 0; }
});

/* ── IPC: Download track ─────────────────────────────────── */
ipcMain.handle('download-track', async (_, { streamUrl, cacheKey, ext }) => {
  return new Promise((resolve, reject) => {
    const dest = path.join(CACHE_DIR, `${cacheKey}.${ext || 'mp3'}`);
    const tmp  = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    const fullUrl = streamUrl.startsWith('http') ? streamUrl : API_BASE + streamUrl;
    const mod = fullUrl.startsWith('https') ? require('https') : require('http');
    mod.get(fullUrl, { headers: { Cookie: global.authCookie || '' } }, res => {
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(tmp, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.rename(tmp, dest, err => { if (err) reject(err); else resolve(dest); });
      });
    }).on('error', err => {
      file.close(); fs.unlink(tmp, () => {});
      reject(err);
    });
  });
});

/* ── IPC: Auth cookie ────────────────────────────────────── */
ipcMain.on('set-auth-cookie', (_, cookie) => { global.authCookie = cookie; });

ipcMain.handle('refresh-auth-cookie', async () => {
  const ses     = session.fromPartition('persist:main');
  const cookies = await ses.cookies.get({ domain: 'music.nodex.pw' });
  const str     = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  if (str) global.authCookie = str;
  return str;
});

/* ── Google OAuth ────────────────────────────────────────── */
async function exchangeAuthToken(token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}/auth/exchange`);
    url.searchParams.set('t', token);
    require('https').get(url.href, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (data.ok) {
            const setCookies = res.headers['set-cookie'] || [];
            const ses = session.fromPartition('persist:main');
            for (const raw of setCookies) {
              const [nameVal, ...attrs] = raw.split(';').map(s => s.trim());
              const eqIdx = nameVal.indexOf('=');
              const name  = nameVal.slice(0, eqIdx);
              const value = nameVal.slice(eqIdx + 1);
              await ses.cookies.set({
                url: API_BASE, name, value,
                secure: attrs.some(a => a.toLowerCase() === 'secure'),
                path: (attrs.find(a => a.toLowerCase().startsWith('path=')) || 'path=/').split('=')[1],
              }).catch(() => {});
            }
            const cookies = await ses.cookies.get({ domain: 'music.nodex.pw' });
            global.authCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            resolve(data.user);
          } else { reject(new Error('exchange failed')); }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

ipcMain.handle('open-external', (_, url) => { shell.openExternal(url); });

ipcMain.handle('open-auth-window', () => {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const u     = new URL(req.url, 'http://localhost');
      const token = u.searchParams.get('t');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#050508;color:#707070;font-family:\'Segoe UI\',monospace;display:flex;align-items:center;justify-content:center;height:100vh;font-size:13px}</style></head><body><p>Вошли в nodex.pw. Можно закрыть это окно.</p></body></html>');
      server.close();
      if (token) {
        try { const user = await exchangeAuthToken(token); mainWin?.webContents.send('auth-done', global.authCookie); resolve(user); }
        catch { mainWin?.webContents.send('auth-done', null); resolve(null); }
      } else { mainWin?.webContents.send('auth-done', null); resolve(null); }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const cb = encodeURIComponent(`http://localhost:${port}`);
      shell.openExternal(`${API_BASE}/auth/google?electron=${cb}`);
    });
    setTimeout(() => { try { server.close(); } catch {} resolve(null); }, 300000);
  });
});

/* ── App ready ───────────────────────────────────────────── */
app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => { if (!mainWin) createWindow(); });
});

app.on('window-all-closed', () => {
  // Don't quit on close — stay in tray
  // Only quit via tray menu "Выйти"
});

app.on('before-quit', () => { app.isQuiting = true; });

/* ── Auto-updater ────────────────────────────────────────── */
function setupUpdater() {
  autoUpdater.autoDownload    = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: `${API_BASE}/updates/` });

  autoUpdater.on('update-available',    info => mainWin?.webContents.send('update-available', info));
  autoUpdater.on('update-not-available',()   => mainWin?.webContents.send('update-not-available'));
  autoUpdater.on('download-progress',   p    => mainWin?.webContents.send('update-progress', p));
  autoUpdater.on('update-downloaded',   ()   => mainWin?.webContents.send('update-downloaded'));
  autoUpdater.on('error',               err  => mainWin?.webContents.send('update-error', err?.message));

  ipcMain.on('update-download', () => autoUpdater.downloadUpdate());
  ipcMain.on('update-install',  () => autoUpdater.quitAndInstall());

  try {
    const p = autoUpdater.checkForUpdates();
    if (p && p.catch) p.catch(() => mainWin?.webContents.send('update-not-available'));
    else mainWin?.webContents.send('update-not-available');
  } catch(e) {
    mainWin?.webContents.send('update-not-available');
  }
}
