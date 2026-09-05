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
| `in-progress` | Claimed by the running batch. Its presence tells every other worker run to exit; one batch sets it on several tickets at once. Reviews never use it. | The session that claims it |
| `done` | Implemented, verified, committed and pushed. | The session that finished it |
| `blocked` | Cannot proceed without a decision, a design or another ticket. Reason is in the log. | Anyone |

Ricardo can reopen a `done` ticket by setting it back to `todo` with a log line saying why.

## Routine protocol (for the scheduled session)

The routine fires every few minutes. Most runs do nothing. A run that finds work takes a
**batch** of tickets — one is a valid batch — and stays alive until every ticket in it is
`done` or `blocked`, committed and pushed on `main`.

The session that claims a batch is an **orchestrator**: it writes no ticket code itself. Each
ticket is implemented by its own subagent, in this one working tree, restricted to that ticket's
files. The orchestrator owns selection, claiming, all shared verification, both shared documents
and the commits. That division exists because the expensive checks are singletons — one `out/`
directory, one DevTools port, one scratch repository — so they can only be run once, centrally,
after the parallel work is in.

1. **Sync.** `git pull --ff-only origin main`. If the pull fails (network, authentication,
   non-fast-forward), stop and report; never work while pushes cannot land. Then
   `git status --porcelain` must be empty. If it is not, a previous run died mid-work: stop and
   report, do not clean up. The one exception is a tree holding exactly the unfinished work of a
   batch whose claim is already on `origin/main` — finishing that close-out is better than
   leaving its lock stranded, but say so in the report.
2. **Lock check.** If any ticket is `in-progress` anywhere in this file, exit without doing
   anything: a batch is running. (If its claim line is older than six hours, mention it in the
   report so Ricardo can inspect; still do not take it over.) Several `in-progress` lines at once
   are normal — a batch claims all of its tickets together.
3. **Select the batch.** Walk the board top to bottom, which is priority order. A row is
   eligible when it is `todo` and every ticket in its `Depends on` is `done`. Take the first
   eligible row, then keep walking and add a later eligible ticket **only if its `Files:` set is
   disjoint from every ticket already in the batch**. Any shared file and it waits for another
   run; never try to sequence two tickets over one file. `TICKETS.md` and `CLAUDE.md` never count
   toward a file set, because the orchestrator is their only writer. Stop at six tickets, or at
   one if the first eligible ticket is size L. If nothing is eligible, exit. Report which
   eligible tickets were skipped and on which file each collided.
4. **Claim the batch, commit, push.** For every ticket in the batch set the section to
   `in-progress`, update the board row, append a log line `YYYY-MM-DD HH:MM claimed`, then commit
   only that change and push it: `git commit -am "GC-0NN, GC-0MM, ...: claim" && git push origin main`.
   This is the first commit of every working run; the lock is on `main` before any code changes
   exist. If that push is rejected as non-fast-forward, another run claimed first:
   `git reset --hard origin/main` discards the unpublished claim, then stop and report.
5. **Dispatch**, one subagent per ticket, all in parallel, in a single message. Each is given its
   ticket's Why / Scope / Out of scope / Acceptance verbatim, **the list of files it owns**, and
   these bans: nothing outside its file list (other agents are editing this same tree); no
   `TICKETS.md` or `CLAUDE.md` edits — it reports the stale wording instead; no `npm run build`,
   no e2e, no app launch, because those are the singletons the orchestrator runs centrally; no
   git write commands, it leaves its work uncommitted. It **may** run `npm run typecheck` and
   `npm test`, which are safe concurrently — a typecheck error in a file it does not own is
   another agent's work in flight, not its problem. Do not give agents separate worktrees:
   disjoint ownership in one tree is what makes a single central build and one e2e run possible.
6. **Verify centrally**, serialized, once every agent is done. Read each agent's diff and confirm
   it stayed in its lane and did what it reported; `git status --porcelain` must show only files
   the batch owns. `npm run typecheck && npm run build` and `npm test` always, once for the whole
   batch. `npm run e2e:setup && npm run e2e` when any ticket touches `git.ts`, `ipc.ts`, actions
   in `App.tsx` or the DetailPanel, or `tools/e2e/*`. For tickets needing the running app, launch
   through `node tools/launch-app.mjs`, drive it over CDP, screenshot into `docs/screenshots/`
   and look at it — batching several tickets into one launch. Re-run any mutation or destructive
   check an agent reports, rather than ticking a box on its word. If a shared check fails and the
   cause is not obvious, bisect by reverting one ticket's files at a time, not the batch. Tick
   acceptance boxes only for items actually checked; when a criterion had to be checked by a
   different method than its Verify line names, say which and why in that ticket's log.
7. **Reflect.** Before closing, list what you noticed during the work that needs fixing or
   deserves work but was outside scope: bugs, missing tests, UX gaps against the GitKraken
   study, convention drift from `CLAUDE.md`. Add each as a new `todo` ticket with the full
   template, a board row at the position its priority deserves (bugs are P0 or P1) and a log
   line `proposed by GC-0NN (this ticket): <reason>`. Deduplicate first: if an existing ticket
   already covers it, add the evidence to the log of the ticket you were working on and name
   that id instead of filing a duplicate. Zero new tickets is fine; never more than three per
   run, whatever the batch size.
8. **Close out, commit, push.** Each ticket independently becomes `done`, or `blocked` with a
   one-line reason — one failure never blocks the rest of the batch. Update each section status,
   each board row and each log line, naming the evidence (assertion counts, measured values,
   screenshot paths). Update `CLAUDE.md` once for the whole batch wherever a convention, command
   or the roadmap changed. Then `git add -A && git commit -m "GC-0NN, GC-0MM, ...: <summary>" && git push origin main`.
   Intermediate commits are fine; the final one must leave no `in-progress` line anywhere in
   this file, and a claim commit must never be the last word on `main`.
9. **Report** the batch, each ticket's final status and evidence, the commit shas, the eligible
   tickets skipped and why, any tickets added in step 7, and anything that could not be verified
   as specified.

**Editing this file's board table: never use a regex.** Split into lines, find the line starting
with `| GC-0NN |`, split it on `|`, replace the status cell (`cells[cells.length - 2]`), join
back. A regex built by string interpolation has silently corrupted this file before — the pipes
were parsed as alternation, so the pattern matched the title line instead of the board row,
appended to it, and still returned true from `test()`, leaving the board untouched with no error.
After any edit, grep the rows and status lines back and confirm they say what was intended.

Commit message format: `GC-0NN: <imperative summary>` for one ticket, `GC-0NN, GC-0MM, ...: <summary>`
for a batch. The routine never checks out another branch, never rewrites published history and
never force-pushes. Run every git command with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`:
pushing relies on a GitHub token already stored in Git Credential Manager, and an unattended run
cannot answer a sign-in window. If a push is rejected for authentication, leave the commits local,
say so in the report, do not retry.

Ricardo uses this machine while runs happen, often in a full-screen game. **Never steal focus.**
Never run anything in `tools/gk-recon/*.ps1` (`focus`, `rclick`, `shot`, `cursor`, `esc`) or
any other OS-level input or screenshot; drive and capture the app over CDP only. Launch the app
only through `node tools/launch-app.mjs` (stealth by default). **Never
`taskkill //F //IM electron.exe`** (GC-035): stop only what the run started, with `stopPort(port)`,
the `stop()` a `launchApp` resolves with, or `taskkill //F //T //PID <pid>` against a tree you
identified as yours — the reviewer's Electron runs on port 9334 and a machine-wide kill takes it,
and any `npm run dev` window, down with it.

Ready-to-paste routine prompt:

> Open `C:/Users/Ricar/Documents/apps/GitClient`. Read `CLAUDE.md`, then follow the
> "Routine protocol" in `TICKETS.md` exactly. If any ticket is already `in-progress`, exit and
> say so. Otherwise claim a batch of eligible `todo` tickets whose files do not overlap,
> implement them in parallel subagents, verify centrally, take each through to `done` or
> `blocked` committed and pushed on `main`, and report the batch, final statuses and commit shas.

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

What a review does, time-boxed to about twenty minutes. It is a product owner's pass, not only a
code reviewer's: the UI and "what should we build next" steps below get at least as much of the
budget as reading the diffs, because a session with an `in-progress` lock spends its whole time
on one ticket's code and nobody else is looking at the app as a whole or asking what belongs on
the board next.

- Reads every `GC` commit on `origin/main` since the previous review (`git log`, `git show`)
  as a reviewer: bugs, weak tests, scope creep, drift from `CLAUDE.md`, acceptance boxes ticked
  without evidence in the ticket log.
- Runs `npm run typecheck`, `npm test` and `npm run build` in the worktree; any failure
  becomes a P0 bug ticket.
- **Looks at the running app, broadly, not only at what the window's tickets touched.** Launches
  the worktree's build on its own scratch repo through `node tools/launch-app.mjs --port 9334`,
  and screenshots a representative spread: the graph, a commit, the staging view, a diff, and
  whichever panels, menus or modals the window's commits changed — plus, on a rotating basis so
  every surface gets revisited every few reviews even when nothing recently touched it, one it
  did not pick last time (a context menu, a popover, the Preferences dialog, an empty state, the
  left panel, a resize/reflow at a second window width). Screenshots land in
  `%TEMP%/gitclient-review/GR-0NN/` (never in the repository). Look at every one of them next to
  the matching `docs/reference/gitkraken/` screenshot and note, the way Ricardo reviews them
  himself (`CLAUDE.md`, "Working conventions"): lane continuity, chip behaviour, spacing, icon
  quality, truncation, alignment, density. A visual mismatch, an inconsistency between two
  screens, or a rough edge is worth a ticket on its own even when nothing is functionally broken
  — do not wait for a bug to justify a UI ticket.
- **Asks what's next, not only what broke.** Re-reads `docs/reference/gitkraken/06-feature-inventory.md`
  and the other study notes against the current `todo` board and the "State of the roadmap"
  paragraph in `CLAUDE.md`, and spends real attention on which GitKraken behaviour or UI polish
  detail closest to shipping would most improve the app next — not just gaps that happen to
  surface as a side effect of the code review. This is where most new tickets should come from.
- Checks backlog hygiene: `blocked` tickets that can now be unblocked, `todo` tickets that are
  no longer concrete, wrong dependencies, board order.

It then adds zero to five `GC` tickets with the full template and a log line
`proposed by GR-0NN: <reason>`, may extend the scope of an existing `todo` ticket instead of
duplicating it, may reorder `todo` board rows (reason in the review log), and never changes
any ticket that is `in-progress`, `done` or `blocked` (except to unblock one with a log
line). **At least one ticket per review should come from the UI/screenshot pass or the
what's-next pass above**, not only from the code-review pass, whenever either surfaced a
plausible candidate — say in the log when neither did rather than forcing a weak ticket to hit
the count. Its commit is `GR-0NN: backlog review`.

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
| GC-030 | Commit search loses its query and results when a diff opens | graph | S | P2 | done |
| GC-031 | Push to a chosen remote when the repository has several | actions | S | P2 | done |
| GC-025 | A readable error when git is not on PATH | main | S | P2 | done |
| GC-019 | Only prompt on checkout when the changes are actually at risk | actions | S | P2 | done |
| GC-020 | Keep the pinned branch's chip visible when chips fold | graph | S | P2 | done |
| GC-022 | The +N refs dropdown is clipped by the graph scroll container | graph | S | P2 | done |
| GC-032 | Optional Author, Date and SHA columns in the graph | graph | M | P2 | done |
| GC-011 | File-system watcher for automatic refresh | main | M | P2 | done |
| GC-060 | Unattended launches write to Ricardo's own app profile | infra | S | P1 | done |
| GC-063 | Unit tests for the watcher's ignore and scope rules | tests | S | P1 | done |
| GC-065 | Two of the study's screenshots show the desktop, not GitKraken | infra | S | P1 | done |
| GC-043 | Context menu on file rows in the detail panel | ui | M | P2 | done |
| GC-044 | Recently opened repositories from the repository breadcrumb | ui | M | P2 | done |
| GC-067 | The recents dropdown shrinks the folder name to one letter and shows the path in full | ui | S | P1 | done |
| GC-068 | A watcher reload that finishes late overwrites a fresher snapshot | actions | M | P1 | in-progress |
| GC-075 | A hunk button acts on the previous diff while the new one loads | diff | S | P1 | in-progress |
| GC-076 | Every e2e run leaves a commit behind, and the fixture eventually breaks step 16 | tests | S | P1 | in-progress |
| GC-049 | Branch context menu is missing its tip-commit actions, mainly Reset | ui | M | P2 | todo |
| GC-061 | A detached HEAD has no marker in the graph | graph | S | P2 | todo |
| GC-069 | The body preview takes width from the summary in a narrow message column | graph | S | P2 | todo |
| GC-072 | Show in folder is offered on a file the commit deleted, and always fails | ui | S | P2 | todo |
| GC-062 | The e2e suite never commits through the commit form or stages a hunk | tests | S | P2 | done |
| GC-064 | An e2e:setup on the shared scratch root wipes a run already using it | tests | S | P2 | todo |
| GC-050 | Resizable left and detail panels, widths remembered | ui | M | P2 | todo |
| GC-073 | Hide and Solo branches in the graph from the left panel | graph | M | P2 | todo |
| GC-012 | Lazy loading past 2000 commits | graph | M | P3 | todo |
| GC-013 | Light theme | ui | M | P3 | todo |
| GC-014 | Side-by-side diff | diff | L | P3 | todo |
| GC-015 | Drag-and-drop merge and rebase between chips | graph | L | P3 | todo |
| GC-016 | Multi-tab repositories | ui | L | P3 | todo |
| GC-021 | The pin follows a renamed branch and is dropped with a deleted one | graph | S | P3 | todo |
| GC-023 | Chip shrinking still assumes exactly two chips | graph | S | P3 | done |
| GC-036 | The e2e prologue leaves the named stash a run that dies mid-scenario creates | tests | S | P3 | done |
| GC-053 | e2e waits on the DOM instead of fixed sleeps | tests | S | P3 | done |
| GC-046 | A DOM environment so components can be unit tested | tests | M | P3 | done |
| GC-047 | A test that fails on a raw control byte in a source file | tests | S | P3 | done |
| GC-040 | A crashed e2e run leaves its own Electron alive | tests | S | P3 | todo |
| GC-041 | The launcher documents --keep-alive but checks --keep-running | infra | S | P3 | done |
| GC-054 | --keep-running still spawns a second Electron that cannot bind the port | infra | S | P3 | done |
| GC-059 | A test for the launcher attach path | tests | S | P3 | done |
| GC-055 | The scratch repo has no commit with more than two refs, so chip folding is untested | tests | S | P3 | todo |
| GC-070 | Tests for tools/ live under src/renderer/src | tests | S | P3 | done |
| GC-058 | A component test for the folded-refs dropdown flip | tests | S | P3 | done |
| GC-056 | The scratch repo's second remote is the same bare repo as origin | tests | S | P3 | todo |
| GC-057 | Toolbar Push and Pull cannot choose the remote | ui | M | P3 | todo |
| GC-027 | Author filter in commit search | graph | S | P3 | todo |
| GC-033 | Global shortcuts from the study: branch, fetch, panels, staging | ui | S | P3 | todo |
| GC-045 | Commit view banner linking back to the working directory changes | ui | S | P3 | todo |
| GC-051 | Left panel folders for slash-separated branch names | ui | M | P3 | todo |
| GC-052 | Diff view: next and previous hunk, ignore whitespace, word wrap | diff | M | P3 | todo |
| GC-048 | Long toolbar labels overflow their 52px button | ui | S | P3 | done |
| GC-066 | A second click on the repository crumb cannot close its dropdown | ui | S | P3 | done |
| GC-071 | The primary ref chip is unreadable at the minimum column width | graph | S | P3 | todo |
| GC-074 | The commit menu's Reset rows do not fit the menu, whichever side gives way | ui | S | P3 | todo |
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

- **Status:** done
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
  - [x] Editing a file in the e2e repo from a script updates the WIP row within a second.
  - [x] `git commit` from a terminal in the e2e repo adds the row without clicking.
  - [x] No refresh loop while the app itself stages or commits (check the status-bar spinner
    settles).
- **Files:** `src/main/index.ts` or new `src/main/watch.ts`, `ipc.ts`, `preload/index.ts`,
  `shared/types.ts`, `App.tsx`.
- **Verify:** e2e step driving external edits, CPU stays idle when nothing changes.
- **Log:**
  - 2026-09-05 21:10 claimed
  - 2026-09-05 21:45 done. New `src/main/watch.ts`: one `fs.watch(repo, { recursive: true })` per window
    (ReadDirectoryChangesW on Windows, so the one watcher on the working-tree root covers `.git/`
    too — no chokidar and no new dependency), a static ignore list, a 300ms debounce with the
    strongest scope winning, pushed as `repo:changed` over `webContents.send`. `repo:watch` points
    it, the preload subscription returns an unsubscribe, and `App.tsx` parks a change that arrives
    while `busy` is set and flushes it once when `busy` clears. `git check-ignore` is deliberately
    not used: every git call lives in `git.ts`, so the watcher stays pure fs.
  - 2026-09-05 21:45 the first implementation looped and central verification caught it: with the app idle on
    the scratch repo the renderer received a push roughly every 300ms forever (event count 52 ->
    67 after 5s -> 97 after a further 10s). A standalone `fs.watch` spy over 6 idle seconds showed
    exactly two events, 36 times each: `rename .git/index.lock` (already ignored) and `change .git`
    — the bare directory event, whose second path segment is empty, so the ignore list missed it
    and it scoped to `tree`. Our own `git status` creates and deletes `.git/index.lock`, Windows
    reports that as a change on `.git` itself, the renderer reloads the status, and that runs
    `git status` again. Fixed by dropping any event whose path is a single `.git` token; the
    one-level-deeper names already cover their own bare directory events. `.git/index` is not
    rewritten by a status, so it was never the trigger.
  - 2026-09-05 21:45 verified over CDP against the scratch repo with a listener armed on `onRepoChanged`:
    idle for 10s produces 0 events (was ~30); writing `gc011-watch.txt` from a shell put it in the
    WIP list inside a second with exactly one `tree` event (was 17) and the readout moving from
    "1 3 1" to "2 3 1"; `git commit` from a shell put "GC-011 watcher check" at the top of the
    graph with no click, on a `refs` event; "Stage all changes" through the UI added one event and
    the count was unchanged 15 seconds later with the spinner settled. The ticket's Verify line
    asks for an e2e step driving external edits: this batch did not own `tools/e2e/run.mjs`
    (GC-053 was rewriting it), so the three criteria were checked over CDP as above instead, and
    the watcher is exercised in the suite only implicitly. The e2e suite passed 66/66 three times
    with the watcher live — including while it was looping, which is why GC-063 was filed.

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

- **Status:** done
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
  - [x] An untracked-only tree checks out with no prompt and the file survives the checkout.
  - [x] A tracked modification still prompts.
  - [x] The e2e step 15 clean-tree assertion is extended with the untracked-only case.
- **Files:** `src/renderer/src/App.tsx` (`runCheckout`), `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`, plus `git status --short` before and after each path.
- **Log:**
  - 2026-09-05 proposed by GC-004 (this ticket): implementing the guard exactly as GC-004
    specified made an untracked-only tree prompt, which the e2e step 15 dirty case relies on and
    which is measurably noise in real use.
  - 2026-09-05 20:51 claimed
  - 2026-09-05 21:05 done. `runCheckout` now filters `status.entries` to the rows at risk —
    everything except an entry whose `staged` is null and whose `unstaged` is `untracked`, the exact
    shape `git.ts` pushes for an untracked file — and prompts only when that list is non-empty,
    naming its length in the message. e2e step 15 grew a middle case between the clean and dirty
    ones: an untracked-only tree checks out with no modal, HEAD moves and the file is still there
    afterwards. The dirty case now edits the tracked `feature.txt` and deliberately leaves the
    untracked guard file beside it, so `PASS the prompt counts the file at risk, not the untracked
    ones` on the message 'You have uncommitted changes in 1 file.' proves the count excludes
    untracked rows rather than just counting staging rows. The prologue and the step epilogue both
    restore `feature.txt`, so the suite stays re-entrant. `npm run e2e` was run three times, 66
    assertions passing each time (64 before this ticket). Noted deviation: the ticket asked for a
    count that 'matches what the detail panel shows'; the panel lists untracked rows too, so the
    message counts the files at risk instead — with no untracked file present, the ordinary case,
    the two are the same number.

### GC-020 Keep the pinned branch's chip visible when chips fold

- **Status:** done
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
  - [x] On a commit carrying HEAD, a tracking local and the pinned branch, the pinned chip is one
    of the two shown and its pin marker is visible without hovering.
  - [x] Unpinning restores the previous order.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`.
- **Verify:** build, screenshot of a commit with three or more refs, one of them pinned.
- **Log:**
  - 2026-09-05 proposed by GC-005 (this ticket): the pin marker is the only on-screen explanation
    for the leftmost lane, and the current chip order can hide it.
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. `rank` places the pinned local immediately after HEAD (`isHead` still
    short-circuits first, so a pinned checked-out branch stays first), and `pinnedName` joined the
    memo's dependency array. Verified over CDP against the scratch repo with two extra branches at
    main's tip — `aaa-tracks` tracking origin/main and `zzz-pinned` without an upstream — at the
    default 150px column: unpinned the visible chips are `main`, `aaa-tracks` with `zzz-pinned`
    folded into `+1` (the reported bug, and also the proof that unpinning restores the old order);
    pinned they are `main`, `zzz-pinned` with its pin marker rendered and `aaa-tracks` folded
    instead. Both branches were deleted and the pin key cleared afterwards. Note for GC-023: with
    three chips at 150px the names shrink to "ma..." and "z.", which is that ticket's shrink-weight
    bug, not this one's.

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

- **Status:** done
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
  - [x] Interrupting a run after step 5 and re-running it passes, with step 8 still asserting an
        empty stash list.
  - [x] A normal back-to-back `npm run e2e` still passes.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`, kill it after step 5 (or create the stash by hand with
  `git stash push -u -m "test stash"`), then `npm run e2e` again and read step 8.
- **Log:**
  - 2026-09-05 proposed by GC-029 (this ticket): adding the unnamed-stash guard to the prologue
    made the same gap for `test stash` obvious; it is the only remaining stash the suite can
    strand.
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. The prologue gained a third bounded stash guard next to the other two: it
    finds a leftover `test stash` by index in `git stash list` and pops it with `--index`, restoring
    the mixed working tree every later step asserts against instead of dropping it. Step 5's two
    `'test stash'` literals now share the guard's `NAMED_STASH` constant so they cannot drift.
    Verified by stranding the stash by hand (`git stash push -u -m "test stash"`, leaving the tree
    clean) and re-running the suite: it passed, step 8's `git stash list === ''` assertion held, and
    the list was empty at the end. Without the guard that entry would have survived step 8's pop and
    failed it. Two further back-to-back runs pass, 62 assertions each.

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

- **Status:** done
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
  - [x] The documented flag is the flag the code reads.
  - [x] Passing it against a busy port leaves the process on that port alone.
- **Files:** `tools/launch-app.mjs`.
- **Verify:** launch on a port, then launch again with the flag and confirm the first pid is still
  the one on that port.
- **Log:**
  - 2026-09-05 proposed by GC-035 (this ticket): the CLI's `killElectron()` call became
    `stopPort(port)` and the flag guarding it turned out not to be the one the header names.
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. The header now documents `--keep-running`, the spelling the code reads, and
    says what it does (skip the `stopPort` that frees the DevTools port). `--keep-alive` appeared
    nowhere else in the repository: `tools/e2e/run.mjs` imports `launchApp`/`stopPort` directly and
    never goes through the CLI arg block, so no caller needed changing. Verified by launching on
    port 9333 (pid 37948), launching again with `--keep-running` and finding pid 37948 still on the
    port, then launching once more without the flag and finding a different pid — so the flag is
    load-bearing in both directions. Noted while doing it: the flagged launch still spawns a second
    Electron that cannot bind the port and lingers; filed as GC-054.

### GC-054 --keep-running still spawns a second Electron that cannot bind the port

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P3
- **Depends on:** GC-041
- **Why:** `--keep-running` correctly skips `stopPort`, so the app already on the port survives —
  GC-041 verified that. But the CLI then spawns its own Electron anyway, which cannot bind the
  DevTools port that is already taken. The readiness probe is satisfied by the *other* app answering
  `/json`, so the launcher prints "app ready" and exits 0 while leaving a second, unreachable
  Electron process tree that nothing will ever stop. Observed while verifying GC-041: a four-process
  group had to be killed by hand with `taskkill //F //T //PID`. Every use of the flag leaks one such
  tree, which matters on a machine where the rule (GC-035) is never to kill Electron broadly.
- **Scope:**
  - With `--keep-running`, if the port already answers `/json`, attach to that app instead of
    spawning: skip the spawn, report which pid holds the port, and exit 0.
  - If the port does not answer, behave exactly as today.
- **Out of scope:** what the flag does about `stopPort`, new flags, and the `launchApp` module API
  that `tools/e2e/run.mjs` uses.
- **Acceptance:**
  - [x] With an app on the port, a `--keep-running` launch adds no new electron.exe process tree.
  - [x] The pid on the port is unchanged and the command still exits 0.
  - [x] With a free port the flag changes nothing about a normal launch.
- **Files:** `tools/launch-app.mjs`.
- **Verify:** launch on a port, count electron.exe trees with
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`, launch again with the flag, count
  again, then stop the one app narrowly.
- **Log:**
  - 2026-09-05 proposed by GC-041 (this ticket): verifying the flag left a stray four-process
    Electron tree that had to be killed by pid, the exact situation GC-035 exists to avoid.
  - 2026-09-05 20:51 claimed
  - 2026-09-05 21:05 done. `--keep-running` now takes an attach branch: a new module-local
    `attachTarget(port)` probes `/json`, returns null the moment the first probe is refused (port
    free, spawn as before), and otherwise waits for a `page` target — a booting Chromium answers
    `/json` before it lists one — then the CLI looks the pid up with the existing `pidOnPort`,
    applies `--repo` through `setRepo` if given, prints which pid holds the port and exits 0 without
    spawning. A failed pid lookup prints 'pid unknown' rather than failing the run. The exported
    module API (`launchApp`, `stopApp`, `stopPort`) is untouched, so `tools/e2e/run.mjs` cannot
    observe the change — and the e2e suite passed three times through it. Verified on port 9333 by
    counting `electron.exe` processes with `Get-CimInstance`: 4 before, 8 after a `--keep-running`
    launch on the free port (one tree, root pid 40292, 'app ready' as usual), then still 8 after a
    second `--keep-running` launch, which printed 'attached to the app already on port 9333 (pid
    40292)' and exited 0 — no process with a later CreationDate, and `netstat` showed the same pid
    holding the port. `stopPort(9333)` then took the count back to the 4 that were running before
    this session, which are not ours.

### GC-055 The scratch repo has no commit with more than two refs, so chip folding is untested

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `setup-testrepo.mjs` pushes only `main` with `-u`, so `feature` and `wip-branch` have no
  upstream and never absorb their remote chip. The busiest row in the scratch repo therefore carries
  exactly two chips, which is `chipBudget(150)` at the default width — nothing ever folds. The `+N`
  chip, its hover dropdown, the chip order and the shrink weights consequently have no e2e or
  screenshot coverage at all. Verifying GC-020 required creating two branches by hand first, and
  GC-023's acceptance ("four refs on one commit") cannot be checked against the fixture as it stands.
- **Scope:**
  - Give `setup-testrepo.mjs` one commit carrying four or more refs: a tracking local, a
    non-tracking local and a tag alongside the checked-out branch, named so the ordering is
    unambiguous.
  - Update any existing step in `run.mjs` whose expected branch, ref or left-panel count the new
    refs change.
- **Out of scope:** new assertions about folding itself (GC-020, GC-022 and GC-023 own those), and
  the e2e prologue.
- **Acceptance:**
  - [ ] A commit in the scratch repo carries at least four refs, so `+N` renders at 150px.
  - [ ] `npm run e2e` passes back to back and stays re-entrant.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e:setup && npm run e2e` twice, plus a screenshot showing a folded `+N`.
- **Log:**
  - 2026-09-05 proposed by GC-020 (this ticket): the acceptance case could not be reproduced against
    the fixture without adding two branches by hand, which showed the fold has no coverage.
  - 2026-09-05 23:14 GR-006: GC-023 was the second ticket to build the four-ref commit by hand (its 300px and
    400px measurements), and GC-071 now waits on this one; still P3 because nothing else is blocked.


## Adding a ticket

Copy a section, give it the next `GC-0NN`, fill every field, add a row to the board. A ticket
is only `todo` when its scope, acceptance criteria and verification steps are concrete enough
that a session with no other context could finish it. Otherwise mark it `blocked` and say what
decision is missing.


### GC-022 The +N refs dropdown is clipped by the graph scroll container

- **Status:** done
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
  - [x] On the last row of a full graph, the whole folded list is visible.
  - [x] On rows with room below, it still opens downwards.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** build, then measure the list's rect against `.graph-body`'s rect over CDP for a top
  row and a bottom row.
- **Log:**
  - 2026-09-05 proposed by GC-006 (this ticket): the width-aware fold folds more refs at narrow
    widths, and measuring the dropdown while checking that fold showed it clipped at the bottom.
  - 2026-09-05 20:51 claimed
  - 2026-09-05 21:05 done. `CommitGraph` holds `moreUp` (the sha of the row whose list is flipped)
    and decides the direction in `onMoreEnter` on every hover against live rects — the list is
    forced visible for one synchronous measurement and restored in the same task, since it is
    `display:none` until the `:hover` rule lands. It flips only when the list does not fit below
    *and* there is more room above, so a list taller than the body still opens on the side that
    shows most of it; keying by sha rather than a boolean is what makes it safe under
    virtualisation. `app.css` gains one rule setting `top: auto; bottom: 100%` on
    `.ref-chip.more .more-list.flip-up`. Verified over CDP against the scratch repository with
    `.graph-body` clamped to 140px and the folding row scrolled to each edge: at the bottom the
    list measures 188->222 inside a body of 106->246, `flipped=true`, clipped 0px; stripping the
    class in place and re-measuring the same row — the pre-fix drawing — puts it at 242->276,
    clipped 30px below the container, which is the counterfactual that proves the flip is doing
    the work. At the top of the body the same row reports `flipped=false`, opening downwards,
    clipped 0px. Screenshot taken with a real CDP hover and looked at:
    `docs/screenshots/gc022-more-list-flipped.png`. Note for GC-055: the scratch repository folds a
    ref on exactly one row and only below the default column width — this had to be measured at
    `refColW=100`, which is the gap GC-055 exists to close.

### GC-023 Chip shrinking still assumes exactly two chips

- **Status:** done
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
  - [x] At 400px nothing shrinks that did not have to.
- **Files:** `src/renderer/src/styles/app.css`.
- **Verify:** build, screenshot a commit with four refs at both ends of the width range.
- **Log:**
  - 2026-09-05 proposed by GC-006 (this ticket): raising the fold budget above two made the
    two-chip assumption baked into the shrink rule visible.
  - 2026-09-05 22:08 claimed
  - 2026-09-05 22:50 done, with the first acceptance box left unticked on purpose. The rule is now
    `.ref-chip:not(:first-child):not(.more)`. Measured over CDP on a commit given four refs in the
    scratch repository, comparing the shipped rule against the old one injected back into the live
    page: at a 300px ref column, where four chips are visible, the new rule leaves the primary
    chip's name whole (`.chip-name` clientWidth 29 of scrollWidth 29) while the three behind it
    give way together (53/122, 71/164, 31/91); the old rule truncated the primary chip to 11 of 29
    and crushed the second to 0, leaving the third and fourth at 126px and 86px — exactly the bug
    the ticket describes. At 400px nothing shrinks: every chip renders at its natural width with no
    overflow on the column. Screenshots `docs/screenshots/gc023-chips-300.png` and
    `gc023-chips-400.png`. Note for anyone re-measuring: do not zoom a panel to read the chips, as
    `zoom` on `.graph-panel` shrinks its internal layout width and fakes a truncation that is not
    there — read `.chip-name`'s `scrollWidth` against its `clientWidth` instead.
  - 2026-09-05 22:50 the "at 100px" criterion cannot be met and does not belong to this rule. At
    100px `chipBudget` allows one chip, so the row is the primary chip plus `+3` and there is
    nothing for a shrink weight to redistribute: the name measures 17 of 29 px, identically before
    and after this change. Verified at 300px instead, where four chips are actually visible, and
    the 100px case is filed as GC-071.

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

- **Status:** done
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
  - Tell a missing repository folder apart from a missing git (GR-003): Node reports the same
    `spawn git ENOENT` when the `cwd` handed to `spawn` does not exist as when the binary is
    missing, so a `gitclient.lastRepo` whose folder was moved, deleted or mistyped shows the
    git message and the status bar shows the dead path as the repository name. `runGit` (or
    `openRepo` before its first call) checks `existsSync(cwd)` first and rejects with a
    `GitError` naming the folder, for example "Repository folder not found: <path>", and the
    startup `git --version` probe runs with a `cwd` that always exists (the app directory or
    the home directory) so it cannot be confused by a stale last-repository path.
- **Out of scope:** bundling git, or a setting for a git path (a separate ticket if wanted).
- **Acceptance:**
  - [x] Launching with a PATH that has no git shows the named message, not `spawn git ENOENT`.
  - [x] With git present, startup is unchanged and costs one `git --version`.
  - [x] `gitclient.lastRepo` pointing at a folder that does not exist shows the folder
    message, not `spawn git ENOENT`, and the empty state still offers "Open repository...".
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, launch once with a stripped PATH and once normally.
- **Log:**
  - 2026-09-05 proposed by GC-007 (this ticket): hit `spawn git ENOENT` twice while driving the
    built app over CDP and had to read the source to work out that PATH was the cause.
  - 2026-09-05 scope extended by GR-003: loading a path with its backslashes stripped (a scripting
    slip) showed `spawn git ENOENT` in the empty state and the status bar although git was on
    PATH and had just loaded another repository; a dead folder and a missing binary need two
    different messages, and GC-044 will hand this code stale paths on purpose.
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. `runGit` rejects with "Repository folder not found: <path>" before spawning when
    `cwd` is missing, and maps a spawn ENOENT to the new `GIT_MISSING_MESSAGE`; `checkGit()` runs one
    `git --version` in the home directory at startup, exposed as the argument-less `repo:checkGit`
    channel; `App` keeps it in `gitError`, which replaces the empty state's prompt line and is
    de-duplicated against `error`, and `load()`'s catch now clears `repoPath` so the status bar
    stops naming a path that did not load. Verified by launching the built app stealthily twice and
    reading the DOM over CDP: with git removed from PATH the empty state and status bar both carry
    the named sentence, `Open repository…` is still there and the page contains no "ENOENT"
    (screenshot `docs/screenshots/git-missing-empty-state.png`); with git present and a
    `gitclient.lastRepo` that does not exist, the message is the folder one, the prompt line is
    unchanged and the status bar reads "No repository open". Also typecheck, build, `npm test`
    (39 pass) and `npm run e2e` (62 assertions), which exercises the normal startup path.

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

- **Status:** done
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
  - [x] Search "feature", click a file of the selected commit, close the diff: the bar shows
    "feature", the same "1 of 3" readout and the same dimmed rows.
  - [x] e2e step 16 gains that round trip, asserting `searchState()` before and after.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/graph/CommitGraph.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e`.
- **Log:**
  - 2026-09-05 proposed by GR-001: the query is component state in a component that unmounts
    behind the diff view; noticed while reading GC-009's `CommitGraph.tsx`.
  - 2026-09-05 19:06 claimed
  - 2026-09-05 19:35 done. `query` moved into `App`'s `search` state next to `open` and `tick`,
    passed down as `searchQuery` + `onSearchQuery`; `closeSearch` is now the only thing that clears
    it, so `CommitGraph` no longer clears on unmount. `lastNeedle` is still seeded from the first
    render's needle, so a remount with an unchanged query re-selects nothing. The toolbar button
    with a diff open closes the diff and reopens/refocuses the bar instead of closing the search,
    and Escape with a diff open now closes the diff first (the bar is hidden behind it) rather
    than a search the user cannot see. e2e step 16 gained the round trip: open the first file of
    the selected commit, assert the bar is gone with the graph, Escape, assert value, readout,
    selection and the rendered match/dim counts are identical — compared from a fixed scroll
    position through a new `searchStateAtTop()` helper, because the rows are virtualised. Verified:
    `npm run typecheck`, `npm run build`, `npm test` (37 pass), `npm run e2e` twice (63 assertions,
    all pass, still re-entrant), and a stealth launch driven over CDP for
    `docs/screenshots/search-survives-diff.png`, which shows "feature", "1 of 3", three matched
    rows and the rest dimmed after the diff was closed from the toolbar button.

### GC-031 Push to a chosen remote when the repository has several

- **Status:** done
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
  - [x] With `origin` and a second remote, the branch menu lists a push entry per remote and each
    pushes there (`git ls-remote <remote> <branch>` shows the sha).
  - [x] Tag push with remotes `alpha` and `origin` lands on `origin` by default.
  - [x] e2e step 17 (remotes) pushes a branch to the added remote before removing it.
- **Files:** `src/renderer/src/App.tsx`, `src/main/git.ts`, `src/renderer/src/components/Toolbar.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm run e2e`, `git ls-remote` on the bare
  remotes of the scratch repo.
- **Log:**
  - 2026-09-05 proposed by GR-001: GC-008 shipped remote management while every push path still
    hard-codes a single remote, and the tag path picks a different one from the branch path.
  - 2026-09-05 20:35 claimed
  - 2026-09-05 20:45 done. The remote choice moved into `src/shared/remotes.ts` as
    `defaultRemote(remotes)` (origin, else the first), imported by `git.ts push` and by `App`, so
    the menu labels and the push it performs can no longer disagree. `refMenuItems` now emits one
    "Push <branch> to <remote>" entry per remote, in its own separated group, when the repository
    has several (the single-remote label is unchanged), the tag menu emits "Push tag <name> to
    <remote>" per remote and otherwise uses `defaultRemote` instead of `remotes[0]`, and the
    toolbar Push title reads "Push to <remote> and set upstream" when the branch has no upstream.
    Verified: typecheck, build, `npm test` 44 passing (up from 39 — `src/shared/remotes.test.ts`
    covers `defaultRemote`, including the alpha-versus-origin pair this ticket names;
    mutation-checked by reverting the helper to `remotes[0]`, which fails that case).
    `npm run e2e` 64 assertions all passed, up from 62: step 17 now creates a scratch
    `push-target` branch, checks the menu lists "Push push-target to origin" and "…to upstream",
    clicks the upstream entry and asserts `git ls-remote upstream push-target` carries the sha,
    then deletes the branch on both sides (the prologue drops it too, so the run stays
    re-entrant). The `alpha` ordering premise was confirmed directly in the scratch repo:
    `git remote` lists `alpha` before `origin`, so the old `remotes[0]` tag push really did pick
    the wrong one. Screenshot of the two-remote branch menu in
    `docs/screenshots/gc-031-push-per-remote.png`, looked at; the toolbar title was read over CDP
    with `main`'s upstream temporarily unset in the scratch repo ("Push to origin and set
    upstream") and restored afterwards.

### GC-056 The scratch repo's second remote is the same bare repo as origin

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** e2e step 17 adds a second remote (`upstream`, later renamed `mirror`) pointing at
  `<root>/remote.git` — the very repository `origin` already points at. Every per-remote
  assertion is therefore blind: GC-031's new "the chosen remote received the branch" check reads
  `git ls-remote upstream push-target`, which would pass just as well if the push had gone to
  `origin`, because both names resolve to the same bare repository. The same blindness covers the
  fetch assertion and anything GC-057 adds later. A distinct second bare repo makes the
  difference observable.
- **Scope:**
  - `setup-testrepo.mjs` creates a second bare repository `<root>/remote2.git` alongside
    `remote.git`, with nothing pushed to it, and does not add it as a remote (step 17 still adds
    the remote through the UI, which is the thing it is testing).
  - `run.mjs` step 17 adds `upstream` pointing at `remote2.git` instead of `remote.git`, and the
    "remote added and fetched" check drops the `refs/remotes/upstream/main` expectation (an empty
    bare repository has no branches) in favour of asserting the remote exists with the right URL.
  - The GC-031 push assertion becomes exclusive: after pushing `push-target` to `upstream`,
    `git ls-remote upstream push-target` carries the sha **and** `git ls-remote origin
    push-target` is empty. Clean-up deletes it from `remote2.git` only.
- **Out of scope:** a third remote, pull from a chosen remote, changing any other step.
- **Acceptance:**
  - [ ] `npm run e2e:setup` creates `<root>/remote2.git` as an empty bare repository.
  - [ ] Step 17 passes with the exclusive assertion (the sha on `upstream`, nothing on `origin`).
  - [ ] Pointing that push back at `origin` in `App.tsx` fails the assertion (mutation check).
  - [ ] The run stays re-entrant: a second `npm run e2e` straight afterwards passes unchanged.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e:setup && npm run e2e` twice in a row, then the mutation check above.
- **Log:**
  - 2026-09-05 proposed by GC-031 (this ticket): the per-remote push assertion GC-031 added
    cannot tell the two remotes apart, because step 17 points both at the same bare repository.

### GC-057 Toolbar Push and Pull cannot choose the remote

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** GC-031
- **Why:** GC-031 gave the branch and tag context menus one push entry per remote, but the
  toolbar still has a single Push button that always uses the upstream, or `defaultRemote` when
  there is none — it now names that remote in its title, which is honest but still offers no way
  to change it. Pull is in the same position: `pull(cwd, mode)` takes no remote at all and its
  caret popover only chooses ff / ff-only / rebase. The study
  (`docs/reference/gitkraken/05-menus-shortcuts.md`) has both as split buttons whose popover
  lists the remotes. A user with two remotes has to go through the left panel for every push.
- **Scope:**
  - Push becomes a split button like Pull: a caret opening a popover that, with several remotes,
    lists "Push to <remote>" per remote (setting the upstream when the branch has none). With one
    remote the caret stays hidden, so nothing changes for the common case.
  - `pull` takes an optional remote (`git pull <flag> <remote> <branch>` when given, today's
    argument-free form otherwise), threaded through `ipc.ts` and the preload; the Pull popover
    gains a "Pull from <remote>" row per remote below the existing mode rows, separated.
  - The Push popover joins `layerOpen` in `App.tsx` the way the Pull popover already does
    (GC-038), so Escape still closes exactly one layer.
- **Out of scope:** "push to all remotes", remembering the last remote used, a remote picker
  dialog, changing what either button does when the repository has one remote.
- **Acceptance:**
  - [ ] With two remotes, the Push caret lists both and each pushes there (`git ls-remote`).
  - [ ] With one remote, neither button gains a caret it did not have.
  - [ ] Pull from a named remote reaches `git pull <flag> <remote> <branch>`.
  - [ ] Escape with either popover open closes only it, the find bar keeping its query (the
    GC-039 guard extended to the Push popover).
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/App.tsx`,
  `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm test && npm run e2e`, plus a CDP
  screenshot of each popover with two remotes.
- **Log:**
  - 2026-09-05 proposed by GC-031 (this ticket): GC-031 fixed the context menus and left the
    toolbar with one hard-coded remote for push and no remote at all for pull.

### GC-032 Optional Author, Date and SHA columns in the graph

- **Status:** done
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
  - [x] Toggling each column in Preferences adds or removes it live, and the choice survives a
    reload.
  - [x] With all three on, the rows stay 28px, the graph SVG width is unchanged and the message
    column still truncates instead of widening the window.
  - [x] Screenshot at 1400x900 with all three on, looked at against `02-main-1080.png`.
- **Files:** `src/renderer/src/prefs.ts`, `src/renderer/src/components/Preferences.tsx`,
  `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** typecheck, build, `npm test` (a prefs test if GC-024 has landed), screenshot.
- **Log:**
  - 2026-09-05 proposed by GR-001: the study's optional graph columns are the largest visible gap
    between the two graphs that no ticket covers.
  - 2026-09-05 21:10 claimed
  - 2026-09-05 21:45 done. Prefs gained `graphColumns { author, date, sha }` (all off, validated per column in
    `load()`, with a `defaults()` helper because it is the first nested value and the two
    `{ ...DEFAULT_PREFS }` spreads would otherwise share the exported object); a "Graph" group in
    Preferences with the three toggles; `CommitGraph` renders AUTHOR / DATE / TIME / SHA after the
    message at 140/150/80px, `flex: none`, 12px in 60% white, sha in the mono face, the WIP row
    leaving them empty. Verified over CDP against the scratch repo at 1400x900: with all three on
    the row height is still 28px and the graph SVG still 76px wide, the message column goes
    604px -> 234px (exactly the 370px the three columns declare, so nothing widened the window)
    and `.graph-body` does not scroll horizontally (780 == 780); cells read "Test User",
    "05/09/2026, 21:32" and a 7-character sha, the WIP cells are empty. Toggling in Preferences
    adds the columns live and removing them live restores the three original headers and the 604px
    message column; the choice survived a reload (blob read back from `gitclient.prefs`).
    Screenshot `docs/screenshots/graph-columns.png`, looked at against the study's column table in
    `03-graph.md`: labels uppercase at low opacity to the right of the message, message still
    truncating with an ellipsis. `npm test` 48 passed (a new `prefs.test.ts` case covers the
    default, the per-column fallback and that the fallback is a copy).
  - 2026-09-05 21:50 on the screenshot comparison, precisely: `02-main-1080.png` has the optional
    columns switched off (its header is BRANCH / TAG, GRAPH, COMMIT MESSAGE and then the settings
    cog), so it could only confirm the header treatment — uppercase, low-opacity, left-aligned
    labels on the same 22px header row — which ours matches, and the 28px row pitch. It cannot
    show what GitKraken's AUTHOR / DATE / TIME / SHA cells look like, so the cell widths, the 12px
    60% text and the date format are our own values from the study's column table in `03-graph.md`,
    not a match against that image.

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

- **Status:** done
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
  - [x] Right-click on an unstaged, a staged, an untracked and a commit file row each show the
        right items; the item that does not apply (Unstage on an unstaged file) is absent, not
        disabled.
  - [x] Stage from the menu changes `git status --short`; Discard from the menu goes through the
        confirm modal and Cancel changes nothing.
  - [x] Copy file path puts the repository-relative path on the clipboard (read back with
        `navigator.clipboard.readText()` over CDP).
  - [x] The `shell:*` channels reject a path outside the repository.
  - [x] e2e step: stage `a.txt` from its row menu, assert `git status --short`, then unstage it
        the same way.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/main/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/shared/types.ts`,
  `tools/e2e/run.mjs`, `CLAUDE.md` (the IPC channel groups).
- **Verify:** typecheck, build, e2e, screenshot of the menu over the staging list.
- **Log:**
  - 2026-09-05 proposed by GR-002: dumping every context menu over CDP against the study showed
    the file rows as the only row type without one.
  - 2026-09-05 22:08 claimed
  - 2026-09-05 22:50 done. Every acceptance criterion checked against the running build on the
    scratch repository. Menus read back over CDP: an unstaged row gives
    `Stage file | Discard changes | --- | Open file | Show in folder | --- | Copy file path`, an
    untracked row the same with `Delete file`, a commit row only the last three, and a staged row
    `Unstage file | ...` with neither Stage nor Discard (that one from e2e step 19, the fixture
    having no staged file left by the time the CDP pass ran). The item that does not apply is
    absent, not disabled. Discard opened the confirm modal with the `✕` button's own wording
    ("This cannot be undone.", OK "Discard") and Cancel left `git status --short` untouched. Copy
    file path put `README.md` on the clipboard, read back with `navigator.clipboard.readText()`.
    The `shell:*` channels refused all four escapes tried — `../outside.txt`, an absolute
    `C:/Windows/System32/notepad.exe`, `../../` and `a.txt/../../escape.txt`, which traverses
    through a real file — each with "Path is outside the repository", and a path inside but absent
    with "File not found in the working tree". e2e step 19 stages and unstages `a.txt` from its row
    menu; the suite ran three times, all passing, 71 assertions including the four new ones, which
    also proves the step's cleanup is re-entrant. Screenshot
    `docs/screenshots/gc043-file-row-menu.png`, looked at: the menu reuses the existing
    `.ctx-menu` styling, so `app.css` needed no change at all.
  - 2026-09-05 22:50 two things found while verifying, neither in scope: the fixture has no commit
    that deletes a file, so "Open file is disabled on a deleted commit file" had to be checked
    against a throwaway commit built by hand (it is disabled — the menu came back
    `(disabled) Open file | Show in folder | --- | Copy file path`), and the "Show in folder"
    beside it is enabled but always fails. Both are GC-072.

### GC-044 Recently opened repositories from the repository breadcrumb

- **Status:** done
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
  - The title bar's `+` button (`TitleBar.tsx`, title "New tab") has no click handler today
    (GR-004, checked over CDP), so the one visible way to add a repository does nothing. Until
    GC-016 gives it tabs it opens this same recents menu, anchored at the button.
- **Out of scope:** favourites, a search box in the dropdown, the branch breadcrumb dropdown,
  multi-tab (GC-016 should reuse this list when it lands).
- **Acceptance:**
  - [x] After loading two repositories the crumb menu lists both, most recent first, and picking
        the other one loads it (status bar name and `Viewing N` change).
  - [x] The list survives a reload and never exceeds 10 entries.
  - [x] Picking a path that no longer exists shows the error and drops the entry.
  - [ ] Screenshot of the open dropdown looked at next to the study's `09-repo-dropdown.png` for
        layout only; the styling is ours.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/components/TitleBar.tsx`,
  `src/renderer/src/styles/app.css`, `CLAUDE.md` (the remembered-state keys paragraph).
- **Verify:** typecheck, build, then over CDP against the scratch repository and a second clone
  of it (loading a real repository read-only is fine, writing to one is not), reading
  `localStorage.getItem('gitclient.recentRepos')` back after each step.
- **Log:**
  - 2026-09-05 proposed by GR-002: the breadcrumb is inert and only one repository is remembered,
    where the study has a recents dropdown and a recents list on the new-tab page.
  - 2026-09-05 21:25 scope extended by GR-004: the title bar's `+` "New tab" button is inert; it
    opens the recents menu until GC-016 gives it tabs.
  - 2026-09-05 21:48 claimed
  - 2026-09-05 22:01 done, with the fourth criterion checked another way — see the line below.
    `gitclient.recentRepos` is maintained by `load()`, the repository crumb is a button opening the
    recents menu through `useUi().openMenu` anchored at its bottom-left corner, the title bar’s `+`
    opens the same menu, and the empty state repeats the list as clickable rows. Verified over CDP
    against the scratch repository and a second clone of it: after loading both, the menu read
    clone2 (disabled), testrepo, separator, Open repository… with the full path as each hint, and
    picking testrepo loaded it (crumb and status bar both changed to `testrepo 7 commits`, the list
    reordering to testrepo-first). Eleven seeded entries came back as 10 after a reload, newest first.
    Clicking a `C:/a` that does not exist showed `Repository folder not found: C:/a` in the status bar,
    dropped that one entry (10 to 9) and left `gitclient.lastRepo` pointing at the real repository, so
    GC-025’s behaviour is intact. Screenshots `docs/screenshots/gc-044-recents-dropdown.png` and
    `docs/screenshots/gc-044-empty-state-recents.png`, both looked at.
  - 2026-09-05 22:01 the fourth acceptance box is left unticked. It was checked against the study’s
    written measurements instead of the screenshot it names, because `09-repo-dropdown.png` does not
    show GitKraken’s repository dropdown at all — it shows Ricardo’s desktop at the moment of capture.
    Our layout was compared against `04-panels.md`’s recorded shape for those dropdowns (a list of
    recents, then an action row) and matches it; the one difference is that GitKraken groups the list
    under a "Recently opened" header, which our `MenuItem` has no concept of, while our empty state does
    carry that caption. Filed as GC-065.

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

- **Status:** done
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
  - [x] `npm test` runs both projects and passes, with the existing 37 node tests untouched.
  - [x] `npm run typecheck` passes with the new `.tsx` test included.
  - [x] The proof test fails if the Preferences avatars row stops calling `setPrefs`.
- **Files:** `vitest.config.ts`, `package.json`, new
  `src/renderer/src/components/Preferences.test.tsx`, `CLAUDE.md`.
- **Verify:** `npm test`, `npm run typecheck`, `npm run build` (the build must not pick up the
  new devDependencies).
- **Log:**
  - 2026-09-05 proposed by GC-024 (this ticket): writing the `prefs.ts` tests needed a React stub
    to reach a hook-only subscriber list, and three tickets have already deferred work for want of
    a DOM environment.
  - 2026-09-05 20:51 claimed
  - 2026-09-05 21:05 done. `vitest.config.ts` now declares two projects split purely by file
    extension: `node` (`src/**/*.test.ts`, no plugins) and `dom` (`src/**/*.test.tsx`, jsdom,
    `@vitejs/plugin-react`), sharing one hoisted alias map because a project config does not inherit
    the root `resolve`. devDependencies added: `jsdom@^30.0.1` (vitest peers it as `*`),
    `@testing-library/react@^16.3.3` (peers React 18 or 19, no Vite peer) and its required
    `@testing-library/dom@^10.4.1`; `jest-dom` was not needed. Nothing else in `package.json` moved.
    New `src/renderer/src/components/Preferences.test.tsx` renders the dialog, clicks the avatars
    row and asserts both `getPrefs().avatars` and the controlled input. `npm test` is 7 files / 45
    tests; `--project node` alone is still 6 files / 44, so the node project is provably untouched.
    `npm run typecheck` clean. Mutation-checked independently at close-out: replacing the toggle
    row's `setPrefs` call with a no-op fails `Preferences.test.tsx:45` (expected false, got true),
    and restoring left an empty `git diff` on `Preferences.tsx`. `npm run build` succeeds, a
    case-insensitive grep for jsdom or testing-library across `out/` is empty and `Preferences.test`
    appears 0 times in the renderer bundle, so the new devDependencies do not reach the build.
    `npm install` now prints a second `EBADENGINE` warning, for jsdom 30 on Node 25 — harmless,
    like vitest 5's.

### GC-048 Long toolbar labels overflow their 52px button

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `.tool-btn` is a fixed `width: 52px` with no rule on the label, so a label wider than
  the button simply spills out of it. Measured over CDP on a 1400px window: "Preferences" is 56px
  in a 52px button and starts 2px to the left of it, and its left edge sits 1px after the right
  edge of the "Shortcuts" label, so the two read as one word. The icons stay on their 52px grid
  while the text does not, so the label is no longer centred under its own icon, and a narrower
  window makes the overlap worse. GitKraken's toolbar buttons size to their label instead.
- **Scope:**
  - Let `.tool-btn` size to its content (a minimum width plus horizontal padding) instead of a
    fixed 52px, so every label stays inside its own button and its icon stays centred over it.
  - Keep the icon-above-label layout, the icon size and the active/disabled styling unchanged.
- **Out of scope:** hiding the labels at narrow widths, a toolbar overflow menu, changing which
  buttons the toolbar shows.
- **Acceptance:**
  - [x] For every `.tool-btn`, the label's rect is inside the button's rect, measured over CDP.
  - [x] Neighbouring labels have a visible gap at 1400px and at 1000px.
  - [x] A screenshot of the toolbar shows each icon centred over its own label.
- **Files:** `src/renderer/src/styles/app.css`.
- **Verify:** build, launch through `node tools/launch-app.mjs`, measure every `.tool-btn` and its
  label rect over CDP at two window widths, and look at a screenshot of the toolbar.
- **Log:**
  - 2026-09-05 proposed by GC-030 (this ticket): the screenshot taken to verify the search round
    trip showed "Shortcuts" and "Preferences" running together; measuring confirmed the labels
    overflow their fixed-width buttons.
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. `.tool-btn` is now `min-width: 52px` with `flex: none`, `padding: 0 6px`
    and `white-space: nowrap`, so short labels keep the old 52px grid and only wider ones grow.
    Measured over CDP: every label rect is inside its button, every icon is centred over its own
    label, and the tightest neighbouring pair is exactly the reported one, "Shortcuts | Preferences",
    now at a 12px gap ("Preferences" is a 55.7px label in a 67.7px button). The narrow-window
    criterion was checked by constraining the toolbar flex container to 1000, 800 and 600px rather
    than resizing the window, because an offscreen window rejects `Browser.setWindowBounds`; under
    all three the button keeps its width and the gap stays 12px, which is what `flex: none` is for.
    Screenshot `docs/screenshots/toolbar-labels.png` shows the three right-hand labels separated.

### GC-047 A test that fails on a raw control byte in a source file

- **Status:** done
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
  - [x] `npm test` passes on a clean tree.
  - [x] Putting a raw NUL back into any file under `src/` makes it fail, and the message names
    that file and the offset (mutation-check it, then revert).
  - [x] The walk skips `node_modules/` and `out/`, and the whole suite still runs well under a
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
  - 2026-09-05 20:12 claimed
  - 2026-09-05 20:34 done. New `src/renderer/src/repo-hygiene.test.ts` walks `src/` and `tools/` plus
    the three root markdown files, skipping `node_modules/`, `out/`, `dist/`, `.git/` and the binary
    extensions, and fails on any C0 byte that is not TAB or LF (CR included). It carries its own
    `/// <reference types="node" />` because `tsconfig.web.json` does not pull in the node types.
    Two tests: one guards the walk itself, one is the byte scan. `npm test` is 39 tests in ~240ms.
    Mutation-checked twice, once by the implementer and once independently at close-out: a scratch
    file written with `String.fromCharCode(0)` (byte dump confirming the NUL at offset 19) fails the
    suite with "src/renderer/src/__mutcheck.ts: control character (0x00) at byte offset 19"; after
    deleting it, 39 pass again.

### GC-049 Branch context menu is missing its tip-commit actions, mainly Reset

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** none
- **Why:** Ricardo right-clicked a local branch row in GitKraken's left panel (not the currently
  checked-out one) and got a menu whose middle group is entirely commit actions for that branch's
  tip commit: `Reset <checked-out branch> to this commit` with a Soft / Mixed / Hard submenu,
  Revert commit, Cherry pick commit, Create tag here / annotated tag here, Copy commit sha — this
  matches what was already recorded in `docs/reference/gitkraken/05-menus-shortcuts.md` (the
  "Branch chip" and left-panel-branch observations, lines 101-129): GitKraken's branch/chip menu
  is the branch-specific items (Checkout, Merge, Rebase, Rename, Delete, Pin to Left, ...) with the
  commit menu for the ref's tip commit merged in underneath. Our `refMenuItems`
  (`src/renderer/src/App.tsx:298`) only ever builds the branch-specific half; the tip-commit half
  that `commitMenuItems` (`src/renderer/src/App.tsx:350`) already implements — including the exact
  `resetItem('soft'|'mixed'|'hard', ...)` submenu Ricardo is missing — is never reused there. So
  today the only way to reset the checked-out branch to another branch's tip is to find that exact
  commit row in the graph and right-click it, which does not work when the branch's tip is not
  the row you clicked (e.g. after it has diverged, or its tip commit is scrolled out of the visible
  graph). The underlying git action, IPC channel and confirm-modal wiring already exist; this is a
  menu-composition gap, not new plumbing.
- **Scope:**
  - Extract the tip-commit action group out of `commitMenuItems` into a small helper (e.g.
    `tipCommitMenuItems(sha, shortLabel)`) that both `commitMenuItems` and `refMenuItems` call, so
    the wording and behaviour stay identical instead of being duplicated. It covers: Cherry pick
    commit, Revert commit, a separator, the Reset `<currentBranch>` to `<short sha>` submenu
    (Soft / Mixed / Hard, same hints and the same hard-reset confirm as today), a separator,
    Create tag here…, Copy commit sha — all keyed off the ref's `sha` field (`GitRef.sha`,
    `src/shared/types.ts:23`), not off a `Commit` object, since the ref menu is not given one.
  - In `refMenuItems`, for `r.kind === 'head'` (local branches; the currently checked-out one
    included, matching the study's screenshot of the menu on the checked-out chip), insert this
    group after the existing Checkout / Merge / Rebase block and before the Pin to Left /
    Rename / Push block, with a separator on each side.
  - Cherry pick and Revert stay disabled with no `currentBranch` (same guard `commitMenuItems`
    already uses); Reset stays available regardless (it targets `currentBranch`, which can be
    detached HEAD too — `target` already falls back to `'HEAD'`).
- **Out of scope:** remote-tracking branches and tags getting the same group (tags already have
  their own, narrower menu; remote branches would need their own decision, not bundled in here),
  Fast-forward as a distinct action, "Start a pull request", "Explain Branch Changes" and other AI
  features (GitClient has none and this ticket does not add any), "Create patch from commit" /
  "Share commit as Cloud Patch", "Create worktree from", Hide / Solo in graph, and the
  remote-aware push variants already covered by GC-031. Do not copy GitKraken's exact wording,
  icons or ordering beyond what the existing `commitMenuItems` already uses — CLAUDE.md's "study,
  never copy" rule applies to this menu too.
- **Acceptance:**
  - [ ] Right-clicking a local branch that is *not* checked out shows Reset `<current branch>` to
        `<its tip's short sha>` with a working Soft / Mixed / Hard submenu; picking Hard asks for
        confirmation the same way the commit-row Reset does.
  - [ ] `git status --short` / `git log` confirm the reset actually moved the checked-out branch's
        ref and left the working tree in the mode-appropriate state (soft: index unchanged, staged
        stays staged; mixed: index reset, working tree unchanged; hard: matches the target commit).
  - [ ] Cherry pick, Revert, Create tag here… and Copy commit sha on a branch row behave the same
        as their existing commit-row equivalents (verified against `git log` / clipboard).
  - [ ] Right-clicking the currently checked-out branch's own row/chip also shows the group
        (matches the study's screenshot of the checked-out `main` chip).
  - [ ] No behavioural change to the commit-row menu (still built from the same shared helper).
  - [ ] e2e step: right-click a non-checked-out local branch, Reset (mixed) to its tip via the
        menu, assert the checked-out branch's sha with `git rev-parse`.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, a screenshot of the branch-row menu next to the study's
  `06-context-menu-branch.png` / `20-context-menu-leftpanel-branch.png` for a side-by-side look.
- **Log:**
  - 2026-09-05 requested by Ricardo with a screenshot of GitKraken's left-panel branch menu;
    checked against the existing `docs/reference/gitkraken/05-menus-shortcuts.md` notes and the
    current `refMenuItems` / `commitMenuItems` split in `App.tsx` before writing this ticket.

### GC-050 Resizable left and detail panels, widths remembered

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-006
- **Why:** The study gives both side panels a drag handle: the left panel is 215px and resizes
  from its right edge, the detail panel is 400px and resizes from its left edge
  (`01-layout.md`, "Horizontal panels"; `04-panels.md`). Ours are two fixed tokens,
  `--left-panel-w: 220px` and `--detail-panel-w: 400px` in `tokens.css`, read by
  `.left-panel` and the detail panel in `app.css`, and nothing drags them; only the ref column
  inside the graph resizes (GC-006). On catena-feed loaded read-only at 1400x900 (GR-003's
  `05-catena-feed-wip.png`) sixteen of the visible branch names truncate at 220px
  ("(FEED-406)-payout-spe..."), while the detail panel spends 400px on a one-file staging list,
  and the user can trade neither for graph width.
- **Scope:**
  - Two 4px handles styled and driven like GC-006's `.col-resize`: on the right edge of
    `.left-panel` and the left edge of the detail panel, pointer capture, `col-resize` cursor,
    no text selection while dragging. Extract the drag into one hook
    (`src/renderer/src/ui/useDragWidth.ts`) that `CommitGraph` uses too, so there is one
    implementation of clamp, persist and double-click reset.
  - Widths live in `App` state and are written to `--left-panel-w` / `--detail-panel-w` on the
    app root; `tokens.css` keeps only the defaults. Clamp the left panel to 160-420px and the
    detail panel to 300-720px; double-click resets to the default.
  - Persisted on pointer-up as remembered state on their own keys, `gitclient.leftPanelW` and
    `gitclient.detailPanelW` (numbers of pixels, like `gitclient.refColW`), not in `prefs`.
  - While a file view is open the left panel is the 43px icon rail and its handle is not shown;
    the detail panel's handle keeps working there.
  - `CLAUDE.md`: the remembered-state paragraph and the tokens sentence.
- **Out of scope:** the vertical drag handle between left-panel sections, resizing the commit
  form, collapsing the detail panel (GC-033's Ctrl+K), a minimum window size.
- **Acceptance:**
  - [ ] Dragging the left handle 100px right makes `.left-panel` 100px wider and the graph panel
        100px narrower (rects measured over CDP); the same for the detail handle dragged left.
  - [ ] Reload keeps both widths; double-click on a handle resets it and removes its key.
  - [ ] Dragging past a clamp stops at the limit; the window never scrolls horizontally.
  - [ ] With a diff open the icon rail is still 43px with no handle, and the detail handle works.
  - [ ] Screenshot at 1400x900 with the left panel at 320px on catena-feed (read-only), looked at
        next to `08-left-panel-expanded.png` for layout only.
- **Files:** `src/renderer/src/App.tsx`, new `src/renderer/src/ui/useDragWidth.ts`,
  `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`, `CLAUDE.md`.
- **Verify:** typecheck, build, CDP rect measurements before and after each drag, reload, screenshot.
- **Log:**
  - 2026-09-05 proposed by GR-003: both side panels are draggable in the study and fixed here; on a
    real repository the left panel truncates most branch names with no way to widen it.

### GC-051 Left panel folders for slash-separated branch names

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** The study's expanded left panel folds branch names on their slashes: "Branch names
  with slashes group into collapsible folders", with remotes shown as folders and their branches
  nested one level deeper (`04-panels.md`, "Left panel expanded"; `08-left-panel-expanded.png`).
  `LeftPanel.tsx` groups remote branches by their remote (`r.name.split('/')[0]`) and lists
  everything else flat, so on catena-feed `origin/feat/prompt-lab-critique` is one row called
  `feat/prompt-lab-critique` among 52 siblings, and a repository using `feature/*`,
  `release/*` and `hotfix/*` gets one long list with the prefix repeated on every row.
- **Scope:**
  - Build a tree per section from the name segments: LOCAL, each remote under REMOTE (the remote
    row stays the first level) and TAGS. A folder row shows a chevron, a folder icon, the segment
    and the count of refs beneath it; leaf rows keep today's `ref-row` class, checked-out tint,
    ahead/behind badge, double-click checkout and context menu. 16px indent per level.
  - Folders start expanded; the collapsed set is component state keyed by
    `<section>/<folder path>` and lasts for the session only.
  - The filter matches the full ref name as it does now; while a filter is active every folder
    holding a match is shown open, and folders with no match are hidden with their rows.
  - "Viewing N" keeps counting refs, not folders. Stashes are unchanged.
- **Out of scope:** persisting the collapsed set, hide/solo toggles, the drag handle between
  sections, a folder context menu, drag-and-drop (GC-015).
- **Acceptance:**
  - [ ] With local `feat/a` and `feat/b` (created with git in the scratch repository, then
        Refresh), LOCAL shows a `feat` folder with count 2 and the rows `a` and `b` beneath it;
        clicking the chevron collapses it; double-clicking `a` checks out `feat/a`; right-clicking
        `a` opens the ref menu with "Delete feat/a".
  - [ ] Filter `b` shows only the `feat` folder, open, with `b`; clearing it restores the list.
  - [ ] Names without a slash render exactly as today.
  - [ ] e2e step: create the two branches with git, Refresh, assert the folder row and the nested
        rows, delete the branches; the prologue removes them if a run dies in between.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/styles/app.css`,
  `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, screenshot of catena-feed's REMOTE section (read-only)
  looked at next to `08-left-panel-expanded.png`.
- **Log:**
  - 2026-09-05 proposed by GR-003: the study folds slash-separated names into folders and ours lists
    them flat; catena-feed's remote already carries a `feat/` name and real repositories carry many.

### GC-052 Diff view: next and previous hunk, ignore whitespace, word wrap

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** GC-007
- **Why:** The study's file view toolbar has previous/next change arrows, an ignore-whitespace
  toggle and a word-wrap toggle next to the Hunk | Inline | Split modes (`04-panels.md`, "File
  view"). Our `DiffView` header has the file name, the counts, Stage file / Discard changes and
  the close button (GR-003's `04-diff.png`) and nothing else: a long line makes the whole
  `.diff-body` scroll sideways because `.hunk-lines .code pre` is `white-space: pre` with no
  alternative, a whitespace-only reformat shows every line as changed, and a file with many hunks
  is read by scrolling. Split view has its own ticket (GC-014); these three are independent of it.
- **Scope:**
  - Header buttons: previous hunk and next hunk (scroll the hunk's `.hunk-head` into view,
    wrapping around at the ends, disabled with one hunk or none), "Ignore whitespace" and "Wrap"
    toggles with a pressed state.
  - Both toggles persist as preferences `diffIgnoreWhitespace` and `diffWordWrap` (default
    `false`, validated in `load()`, two rows in Preferences under a "Diff" group), so the header
    and the dialog show the same value.
  - Wrap: a `.wrap` class on `.diff-body` switching the code cells to `white-space: pre-wrap`
    with `overflow-wrap: anywhere`; line numbers keep their column.
  - Ignore whitespace: `getCommitFileDiff` and `getWorkdirFileDiff` take an optional
    `{ ignoreWhitespace }` (type in `shared/types.ts`, validated in `ipc.ts`, passed through the
    preload) that adds `-w` to the diff command; the synthesised untracked-file diff ignores it.
    While it is on, Stage hunk / Discard hunk are disabled with a title saying the patch would not
    apply (a `-w` diff is not a valid input for `git apply`); Stage file, Discard changes and
    Unstage file keep working because they do not go through a patch.
- **Out of scope:** Split and Inline modes (GC-014), intra-line highlights, Blame and History,
  keyboard bindings for the new buttons (GC-033 owns the table), a per-file override.
- **Acceptance:**
  - [ ] On the scratch repository's two-hunk `big.txt`, next scrolls the second hunk header into
        view, next again returns to the first, previous goes back.
  - [ ] A file whose only change is trailing spaces (added by a script) shows its hunk with the
        toggle off and no hunks with it on, and the hunk buttons are disabled while it is on.
  - [ ] A 300-character line makes `.diff-body` scroll horizontally with Wrap off
        (`scrollWidth > clientWidth` over CDP) and not with it on.
  - [ ] Both toggles survive a reload and match their rows in Preferences; `prefs.test.ts`
        covers the two new fields' fallback.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/prefs.ts`, `src/renderer/src/prefs.test.ts`,
  `src/renderer/src/components/Preferences.tsx`, `src/main/git.ts`, `src/main/ipc.ts`,
  `src/preload/index.ts`, `src/shared/types.ts`, `CLAUDE.md` (Preferences list).
- **Verify:** typecheck, build, `npm test`, e2e, then the three CDP checks above and a screenshot
  of the header with Wrap on, looked at next to `04-diff-view.png` for layout only.
- **Log:**
  - 2026-09-05 proposed by GR-003: the study's file view toolbar has three small controls that need
    no new view mode, and ours has none of them; long lines currently scroll the whole diff body.

### GC-053 e2e waits on the DOM instead of fixed sleeps

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-030
- **Why:** `CLAUDE.md`'s Testing paragraph records that the suite waits on the status-bar spinner
  because a fixed sleep once caused a flake, yet `tools/e2e/run.mjs` at 766b4de has 58
  `await sleep(...)` calls, eleven of them added by GC-039's step 18 alone (300-400ms after
  every menu, prompt, popover and Escape). Each one is a bet that React and the CDP round trip
  finish inside the delay: they do on this machine today, and the reviewer's run on 9336 passed
  60/60 at 512ce06, but the review routine runs beside the worker's build and e2e, and a slower
  moment turns any of them into a flake that no assertion explains. The sleeps also add up to
  about twenty seconds of idle time per run. GC-030 already added the tool for this: a
  `waitFor(expression, what, max)` helper that polls the renderer every 100ms and records a
  failed check on timeout, used twice in step 16.
- **Scope:**
  - Use `waitFor` everywhere a sleep is waiting for a UI state: `.ctx-menu` present or gone,
    `.modal`, `.toolbar .popover`, `.graph-search` and its value, the selected row,
    `.file-view`, a file-row count. Where nothing observable changes, keep the sleep and say why
    in a comment on that line.
  - Let `waitFor` poll at 50ms so the common case settles faster than the sleeps it replaces.
  - The assertions and their count stay exactly as they are.
- **Out of scope:** new assertions, changes to `waitIdle`, running the suite in CI.
- **Acceptance:**
  - [x] `grep -c "await sleep(" tools/e2e/run.mjs` reports 10 or fewer, each with a comment.
  - [x] `npm run e2e` passes three times in a row with the same assertion count as before; the
        log line records the wall-clock of a run before and after.
- **Files:** `tools/e2e/run.mjs`, `CLAUDE.md` (Testing paragraph).
- **Verify:** `npm run e2e` three times.
- **Log:**
  - 2026-09-05 proposed by GR-003: the suite's own handover says fixed sleeps flaked once, GC-039 added
    eleven more, and GC-030 has since added the `waitFor` helper that makes replacing them cheap.
  - 2026-09-05 21:10 claimed
  - 2026-09-05 21:45 done. `await sleep(` went from 61 to 5, and each survivor carries a comment: the 50ms
    `waitFor` poll, the 150ms `waitIdle` poll, `waitIdle`'s 400ms post-spinner reload, `settle`'s
    own window, and one in step 16 where the sha-prefix query lands on the same single commit as
    the query before it so nothing observable changes. `waitFor` now polls at 50ms. The assertion
    count is byte-identical: 67 `check(` calls before and after, 66 assertions reported per run.
    `contextMenuOn` waits for the previous `.ctx-menu` to be gone before dispatching, which matters
    because a synthetic `contextmenu` fires no `mousedown` and so does not dismiss a menu that is
    still up — step 15 opens the same menu four times.
  - 2026-09-05 21:45 verified: `npm run e2e` passed 66/66 three times in a row on the final tree (45s, 44s,
    46s wall-clock), and three more times earlier in the run (44s, 44s, 45s). Baseline for the
    comparison, measured by putting HEAD's `run.mjs` back in place for one run on a clean scratch
    repo: 64s, also 66/66. So about 19s of idle time per run is gone, matching the ticket's
    estimate. `node --check tools/e2e/run.mjs` passes.
  - 2026-09-05 21:45 noted while measuring, evidence for existing tickets rather than new ones: a baseline run
    crashed on an unhandled ENOENT and left its Electron alive on port 9333, and the next run then
    died with "Detected unsettled top-level await" after 8 assertions — that is GC-040 exactly, now
    with a reproduction. Stopped with `stopPort(9333)`, never by image name.

### GC-058 A component test for the folded-refs dropdown flip

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-022, GC-046
- **Why:** GC-022's flip is decided in `onMoreEnter` from three live rects, and nothing automated
  guards it: it was verified once by hand, over CDP, against a graph body clamped to 140px and a ref
  column narrowed to 100px so that a single row folded at all. The e2e suite never folds a ref
  (GC-055), so a regression that stopped adding `flip-up` would ship silently. GC-046 has since given
  the suite a jsdom project, and the decision is pure geometry over rects, which jsdom can be made to
  report.
- **Scope:**
  - `src/renderer/src/graph/CommitGraph.test.tsx` in the `dom` project: render the graph with a
    commit carrying more refs than `chipBudget` allows, stub `getBoundingClientRect` on the chip, the
    list and `.graph-body` (jsdom returns zeroes otherwise), fire `mouseEnter` on the `+N` chip and
    assert the class.
  - Both directions: a chip near the container's bottom edge gets `flip-up`, one with room below does
    not, and the 'taller than the body' case opens on the side with more room.
- **Out of scope:** rendering the real CSS (jsdom applies no stylesheet, so the assertion is on the
  class, not on the computed `top`/`bottom`), testing the rest of `CommitGraph`.
- **Acceptance:**
  - [x] `npm test` passes with the new file in the `dom` project.
  - [x] Mutation-checked: forcing `setMoreUp(null)` unconditionally in `onMoreEnter` fails it.
- **Files:** new `src/renderer/src/graph/CommitGraph.test.tsx`.
- **Verify:** `npm test`, `npm run typecheck`, then the mutation check.
- **Log:**
  - 2026-09-05 proposed by GC-022 (this ticket): the flip shipped with no automated coverage at all,
    and the one check that exists is a hand-run CDP measurement needing the app built and launched.
  - 2026-09-05 21:48 claimed
  - 2026-09-05 22:01 done. `src/renderer/src/graph/CommitGraph.test.tsx` renders one commit carrying
    six refs so four fold into `+4` at the default 150px column, stubs `getBoundingClientRect` on
    `.graph-body`, the `+N` chip and the hidden `.more-list`, and asserts the `flip-up` class in three
    cases: room below, a chip 20px from the bottom edge, and a 500px list against a 400px body opening
    on whichever side has more room. Three things it had to do that the scope did not anticipate: fire
    `mouseOver` rather than `mouseEnter` (React synthesises `onMouseEnter` from the delegated event),
    install a no-op `ResizeObserver` for the virtualisation effect, and set `avatars: false` so the
    render makes no `crypto.subtle` call and no gravatar request. `npm test` is 68 tests over 10 files,
    the `dom` project now 4 tests over 2 files. Mutation check re-run centrally: forcing
    `setMoreUp(null)` in `onMoreEnter` fails two of the three (expected false to be true), and
    `git diff` on `CommitGraph.tsx` was empty again after the revert.

### GC-059 A test for the launcher attach path

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-054
- **Why:** `tools/launch-app.mjs` has no tests, and GC-054 put a decision in it that is exactly the
  kind that rots: with the DevTools port already answering, the CLI must attach and exit rather than
  spawn a second Electron nobody will stop. Verifying it costs a build, a launch and two process-tree
  counts today. The implementing agent proved the same behaviour in seconds against a fake CDP
  endpoint — a plain Node http server on an unused port serving one `page` target — which is a test
  that could live in the repository instead of in a scratch folder.
- **Scope:**
  - A test that stands up a throwaway http server answering `/json` with one `page` target, runs
    `node tools/launch-app.mjs --keep-running --port <that port>` as a child process, and asserts it
    exits 0, prints 'attached', and spawned no `electron.exe`.
  - A second case: with the port free, `attachTarget` returns null — asserted on the function, not by
    launching Electron. A unit test must never spawn the app.
  - It runs in the `node` project and must not need a build.
- **Out of scope:** testing `launchApp` itself or anything that starts Electron; the e2e suite stays
  the only thing that launches the app.
- **Acceptance:**
  - [x] `npm test` passes with the new file and starts no Electron process.
  - [x] Mutation-checked: removing the attach branch from the CLI fails it.
- **Files:** new `tools/launch-app.test.ts` (or a path under `src/` if `vitest.config.ts`'s include
  has to stay as it is — say which in the log), possibly `vitest.config.ts`.
- **Verify:** `npm test` with an `electron.exe` count before and after, then the mutation check.
- **Log:**
  - 2026-09-05 proposed by GC-054 (this ticket): the ticket's three acceptance criteria all needed a
    manual launch and `Get-CimInstance` counts, and a fake CDP endpoint proved the same thing in
    seconds without one.
  - 2026-09-05 21:10 claimed
  - 2026-09-05 21:45 done. The test is `src/renderer/src/launch-app.test.ts`, not `tools/launch-app.test.ts`:
    `vitest.config.ts`'s node project includes `src/**/*.test.ts` and `tsconfig.web.json` includes
    `src/renderer/src/**/*`, so `npm test` and `npm run typecheck` both pick it up with no config
    change — the same reason `repo-hygiene.test.ts` lives there. `vitest.config.ts` is untouched.
    It carries its own `/// <reference types="node" />`. Case one stands up an http server on an
    ephemeral port answering `/json` with one `page` target, runs the CLI with `--keep-running`
    against it, and asserts exit 0, "attached to the app already on port <n>", the target url, that
    "app ready" is absent, and that no `electron.exe` carries that port. Case two calls the
    module-private `attachTarget` against a free port and asserts null. `attachTarget` is reached
    through a byte-for-byte scratch copy of the launcher with one `export` appended, because this
    ticket did not own `tools/launch-app.mjs`; a one-line export there would let the copy go.
  - 2026-09-05 21:45 verified centrally: `npm test` 48 passed / 8 files, and 0 `electron.exe` on the machine
    afterwards. Mutation check re-run by the orchestrator rather than taken on trust: replacing
    `const running = await attachTarget(port)` with `const running = null` fails the attach case
    with "expected 'app ready on port ...' to contain 'attached to the app already on port ...'",
    and reverting restores `git hash-object tools/launch-app.mjs` to 4771249, HEAD's blob, with
    both cases green again. Do not mutate by deleting the whole `--keep-running` block: the CLI
    then falls through to `stopPort`, which would kill whatever holds the port.

### GC-060 Unattended launches write to Ricardo's own app profile

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P1
- **Depends on:** GC-028
- **Why:** Every launch of the built app, stealth or not, uses Electron's default `userData`
  (`%APPDATA%/gitclient`), so the worker's e2e runs on 9333, the reviewer's screenshots on 9334
  and Ricardo's own use of the app all read and write one `localStorage`. Three consequences
  were observed in GR-004: `gitclient.refColW` was `100`, left behind when GC-022 narrowed the
  ref column by hand to verify the flip, so GR-003's `01-graph.png` and GR-004's were taken at
  100px while both logs said 150px and the code's `chipBudget(150)` promises two chips (both
  screenshots show one chip plus `+1` on every ref row); every `--repo` launch rewrites
  `gitclient.lastRepo`, so Ricardo's next start opens whatever scratch repository or read-only
  real repository the last unattended run pointed at; and e2e step 1 already has to delete
  `gitclient.prefs` because a setting toggled by hand in an earlier session (GC-007 left
  `confirmDirtyCheckout` off) silently disabled whole steps. Screenshots that inform review
  decisions cannot be trusted while any earlier session can change what they show, and an
  unattended run must not touch the state the user sees.
- **Scope:**
  - `src/main/index.ts` honours a `GITCLIENT_USER_DATA` environment variable: when set,
    `app.setPath('userData', <that path>)` before `app.whenReady()`. Nothing else in the main
    process changes.
  - `tools/launch-app.mjs` sets it for every launch it makes to
    `<os.tmpdir()>/gitclient-profiles/<port>` (created if missing), so the worker (9333), the
    e2e suite (whatever `GITCLIENT_E2E_PORT` says) and the reviewer (9334) each keep a profile
    of their own that survives between runs on that port but never reaches Ricardo's. An
    explicit `GITCLIENT_USER_DATA` in the environment wins over the default. `--visible`
    launches are unattended too and get the same treatment; only a start outside the launcher
    (`npm run dev`, a packaged app) uses the real profile.
  - The launcher's header, `CLAUDE.md` (Commands, and the paragraph on remembered state) and
    the step 1 comment in `tools/e2e/run.mjs` say where the profile lives. Step 1 keeps
    deleting `gitclient.prefs`: the per-port profile persists across runs, so a stray setting is
    still possible, just no longer Ricardo's.
- **Out of scope:** clearing the whole profile per run (the persisted profile keeps the
  gravatar cache warm and costs nothing), a preference or CLI flag to pick the profile in the
  packaged app, migrating anything out of the current shared profile.
- **Acceptance:**
  - [x] After `node tools/launch-app.mjs --port 9334 --repo <scratch>`, the newest file under
        `%APPDATA%/gitclient/Local Storage/leveldb` is older than the launch, and
        `<tmpdir>/gitclient-profiles/9334/Local Storage` exists.
  - [x] `localStorage.setItem('gitclient.refColW', '100')` over CDP on 9334 is not visible to a
        fresh launch on 9333 (`getItem` returns null there).
  - [x] `npm run e2e` passes unchanged, and its step 1 still finds a clean `gitclient.prefs`.
  - [x] `npm run dev` still opens the last repository Ricardo used.
- **Files:** `src/main/index.ts`, `tools/launch-app.mjs`, `tools/e2e/run.mjs` (step 1 comment
  only), `CLAUDE.md`.
- **Verify:** typecheck, build, the four checks above with `ls -la --time-style=full-iso` on
  the real profile before and after a launch, then `npm run e2e`.
- **Log:**
  - 2026-09-05 proposed by GR-004: the review's own graph screenshots turned out to be taken at a
    ref column width a previous ticket's hand check had left in the shared profile, and every
    `--repo` launch overwrites the repository Ricardo's app opens next.
  - 2026-09-05 21:48 claimed
  - 2026-09-05 22:01 done. `src/main/index.ts` honours `GITCLIENT_USER_DATA` at module scope,
    `tools/launch-app.mjs` sets it to `<os.tmpdir()>/gitclient-profiles/<port>` for every launch it
    makes (stealth and `--visible`) through a new exported `profileDir(port)`, and the step 1 comment
    in `run.mjs` says where the profile lives. Verified centrally: a launch on 9335 created
    `<tmp>/gitclient-profiles/9335/Local Storage` while the newest file under
    `%APPDATA%/gitclient/Local Storage/leveldb` stayed at 21:42:32, older than every launch this run
    made (21:55 onwards) and unchanged after the e2e suite too; `gitclient.refColW` set to `100` over
    CDP on 9335 read back as `null` on a fresh 9336, whose profile also carried a recents list of its
    own. `npm run e2e` passed twice, 66 assertions each, step 1 finding a clean `gitclient.prefs`.
    Ports substituted, deliberately: the acceptance names 9334, which is the hourly backlog reviewer’s
    port, and the launcher frees a port by stopping whatever listens on it, so checking there could
    have killed a review mid-run. The same isolation was proved on 9335 and 9336 instead.
    The fourth criterion was verified by construction rather than by running it: `npm run dev` is
    `electron-vite dev` and no npm script goes through the launcher, so `GITCLIENT_USER_DATA` is unset
    and the `setPath` call is skipped. Running it would have opened a visible, focused window, which an
    unattended session must never do.

### GC-061 A detached HEAD has no marker in the graph

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-020
- **Why:** With `git checkout --detach HEAD~1` in the scratch repository and a Refresh, the
  breadcrumb and the staging header read "detached HEAD" and the graph correctly moves column 0
  to that commit's lineage, but no row says which commit is checked out: `for-each-ref` marks
  `isHead` only on a branch, so the chip that carries the check mark simply disappears
  (GR-004's `07-detached-head.png`). The study's graph always shows a chip on the checked-out
  commit, and after "Checkout this commit (detached)" from our own commit menu the user is left
  to find the row by the dashed WIP link alone. The Push button is correctly disabled meanwhile
  but its title still reads "Push to origin and set upstream", which promises the click it
  refuses.
- **Scope:**
  - When `info.branch` is null and `headSha` is set, `CommitGraph` renders a synthetic chip
    labelled `HEAD` first on that commit's row: the checked-out styling (check icon, `.head`
    class, lane colour), the same connector line, and ranked before every real ref so the fold
    cannot hide it. It is built in the renderer from `headSha`; `getRefs` and `GitRef` do not
    change.
  - Right-click on that chip opens the commit menu for `headSha` (`commitMenuItems`), so
    "Create branch here…" is one click away, which is the thing a detached user usually wants.
  - The Toolbar's Push title reads "Cannot push from a detached HEAD" while `info.branch` is
    null (the message `git.ts` already uses for the same case).
  - The left panel is unchanged: there is no branch to tint, and the header already says so.
- **Out of scope:** a chip on the WIP row, a "detached" banner in the detail panel, checking
  out a remote branch as detached from its chip (that path exists), a left-panel row for HEAD.
- **Acceptance:**
  - [ ] `git checkout --detach HEAD~1` + Refresh in the scratch repository shows exactly one chip
        reading `HEAD` on that commit's row, in column 0, with the dashed WIP link ending on it;
        `git checkout main` + Refresh removes it and the `main` chip has the check mark again.
  - [ ] The chip's context menu is the commit menu; "Create branch here…" creates the branch at
        `git rev-parse HEAD`.
  - [ ] The Push button's title names the detached state while disabled.
  - [ ] e2e step: detach, Refresh, assert the chip's text and row, re-attach; the prologue
        re-attaches to `main` if a run died in between (`git checkout -q main` is idempotent).
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/components/Toolbar.tsx`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, then a screenshot of the detached state looked at next to
  GR-004's `07-detached-head.png` (the before) and the study's `02-main-1080.png` for the chip's
  place in the row.
- **Log:**
  - 2026-09-05 proposed by GR-004: detaching HEAD in the scratch repository left the graph with
    no indication of the checked-out commit; the breadcrumb says "detached HEAD" and nothing
    says where.

### GC-062 The e2e suite never commits through the commit form or stages a hunk

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** GC-053
- **Why:** Eighteen e2e steps cover branches, stashes, conflicts, cherry-picks, push, pull,
  tags, remotes, search and layering, but a case-insensitive grep of `tools/e2e/run.mjs` for
  `hunk`, `amend` or `summary` finds nothing: the commit form (summary, description, the
  72-character counter, Ctrl+Enter, the Commit button, "Amend previous commit" prefilling
  HEAD's message, "Commit merge" for an empty summary during a merge) and the DiffView's Stage
  hunk / Discard hunk / Unstage hunk buttons have no automated coverage at all. The commit step
  10 needs is made with git in a second clone, and the merge in step 6 is aborted rather than
  concluded. These are the two most frequent actions in a git client and the ones GitKraken
  users judge first; they also route through `commit --file=-` on stdin and
  `apply --cached --recount`, the two most fragile git invocations in `git.ts`.
- **Scope:**
  - A step that stages one file from the staging list, types a summary and a description into
    the commit form, reads the counter, commits with Ctrl+Enter, and asserts
    `git log -1 --format=%B` carries both lines and `git status --short` no longer lists the
    file; then ticks Amend, asserts the summary field holds that message, edits it, commits,
    and asserts `git log -1 --format=%s` changed while `git rev-list --count HEAD` did not.
  - A step that opens the two-hunk `big.txt` from the staging list, clicks Stage hunk on the
    second hunk, asserts `git diff --cached -- big.txt` contains that hunk's added line and
    `git diff -- big.txt` still contains the first hunk's, then Unstage hunk from the staged
    view and asserts the index is clean again; finally Discard hunk on one hunk behind the
    confirm modal and Cancel, asserting the working tree is unchanged.
  - Both steps leave the scratch repository as they found it (reset the amended commit with
    `git reset --hard <sha before>` and restore the working tree to the state the prologue
    expects), and the prologue undoes them if a run dies in between.
- **Out of scope:** "Commit merge" for a concluded merge (step 6 aborts on purpose; a second
  merge fixture is its own change), staging single lines (not a feature yet), the CHANGES
  count, changing any existing step.
- **Acceptance:**
  - [x] `npm run e2e` passes three times in a row with the new assertions, and stays
        re-entrant when interrupted inside either step.
  - [x] The amend assertion fails if the summary field is not prefilled (mutation check: return
        an empty string from the prefill in `DetailPanel.tsx`, run, restore).
  - [x] The hunk assertion fails if `buildHunkPatch` drops the file header (mutation check).
- **Files:** `tools/e2e/run.mjs`, `CLAUDE.md` (Testing paragraph).
- **Verify:** `npm run e2e` three times, then the two mutation checks with the source restored
  and `git diff` empty afterwards.
- **Log:**
  - 2026-09-05 proposed by GR-004: reading the step list for the review showed that the commit
    form and hunk staging, the two most frequent actions, are the two the suite never drives.
  - 2026-09-05 22:39 claimed
  - 2026-09-05 23:30 done. Steps 20 and 21 added; the suite went from 71 to **88** assertions and
    still uses five commented `sleep` calls, none of them new. Step 20 stages a scratch file from
    its row's Stage button, types a summary and a description, checks the 72-character counter
    (`43` for a 29-character summary), commits with a real CDP Ctrl+Enter aimed at the focused
    summary field, and asserts `git log -1 --format=%B` carries both lines; it then ticks Amend,
    asserts the prefill came from HEAD, edits the summary, commits from the button and asserts the
    subject changed while `git rev-list --count HEAD` did not. Step 21 stages the second hunk of
    `big.txt`, asserts only that hunk reached the index while the first is still unstaged, unstages
    it from the staged side, then cancels a Discard hunk and asserts the tree is untouched. Both
    restore the repository themselves (`git reset --soft`, never `--hard`: the index the commit
    consumes holds the fixture's own staged changes) and the prologue undoes either from a
    mid-step death.
  - 2026-09-05 23:30 The first central run failed 5 assertions in step 21, and the cause was in the
    test, not the app: `DiffView` starts a new load without clearing `text`, so switching from the
    1-hunk unstaged side to the 1-hunk staged side satisfied a wait keyed on chip + hunk count
    while the *previous* diff was still rendered, and Unstage hunk then rebuilt its patch from the
    stale hunk, which git correctly rejected into the view's inline error. Driving the same clicks
    by hand over CDP with generous sleeps unstaged cleanly (`git diff --cached -- big.txt` empty),
    which is what proved the app innocent. `waitDiff` now also compares the ordered list of rendered
    added lines, and the wait after Unstage hunk waits for the file view to *close* (the file leaves
    the Staged group) rather than for a `.diff-empty` that can never appear. The underlying stale
    render is filed as GC-075.
  - 2026-09-05 23:30 Verified: four `ALL PASSED` runs at 88 assertions (three consecutive, then one
    more after a fixture reset). Mutation check 1 — `setSummary(headCommit.summary)` →
    `setSummary('')` at `DetailPanel.tsx:116` — failed exactly the two amend assertions and nothing
    else. Mutation check 2 — `buildHunkPatch`'s `return header.join('\n') + '\n' + hunk.raw` →
    `return hunk.raw` at `parseDiff.ts:134` — failed 6 assertions in step 21 with the index
    untouched. Both reverted and rebuilt, `git status` clean of them. Re-entrancy was checked by
    stranding the exact state a death inside each step leaves (an `e2e commit form` commit plus its
    `e2e-commit-*.txt` file, and a staged `big.txt` hunk) and running the suite: the prologue
    removed all three and the run proceeded. That run failed one assertion in step 16, which turned
    out to be pre-existing fixture drift unrelated to this ticket — filed as GC-076 — and a fresh
    `npm run e2e:setup` made the same run `ALL PASSED`.


### GC-063 Unit tests for the watcher's ignore and scope rules

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P1
- **Depends on:** GC-011
- **Why:** GC-011's watcher shipped with a refresh loop that nothing in the repository could have
  caught. `ignored()` and `scopeOf()` in `src/main/watch.ts` are pure functions over a relative
  path, and the whole defect was one path — a bare `.git`, produced on Windows when our own
  `git status` writes and removes `.git/index.lock` — falling through the ignore list because its
  second segment is empty. `npm run typecheck`, 48 unit tests and a full 66-assertion e2e run all
  passed while the app was pushing a refresh every 300ms forever; only a CDP event counter found
  it. A table-driven test over these two functions costs minutes and pins the exact rule.
- **Scope:**
  - Export `ignored` and `scopeOf` from `src/main/watch.ts` (or move them to a small module the
    watcher imports) so they can be tested without Electron; the file imports `electron` only as a
    type today, so a test must not pull the runtime in — check that before choosing.
  - A `.test.ts` in the `node` project asserting the decision for at least: `.git` (ignored — the
    regression guard), `.git/index.lock`, `.git/index` (tree), `.git/refs` and
    `.git/refs/heads/main` and `.git/HEAD` and `.git/packed-refs` (refs), `.git/objects` and
    `.git/objects/ab/cdef` and `.git/logs/HEAD` and `.git/COMMIT_EDITMSG` (ignored),
    `.git/MERGE_HEAD` (tree), `node_modules` and `node_modules/pkg/x.js` (ignored), `src/a.txt`
    (tree), and a backslash-separated path proving the normalisation.
  - Mutation-check it: removing the bare-`.git` rule must fail the guard case.
- **Out of scope:** testing the debounce, the `fs.watch` subscription or the IPC push; an e2e step
  for external edits (that is its own gap, noted in GC-011's log).
- **Acceptance:**
  - [x] `npm test` covers every path above and passes.
  - [x] Mutation-checked: deleting the bare-`.git` rule fails the suite.
  - [x] The test needs no Electron import and no build.
- **Files:** `src/main/watch.ts`, new `src/main/watch.test.ts` (or a path under `src/` if the
  `vitest.config.ts` include has to stay as it is — say which in the log).
- **Verify:** `npm test`, then the mutation check.
- **Log:**
  - 2026-09-05 proposed by GC-011 (this ticket): the watcher's refresh loop passed typecheck, the
    unit suite and a full e2e run; the defect was one pure-function decision on one path.
  - 2026-09-05 21:48 claimed
  - 2026-09-05 22:01 done. `ignored`, `scopeOf` and a new `toRel` are exported from
    `src/main/watch.ts`; `toRel` was lifted out of the change handler so the test feeds the rules the
    same string the watcher does rather than a second copy of the backslash normalisation. The test is
    `src/main/watch.test.ts` and `vitest.config.ts` needed no edit: the `node` project’s
    `src/**/*.test.ts` include and `tsconfig.node.json`’s `src/main/**/*` both already cover that path.
    17 tests over every path the scope lists, run as `npx vitest run --project node src/main/watch.test.ts`.
    Mutation check re-run centrally rather than taken on the agent’s word: deleting
    `if (parts.length === 1) return true;` from `ignored()` fails exactly the bare-`.git` guard
    (expected tree to be ignored, 1 failed | 16 passed); the file was restored and the suite re-run green.
    No Electron and no build, checked statically: `npx esbuild --loader=ts --format=esm < src/main/watch.ts`
    emits one runtime import, `node:fs`, both `electron` and `@shared/types` being type-only and erased.

### GC-064 An e2e:setup on the shared scratch root wipes a run already using it

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `tools/e2e/setup-testrepo.mjs` starts with `rmSync(root, { recursive: true, force: true })`
  on `$GITCLIENT_E2E_ROOT ?? <tmp>/gitclient-e2e`, so a second run that reaches for the default
  root deletes the repository, the bare origin and the `shots/` directory out from under a suite
  that is mid-flight. That happened during this batch: a baseline run died at step 15 with 39
  failing assertions and then an unhandled `ENOENT` on `shots/modal-checkout-dirty.png`, and the
  root was left holding one empty `testrepo` directory — exactly `rmSync` followed by `mkdirSync`.
  Two routines share this machine and the hourly reviewer is supposed to pass its own root, so a
  slip either way is silent and the failure it produces names nothing.
- **Scope:**
  - `setup-testrepo.mjs` writes a small lock/marker file into the root (pid and start time) and
    refuses to wipe a root whose marker belongs to a live process, unless `--force` is passed.
  - `run.mjs` fails fast with one clear message when `<root>/testrepo` is missing or is not a git
    repository, instead of running the whole suite against a repository that is not there.
  - `shot()` creates the screenshots directory if it is absent, so a missing `shots/` cannot end a
    run in an unhandled exception.
- **Out of scope:** giving the two routines separate default roots (the reviewer already passes
  `GITCLIENT_E2E_ROOT`); changing what the suite asserts.
- **Acceptance:**
  - [ ] With a live marker in the root, `npm run e2e:setup` refuses and says which pid holds it;
    with a stale marker it proceeds.
  - [ ] `npm run e2e` against a root whose `testrepo` is missing exits non-zero with one message
    naming the path, and runs no steps.
  - [ ] `npm run e2e` passes with the `shots/` directory deleted beforehand.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** the three checks above, then `npm run e2e:setup && npm run e2e` once normally.
- **Log:**
  - 2026-09-05 proposed by GC-053 (this ticket): a concurrent `e2e:setup` on the default root
    destroyed a baseline measurement mid-run and the resulting failure named nothing.


### GC-065 Two of the study's screenshots show the desktop, not GitKraken

- **Status:** done
- **Area:** infra | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `docs/reference/gitkraken/screenshots/09-repo-dropdown.png` and
  `10-branch-dropdown.png` do not show GitKraken at all. Both show Ricardo's own desktop at the
  moment of capture — a Claude Code window on the left and a browser on the right — so the two
  breadcrumb dropdowns the study claims to have recorded were never recorded. `02-main-1080.png`
  and `11-pull-dropdown.png` from the same study are genuine GitKraken frames, so this is not the
  whole set: it is the captures that needed a real OS click to open a native-looking dropdown,
  where `focus.ps1` evidently did not raise GitKraken before `shot.ps1` fired. The cost is silent.
  `04-panels.md` cites both files by name for its "Breadcrumb dropdowns" measurements, and GC-044's
  fourth acceptance criterion was "looked at next to the study's `09-repo-dropdown.png`" — that
  check could not be made as written, and any future ticket citing either file will hit the same
  wall without knowing why.
- **Scope:**
  - Open every file in `docs/reference/gitkraken/screenshots/` and record, in
    `docs/reference/gitkraken/README.md`'s index, which ones actually show GitKraken. At least the
    two above do not; the audit says whether any others share the failure.
  - Each unusable file is marked in the README index and at every citation of it in the notes
    files, so a ticket that reaches for one is told immediately rather than after a launch.
  - The written measurements those notes carry (`250px` wide `ul`, `27px` items, `25px` group
    headers, the "Recently opened" / "View all repositories" headers) stay: they were taken over
    CDP against the live app, not read off the screenshot, and are still the usable reference.
  - A recapture needs a hands-on GitKraken session, because opening those dropdowns needs
    `rclick.ps1` and `shot.ps1`, which an unattended run must never touch. The ticket therefore
    ends at the audit and the marking; recapturing is Ricardo's to schedule.
- **Out of scope:** recapturing anything, re-running the CDP study, changing any measurement.
- **Acceptance:**
  - [x] Every file in `screenshots/` has been opened and its subject recorded in the README index.
  - [x] `09-repo-dropdown.png` and `10-branch-dropdown.png` are marked unusable there and at each
    citation in `04-panels.md`, naming what they actually show.
  - [x] `grep -rn '09-repo-dropdown\|10-branch-dropdown' docs/` returns no citation that still
    presents the file as a GitKraken reference.
- **Files:** `docs/reference/gitkraken/README.md`, `docs/reference/gitkraken/04-panels.md`, and
  whichever other notes files the grep turns up.
- **Verify:** the grep above, plus reading the README index against the directory listing.
- **Log:**
  - 2026-09-05 22:01 proposed by GC-044 (this ticket): GC-044's screenshot comparison could not be
    made, because the file it names shows a Claude Code window and a browser rather than
    GitKraken's repository dropdown. `02-main-1080.png` and `11-pull-dropdown.png` were checked in
    the same pass and are genuine, which is what bounds this to an audit rather than a redo.
  - 2026-09-05 22:08 claimed
  - 2026-09-05 22:50 done. All 19 files in `screenshots/` were opened and looked at, and the
    README index now records each one's real subject. `09-repo-dropdown.png` and
    `10-branch-dropdown.png` were confirmed by the orchestrator, not taken on the agent's word:
    both show a Claude Code window (the kyushu-route accommodation chat) beside a browser on
    booking.com, one of them mid sign-in with a passkey prompt. Both are marked unusable in the
    index, in a new "Unusable captures" note and at their one citation in `04-panels.md`, and
    `grep -rn '09-repo-dropdown\|10-branch-dropdown' docs/` returns five lines, every one of which
    presents the file as unusable. The audit also corrected `07-context-menu-wip.png`, a genuine
    GitKraken frame that shows the "Explain working changes (Preview)" hover tooltip rather than
    the context menu its filename promises. The measurements in `04-panels.md` are unchanged; that
    paragraph now says they came from CDP against the live DOM, which is why they survive the
    screenshots being useless. One number the agent wrote was wrong and was fixed here: "the other
    19 files" became "the other 17", the directory holding 19 in total.

### GC-066 A second click on the repository crumb cannot close its dropdown

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-044
- **Why:** `ContextMenu` dismisses on a capture-phase `mousedown` anywhere outside itself
  (`ContextMenu.tsx:45`), and GC-044 hung the recents dropdown off a `click` handler on the
  repository crumb and on the title bar's `+`. Clicking either control while its own menu is open
  therefore closes the menu on `mousedown` and reopens it on `click`, so the control reads as one
  that cannot be toggled shut — the menu appears to ignore the click. Escape and an outside click
  both work, so nothing is trapped; it is the dropdown affordance that is wrong, and these are the
  first two controls in the app whose own click opens the menu (every other menu comes from a
  right-click, where the question never arises).
- **Scope:**
  - A control that owns a menu closes it instead of reopening it when it is clicked while its own
    menu is up. The obvious shape is for `UiProvider` to remember which element opened the current
    menu and for `openMenu` to close and return when asked to reopen from that same element, so
    the fix lands once for every future dropdown rather than in each caller.
  - The repository crumb and the title bar's `+` both toggle.
- **Out of scope:** changing how right-click menus behave, the popover machinery in the toolbar.
- **Acceptance:**
  - [x] Over CDP: clicking `.crumb.as-button` opens the menu, clicking it again leaves no
    `.ctx-menu` in the DOM, and a third click opens it again.
  - [x] The same for the title bar's `+`.
  - [x] Escape still closes the menu as one layer and the e2e layering step (18) still passes.
- **Files:** `src/renderer/src/ui/UiContext.tsx`, `src/renderer/src/ui/ContextMenu.tsx`,
  `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/components/TitleBar.tsx`.
- **Verify:** typecheck, build, the three CDP checks above, `npm run e2e`.
- **Log:**
  - 2026-09-05 22:01 proposed by GC-044 (this ticket): GC-044 added the first two menus in the app
    that are opened by the control's own left click, which is where the existing outside-mousedown
    dismissal turns into a menu that will not close.
  - 2026-09-05 22:08 claimed
  - 2026-09-05 22:50 done. `UiProvider` now remembers the element a menu belongs to and, on a
    capture-phase mousedown registered at provider mount (so it runs before `ContextMenu`'s own,
    registered later, which is what dismisses the menu), records that the gesture began on that
    element; the click which follows then closes instead of reopening. Checked over CDP with real
    `Input.dispatchMouseEvent` clicks rather than dispatched events: three clicks on
    `.crumb.as-button` gave menu present true, false, true, and the title bar's `+` the same.
    Escape still closes the menu as one layer (`.ctx-menu` gone immediately after), and e2e step 18
    passed on all three runs. The four new cases in `src/renderer/src/ui/UiContext.test.tsx` take
    the dom project from 4 tests to 8, 72 in total. Both halves of the toggle condition were
    mutation-checked by the orchestrator rather than taken on the agent's word: replacing
    `armedRef.current === owner` with `false` fails exactly one case, and
    `ownerRef.current === owner` with `false` fails exactly one other. Screenshot
    `docs/screenshots/gc066-recents-dropdown.png`.


### GC-067 The recents dropdown shrinks the folder name to one letter and shows the path in full

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-044
- **Why:** On the build at 3e97244, clicking the repository crumb over CDP opened GC-044's recents
  menu 420px wide with its one entry reading `t…` followed by
  `C:/Users/Ricar/AppData/Local/Temp/gitclient-review/e2e/testrepo` in full
  (`%TEMP%/gitclient-review/GR-005/05-recents-dropdown.png`). The name is what the user picks by
  and the path is context, and the CSS has them the wrong way round: `.ctx-label` is `flex: 1`
  (a basis of 0, so it gets only what is left) while `.ctx-hint` keeps its content width up to the
  menu's 420px cap, so a path longer than the cap takes everything and the name loses. GC-044's own
  screenshot (`docs/screenshots/gc-044-recents-dropdown.png`) shows both names in full because its
  paths under `%TEMP%/gitclient-e2e` are about 50 characters and fit; ten more characters and the
  name is gone, which any repository under `Documents/apps/<org>/<project>` will reach. Every other
  menu carries short hints (shortcuts, remote names), which is why nothing showed it before GC-044
  put a path there. The study's dropdown is a 250px list of names, name first (`04-panels.md`,
  "Breadcrumb dropdowns").
- **Scope:**
  - The label keeps its full text whenever the menu can hold it: `.ctx-label` stops shrinking
    before the hint does (`flex: 0 0 auto`, or a shrink weight far below the hint's) and the hint
    absorbs the shortfall, ellipsised, with the menu still capped at 420px.
  - A path hint ellipsises at its start so the tail that names the folder stays visible
    (`direction: rtl; unicode-bidi: plaintext` on the hint, or a middle truncation done in
    `openRepoMenu`); every other hint keeps its end-ellipsis.
  - A non-interactive `MenuItem.caption` (a 25px dim uppercase row, like the section headers) so
    the recents list carries a "Recently opened" header the way the study's dropdown does — the gap
    GC-044's log named and left. `openRepoMenu` uses it above the list; the separator before
    "Open repository…" stays.
- **Out of scope:** the study's search box and Favorites, the menu's colours and radius, the empty
  state (its rows already show name and path on two lines), GC-066's toggle behaviour.
- **Acceptance:**
  - [x] Over CDP with the scratch repository loaded from `%TEMP%/gitclient-e2e/testrepo`, the
        crumb menu's `.ctx-label` reads `testrepo` in full and the `.ctx-hint` ends with
        `/testrepo` (an ellipsis at its start), the menu no wider than 420px; the same with a
        clone whose folder is named `a-very-long-repository-folder-name-for-the-menu` in the list.
  - [x] The commit menu and the branch menu look as before (their hints are short), checked by
        screenshot.
  - [x] The caption row renders above the recents, is not clickable, and Escape still closes the
        menu as one layer (e2e step 18 passes).
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/ui/ContextMenu.tsx`,
  `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, the CDP checks above, `npm run e2e`, a screenshot of the open
  dropdown looked at next to `docs/screenshots/gc-044-recents-dropdown.png`.
- **Log:**
  - 2026-09-05 22:23 proposed by GR-005: the first unattended look at GC-044's dropdown, from a
    scratch root eleven characters longer than the worker's, showed the folder name reduced to one
    letter and the full path kept.
  - 2026-09-05 22:39 claimed
  - 2026-09-05 23:30 done. `.ctx-label` is `flex: 0 1 auto` and `.ctx-hint` `flex: 1 1 0` with
    `text-align: right`, so the hint's basis is 0 and it absorbs the shortfall instead of the label;
    `.ctx-hint.path` adds `direction: rtl` for the leading ellipsis, and `MenuItem` gains `hintPath`
    and `caption`, the latter rendered as a plain `div.ctx-caption` so no `.ctx-item` selector in
    the e2e driver can pick it up. Measured over CDP on the built app at 9333 with the scratch
    repository plus a seeded `a-very-long-repository-folder-name-for-the-menu` entry: menu width
    420 (the cap), `testrepo` label unclipped, its hint `direction: rtl` ending `/testrepo`, the
    47-character label unclipped at 298px with its 88-character hint clipped to `…-or-the-menu`,
    caption `Recently opened` as the menu's first child, `captionTag: DIV`, `captionIsItem: false`,
    and the menu gone after one Escape. The commit menu is unchanged (420px, hints `direction: ltr`,
    "keep changes in the working dire…" still end-ellipsised) and the branch menu still shrinks to
    fit at 326px with nothing clipped; screenshots `docs/screenshots/gc-067-recents-dropdown.png`,
    `gc-067-commit-menu.png` and `gc-067-branch-menu.png`, looked at next to
    `gc-044-recents-dropdown.png`. e2e step 18 (the one-Escape-one-layer guard) passes in all four
    clean runs. The ticket's suggested `unicode-bidi: plaintext` was tried and rejected — Chromium
    resolves the paragraph direction from the leading `C` and puts the ellipsis back at the end —
    and the reason is recorded in `app.css` so it is not re-added.

### GC-068 A watcher reload that finishes late overwrites a fresher snapshot

- **Status:** in-progress
- **Area:** actions | **Size:** M | **Priority:** P1
- **Depends on:** GC-011, GC-046
- **Why:** `applyChange` in `App.tsx` (GC-011) awaits `window.api.loadRepo` and then calls
  `setSnapshot(snap)` unconditionally; `refreshStatus` does the same with the status. Nothing ties
  a result to the moment it was asked for. A refs change from outside (a commit or a branch typed
  in a terminal) starts a background full load, which on catena-feed's 2000 commits takes about a
  second; a Stage clicked during that second runs, reloads the status and clears `busy`, and then
  the older promise resolves and replaces the snapshot with one captured before the click: the file
  shows as unstaged while `git status` says it is staged. The `.git/index` event from the stage
  was already parked and flushed by then, so nothing heals it until the next file-system event. It
  needs a slow load to show, which is why the seven-commit scratch repository and the e2e suite
  never see it; the parked-while-busy rule covers a change that *arrives* during an action, not a
  load that *started* before one.
- **Scope:**
  - One generation counter in `App`: `load()`, `refreshStatus()` and `applyChange()` each read
    it when they start and drop their result if it has moved on by the time the promise settles;
    `run()` bumps it when it starts, so a user action always invalidates whatever background work
    was in flight. Dropping is silent: no banner, no spinner.
  - The first component test for `App`, `src/renderer/src/App.test.tsx` in the dom project:
    stub `window.api` with deferred promises for `loadRepo` and `getStatus` (and no-ops for the
    rest), capture the `onRepoChanged` listener, deliver a `refs` change, click the toolbar
    Refresh, resolve the second load first and the stale one after it, and assert the staging
    header shows the second load's counts. Copy `Preferences.test.tsx`'s `afterEach` cleanup and
    `CommitGraph.test.tsx`'s `ResizeObserver` stub and `avatars: false`.
- **Out of scope:** cancelling the git process, coalescing two loads into one, the watcher's
  debounce and scope rules (GC-063 covers those).
- **Acceptance:**
  - [ ] The dom test passes, and fails when the generation check is removed (say so in the log).
  - [ ] `npm run e2e` still passes: the watcher and the parked-change flush are untouched.
  - [ ] The watcher probe GR-005 ran still works on the built app: an untracked file created in the
        scratch working tree changes the WIP counts within two seconds and `git branch x` raises
        the LOCAL count, with no click.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/App.test.tsx` (new).
- **Verify:** `npm test`, typecheck, build, `npm run e2e`, the CDP probe above.
- **Log:**
  - 2026-09-05 22:23 proposed by GR-005: reading GC-011's renderer half found the background
    reload writing its result without checking that nothing newer had landed since it started.
  - 2026-09-05 23:14 GR-006: seen on the fixture for the first time, in the review's own e2e run at ee91d54
    (`%TEMP%/gitclient-review/e2e-run1.log`, step 5). The suite had stashed through the toolbar, popped
    the stash with `git stash pop --index` from outside, clicked Refresh and waited for the spinner;
    the app then reported "No changes to stash" on the Stash button while `git status --short` listed
    the popped tree, so the named-stash half of the step never opened its dialog (2 of 71 assertions
    failed). The only way a Refresh ends with a clean status over a dirty tree is a load that started
    earlier — the watcher's reload after the stash push — resolving after it. GR-005's run and the
    second run of this review passed, so it is a race, not a constant; the Why above stands and the
    "seven-commit scratch repository never sees it" clause no longer does.
  - 2026-09-05 23:35 claimed

### GC-069 The body preview takes width from the summary in a narrow message column

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-032
- **Why:** `.col-msg` lays out `.summary` and `.body` as two flex items that both ellipsise, each
  at the default `flex: 0 1 auto`, so when the column is short they shrink in proportion to their
  content widths: a long body preview keeps most of its text while the summary loses its own. On
  catena-feed read-only at 1400x900 with GC-032's three columns on
  (`%TEMP%/gitclient-review/GR-005/07-catena-feed-columns.png`) the row for 4b2d549 reads
  `fix(… Signed-o…` and the row for 5e7d121 `Ref… Signed-o…`: the part that identifies the commit
  is gone and the decoration stays. The scratch repository shows the same on
  `Extend … Second paragraph…` (`06-graph-columns.png`). The study's message column shows the
  summary first and the description only in what is left (`03-graph.md`, Columns).
- **Scope:**
  - The summary wins: `.body` gets a far larger `flex-shrink` (and `min-width: 0`) so it
    collapses first, and it is hidden entirely below a small width (about 40px) rather than left as
    a lone ellipsis; the summary starts ellipsising only once the body is gone. The row's `title`
    (summary plus body) stays for hover.
- **Out of scope:** the column widths GC-032 chose, a resizable message column, wrapping, the WIP
  row.
- **Acceptance:**
  - [ ] Scratch repository, 1400x900, all three columns on: the `Extend feature` row shows its
        whole summary and a truncated or hidden body; with the columns off the row is unchanged
        (both fit as before).
  - [ ] catena-feed read-only, same setup: every row whose summary is narrower than the column
        shows the whole summary, checked over CDP by comparing each `.summary` element's
        `scrollWidth` and `clientWidth` for the rendered rows.
  - [ ] Screenshot looked at next to `docs/screenshots/graph-columns.png`.
- **Files:** `src/renderer/src/styles/app.css` (and `src/renderer/src/graph/CommitGraph.tsx` only
  if a wrapper is needed).
- **Verify:** build, the CDP check above, screenshot at 1400x900 with the columns on.
- **Log:**
  - 2026-09-05 22:23 proposed by GR-005: switching GC-032's columns on made the message column
    narrow enough to show the body preview outliving the summary on every long-bodied commit.

### GC-070 Tests for tools/ live under src/renderer/src

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-059
- **Why:** `repo-hygiene.test.ts` (GC-047) and `launch-app.test.ts` (GC-059) test the repository
  and `tools/launch-app.mjs`, but sit in `src/renderer/src/` because `vitest.config.ts` includes
  only `src/**` and `tsconfig.web.json` is the one project that would type-check them; each
  carries a `/// <reference types="node" />` and a paragraph explaining the placement, and
  `CLAUDE.md` repeats both. The convention is that a test lives next to the module it covers; two
  exceptions with an explanation each is the point where the config should change rather than a
  third test copying the workaround, and the two files make the renderer's typecheck depend on
  node types it otherwise never uses.
- **Scope:**
  - `vitest.config.ts`: the node project also includes `tools/**/*.test.ts` (alias map unchanged).
  - `tsconfig.node.json` includes `tools/**/*.test.ts` (it already has the node types);
    `tsconfig.web.json` is left as it is.
  - Move the two tests to `tools/launch-app.test.ts` and `tools/repo-hygiene.test.ts`, fix their
    `ROOT` computations, drop the reference directives and the placement comments, and update the
    two paragraphs in `CLAUDE.md`'s Unit tests section.
- **Out of scope:** any change to what either test asserts; moving the renderer tests.
- **Acceptance:**
  - [x] `npm test` reports the same 68 tests in 10 files, the two now under `tools/`;
        `npx vitest run --project node` finds both.
  - [x] `npm run typecheck` passes, and `tsc --noEmit -p tsconfig.web.json --listFiles` lists no
        file under `tools/` and neither test.
  - [x] The hygiene test still fails on a NUL written into a scratch file under `src/` (repeat
        GC-047's mutation check), so the moved `ROOT` still points at the repository.
- **Files:** `vitest.config.ts`, `tsconfig.node.json`, `src/renderer/src/launch-app.test.ts`
  and `src/renderer/src/repo-hygiene.test.ts` (moved to `tools/`), `CLAUDE.md`.
- **Verify:** `npm test`, `npm run typecheck`, the mutation check above.
- **Log:**
  - 2026-09-05 22:23 proposed by GR-005: GC-059 added the second tools test that has to live in the
    renderer tree and explain why; the config should carry that instead.
  - 2026-09-05 22:39 claimed
  - 2026-09-05 23:30 done. The node vitest project and `tsconfig.node.json` both include
    `tools/**/*.test.ts`; the two tests moved to `tools/repo-hygiene.test.ts` and
    `tools/launch-app.test.ts` with `ROOT` going from
    `resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')` to `(..., '..', '..')`, and
    both dropped their `/// <reference types="node" />` and their placement paragraphs. Nothing
    either test asserts changed (diffed against `HEAD`: only the header comments and `ROOT`).
    The acceptance line's "68 tests in 10 files" was written before GC-058 and GC-046 landed; the
    real baseline is **72 tests in 11 files**, and it is identical before and after the move —
    that identity is the criterion that matters and it holds. `npx vitest run --project node`
    reports 64 tests in 8 files and lists both moved files by their `tools/` path.
    `npm run typecheck` passes, and `tsc --noEmit -p tsconfig.web.json --listFiles` matches
    nothing under `tools/` and neither test, so the renderer's program no longer pulls in node
    types for them. GC-047's mutation check repeated from the new location: a NUL written into
    `src/renderer/src/gc070-mut.txt` failed the hygiene test with
    `control character (0x00) at byte offset 2`, so the moved `ROOT` still points at the
    repository; scratch file removed and the suite back to 72/11.


### GC-071 The primary ref chip is unreadable at the minimum column width

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-023, GC-055
- **Why:** GC-023's first acceptance criterion ("at 100px with four refs on one commit, the first
  chip keeps its name legible") turned out to be unsatisfiable, and not because of the shrink rule
  it was written against. Measured over CDP on a commit carrying four refs: at a 100px ref column
  `chipBudget` allows exactly one chip, so the row renders the primary chip plus a `+3` chip, and
  the primary chip's `.chip-name` reports `clientWidth` 17 against `scrollWidth` 29 — "main"
  renders as "ma...". The numbers are identical before and after GC-023, because with one visible
  chip there is nothing for a shrink weight to redistribute. What eats the column is fixed
  furniture: the `+N` chip (26px), the leading check icon and the trailing cloud icon (11px each)
  and the chip padding, leaving 17px of the 100px for the name. 100px is the low end `CommitGraph`
  clamps the drag to, so this is the state a user who drags the column all the way in gets.
- **Scope:**
  - At the narrow end of the range the primary chip's name wins over the furniture around it: the
    obvious candidates are dropping the trailing upstream cloud icon and letting the `+N` chip
    shrink once the column is below some threshold, but the fix is whatever makes the name legible.
  - Measure, do not eyeball: the check is `.chip-name`'s `scrollWidth` against its `clientWidth`
    on a commit with four or more refs, at 100px and at the default 150px.
- **Out of scope:** the fold budget itself (GC-006), the chip order (GC-020), the shrink weights
  (GC-023), raising the 100px minimum.
- **Acceptance:**
  - [ ] At 100px on a commit with four refs, the first chip's `.chip-name` is not truncated
        (`scrollWidth <= clientWidth`), or the ticket records why that is impossible at 100px and
        the minimum is raised instead.
  - [ ] At 150px and above nothing regresses: the same measurement, and the `+N` fold still works.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** build, then the two measurements above over CDP against a commit given four refs in
  the scratch repository (the fixture has none — see GC-055).
- **Log:**
  - 2026-09-05 22:45 proposed by GC-023 (this ticket): verifying GC-023 at 100px showed the primary
    chip truncated to 17/29px identically before and after the change, so the criterion belongs to
    a different cause than the one GC-023 fixed.
  - 2026-09-05 23:14 GR-006: now depends on GC-055 as well. Its Verify needs a commit carrying four refs, which
    the fixture lacks; GC-020 and GC-023 each built theirs by hand, and a third ticket doing the same
    is the point at which the fixture should carry it.

### GC-072 Show in folder is offered on a file the commit deleted, and always fails

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-043
- **Why:** GC-043 disables "Open file" on a commit file whose `kind` is `deleted`, but leaves
  "Show in folder" enabled beside it, and `repoFile()` in `ipc.ts` rejects any path that is not on
  disk. So the one item still offered on a deleted row is the one that cannot work: clicking it
  puts "File not found in the working tree: <path>" in the status bar. Verified over CDP on a
  commit that deletes a file, where the menu came back
  `(disabled) Open file | Show in folder | --- | Copy file path`. Either the item should be
  disabled the same way, or it should reveal the containing folder, which is what a user asking
  "where was this file" actually wants and what `showItemInFolder` can still do for a parent
  directory that exists.
- **Scope:**
  - A commit file row whose file is not in the working tree either disables "Show in folder" the
    way "Open file" is disabled, or reveals the nearest existing parent directory instead of
    failing. Pick one and say which in the log; do not leave an item that only ever errors.
  - The scratch repository gets a commit that deletes a file, so the case is reachable from the
    e2e suite at all: it has none today, and this state had to be created by hand
    (`git rm` + commit on a throwaway branch) to be seen.
  - An e2e assertion on the resulting menu.
  - The same guard for a staging-view row whose file is not in the working tree: a staged or
    unstaged deletion (`kind === 'deleted'`). On the build at ee91d54 the fixture's own staged
    deletion `main.txt` gives `Unstage file | Open file | Show in folder | Copy file path`, and Open
    file puts "File not found in the working tree: main.txt" in the status bar
    (`%TEMP%/gitclient-review/GR-006/05-wip-deleted-row-menu.png`, `05b-after-open-file.png`). It is
    the WIP half of the same hole and, unlike the commit half, needs no new fixture commit.
- **Out of scope:** the rest of the file-row menu (GC-043), `repoFile()`'s path rules.
- **Acceptance:**
  - [ ] On a commit that deletes a file, the row's menu offers no item that fails when clicked.
  - [ ] The scratch repository carries such a commit and an e2e step asserts the menu on it.
  - [ ] On the fixture's staged deletion `main.txt`, and on an unstaged deletion made with `rm`, the
        row's menu offers no item that fails when clicked; the e2e assertion covers the `main.txt`
        row too.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, `npm run e2e`, and the menu read over CDP on the deleting commit.
- **Log:**
  - 2026-09-05 22:45 proposed by GC-043 (this ticket): verifying GC-043's "Open file is disabled on
    a deleted commit file" needed a commit the fixture does not have, and building one by hand
    showed the neighbouring item is offered but always errors.
  - 2026-09-05 23:14 GR-006: extended to the staging rows (`main.txt`, the fixture's staged deletion, offers
    Open file and Show in folder and Open file fails with "File not found in the working tree") and
    raised from P3 to P2: it is a defect in GC-043 as shipped and reachable from the fixture as it
    stands. Board row moved up behind GC-069.


### GC-073 Hide and Solo branches in the graph from the left panel

- **Status:** todo
- **Area:** graph | **Size:** M | **Priority:** P2
- **Depends on:** none
- **Why:** The study records hide/solo toggles on hover on every left-panel branch row and "Hide /
  Show / Solo in graph" in the branch menu (`04-panels.md`, "Left panel (refs)";
  `05-menus-shortcuts.md`, "Branch chip", and the left-panel `main` row whose third-last group is
  `Hide, Pin to Left, Solo`), and defines the header's "Viewing N" as the number of refs currently
  shown. Ours shows every ref always: `getLog` runs `--all`, `LeftPanel` counts
  `local.length + remoteCount + tags.length`, and the branch menu offers Pin to Left with nothing
  beside it (`%TEMP%/gitclient-review/GR-006/07-left-branch-menu.png`). On catena-feed read-only
  (GR-005's `07-catena-feed-columns.png`) that is 881 commits from every branch and tag interleaved
  in date order, with the lanes of long-dead branches holding columns the user cannot reclaim.
  Soloing `master` or hiding a noisy remote is the graph behaviour GitKraken users reach for right
  after checkout, and it is the one left-panel behaviour in the study with no ticket: GC-049 and
  GC-051 both name it out of scope.
- **Scope:**
  - A per-repository hidden set, `gitclient.hidden.<repoPath>` (a JSON array of ref `fullName`s),
    stored the way the pin is (`pinKey` in `App.tsx`) and pruned on every load to refs that still
    exist. The checked-out branch can never be hidden: no toggle on its row, no menu entry.
  - `getLog(cwd, max, exclude)` adds one `--exclude=<fullName>` per hidden ref ahead of `--all`
    (git applies `--exclude` to the `--all` that follows it), so hidden-only commits leave the graph
    and everything reachable from a visible ref stays. `loadRepo(path, maxCommits, exclude)` carries
    it through the type, the `ipc.ts` validation (`strs`) and the preload entry the usual way.
    HEAD is part of `--all` and is never excluded, so column 0 keeps the checked-out lineage whatever
    is hidden.
  - Left panel: an eye toggle on row hover for local and remote branches (a `.row-action` shaped
    like the section head's `.section-action`), the row dimmed with an eye-off icon while hidden;
    "Viewing N" counts only visible refs; a "Show all" action on the Local and Remote section heads
    while anything under them is hidden.
  - Branch menu (chip and left row), local and remote branches: "Hide in graph" / "Show in graph"
    and "Solo in graph", next to Pin to Left. Solo hides every other local and remote branch except
    the checked-out one; tags are untouched.
  - The graph omits the chips of hidden refs (`refsBySha`), so a commit still reachable through a
    visible ref keeps its row without the hidden chip.
  - Fixture note: hiding `wip-branch` alone removes no row, because `origin/wip-branch` still
    reaches `89c9b05`. Decide whether hiding a local branch also hides the upstream its chip absorbs
    (the chip already treats the pair as one ref) and say which in the log.
- **Out of scope:** hiding tags or stashes, hiding a whole remote in one action, the section context
  menu beyond the Show all above, the drag handles, GC-051's folders, any change to lane assignment
  or to the pin.
- **Acceptance:**
  - [ ] Scratch repository: hide `wip-branch` and `origin/wip-branch` — the `Work on wip branch`
        row is gone, `.graph-row` count drops by one, Viewing drops by two, and the commit rows equal
        `git log --exclude=refs/heads/wip-branch --exclude=refs/remotes/origin/wip-branch --all --oneline | wc -l`;
        Show all restores every count.
  - [ ] Solo `feature`: the `main` chip (checked out) and the `feature` chip stay, no
        `wip-branch` or `origin/wip-branch` chip is rendered anywhere, the `Work on wip branch` row
        is gone, and Viewing equals the number of left-panel rows that are not dimmed.
  - [ ] Reload the app: the hidden set survives; `git branch -D` a hidden branch and Refresh: it is
        pruned from `localStorage` and Viewing is right.
  - [ ] e2e step: hide `wip-branch` (and its upstream) from the left row's menu, assert the row count
        and the git count above, Show all, assert restored; the prologue clears `gitclient.hidden.*`
        so a run that dies mid-step does not hide rows for the next.
  - [ ] Screenshots of the left panel with a hidden row and of the graph after Solo, looked at next to
        the study's `08-left-panel-expanded.png` and `02-main-1080.png`.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `src/renderer/src/App.tsx`, `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`, `tools/e2e/run.mjs`,
  `CLAUDE.md` (the localStorage keys, the log command).
- **Verify:** typecheck, build, `npm run e2e`, the CDP checks and screenshots above, then catena-feed
  read-only with `master` soloed for the large-graph look (a read-only load; hiding writes only
  `localStorage`).
- **Log:**
  - 2026-09-05 23:14 proposed by GR-006: the what's-next pass over `04-panels.md` and `05-menus-shortcuts.md`
    against the board — hide/solo is the one left-panel behaviour in the study without a ticket, and
    the branch menu screenshot from this review shows Pin to Left standing alone.

### GC-074 The commit menu's Reset rows do not fit the menu, whichever side gives way

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-067
- **Why:** At the 420px cap the middle Reset row of the commit menu is 7px too wide. On the build at
  ee91d54, measured over CDP with the menu open on `Main-only change`,
  `Reset main to 6ff1f8a: mixed` renders its `.ctx-label` at 166 of 173px — "Reset main to
  6ff1f8a: mi…" (`%TEMP%/gitclient-review/GR-006/06-commit-menu.png`) — while its hint "keep changes
  in the working directory" is whole at 212px; the soft and hard rows fit. GC-067 reverses the flex
  weights so the label wins, and with its rule injected into the same live page the label is whole
  and the hint is cut to 205 of 212px instead: the row still does not fit, the cut only moves. The
  study's Reset is one entry with a three-row submenu (`05-menus-shortcuts.md`: Soft / Mixed / Hard,
  each with a short hint), so the branch and sha are said once; ours says `Reset main to 6ff1f8a`
  three times. GC-049 will put the same group into the branch menu, where longer branch names make
  it worse.
- **Scope:**
  - Say the target once: a caption row (`MenuItem.caption`, which GC-067 adds) reading
    `Reset main to 6ff1f8a`, then three rows labelled `Soft`, `Mixed`, `Hard` (the last still
    `danger`, still behind the same confirm) carrying the current hints. `resetItem` in `App.tsx`
    is the one place to change; if GC-049's helper extraction has landed, it moves with it.
  - Whatever the wording, the acceptance is measured, not eyeballed.
- **Out of scope:** the menu's 420px cap and its colours, the other menus' hints, GC-049's group in
  the branch menu (it inherits this), a real submenu.
- **Acceptance:**
  - [ ] Over CDP with the commit menu open on `Main-only change`: every `.ctx-label` and
        `.ctx-hint` reports `scrollWidth <= clientWidth`; the same with
        `a-very-long-branch-name-for-the-menu` checked out (created, checked out and deleted again in
        the scratch repository only).
  - [ ] The three actions still run and Hard still confirms first: Soft from the menu moves
        `git rev-parse HEAD` to the target and leaves `git status --short`'s staged rows staged; put
        it back with `git reset --soft <previous sha>`.
  - [ ] e2e step 18 still passes (the caption row is not clickable and Escape still closes the menu as
        one layer).
  - [ ] Screenshot looked at next to the study's `05-context-menu-commit.png`.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs` (only if a measurement step is added).
- **Verify:** typecheck, build, the CDP measurement above, `npm run e2e`, screenshot.
- **Log:**
  - 2026-09-05 23:14 proposed by GR-006: the screenshot pass over the commit menu caught "mi…", and injecting
    GC-067's rule into the live page showed the row still 7px too wide with the cut moved to the hint.


### GC-075 A hunk button acts on the previous diff while the new one loads

- **Status:** in-progress
- **Area:** diff | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `DiffView`'s load effect (`src/renderer/src/diff/DiffView.tsx:36-49`) starts the fetch for
  a new `view` but never resets `text`, so the previously loaded diff stays rendered until the new
  one resolves. The header chip (`.file-view-sub .chip`) and the hunk buttons, meanwhile, come
  straight from `view` and flip immediately — so for the length of one IPC round trip the view
  claims to be showing one side of a file while the hunks on screen belong to another. Clicking
  Stage / Unstage / Discard hunk in that window calls `buildHunkPatch` on the stale hunk, and
  `git apply` rejects the mismatched patch into the view's own inline error line. Found while
  verifying GC-062: its step 21 switched `big.txt` from the 1-hunk unstaged side to the 1-hunk
  staged side and clicked Unstage hunk, and git refused the patch because the renderer had handed
  it `row 3 edited` when the index held `row 35 edited`. Nothing is corrupted — git is what stops
  it — but the user sees a failure for a click that looked valid, and the window is wider on a real
  repository than on the seven-commit scratch one. GC-062 worked around it in the test by matching
  the rendered added lines; the renderer should not need that.
- **Scope:**
  - Clear `text` (and `error`) at the top of the load effect so the hunks unmount and the existing
    "Loading diff…" body shows while a load is in flight, instead of the previous diff's rows.
  - Gate the hunk action buttons on that in-flight state the same way `busy` already gates them, so
    a click during the gap is impossible rather than merely rejected.
- **Out of scope:** a spinner or skeleton design for the loading body, cancelling the in-flight IPC
  call, the commit-file side of the same view (it has no action buttons), GC-052's toolbar.
- **Acceptance:**
  - [ ] Over CDP on the scratch repository: stage the second hunk of `big.txt`, click the Staged
        Files row, and read `.file-view .diff-body` immediately — it shows the loading body, not the
        unstaged side's hunk, and the hunk buttons are disabled until the staged diff arrives.
  - [ ] Reverting GC-062's content-keyed `waitDiff` in `tools/e2e/run.mjs` back to a chip + hunk
        count wait leaves step 21 passing, which it does not today (say so in the log).
  - [ ] `npm run e2e` still passes, and no flicker is visible in a screenshot taken mid-load.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css` (only if the
  empty body between diffs reads badly).
- **Verify:** build, the CDP check above, `npm run e2e`, a screenshot of the loading body.
- **Log:**
  - 2026-09-05 proposed by GC-062 (this ticket): step 21's Unstage hunk failed five assertions
    against a perfectly working app, because the view was still rendering the diff it had before
    the click and the button built its patch from that.
  - 2026-09-05 23:35 claimed

### GC-076 Every e2e run leaves a commit behind, and the fixture eventually breaks step 16

- **Status:** in-progress
- **Area:** tests | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** Step 10 clones the bare origin into `clone2`, commits `remote-<stamp>.txt` there, pushes
  it and pulls it into `main` (`tools/e2e/run.mjs:442-457`). Nothing ever removes it: the commit
  stays on `main` and on the bare origin, and the prologue does not reset either. So the fixture
  grows by a commit and a file on **every** run, and `npm run e2e:setup` is the only thing that
  puts it back. Measured during GC-062's verification: 7 commits at setup, 9 after one run, and
  **44** after the batch's runs — at which point step 16's `matches are highlighted and the rest
  dimmed` assertion failed reading `matches: 0, dimmed: 39` while the readout correctly said
  `1 of 1` and the right row was selected. The rows are virtualised, so once the history is long
  enough the single matching row is outside the rendered window at the moment the assertion reads
  the DOM. The suite is the batch routine's own verification tool, so a failure that depends on how
  many times it has been run is worse than the bug it would catch: it looks like a regression in
  whatever ticket is in flight. A fresh `npm run e2e:setup` made the same run pass, which is how
  the drift was identified rather than the ticket blamed.
- **Scope:**
  - Step 10 undoes itself: after the pull assertions, drop the commit from the working clone and
    from the bare origin (and remove `clone2`), so a finished run leaves `main` where it found it.
  - The prologue removes any `Commit from another clone` commit and `remote-*.txt` file a run that
    died inside step 10 left behind, the way the GC-062 blocks do for steps 20 and 21.
  - The fixture's commit count becomes an invariant the run can state: assert at the end that
    `git rev-list --count HEAD` matches what `setup-testrepo.mjs` creates, so the next drift of
    this kind fails loudly and names itself instead of surfacing as an unrelated step's flake.
- **Out of scope:** step 16's own assertion (it is correct — it is the fixture that moved), making
  the graph search scroll a match into view before asserting (that is the test's existing
  `searchStateAtTop()` discipline and it works on the fixture as designed), GC-064's concurrent-root
  marker, GC-055's and GC-056's fixture changes.
- **Acceptance:**
  - [ ] `npm run e2e` five times in a row without an intervening `e2e:setup`, all passing, with
        `git rev-list --count HEAD` and `git ls-remote origin` identical before the first and after
        the fifth.
  - [ ] Killing a run inside step 10 and running again passes, with no `Commit from another clone`
        left on `main` or on the bare origin.
  - [ ] The count invariant fails the run when a commit is added to the fixture by hand.
- **Files:** `tools/e2e/run.mjs`, and `tools/e2e/setup-testrepo.mjs` only if the expected count is
  better exported from there than restated.
- **Verify:** the three checks above, and `npm run e2e:setup && npm run e2e` once normally.
- **Log:**
  - 2026-09-05 proposed by GC-062 (this ticket): eight verification runs grew the scratch repository
    from 7 commits to 44 and broke a search assertion that has nothing to do with the batch.
  - 2026-09-05 23:35 claimed

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

### GR-003 Backlog review 2026-09-05 20:11

- **Status:** done
- **Window:** 9052efe..766b4de
- **Log:**
  - 2026-09-05 20:11 shipped: GC-024 (`prefs.test.ts`, seven tests: defaults, blob round trip,
    per-field fallback, malformed JSON, the legacy migration in both directions, and `setPrefs`
    merging, persisting and notifying, reached through a `vi.mock('react')` of
    `useSyncExternalStore`), GC-042 (one byte: the raw NUL in `shortcuts.test.ts` became the
    `\u0000` escape and the file is text again), GC-039 (a `layerState()` helper and e2e step
    18 guarding GC-034, GC-037 and GC-038; 49 assertions became 60), GR-002's own follow-up
    replacing two stray NULs in this file, and GC-030, which landed at 20:06 while this review was
    waiting for a clean `TICKETS.md`: the window was extended to it, its diff read (the query
    moved into `App`'s `search` state, `closeSearch` the only thing clearing it, Escape and
    the toolbar button closing the diff first, `lastNeedle` seeded from the first render so a
    remount does not re-select; e2e step 16 gained the round trip through a
    `searchStateAtTop()` that compares from a fixed scroll position because the rows are
    virtualised, plus a `waitFor` helper) and its two follow-up tickets GC-048 (toolbar labels
    overflow their 52px button) and GC-049 (branch menu missing the tip-commit group, requested by
    Ricardo) read for deduplication — neither overlaps a ticket below. GC-030 was `in-progress`
    for most of the review and was not touched. Read as a reviewer: GC-024's `freshPrefs()`
    re-import is the right way round the import-time `load()`, and its `not.toBe(DEFAULT_PREFS)`
    line guards the defaults object against mutation; the React mock exports only
    `useSyncExternalStore`, which is all `prefs.ts` imports, so it fails loudly rather than
    silently if that ever changes. GC-039's step 18 does what its log says and its 60 assertions
    were reproduced here; its mutation checks rest on the log alone, as they need source edits to
    repeat. Its one weakness is eleven new fixed `sleep(300)` waits (GC-053). GC-030's
    `waitFor` records a failed check and lets the step continue on timeout, which is the right
    shape for a suite that reports every assertion. GC-042 leaves its second acceptance box
    unticked with a written reason, correctly. Every ticket in the window has a `Depends on` line
    and every ticked box has evidence in its log.
  - health: typecheck ok, tests 37 passed (4 files), build ok, in the detached worktree at
    512ce06 with `node_modules` junctioned from the main checkout (766b4de landed after the
    worktree was cut; its own log reports typecheck, build, 37 tests and 63 e2e assertions). For
    the first time a review also ran `npm run e2e`, on port 9336 against its own scratch
    repository: 60 assertions at 512ce06, ALL PASSED, exit 0, and the run stopped its own Electron.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, stopped
    afterwards by pid. Screenshots in `%TEMP%/gitclient-review/GR-003/`, all looked at:
    `01-graph.png` (seven rows, lanes continuous through the merge, chips folding at 150px,
    `main` absorbing `origin/main`, WIP `+1 ✎3 −1`), `02-commit-selected.png` (merge commit:
    sha, refs, message box, initials avatar, two parent links, `+1 added`, `feature.txt`),
    `03-wip-staging.png` (Unstaged 3 / Staged 2, commit form with the 72 counter),
    `04-diff.png` (two-hunk `big.txt`, Stage / Discard hunk, icon rail with counts, the file
    highlighted in the panel) and `05-catena-feed-wip.png` (catena-feed read-only: 881 commits,
    `Viewing 341`, 6 local and 52 remote branches; the checked-out `008-page-monitor-port` runs
    straight down column 0 to v1.86.0 while master's four newer commits sit in lane 1 and join
    there, which is the right shape; sixteen visible branch names truncate at 220px). Against the
    study: the file view has no previous/next change, ignore-whitespace or wrap control (GC-052);
    neither side panel resizes where the study drags both (GC-050); slash-separated branch names
    stay flat where the study folds them (GC-051). A first load with a mangled path put
    `spawn git ENOENT` in the empty state and the status bar for a folder that does not exist,
    the same text GC-025 fixes for a missing git, so GC-025 was extended instead of a new ticket.
  - tickets: added GC-050 (P2, ui), GC-051 (P3, ui), GC-052 (P3, diff), GC-053 (P3, tests);
    extended GC-025 with the missing-folder case. Board: GC-050 after the worker's GC-049 as the
    last P2 (half-day study gaps, with recents and the branch menu ahead of it because they are
    the more frequent needs); GC-053 after GC-036 with the other e2e hygiene; GC-051 and GC-052
    after GC-045 with the small study-gap P3s. No existing row moved. Blocked GC-017 and GC-018
    still wait on Ricardo's decisions; nothing new to unblock them.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through GC-030. Its Testing paragraph says
    "All 62 assertions passed on the last run" while GC-030's log says 63 for the same run; one
    of the two is off by one and the next ticket touching `run.mjs` (GC-053 fits) should count
    and fix it. The launcher header still names `--keep-alive` while the code reads
    `--keep-running` (GC-041 stands).

### GR-004 Backlog review 2026-09-05 21:25

- **Status:** done
- **Window:** 766b4de..850a9cd
- **Log:**
  - 2026-09-05 21:25 shipped: cf86fdf (GC-025 missing-git message told apart from a missing
    folder by an `existsSync` guard before every spawn, `checkGit` probing in the home directory;
    GC-020 pin ranked second; GC-036 prologue pops the stranded named stash; GC-041 launcher
    header; GC-047 `repo-hygiene.test.ts`; GC-048 toolbar buttons sized to their labels),
    c3426c6 (GC-031 `defaultRemote` in `src/shared/remotes.ts` used by main and renderer, one
    push entry per remote in the branch and tag menus, the Push title naming its remote, e2e
    step 17 pushing `push-target` to the added remote), 42f3618 (the routine protocol became a
    batch orchestrator dispatching one subagent per ticket), a5f21b9 (GC-019 `atRisk` filter
    and the count in the prompt, GC-022 `onMoreEnter` measuring three rects and adding
    `.flip-up`, GC-046 two vitest projects split by extension with `Preferences.test.tsx`,
    GC-054 `attachTarget` in the launcher) and 850a9cd, the claim of GC-032, GC-011, GC-053 and
    GC-059, which were `in-progress` throughout and were not touched. Read as a reviewer: the
    `existsSync` guard is the only thing that can separate the two `ENOENT`s and it runs before
    every spawn, correct; `error !== gitError` keeps the empty state from printing the sentence
    twice. The pin rank memo now depends on `pinnedName`, which it had to. GC-031 leaves
    `remote` unset on the single-remote path so main resolves it and passes it explicitly on the
    multi-remote path, so label and push agree; the per-remote e2e assertion is still blind
    because both remotes are one bare repository (GC-056 stands). GC-019's filter
    (`staged === null && unstaged === 'untracked'`) matches exactly the shape the status parser
    emits for untracked rows. GC-022 forces the list visible for one measurement inside the
    handler and restores it in the same task, so nothing paints in between. GC-054 tells "port
    silent" from "port answering but no page yet" and documents that `--visible` has nothing to
    act on when attaching. GC-047's skip list is narrow (`.png`, `.woff2`, `.ico`) but nothing
    else binary lives under the scanned trees today. Every ticked box in the window has evidence
    in its log; GC-037's second box stays unticked with its written reason; every ticket in the
    window has a `Depends on` line.
  - health: typecheck ok, tests 45 passed (7 files, 44 in the node project and 1 in the dom
    project), build ok, in the detached worktree at 850a9cd with `node_modules` junctioned from
    the main checkout. `GITCLIENT_E2E_PORT=9336 npm run e2e` against the review's own scratch
    repository: 66 assertions, ALL PASSED, exit 0, and the run stopped its own Electron (the
    count matches `CLAUDE.md`'s Testing paragraph).
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`,
    stopped afterwards by pid. Screenshots in `%TEMP%/gitclient-review/GR-004/`, all looked at:
    `01-graph.png` (seven rows, lanes continuous through the merge, `main` absorbing
    `origin/main` with the cloud mark, WIP `+1 ✎3 −1`; but every ref row shows one chip plus
    `+1`, and CDP read `--ref-col-w` as 100px with `gitclient.refColW = "100"` in
    `localStorage`, left there by GC-022's hand check in the profile every launch shares, so
    GR-003's "chips folding at 150px" also described a 100px column, see GC-060),
    `02-commit-selected.png` (merge commit: sha, ref list with a title tooltip, message box,
    initials avatar, two parent links, `+1 added`, `feature.txt`), `03-wip-staging.png`
    (Unstaged 3 / Staged 2, commit form with the 72 counter), `04-diff.png` (`a.txt`, one hunk
    with Stage / Discard hunk, icon rail 3 / 3 / 1 / 0, the file highlighted in the panel),
    `05-preferences.png` (four rows under Appearance and Behaviour, applied live, Close),
    `06-shortcuts.png` (five groups rendered from the table), `07-detached-head.png` (after
    `git checkout --detach HEAD~1` in the scratch repository: breadcrumb and staging header read
    "detached HEAD", column 0 follows the detached commit, Push disabled, but no chip marks the
    checked-out commit and the Push title still promises "Push to origin and set upstream",
    GC-061), `08-catena-feed-top.png` and `09-catena-feed-scrolled.png` (catena-feed read-only:
    881 commits, `Viewing 341`, 6 local and 52 remote branches; at `scrollTop` 12000 of 24696
    the 40 rendered rows keep every lane continuous, tags `v1.41.0` to `v1.43.0` each on their
    row, a remote chip in lane 2's colour, no lane break at either end of the window). Also
    checked over CDP: the title bar's `+` "New tab" button has no click handler (folded into
    GC-044); `%APPDATA%/gitclient` is the one Electron profile (its `DevToolsActivePort` was
    rewritten by this review's launch and its `LOCK` dates from 12:42, Ricardo's own start).
    Read for the review but not ticketed: the e2e step list has no step that commits through
    the commit form or stages a hunk (GC-062).
  - tickets: added GC-060 (P1, infra), GC-061 (P2, graph), GC-062 (P2, tests); extended GC-044
    with the inert New-tab button. Board: GC-060 is the first `todo` row, right after the
    in-progress batch, because it is small, changes state Ricardo sees in his own app and
    corrupts the evidence every review relies on; GC-061 and GC-062 sit after GC-049 and before
    GC-050, a visible correctness gap and the suite's largest blind spot ranking above the panel
    drag handles. No other row moved. GC-058's dependencies (GC-022, GC-046) are both `done`
    now, so it is eligible where it sits. Blocked GC-017 and GC-018 still wait on Ricardo's
    decisions; nothing new to unblock them.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through GC-054 and its Testing paragraph's
    66 matches this run. Its Graph section's "the default 150px still shows two" is true of the
    code but not of any unattended screenshot taken since GC-022's check (GC-060 explains why).
    GR-003's log line "chips folding at 150px" describes a 100px column; left as written.


### GR-005 Backlog review 2026-09-05 22:23

- **Status:** done
- **Window:** 850a9cd..3e97244
- **Log:**
  - 2026-09-05 22:23 shipped: 243ff28 (GC-032 optional AUTHOR / DATE / TIME / SHA columns behind
    `prefs.graphColumns` with a per-column fallback and a `defaults()` copy; GC-011 `watch.ts`,
    one recursive `fs.watch` per window pushing `repo:changed` with a 300ms debounce, the bare
    `.git` event dropped, the renderer parking a change that arrives while `busy` and flushing
    it once; GC-053 `waitFor` replacing 61 fixed sleeps in `run.mjs`; GC-059
    `launch-app.test.ts` proving `--keep-running` attaches against a fake CDP endpoint), 394566f
    (GC-032's log saying what `02-main-1080.png` could and could not confirm) and 4be7ee1
    (GC-060 per-port Electron profiles through `GITCLIENT_USER_DATA` set at module scope; GC-063
    `watch.test.ts` with `toRel`, `ignored` and `scopeOf` exported; GC-044 `gitclient.recentRepos`,
    the crumb and the title bar's `+` opening the recents menu, the empty state repeating the
    list; GC-058 `CommitGraph.test.tsx` for the folded-refs flip). 3e97244 is the claim of GC-065,
    GC-043, GC-023 and GC-066, `in-progress` throughout and not touched. Read as a reviewer: the
    watcher's renderer half is sound on the path it was written for — `refreshStatus` depends only
    on `repo`, so the watch effect never restarts mid-debounce, and a change during an action is
    applied exactly once — but neither `applyChange` nor `refreshStatus` checks that nothing newer
    landed while its promise was pending, so a slow background load can overwrite a fresher
    snapshot (GC-068). GC-044 drops a recents entry on any failed load, not only a missing folder,
    which is what its scope asked for; with git missing from PATH every entry clicked would vanish,
    left as a note. GC-032's `localDateTime` builds the string from parts rather than
    `toLocaleString`, which keeps the field order fixed as its comment says. GC-060's profile
    override runs at module scope before `app.whenReady`, as it must. GC-058's hover is fired as
    `mouseOver` for the reason its comment gives. GC-059's test lives in the renderer tree with a
    paragraph explaining why, the second such test (GC-070). Every ticked box in the window has
    evidence in its log; GC-044's fourth box is unticked with a written reason and GC-065 filed for
    it; every ticket in the window has a `Depends on` line.
  - health: typecheck ok, tests 68 passed (10 files: 64 node, 4 dom), build ok, in the detached
    worktree at 3e97244 with `node_modules` junctioned from the main checkout.
    `GITCLIENT_E2E_PORT=9336 npm run e2e` against the review's own scratch repository: 66
    assertions, ALL PASSED, exit 0, the run stopping its own Electron — with the watcher live
    underneath the whole suite for the first time.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, stopped
    afterwards with `stopPort(9334)` (no electron.exe with 9334 on its command line remained).
    GC-060 confirmed on the way in: the 9334 profile read `gitclient.refColW` null, `--ref-col-w`
    150px and `gitclient.prefs` null, so the 100px column GR-004 found is gone and every ref row
    shows two chips again. Screenshots in `%TEMP%/gitclient-review/GR-005/`, all looked at:
    `01-graph.png` (seven rows, lanes continuous through the merge, `main` absorbing
    `origin/main` with the cloud mark and `v0.1.0` beside it, WIP `+1 ✎3 −1`),
    `02-commit-selected.png` (merge commit: sha, ref list, message box, initials avatar, two
    parent links, `+1 added`, `feature.txt`), `03-wip-staging.png` (Unstaged 3 / Staged 2,
    commit form with the 72 counter), `04-diff.png` (two-hunk `big.txt` with Stage / Discard
    hunk, icon rail 3 / 3 / 1 / 0, the file highlighted in the panel),
    `05-recents-dropdown.png` (the crumb menu anchored at the crumb's bottom-left, 420px wide,
    the folder name squeezed to `t…` and the 61-character path shown in full — GC-067),
    `06-graph-columns.png` (all three columns on: AUTHOR / DATE / TIME / SHA header labels, rows
    still 28px, `.graph-body` not scrolling horizontally, the `Extend feature` summary truncated
    while its body preview keeps its width — GC-069), `07-catena-feed-columns.png` (catena-feed
    read-only with the columns on: 881 commits, `Viewing 341`, 40 rows rendered, dates
    `27/08/2026, 13:18` and authors in the new cells, gravatars and initials mixed, lanes
    continuous past `master` and the `v1.86.x` tags, the message column down to about 115px
    with `fix(… Signed-o…` rows) and `08-preferences.png` (the new GRAPH group with three
    toggles between Appearance and Behaviour). The watcher was probed live for the first time:
    an untracked file written into the scratch working tree took the WIP counts from `1 3 1` to
    `2 3 1` and the staging header to `6 file changes` within 1.5s with no click, `git branch`
    took LOCAL from 3 to 4 and `Viewing` from 7 to 8, and removing both restored every count;
    `git status --short` afterwards matched the setup's mixed tree exactly.
  - tickets: added GC-067 (P1, ui), GC-068 (P1, actions), GC-069 (P2, graph), GC-070 (P3,
    tests). No existing ticket extended. Board: GC-067 and GC-068 are the first two `todo` rows,
    ahead of GC-049, because both are defects in work shipped this window; GC-069 sits after
    GC-061 with the P2 graph work and before GC-062; GC-070 after GC-055 with the P3 test hygiene.
    No other row moved. Blocked GC-017 and GC-018 still wait on Ricardo's decisions; nothing new
    to unblock them. The in-progress batch touches `ContextMenu.tsx`, `UiContext.tsx` and
    `app.css`, which GC-067 also names; it waits for that batch to close, as the protocol already
    requires.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through 4be7ee1 (GC-060, GC-063, GC-044,
    GC-058); its Testing paragraph's 66 assertions and its Unit tests paragraph's 68 tests both
    match this run. Its Unit tests section documents the renderer-tree placement of the two tools
    tests as a deliberate choice; GC-070 proposes changing that, and the section changes with it.

### GR-006 Backlog review 2026-09-05 23:14

- **Status:** done
- **Window:** 3e97244..ee91d54
- **Log:**
  - 2026-09-05 23:14 shipped: dcff889 (GR-005's review), 1697049 (GC-065 the screenshot audit,
    `09-repo-dropdown.png` and `10-branch-dropdown.png` marked unusable at every citation; GC-043 the
    file-row context menu with `fileMenuItems` in `App.tsx`, the `shell:*` channels behind
    `repoFile()` and a `window.shell` bridge, e2e step 19; GC-023 the
    `.ref-chip:not(:first-child):not(.more)` shrink rule; GC-066 the dropdown toggle through
    `MenuAnchor.owner` and a capture-phase mousedown registered at provider mount, with
    `UiContext.test.tsx`), 81b15e0 (Ricardo rebalancing this review routine toward the UI and
    what's-next passes) and ee91d54, the claim of GC-067, GC-062 and GC-070, `in-progress` throughout
    and not touched. Read as a reviewer: `repoFile()` resolves against the repository and refuses
    `''`, `..`, `../`, `..\\` and an absolute remainder, so another drive and a traversal through a
    real file are both caught; it does not follow symlinks, noted and not ticketed. `fileMenuItems`
    guards Open file on a commit row whose `kind` is `deleted` and nothing else, so the staging
    list's own deletion rows (the fixture's `main.txt`) offer Open file and Show in folder and both
    fail — GC-072 extended. GC-023's rule assumes the first child of `.col-ref` is a chip, which it
    is (the `.ref-line` connector comes last). GC-066's two refs are read within one gesture, as the
    comment says, and both halves of the condition are mutation-checked in the log. Every ticked box in
    the window has evidence in its log; GC-023's first box is unticked with a written reason and
    GC-071 filed for it.
  - health: typecheck ok, tests 72 passed (11 files: 64 node, 8 dom), build ok, in the detached
    worktree at ee91d54 with `node_modules` junctioned from the main checkout.
    `GITCLIENT_E2E_PORT=9336 npm run e2e` against the review's own scratch repository, twice: the first run 69 of 71 assertions, 2 failed in step 5 (the named-stash dialog never opened because the app's status read clean after an external stash pop and a Refresh — logged under GC-068 as its first sighting on the fixture, `e2e-run1.log`); the second run 71 assertions, ALL PASSED, exit 0 (`e2e-run2.log`). Both runs stopped their own Electron on 9336.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, stopped
    afterwards with `stopPort(9334)` (no electron.exe with 9334 on its command line remained; the e2e
    runs on 9336 stopped their own). The 9334 profile still holds GR-005's `graphColumns` toggles, so
    every screenshot shows AUTHOR / DATE / TIME / SHA on. Screenshots in
    `%TEMP%/gitclient-review/GR-006/`, all looked at: `01-graph.png` (seven rows plus WIP, lanes
    continuous through the merge, `main` absorbing `origin/main` with the cloud mark and `v0.1.0`
    beside it, `wip-bran…` / `orig…` and `featu…` / `origin/f…` both truncated at 150px as
    expected), `02-commit-selected.png` (merge commit: sha, ref list truncated to `origin/m…`, message
    box, initials avatar, two parent links wrapping to a second line, `+1 added`, `feature.txt`),
    `03-wip-staging.png` (Unstaged 3 / Staged 2, the 72 counter), `04-diff.png` (two-hunk `big.txt`,
    icon rail 3 / 3 / 1 / 0), `05-wip-deleted-row-menu.png` and `05b-after-open-file.png` (the staged
    deletion's menu, then "File not found in the working tree: main.txt" in the status bar — GC-072),
    `06-commit-menu.png` (rotating surface: Checkout detached | Create branch / tag | Cherry pick,
    Revert | three Reset rows, the middle one reading `mi…` — GC-074, measured 166/173px before and
    205/212px on the hint after GC-067's rule was injected), `07-left-branch-menu.png` (rotating:
    Checkout, Merge, Rebase | Create branch | Pin to Left | Rename, Push and set upstream | Delete |
    Copy branch name — no hide/solo, GC-073; the tip-commit group is GC-049), `08-shortcuts.png`
    (rotating: the `?` overlay's five groups, Close button, graph dimmed behind it). Compared with
    `04-panels.md` and `05-menus-shortcuts.md` rather than a matching capture for the menus, since
    GitKraken's are native and the study's `06-context-menu-branch.png` shows the chip menu.
  - what's next: the study's left panel has hide/solo toggles and a "Viewing N" that counts shown
    refs; ours has neither and no ticket covered it (GC-049 and GC-051 both name it out of scope), so
    GC-073. Also noted for a later review, not ticketed: the Path | Tree toggle both file lists carry
    in the study (`04-panels.md`, staging and commit views) — the fixture has no nested path, so a
    ticket would have to change the fixture first, which GC-072 and GC-055 are already lined up to do.
  - tickets: added GC-073 (P2, graph, from the what's-next pass) and GC-074 (P3, ui, from the
    screenshot pass, depends on GC-067); extended GC-072 with the staging-row half of its hole, raised
    it to P2 and moved its board row up behind GC-069; GC-071 now depends on GC-055 as well, with log
    lines on both; GC-068 got the e2e evidence above. Board: GC-073 sits after GC-050 as the last P2
    row, GC-074 after GC-071 in the P3 block. Nothing else moved. Blocked GC-017 and GC-018 still wait
    on Ricardo's decisions. GC-040 checked against `run.mjs`: still one `stopApp()` on the last line,
    so the ticket stands.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through 1697049 (GC-065, GC-043, GC-023,
    GC-066); its Testing paragraph's 71 assertions and its Unit tests paragraph's 72 tests both match
    this run. GC-070, in progress, will change the Unit tests section's placement paragraphs.
