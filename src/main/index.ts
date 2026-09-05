import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { registerIpc } from './ipc';

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;

// Stealth mode (GITCLIENT_STEALTH=1, set by tools/launch-app.mjs) is for unattended runs that
// drive the app over the DevTools protocol while somebody else is using the machine: the window
// is rendered offscreen, so no OS window exists, nothing appears in the taskbar and the
// foreground window never changes. Screenshots still work, they come from the compositor.
const isStealth = process.env.GITCLIENT_STEALTH === '1';

// Every launch shares one Electron profile by default (`%APPDATA%/gitclient`), so an unattended run
// reads and writes the same `localStorage` Ricardo sees: his last repository was rewritten by every
// `--repo` launch, and a `gitclient.refColW` left at 100 by one session silently changed what the
// next session's screenshots showed (GC-060). `GITCLIENT_USER_DATA` points a launch at a profile of
// its own; `tools/launch-app.mjs` sets it per DevTools port. It must be applied before the app is
// ready, which is why it runs at module scope. A start outside the launcher (`npm run dev`, a
// packaged app) leaves the variable unset and keeps the real profile.
if (process.env.GITCLIENT_USER_DATA) app.setPath('userData', process.env.GITCLIENT_USER_DATA);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(isStealth ? { skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true } : {}),
    backgroundColor: '#1b1d22',
    // Frameless with the OS window controls overlaid, so the renderer draws its own tabs bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#2b2e36', symbolColor: '#d4d6db', height: 34 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...(isStealth ? { offscreen: true, backgroundThrottling: false } : {}),
    },
  });

  if (isStealth) {
    // Nothing is displayed, so keep the offscreen paint loop cheap.
    win.webContents.setFrameRate(10);
  } else {
    win.on('ready-to-show', () => win.show());
  }

  // Open external links in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
