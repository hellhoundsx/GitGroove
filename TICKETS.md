# GitClient tickets

The backlog of work that can be started right now, in a form an unattended session can pick
up. Every ticket has exactly one status. The per-ticket `Status:` line is the source of truth;
the board table below is a convenience and must be kept in sync whenever a status changes.

Read `CLAUDE.md` before touching any ticket. Its two hard rules apply to every ticket: study
GitKraken, never copy it; never run write operations against Ricardo's real repositories.

## Statuses

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `todo` | Ready to start. Scope and acceptance criteria are written down. | Ricardo (or a session adding a ticket) |
| `in-progress` | Claimed by one worker session. Its presence tells every other worker run to exit. Reviews never use it. | The session that claims it |
| `done` | Implemented, verified, committed and pushed. | The session that finished it |
| `blocked` | Cannot proceed without a decision, a design or another ticket. Reason is in the log. | Anyone |

Ricardo can reopen a `done` ticket by setting it back to `todo` with a log line saying why.

## Routine protocol (for the scheduled session)

The routine fires every few minutes. Most runs do nothing. A run that finds work takes exactly
one ticket and stays alive until that ticket is `done` or `blocked`, committed and pushed on
`main`. Because of the `in-progress` lock, at most one ticket is ever being worked on.

1. **Sync.** `git pull --ff-only origin main`. If the pull fails (network, authentication,
   non-fast-forward), stop and report; never work while pushes cannot land. Then
   `git status --porcelain` must be empty. If it is not, a previous run died mid-work: stop and
   report, do not clean up.
2. **Lock check.** If any ticket is `in-progress` anywhere in this file, exit without doing
   anything. Another run owns it. (If its claim line is older than six hours, mention it in the report so Ricardo can
   inspect; still do not take it over.)
3. **Pick.** The first board row that is `todo` and whose `Depends on` tickets are all `done`.
   Any size. If nothing is eligible, exit.
4. **Claim, commit, push.** Set the ticket to `in-progress`, update the board row, append a log
   line `YYYY-MM-DD HH:MM claimed`, then commit only that change and push it:
   `git commit -am "GC-0NN: claim" && git push origin main`. This is the first commit of
   every working run; the lock is on `main` before any code changes exist. If that push is
   rejected as non-fast-forward, another run claimed first: `git reset --hard origin/main`
   discards the unpublished claim, then stop and report.
5. **Implement** within the ticket's scope. Do not widen it. If something adjacent needs doing,
   add a new `todo` ticket at the end of the file instead.
6. **Verify.** `npm run typecheck && npm run build` always. `npm test` once GC-002 exists.
   `npm run e2e:setup && npm run e2e` when the ticket touches `git.ts`, `ipc.ts`, actions in
   `App.tsx` or the DetailPanel. For UI changes, launch the built app, load the e2e repo, take a
   CDP screenshot to `docs/screenshots/` and look at it before calling it done. Tick the
   acceptance boxes only for items actually checked.
7. **Reflect.** Before closing, list what you noticed during the work that needs fixing or
   deserves work but was outside scope: bugs, missing tests, UX gaps against the GitKraken
   study, convention drift from `CLAUDE.md`. Add each as a new `todo` ticket with the full
   template, a board row at the position its priority deserves (bugs are P0 or P1) and a log
   line `proposed by GC-0NN (this ticket): <reason>`. Deduplicate against existing tickets
   first. Zero new tickets is fine; never more than three per run.
8. **Close out, commit, push.** Set the ticket to `done` (or `blocked` with a one-line reason),
   update the board row, append a log line saying what was done and how it was verified. Update
   `CLAUDE.md` if a convention, command or the roadmap changed. Then
   `git add -A && git commit -m "GC-0NN: <ticket title>" && git push origin main`.
   Intermediate commits during the work are fine; the final one must leave no `in-progress`
   line anywhere in this file.
9. **Report** the ticket id, its final status, the commit shas and any tickets added in step 7.

Commit message format: `GC-0NN: <imperative summary>`. The routine never checks out another
branch, never rewrites published history and never force-pushes. Run every git command with
`GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`: pushing relies on a GitHub token already
stored in Git Credential Manager, and an unattended run cannot answer a sign-in window. If a
push is rejected for authentication, leave the commits local, say so in the report, do not retry.

Ricardo uses this machine while runs happen, often in a full-screen game. **Never steal focus.**
Never run anything in `tools/gk-recon/*.ps1` (`focus`, `rclick`, `shot`, `cursor`, `esc`) or
any other OS-level input or screenshot; drive and capture the app over CDP only. Launch the app
only through `node tools/launch-app.mjs` (stealth by default) once GC-028 has landed; until
then, run e2e when a ticket requires it but skip optional screenshots rather than pop a window.

Ready-to-paste routine prompt:

> Open `C:/Users/Ricar/Documents/apps/GitClient`. Read `CLAUDE.md`, then follow the
> "Routine protocol" in `TICKETS.md` exactly. If a ticket is already `in-progress`, exit and
> say so. Otherwise take one ticket through to `done` or `blocked`, committed and pushed on
> `main`, and report the ticket id, final status and commit shas.

## Review routine (hourly backlog reviewer)

A second scheduled session, `gitclient-backlog-review`, fires once an hour and plays product
owner. It never implements anything. It runs **whether or not a ticket is in progress** and
must never disturb the worker, so it obeys strict isolation:

- It never modifies, builds, tests or launches anything in this checkout. All analysis happens
  in a detached git worktree of `origin/main` under `%TEMP%/gitclient-review/wt` (with
  `node_modules` junctioned from here), which it removes when done.
- It uses its own scratch repository (`GITCLIENT_E2E_ROOT=%TEMP%/gitclient-review/e2e`) and its
  own DevTools port (9334), and stops only the Electron process it started (by PID, never
  `taskkill /IM electron.exe`, which would kill a worker's e2e run).
- It never sets `in-progress`. Its review ticket `GR-0NN` is written once, as `done`, in the
  Reviews section at the end of this file. Review tickets have no board row and are never
  picked by the ticket routine.
- Its only write to this checkout is `TICKETS.md`, made when that file is clean in
  `git status` (so the worker is not mid-edit), committed alone with `git add TICKETS.md`, and
  pushed. Because both routines share this clone, the worker's next push simply carries it.
  It never touches `CLAUDE.md` or any other file; a stale "Done" paragraph becomes a note in
  the review log instead.

What a review does, time-boxed to about twenty minutes:

- Reads every `GC` commit on `origin/main` since the previous review (`git log`, `git show`)
  as a reviewer: bugs, weak tests, scope creep, drift from `CLAUDE.md`, acceptance boxes ticked
  without evidence in the ticket log.
- Runs `npm run typecheck`, `npm test` and `npm run build` in the worktree; any failure
  becomes a P0 bug ticket.
- Once GC-028 has landed, launches the worktree's build on its own scratch repo through
  `node tools/launch-app.mjs --port 9334`, screenshots the graph, a commit, the staging view and
  a diff into `%TEMP%/gitclient-review/GR-0NN/` (never into the repository), looks at them and
  compares against `docs/reference/gitkraken/`. Until then this step is skipped and the log says so.
- Checks backlog hygiene: `blocked` tickets that can now be unblocked, `todo` tickets that are
  no longer concrete, wrong dependencies, board order.

It then adds zero to five `GC` tickets with the full template and a log line
`proposed by GR-0NN: <reason>`, may extend the scope of an existing `todo` ticket instead of
duplicating it, may reorder `todo` board rows (reason in the review log), and never changes
any ticket that is `in-progress`, `done` or `blocked` (except to unblock one with a log
line). Its commit is `GR-0NN: backlog review`.

## Board

| ID | Title | Area | Size | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| GC-001 | Initialise the git repository | infra | S | P0 | done |
| GC-002 | Unit tests for parseDiff and lanes | tests | S | P0 | done |
| GC-003 | Replace native confirm() with the UI confirm modal | ui | S | P1 | done |
| GC-004 | Confirm checkout when the working tree is dirty | actions | S | P1 | done |
| GC-005 | Pin to Left: any branch can take column 0 | graph | M | P1 | done |
| GC-006 | Resizable ref column | graph | M | P1 | done |
| GC-007 | Preferences page with Gravatar toggle | ui | M | P2 | done |
| GC-008 | Remote add, edit and remove | actions | M | P2 | done |
| GC-009 | Commit search | graph | M | P2 | done |
| GC-010 | Keyboard shortcuts overlay | ui | S | P2 | done |
| GC-028 | Stealth mode: unattended runs never steal focus or show a window | infra | S | P0 | done |
| GC-029 | The stash message says "optional" but the modal refuses an empty one | ui | S | P1 | done |
| GC-034 | Escape inside a dialog also closes the diff behind it | ui | S | P1 | done |
| GC-037 | Escape with a context menu open also closes the find bar behind it | ui | S | P1 | done |
| GC-038 | Escape with the Pull popover open also closes the find bar behind it | ui | S | P1 | done |
| GC-035 | Stop only the Electron the run started, never every electron.exe | infra | S | P2 | done |
| GC-024 | Unit tests for prefs.ts | tests | S | P2 | done |
| GC-042 | shortcuts.test.ts is stored as binary because of a raw NUL byte | tests | S | P2 | done |
| GC-039 | An e2e step that guards one Escape, one layer | tests | S | P2 | done |
| GC-030 | Commit search loses its query and results when a diff opens | graph | S | P2 | in-progress |
| GC-031 | Push to a chosen remote when the repository has several | actions | S | P2 | todo |
| GC-025 | A readable error when git is not on PATH | main | S | P2 | todo |
| GC-019 | Only prompt on checkout when the changes are actually at risk | actions | S | P2 | todo |
| GC-020 | Keep the pinned branch's chip visible when chips fold | graph | S | P2 | todo |
| GC-022 | The +N refs dropdown is clipped by the graph scroll container | graph | S | P2 | todo |
| GC-032 | Optional Author, Date and SHA columns in the graph | graph | M | P2 | todo |
| GC-011 | File-system watcher for automatic refresh | main | M | P2 | todo |
| GC-043 | Context menu on file rows in the detail panel | ui | M | P2 | todo |
| GC-044 | Recently opened repositories from the repository breadcrumb | ui | M | P2 | todo |
| GC-012 | Lazy loading past 2000 commits | graph | M | P3 | todo |
| GC-013 | Light theme | ui | M | P3 | todo |
| GC-014 | Side-by-side diff | diff | L | P3 | todo |
| GC-015 | Drag-and-drop merge and rebase between chips | graph | L | P3 | todo |
| GC-016 | Multi-tab repositories | ui | L | P3 | todo |
| GC-021 | The pin follows a renamed branch and is dropped with a deleted one | graph | S | P3 | todo |
| GC-023 | Chip shrinking still assumes exactly two chips | graph | S | P3 | todo |
| GC-036 | The e2e prologue leaves the named stash a run that dies mid-scenario creates | tests | S | P3 | todo |
| GC-046 | A DOM environment so components can be unit tested | tests | M | P3 | todo |
| GC-047 | A test that fails on a raw control byte in a source file | tests | S | P3 | todo |
| GC-040 | A crashed e2e run leaves its own Electron alive | tests | S | P3 | todo |
| GC-041 | The launcher documents --keep-alive but checks --keep-running | infra | S | P3 | todo |
| GC-027 | Author filter in commit search | graph | S | P3 | todo |
| GC-033 | Global shortcuts from the study: branch, fetch, panels, staging | ui | S | P3 | todo |
| GC-045 | Commit view banner linking back to the working directory changes | ui | S | P3 | todo |
| GC-026 | One dialog with several fields instead of chained prompts | ui | S | P3 | todo |
| GC-017 | Interactive rebase editor | actions | L | P3 | blocked |
| GC-018 | Undo and Redo | actions | L | P3 | blocked |

Priority: P0 do first, P3 nice to have. Size: S under two hours, M half a day, L a day or more.

---

## Tickets

### GC-001 Initialise the git repository

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P0
- **Depends on:** none
- **Why:** The project folder had never had `git init` run. Nothing in this file works until
  it is a repository with a remote the routine can push to.
- **Scope:**
  - Repository on branch `main`. `.gitattributes` pins the working copy to LF
    (`* text=auto eol=lf`, `*.png binary`) because the system Git has `core.autocrlf=true`.
  - `.gitignore` covers `node_modules/`, `out/`, `dist/`, logs, OS files, `shots/`, `*.local`
    and `.claude/settings.local.json`.
  - Remote `origin` is `https://github.com/hellhoundsx/GitClient.git`; `main` tracks
    `origin/main`.
  - Commit identity is the global Git config (Ricardo Gomes, `ricardogomes.1995@outlook.pt`).
  - `TICKETS.md` (this file) added and referenced from `CLAUDE.md`.
- **Out of scope:** CI, branch protection.
- **Acceptance:**
  - [x] `git log --oneline` shows the import commit on `main`.
  - [x] `git status --porcelain` is empty after the commit.
  - [x] `node_modules/` and `out/` are not tracked (92 files tracked, 0 under either).
  - [x] `git rev-parse --abbrev-ref main@{upstream}` prints `origin/main`.
- **Files:** `.gitignore`, `.gitattributes`, `TICKETS.md`, `CLAUDE.md`
- **Verify:** `git status --porcelain`, `git ls-files | grep -c node_modules` prints 0,
  `git ls-remote origin main` matches the local sha.
- **Log:**
  - 2026-09-05 Ricardo initialised the repository, added the `origin` remote and pushed the
    initial commit (`197b5d9`). The Claude session added `TICKETS.md`, the extra `.gitignore`
    entries and the `CLAUDE.md` pointer, set the upstream and committed. Pushing from an
    unattended session needs a GitHub token in Git Credential Manager; the first push was made
    interactively to store it.

### GC-002 Unit tests for parseDiff and lanes

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P0
- **Depends on:** GC-001
- **Why:** These two pure modules carry the most logic-per-line in the app and have no tests.
  The lane algorithm has already regressed once (early forking split master on catena-feed).
- **Scope:**
  - Add `vitest` as a devDependency. It must be a version compatible with Vite 7; do not bump
    Vite or `@vitejs/plugin-react` (see the version constraints in `CLAUDE.md`).
  - `npm test` runs vitest once; `npm run test:watch` runs it in watch mode.
  - `src/renderer/src/diff/parseDiff.test.ts`: header parsing, hunk line numbers, `\ No newline`
    meta lines, binary markers, renames, and `buildHunkPatch` output round-tripping through the
    parser.
  - `src/renderer/src/graph/lanes.test.ts`: linear history, a merge, two branches sharing a
    parent (no early forking: both lines must continue to the parent's row), HEAD lineage in
    column 0, a pinned sha taking column 0, lane recycling keeps colours stable.
- **Out of scope:** component tests, e2e changes.
- **Acceptance:**
  - [x] `npm test` exits 0 with at least 12 assertions across both files.
  - [x] `npm run typecheck` still passes (test files are included or excluded deliberately).
- **Files:** `package.json`, `tsconfig.web.json`, new `*.test.ts` next to the modules,
  `CLAUDE.md` (Commands and Testing sections).
- **Verify:** `npm test`, `npm run typecheck`.
- **Log:**
  - 2026-09-05 15:42 claimed
  - 2026-09-05 15:52 done. Added `vitest@5.0.0` as a devDependency: its Vite peer range is
    `^6.4 || ^7 || ^8`, so `npm ls vite` still reports a single deduped `vite@7.3.6` and
    `@vitejs/plugin-react` stayed on 5.2.0. `npm test` = `vitest run`, `npm run test:watch` =
    `vitest`, config in a new `vitest.config.ts` (renderer aliases, `src/**/*.test.ts`, `node`
    environment — both modules under test are pure, so no jsdom and no React plugin).
    `parseDiff.test.ts` covers headers, hunk line numbering, omitted `@@` counts, `\ No newline`
    meta lines, new/deleted/binary files, renames with and without hunks, multi-file diffs, and
    `buildHunkPatch` round-tripping through the parser (including the header it synthesises for
    an untracked file that arrives with no `diff --git` line). `lanes.test.ts` covers empty and
    linear history, a merge's fork and join, the no-early-forking regression guard, HEAD's
    lineage in column 0, a pinned sha that is not HEAD (ahead of GC-005), an unknown pinned sha
    being ignored, colour stability across a recycled lane index, and `maxLane`.
    Verified: `npm test` 22 tests / 2 files passed, `npm run typecheck` clean (test files are
    already inside `tsconfig.web.json`'s `src/renderer/src/**/*`, so a `tsconfig.web.json` edit
    was not needed; `vitest.config.ts` was added to `tsconfig.node.json` instead),
    `npm run build` clean with no vitest reference in the renderer bundle. The lane guard was
    mutation-checked: reintroducing early forking in `lanes.ts` failed three tests, and the file
    was restored (`git diff` on it is empty). No e2e run — the ticket touches no main-process,
    IPC or action code.
  - Notes for later: the tests documented two quirks worth a ticket if they ever matter — a
    pinned commit's own row reports `hasChildAbove: true` because column 0 is seeded before the
    loop, and `parseUnifiedDiff` treats a line that lost its leading space as context. Both are
    current, intended-enough behaviour and are asserted nowhere.

### GC-003 Replace native confirm() with the UI confirm modal

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-001
- **Why:** Four destructive actions still use the browser `confirm()` dialog, which looks
  foreign next to the styled modals from `UiContext` and blocks the renderer.
- **Scope:**
  - `DiffView.tsx` lines around 87 and 120, `DetailPanel.tsx` lines around 115 and 180: use
    `useUi().confirm` with a danger-styled primary button.
  - Wording stays the same. The modal title names the file where one applies.
- **Out of scope:** new confirmations (that is GC-004).
- **Acceptance:**
  - [x] `grep -rn "confirm(" src/renderer` finds only `useUi` calls.
  - [x] e2e still passes; the WIP discard flow in `run.mjs` may need to click the modal button
    instead of accepting a native dialog.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/components/DetailPanel.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e:setup && npm run e2e`.
- **Log:**
  - 2026-09-05 15:55 claimed
  - 2026-09-05 16:07 done. All four native `confirm()` calls now go through `useUi().confirm`
    with a danger primary button: `DiffView` discard-hunk ("Discard this hunk from `<name>`?")
    and discard/delete file ("Discard changes to `<name>`?" / "Delete `<name>`?"), `DetailPanel`
    discard-all and the per-file `✕`. The native one-liner became the modal message, so the
    wording is unchanged and the title names the file. Discard-all reuses the exact title,
    message and "Discard everything" label of the identical action already in the WIP menu
    (`App.tsx`), so the same action no longer asks two different questions. `.modal h3` got
    `overflow-wrap: anywhere` because titles can now carry a path. The promise handlers are
    `.then((ok) => void (ok && run(...)))`: an `ok && run(...)` arrow returns `false | Promise`,
    which TS rejects for a `void`-returning `then`.
    Verified: `npm run typecheck` clean, `npm run build` clean, `npm test` 22/22,
    `grep -rn "confirm(" src/renderer` shows only `useUi` calls. e2e: added step 14, which
    creates an untracked file, clicks the per-file `✕` in the detail panel, asserts the modal
    title is `Delete <file>?` and that OK deletes it — 24/24 assertions passed. The other three
    sites were driven over CDP against the scratch repo: each modal was read back with the
    right title, message and button, Cancel left `git status --short` unchanged. Screenshots:
    `docs/screenshots/confirm-modal.png` (per-file delete) and `confirm-modal-hunk.png`
    (discard hunk over the diff), both looked at.

### GC-004 Confirm checkout when the working tree is dirty

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P1
- **Depends on:** GC-003
- **Why:** Double-clicking a chip or branch row checks out immediately. With local changes git
  either carries them over or refuses; the user gets no warning either way. Discussed with
  Ricardo, agreed optional, now wanted.
- **Scope:**
  - Before any checkout triggered from the UI, if `status.entries` is non-empty show a confirm
    modal: "You have uncommitted changes. Check out `<name>` anyway?" with a secondary
    "Stash and check out" action that runs stash push, checkout, stash pop.
  - Behaviour is identical for chips, left-panel rows and the context menu.
- **Out of scope:** a preference to disable the prompt (that belongs to GC-007).
- **Acceptance:**
  - [x] Clean tree: no prompt, checkout as before.
  - [x] Dirty tree: prompt appears; Cancel leaves HEAD and the tree untouched.
  - [x] "Stash and check out" ends on the new branch with the changes re-applied.
  - [x] An e2e step covers the dirty case.
- **Files:** `src/renderer/src/App.tsx` (the checkout action), `src/renderer/src/ui/Modal.tsx`,
  `src/renderer/src/ui/UiContext.tsx`, `tools/e2e/run.mjs`.
- **Verify:** e2e, plus `git status --short` and `git rev-parse --abbrev-ref HEAD` in the
  scratch repo after each path.
- **Log:**
  - 2026-09-05 16:02 claimed
  - 2026-09-05 16:35 done. Every checkout the UI can trigger now goes through one
    `runCheckout(name, doCheckout)` in `App.tsx`: `checkoutRef` (chips, left-panel rows and the
    ref context menu, all three of which already funnelled through it) and the commit menu's
    "Checkout this commit (detached)". With `snapshot.status.entries` empty it is the old
    behaviour; otherwise it shows the modal, and "Stash and check out" runs
    `stashSave({ includeUntracked: true })` → checkout → `stashPop(0)` inside a single `run()`,
    popping the stash back onto the branch we never left if the checkout itself fails.
    The modal needed a third button, so `PromptOptions` gained an optional `secondary: { label }`
    rendered between Cancel and OK, and `PromptResult` gained `choice: 'ok' | 'secondary'`;
    `useUi().confirm` now returns true only for `'ok'`, so a secondary press can never read as a
    plain confirmation. `.modal-buttons .btn:last-child` is still OK, so the existing e2e
    `modalOk` helper is unaffected.
    Verified: `npm run typecheck` clean, `npm test` 22/22, `npm run build` clean.
    e2e 29/29 assertions passed, run three times end to end (re-entrant). Step 3 now asserts the
    prompt's title and its "Check out main anyway?" message before taking the "Check out anyway"
    path; new step 15 parks the tree in a stash to assert a clean checkout raises no modal, then
    asserts the three buttons, that Cancel leaves `branch --show-current` and `status --short`
    untouched, and that "Stash and check out" ends on `wip-branch` with the same working tree and
    the stash count back where it started. The step restores what it parked and the prologue
    drops a leftover `e2e checkout guard` stash, so the suite stays re-entrant.
    Screenshot `docs/screenshots/checkout-dirty-confirm.png` looked at: three buttons, primary
    outline on "Check out anyway", the secondary sharing the Cancel style.
    Noted for later: with only untracked files dirty the prompt is noise, since git carries them
    across a checkout — filed as GC-019 rather than deviating from this ticket's scope.

### GC-005 Pin to Left: any branch can take column 0

- **Status:** done
- **Area:** graph | **Size:** M | **Priority:** P1
- **Depends on:** GC-002
- **Why:** GitKraken offers "Pin to Left" on a branch so its lineage becomes the straight
  leftmost line. `layoutGraph(commits, pinnedSha)` already accepts the pinned sha; only the UI
  and persistence are missing.
- **Scope:**
  - Context menu entry "Pin to Left" on branch chips and left-panel branch rows; "Unpin" when
    the branch is pinned. Menu built in `refMenuItems`.
  - Pinned branch name (not sha) stored per repository in `localStorage` under
    `gitclient.pinned.<repoPath>`; resolved to a sha on each snapshot so it follows new commits.
  - When unpinned, HEAD's lineage takes column 0 as today.
  - A small pin icon on the pinned chip (lucide `Pin`).
- **Out of scope:** pinning tags or remotes.
- **Acceptance:**
  - [x] Pinning a side branch moves its line to column 0 and HEAD's line to another lane with no
    line breaks or early forks.
  - [x] Restarting the app keeps the pin for that repo.
  - [x] A lanes unit test covers a pinned sha that is not HEAD.
  - [x] Screenshot in `docs/screenshots/pin-to-left.png` checked by eye for lane continuity.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/graph/lanes.ts`,
  `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/components/LeftPanel.tsx`.
- **Verify:** `npm test`, build, screenshot against the e2e repo.
- **Log:**
  - 2026-09-05 16:12 claimed
  - 2026-09-05 16:40 done. `lanes.ts` needed no change: `layoutGraph(commits, pinnedSha)` already
    seeds column 0 with any sha, so the whole ticket is UI and persistence. `App.tsx` holds the
    pinned **branch name** in state, reads it from `gitclient.pinned.<repoPath>` in an effect keyed
    on the loaded repository and resolves it against `snapshot.refs` on every snapshot, so the lane
    follows the branch as it gains commits and a pin on a branch that no longer exists simply stops
    resolving (column 0 goes back to HEAD). `CommitGraph` takes `pinnedSha` (used as
    `layoutGraph(commits, pinnedSha ?? headSha)`) and `pinnedName` (the lucide `Pin` marker on the
    chip); `LeftPanel` takes `pinnedName` for the same marker on the branch row. The ref menu gets
    "Pin to Left" / "Unpin from Left" in its own group, for local branches only, and because both
    the chips and the left-panel rows already build their menu from `refMenuItems` the entry
    appears in both places for free.
    Verified: `npm run typecheck` clean, `npm run build` clean, `npm test` 23/23 — one new lanes
    test ("keeps both lines continuous when a side branch is pinned") asserts the pinned lineage in
    lane 0, HEAD's in lane 1, no `outgoing` segment anywhere (the no-early-forking guard under a
    pin) and the join on the shared parent. `npm run e2e:setup && npm run e2e` re-run because the
    ref menu changed: 29/29 assertions still pass (the e2e helpers click menu items by label, so
    the added entry and separators are invisible to them). The UI was then driven over CDP against
    the e2e repo: pinning `wip-branch` from its chip menu moved it to lane 0 (node cx 18) and
    `main` to lane 1 (cx 38), put the marker on both the chip and the left-panel row, wrote
    `gitclient.pinned.<path>=wip-branch`, survived a reload, and unpinning from the left-panel row
    menu gave column 0 back to `main` and removed the key — 9 checks, all passed. A row-by-row dump
    of the rendered SVG confirmed every pass-through lane draws a full-height line and no row forks
    early. Screenshots looked at: `docs/screenshots/pin-to-left.png` (whole window, pinned) and
    `pin-to-left-graph.png` (2x close-up of the ref and graph columns).
    Noted for later: a pinned chip can be folded into the `+N` list because chip order still ranks
    by kind (GC-020), and renaming the pinned branch silently drops the pin (GC-021).

### GC-006 Resizable ref column

- **Status:** done
- **Area:** graph | **Size:** M | **Priority:** P1
- **Depends on:** GC-001
- **Why:** `--ref-col-w` is fixed at 150px and long single branch names clip. GitKraken lets
  the user drag the boundary between refs and graph.
- **Scope:**
  - A 4px drag handle between the ref column and the graph; drag updates a CSS variable on the
    graph root. Range 100px to 400px. Double-click resets to 150px.
  - Width persisted in `localStorage` (`gitclient.refColW`).
  - Chip folding (`MAX_CHIPS`, `+N`) adapts to the width so more chips show when there is room.
- **Out of scope:** resizing the left or detail panels.
- **Acceptance:**
  - [x] Dragging changes the width live without layout jumps in the graph SVG.
  - [x] Width survives a reload.
  - [x] Screenshot at 150px and 300px in `docs/screenshots/`.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`.
- **Verify:** build, screenshots.
- **Log:**
  - 2026-09-05 16:22 claimed
  - 2026-09-05 done. `CommitGraph` owns the width: state seeded from `gitclient.refColW`,
    written to `--ref-col-w` on `.graph-panel` (so the token stays the default) and persisted
    on pointer-up. The handle is a 4px `.col-resize` absolutely positioned on the column
    boundary inside the header, matching the study's "10px handle at the header's right edge"
    without adding width of its own, so nothing reflows while dragging. Pointer capture drives
    the drag, clamped to 100-400px; double-click resets to 150. Chip folding now uses
    `chipBudget(width)` (one chip per 75px, 1 to 6) in place of the fixed `MAX_CHIPS = 2`,
    so 150px still shows two.
    Verified: `npm run typecheck`, `npm test` (23 passed), `npm run build`, and
    `npm run e2e` (all 29 assertions passed) all clean. Drove the built app over CDP with a
    real mouse drag: 150 -> 300 -> clamped 100 -> clamped 400 -> double-click 150, reading back
    the inline variable, the `localStorage` value and both column boxes each time. Header and
    row `.col-ref` stayed the same width and the graph SVG stayed 76px wide throughout, so
    there is no layout jump; a reload came back at 300px. Chip fold measured live: 1 chip + `+N`
    at 100px, 4 + `+N` at 300px. Screenshots `docs/screenshots/graph-ref-col-150.png` and
    `graph-ref-col-300.png` looked at: full branch names read at 300px where 150px clipped them.

### GC-007 Preferences page with Gravatar toggle

- **Status:** done
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-003
- **Why:** Gravatar is the only network call from the renderer and must be switchable off.
  Other settings (pull mode, checkout confirmation, pin, column width) are already scattered
  across `localStorage` keys and need one home.
- **Scope:**
  - A `Preferences` modal opened from the toolbar gear (new lucide `Settings` button).
  - A single `prefs.ts` module with typed defaults, `usePrefs()` hook, and one `localStorage`
    key `gitclient.prefs` (migrate the existing `gitclient.pullMode` on first load).
  - Settings: avatars on/off (default on), default pull mode, confirm checkout on dirty tree,
    commit message column at 72 characters on/off.
  - When avatars are off, `Avatar` renders initials only and makes no request.
- **Out of scope:** theme selection (GC-013 adds it here).
- **Acceptance:**
  - [x] With avatars off, the network panel shows no gravatar.com requests after a reload.
  - [x] Pull mode chosen in the toolbar caret and in Preferences stay in sync.
  - [x] `CLAUDE.md` documents `gitclient.prefs` and removes the old key.
- **Files:** new `src/renderer/src/prefs.ts`, `Toolbar.tsx`, `ui/Avatar.tsx`, `App.tsx`,
  `app.css`.
- **Verify:** build, DevTools network check via CDP, screenshot.
- **Log:**
  - 2026-09-05 16:32 claimed
  - 2026-09-05 17:05 done. `prefs.ts` holds a typed `Prefs` record behind one
    `gitclient.prefs` key, read with a `useSyncExternalStore` `usePrefs()` hook and written
    with `setPrefs(patch)`; `load()` validates every field so a bad blob falls back to the
    defaults, and migrates `gitclient.pullMode` once before deleting it. Avatars are gated
    inside `useGravatar`, the single place both `ui/Avatar.tsx` and the graph node go
    through. Verified: typecheck, build, 23 unit tests, the full e2e suite (all assertions
    passed, including the checkout guard), and the built app driven over CDP on the e2e
    repo — the legacy `gitclient.pullMode` value `rebase` migrated into the blob and the old
    key was removed; 2 gravatar.com requests with avatars on became 0 after switching them
    off and reloading, with 13 rows still drawn as initials; the toolbar caret and the
    Preferences select tracked each other in both directions; the 72-character counter
    disappeared with its toggle; and with the confirmation off a dirty-tree checkout of
    `wip-branch` ran with no prompt (`git rev-parse` confirms HEAD moved). Screenshots
    `docs/screenshots/gc-007-preferences.png` and `gc-007-avatars-off.png` looked at.

### GC-008 Remote add, edit and remove

- **Status:** done
- **Area:** actions | **Size:** M | **Priority:** P2
- **Depends on:** GC-003
- **Why:** Remotes are listed but cannot be managed. Needed before a push-capable workflow is
  complete.
- **Scope:**
  - `git.ts`: `remoteAdd(name, url)`, `remoteRemove(name)`, `remoteSetUrl(name, url)`,
    `remoteRename(old, new)`. IPC handlers with `str` validation, preload entries, `GitApi` types.
  - Left panel: "Add remote" in the Remotes section header; context menu on a remote with
    Edit URL, Rename, Remove (danger, confirm modal), Fetch this remote.
  - After add, run `fetch <name>` and reload the snapshot.
- **Out of scope:** credential prompts (system helper only, as today).
- **Acceptance:**
  - [x] e2e: add a second remote pointing at the bare origin, fetch, rename, remove; asserted
    with `git remote -v`.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `LeftPanel.tsx`, `App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** e2e.
- **Log:**
  - 2026-09-05 16:44 claimed
  - 2026-09-05 17:00 done. `remoteAdd` (add then `fetch --prune <name>`), `remoteRemove`,
    `remoteSetUrl` and `remoteRename` in `git.ts`, four `remote:*` handlers with `str`
    validation, preload entries and `GitApi` types. The left panel's Remote section header now
    carries an "Add remote" button (`Section` grew an optional `action`; the header is a row
    with a `.section-toggle` button inside it, so `.section-head` is no longer a button) and
    the remote's context menu gained Edit URL…, Rename… and a danger Remove behind the confirm
    modal. Add asks for the name and then the URL in two prompts; a single dialog with two
    fields is GC-026.
  - 2026-09-05 17:00 verified: `npm run typecheck`, `npm run build`, `npm test` (23 passing),
    `npm run e2e` green — 16 steps, 38 assertions, including the new step 16 (add + fetch,
    rename, edit URL, remove, origin untouched). Screenshot of the remote menu and the new
    header button in `docs/screenshots/remote-menu.png`, looked at.
  - 2026-09-05 17:00 harness fix made on the way: the suite inherited `gitclient.prefs` from
    the app's localStorage, so a preference toggled by hand in an earlier session (here
    `confirmDirtyCheckout: false`, left over from GC-007) silently disabled steps 3 and 15.
    Step 1 now removes the key before loading the repository, so every run starts on the
    defaults. The app itself was not changed for this.

### GC-009 Commit search

- **Status:** done
- **Area:** graph | **Size:** M | **Priority:** P2
- **Depends on:** GC-001
- **Why:** The Search toolbar button is a disabled placeholder. Finding a commit by message,
  sha or author is a core workflow.
- **Scope:**
  - Enable the Search button and `Ctrl+F`: a search bar above the graph with a text field,
    result count, up/down and Escape to close.
  - Filter client-side across the loaded commits on message, author name, author email and
    sha prefix. Matches are highlighted rows; Enter jumps to the next match and selects it.
  - Rows are not hidden (GitKraken keeps the graph and dims non-matches).
- **Out of scope:** searching file paths or diffs (`git log -S`), searching past the loaded 2000.
- **Acceptance:**
  - [x] Typing a sha prefix selects that commit and scrolls it into view.
  - [x] e2e step: search for a known message in the scratch repo, assert the selected sha.
- **Files:** `Toolbar.tsx`, `CommitGraph.tsx`, `App.tsx`, `app.css`, `tools/e2e/run.mjs`.
- **Verify:** e2e, screenshot.
- **Log:**
  - 2026-09-05 16:56 claimed
  - 2026-09-05 17:10 done. The Search toolbar button and Ctrl+F (from anywhere, including the
    commit form) reveal a find bar above the graph header: search icon, a 320px field, the
    position readout, previous / next / close. Matching rows are tinted and every other row drops
    to 0.3 opacity — no row is hidden, so the graph stays continuous. Matching is client-side over
    the loaded commits on summary, body, author name, author email and sha prefix. A new query
    jumps to its first match and the existing keep-selection-visible effect scrolls it into view;
    Enter / Shift+Enter, the arrow keys and the two buttons step through the results, wrapping at
    the ends. The position is derived from the selection rather than held in its own state, so
    clicking a row mid-search moves the readout with it and "next" continues from there instead of
    from a stale cursor. Escape (in the field or globally) closes the bar and clears the query.
    Verified: `npm run typecheck`, `npm test` (23), `npm run build`, and `npm run e2e` — 48
    assertions, all passed, including the new step 16 (toolbar opens the bar; "Main-only" selects
    the expected sha; a 6-character sha prefix selects the same commit at "1 of 1"; "feature"
    counts 3 and Next moves the selection; clicking the last match reads "3 of 3" and Next wraps
    to "1 of 3"; Escape closes and undims). Screenshot `docs/screenshots/commit-search.png`
    looked at: compact find bar, three amber matches, the rest dimmed, graph lines unbroken.

### GC-010 Keyboard shortcuts overlay

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-003
- **Why:** Shortcuts exist (arrows, Escape, Ctrl+Enter) but are undocumented in the app.
- **Scope:**
  - `?` (Shift+/) outside inputs and a Help entry open a modal listing every shortcut, grouped
    by area, generated from a single `shortcuts.ts` table so it cannot drift from the handlers.
  - Move existing key handling in `App.tsx` to read from that table.
- **Out of scope:** user-configurable bindings.
- **Acceptance:**
  - [x] Every key handled in the app appears in the overlay.
  - [x] Overlay closes with Escape and does not open while typing in the commit form.
- **Files:** new `src/renderer/src/shortcuts.ts`, new `src/renderer/src/shortcuts.test.ts`,
  new `src/renderer/src/components/Shortcuts.tsx`, `App.tsx`, `components/Toolbar.tsx`,
  `components/DetailPanel.tsx`, `components/Preferences.tsx`, `graph/CommitGraph.tsx`,
  `ui/Modal.tsx`, `ui/ContextMenu.tsx`, `styles/app.css`.
- **Verify:** build, screenshot.
- **Log:**
  - 2026-09-05 17:05 claimed
  - 2026-09-05 17:45 done. `shortcuts.ts` holds one table of eleven shortcuts in five groups,
    each with its display chords and a `match(e)` predicate; `matches(id, e)` is now the only
    place a key name is compared. Every handler reads from it: `App.tsx` (Ctrl+F, `?`, Escape,
    the arrows), `CommitGraph`'s find bar (imported as `isShortcut`, because `matches` is the
    search-results array in that file), `DetailPanel`'s Ctrl+Enter, `Modal` and `Preferences`
    (Enter/Escape) and `ContextMenu`/`Toolbar` (Escape). The overlay is
    `components/Shortcuts.tsx`, rendered straight from the table, opened with `?` (or Shift+/)
    and from a new toolbar Shortcuts button, closed with Escape, the button or the backdrop;
    while it is open it swallows the other keys so the graph does not move behind it, and it
    does not open while a text field has focus or while Preferences is up.
    The ticket's Files line named `ui/Modal.tsx` for the dialog itself; the overlay went into
    its own component instead, the way `Preferences.tsx` did in GC-007, and `Modal.tsx` only
    switched its Enter/Escape over to the table.
    Verified: `npm run typecheck`, `npm test` (30 tests, 8 of them the new
    `shortcuts.test.ts` guarding unique ids, Ctrl/Cmd equivalence, `?` vs Shift+/, arrows
    rejecting modifiers, and Enter vs Shift+Enter in the find bar), `npm run build`, and
    `npm run e2e` (48 assertions, all passed) because the dialog and menu keys changed.
    Driven over CDP on the scratch repo: Escape closes it, `?` while the commit summary has
    focus does not open it, `?` outside inputs and the toolbar button both open it, ArrowDown
    behind it does not move the selection, and eleven rows in five groups render — the whole
    table. Screenshot `docs/screenshots/shortcuts-overlay.png`, looked at.
    Note: the no-focus rule in this file landed (77110d6) after this run had claimed and had
    already launched the app for that screenshot, so a window was shown. No `gk-recon` PowerShell
    script was run; everything else went over CDP.

### GC-011 File-system watcher for automatic refresh

- **Status:** todo
- **Area:** main | **Size:** M | **Priority:** P2
- **Depends on:** GC-001
- **Why:** The snapshot only reloads after an action inside the app. Edits from an editor or
  commits from a terminal are invisible until something is clicked.
- **Scope:**
  - Main process watches the working tree and `.git/` (`fs.watch` recursive on Windows, or
    `chokidar` if `fs.watch` proves unreliable; record the choice in `CLAUDE.md`).
  - Ignore `.git/index.lock`, `.git/objects/**`, `node_modules/**`, and anything in
    `.gitignore` for the tree (use `git check-ignore --stdin` in batches, or a simple allowlist
    of top-level dirs first).
  - Debounce 300ms, then push a `repo:changed` event over IPC; renderer reloads status only if
    just the tree changed, the full snapshot if `.git/refs` or `HEAD` changed.
  - Never fire while `busy` is set; coalesce and fire once after the action completes.
- **Out of scope:** watching multiple repos, watching submodules.
- **Acceptance:**
  - [ ] Editing a file in the e2e repo from a script updates the WIP row within a second.
  - [ ] `git commit` from a terminal in the e2e repo adds the row without clicking.
  - [ ] No refresh loop while the app itself stages or commits (check the status-bar spinner
    settles).
- **Files:** `src/main/index.ts` or new `src/main/watch.ts`, `ipc.ts`, `preload/index.ts`,
  `shared/types.ts`, `App.tsx`.
- **Verify:** e2e step driving external edits, CPU stays idle when nothing changes.
- **Log:**

### GC-012 Lazy loading past 2000 commits

- **Status:** todo
- **Area:** graph | **Size:** M | **Priority:** P3
- **Depends on:** GC-002
- **Why:** `MAX_COMMITS = 2000` truncates large repositories (catena-feed) with no indication.
- **Scope:**
  - `git.ts` log accepts `skip` and `maxCount`; renderer appends pages of 1000 when the user
    scrolls within 200 rows of the end.
  - `layoutGraph` must support incremental extension: lanes at the end of the loaded range are
    carried into the next page so lines do not restart. Cover this with a unit test.
  - A "Loading more" row at the bottom while a page is in flight.
- **Out of scope:** searching unloaded commits.
- **Acceptance:**
  - [ ] catena-feed (read-only) scrolls past 2000 with continuous lanes.
  - [ ] Unit test: layout of a full list equals layout of the same list in two pages.
- **Files:** `src/main/git.ts`, `ipc.ts`, `App.tsx`, `lanes.ts`, `CommitGraph.tsx`.
- **Verify:** `npm test`, screenshot at the page boundary.
- **Log:**

### GC-013 Light theme

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** GC-007
- **Why:** Everything is dark-only. Tokens already centralise colours, so a light palette is a
  second set of `tokens.css` values on a `data-theme` attribute.
- **Scope:**
  - Light values for every token, chosen by us (not lifted from GitKraken's light theme).
  - Theme setting in Preferences: dark, light, system.
  - `titleBarOverlay` colours updated from the renderer via IPC so the window controls match.
- **Out of scope:** custom themes.
- **Acceptance:**
  - [ ] No hard-coded colours remain in `app.css` (`grep -n "#[0-9a-f]\{3,6\}" app.css` prints
    nothing outside the tokens file).
  - [ ] Screenshot of both themes with the same repo loaded.
- **Files:** `tokens.css`, `app.css`, `prefs.ts`, `src/main/index.ts`, `ipc.ts`.
- **Verify:** build, screenshots.
- **Log:**

### GC-014 Side-by-side diff

- **Status:** todo
- **Area:** diff | **Size:** L | **Priority:** P3
- **Depends on:** GC-002
- **Why:** The unified view is the only one. GitKraken offers a split view and a toggle.
- **Scope:**
  - A pure `alignHunks(hunk)` that pairs removed and added lines into rows (unit tested).
  - Toggle in the DiffView header, remembered in prefs. Hunk staging buttons keep working in
    both views.
- **Out of scope:** intra-line (word) diff highlighting, syntax highlighting.
- **Acceptance:**
  - [ ] Two-hunk file in the e2e repo renders aligned rows; staging a hunk from the split view
    matches the unified result (`git diff --cached`).
- **Files:** `parseDiff.ts`, `DiffView.tsx`, `app.css`, tests.
- **Verify:** `npm test`, e2e, screenshot.
- **Log:**

### GC-015 Drag-and-drop merge and rebase between chips

- **Status:** todo
- **Area:** graph | **Size:** L | **Priority:** P3
- **Depends on:** GC-004
- **Why:** GitKraken's signature interaction: drag a branch chip onto another to get a menu of
  merge / rebase / create pull request options.
- **Scope:**
  - HTML5 drag on chips and left-panel branch rows; drop target highlights; on drop show a
    context menu with "Merge `<src>` into `<dst>`", "Rebase `<src>` onto `<dst>`" (the latter
    checks out `<src>` first, prompting via GC-004 if dirty).
  - Reuse the existing merge and rebase actions and the conflict banner.
- **Out of scope:** dragging commits (cherry-pick by drag), pull requests.
- **Acceptance:**
  - [ ] e2e: drop `feature` on `master`, choose merge, assert `git log --merges` gained a commit.
- **Files:** `CommitGraph.tsx`, `LeftPanel.tsx`, `App.tsx`, `app.css`, `tools/e2e/run.mjs`.
- **Verify:** e2e, screenshot of the drop menu.
- **Log:**

### GC-016 Multi-tab repositories

- **Status:** todo
- **Area:** ui | **Size:** L | **Priority:** P3
- **Depends on:** GC-011
- **Why:** The tabs bar draws a single tab. Switching repos means reopening.
- **Scope:**
  - Tab list persisted in prefs; each tab owns its own snapshot, selection and file view.
  - `+` opens the folder dialog; middle-click or the close glyph closes a tab; Ctrl+Tab cycles.
  - The watcher (GC-011) follows the active tab only.
- **Out of scope:** drag to reorder tabs, detaching tabs to windows.
- **Acceptance:**
  - [ ] Two repos open, switching preserves each one's selection and scroll position.
- **Files:** `TitleBar.tsx`, `App.tsx` (state becomes per-tab), `app.css`.
- **Verify:** build, screenshot with two tabs.
- **Log:**

### GC-017 Interactive rebase editor

- **Status:** blocked
- **Area:** actions | **Size:** L | **Priority:** P3
- **Depends on:** GC-015
- **Why:** Reorder, squash, reword and drop commits from the graph, as GitKraken does.
- **Scope (draft):** run `git rebase -i` with `GIT_SEQUENCE_EDITOR` pointing at a small script
  that writes the todo list the UI produced; the UI is a modal listing the commits between
  HEAD and the chosen base with pick/squash/reword/drop per row and drag to reorder.
- **Acceptance:** to be written.
- **Log:**
  - 2026-09-05 blocked: needs Ricardo's decision on whether to drive `rebase -i` through a
    sequence editor or to replay commits ourselves with cherry-pick, and a sketch of the modal.

### GC-018 Undo and Redo

- **Status:** blocked
- **Area:** actions | **Size:** L | **Priority:** P3
- **Depends on:** GC-002
- **Why:** The Undo and Redo toolbar buttons are disabled placeholders.
- **Scope (draft):** an in-app operation journal (branch tip before/after, stash ref, HEAD)
  recorded by `run()`; Undo restores refs with `update-ref`, Redo re-applies. Only ref-level
  operations are undoable (checkout, commit, merge, rebase, reset, branch delete); working-tree
  discards are not.
- **Acceptance:** to be written.
- **Log:**
  - 2026-09-05 blocked: needs Ricardo's decision on the undoable set and on whether an
    unpushed-only guard is required, as GitKraken refuses to undo pushed operations.

### GC-019 Only prompt on checkout when the changes are actually at risk

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** GC-004
- **Why:** GC-004 triggers its prompt on `status.entries` being non-empty, as that ticket
  specified. Untracked files are the common case in a working repository (build output that is
  not ignored, scratch notes) and git carries them across a checkout untouched, so the prompt
  fires where nothing is at risk and trains the user to click through it.
- **Scope:**
  - Skip the prompt when every entry is untracked (`unstaged === 'untracked'` and
    `staged === null`); check out directly as if the tree were clean.
  - Keep prompting for any staged or unstaged change to a tracked file, and for conflicted
    entries.
  - When the prompt does appear, say how many files are affected in the message so the count
    matches what the detail panel shows.
- **Out of scope:** asking git which specific files would collide with the target commit
  (`git checkout --dry-run` does not exist; `diff --name-only` against the target would be a
  bigger change and belongs to its own ticket if it is ever wanted).
- **Acceptance:**
  - [ ] An untracked-only tree checks out with no prompt and the file survives the checkout.
  - [ ] A tracked modification still prompts.
  - [ ] The e2e step 15 clean-tree assertion is extended with the untracked-only case.
- **Files:** `src/renderer/src/App.tsx` (`runCheckout`), `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`, plus `git status --short` before and after each path.
- **Log:**
  - 2026-09-05 proposed by GC-004 (this ticket): implementing the guard exactly as GC-004
    specified made an untracked-only tree prompt, which the e2e step 15 dirty case relies on and
    which is measurably noise in real use.

### GC-020 Keep the pinned branch's chip visible when chips fold

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-005
- **Why:** `CommitGraph` shows at most `MAX_CHIPS = 2` chips and folds the rest behind `+N`, in an
  order that ranks HEAD, then tracking locals, then other locals, then remotes, then tags. A pinned
  branch with no upstream therefore falls behind a tracking local and can end up inside the `+N`
  dropdown, where its pin marker — the explanation for why column 0 looks the way it does — is
  invisible until the user hovers.
- **Scope:**
  - In the `rank` function used to sort `refsBySha`, place the pinned branch immediately after
    HEAD (and keep it first when it *is* HEAD).
  - No change to `MAX_CHIPS` or to the folding behaviour itself; that is GC-006.
- **Out of scope:** pinning tags or remotes, the width-aware fold in GC-006.
- **Acceptance:**
  - [ ] On a commit carrying HEAD, a tracking local and the pinned branch, the pinned chip is one
    of the two shown and its pin marker is visible without hovering.
  - [ ] Unpinning restores the previous order.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`.
- **Verify:** build, screenshot of a commit with three or more refs, one of them pinned.
- **Log:**
  - 2026-09-05 proposed by GC-005 (this ticket): the pin marker is the only on-screen explanation
    for the leftmost lane, and the current chip order can hide it.

### GC-021 The pin follows a renamed branch and is dropped with a deleted one

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-005
- **Why:** The pin is stored by branch name. Renaming the pinned branch from inside the app leaves
  the stored name dangling, so the graph silently reverts to HEAD in column 0 and the user has to
  pin again; deleting it leaves a key in `localStorage` that never resolves and is never cleaned up.
- **Scope:**
  - After a successful rename in `refMenuItems`, if the renamed branch was pinned, re-pin it under
    the new name.
  - After a successful local branch delete, if that branch was pinned, clear the pin and its
    `localStorage` key.
  - Both go through the existing `pinBranch` helper; no new storage shape.
- **Out of scope:** detecting renames made outside the app (that needs GC-011's watcher, and the
  pin already degrades safely to HEAD there).
- **Acceptance:**
  - [ ] Renaming the pinned branch keeps its lineage in column 0 and the key holds the new name.
  - [ ] Deleting the pinned branch removes `gitclient.pinned.<repoPath>`.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** build, then drive both paths against the e2e repo and read the key back.
- **Log:**
  - 2026-09-05 proposed by GC-005 (this ticket): noticed while wiring the pin through the ref menu,
    which is the same menu that renames and deletes the branch.

---

### GC-027 Author filter in commit search

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-009
- **Why:** GC-009 shipped a single text field that matches message, author and sha at once. The
  GitKraken study (`docs/reference/gitkraken/04-panels.md`, "Commit search") records filter chips
  for author and team next to the field, and that is the one thing the plain field cannot express:
  "commits by this person" is drowned out whenever the name also appears in messages, and there is
  no way to combine an author with a message term.
- **Scope:**
  - An "Author" chip next to the search field opens a list of the authors present in the loaded
    commits (name + email, deduplicated on the lowercased email, most commits first).
  - Picking one narrows the matches to that author; the free-text term still applies on top of it,
    matching message and sha only. The chip shows the chosen name and clears with an x.
  - The position readout and the dimming keep working unchanged; clearing the chip restores the
    plain text search.
- **Out of scope:** teams (we have no team concept), committer as distinct from author, date
  ranges, more than one author at a time.
- **Acceptance:**
  - [ ] With an author chosen and the field empty, exactly that author's commits are matches.
  - [ ] With an author chosen and a message term typed, both must hold.
  - [ ] e2e step: pick the scratch repo's author, assert the match count equals
    `git log --all --author=... --oneline | wc -l` for the loaded commits.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`,
  `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, screenshot of the bar with a chip set.
- **Log:**
  - 2026-09-05 proposed by GC-009 (this ticket): the study's commit search has author filter
    chips; the text field shipped here cannot separate "authored by" from "mentioned in the
    message".

### GC-028 Stealth mode: unattended runs never steal focus or show a window

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P0
- **Depends on:** none
- **Why:** The routines build, launch and screenshot the app while Ricardo is using the machine,
  often in a full-screen game, and every launch switches him out of it. Two things grab the
  foreground today: the console window that `cmd /c start` opens for `electron.cmd`, and the
  app's own `win.show()` on `ready-to-show`, which activates the window. An unattended run must
  be invisible: no window, no taskbar entry, no focus change.
- **Scope:**
  - `src/main/index.ts`: when `process.env.GITCLIENT_STEALTH === '1'` create the window so it
    is never shown and never activated. Preferred: Electron offscreen rendering
    (`webPreferences.offscreen: true`, `show: false`, `skipTaskbar: true`, `focusable: false`,
    `win.webContents.setFrameRate(10)` to keep CPU low), so no OS window exists at all. If CDP
    `Page.captureScreenshot` comes back blank in that mode, fall back to: `show: false` and
    `win.showInactive()` on ready-to-show, `focusable: false`, `skipTaskbar: true`, position
    off the desktop (`x: -32000, y: -32000`), `webPreferences.backgroundThrottling: false`, and
    `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')` before
    `app.whenReady()` so Chromium keeps painting an occluded window. Record which approach
    shipped in `CLAUDE.md`. Launches without the variable are unchanged.
  - New `tools/launch-app.mjs`: spawns `node_modules/electron/dist/electron.exe` directly
    (resolve the path from `node_modules/electron/path.txt`), never through `electron.cmd` or
    `cmd /c start`, with `detached: true, stdio: 'ignore', windowsHide: true`, passes
    `--remote-debugging-port=<port>` (default 9333, `--port <n>`), sets `GITCLIENT_STEALTH=1`
    unless `--visible` is given, waits up to 40s for `http://localhost:<port>/json` to list a
    `page` target, and with `--repo <path>` sets `gitclient.lastRepo` over CDP and reloads so
    callers no longer need a `load.js`. Exits 0 when the page is up, 1 on timeout.
  - `tools/e2e/run.mjs`: launch through the same code path (import from `launch-app.mjs`), so
    the e2e suite is stealthy too. `killElectron` stays as it is.
  - `CLAUDE.md`: the Commands section makes `node tools/launch-app.mjs [--visible] [--repo <path>]`
    the one way to launch the app for driving and screenshots, drops the `cmd //c start`
    recipe, and says the `tools/gk-recon/*.ps1` helpers are for the GitKraken study only and
    must never run unattended.
- **Out of scope:** lowering CPU priority of builds and tests (a separate ticket if wanted);
  macOS and Linux beyond not breaking them.
- **Acceptance:**
  - [x] Record the foreground window with PowerShell (`Add-Type` a user32 P/Invoke for
    `GetForegroundWindow`), run `node tools/launch-app.mjs --repo <e2e repo>` and a CDP `shot`,
    then read it again: the handle is unchanged and every `electron` process reports an empty
    `MainWindowTitle`.
  - [x] The CDP screenshot is a real render: the PNG is larger than 30 KB (a blank 1400x900
    frame compresses to a few KB) and shows the graph when opened.
  - [x] `npm run e2e` passes with the same foreground check around the whole run, and no console
    window appears.
  - [ ] `node tools/launch-app.mjs --visible` still opens the normal, focused window.
  - [x] `npm run typecheck && npm run build` pass; `CLAUDE.md` updated as described.
- **Files:** `src/main/index.ts`, new `tools/launch-app.mjs`, `tools/e2e/run.mjs`, `CLAUDE.md`.
- **Verify:** typecheck, build, e2e, plus the PowerShell foreground check before and after a
  stealth launch (keep the check as `tools/e2e/foreground.ps1` so later runs can reuse it).
- **Log:**
  - 2026-09-05 17:11 proposed by Ricardo: the runs keep switching him out of a game. P0 because
    every other ticket's verification pops a window until this lands.
  - 2026-09-05 17:30 claimed
  - 2026-09-05 17:35 done. **Offscreen rendering shipped**, the preferred option: with
    `GITCLIENT_STEALTH=1` the window is created with `webPreferences.offscreen: true`,
    `skipTaskbar`, `focusable: false`, `paintWhenInitiallyHidden`, `backgroundThrottling: false`
    and `setFrameRate(10)`, and `ready-to-show` never calls `show()`. No fallback was needed:
    CDP `Page.captureScreenshot` returns a full render in that mode. New `tools/launch-app.mjs`
    spawns `node_modules/electron/dist/electron.exe` (path from `node_modules/electron/path.txt`)
    and exports `launchApp`/`setRepo`/`killElectron`/`electronBinary`; `tools/e2e/run.mjs` now
    imports it instead of spawning `cmd /c start electron.cmd`. `CLAUDE.md` rewrote the launch
    section and the same stale recipe in `README.md` was fixed with it (two lines, same change).
  - 2026-09-05 17:35 verified: `npm run typecheck`, `npm test` (30 pass), `npm run build`,
    `npm run e2e` ALL PASSED. `tools/e2e/foreground.ps1` (new, kept for later runs) read
    `foreground=1640694 title=[Need for SpeedT Unbound]` before the e2e run and the identical
    handle after it, with 0 visible windows owned by any electron process throughout; Ricardo's
    full-screen game was never interrupted. A stealth `launch-app.mjs --repo <e2e repo>` plus a
    CDP shot wrote `docs/screenshots/stealth-graph.png`, 77 KB, and it shows the full graph,
    left panel and staging view, so the render is real.
  - 2026-09-05 17:35 two corrections to the ticket as written. (1) The acceptance criterion
    "every electron process reports an empty `MainWindowTitle`" does not discriminate: the app
    is frameless, so .NET reports an empty `MainWindowTitle` even for a window that is on
    screen. `foreground.ps1` enumerates real top-level windows per pid instead, which does.
    (2) `windowsHide: true` as the ticket specified it also suppressed the window on
    `--visible`: on Windows it puts `SW_HIDE` in the child's `STARTUPINFO` and Chromium honours
    it for the first window shown. It is now `windowsHide: !visible`.
  - 2026-09-05 17:35 the `--visible` acceptance box is left unticked: showing the window
    activates it, and Ricardo was in a full-screen game for the whole run, so exercising it
    would have broken the very rule this ticket exists to enforce. The path is a two-line
    difference from the verified one (no `GITCLIENT_STEALTH`, no `windowsHide`) and the bug
    that would have broken it was found and fixed above. Worth one interactive check.

### GC-035 Stop only the Electron the run started, never every electron.exe

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P2
- **Depends on:** GC-028
- **Why:** `killElectron()` in `tools/launch-app.mjs` runs `taskkill /F /IM electron.exe`, which
  kills every Electron process on the machine. The hourly backlog reviewer deliberately runs its
  own build on port 9334 from a separate worktree and stops it by PID for exactly this reason,
  and says so in its isolation rules — but a worker's e2e run still kills it, and any dev-mode
  `npm run dev` window Ricardo has open with it. GC-028 gave every launch a child handle, so the
  routine now has the PID it needs.
- **Scope:**
  - `launchApp` returns a stopper (or `stopApp(child)`) that kills only that process tree
    (`taskkill /F /T /PID <pid>` on Windows, `process.kill` elsewhere).
  - `tools/e2e/run.mjs` uses it at the end instead of `killElectron()`. The prologue keeps a
    broad kill only if a stale instance would hold the DevTools port; prefer detecting a live
    target on the port and stopping that one.
  - `CLAUDE.md` replaces the `taskkill //F //IM electron.exe` line with the narrow stop.
- **Out of scope:** the reviewer routine's own isolation, which already does this.
- **Acceptance:**
  - [x] A second Electron started on another port survives a full `npm run e2e`.
  - [x] `npm run e2e` still passes and leaves no electron process of its own behind.
- **Files:** `tools/launch-app.mjs`, `tools/e2e/run.mjs`, `CLAUDE.md`.
- **Verify:** start a stealth app on port 9335, run `npm run e2e`, check the 9335 target still
  answers, then stop it.
- **Log:**
  - 2026-09-05 proposed by GC-028 (this ticket): moving the launch into one module made the
    machine-wide kill it inherited obvious, and the reviewer routine documents it as a hazard.
  - 2026-09-05 18:13 claimed
  - 2026-09-05 18:25 done. `tools/launch-app.mjs` lost `killElectron()` and gained three narrow
    stops: `killTree(pid)` (`taskkill /F /T /PID` on Windows, the process group elsewhere with a
    fallback to the pid), `stopApp(child)` over it, and `stopPort(port)`, which finds the pid
    listening on a port through `netstat -ano` (`lsof` elsewhere) and stops only that tree.
    `launchApp` now resolves with `stop()` as well as `{ child, target }`; the CLI frees the port
    with `stopPort` instead of a machine-wide kill. `tools/e2e/run.mjs` calls `stopPort(PORT)` in
    the prologue and the launch's own `stop()` in the epilogue. Verified: typecheck, build and the
    30 unit tests pass; `pidOnPort` was checked against a real listening socket and against an
    unused port. With a stealth app parked on port 9335 (pid 38708), a full `npm run e2e` passed
    all 49 assertions and left 9335 answering on the same pid, and port 9333 free. The hourly
    reviewer's own four Electron processes (running out of `gitclient-review/wt`) also survived
    the run, which is the case the ticket was written for. `stopPort(9335)` then stopped the guard
    and returned false on the second call. CLAUDE.md's stop paragraph now forbids the machine-wide
    kill and documents the narrow ones.

### GC-036 The e2e prologue leaves the named stash a run that dies mid-scenario creates

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** Step 5 creates a stash called `test stash` and step 8 pops it, asserting
  `git stash list` is then empty. A run that dies between those two steps (an assertion crash, a
  killed Electron, Ctrl+C) leaves that stash in the scratch repo, and the next run's step 8 fails
  on an entry it did not create. The prologue already handles the two stashes it knows about --
  `e2e checkout guard` from step 15 and, since GC-029, the unnamed `WIP on ...` one step 5 parks
  the tree in -- but not this one, because dropping it would throw away the mixed working tree
  every later step depends on.
- **Scope:**
  - The prologue pops (not drops) a leftover `test stash` the same way it pops a leftover
    `WIP on ...` stash, so the mixed working tree comes back and the list is empty again.
  - Give it the same bounded loop and the same comment style as the two guards next to it.
- **Out of scope:** a general "reset the scratch repo" prologue, and re-running
  `setup-testrepo.mjs` from `run.mjs`.
- **Acceptance:**
  - [ ] Interrupting a run after step 5 and re-running it passes, with step 8 still asserting an
        empty stash list.
  - [ ] A normal back-to-back `npm run e2e` still passes.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`, kill it after step 5 (or create the stash by hand with
  `git stash push -u -m "test stash"`), then `npm run e2e` again and read step 8.
- **Log:**
  - 2026-09-05 proposed by GC-029 (this ticket): adding the unnamed-stash guard to the prologue
    made the same gap for `test stash` obvious; it is the only remaining stash the suite can
    strand.

### GC-040 A crashed e2e run leaves its own Electron alive

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-035
- **Why:** `tools/e2e/run.mjs` calls `stopApp()` on the last line only. Any earlier exit — an
  assertion helper throwing, a CDP timeout, the `process.exit(1)` in the launch catch, Ctrl+C —
  skips it and leaves a stealth Electron running with no window and no taskbar entry, so nothing
  on screen says it is there. It survives until the next run's `stopPort(PORT)` clears the port,
  which may be hours later, and a run interrupted often enough stacks one per crash on other
  ports. GC-035 gave the run a narrow stopper; it is just not wired to the failure paths.
- **Scope:**
  - Register the stopper once, right after `launchApp` resolves, so every exit path runs it:
    a `process.on('exit', ...)` hook (plus `SIGINT`) calling `stopApp()` at most once.
  - Keep the explicit call at the end, or drop it if the hook makes it redundant; either way the
    normal run must still stop exactly one process tree.
- **Out of scope:** making the assertions themselves recoverable, and any change to what the run
  asserts.
- **Acceptance:**
  - [ ] Killing the run mid-scenario (or forcing a throw) leaves no electron process from this
        repository's `node_modules` behind.
  - [ ] `npm run e2e` still passes and still stops only its own process tree.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** start the run, interrupt it after a few steps, then check
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` lists nothing under this
  repository's path; then a clean `npm run e2e` with a guard app on another port.
- **Log:**
  - 2026-09-05 proposed by GC-035 (this ticket): wiring the narrow stopper into the epilogue made
    it obvious that no other exit path reaches it.

### GC-041 The launcher documents --keep-alive but checks --keep-running

- **Status:** todo
- **Area:** infra | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** The usage line at the top of `tools/launch-app.mjs` reads
  `[--port 9333] [--repo <path>] [--visible] [--keep-alive]`, but the CLI block tests
  `flag('--keep-running')`. Passing the documented `--keep-alive` silently does the opposite of
  what it says: the launcher frees the port anyway and stops whatever was already there. A caller
  reading only the header has no way to find that out.
- **Scope:**
  - Settle on one name and make the header, the code and any caller agree. `--keep-running` is
    the one that works today, so prefer it unless a caller depends on the other.
  - Say in the header what the flag does now that it guards `stopPort`: skip freeing the port,
    for attaching a second app alongside one that is already up.
- **Out of scope:** new launcher flags.
- **Acceptance:**
  - [ ] The documented flag is the flag the code reads.
  - [ ] Passing it against a busy port leaves the process on that port alone.
- **Files:** `tools/launch-app.mjs`.
- **Verify:** launch on a port, then launch again with the flag and confirm the first pid is still
  the one on that port.
- **Log:**
  - 2026-09-05 proposed by GC-035 (this ticket): the CLI's `killElectron()` call became
    `stopPort(port)` and the flag guarding it turned out not to be the one the header names.

## Adding a ticket

Copy a section, give it the next `GC-0NN`, fill every field, add a row to the board. A ticket
is only `todo` when its scope, acceptance criteria and verification steps are concrete enough
that a session with no other context could finish it. Otherwise mark it `blocked` and say what
decision is missing.


### GC-022 The +N refs dropdown is clipped by the graph scroll container

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `.ref-chip.more .more-list` is absolutely positioned at `top: 100%` inside the row,
  and the row lives in `.graph-body`, which is `overflow: auto`. A commit in the lower part of
  the viewport therefore has its folded refs cut off by the scroll container: measured on the e2e
  repository with the body clamped to 220px, the list extended 174px below the container's bottom
  edge and that part was not drawn. The chips inside it are the only way to reach a folded ref's
  context menu, so they are unreachable for those rows. GC-006 makes this more visible, because a
  narrow column folds more refs.
- **Scope:**
  - Flip the list above the chip when opening downwards would cross `.graph-body`'s bottom edge,
    the way `ContextMenu` already clamps itself to the viewport.
  - Keep it a hover affordance; no change to what it contains or to the fold budget.
- **Out of scope:** turning the `+N` list into a real menu through `useUi().openMenu` (a bigger
  change to how refs are reached, and it would lose the hover preview).
- **Acceptance:**
  - [ ] On the last row of a full graph, the whole folded list is visible.
  - [ ] On rows with room below, it still opens downwards.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** build, then measure the list's rect against `.graph-body`'s rect over CDP for a top
  row and a bottom row.
- **Log:**
  - 2026-09-05 proposed by GC-006 (this ticket): the width-aware fold folds more refs at narrow
    widths, and measuring the dropdown while checking that fold showed it clipped at the bottom.

### GC-023 Chip shrinking still assumes exactly two chips

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-006
- **Why:** `.ref-chip:nth-child(2):not(.more)` gives the second chip `flex-shrink: 50` so the
  primary ref stays readable, which was written when the column always showed two chips. GC-006
  lets a wide column show up to six, and chips three and beyond shrink at the default weight of 1,
  the same as the first, so a long third or fourth name now takes space from the checked-out
  branch's chip instead of giving way.
- **Scope:**
  - Replace the `nth-child(2)` rule with one that gives every chip after the first the same
    heavy shrink weight (`.ref-chip:not(:first-child):not(.more)`).
  - Confirm the primary chip still wins at 100px with four or more refs on the commit.
- **Out of scope:** the chip order itself (GC-020) and the fold budget (GC-006).
- **Acceptance:**
  - [ ] At 100px with four refs on one commit, the first chip keeps its name legible.
  - [ ] At 400px nothing shrinks that did not have to.
- **Files:** `src/renderer/src/styles/app.css`.
- **Verify:** build, screenshot a commit with four refs at both ends of the width range.
- **Log:**
  - 2026-09-05 proposed by GC-006 (this ticket): raising the fold budget above two made the
    two-chip assumption baked into the shrink rule visible.

### GC-024 Unit tests for prefs.ts

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** GC-007
- **Why:** `prefs.ts` decides what every other component reads, and its `load()` is the only
  code in the renderer that has to survive a hand-edited, truncated or stale `localStorage`
  value. GC-007 verified the migration by hand over CDP once; nothing stops the next change to
  `load()` from silently dropping a field or re-reading the legacy key twice.
- **Scope:**
  - `src/renderer/src/prefs.test.ts` with a `localStorage` stub, resetting the module between
    cases (`vi.resetModules()`) because the store is module-level state.
  - Cases: empty storage gives `DEFAULT_PREFS`; a stored blob round-trips; an unknown or
    wrongly typed field falls back per field rather than discarding the whole blob; malformed
    JSON falls back to the defaults; a legacy `gitclient.pullMode` is migrated, written into
    `gitclient.prefs` and removed; a legacy key alongside an existing blob is ignored;
    `setPrefs` merges rather than replaces and notifies subscribers.
- **Out of scope:** rendering `Preferences.tsx` (that would need jsdom, which the vitest config
  deliberately does not have).
- **Acceptance:**
  - [x] `npm test` covers all seven cases and passes.
  - [x] Deleting the migration branch in `load()` fails at least one test.
- **Files:** new `src/renderer/src/prefs.test.ts`.
- **Verify:** `npm test`, `npm run typecheck`.
- **Log:**
  - 2026-09-05 proposed by GC-007 (this ticket): the migration and the per-field fallbacks were
    checked once by hand over CDP and have no regression guard.
  - 2026-09-05 18:35 claimed
  - 2026-09-05 18:40 done: `src/renderer/src/prefs.test.ts` adds the seven cases (defaults on
    empty storage, blob round-trip, per-field fallback with an unknown and a wrongly typed
    field, malformed JSON, the legacy `gitclient.pullMode` migration writing the blob and
    removing the key, the legacy key ignored when a blob exists, and `setPrefs` merging,
    persisting and notifying). `load()` runs at import, so each case seeds a `localStorage`
    stub and re-imports through `vi.resetModules()`; the subscriber list is reachable only
    through `usePrefs`, so React's `useSyncExternalStore` is stubbed with `vi.mock` to capture
    the `subscribe` callback rather than exporting anything new from `prefs.ts`. Verified:
    `npm test` 37 passed (30 before), `npm run typecheck`, `npm run build`. Mutation-checked by
    deleting the migration branch in `load()`: the migration case fails, and `prefs.ts` was
    restored byte-identical afterwards. No e2e and no screenshot: the ticket adds a test file
    and touches no main-process code, no action and no UI.

### GC-026 One dialog with several fields instead of chained prompts

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `ui.prompt` takes exactly one text field, so "Add remote" (GC-008) asks for the name,
  waits for OK, then opens a second dialog for the URL. Cancelling the second one leaves nothing
  behind but the two-step flow reads as a bug, and the same shape will come up again (clone with
  a URL and a target folder, an annotated tag with a name and a message).
- **Scope:**
  - `PromptOptions` accepts several fields (label, placeholder, default value, required) and
    resolves an object keyed by field name; the single-field form keeps working unchanged so no
    existing caller or e2e helper has to move.
  - `Modal` renders the fields stacked, focuses the first, and disables OK until every required
    field is non-empty.
  - "Add remote" becomes one dialog asking for the name and the URL together.
- **Out of scope:** checkboxes per field, validation of URL syntax, a clone dialog.
- **Acceptance:**
  - [ ] Add remote is one dialog with two fields; the e2e step 16 fills both and clicks OK once.
  - [ ] Every other prompt caller behaves as it does today.
- **Files:** `src/renderer/src/ui/Modal.tsx`, `src/renderer/src/ui/UiContext.tsx`,
  `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck`, `npm run build`, `npm run e2e`, and a screenshot of the
  dialog.
- **Log:**
  - 2026-09-05 proposed by GC-008 (this ticket): adding a remote needs a name and a URL, and the
    prompt modal can only ask for one thing at a time.

### GC-025 A readable error when git is not on PATH

- **Status:** todo
- **Area:** main | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** launching the built app from a shell whose PATH has no `git` puts a bare
  `spawn git ENOENT` in the status bar and an empty graph, with nothing saying what is wrong or
  what to do. It happened twice while verifying GC-007 and read as a broken app rather than a
  missing dependency. Every repository action shells out, so this is the one failure that makes
  the whole client useless.
- **Scope:**
  - In `runGit`, translate a spawn `ENOENT` into a `GitError` naming git specifically: that
    `git` was not found on PATH and the client needs it installed and on PATH.
  - Check once at startup (`git --version`) and surface the same message in the empty state
    instead of the "Open a repository" prompt, so the cause is visible before any action.
- **Out of scope:** bundling git, or a setting for a git path (a separate ticket if wanted).
- **Acceptance:**
  - [ ] Launching with a PATH that has no git shows the named message, not `spawn git ENOENT`.
  - [ ] With git present, startup is unchanged and costs one `git --version`.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, launch once with a stripped PATH and once normally.
- **Log:**
  - 2026-09-05 proposed by GC-007 (this ticket): hit `spawn git ENOENT` twice while driving the
    built app over CDP and had to read the source to work out that PATH was the cause.

### GC-029 The stash message says "optional" but the modal refuses an empty one

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `stashChanges` in `App.tsx` opens `ui.prompt` with the label "Message (optional)", but
  `Modal` disables OK (and Enter) whenever a prompt has a text field and the field is empty
  (`hasInput && value.trim().length === 0`). So the toolbar Stash button and the WIP menu's
  "Stash changes…" cannot stash without a message, contradicting their own label; git's default
  "WIP on <branch>" message is unreachable. The e2e stash step (step 5) types `test stash`, which
  is why the suite never saw it. Every other prompt in the app genuinely needs its value (branch
  name, tag name, remote name, URL), so the fix is per prompt, not a change to the default.
- **Scope:**
  - `PromptOptions` gains `required?: boolean` (default `true`, so no other caller changes). With
    `required: false` the OK and secondary buttons stay enabled on an empty field and Enter
    resolves; the resolved `value` is `''`.
  - `stashChanges` passes `required: false`; `stashSave` already omits `-m` for an empty message.
  - e2e step 5: stash once with an empty message and assert `git stash list` gained an entry
    whose message starts with `WIP on`, then keep the existing named-stash assertion.
- **Out of scope:** any other prompt, validation of the message.
- **Acceptance:**
  - [x] Toolbar Stash with the field left empty creates a stash with git's default message.
  - [x] Create branch, create tag, rename, add remote and edit URL still refuse an empty value.
  - [x] e2e passes with the extended step 5.
- **Files:** `src/renderer/src/ui/Modal.tsx`, `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e:setup && npm run e2e`, then
  `git stash list` in the scratch repo.
- **Log:**
  - 2026-09-05 proposed by GR-001: reading `Modal.tsx` against the stash prompt showed the
    "(optional)" field is required, and the e2e step types a message so it never noticed.
  - 2026-09-05 17:35 claimed
  - 2026-09-05 17:55 done. `PromptOptions.required` added to `Modal.tsx` (default true); the
    disabled test and the early return in `resolveWith` now read `needsValue = hasInput &&
    options.required !== false`, so Enter resolves too. `stashChanges` is the only caller that
    passes `required: false` (grep over `src/renderer/src`), and `stashSave` already omitted
    `-m` for an empty message, so no main-process change was needed. e2e step 5 now stashes
    once with the field empty, asserts the OK button is enabled and that
    `git stash list -1 --format=%gs` starts with `WIP on `, pops the tree back with
    `--index` so the named stash below sees the same state, then keeps the original
    `test stash` assertion; the prologue pops a leftover unnamed stash so the run stays
    re-entrant. Verified: typecheck ok, build ok, `npm test` 30 passed, `npm run e2e` run three
    times end to end, 49/49 assertions, exit 0. Acceptance 2 checked live over CDP against the
    e2e repo: with the field emptied, Create branch (Create), Create tag (Create) and Add remote
    (Next) all keep OK disabled while Stash does not; rename and edit URL share that path and set
    no `required` flag. Screenshot `docs/screenshots/stash-optional-message.png` shows the Stash
    button live with the empty field and the `WIP on main` placeholder.

### GC-030 Commit search loses its query and results when a diff opens

- **Status:** in-progress
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-009
- **Why:** The search bar's `open` flag lives in `App.tsx`, but the query, the match list and the
  focus bookkeeping live in `CommitGraph`, which `App` unmounts whenever a file view opens
  (`fileView ? <DiffView/> : <CommitGraph/>`). Clicking a file in the detail panel mid-search,
  then closing the diff, brings back an empty bar with "N commits", while the toolbar Search
  button still shows as active and a click on it *closes* the bar instead of restoring it. Ctrl+F
  also closes the diff before opening the bar. GitKraken keeps the search as a filter on the
  graph independently of the file view.
- **Scope:**
  - Lift `query` into the `search` state in `App.tsx` next to `open` and `tick`, pass it and a
    setter to `CommitGraph`, and keep `lastNeedle` behaviour (a new query still jumps to its first
    match; an unchanged query on remount must not re-select).
  - Closing the bar (Escape, the X, the toolbar button) still clears the query.
  - The toolbar button: while a diff is open and the bar is open, a click closes the diff and
    refocuses the bar rather than closing the search.
- **Out of scope:** searching while the diff stays open, searching file paths (GC-009's out of
  scope stands), the author chip (GC-027).
- **Acceptance:**
  - [ ] Search "feature", click a file of the selected commit, close the diff: the bar shows
    "feature", the same "1 of 3" readout and the same dimmed rows.
  - [ ] e2e step 16 gains that round trip, asserting `searchState()` before and after.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/graph/CommitGraph.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e`.
- **Log:**
  - 2026-09-05 proposed by GR-001: the query is component state in a component that unmounts
    behind the diff view; noticed while reading GC-009's `CommitGraph.tsx`.
  - 2026-09-05 19:06 claimed

### GC-031 Push to a chosen remote when the repository has several

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** GC-008
- **Why:** GC-008 made a second remote a two-click affair, and the push paths still assume one.
  `git.ts push` picks `origin`, else the first remote, whenever the branch has no upstream; the
  ref menu's single "Push <name> and set upstream" item and the toolbar Push give no hint which
  remote that is, and "Push tag to remote" uses `snapshot.remotes[0]` (alphabetical, so a remote
  called `alpha` beats `origin`). The study (`05-menus-shortcuts.md`, branch chip menu) has
  "Push <name> to..." with one entry per remote and "to all remotes".
- **Scope:**
  - `refMenuItems`: with one remote keep today's item; with several, one item per remote
    "Push <name> to <remote>" (setting the upstream when the branch has none) and, for tags,
    "Push tag to <remote>" per remote. `MenuItem` has no submenu; a labelled group with a
    separator is enough.
  - Tag pushes go through the same remote choice as branches (`origin` preferred, then the
    first) instead of `remotes[0]`.
  - Toolbar Push title names the remote it will use when the branch has no upstream.
- **Out of scope:** a remote picker dialog, "push to all remotes", pull from a chosen remote.
- **Acceptance:**
  - [ ] With `origin` and a second remote, the branch menu lists a push entry per remote and each
    pushes there (`git ls-remote <remote> <branch>` shows the sha).
  - [ ] Tag push with remotes `alpha` and `origin` lands on `origin` by default.
  - [ ] e2e step 17 (remotes) pushes a branch to the added remote before removing it.
- **Files:** `src/renderer/src/App.tsx`, `src/main/git.ts`, `src/renderer/src/components/Toolbar.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e`, `git ls-remote` on the bare
  remotes of the scratch repo.
- **Log:**
  - 2026-09-05 proposed by GR-001: GC-008 shipped remote management while every push path still
    hard-codes a single remote, and the tag path picks a different one from the branch path.

### GC-032 Optional Author, Date and SHA columns in the graph

- **Status:** todo
- **Area:** graph | **Size:** M | **Priority:** P2
- **Depends on:** GC-006, GC-007
- **Why:** The study (`03-graph.md`, Columns) records user-enabled AUTHOR, COMMIT DATE / TIME,
  SHA and CHANGES columns to the right of the message, toggled from column settings, and
  `06-feature-inventory.md` marks relative and formatted dates as "Build". Our graph has the three
  fixed columns only; the commit date is visible nowhere until a commit is selected, which makes
  the date-ordered graph hard to read on a real repository.
- **Scope:**
  - Prefs `graphColumns: { author: boolean; date: boolean; sha: boolean }` (all off by default),
    three toggles in Preferences under a "Graph" group, validated in `load()`.
  - `CommitGraph` renders the enabled columns after the message column with fixed widths of our
    own (about 140px author, 150px date, 80px sha), header labels AUTHOR, DATE / TIME, SHA, cells
    at 12px in 60% text; the message column keeps `minmax(0, 1fr)` so nothing overflows.
  - Date shown as `dd/mm/yyyy, HH:MM` in the local zone (the format the detail panel already
    uses), with the ISO date as the title attribute. Author as the name only.
  - The WIP row leaves the extra cells empty.
- **Out of scope:** the CHANGES column (needs a per-commit diff stat), column reordering, a header
  cog (Preferences is the one home for settings), relative "3 hours ago" dates.
- **Acceptance:**
  - [ ] Toggling each column in Preferences adds or removes it live, and the choice survives a
    reload.
  - [ ] With all three on, the rows stay 28px, the graph SVG width is unchanged and the message
    column still truncates instead of widening the window.
  - [ ] Screenshot at 1400x900 with all three on, looked at against `02-main-1080.png`.
- **Files:** `src/renderer/src/prefs.ts`, `src/renderer/src/components/Preferences.tsx`,
  `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** typecheck, build, `npm test` (a prefs test if GC-024 has landed), screenshot.
- **Log:**
  - 2026-09-05 proposed by GR-001: the study's optional graph columns are the largest visible gap
    between the two graphs that no ticket covers.

### GC-033 Global shortcuts from the study: branch, fetch, panels, staging

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-010
- **Why:** `05-menus-shortcuts.md` lists the body-scope bindings GitKraken users have in their
  fingers; we handle only arrows, Escape, Ctrl+F and Ctrl+Enter. GC-010 introduces the
  `shortcuts.ts` table the handlers and the overlay read from, so adding bindings becomes a
  table entry plus a handler and the overlay documents them for free.
- **Scope:**
  - Ctrl+B create branch at HEAD, Ctrl+L fetch all, Ctrl+J toggle the left panel, Ctrl+K toggle
    the detail panel (new `detailCollapsed` state; the panel returns on any selection change),
    Ctrl+Alt+F focus the left panel filter, Ctrl+Shift+S stage all, Ctrl+Shift+U unstage all,
    Ctrl+Shift+M focus the commit summary field.
  - All outside editable fields except Ctrl+Shift+M, which works from anywhere like Ctrl+F.
    Disabled states follow the toolbar (no repo, busy, no remotes).
  - Every entry lands in `shortcuts.ts`, so the GC-010 overlay lists them.
  - `Shortcut.whileTyping` is set on seven entries of the table but read by nothing (GR-002):
    make the `App.tsx` handler consult it — entries with the flag fire from editable fields, the
    rest do not — instead of a per-shortcut `isEditable` check, so the eight new bindings and the
    existing ones share one rule.
- **Out of scope:** Ctrl+P command palette, undo/redo (GC-018), zoom, J/K/H/L vim keys,
  Shift+Up/Down topological stepping, user-configurable bindings.
- **Acceptance:**
  - [ ] Each binding does what its table entry says, and the overlay shows all eight.
  - [ ] Ctrl+B and Ctrl+Shift+S do nothing while the focus is in the commit form.
  - [ ] e2e: Ctrl+L over CDP triggers a fetch (spinner appears, `waitIdle` settles).
- **Files:** `src/renderer/src/shortcuts.ts`, `src/renderer/src/App.tsx`,
  `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/components/DetailPanel.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, screenshot of the overlay.
- **Log:**
  - 2026-09-05 proposed by GR-001: the study's key bindings table has eight body-scope shortcuts
    we lack; GC-010's table makes them cheap and self-documenting.
  - 2026-09-05 18:25 scope extended by GR-002: `whileTyping` exists in the table but no handler
    reads it; this ticket adds the bindings that need the distinction, so it owns making the
    flag live rather than a separate hygiene ticket.

---

### GC-034 Escape inside a dialog also closes the diff behind it

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `Preferences` and `Modal` handle Escape on their own backdrop, but the event keeps
  bubbling to the `window` listener in `App.tsx`, which then also closes the open diff (or the
  find bar) behind the dialog. One Escape does two things and the second one is invisible until
  the dialog is gone.
- **Scope:**
  - Escape closes only the topmost layer: the dialog if one is open, otherwise the find bar,
    otherwise the diff.
  - Do it once, for every layer, rather than per dialog: either the dialogs stop the event
    (`stopPropagation` on the key they consume) or `App.tsx` learns that a dialog is up. The
    shortcuts overlay already guards itself in `App.tsx`; whichever way is chosen, that guard
    folds into it instead of being a special case.
- **Out of scope:** focus trapping, a general modal stack, the context menu (it closes on its
  own and nothing sits under it).
- **Acceptance:**
  - [x] With a file diff open, opening Preferences and pressing Escape closes only Preferences;
    a second Escape closes the diff.
  - [x] Same with a prompt or confirm modal, and with the find bar open instead of the diff.
  - [x] The e2e suite still passes (it drives modals with Escape and with the buttons).
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/ui/Modal.tsx`,
  `src/renderer/src/components/Preferences.tsx`.
- **Verify:** typecheck, build, e2e, and the two acceptance cases driven over CDP.
- **Log:**
  - 2026-09-05 proposed by GC-010 (this ticket, filed as GC-034 because the hourly review took
    GC-029 to GC-033 while this run was working): confirmed over CDP while checking the overlay's
    own Escape handling — with `README.md`'s diff open, opening Preferences and pressing Escape
    left `.modal.prefs` gone *and* `.diff-body` gone in the same keystroke.
  - 2026-09-05 17:45 claimed
  - 2026-09-05 18:05 done. Escape is now decided in one place. `UiContext` exposes
    `dialogOpen` (a prompt/confirm modal is up) and `closeDialog()`; `App` computes
    `dialogOpen = shortcutsOpen || prefsOpen || ui.dialogOpen` and, while it is true, its window
    handler closes exactly the topmost layer on Escape (and the overlay on `?`) and swallows
    every other key, so nothing behind a dialog scrolls or closes. `Modal` and `Preferences`
    no longer handle `dialogCancel` themselves and the shortcuts overlay's special case in
    `App` folded into the same guard, as the scope asked. The overlay's own text was corrected
    with it: Esc is now "Close the find bar, the open diff or a popover" and the Dialogs group's
    Esc is "Close or cancel the dialog". Verified: typecheck, build, `npm test` (30 passed),
    `npm run e2e` (49 assertions, all passed), and a CDP script driving the four acceptance
    cases against the built app — diff behind Preferences, diff behind the Create-branch prompt
    (cancelled, no branch created), find bar behind Preferences, and the overlay over a diff
    closed with both Escape and `?` — 14 checks, all passed, screenshot
    `docs/screenshots/escape-layers.png`.

### GC-037 Escape with a context menu open also closes the find bar behind it

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-034
- **Why:** GC-034 fixed the dialogs but deliberately left the context menu out. `ContextMenu`
  closes itself from its own capture-phase `window` listener without stopping the event, so
  `App`'s handler still runs and closes the find bar (or the open diff) underneath. One Escape
  does two things again, this time with a menu on top.
- **Scope:**
  - An open context menu is a layer like the dialogs: Escape closes the menu and nothing else.
  - Reuse GC-034's mechanism rather than adding a second one — the menu is already owned by
    `UiProvider`, so it can join the flag `App` reads instead of growing its own special case.
  - A menu must not swallow the keys a dialog does: with a menu open the graph arrows and
    Ctrl+F may keep working, or may not, but the choice is made once and written down.
- **Out of scope:** keyboard navigation inside the menu (arrow keys, Enter to activate an item),
  focus trapping.
- **Acceptance:**
  - [x] With the find bar open, right-clicking a commit row and pressing Escape closes only the
    menu; a second Escape closes the find bar.
  - [ ] Same with a file diff open instead of the find bar. **Not reachable today:** with a diff
    open the graph is replaced and the left panel is collapsed to the icon rail, so the DOM has
    no context-menu trigger at all (verified over CDP: 0 `.graph-row`, 0 `.ref-row`). The diff
    goes through the same single branch in `App.tsx` as the find bar, so it is covered by
    construction; the case becomes testable the day a diff or the collapsed rail grows a menu.
  - [x] The e2e suite still passes (several steps dismiss menus).
- **Files:** `src/renderer/src/ui/ContextMenu.tsx`, `src/renderer/src/ui/UiContext.tsx`,
  `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, e2e, and the two acceptance cases driven over CDP.
- **Log:**
  - 2026-09-05 proposed by GC-034 (this ticket): confirmed over CDP against the fixed build —
    with the find bar open, one Escape on an open commit menu left `.ctx-menu` gone *and*
    `.graph-search` gone. The ticket's own scope note ("nothing sits under it") turned out not
    to hold: the find bar and the diff both do.
  - 2026-09-05 17:54 claimed
  - 2026-09-05 18:10 done. `ContextMenu` no longer listens for keys at all; `UiProvider` exposes
    `menuOpen`/`closeMenu()` next to `dialogOpen`/`closeDialog()`, and `App.tsx` folds the menu
    into GC-034's single branch as `layerOpen = shortcutsOpen || prefsOpen || ui.dialogOpen ||
    ui.menuOpen`. One thing GC-034 did not need: the find bar's own input closes the search on
    Escape from a React handler, which a window listener in the bubble phase cannot stop, so the
    handler moved to the **capture phase** and calls `stopPropagation()` on the key it consumes.
    The choice the ticket asked to be written down: a menu swallows exactly what a dialog does —
    the window-level shortcuts (graph arrows, Ctrl+F, `?`) are ignored while it is up, and every
    key still reaches the focused element, which is what keeps a modal's input working. Verified:
    typecheck, build, 30 unit tests, the full e2e suite (49 assertions, all passed), and the
    acceptance cases driven over CDP against the built app with real `Input.dispatchKeyEvent`
    Escapes — with the find bar open and focus in its input, one Escape left `.ctx-menu` gone and
    `.graph-search` still up, the second closed the find bar
    (`docs/screenshots/gc037-menu-over-find-bar.png`).

### GC-038 Escape with the Pull popover open also closes the find bar behind it

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Why:** GC-037 made the context menu a layer, but the toolbar's Pull-options popover still
  closes itself from its own `window` keydown listener in `Toolbar.tsx`, which does not stop the
  event. `App`'s handler therefore also runs and closes the find bar (or the open diff)
  underneath. Same defect as GC-034 and GC-037, one layer further along.
- **Scope:**
  - The popover joins the same mechanism instead of growing a third one: `App` must be able to
    see that it is open and close it, the way it does for a dialog and for a menu, and
    `Toolbar` stops handling Escape itself.
  - The popover lives in `Toolbar`'s own state today; lifting just the flag (or moving the
    popover behind `UiProvider`) is the design decision the ticket has to make.
- **Out of scope:** keyboard navigation inside the popover; any other toolbar behaviour.
- **Acceptance:**
  - [x] With the find bar open, opening the Pull caret and pressing Escape closes only the
    popover; a second Escape closes the find bar.
  - [x] Clicking outside the popover still closes it, and picking a pull mode still works.
  - [x] The e2e suite still passes (step 14 opens this popover for `Fetch all`).
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, e2e, and the acceptance case driven over CDP.
- **Log:**
  - 2026-09-05 proposed by GC-037 (this ticket): confirmed over CDP against the fixed build —
    with the find bar open and the Pull popover up, one Escape left `.popover` gone *and*
    `.graph-search` gone.
  - 2026-09-05 18:05 claimed
  - 2026-09-05 18:12 done. Design decision: the flag was lifted, not the popover. `pullOpen`
    now lives in `App` beside `prefsOpen`/`shortcutsOpen`, is passed to `Toolbar` as
    `pullOpen` + `onPullOpenChange`, and joins `layerOpen` and the topmost-layer chain
    (below the context menu). `Toolbar` lost its `window` keydown listener and its
    `matches` import, and keeps only the outside-click handler, which is nobody else's
    business. A `grep` for `keydown` afterwards found no `window` listener left anywhere in
    the renderer outside `App.tsx`, so GC-034, GC-037 and this ticket close the whole class.
    Verified: typecheck, build, `npm test` (30 passed), `npm run e2e` twice (49 assertions,
    all passed, including the `Fetch all` step that drives this popover), and the acceptance
    cases driven over CDP against the built app — with the find bar up, opening the caret and
    pressing Escape left `.popover` gone and `.graph-search` still there, a second Escape
    closed the find bar, an outside mousedown still closed the popover, and picking
    "fast-forward only" changed the Pull button's default and closed the popover. Screenshot:
    `docs/screenshots/gc-038-pull-popover-over-search.png` (popover drawn over the find bar).

### GC-039 An e2e step that guards one Escape, one layer

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** GC-038
- **Why:** GC-034 and GC-037 both fixed "one Escape closes two things", and both were verified by
  a throwaway CDP script that was not kept. Nothing in `npm run e2e` or `npm test` fails if the
  layering regresses; the next change to the keyboard handler can quietly undo either fix.
- **Scope:**
  - A step in `tools/e2e/run.mjs` that opens the find bar, opens a context menu over a commit
    row with focus still in the search input, presses a real Escape and asserts `.ctx-menu` is
    gone while `.graph-search` is still there, then presses Escape again and asserts the find
    bar is gone.
  - The same for a dialog on top of the find bar (a prompt from a ref menu, cancelled with
    Escape), so GC-034 is guarded too, and for the toolbar's Pull popover on top of the find
    bar, so GC-038 is guarded too.
  - Re-entrant like the rest of the suite: it must leave no dialog, menu or find bar open.
- **Out of scope:** a jsdom unit test of `App`'s handler (the suite has no React environment).
- **Acceptance:**
  - [x] The new step passes on the current build and its assertions are counted in the total.
  - [x] Reverting GC-037 (giving `ContextMenu` its Escape listener back) fails the step.
  - [x] Reverting GC-038 (giving `Toolbar` its Escape listener back) fails the step.
- **Files:** `tools/e2e/run.mjs`, `CLAUDE.md` (the Testing paragraph's step list).
- **Verify:** `npm run e2e` twice in a row, and once against a locally reverted GC-037.
- **Log:**
  - 2026-09-05 proposed by GC-037 (this ticket): the acceptance cases were driven over CDP from a
    scratch script and thrown away, leaving the fix unguarded.
  - 2026-09-05 18:12 scope extended by GC-038 (not a new ticket, same defect class): the popover
    is now a layer too and is unguarded for the same reason.
  - 2026-09-05 18:25 GR-002 added the missing `Depends on` line (GC-038, the last of the three
    layers this step guards); the template asks for one on every ticket.
  - 2026-09-05 18:55 claimed
  - 2026-09-05 19:20 done. `tools/e2e/run.mjs` gained a `layerState()` helper (menu / modal /
    popover / find bar + its current query, read in one evaluation) and step 18: the find bar is
    opened from the toolbar and typed into, so focus stays in the search input, then a commit
    context menu (GC-037), a `Rename main…` prompt from the left-panel ref menu (GC-034) and the
    toolbar Pull popover (GC-038) are each opened over it and closed with one real CDP Escape,
    asserting each time that the layer is gone and the find bar still holds `feature`; the next
    Escape closes the find bar and the last three assertions check no layer is left open and the
    dimming is cleared, so the step is re-entrant. The cancelled prompt is also asserted to have
    renamed nothing. Verified: `npm run typecheck`, `npm run build`, `npm test` (4 files, 37
    tests) and `npm run e2e` three times on the clean build, 60 assertions passed each time
    (was 49) and the scratch repository came back to `main` with no stash left. Mutation checks,
    each built and run then reverted: removing `ui.menuOpen` from `layerOpen` in `App.tsx` and
    giving `ContextMenu` its `keydown` listener back failed 5 assertions, the first being "Escape
    closes the menu only"; the same for `pullOpen` and `Toolbar` failed exactly one, "Escape
    closes the popover only". Worth knowing for a future revert: putting a layer's own Escape
    listener back is not enough to reproduce the bug on its own, because `App`'s capture-phase
    handler calls `stopPropagation()` and the bubble-phase listener never runs — the layer also
    has to drop out of `layerOpen`, which is what makes the find bar's own input handler close it
    at the same time. No screenshot: the step asserts over the DOM and the change is test-only.

### GC-042 shortcuts.test.ts is stored as binary because of a raw NUL byte

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** GC-010's `src/renderer/src/shortcuts.test.ts` contains a literal U+0000 byte inside a
  string (the "no shortcut matches a NUL key" case, `key('<NUL>')` at byte offset 790) instead of
  the escape `'\u0000'`. Git's binary heuristic therefore classifies the whole file as binary:
  `git ls-files --eol` reports `i/-text w/-text` for it, `git show 5c108db -- <file>` prints
  "Binary files differ", `git diff`, `git blame` and any code review see no content, and the
  `* text=auto eol=lf` rule in `.gitattributes` skips it, so its line endings are never
  normalised. Vitest and TypeScript read it fine, which is why nothing failed. Found by GR-002
  while trying to review the test as a diff.
- **Scope:**
  - Replace the raw byte with the `'\u0000'` escape; the assertion stays the same.
  - Confirm no other tracked text file is affected: `git ls-files --eol | grep -v '\.png'` must
    show no `i/-text` entry.
- **Out of scope:** any change to the bindings, the matchers or the overlay.
- **Acceptance:**
  - [x] `git ls-files --eol src/renderer/src/shortcuts.test.ts` reports `i/lf w/lf`.
  - [ ] `git show HEAD -- src/renderer/src/shortcuts.test.ts` shows a text diff. Not tickable
    on the fixing commit itself: its pre-image blob is still the binary one, so git prints
    "Binary files differ" for that one transition. Every diff from here on is text, proved by
    `git diff` on a scratch edit and by `git blame -L 18,19` printing the changed line.
  - [x] `npm test` still passes: 37 tests in 4 files (the ticket said 30, written before
    GC-024 added `prefs.test.ts`).
  - [x] No other tracked non-PNG file is `i/-text`.
- **Files:** `src/renderer/src/shortcuts.test.ts`.
- **Verify:** `npm test`, `npm run typecheck`, `git ls-files --eol`, `git show HEAD -- <file>`.
- **Log:**
  - 2026-09-05 proposed by GR-002: the GC-010 commit could not be reviewed as a diff because git
    stores the test file as binary; the working copy had to be read instead.
  - 2026-09-05 18:45 claimed
  - 2026-09-05 18:50 done. One byte changed: the literal U+0000 at offset 790 became the
    six-character escape `\u0000`, so the assertion is identical and the file is text again.
    `git ls-files --eol` now reports `i/lf w/lf attr/text=auto eol=lf` for it and lists no
    other tracked non-PNG file as `i/-text`. Verified with `npm run typecheck` (clean),
    `npm test` (4 files, 37 tests passed) and `npm run build` (clean). No e2e and no
    screenshot: the change touches neither `git.ts`, `ipc.ts`, actions nor any UI.

### GC-043 Context menu on file rows in the detail panel

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-003
- **Why:** The study's file rows carry a context menu (`05-menus-shortcuts.md`, "File rows":
  Stage / Unstage / Discard, Copy file path, Open file, Open in external editor, Show in folder,
  Ignore file / extension / folder, Blame, History). Ours have none: on the build at 94b7ea1 a
  `contextmenu` event dispatched on `.detail-panel .file-row` over CDP opened nothing, while every
  other row in the app (commit, chip, left-panel branch, remote, stash, WIP) has a menu, so the
  file list is the one place where a right-click does nothing. The hover `Stage` / `✕` buttons
  are the only way to act on a single file and they need the pointer on the row. A side effect:
  GC-037's second acceptance box ("same with a file diff open") is unticked because no menu
  trigger exists while a diff is open, and the detail panel stays up beside a diff, so this menu
  makes that case testable.
- **Scope:**
  - Right-click on a staging-view file row opens `useUi().openMenu` with: Stage or Unstage
    (whichever applies to the row; conflicted rows get Stage as "mark resolved"), Discard changes
    (Delete file for an untracked one) through the same confirm modal the `✕` button uses, a
    separator, Open file, Show in folder, Copy file path (repository-relative). Commit-view file
    rows get Open file (disabled when the path no longer exists in the working tree), Show in
    folder and Copy file path.
  - Open file and Show in folder need the main process: `shell.openPath` and
    `shell.showItemInFolder` behind two channels `shell:openPath` / `shell:showItemInFolder` with
    `str` validation that also rejects any path outside the loaded repository (resolve, then
    prefix check), preload entries and the `GitApi` (or a small `ShellApi`) types.
  - The items are built the way the other menus are (`commitMenuItems` and friends in `App.tsx`,
    or a `fileMenuItems` next to `StagingActions`), so the same wording and confirm texts are
    reused, not duplicated.
- **Out of scope:** Ignore file / extension / folder (writes `.gitignore`; its own ticket if
  wanted), Blame, History, Open in external editor (needs an editor preference), multi-select.
- **Acceptance:**
  - [ ] Right-click on an unstaged, a staged, an untracked and a commit file row each show the
        right items; the item that does not apply (Unstage on an unstaged file) is absent, not
        disabled.
  - [ ] Stage from the menu changes `git status --short`; Discard from the menu goes through the
        confirm modal and Cancel changes nothing.
  - [ ] Copy file path puts the repository-relative path on the clipboard (read back with
        `navigator.clipboard.readText()` over CDP).
  - [ ] The `shell:*` channels reject a path outside the repository.
  - [ ] e2e step: stage `a.txt` from its row menu, assert `git status --short`, then unstage it
        the same way.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/main/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/shared/types.ts`,
  `tools/e2e/run.mjs`, `CLAUDE.md` (the IPC channel groups).
- **Verify:** typecheck, build, e2e, screenshot of the menu over the staging list.
- **Log:**
  - 2026-09-05 proposed by GR-002: dumping every context menu over CDP against the study showed
    the file rows as the only row type without one.

### GC-044 Recently opened repositories from the repository breadcrumb

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** none
- **Why:** The study's repository breadcrumb opens a dropdown (`04-panels.md`, "Dropdowns";
  `09-repo-dropdown.png`) with a search box, Favorites, Recently opened and Open Repo
  Management, the new-tab page lists recent repositories, and `06-feature-inventory.md` marks
  "tabs + recents" as Build. Ours remembers exactly one path (`gitclient.lastRepo`) and the
  `repository` crumb in `Toolbar.tsx` is a static `div` with no handler (checked over CDP), so
  switching between two repositories means the folder dialog every time.
- **Scope:**
  - `gitclient.recentRepos`: a JSON array of absolute paths, most recent first, at most 10,
    deduplicated on the normalised path, updated by `load()` in `App.tsx` on every successful
    load. It is remembered state on its own key, like `gitclient.lastRepo`, not a preference.
  - The repository crumb becomes a button. Clicking it opens a menu through `useUi().openMenu`
    anchored at the crumb's bottom-left corner (the helper takes `clientX` / `clientY`) listing
    the recents (folder name as the label, full path as the hint, the loaded one disabled), a
    separator and "Open repository…" (the existing dialog). Picking an entry calls `load(path)`.
  - The empty state ("Open a repository to see its commit graph.") lists the same recents as
    clickable rows above its button.
  - An entry whose folder no longer loads is removed from the list; the error still shows in the
    status bar as today.
- **Out of scope:** favourites, a search box in the dropdown, the branch breadcrumb dropdown,
  multi-tab (GC-016 should reuse this list when it lands).
- **Acceptance:**
  - [ ] After loading two repositories the crumb menu lists both, most recent first, and picking
        the other one loads it (status bar name and `Viewing N` change).
  - [ ] The list survives a reload and never exceeds 10 entries.
  - [ ] Picking a path that no longer exists shows the error and drops the entry.
  - [ ] Screenshot of the open dropdown looked at next to the study's `09-repo-dropdown.png` for
        layout only; the styling is ours.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/Toolbar.tsx`,
  `src/renderer/src/styles/app.css`, `CLAUDE.md` (the remembered-state keys paragraph).
- **Verify:** typecheck, build, then over CDP against the scratch repository and a second clone
  of it (loading a real repository read-only is fine, writing to one is not), reading
  `localStorage.getItem('gitclient.recentRepos')` back after each step.
- **Log:**
  - 2026-09-05 proposed by GR-002: the breadcrumb is inert and only one repository is remembered,
    where the study has a recents dropdown and a recents list on the new-tab page.

### GC-045 Commit view banner linking back to the working directory changes

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** The study's commit view starts with a blue banner "N file change in working
  directory" and a "View Change" button that jumps back to the WIP row (`04-panels.md`, "Detail
  panel: commit view", item 1). Ours shows nothing about pending changes once a commit is
  selected: on a tree with five changes the panel header reads only `commit: b4220d4`
  (GR-002's `02-commit-selected.png`). The counts survive in the graph's WIP row, but not in the
  panel the user is reading, and getting back means finding row 0.
- **Scope:**
  - In `CommitView`, when `status.entries` is non-empty, a `.banner` row above the message box:
    "N file changes in the working directory" (singular for one) with a "View changes" button
    that selects the WIP row (`onSelectSha(WIP)`; the `WIP` sentinel is exported by
    `CommitGraph.tsx`). Conflicted entries count too. The `status` prop has to reach the commit
    view; the staging view already receives it.
  - Own styling in `app.css` (an informational variant of the existing `.banner`); no colour
    lifted from the study.
- **Out of scope:** listing the changed files in the banner, a mode that keeps WIP selected.
- **Acceptance:**
  - [ ] With a dirty tree and a commit selected, the banner shows the same count as the staging
        header "N file changes on <branch>", and the button selects the WIP row and shows the
        staging view.
  - [ ] With a clean tree there is no banner.
  - [ ] Screenshot looked at next to the study's `03-commit-selected.png`.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/App.tsx` (only to pass `status` through).
- **Verify:** typecheck, build, then over CDP: select a commit, read `.detail-panel .banner`,
  click its button, assert `.graph-row.wip.selected`.
- **Log:**
  - 2026-09-05 proposed by GR-002: the commit view is the one panel where the study keeps the
    working-directory changes visible and ours drops them.

### GC-046 A DOM environment so components can be unit tested

- **Status:** todo
- **Area:** tests | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** `vitest.config.ts` runs one project in the `node` environment, which was right while
  the only covered modules were pure (`parseDiff`, `lanes`, `shortcuts`, `prefs`). Three tickets
  have now put work out of scope purely because there is no DOM: GC-002 ("component tests"),
  GC-024 ("rendering `Preferences.tsx` would need jsdom") and GC-039 ("a jsdom unit test of
  `App`'s handler"). GC-024 also had to stub React's `useSyncExternalStore` to reach `prefs.ts`'s
  subscriber list, because the only door to it is a hook. Every behaviour that lives in a
  component is therefore guarded by the e2e suite alone, which needs a build and a launch.
- **Scope:**
  - `jsdom` and `@testing-library/react` (plus `@testing-library/jest-dom` if its matchers are
    used) as devDependencies, pinned to versions whose peer ranges accept React 19 and Vite 7 —
    the version constraints in `CLAUDE.md` still hold, nothing may force a Vite or plugin bump.
  - `vitest.config.ts` gains a second project (or a per-file `environment` override) so
    `src/**/*.test.ts` keeps running in `node` and `src/**/*.test.tsx` runs in `jsdom` with
    `@vitejs/plugin-react` applied; `tsconfig.web.json` already covers `.tsx` under
    `src/renderer/src`.
  - One proof test, `src/renderer/src/components/Preferences.test.tsx`: render the dialog,
    toggle the avatars row, assert `getPrefs().avatars` flipped and that the row reflects it.
  - `CLAUDE.md`'s Testing section documents the split and which file extension picks which
    environment.
- **Out of scope:** porting existing e2e steps to component tests, snapshot testing, a coverage
  threshold, testing `App.tsx` as a whole (it reaches for `window.api`).
- **Acceptance:**
  - [ ] `npm test` runs both projects and passes, with the existing 37 node tests untouched.
  - [ ] `npm run typecheck` passes with the new `.tsx` test included.
  - [ ] The proof test fails if the Preferences avatars row stops calling `setPrefs`.
- **Files:** `vitest.config.ts`, `package.json`, new
  `src/renderer/src/components/Preferences.test.tsx`, `CLAUDE.md`.
- **Verify:** `npm test`, `npm run typecheck`, `npm run build` (the build must not pick up the
  new devDependencies).
- **Log:**
  - 2026-09-05 proposed by GC-024 (this ticket): writing the `prefs.ts` tests needed a React stub
    to reach a hook-only subscriber list, and three tickets have already deferred work for want of
    a DOM environment.

### GC-047 A test that fails on a raw control byte in a source file

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-042
- **Why:** GC-042 fixed one literal U+0000 that a session had written straight into
  `shortcuts.test.ts`. Nothing caught it: vitest, `tsc` and the build all read the file happily,
  so it survived a whole ticket cycle and was only found when GR-002 tried to review the commit
  as a diff and got "Binary files differ". The same mistake in any future file would be just as
  invisible, and the cost is that the file drops out of `git diff`, `git blame`, review and
  `.gitattributes` normalisation. A byte-level check is a few lines and runs in milliseconds.
- **Scope:**
  - A vitest test that walks the tracked source trees (`src/` and `tools/`) and the root markdown
    files (`TICKETS.md`, `CLAUDE.md`, `README.md`) and fails if any file
    contains a C0 control byte other than TAB (0x09) and LF (0x0A); CR (0x0D) counts as a failure
    too, because `.gitattributes` pins the working copy to LF.
  - The failure message names the file and the byte offset, the way GC-042's ticket described the
    original one, so the fix is obvious from the output alone.
  - It skips `node_modules/`, `out/`, `dist/` and binary extensions (`.png`, `.woff2`, `.ico`).
  - Placed at `src/renderer/src/repo-hygiene.test.ts` so the existing `vitest.config.ts` include
    (`src/**/*.test.ts`) and `tsconfig.web.json` cover it without config changes, even though what
    it checks is the repository rather than the renderer; say so in a comment at the top.
- **Out of scope:** a git hook, a lint rule, any CI wiring, checking encodings or trailing
  whitespace.
- **Acceptance:**
  - [ ] `npm test` passes on a clean tree.
  - [ ] Putting a raw NUL back into any file under `src/` makes it fail, and the message names
    that file and the offset (mutation-check it, then revert).
  - [ ] The walk skips `node_modules/` and `out/`, and the whole suite still runs well under a
    second.
- **Files:** new `src/renderer/src/repo-hygiene.test.ts`, `CLAUDE.md` (Testing section).
- **Verify:** `npm test`, `npm run typecheck`, plus the mutation check above.
- **Log:**
  - 2026-09-05 proposed by GC-042 (this ticket): the raw NUL byte GC-042 removed passed every
    existing check and was found only by a human reading a diff; a byte-level test would have
    caught it the same day.
  - 2026-09-05 the same mistake happened a third time while GC-042 was being closed: the Node
    script writing this ticket's own log line into `TICKETS.md` emitted a real U+0000 instead of
    the escape, and it had to be repaired exactly the way GR-002 repaired two stray NULs in this
    file earlier the same day. Three occurrences in one day is why the scope covers the root
    markdown files and not only `src/`.

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-001 Backlog review 2026-09-05 17:23

- **Status:** done
- **Window:** 197b5d9..a288c69
- **Log:**
  - 2026-09-05 17:23 shipped: GC-001 (repository), GC-002 (vitest, 22 then 23 tests), GC-003
    (styled confirm modal), GC-004 (dirty-checkout guard with Stash and check out), GC-005 (Pin to
    Left), GC-006 (resizable ref column, width-aware chip fold), GC-007 (Preferences behind
    `gitclient.prefs`), GC-008 (remote add/edit/rename/remove), GC-009 (commit search), plus the
    protocol commits (review routine, reflect step, GC-028 stealth ticket). GC-010 was
    `in-progress` (claimed 17:05) and was not touched. Read as a reviewer: `runCheckout` restores
    the stash on a failed checkout correctly; `remoteAdd` leaves the remote in place when the
    follow-up fetch fails, which is fine since the error is shown; `prefs.load()` validates per
    field as claimed. Acceptance logs match the diffs, with one gap: GC-008's log says its e2e
    step is 16 while GC-009 renumbered it to 17 (cosmetic). Three defects found in shipped code:
    the stash prompt's "(optional)" message is required by the modal (GC-029, P1, masked because
    e2e step 5 types a message); the search query dies with `CommitGraph` when a diff opens
    (GC-030); every push path still assumes one remote and the tag path picks `remotes[0]` where
    the branch path prefers `origin` (GC-031).
  - health: typecheck ok, tests 23 passed (2 files), build ok — all run in the detached worktree
    at `a288c69` with `node_modules` junctioned from the main checkout.
  - app: skipped, GC-028 (stealth launcher) is still `todo` on `origin/main`. Looked instead at the
    committed screenshots `docs/screenshots/commit-search.png` and `remote-menu.png`: the find
    bar, dimming, remote menu and section `+` match the study's layout; the graph has only the
    three fixed columns where the study lists optional Author, Date and SHA (GC-032), and the
    staging list has no Path | Tree toggle (not ticketed, larger than a first pass warrants).
  - tickets: added GC-029, GC-030, GC-031, GC-032, GC-033. No existing ticket extended; GC-022 and
    GC-023 re-checked against `app.css` and still apply. Board: GC-029 placed right after GC-028
    because it is a P1 defect in shipped work; GC-030 and GC-031 after GC-024 with the other P2
    follow-ups to shipped tickets; GC-032 before GC-011 as the last P2; GC-033 after GC-027 with
    the P3s. Blocked GC-017 and GC-018 still wait on Ricardo's decisions, nothing new to unblock
    them.
  - notes: `CLAUDE.md`'s "Unit tests" section still says "Covered today (22 tests)" although
    GC-005 added a 23rd; the "Done" paragraph itself is current through GC-009.

### GR-002 Backlog review 2026-09-05 18:25

- **Status:** done
- **Window:** a288c69..9052efe
- **Log:**
  - 2026-09-05 18:25 shipped: GC-010 (one `shortcuts.ts` table, `matches(id, e)`, the `?`
    overlay, 30 unit tests), GC-028 (offscreen stealth launcher `tools/launch-app.mjs`,
    `foreground.ps1`), GC-029 (per-prompt `required`), GC-034 / GC-037 / GC-038 (Escape closes
    one layer, decided once in `App.tsx` from a capture-phase listener), and GC-035, which landed
    at 18:19 while this review was running: the window was extended to it and its two
    follow-ups GC-040 and GC-041 were read for deduplication (GC-041 is the `--keep-alive` /
    `--keep-running` mismatch this review had also found). GC-035 was `in-progress` at the start
    of the review and was not touched. Read as a reviewer: the layer handler is sound — it
    returns without `preventDefault` for every key but Escape, so a modal's input keeps working,
    and the effect re-subscribing whenever `ui` changes is harmless; `escape` and `dialogCancel`
    are two table entries with the same predicate, one used inside the layer branch and one
    outside (cosmetic); `Shortcut.whileTyping` is set on seven entries and read nowhere (folded
    into GC-033); GC-010's test file is stored as binary because of a raw NUL byte, so its diff
    could not be reviewed and the working copy was read instead (GC-042). GC-028's launcher CLI
    killed every `electron.exe` unless `--keep-running` was passed; this review passed the flag
    so the worker's instances on 9333 and 9335 survived, and GC-035 has since narrowed the stop
    to `stopPort`. GC-037's second acceptance box is unticked with a written reason (no menu
    trigger exists while a diff is open); GC-043 would make that case testable. Every other
    acceptance box matches evidence in the ticket log. Template drift: GC-038 (done) has no
    `Depends on` line; GC-039 (todo) had none either and got one.
  - health: typecheck ok, tests 30 passed (3 files), build ok — in the detached worktree at
    94b7ea1 with `node_modules` junctioned from the main checkout. `npm run e2e` was not run: at
    94b7ea1 its prologue still called `killElectron()` and would have taken the worker's run
    down. From 9052efe on, `run.mjs` frees only its own port, so the next review can run
    `GITCLIENT_E2E_PORT=9336 npm run e2e` against its own scratch repository safely.
  - app: the worktree build ran offscreen on port 9334 against `%TEMP%/gitclient-review/e2e`
    (stopped afterwards by pid; the worker's instances were never touched). Screenshots in
    `%TEMP%/gitclient-review/GR-002/`, all looked at: `01-graph.png` (seven rows, lanes
    continuous, WIP row with `+1 ✎3 −1`, `main` absorbing `origin/main` with the cloud mark,
    chips truncating at 150px), `02-commit-selected.png` (merge commit: sha, refs, message box,
    author + date, two parent links, `+1 added`, file list), `03-wip-staging.png` (Unstaged 3 /
    Staged 2 with kind icons, commit form with the 72 counter), `04-diff.png` (two-hunk
    `big.txt` with Stage / Discard hunk, left panel collapsed to the icon rail with counts, the
    file highlighted in the detail panel) and `05-catena-feed-graph.png` (catena-feed loaded
    read-only: 881 commits, `Viewing 341`, 6 local and 52 remote branches, gravatars and
    initials mixed, tag chips, no lane break, 40 rows rendered for a 24,696px spacer). Against
    the study: row pitch 28px, header 22px, ref row 26px, detail header 36px all match
    `03-graph.md` / `04-panels.md`; left panel 220px against 215, chip 20px against 22 are our
    calibrated values. Every context menu was dumped over CDP: commit, checked-out chip, remote
    chip, tag chip, left-panel local and remote branch, remote group and WIP all match the
    study's core subset (remote-branch delete really is `push --delete` behind the confirm
    modal), but the file rows have no menu at all (GC-043); the left-panel filter works and
    updates `Viewing N`; the breadcrumbs are static (GC-044); the commit view has no
    working-directory banner (GC-045).
  - tickets: added GC-042 (P2, tests), GC-043 (P2, ui), GC-044 (P2, ui), GC-045 (P3, ui);
    extended GC-033 with the dead `whileTyping` flag; added the missing `Depends on` to GC-039.
    Board: GC-042 right after GC-024 (both small test hygiene, and it unblocks reviewing that
    file); GC-043 and GC-044 after GC-011, because automatic refresh is the larger everyday gap
    and both are half-day features; GC-045 after GC-033 with the other small P3s. GC-040 and
    GC-041 stay where the worker put them. Blocked GC-017 and GC-018 still wait on Ricardo's
    decisions; nothing new to unblock them.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through GC-035. Its launcher block in
    Commands lists `--port`, `--repo` and `--visible` but not the flag that keeps a running
    instance alive; GC-041 settles the flag's name and can add the line.
