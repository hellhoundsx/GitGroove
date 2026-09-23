// Makes the Electron that `npm run dev` runs look like GitGroove on macOS, and does nothing
// anywhere else. Runs from `postinstall`, and by hand: `node tools/mac-dev-app.mjs`.
//
// In development the app is not a bundle of its own: it runs inside
// node_modules/electron/dist/Electron.app, and macOS takes the Dock tooltip, the menu-bar name and
// the icon that bounces while the app launches from **that** bundle's Info.plist and .icns, none
// of which the running app can change. So they are patched in place — and since `npm install`
// replaces the bundle, that has to happen after every install. `app.setName()` is deliberately not
// the answer: it moves the userData folder, and with it every remembered `gitclient.*` key.
//
// It also downloads the Electron binary when it is missing, which an install has been seen to skip.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'GitGroove';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = join(ROOT, 'node_modules/electron');
const BUNDLE = join(ELECTRON, 'dist/Electron.app');
const ICON = join(ROOT, 'assets/branding/png/gitgroove-icon-macos-1024.png');
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

if (process.platform !== 'darwin' || !existsSync(ELECTRON)) process.exit(0);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });

if (!existsSync(BUNDLE)) run(process.execPath, [join(ELECTRON, 'install.js')]);

const plist = join(BUNDLE, 'Contents/Info.plist');
for (const key of ['CFBundleName', 'CFBundleDisplayName']) run('plutil', ['-replace', key, '-string', NAME, plist]);

// The Dock icon at launch, before `app.dock.setIcon` in the main process takes over.
if (existsSync(ICON)) {
  const work = mkdtempSync(join(tmpdir(), 'gitgroove-icon-'));
  const set = join(work, 'icon.iconset');
  run('mkdir', [set]);
  for (const size of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(size), String(size), ICON, '--out', join(set, `icon_${size}x${size}.png`)]);
    run('sips', ['-z', String(size * 2), String(size * 2), ICON, '--out', join(set, `icon_${size}x${size}@2x.png`)]);
  }
  run('iconutil', ['-c', 'icns', set, '-o', join(BUNDLE, 'Contents/Resources/electron.icns')]);
  rmSync(work, { recursive: true, force: true });
}

// LaunchServices caches a bundle's name and icon; touching it and re-registering is what makes the
// Dock read the new ones rather than the ones it saw the first time the bundle ran.
run('touch', [BUNDLE]);
if (existsSync(LSREGISTER)) run(LSREGISTER, ['-f', BUNDLE]);

console.log(`mac-dev-app: ${BUNDLE} is now ${NAME}`);
