import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron';
import { registerIpc, TITLE_BAR_OVERLAY, WINDOW_BACKGROUND, windowMaterial } from './ipc';
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

// `__dirname` is `out/main` at runtime, so two levels up is the checkout root. The kit that
// produced this file is `assets/branding/` — see its README.
const APP_ICON = join(__dirname, '../../assets/branding/gitgroove.ico');
// macOS ignores a window's `icon` and has no use for an .ico: the Dock takes the Apple-grid tile,
// set on the app rather than on a window. Guarded for the same reason `APP_ICON` is.
const MAC_ICON = join(__dirname, '../../assets/branding/png/gitgroove-icon-macos-1024.png');
const isMac = process.platform === 'darwin';

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
  const material = windowMaterial;
  const glass = material !== null;
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // The window icon: the taskbar, Alt-Tab and the Windows window menu. It is the .ico rather
    // than a PNG because that file carries every size from 16 to 256 and lets Windows pick,
    // where a single PNG is downscaled once and badly.
    //
    // Guarded, and the guard is the point. `assets/` is outside every bundle electron-vite
    // writes, so this path resolves only while the app runs from the checkout — which is all
    // there is today, since nothing packages this app yet. The moment something does, the path
    // stops resolving, and a missing icon must not be the thing that stops the window opening.
    ...(existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    ...(isStealth ? { skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: true } : {}),
    // With a material on, the window's own fill has to be transparent or it paints straight over
    // it and nothing shows through.
    backgroundColor: glass ? '#00000000' : WINDOW_BACKGROUND,
    backgroundMaterial: material === 'acrylic' ? 'acrylic' : 'none',
    // macOS's material. `active` keeps it frosted while the window is in the background, which
    // Windows' acrylic cannot do.
    ...(material === 'vibrancy' ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    // Frameless with the OS window controls overlaid, so the renderer draws its own tabs bar. On
    // macOS those controls are the traffic lights at the **left**, centred in the 34px bar; the
    // stylesheet moves the tabs clear of them under `data-platform='darwin'`.
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 10 } } : { titleBarOverlay: TITLE_BAR_OVERLAY }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...(isStealth ? { offscreen: true, backgroundThrottling: false } : {}),
    },
  });

  // Electron can drop the macOS vibrancy when the window loses focus and not put it back when it
  // regains it (electron/electron#46164), leaving the window opaque. Re-applying the material and
  // the transparent fill whenever the window changes state costs nothing when it was still there.
  if (material === 'vibrancy') {
    const reapply = (): void => {
      if (win.isDestroyed()) return;
      win.setBackgroundColor('#00000000');
      win.setVibrancy('under-window');
    };
    win.on('focus', reapply);
    win.on('blur', reapply);
    win.on('show', reapply);
    win.on('restore', reapply);
    win.on('leave-full-screen', reapply);
  }

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
  const params = new URLSearchParams();
  if (material) params.set('material', material);
  params.set('platform', process.platform);
  const search = params.toString();
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
  // One dark look (GC-213), so the macOS material is the dark one whatever the system appearance.
  nativeTheme.themeSource = 'dark';
  // A stealth launch on macOS still gets a Dock icon and can take the menu bar, where an offscreen
  // window alone is enough on Windows; hiding the Dock icon makes it an accessory app that never
  // activates, which is the macOS half of "never steal focus".
  if (isMac && isStealth) app.dock?.hide();
  else if (isMac && existsSync(MAC_ICON)) app.dock?.setIcon(nativeImage.createFromPath(MAC_ICON));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
