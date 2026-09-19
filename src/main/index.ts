import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { glassAvailable, registerIpc, TITLE_BAR_OVERLAY, WINDOW_BACKGROUND } from './ipc';
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
  // One material, decided here and nowhere else (GC-213). There is no preference to read and
  // nothing remembered from the last run: either the compositor can give us glass or it cannot,
  // which `glassAvailable` answers from the platform alone. Applying it at creation rather than
  // from a renderer round trip is what stops the window opening opaque and flicking to glass a
  // frame later, and it is now free — the answer is known before any renderer exists.
  //
  // **Acrylic, not mica.** Mica is a desaturated wallpaper *tint* — Windows draws it to be almost
  // invisible, and behind a content card at any workable alpha it is nothing at all. The frosted
  // glass this design is copying off the macOS reference is acrylic, and it is the only material
  // on this platform that actually reads as one. The cost is real and accepted: Windows flattens
  // acrylic to a solid colour whenever the window is **not focused**.
  const glass = glassAvailable;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(isStealth ? { skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true } : {}),
    // With a material on, the window's own fill has to be transparent or it paints straight over
    // it and nothing shows through.
    backgroundColor: glass ? '#00000000' : WINDOW_BACKGROUND,
    backgroundMaterial: glass ? 'acrylic' : 'none',
    // Frameless with the OS window controls overlaid, so the renderer draws its own tabs bar.
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY,
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

  // The renderer is told what was applied on the URL rather than over IPC (GC-213), which is what
  // lets `main.tsx` stamp `data-material` **before the first render** instead of a frame or two
  // after a round trip resolves. Absent means no material, which is the case the stylesheet
  // treats as ordinary — and it is the safe direction either way: opaque settling into glass is
  // invisible, where glass collapsing to opaque is a flash of the wrong window.
  const search = glass ? 'material=acrylic' : '';
  if (isDev) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL!);
    if (search) url.search = search;
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search });
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
