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
| `in-progress` | Claimed by one session (a `GC` ticket or a `GR` review). Its presence tells every other run to exit. | The session that claims it |
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
2. **Lock check.** If any ticket or review (`GR-0NN`, see "Review routine") is `in-progress`
   anywhere in this file, exit without doing anything. Another run owns it. (If its claim line is older than six hours, mention it in the report so Ricardo can
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

Ready-to-paste routine prompt:

> Open `C:/Users/Ricar/Documents/apps/GitClient`. Read `CLAUDE.md`, then follow the
> "Routine protocol" in `TICKETS.md` exactly. If a ticket is already `in-progress`, exit and
> say so. Otherwise take one ticket through to `done` or `blocked`, committed and pushed on
> `main`, and report the ticket id, final status and commit shas.

## Review routine (hourly backlog reviewer)

A second scheduled session, `gitclient-backlog-review`, fires once an hour and plays product
owner. It never implements anything. It uses the same lock: if any `in-progress` line exists it
exits; otherwise it claims by adding a review ticket `GR-0NN` with status `in-progress` to the
Reviews section at the end of this file, commits and pushes that claim, and only then works.
Review tickets have no board row and are never picked by the ticket routine.

What a review does, time-boxed to about twenty minutes:

- Reads every `GC` commit since the previous review (`git log`, `git show`) as a reviewer:
  bugs, weak tests, scope creep, drift from `CLAUDE.md`, acceptance boxes ticked without
  evidence in the ticket log.
- Runs `npm run typecheck`, `npm test` and `npm run build`; any failure becomes a P0 bug ticket.
- Builds and launches the app on the e2e repo, screenshots the graph, a commit, the staging view
  and a diff into `%TEMP%/gitclient-review/GR-0NN/` (never into the repository), looks at them
  and compares against `docs/reference/gitkraken/`.
- Checks backlog hygiene: `blocked` tickets that can now be unblocked, `todo` tickets that are
  no longer concrete, wrong dependencies, board order.

It then adds zero to five `GC` tickets with the full template and a log line
`proposed by GR-0NN: <reason>`, may extend the scope of an existing `todo` ticket instead of
duplicating it, may reorder `todo` board rows (reason in the review log), and never changes
any status except its own review ticket's. It closes by setting the review ticket `done` with
a log of what shipped, health results, screenshots looked at and tickets added, updates the
"Done" paragraph of `CLAUDE.md` when needed, then commits `GR-0NN: backlog review` and pushes.

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
| GC-010 | Keyboard shortcuts overlay | ui | S | P2 | todo |
| GC-024 | Unit tests for prefs.ts | tests | S | P2 | todo |
| GC-025 | A readable error when git is not on PATH | main | S | P2 | todo |
| GC-019 | Only prompt on checkout when the changes are actually at risk | actions | S | P2 | todo |
| GC-020 | Keep the pinned branch's chip visible when chips fold | graph | S | P2 | todo |
| GC-022 | The +N refs dropdown is clipped by the graph scroll container | graph | S | P2 | todo |
| GC-011 | File-system watcher for automatic refresh | main | M | P2 | todo |
| GC-012 | Lazy loading past 2000 commits | graph | M | P3 | todo |
| GC-013 | Light theme | ui | M | P3 | todo |
| GC-014 | Side-by-side diff | diff | L | P3 | todo |
| GC-015 | Drag-and-drop merge and rebase between chips | graph | L | P3 | todo |
| GC-016 | Multi-tab repositories | ui | L | P3 | todo |
| GC-021 | The pin follows a renamed branch and is dropped with a deleted one | graph | S | P3 | todo |
| GC-023 | Chip shrinking still assumes exactly two chips | graph | S | P3 | todo |
| GC-027 | Author filter in commit search | graph | S | P3 | todo |
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

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-003
- **Why:** Shortcuts exist (arrows, Escape, Ctrl+Enter) but are undocumented in the app.
- **Scope:**
  - `?` (Shift+/) outside inputs and a Help entry open a modal listing every shortcut, grouped
    by area, generated from a single `shortcuts.ts` table so it cannot drift from the handlers.
  - Move existing key handling in `App.tsx` to read from that table.
- **Out of scope:** user-configurable bindings.
- **Acceptance:**
  - [ ] Every key handled in the app appears in the overlay.
  - [ ] Overlay closes with Escape and does not open while typing in the commit form.
- **Files:** new `src/renderer/src/shortcuts.ts`, `App.tsx`, `ui/Modal.tsx`, `app.css`.
- **Verify:** build, screenshot.
- **Log:**

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

- **Status:** todo
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
  - [ ] `npm test` covers all seven cases and passes.
  - [ ] Deleting the migration branch in `load()` fails at least one test.
- **Files:** new `src/renderer/src/prefs.test.ts`.
- **Verify:** `npm test`, `npm run typecheck`.
- **Log:**
  - 2026-09-05 proposed by GC-007 (this ticket): the migration and the per-field fallbacks were
    checked once by hand over CDP and have no regression guard.

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

---

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board and are never picked by the ticket routine; their
`in-progress` status is the same lock the worker respects. Each review appends its own section
here.
