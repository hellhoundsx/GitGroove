import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { registerIpc, rememberedMaterial, rememberedTheme, TITLE_BAR_OVERLAY, WINDOW_BACKGROUND } from './ipc';
import { isWebUrl } from '@shared/remotes';

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
  // What the last renderer on this profile resolved (GC-102). The setting lives in the renderer's
  // `localStorage`, which does not exist yet, so the window is built from the main process's own
  // copy and the renderer's first `applyTheme()` then confirms it rather than correcting it.
  const theme = rememberedTheme();
  // Same reasoning one setting over (GC-212): the material lives in the renderer's preferences,
  // which do not exist yet, so the main process keeps its own copy and builds the window with it.
  // Applying it at creation rather than from the renderer's first `setMaterial` is what stops the
  // window opening opaque and flicking to glass a frame later.
  const material = rememberedMaterial();
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(isStealth ? { skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true } : {}),
    // With a material on, the window's own fill has to be transparent or it paints straight over
    // it and nothing shows through. `rememberedMaterial()` answers 'none' wherever a material
    // cannot be had — another platform, an older Windows, a stealth launch — so this is one
    // condition rather than three (GC-212).
    backgroundColor: material === 'none' ? WINDOW_BACKGROUND[theme] : '#00000000',
    backgroundMaterial: material,
    // Frameless with the OS window controls overlaid, so the renderer draws its own tabs bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY[theme],
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

  // Open external links in the default browser, never inside the app window — and only the two
  // schemes a browser follows (GC-159). This is reachable only from our own renderer today, but it
  // is the same one-line check the `shell:openExternal` channel makes and belongs beside it: what
  // `openExternal` is given, it follows, `file:` and `javascript:` included.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
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
