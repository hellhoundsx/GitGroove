<img src="assets/branding/png/gitgroove-lockup-dark%402x.png" alt="GitGroove" width="440">

A desktop Git client with a visual commit graph, built with Electron, React and
TypeScript. The UX is informed by a study of GitKraken Desktop; see
`docs/reference/gitkraken/` for the notes and screenshots that drive the design.
The implementation is original.

The mark is three rings of dots — a record's grooves and a commit graph's rings are the
same drawing — with one commit picked out in a branch colour. `assets/branding/` holds
the kit and the generator that produces it.

## Stack

- Electron with electron-vite (main, preload and renderer bundles)
- React 19 + TypeScript in the renderer
- Git operations by shelling out to the `git` executable from the main process
  (`src/main/git.ts`), exposed to the renderer through a context-isolated preload
  bridge (`src/preload/index.ts`)

## Run

```bash
npm install
npm run dev
```

`npm run build` produces the bundles in `out/`; `npm run typecheck` runs the
TypeScript checks for both the Node and browser targets.

### Dependency notes

- electron-vite 5 supports Vite 5 to 7, while the newest `@vitejs/plugin-react` (6.x)
  requires Vite 8. Keep `vite@^7` with `@vitejs/plugin-react@^5` until electron-vite
  adds Vite 8 support.
- TypeScript 7 removed the deprecated `baseUrl` option; path aliases in the
  tsconfig files are written relative to the config file.
- React 19 types no longer declare a global `JSX` namespace; components import
  `JSX` from `react`.
- Icons come from `lucide-react` (ISC licence) through the `Icon` wrapper in
  `src/renderer/src/ui/icons.tsx`; the UI font is Open Sans bundled via
  `@fontsource/open-sans` (SIL Open Font Licence). Avatars are fetched from Gravatar
  by a SHA-256 hash of the author email, with initials as the fallback; this is the
  one network call the renderer makes and it will become a preference.

### Debugging the running app

Launch the built app with a DevTools port and drive it with the same helper used
for the GitKraken research. The launcher is stealthy by default (the window is
rendered offscreen, so nothing appears on screen or in the taskbar and the
foreground window never changes); pass `--visible` for the normal window:

```bash
npm run build && node tools/launch-app.mjs --port 9333 --repo /path/to/repo
```

```bash
CDP_PORT=9333 node tools/gk-recon/cdp.mjs 0 shot shot.png
```

## Layout

```
src/
  main/       Electron main process: window, IPC, git wrapper
  preload/    contextBridge API (window.api)
  renderer/   React app
    src/graph        lane layout algorithm and graph rendering
    src/components   title bar, toolbar, left panel, detail panel, status bar
    src/styles       design tokens and app styles
  shared/     types shared across processes
docs/reference/gitkraken/   UI research notes and screenshots
tools/gk-recon/             scripts used to capture the research
```

## Roadmap

1. Layout shell, open repository, commit list with lanes and refs: done
2. Commit file list and unified diff view with hunks: done (own parser and renderer, no Monaco yet)
3. Stage / unstage / discard per file and per hunk, commit and amend: done
4. Virtualised graph, keyboard navigation (arrows, Escape): done
5. Branch create / checkout / rename / delete, merge, rebase, cherry-pick, revert, reset,
   fetch / pull (three modes) / push with upstream setup: done (credentials rely on the
   system credential helper)
6. Stash save / apply / pop / drop, tags, remotes listing: done
7. Context menus on commits, ref chips, left-panel rows, stashes, remotes and the WIP row;
   merge / rebase / cherry-pick / revert in-progress banner with abort, conflicted files group: done
8. Drag-and-drop merge and rebase, interactive rebase editor
9. Lazy loading beyond the first 2000 commits, file watcher for automatic refresh
10. Light theme, preferences, keyboard shortcuts overlay, side-by-side diff, commit search

## Testing

End-to-end suite in `tools/e2e/`. It builds a disposable repository with a bare remote, launches
the built app with a DevTools port, drives the real UI over the Chrome DevTools Protocol and
checks every step against git:

```bash
npm run build && npm run e2e:setup && npm run e2e
```

Covered: open repository, branch create / checkout / delete through the toolbar prompt and the
left-panel menu, stash and pop, a real merge conflict with banner and abort, cherry-pick (clean
and already-applied, including the kept git message), push, fetch, pull, tag create and delete,
and the WIP row menu. The scratch repository lives under the system temp directory
(`GITCLIENT_E2E_ROOT` overrides it) and screenshots of each state land in its `shots/` folder.
The run kills any other Electron process first, so close other Electron apps before running it.

`tools/gk-recon/cdp.mjs` is the same DevTools client as a command line tool, useful for poking
at the running app (see "Debugging the running app").
