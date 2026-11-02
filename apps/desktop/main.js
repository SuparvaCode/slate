// Slate for Windows: a window on the site you deploy, so every web release reaches it without an
// update. Google won't sign in inside an app's own window, so sign-in opens the system browser on
// a Slate page that hands the result back here (see signin.js).
// SLATE_URL is required: it is the address of your own Slate deployment.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { googleSignIn } = require('./signin');

const rawUrl = process.env.SLATE_URL?.trim();
let SITE;
try {
  SITE = new URL(rawUrl ?? '');
} catch {
  dialog.showErrorBox(
    'Slate needs a server',
    'Set SLATE_URL to the address of your Slate deployment (for example https://slate.example.com) and start Slate again.',
  );
  app.quit();
  SITE = new URL('http://localhost');
}
const isSite = (url) => {
  try {
    return new URL(url).origin === SITE.origin;
  } catch {
    return false;
  }
};
const openOutside = (url) => {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    // not a URL
  }
};

// What the site may ask for: the microphone for voice in rooms, the clipboard, full screen.
const ALLOWED = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications']);

let win = null;

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 540,
    title: 'Slate',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#1c1c1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });

  // Links to other sites open in the browser; the window only ever shows Slate.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isSite(url)) return;
    e.preventDefault();
    openOutside(url);
  });
  // No connection at start: show the offline page, whose button tries the site again.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && isSite(url)) {
      void win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: SITE.href } });
    }
  });

  void win.loadURL(SITE.href);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => {
      done(isSite(details.requestingUrl) && ALLOWED.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => isSite(origin) && ALLOWED.has(permission));

    ipcMain.handle('slate:google-signin', (e) => {
      if (!isSite(e.senderFrame?.url ?? '')) return { cancelled: true };
      return googleSignIn(SITE, (url) => shell.openExternal(url), focusWindow);
    });

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
