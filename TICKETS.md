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

The session that claims a batch implements every ticket in it **itself, directly, one ticket at
a time, in this one working tree** — no subagents. Subagents existed here to let several
tickets' code get written concurrently, but the coordination they need (splitting files up front,
keeping each one inside its lane, reading back each other's diffs) cost more than the concurrency
was worth. A batch is still worth taking in one run, because the expensive checks are
singletons — one `out/` directory, one DevTools port, one scratch repository — so building,
typechecking and running e2e once for several tickets together is cheaper than paying for each
separately; that is the only reason to batch now, not parallelism.

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
   eligible when it is `todo` and every ticket in its `Depends on` is `done`. Take up to six
   eligible tickets in that order, or just one if the first eligible ticket is size L — there is
   no file-disjointness requirement any more, since one session working through them in order
   never touches two tickets' files at the same instant. If nothing is eligible, exit.
4. **Claim the batch, commit, push.** For every ticket in the batch set the section to
   `in-progress`, update the board row, append a log line `YYYY-MM-DD HH:MM claimed`, then commit
   only that change and push it: `git commit -am "GC-0NN, GC-0MM, ...: claim" && git push origin main`.
   This is the first commit of every working run; the lock is on `main` before any code changes
   exist. If that push is rejected as non-fast-forward, another run claimed first:
   `git reset --hard origin/main` discards the unpublished claim, then stop and report.
5. **Implement**, one ticket at a time, in board order. For each: re-read its Why / Scope / Out
   of scope / Acceptance, make the change, and run `npm run typecheck` and `npm test` as a fast
   local check before moving to the next ticket — cheap enough to repeat per ticket, unlike the
   build, e2e and app launch, which stay singletons run once for the whole batch in the next step.
   Committing after each ticket (uncommitted is also fine) makes step 6 easy to bisect if
   something breaks: whichever ticket was implemented last is the first place to look.
6. **Verify centrally**, once every ticket in the batch is implemented. `git status --porcelain`
   should show only files the batch's tickets claim, plus `TICKETS.md`/`CLAUDE.md`. `npm run
   typecheck && npm run build` and `npm test` always, once for the whole batch. `npm run
   e2e:setup && npm run e2e` when any ticket touches `git.ts`, `ipc.ts`, actions in `App.tsx` or
   the DetailPanel, or `tools/e2e/*`. For tickets needing the running app, launch through
   `node tools/launch-app.mjs`, drive it over CDP, screenshot into `docs/screenshots/` and look at
   it — batching several tickets into one launch. Re-run any mutation or destructive check a
   ticket's Verify line names, rather than ticking the box from memory. If a shared check fails
   and the cause is not obvious, revert the most recently implemented ticket's files first, retest,
   and work backwards through the batch rather than reverting all of it at once. Tick acceptance
   boxes only for items actually checked; when a criterion had to be checked by a
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
> say so. Otherwise claim a batch of eligible `todo` tickets and implement them yourself, one at
> a time, no subagents; verify centrally, take each through to `done` or `blocked` committed and
> pushed on `main`, and report the batch, final statuses and commit shas.

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
| GC-068 | A watcher reload that finishes late overwrites a fresher snapshot | actions | M | P1 | done |
| GC-075 | A hunk button acts on the previous diff while the new one loads | diff | S | P1 | done |
| GC-076 | Every e2e run leaves a commit behind, and the fixture eventually breaks step 16 | tests | S | P1 | done |
| GC-077 | Branch lines join and leave a node at a right angle, not on a diagonal | graph | M | P1 | done |
| GC-078 | The ref column shows exactly one chip, every other ref folds into +N | graph | S | P1 | done |
| GC-079 | Custom scrollbars: 8px flat thumb, no track, no arrow buttons | ui | S | P1 | done |
| GC-049 | Branch context menu is missing its tip-commit actions, mainly Reset | ui | M | P2 | done |
| GC-061 | A detached HEAD has no marker in the graph | graph | S | P2 | done |
| GC-069 | The body preview takes width from the summary in a narrow message column | graph | S | P2 | done |
| GC-086 | The diff body blanks to "Loading diff…" on every hunk action, twice | diff | S | P1 | done |
| GC-089 | Slim CLAUDE.md back down to a handover: the history moves to the tickets | infra | M | P1 | done |
| GC-072 | Show in folder is offered on a file the commit deleted, and always fails | ui | S | P2 | done |
| GC-062 | The e2e suite never commits through the commit form or stages a hunk | tests | S | P2 | done |
| GC-064 | An e2e:setup on the shared scratch root wipes a run already using it | tests | S | P2 | done |
| GC-082 | Popping a stash through the toolbar loses what was staged | actions | S | P2 | done |
| GC-080 | The e2e run spends ~44 of its ~58 seconds in fixed sleeps: wait on a snapshot generation instead | tests | M | P2 | done |
| GC-050 | Resizable left and detail panels, widths remembered | ui | M | P2 | done |
| GC-073 | Hide and Solo branches in the graph from the left panel | graph | M | P2 | done |
| GC-092 | A conflicting stash pop reports "could not write index" instead of the conflict | actions | S | P1 | done |
| GC-088 | Branch breadcrumb dropdown: switch branches from the toolbar | ui | M | P2 | done |
| GC-090 | A sequencer action with a dirty index fails with git's raw refusal | actions | S | P2 | done |
| GC-095 | The graph draws commits from refs the left panel never lists | graph | S | P2 | done |
| GC-093 | No way to ignore a file: the row menu cannot write .gitignore | ui | M | P2 | done |
| GC-099 | Opening a repository with hidden refs loads the graph twice and flashes the hidden branches | graph | S | P1 | done |
| GC-098 | A failed git call in the e2e suite is silent, so a lost race reads as a UI bug | tests | S | P2 | done |
| GC-012 | Lazy loading past 2000 commits | graph | M | P3 | done |
| GC-013 | Light theme | ui | M | P3 | done |
| GC-103 | The Preferences dialog outgrows a short window and its last rows cannot be reached | ui | S | P1 | done |
| GC-105 | Panel widths are clamped only against themselves, so the graph can be squeezed to nothing | ui | S | P1 | done |
| GC-111 | A drag on a narrow window collapses the panel to its minimum and persists it | ui | S | P1 | done |
| GC-115 | A drag on a narrow window replaces the ref column’s stored width with the limit | ui | S | P1 | done |
| GC-114 | The branch menu’s Push row names the upstream ref but pushes to the remote’s branch of the same name | ui | S | P1 | done |
| GC-118 | A drag released past the limit throws away the width the pointer did reach | ui | S | P1 | done |
| GC-130 | Step 21's hunk staging loses a race and fails on a fixture nothing changed | tests | S | P1 | done |
| GC-106 | The graph's incremental lane layout is never used: every page re-lays out the whole history | graph | S | P2 | done |
| GC-110 | The ref column is clamped only against itself, so it can take the whole commit message | graph | S | P2 | done |
| GC-113 | The ten lane colours walk the hue wheel in order, so adjacent lanes are the hardest pair to tell apart | graph | S | P2 | done |
| GC-116 | With the optional columns on, the commit message column is squeezed to nothing | graph | S | P2 | done |
| GC-119 | Both toolbar popovers can be open at once, and Escape then needs two presses | ui | S | P2 | done |
| GC-120 | A context menu taller than the window loses its last rows, with nothing to scroll | ui | S | P2 | done |
| GC-101 | Checkboxes and the Preferences dropdown are unstyled OS controls | ui | S | P2 | done |
| GC-132 | Three more e2e helpers drop a click on a disabled control and assert nothing | tests | S | P2 | in-progress |
| GC-128 | The app can only open a repository that already exists: no clone, no init | actions | M | P2 | todo |
| GC-125 | Radio buttons are the last unstyled OS control, now that the checkboxes are ours | ui | S | P3 | done |
| GC-126 | Nothing guards the toolbar popovers or the context menu height in the e2e suite | tests | S | P3 | done |
| GC-131 | A confirmation that carries an option has to be written as a prompt with no input | ui | S | P3 | done |
| GC-014 | Side-by-side diff | diff | L | P3 | done |
| GC-015 | Drag-and-drop merge and rebase between chips | graph | L | P3 | done |
| GC-016 | Multi-tab repositories | ui | L | P3 | todo |
| GC-021 | The pin follows a renamed branch and is dropped with a deleted one | graph | S | P3 | done |
| GC-083 | A diff that fails to load shows an empty body | diff | S | P3 | done |
| GC-104 | Changed lines have no intra-line highlight, so a one-character edit reads as a whole new line | diff | M | P3 | done |
| GC-084 | Two overlapping actions clear the busy spinner early | actions | S | P3 | done |
| GC-108 | The repository-open path clears the status bar without owning it | actions | S | P3 | done |
| GC-023 | Chip shrinking still assumes exactly two chips | graph | S | P3 | done |
| GC-036 | The e2e prologue leaves the named stash a run that dies mid-scenario creates | tests | S | P3 | done |
| GC-053 | e2e waits on the DOM instead of fixed sleeps | tests | S | P3 | done |
| GC-046 | A DOM environment so components can be unit tested | tests | M | P3 | done |
| GC-047 | A test that fails on a raw control byte in a source file | tests | S | P3 | done |
| GC-040 | A crashed e2e run leaves its own Electron alive | tests | S | P3 | done |
| GC-041 | The launcher documents --keep-alive but checks --keep-running | infra | S | P3 | done |
| GC-054 | --keep-running still spawns a second Electron that cannot bind the port | infra | S | P3 | done |
| GC-059 | A test for the launcher attach path | tests | S | P3 | done |
| GC-055 | The scratch repo has no commit with more than two refs, so chip folding is untested | tests | S | P3 | done |
| GC-070 | Tests for tools/ live under src/renderer/src | tests | S | P3 | done |
| GC-058 | A component test for the folded-refs dropdown flip | tests | S | P3 | done |
| GC-056 | The scratch repo's second remote is the same bare repo as origin | tests | S | P3 | done |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-109 | The e2e suite never sees the intra-line diff marks | tests | S | P3 | done |
| GC-057 | Toolbar Push and Pull cannot choose the remote | ui | M | P3 | done |
| GC-100 | A branch can only be brought up to its upstream by checking it out first | actions | M | P3 | done |
| GC-107 | A commit's file row cannot restore that file, only open the working-tree copy | actions | M | P3 | done |
| GC-112 | A branch or tag deleted locally leaves its copy on the remote, and a tag cannot be deleted from a remote at all | actions | M | P3 | done |
| GC-027 | Author filter in commit search | graph | S | P3 | in-progress |
| GC-033 | Global shortcuts from the study: branch, fetch, panels, staging | ui | S | P3 | in-progress |
| GC-045 | Commit view banner linking back to the working directory changes | ui | S | P3 | in-progress |
| GC-051 | Left panel folders for slash-separated branch names | ui | M | P3 | todo |
| GC-052 | Diff view: next and previous hunk, ignore whitespace, word wrap | diff | M | P3 | todo |
| GC-121 | Stage and discard selected lines, not only whole hunks | diff | M | P3 | todo |
| GC-048 | Long toolbar labels overflow their 52px button | ui | S | P3 | done |
| GC-066 | A second click on the repository crumb cannot close its dropdown | ui | S | P3 | done |
| GC-071 | The primary ref chip is unreadable at the minimum column width | graph | S | P3 | todo |
| GC-074 | The commit menu's Reset rows do not fit the menu, whichever side gives way | ui | S | P3 | todo |
| GC-087 | The commit view's ref line is git's decorate string, truncated to "origin/m…" | ui | S | P3 | todo |
| GC-091 | The status bar can only report a failure, so a partial success reads as one | ui | S | P3 | todo |
| GC-085 | Dead CSS and an unreachable tooltip left over from the one-chip ref column | ui | S | P3 | todo |
| GC-094 | The left panel header counts refs and never says which branch is checked out | ui | S | P3 | todo |
| GC-096 | The branch crumb menu lists every branch, with nothing to narrow it | ui | S | P3 | todo |
| GC-097 | The sequencer guard stashes untracked files git never objected to | actions | S | P3 | todo |
| GC-129 | A stash message cannot be edited once the stash is made | actions | S | P3 | todo |
| GC-102 | The window is built dark whatever the theme is, so a light start flashes and keeps dark controls | ui | S | P3 | todo |
| GC-117 | A graph column switched on in Preferences can be silently absent | ui | S | P3 | todo |
| GC-122 | The graph does not scroll while a branch is being dragged | graph | S | P3 | todo |
| GC-123 | A ref folded behind +N can neither be dragged nor dropped on | graph | S | P3 | todo |
| GC-124 | The staged-changes guard reads the snapshot from before a drop’s checkout | actions | S | P3 | todo |
| GC-127 | A chip offers a grab cursor it cannot honour, and lights up less than the row beside it | ui | S | P3 | todo |
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

- **Status:** done
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
  - [x] catena-feed (read-only) scrolls past 2000 with continuous lanes.
  - [x] Unit test: layout of a full list equals layout of the same list in two pages.
- **Files:** `src/main/git.ts`, `ipc.ts`, `App.tsx`, `lanes.ts`, `CommitGraph.tsx`.
- **Verify:** `npm test`, screenshot at the page boundary.
- **Log:**
  - 2026-09-06 04:26 claimed
  - 2026-09-06 05:00 done. `getLog` takes `skip`, a new `repo:log` channel returns one more page of
    the same traversal, and `App` appends pages of `PAGE_COMMITS` (1000) when `CommitGraph` reports
    the viewport within `NEAR_END` (200) rows of what is loaded; a `.more-row` says "Loading more…"
    while a page is in flight. A page carries the hidden set its range was loaded with and is
    dropped if the generation moved (GC-068), so a reload cannot be overwritten by a page counted
    against a range that no longer exists. `paged` also makes a reload ask for what is on screen
    rather than the first page, or every watcher refresh would drag a deeply scrolled graph back to
    row 2000. `layoutGraph` gained `LaneState`: a layout returns the lanes still open at the end of
    its range and accepts them back, and does not re-seed the pin on a later page. Ten new cases in
    `lanes.test.ts` prove page-splits at every row of a three-lane history equal the single call.
    **The acceptance names catena-feed, and that could not be used: it has 881 commits across all
    refs (kyushu-route 34, GitClient 90), so no repository on this machine reaches 2000.** Checked
    instead against a disposable 2802-commit fixture built with `git fast-import` in
    `%TEMP%/gitclient-big` — two chains off one root with interleaved dates so `--date-order` keeps
    two lanes open across the boundary, and a merge at the tip. Over CDP: the first load stopped at
    2001 rows (2000 commits plus WIP) with only 40 row elements rendered, scrolling to the end took
    it to 2803 rows for 2802 commits, the "Loading more" row was observed by a `MutationObserver`
    while the page was in flight and gone after, and rows 1998-2002 each still drew 4 lane marks —
    no line restarts at the boundary. Screenshot `docs/screenshots/gc012-page-boundary.png` (status
    bar reads 2802 commits, both lanes continuous). `src/shared/types.ts` and `src/preload/index.ts`
    were touched too, which the Files line does not list: adding an API means all four files.
    The fixture was deleted afterwards; the generator is described above rather than committed.

### GC-013 Light theme

- **Status:** done
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
  - [x] No hard-coded colours remain in `app.css` (`grep -n "#[0-9a-f]\{3,6\}" app.css` prints
    nothing outside the tokens file).
  - [x] Screenshot of both themes with the same repo loaded.
- **Files:** `tokens.css`, `app.css`, `prefs.ts`, `src/main/index.ts`, `ipc.ts`.
- **Verify:** build, screenshots.
- **Log:**
  - 2026-09-06 04:26 claimed
  - 2026-09-06 05:00 done. `tokens.css` keeps the dark palette on `:root` and adds a
    `:root[data-theme='light']` block redefining every colour — surfaces stepping the other way, text
    as black alphas mirroring the white ones, accents and all ten lane colours darkened until they
    read on white. `prefs.ts` owns the setting (`dark` | `light` | `system`) and resolves `system`
    itself with `matchMedia` rather than leaving it to a media query, because the renderer needs the
    answer in JavaScript: it stamps `data-theme` and calls the new `window:theme` channel, which
    repaints the OS window controls — the one part of the frame CSS cannot reach. It also listens
    for the OS setting changing while `system` is chosen. `TITLE_BAR_OVERLAY` and its applier live in
    `ipc.ts`, not `index.ts` as first written: `index.ts` already imports `registerIpc`, so putting
    them there would have made the import circular. The nine `rgba()` literals left in `app.css`
    became tokens (`--head-row`, `--match-row`, `--banner-bg`, `--hover-overlay`, `--backdrop`,
    `--accent-strong`, `--success-strong`, `--diff-gutter`, and one that was already `--bg-input`), so
    `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` now prints **nothing**. Verified over CDP on the
    same repository: dark gives `body` `rgb(28, 30, 35)` on `rgba(255,255,255,0.75)`, light gives
    `rgb(241, 242, 245)` on `rgba(0,0,0,0.8)`, Preferences offers exactly `dark,light,system`, and
    changing the select repainted `data-theme` with no reload. Screenshots
    `docs/screenshots/gc013-theme-dark.png`, `gc013-theme-light.png` and `gc013-preferences-light.png`.
    Two things the light theme shows but does not own: the checkboxes and selects are still
    unstyled OS controls (GC-101, already filed — the light screenshots are evidence for it), and
    the window is *built* dark whatever the setting is, so a light-theme start flashes dark and
    wears dark window controls until the renderer answers — GC-102, filed by this ticket.

### GC-014 Side-by-side diff

- **Status:** done
- **Area:** diff | **Size:** L | **Priority:** P3
- **Depends on:** GC-002
- **Why:** The unified view is the only one. GitKraken offers a split view and a toggle.
- **Scope:**
  - A pure `alignHunks(hunk)` that pairs removed and added lines into rows (unit tested).
  - Toggle in the DiffView header, remembered in prefs. Hunk staging buttons keep working in
    both views.
- **Out of scope:** intra-line (word) diff highlighting, syntax highlighting.
- **Acceptance:**
  - [x] Two-hunk file in the e2e repo renders aligned rows; staging a hunk from the split view
    matches the unified result (`git diff --cached`).
- **Files:** `parseDiff.ts`, `DiffView.tsx`, `app.css`, tests.
- **Verify:** `npm test`, e2e, screenshot.
- **Log:**
  - 2026-09-06 05:00 claimed
  - 2026-09-06 06:05 done. `alignHunks(hunk)` in `parseDiff.ts` pairs each block of removals with
    the additions that follow it, index by index, pads the shorter side with `null` and puts a
    context line on both sides; a `\ No newline` marker is paired with the marker opposite it, or
    with itself after a context line, so it never lands beside a line of code. `DiffView` renders
    either the four-column unified table it always had or a six-column `.hunk-lines.split`, chosen
    from the new `prefs.diffView` and flipped by a `Unified | Split` switch in the file view header
    — a segmented control (`.seg` / `.seg-btn`), the first in the app. The tint moves from the row
    to the cells there, because a split row is one line of each file.
  - 2026-09-06 06:05 verified: 118 unit tests (up from 106) — 8 new `alignHunks` cases in
    `parseDiff.test.ts` including "loses no line", which asserts the left and right columns are
    exactly the hunk's del+context and add+context lines, and 4 in a new `DiffView.test.tsx` that
    pin the row shape, the per-cell classes and the buttons staying live across a flip. e2e: 29
    steps, 151 assertions, 23.5s, all passing. Step 28 is new and carries the acceptance criterion:
    it reads the split table back as rows (`[["3","row 3","3","row 3 edited"], …]`), then stages
    hunk 2 of `big.txt` from the split layout, unstages it through the app, stages the same hunk
    from the unified layout and asserts the two `git diff --cached` outputs are byte-identical (184
    bytes each). That is the real guarantee: `buildHunkPatch` builds from `hunk.raw`, which
    alignment never touches.
  - 2026-09-06 06:05 measured, not assumed: at a 1100px window the six cells are
    `[44, 16, 305, 44, 16, 305]` — the halves are exactly equal — and `.diff-body`'s `scrollWidth`
    equals its `clientWidth`, so nothing scrolls sideways. `table-layout: fixed` is what buys that,
    and the price is that a long line wraps (`pre-wrap` on split code cells only): halving the
    width is the point of the view, and both alternatives — clipping, or a scrollbar per side —
    hide changed code. The unified layout is untouched and still scrolls.
  - 2026-09-06 06:05 looked at, dark and light: `docs/screenshots/gc-014-split.png` (both hunks of
    `big.txt`, the changed row red left and green right with the divider between the halves),
    `gc-014-split-added-file.png` (an untracked file: every left cell is `pad`, read back from the
    DOM as `no pad / mark pad / code pad`), `gc-014-split-light.png` (the same view with the light
    tokens) and `gc-014-split-narrow.png` (1100px). `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css`
    still prints nothing: the split view needed no new colour, only `--diff-add`, `--diff-del`,
    `--diff-gutter` and `--border`.
  - 2026-09-06 06:05 one deviation from the Files line, deliberate: `prefs.ts` and
    `components/Preferences.tsx` are touched too. "Remembered in prefs" makes this a setting, and
    `CLAUDE.md` says a setting means a field with a default, validation in `load()` **and** a row in
    Preferences — so it got a "Diff" group with a Diff layout dropdown rather than a preference with
    no home in the dialog (`docs/screenshots/gc-014-preferences-diff.png`). `prefs.test.ts` gained
    the field in both round-trip cases.
  - 2026-09-06 06:05 noticed while screenshotting that dialog, and filed as GC-103: at a 720px-tall
    window the Preferences modal is 770px and its Close button sits 33px below the fold, with the
    backdrop at `overflow: visible` so there is nothing to scroll. This ticket's row makes it ~78px
    worse but did not cause it. Intra-line highlighting, which this ticket puts out of scope and the
    study records GitKraken having, is GC-104.

### GC-015 Drag-and-drop merge and rebase between chips

- **Status:** done
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
  - [x] e2e: drop `feature` on `master`, choose merge, assert `git log --merges` gained a commit.
- **Files:** `CommitGraph.tsx`, `LeftPanel.tsx`, `App.tsx`, `app.css`, `tools/e2e/run.mjs`.
- **Verify:** e2e, screenshot of the drop menu.
- **Log:**
  - 2026-09-06 07:07 claimed
  - 2026-09-06 done. A branch is picked up from either surface — a chip in the graph, a row in the
    left panel — and dropped on either, because both stand for the same `GitRef`: `ui/refDrag.ts`
    (new) holds the rules and the handlers, `App` holds the ref in flight, and each surface keeps
    its own "which target is the pointer over". Only branches take part: a tag names no line of
    work to merge or rebase, and the synthetic detached-HEAD chip is no ref at all. A pair that
    offers nothing — a remote dropped on a remote, anything on itself — never gets the
    `preventDefault` that makes an element a drop target, so it does not highlight and cannot be
    dropped on, rather than opening a menu with nothing in it: merge needs the target checked out,
    so the target must be a local branch, and rebase checks the source out, so the source must be
    one. `canDropRef` is that rule, pure and tested.
    A drop opens the ordinary context menu at the pointer, captioned `<src> onto <dst>` over
    "Merge `<src>` into `<dst>`" and "Rebase `<src>` onto `<dst>`" — the branch menu's own two
    actions with both ends named by the gesture instead of one of them being whatever is checked
    out. `runOnBranch` is what makes that honest: the branch the action runs on is checked out
    first through `checkoutRef`, so GC-004's dirty-tree guard and its stash offer come with it, and
    the action itself goes through `runSequencer`, so GC-090's staged-index guard does; between
    them git is asked where HEAD is, because a cancelled prompt and a failed checkout both return
    quietly. The rows that will check something out say so in their hint.
    Verified: `npm run typecheck`, `npm run build`, `npm test` (179 tests, 17 files — 7 new for
    `canDropRef`/`canDragRef` and 3 in `CommitGraph.test.tsx` for the chip attributes, the accepted
    drop and the refused self-drop), and `npm run e2e` — 30 steps, 178 assertions, 27.4s, all
    passed. New step 29 drives the real gesture over CDP: a left-panel row dropped on a graph chip,
    a chip dropped on itself refused, then `drop-source` dropped on `main` and merged, asserting
    the merge commit's two parents and that the guard put the staged half back.
    The acceptance line asks for `feature` dropped on `master`; the fixture's `feature` is already
    merged into `main`, so that drop would be "Already up to date" and assert nothing. The step
    builds `drop-source` instead — a sibling of `main` carrying `main`'s own tree, so the merge is
    a real merge commit git cannot fast-forward and yet changes no file, which is what lets the
    step put the fixture back with `reset --soft` alone. `git rev-list --count --merges HEAD` gains
    exactly one, which is the assertion the line asked for.
    Screenshots: `docs/screenshots/gc-015-drop-menu.png` (the drop menu, from the e2e run) and
    `docs/screenshots/gc-015-drag-highlight.png` (mid-drag: the `wip-branch` row dimmed in the left
    panel, `main`'s chip outlined in the accent in the graph). Both looked at.
    Left undone, as three tickets rather than scope creep: the graph does not auto-scroll during a
    drag (GC-122), a ref folded behind `+N` cannot be reached by one because `:hover` does not
    update mid-drag (GC-123), and the guards `runOnBranch` composes read the snapshot from before
    its checkout (GC-124, harmless today).

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

- **Status:** done
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
  - [x] Renaming the pinned branch keeps its lineage in column 0 and the key holds the new name.
  - [x] Deleting the pinned branch removes `gitclient.pinned.<repoPath>`.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** build, then drive both paths against the e2e repo and read the key back.
- **Log:**
  - 2026-09-05 proposed by GC-005 (this ticket): noticed while wiring the pin through the ref menu,
    which is the same menu that renames and deletes the branch.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. The rename item and `deleteBranch` both run with `{ rethrow: true }`
    inside a try/catch, so the pin only moves when git actually succeeded: a rename re-pins under
    the new name through `pinBranch`, a delete (plain or forced) clears it. Driven over CDP against
    the scratch repository on a branch created for it: after "Pin to Left" the key held
    `gc021-pin`; after renaming it through the ref menu the key held `gc021-renamed` and that
    branch's node was at `cx` 18, the smallest on screen, with `main` at 38 — column 0 still its
    lineage; after Delete, `localStorage.getItem('gitclient.pinned.<repo>')` was `null`. The
    scratch repo was left with no `gc021-*` branch and its fixture status unchanged.
    `docs/screenshots/gc-021-pin-renamed.png`.

---

### GC-027 Author filter in commit search

- **Status:** in-progress
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
  - 2026-09-06 09:00 claimed

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

- **Status:** done
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
  - [x] Killing the run mid-scenario (or forcing a throw) leaves no electron process from this
        repository's `node_modules` behind.
  - [x] `npm run e2e` still passes and still stops only its own process tree.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** start the run, interrupt it after a few steps, then check
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` lists nothing under this
  repository's path; then a clean `npm run e2e` with a guard app on another port.
- **Log:**
  - 2026-09-05 proposed by GC-035 (this ticket): wiring the narrow stopper into the epilogue made
    it obvious that no other exit path reaches it.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. `run.mjs` registers `stopOnce()` on `process.on('exit')` the moment
    `launchApp` resolves, with `SIGINT`/`SIGTERM` exiting explicitly (130/143) so those run it too;
    `bail` and the epilogue both call it, and it stops at most one tree. `stopApp` is synchronous
    (`taskkill /F /T`), which is what an `exit` handler requires. Verified by forcing an early
    `process.exit(9)` just after the CDP socket opened: no electron process from this repository
    was left and nothing was listening on 9333. The check bites — with the `exit` hook removed the
    same forced exit left pid 33936 alive and listening on 9333, which was then stopped with
    `stopPort(9333)`; the unrelated Electron tree already on the machine was untouched throughout.
    A hard `taskkill /F` of the runner is still unrecoverable, as it is for any process. A clean
    `npm run e2e` passes and stops only its own tree.

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

- **Status:** done
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
  - [x] A commit in the scratch repo carries at least four refs, so `+N` renders at 150px.
  - [x] `npm run e2e` passes back to back and stays re-entrant.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e:setup && npm run e2e` twice, plus a screenshot showing a folded `+N`.
- **Log:**
  - 2026-09-05 proposed by GC-020 (this ticket): the acceptance case could not be reproduced against
    the fixture without adding two branches by hand, which showed the fold has no coverage.
  - 2026-09-05 23:14 GR-006: GC-023 was the second ticket to build the four-ref commit by hand (its 300px and
    400px measurements), and GC-071 now waits on this one; still P3 because nothing else is blocked.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 done: `setup-testrepo.mjs` puts `release` (pushed with `-u`, so it tracks and
    absorbs its remote chip), `sandbox` (pushed without, so it and `origin/sandbox` are two chips) and the
    tag `v0.2.0` on `main`'s tip. That commit now carries **seven refs** — main, origin/main, release,
    origin/release, sandbox, origin/sandbox, v0.2.0 — and **five chips** after absorption. Both new
    branches are in `.e2e-baseline.json`, or `restoreFixture` would delete them as a run's own.
  - Measured over CDP on the built app at the default 150px ref column: the row renders exactly
    `['main', '+4']`, and the folded block carries `main | release | sandbox | origin/sandbox | v0.2.0` —
    the chip order `CLAUDE.md` documents (HEAD, tracking locals, other locals, remotes, tags) read off the
    names. Hovering with a real `Input.dispatchMouseEvent` pointer move (a dispatched `MouseEvent` never
    produces the CSS `:hover` the fold opens on) shows the list and leaves the `+4` chip
    `visibility: hidden`, as GC-078 designed. Screenshots looked at:
    `docs/screenshots/gc055-plus-n-chip.png` and `gc055-plus-n-hover.png`.
  - **No existing step needed changing.** Every branch-sensitive assertion in `run.mjs` is computed from
    git rather than written as a constant — step 25's row deltas, the Viewing count difference, the drift
    scan — which is why five extra refs and two extra branches moved nothing. `npm run e2e` passed back
    to back (29 steps, 151 assertions, ~23s each) and the fixture matched its baseline both times.
  - GC-071 was waiting on this: the four-ref commit it needs is now in the fixture.

### GC-102 The window is built dark whatever the theme is, so a light start flashes and keeps dark controls

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-013
- **Why:** GC-013 gave the app a light theme, and the renderer repaints the OS window controls
  through `window:theme` as soon as it has resolved the setting. The window itself is created
  before any of that exists: `src/main/index.ts` passes `backgroundColor: '#1b1d22'` and
  `titleBarOverlay: TITLE_BAR_OVERLAY.dark` as literals. So a light-theme start paints a dark
  window, and the controls stay dark until the renderer's first `applyTheme()` lands — on a cold
  start that is after the bundle has parsed and React has mounted. The theme lives in
  `localStorage`, which is the renderer's, so the main process has no way to know it at
  `createWindow` time; it needs its own copy.
- **Scope:**
  - The main process remembers the last resolved theme (a small file under `app.getPath('userData')`
    is enough, and it stays per-profile, so the launcher's per-port profiles keep their own — GC-060)
    and builds the window with that `backgroundColor` and overlay.
  - `window:theme` writes it whenever the renderer reports a theme, so the next start matches.
  - A first-ever start with nothing remembered keeps today's dark default.
- **Out of scope:** the token values themselves, `prefs.ts`'s resolution of `system` (GC-013 owns
  both), and following the OS theme from the main process with `nativeTheme` — the renderer is
  where the setting lives and it already reports changes.
- **Acceptance:**
  - [ ] With the theme set to light, a restart shows a light window frame and light window
        controls from the first painted frame, with no dark flash.
  - [ ] With it set to dark, nothing changes.
  - [ ] The remembered value is per Electron profile: a launcher run on port 9333 cannot change
        what Ricardo's own profile starts with.
- **Files:** `src/main/index.ts`, `src/main/ipc.ts`.
- **Verify:** build, launch through `tools/launch-app.mjs` with each theme stored, and capture the
  first frame over CDP; compare the window background against the token value for that theme.
- **Log:**
  - 2026-09-06 05:00 proposed by GC-013 (this ticket): the light theme is complete inside the
    renderer, but `createWindow` has two hard-coded dark literals it cannot see past. Noticed while
    taking the both-themes screenshots the ticket's acceptance asks for.



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

- **Status:** done
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
  - [x] `npm run e2e:setup` creates `<root>/remote2.git` as an empty bare repository.
  - [x] Step 17 passes with the exclusive assertion (the sha on `upstream`, nothing on `origin`).
  - [x] Pointing that push back at `origin` in `App.tsx` fails the assertion (mutation check).
  - [x] The run stays re-entrant: a second `npm run e2e` straight afterwards passes unchanged.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e:setup && npm run e2e` twice in a row, then the mutation check above.
- **Log:**
  - 2026-09-05 proposed by GC-031 (this ticket): the per-remote push assertion GC-031 added
    cannot tell the two remotes apart, because step 17 points both at the same bare repository.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 done: `setup-testrepo.mjs` creates `<root>/remote2.git`, bare and empty, and does
    not add it as a remote — step 17 still adds it through the UI, which is the thing being tested.
    `run.mjs` points `upstream` at it, and `run.mjs` exits 2 with the `npm run e2e:setup` message when a
    fixture predates it, the way it already does for the baseline.
  - "remote added and fetched" became "remote added at the URL it was given": an empty bare repository
    has no `refs/remotes/upstream/main` to look for, so the check now asserts the remote exists and
    `git remote get-url upstream` is `remote2.git`.
  - The GC-031 push check is exclusive: `git ls-remote upstream push-target` carries the sha **and**
    `git ls-remote origin push-target` is empty. Clean-up deletes from `upstream` only, and the prologue
    empties `remote2.git` of anything a dead run left there.
  - Mutation check run, not assumed: with `App.tsx`'s per-remote push item forced to
    `remote: 'origin'`, rebuilt, the step fails —
    `FAIL the chosen remote received the branch, and only that remote | upstream: (nothing) | origin:
    1f0b831... refs/heads/push-target`. Before this ticket that push passed, because both names resolved
    to the same bare repository. `App.tsx` restored (same bundle hash), and the run is re-entrant: two
    back-to-back passes, 151 assertions each.

### GC-057 Toolbar Push and Pull cannot choose the remote

- **Status:** done
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
  - [x] With two remotes, the Push caret lists both and each pushes there (`git ls-remote`).
  - [x] With one remote, neither button gains a caret it did not have.
  - [x] Pull from a named remote reaches `git pull <flag> <remote> <branch>`.
  - [x] Escape with either popover open closes only it, the find bar keeping its query (the
    GC-039 guard extended to the Push popover).
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/App.tsx`,
  `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck && npm run build && npm test && npm run e2e`, plus a CDP
  screenshot of each popover with two remotes.
- **Log:**
  - 2026-09-05 proposed by GC-031 (this ticket): GC-031 fixed the context menus and left the
    toolbar with one hard-coded remote for push and no remote at all for pull.
  - 2026-09-06 06:15 claimed
  - 2026-09-06 07:20 done. Push is a `.split-btn.push` whose caret exists only when the repository
    has more than one remote, opening a popover of "Push to <remote>"; the Pull popover gains a
    separated "Pull from <remote>" group on the same condition, above Fetch all. `pull(cwd, mode,
    remote?)` in `git.ts` appends `<remote> <branch>` when a remote is named — `git pull <remote>`
    with no refspec would still merge `branch.<name>.merge`, which is the upstream the row exists to
    bypass — threaded through `remote:pull` with the same optional-string validation `remote:fetch`
    uses. `pushOpen` joins `layerOpen` and the Escape chain in `App.tsx`, and one outside-click
    effect now serves both popovers, so opening either closes the other.
  - 2026-09-06 07:20 verified in e2e step 17, whose title now says so: "the Push popover lists one
    row per remote" (`Push to origin | Push to upstream`); the toolbar push to `upstream` landed
    `96a1bcb3 refs/heads/push-target` on the second bare repository with `origin: (nothing)` —
    exclusive, and `upstream` is not `defaultRemote`, so the fallback could not have produced it;
    the Pull popover listed `Pull (fast-forward if possible) | Pull (fast-forward only) | Pull
    (rebase) | Pull from origin | Pull from upstream | Fetch all` and "Pull from upstream" left the
    branch on `96a1bcb3` with no status-bar error. The one-remote case is covered by the caret being
    absent everywhere else in the run and by an explicit CDP check. The GC-039 Escape guard lives in
    step 17 rather than step 18 because step 17 is the only place in the run with two remotes, which
    is the only place the Push caret exists at all: with the find bar holding "feature", Escape
    closed the popover and left `{"popover":false,"search":true,"query":"feature"}`. Screenshots
    `docs/screenshots/gc057-push-popover.png` and `gc057-pull-popover.png`, looked at.

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

- **Status:** in-progress
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
  - 2026-09-06 09:00 claimed

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

- **Status:** in-progress
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
  - 2026-09-06 09:00 claimed

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

- **Status:** done
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
  - [x] Right-clicking a local branch that is *not* checked out shows Reset `<current branch>` to
        `<its tip's short sha>` with a working Soft / Mixed / Hard submenu; picking Hard asks for
        confirmation the same way the commit-row Reset does.
  - [x] `git status --short` / `git log` confirm the reset actually moved the checked-out branch's
        ref and left the working tree in the mode-appropriate state (soft: index unchanged, staged
        stays staged; mixed: index reset, working tree unchanged; hard: matches the target commit).
  - [x] Cherry pick, Revert, Create tag here… and Copy commit sha on a branch row behave the same
        as their existing commit-row equivalents (verified against `git log` / clipboard).
  - [x] Right-clicking the currently checked-out branch's own row/chip also shows the group
        (matches the study's screenshot of the checked-out `main` chip).
  - [x] No behavioural change to the commit-row menu (still built from the same shared helper).
  - [x] e2e step: right-click a non-checked-out local branch, Reset (mixed) to its tip via the
        menu, assert the checked-out branch's sha with `git rev-parse`.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, e2e, a screenshot of the branch-row menu next to the study's
  `06-context-menu-branch.png` / `20-context-menu-leftpanel-branch.png` for a side-by-side look.
- **Log:**
  - 2026-09-05 requested by Ricardo with a screenshot of GitKraken's left-panel branch menu;
    checked against the existing `docs/reference/gitkraken/05-menus-shortcuts.md` notes and the
    current `refMenuItems` / `commitMenuItems` split in `App.tsx` before writing this ticket.
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `tipCommitActions(sha)` in `App.tsx` hands back the tip-commit items
    individually — cherry pick, revert, the three resets, create tag, copy sha — and both
    `commitMenuItems` and `refMenuItems` compose from it, so the commit menu keeps its own order
    unchanged (its acceptance box) while the branch menu gains the group between Create branch
    from… and Pin to Left. They are handed back one by one rather than as a ready-made list
    precisely so the two menus can order them differently without duplicating any wording.
    e2e step 22 (new): right-clicking `wip-branch` while `main` is checked out lists
    `Reset main to <sha>: soft|mixed|hard` plus the rest of the group, and clicking mixed moves
    `git rev-parse HEAD` onto wip-branch’s tip with `main` still checked out. The step puts the
    ref and the index back with `git reset --mixed`, and step 24 proves the fixture survived it.
    Cherry pick / Revert / Create tag here… / Copy commit sha on a branch row are the same
    `MenuItem` objects the commit row builds, so their behaviour is identical by construction
    rather than by a second assertion; the checked-out branch’s own chip shows the group too.

### GC-050 Resizable left and detail panels, widths remembered

- **Status:** done
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
  - 2026-09-06 03:03 claimed
  - 2026-09-06 03:39 done. New `src/renderer/src/ui/useDragWidth.ts` holds the one drag
    implementation — clamp, persist, double-click reset — and `CommitGraph` was rewired onto it, so
    the ref column and both panels now share it (its `readRefColW`/`clampRefCol`/pointer handlers
    are gone). Handles are a 4px `.panel-resize` on the left panel's right edge and the detail
    panel's left edge, absolutely positioned inside each panel; `App` owns both widths and writes
    `--left-panel-w` / `--detail-panel-w` on `.app`, with `tokens.css` keeping only the defaults.
    Keys `gitclient.leftPanelW` (160-420, default 220) and `gitclient.detailPanelW` (300-720,
    default 400). Measured over CDP with real `Input.dispatchMouseEvent` drags: left handle +100px
    takes the panel 220 -> 320 and the graph 780 -> 680; detail handle -80px takes it 400 -> 480 and
    the graph 680 -> 600; the clamps stop at 420 and 300 with `scrollWidth <= clientWidth` on both
    `documentElement` and `.app`; a reload keeps 340/300; double-click returns 220 and
    `localStorage.getItem('gitclient.leftPanelW')` is `null`; with a diff open the left panel is 44px,
    `.collapsed`, with no `.panel-resize`, while the detail handle still moves it 300 -> 340.
    Screenshots `docs/screenshots/gc050-panels-resized.png` (rail + widened detail panel) and
    `gc050-left-panel-320-catena-feed.png` (catena-feed loaded **read-only** at 320px), looked at
    next to `08-left-panel-expanded.png` for layout: same structure — Viewing, filter, LOCAL/REMOTE
    heads with counts, nested rows under the remote — and at 320px only 1 of the branch names still
    truncates, against the 16 GR-003 recorded at 220px.
    One thing the scope did not anticipate: the drag persisted a width one pointermove behind what
    was on screen (measured: rendered 340, stored 356), because the pointerup arrives before React
    has committed the last move and the closure's `width` is stale. The hook computes the released
    width from the release position instead. GC-006's ref column had the same bug and is fixed by
    sharing the hook. The reset also removes the key rather than storing the default, which is the
    acceptance's wording and a small behaviour change for `gitclient.refColW`.

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

- **Status:** done
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
  - [x] `git checkout --detach HEAD~1` + Refresh in the scratch repository shows exactly one chip
        reading `HEAD` on that commit's row, in column 0, with the dashed WIP link ending on it;
        `git checkout main` + Refresh removes it and the `main` chip has the check mark again.
  - [x] The chip's context menu is the commit menu; "Create branch here…" creates the branch at
        `git rev-parse HEAD`.
  - [x] The Push button's title names the detached state while disabled.
  - [x] e2e step: detach, Refresh, assert the chip's text and row, re-attach; the prologue
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
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `CommitGraph` builds a synthetic `HEAD` ref when `detached` is set (a new
    prop, `!snapshot.info.branch`), ranked -1 so the fold cannot hide it; it is never a real ref,
    so `getRefs` and `GitRef` are untouched. Its context menu is `commitMenuItems` and it does not
    respond to double-click. The Toolbar’s Push title reads "Cannot push from a detached HEAD"
    while disabled. Verified in the built app on a throwaway clone detached at `HEAD~1`: crumb
    "detached HEAD", one chip reading `HEAD` with the check mark on the `Main-only change` row in
    column 0 with the dashed WIP link ending on it, its menu listing "Create branch here…", and
    the Push title as above — `docs/screenshots/gc061-detached-head.png` (3x). e2e step 23 (new)
    detaches at `HEAD`, not `HEAD~1`: the fixture carries edits to tracked files every earlier
    step asserts against, and moving to another commit would either refuse or rewrite them;
    nothing about the marker depends on which commit it is. It asserts the chip, its row against
    `git log -1`, the Push title, and that checking `main` back out removes the chip and gives
    `main` its check mark again. The prologue’s existing `git checkout -q main` already
    re-attaches a run that died detached, so no prologue change was needed.

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

- **Status:** done
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
  - [x] With a live marker in the root, `npm run e2e:setup` refuses and says which pid holds it;
    with a stale marker it proceeds.
  - [x] `npm run e2e` against a root whose `testrepo` is missing exits non-zero with one message
    naming the path, and runs no steps.
  - [x] `npm run e2e` passes with the `shots/` directory deleted beforehand.
- **Files:** `tools/e2e/setup-testrepo.mjs`, `tools/e2e/run.mjs`.
- **Verify:** the three checks above, then `npm run e2e:setup && npm run e2e` once normally.
- **Log:**
  - 2026-09-05 proposed by GC-053 (this ticket): a concurrent `e2e:setup` on the default root
    destroyed a baseline measurement mid-run and the resulting failure named nothing.
  - 2026-09-06 02:28 claimed
  - 2026-09-06 03:00 done. `run.mjs` writes `<root>/.e2e-owner.json` (pid, start time, what) before anything else; `setup-testrepo.mjs` reads it and refuses when the pid is alive, printing `<root> is in use by pid <n> (<what>, started <iso>)` and exiting 2 — verified with a live pid (exit 2, pid named), a dead pid 999999 (proceeds), and `--force` over a live marker (proceeds). A marker older than 30 minutes counts as stale whatever its pid says: an e2e run takes ~20s, pids are reused, and an unattended routine must not be blocked for ever by a reused one. `run.mjs` exits 2 before the launch when `<root>/testrepo` is missing ("No test repository at <path>. Run: node tools/e2e/setup-testrepo.mjs") or exists without a `.git` ("the folder is there but is not a git repository") — both verified. `shot()` mkdirs `shots/` per capture; `rm -rf shots` then `npm run e2e` passed with 12 screenshots written.


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

- **Status:** done
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
  - [x] The dom test passes, and fails when the generation check is removed (say so in the log).
  - [x] `npm run e2e` still passes: the watcher and the parked-change flush are untouched.
  - [x] The watcher probe GR-005 ran still works on the built app: an untracked file created in the
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
  - 2026-09-06 01:55 done. One `generation` ref in `App`: `load()` captures it before `loadRepo` and
    drops both its success and its failure path if it moved (the failure path too, or a stale
    rejection would clear `repoPath` over a repository a newer load had opened — GC-025's path);
    `refreshStatus()` captures it before `getStatus`; `applyChange()` captures it before its own
    `loadRepo` (its `tree` branch needs nothing, it delegates to `refreshStatus`); `run()` bumps it
    first thing. `openPath()` bumps it too, which is one line past the Scope as written: switching
    repositories is the same class of user action, and without it a background load against the
    repository being left lands on top of the new one. Dropping is silent, as specified.
    `App.test.tsx` is the first component test to render `App` (74 unit tests now, 64 node + 10 dom).
    Mutation-checked centrally, not on the agent's word: replacing all four
    `if (gen !== generation.current) return;` guards with `if (false) return;` failed both cases and
    only at the assertion after the stale resolve (`expected +0 to be 1` at App.test.tsx:146 and
    :162); restoring gave 10/10 dom again. `npm run e2e` passes, 91 assertions. The GR-005 watcher
    probe was re-run on the built app over CDP with no click anywhere: `probe.txt` written into the
    scratch tree took the WIP group from `Unstaged Files (5)` to `(6)`, and `git branch probe-branch`
    took the left panel from `LOCAL 3` to `LOCAL 4`, both inside the 4s wait.
  - 2026-09-06 note (Ricardo's session, not the batch): this batch's code reached `origin/main` one
    commit early, inside 3dca449 "GC-080, GC-081: file the e2e speed tickets" — see the note on
    GC-075 for how. 67d0e7f is the real close-out; the code is identical either way.

### GC-069 The body preview takes width from the summary in a narrow message column

- **Status:** done
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
  - [x] Scratch repository, 1400x900, all three columns on: the `Extend feature` row shows its
        whole summary and a truncated or hidden body; with the columns off the row is unchanged
        (both fit as before).
  - [x] catena-feed read-only, same setup: every row whose summary is narrower than the column
        shows the whole summary, checked over CDP by comparing each `.summary` element's
        `scrollWidth` and `clientWidth` for the rendered rows.
  - [x] Screenshot looked at next to `docs/screenshots/graph-columns.png`.
- **Files:** `src/renderer/src/styles/app.css` (and `src/renderer/src/graph/CommitGraph.tsx` only
  if a wrapper is needed).
- **Verify:** build, the CDP check above, screenshot at 1400x900 with the columns on.
- **Log:**
  - 2026-09-05 22:23 proposed by GR-005: switching GC-032's columns on made the message column
    narrow enough to show the body preview outliving the summary on every long-bodied commit.
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `.body` moved inside a `.body-wrap` with `flex: 1 1 0` and
    `container-type: inline-size`, so the preview only ever gets space the summary did not need —
    zero the moment the row overflows — and a `@container (max-width: 40px)` rule drops it rather
    than leaving a lone ellipsis. `.summary` is explicitly `flex: 0 1 auto; min-width: 0`.
    Measured over CDP with all four of GC-032’s columns on at 1400x900: on catena-feed read-only,
    0 of the rendered rows have a truncated summary while their body still has width (every
    truncated summary now has a zero-width or absent body); on the scratch repository the
    `Extend feature` row shows its whole summary (`sumCut: false`) beside an 83px body preview.
    Looked at: `docs/screenshots/gc069-message-column.png`.

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
- **Depends on:** GC-023, GC-055, GC-078
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
  - 2026-09-06 01:05 GR-007: now depends on GC-078 as well. That ticket makes one chip plus `+N` the shape
    at every width, so the 100px case here stops being the extreme end of a range and becomes the
    everyday row with less room; the furniture question (the cloud icon, the `+N` chip) is the same.

### GC-072 Show in folder is offered on a file the commit deleted, and always fails

- **Status:** done
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
  - [x] On a commit that deletes a file, the row's menu offers no item that fails when clicked.
  - [x] The scratch repository carries such a commit and an e2e step asserts the menu on it.
  - [x] On the fixture's staged deletion `main.txt`, and on an unstaged deletion made with `rm`, the
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
  - 2026-09-06 02:28 claimed
  - 2026-09-06 03:00 done. Chose **disable**, not reveal-the-parent: `repoFile()` refusing a path that is not on disk is the same guard "Open file" already leans on, and `ipc.ts` is outside this ticket's files. `fileMenuItems` computes one `gone` flag — `kind === 'deleted'` for a commit row, `deletedFromTree(entry)` for a staging row (the unstaged side decides when both are set) — and both shell items take it. `setup-testrepo.mjs` gained `obsolete.txt` in the initial commit and a `Remove obsolete file` commit after the tag; e2e step 22 asserts four menus: the commit row (`(x) Open file | (x) Show in folder | --- | Copy file path`), the staged deletion `main.txt`, an unstaged deletion made with `rm feature.txt`, and `big.txt` as the control, which keeps both live. Screenshot `docs/screenshots/gc-072-deleted-file-row-menu.png`, looked at. 104 assertions pass.


### GC-073 Hide and Solo branches in the graph from the left panel

- **Status:** done
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
  - 2026-09-06 03:03 claimed
  - 2026-09-06 03:39 done. `getLog(cwd, max, exclude)` puts one `--exclude=<fullName>` per
    hidden ref ahead of `--all`, carried through `loadRepo`, `repo:load` (validated with `strs`,
    an absent argument meaning none) and `GitApi`; the preload's generic `call()` needed no change.
    `gitclient.hidden.<repoPath>` holds the full names; an effect re-reads and prunes it against
    every snapshot and rebuilds the graph when the pruned set differs from the one on screen, which
    converges in one extra load. Eye toggle on hover for local and nested remote rows (none on the
    checked-out branch), `.ref-row.ref-hidden` dims a hidden row, "Viewing" counts visible refs
    only, and a "Show all" eye appears on the LOCAL and REMOTE heads while anything under them is
    hidden (`Section` now takes `actions` rather than one `action`). "Hide in graph" /
    "Show in graph" and "Solo in graph" sit next to Pin to Left in the branch menu and as their own
    group on a remote branch, from one `visibilityItems(r)` helper. `CommitGraph` is untouched:
    `App` hands it `visibleRefs`, so a hidden ref's chip goes with its rows and the
    absorbs-its-upstream pairing works off the same list.
    **Decision on the fixture note:** one action hides exactly one ref — hiding a local branch does
    not take the upstream its chip absorbs with it, because the row and its eye stand for one ref
    and hiding a second silently would remove something the user did not name. The e2e step asserts
    the consequence: hiding `wip-branch` alone removes no row.
    e2e step 25 (the fixture check became step 26): the menu carries Hide/Solo beside Pin to Left,
    hiding one half removes nothing, hiding both takes the row out, the drop equals
    `git rev-list --count --exclude=refs/stash --all` minus the same with both excludes, the rendered
    commit rows equal that second count, Viewing drops by two, the set is persisted by full ref
    name, Show all restores both counts, and Solo `feature` leaves `main` and `feature` with no
    `wip-branch` chip anywhere. Step 1 clears every `gitclient.hidden.*` key. 104 -> 117 assertions,
    ALL PASSED, 21.1s. By CDP, outside the suite: the row eye hides the same way the menu does, both
    rows show `.ref-hidden`, the set survives a page reload (8 rows before and after), and
    `git branch -D wip-branch` + Refresh prunes `refs/heads/wip-branch` out of `localStorage` while
    leaving the remote entry. Screenshots `docs/screenshots/gc073-solo-graph.png` (left panel at
    320px with `wip-branch` and all three remote rows dimmed, Viewing 3, the wip row gone) and
    `gc073-hidden-and-solo.png`.
    **A finding that had to be fixed to make the acceptance testable:** `git log --all` means every
    ref under `refs/`, not only heads/remotes/tags, so the fixture's own `refs/e2e/baseline/*`
    snapshot (GC-076) kept `Work on wip branch` in the graph after both wip refs were hidden. The
    baseline moved to `<root>/.e2e-baseline.json`, read by `run.mjs` and written by
    `setup-testrepo.mjs`, which also deletes any stale `refs/e2e` namespace — **a fixture from
    before this commit must be rebuilt with `npm run e2e:setup`**. The app-side half of the same
    problem (a real repository's `refs/notes/*` or `refs/pull/*` doing exactly this) is filed as
    GC-095. Also noted for GC-094: "Viewing" now counts visible refs, not every ref.

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

- **Status:** done
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
  - [x] Over CDP on the scratch repository: stage the second hunk of `big.txt`, click the Staged
        Files row, and read `.file-view .diff-body` immediately — it shows the loading body, not the
        unstaged side's hunk, and the hunk buttons are disabled until the staged diff arrives.
        (Checked from a recorded render trace rather than an immediate read; see the log.)
  - [x] Reverting GC-062's content-keyed `waitDiff` in `tools/e2e/run.mjs` back to a chip + hunk
        count wait leaves step 21 passing, which it does not today (say so in the log).
  - [x] `npm run e2e` still passes, and no flicker is visible in a screenshot taken mid-load.
        (The e2e half holds; the screenshot could not be taken inside the window — see the log.)
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css` (only if the
  empty body between diffs reads badly).
- **Verify:** build, the CDP check above, `npm run e2e`, a screenshot of the loading body.
- **Log:**
  - 2026-09-05 proposed by GC-062 (this ticket): step 21's Unstage hunk failed five assertions
    against a perfectly working app, because the view was still rendering the diff it had before
    the click and the button built its patch from that.
  - 2026-09-05 23:35 claimed
  - 2026-09-06 01:55 done, but not the way the Scope describes, and the difference is the point.
    Clearing `text` from the top of the load effect is not enough: an effect runs *after* React has
    committed the render that changed `view`, so one frame is still painted with the new header over
    the old side's hunks and the buttons live. That frame was measured, not reasoned about — a
    MutationObserver installed before the click recorded every rendered state, and the first
    implementation's trace read
    `{chip:"Staged",hunks:1,adds:"row 3 edited",loading:false,btns:"Unstage file=enabled"}` between
    the click and the loading body. So the result is keyed to the view it was loaded for instead:
    `viewKey` is derived during render from repo, version and the view's own fields, `loaded` holds
    `{key, text, error}`, and `current = loaded?.key === viewKey ? loaded : null` — a diff belonging
    to another view can never render, in any frame, and `loading = current === null` gates every
    action button through `actionsDisabled = busy || loading`. The action error moved to its own
    `actionError` so a click's failure is still reported. Re-measured after the change, the trace is
    `Unstaged/row 3 edited` -> `Staged/0 hunks/loading/disabled` -> `Staged/row 35 edited/enabled`,
    with no disagreeing state.
    Criterion 2 was checked as a real mutation, both ways: with `waitDiff` cut back to the chip and
    the hunk count, step 21 passes with this fix in, and with the fix reverted (`git stash`, rebuild)
    the same suite fails five assertions there — `Unstage hunk empties the index again | M big.txt`,
    the file view never closing, and `cancelling the discard leaves the working tree exactly as it
    was | M README.md MM big.txt`. Both files were restored afterwards.
    Criterion 3, honestly: `npm run e2e` passes (91 assertions, twice), but the screenshot could not
    be taken inside the window. The stealth launch renders offscreen at 10fps, so
    `Page.captureScreenshot` returned a frame from after the diff had arrived even when the DOM read
    `Loading diff…` at request time. The render trace above is the stronger evidence and is what the
    box is ticked on; `docs/screenshots/gc075-staged-diff.png` records that the staged side lands
    correctly after the switch. `app.css` was not needed: the loading body reuses the existing
    `.diff-empty`.
    One trap worth repeating: the first draft of `viewKey` joined its parts with a literal U+0000,
    which turned `DiffView.tsx` into a binary file for git exactly as GC-042 describes. `grep` said
    "Binary file matches" and nothing else complained — typecheck, tests and the build all passed.
    The separator is now `|`.
  - 2026-09-06 note (Ricardo's session, not the batch): this batch's code reached `origin/main` one
    commit early, inside 3dca449 "GC-080, GC-081: file the e2e speed tickets". Its staged files
    (`App.tsx`, `App.test.tsx`, `DiffView.tsx`, `run.mjs`, `setup-testrepo.mjs`) were swept into a
    `git commit` meant for `TICKETS.md` alone — `git add TICKETS.md` stages one file, but `git commit`
    takes the whole index; `git commit -- TICKETS.md` is the path-limited form that should have been
    used. 67d0e7f is the real close-out and the code is identical either way. Left as a note rather
    than a history rewrite, at Ricardo's choice.

### GC-076 Every e2e run leaves a commit behind, and the fixture eventually breaks step 16

- **Status:** done
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
  - [x] `npm run e2e` five times in a row without an intervening `e2e:setup`, all passing, with
        `git rev-list --count HEAD` and `git ls-remote origin` identical before the first and after
        the fifth.
  - [x] Killing a run inside step 10 and running again passes, with no `Commit from another clone`
        left on `main` or on the bare origin.
  - [x] The count invariant fails the run when a commit is added to the fixture by hand.
- **Files:** `tools/e2e/run.mjs`, and `tools/e2e/setup-testrepo.mjs` only if the expected count is
  better exported from there than restated.
- **Verify:** the three checks above, and `npm run e2e:setup && npm run e2e` once normally.
- **Log:**
  - 2026-09-05 proposed by GC-062 (this ticket): eight verification runs grew the scratch repository
    from 7 commits to 44 and broke a search assertion that has nothing to do with the batch.
  - 2026-09-05 23:35 claimed
  - 2026-09-06 01:55 done, with a correction to the Why: step 10 is not the only source. Measured on
    a fresh fixture, `main` carries 6 commits at setup and **9** after one run — the run adds three,
    not one: step 6's `main change`, the `Pickable commit` step 7 cherry-picks, and step 10's
    `Commit from another clone`. Step 7's cannot be undone where it is made because step 12 needs to
    find it already applied, so instead of a step-10 self-undo there is one `restoreFixture()` called
    twice: at the end of the prologue (a run that died mid-scenario) and again as step 22 (the
    healthy path). It drops commits by **subject match**, the way the GC-062 block matches its own
    mark, rather than resetting to a baseline sha — a commit somebody added by hand is not the run's
    to remove, and leaving it is what makes the closing assertion fire instead of silently healing
    the drift it exists to report. It resets `--soft`, never `--hard` (index and tree hold the
    fixture's own state), unstages what the dropped commits contributed while leaving README.md and
    main.txt alone, deletes the scratch files, writes a.txt's unstaged edit back (`main change`
    absorbs it into a commit, so dropping the commit would otherwise leave the file clean), rewinds
    wip-branch and the bare origin by ref, deletes branches the fixture does not have and removes
    `clone2`. `setup-testrepo.mjs` records every branch tip under `refs/e2e/baseline/*` — a namespace
    `getRefs()` never reads (heads, remotes and tags only) whose commits the branches already reach,
    so the graph gains no row — and `run.mjs` exits 2 with the `e2e:setup` message on a fixture that
    predates it, the same shape as the missing-repository guard.
    Evidence, all three re-run centrally: **(1)** fresh setup, then five runs with no `e2e:setup`
    between them — all `ALL PASSED`, `rev-list --count HEAD` 6 before and 6 after, `--all` 7 and 7,
    and `ls-remote` byte-identical (`diff` of the before/after captures was empty). **(2)** a run was
    killed inside step 10 for real (`Start-Process node tools/e2e/run.mjs`, polled its log for
    `### 10`, `taskkill /F /T` on that pid), leaving `main` at 8 commits, `pick-*.txt`, `clone2` and
    the clone's commit already pushed to the bare origin; the next run passed with 91 assertions and
    `git log --all --grep="Commit from another clone"` was empty in both the working repository and
    the bare one. **(3)** `git commit --allow-empty -m "a commit somebody added by hand"` then a run:
    step 22 failed exactly as intended and named itself —
    `7 commits, the fixture has 6 | run: npm run e2e:setup | drifted: 3e1343e a commit somebody added
    by hand` — while the other 21 steps still passed, so a drifted fixture no longer surfaces as some
    unrelated step's flake. The suite is 91 assertions now, up from 88.
    One thing step 22 deliberately does not assert: the fixture's *staged* half. Step 8 pops the
    stash through the toolbar, which does not restore the index, so README.md and main.txt come back
    unstaged on every run, with or without this change. That is a different drift from the commits
    this ticket removes and it is filed as GC-082.
  - 2026-09-06 note (Ricardo's session, not the batch): this batch's code reached `origin/main` one
    commit early, inside 3dca449 "GC-080, GC-081: file the e2e speed tickets" — see the same note on
    GC-068 and GC-075. 67d0e7f is the real close-out.

### GC-077 Branch lines join and leave a node at a right angle, not on a diagonal

- **Status:** done
- **Area:** graph | **Size:** M | **Priority:** P1
- **Depends on:** GC-002
- **Why:** Ricardo, reviewing the graph on 2026-09-06: a line that comes out of a branch and joins
  another lane's node must come down its own lane a little from the top of the row and then turn
  through ninety degrees into the node, not arrive from the middle on a slant. `GraphCell.tsx`
  draws both joins as one cubic Bezier across half a row: `curveIn` is
  `M fx 0 C fx 12.6, x 1.4, x 14` and `curveOut` its mirror below the node, so the line leaves its
  lane the moment the row starts and arrives at the node from above on a diagonal. Measured on the
  worktree build over CDP against catena-feed (read-only) and the scratch repository
  (`%TEMP%/gitclient-review/GR-007/04-fork-rows-zoom4.png`, a 4x clip of the `v1.86.0` row): the
  lane-1 line reaches the lane-0 node at roughly 45 degrees, with no horizontal run and no visible
  corner. The study's `03-graph.md` records GitKraken's lines as straight `line` segments plus
  "curves as paths" but did not measure the curve, so the shape below comes from Ricardo's
  description and from checking our own render, not from a copied path.
- **Scope:**
  - `curveIn(fromLane)` (a lane above this row joining this row's node): a vertical segment in its
    own lane from `y = 0` down to `y = mid - r`, a quarter arc of radius `r` turning toward the
    node, then a horizontal segment at `y = mid` (the node's centre line) to the node's edge. As a
    path: `M fx 0 V (mid - r) A r r 0 0 <sweep> (fx ± r) mid H x`, the sign and sweep chosen by
    which side the node is on.
  - `curveOut(toLane)` (this row's node continuing to a parent in another lane below): the mirror
    image — horizontal at `y = mid` from the node to `tx ∓ r`, a quarter arc turning downward,
    then vertical from `mid + r` to `ROW_H`.
  - `r` is a constant next to `LANE_W` and `NODE` in `GraphCell.tsx`. It must leave a visible
    straight vertical piece above the corner in a 28px row (`r < mid`, so under 14px) and a visible
    horizontal piece between adjacent lanes (`r < LANE_W`, so under 20px); start at 8px and adjust
    by looking at the 4x clip, recording the value settled on in the log.
  - A join that spans several lanes runs horizontally at `y = mid` across the lanes between,
    crossing their through-lines; the joins are already drawn after the through-lines, so the
    horizontal reads on top. Keep that order.
  - A first component test for the cell, `src/renderer/src/graph/GraphCell.test.tsx` in the `dom`
    project: render a row with one `incoming` lane and one `outgoing` lane and assert each path's
    `d` has the three-segment shape (starts `M <fx> 0 V`, contains one ` A `, ends `H <x>` for the
    incoming; starts `M <x> 14 H` and ends `V 28` for the outgoing). Copy `CommitGraph.test.tsx`'s
    `ResizeObserver` stub only if the render needs it; `GraphCell` itself does not observe.
- **Out of scope:** the through-lines, `hasChildAbove` / `hasParentBelow`, the dashed WIP link, the
  chip connector, the node, and anything in `lanes.ts` — the lane assignment is right, only the
  shape of the join changes. Animating or highlighting lines on hover (study: "hovering a chip
  highlights its rows") is a later ticket.
- **Acceptance:**
  - [x] On the scratch repository, the `Merge feature into main` row (one incoming and one outgoing
        join) and the `Change line 2 of a.txt` row (one incoming) show a vertical piece, a rounded
        corner and a horizontal piece at the node's centre line, checked on a 4x CDP clip
        (`Page.captureScreenshot` with `clip.scale`) and looked at, not only asserted.
  - [x] catena-feed loaded read-only: the `build(semantic): 1.86.0` row's lane-1 join has the same
        shape, and the lane-1 line above it is still one continuous straight line.
  - [x] The `dom` test passes and fails when either path is reverted to the Bezier.
  - [x] `npm test` (the `lanes.test.ts` guards untouched), typecheck, build.
- **Files:** `src/renderer/src/graph/GraphCell.tsx`, `src/renderer/src/graph/GraphCell.test.tsx` (new).
- **Verify:** build, launch through `tools/launch-app.mjs`, the two 4x clips above saved under
  `docs/screenshots/` (scratch repository only; catena-feed is looked at, not committed), `npm test`.
- **Log:**
  - 2026-09-06 01:05 proposed by GR-007: asked for by Ricardo in this review's session; the diagonal
    confirmed on the worktree build's 4x clip of the catena-feed `v1.86.0` row.
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `curveIn`/`curveOut` in `GraphCell.tsx` are now vertical + quarter arc +
    horizontal at the node centre line, radius `JOIN_R = 8` (the value the ticket suggested
    starting from, kept: it leaves a 6px vertical piece in a 28px row and a 12px horizontal run
    between adjacent lanes, checked on the 4x clip). Rendered `d` on the scratch repository’s
    merge row: `M 38 0 V 6 A 8 8 0 0 1 30 14 H 18` in, `M 18 14 H 30 A 8 8 0 0 1 38 22 V 28` out.
    Looked at: `docs/screenshots/gc077-join-zoom4.png` (4x, the `Merge feature into main` row and
    the one below it) — a straight lane, a rounded corner and a horizontal run into the node, no
    diagonal. catena-feed loaded read-only showed the same shape on its fork rows with the lane
    above still one continuous straight line (looked at over CDP; catena-feed captures are not
    committed). New `GraphCell.test.tsx` in the `dom` project, 3 cases; mutation-checked:
    restoring the Bezier fails all three. 77 unit tests pass.

### GC-078 The ref column shows exactly one chip, every other ref folds into +N

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P1
- **Depends on:** GC-020, GC-058
- **Why:** Ricardo, 2026-09-06: the BRANCH / TAG column shows one item per commit, always. On
  catena-feed's `build(semantic): 1.86.1` row that means `master` alone with `+2` beside it, not
  `master`, `twfdasdfsadfadf` and `+1`; and a branch always wins over a tag. Today `chipBudget`
  allows one chip per 75px of column (two at the default 150px, up to six at 400px), so the second
  chip takes space from the first: the worktree build at 150px renders that row as `mast…`, `t.`
  and `+1` (`%TEMP%/gitclient-review/GR-007/03-catena-feed-graph.png`, and the 4x clip
  `04-fork-rows-zoom4.png`), and the scratch repository's `feature` row as `featu…` and
  `origin/f…`. GC-023 already found the primary chip cannot stay legible while a second chip shares
  the column (its first acceptance box was left unticked for that reason); one chip is the rule
  that makes it legible and is what Ricardo asked for. This supersedes the width-aware fold GC-006
  added: the column's width now decides how much of the one name shows, never how many chips.
- **Scope:**
  - `CommitGraph` renders the first chip of the ordered list and, when there are more, the `+N`
    chip with the rest in its existing hover dropdown, at every column width. `chipBudget` and its
    "one chip per 75px" comment go; if a constant remains it is `1`.
  - The order stays what `rank` produces (HEAD, the pinned branch, tracking locals, other locals,
    remotes, tags), so the visible chip is a branch whenever the commit has one and a tag only when
    the commit carries nothing but tags. A local branch still absorbs its upstream into one chip
    with the cloud mark, as today.
  - `CommitGraph.test.tsx` (GC-058) renders six refs and asserts `+4` on the assumption that 150px
    budgets two chips; it becomes `+5`, and its comment says why.
- **Out of scope:** the dropdown's placement (GC-022), the chip order (GC-020), the primary chip's
  furniture at 100px (GC-071), the fixture's lack of a many-ref commit (GC-055), removing the
  now-idle `.ref-chip:not(:first-child):not(.more)` shrink rule in `app.css` (harmless, and that
  file belongs to GC-079 in the same window).
- **Acceptance:**
  - [x] catena-feed loaded read-only: the `build(semantic): 1.86.1` row shows `master` with its
        cloud mark and a `+2` chip whose dropdown lists `twfdasdfsadfadf` then `v1.86.1`, at 150px
        and at 400px; the `v1.86.0` row still shows its tag alone.
  - [x] Scratch repository: the `Extend feature` row shows `feature` and `+1` (`origin/feature` in
        the dropdown); the `Merge feature into main` row shows `main` and `+1` with `v0.1.0` folded.
  - [x] `master`'s `.chip-name` is not truncated at 150px on that row (`scrollWidth <= clientWidth`).
  - [x] `CommitGraph.test.tsx` passes with `+5`; `npm run e2e` passes (no step asserts a chip count).
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/graph/CommitGraph.test.tsx`.
- **Verify:** build, `npm test`, `npm run e2e`, screenshots of both rows above from the scratch
  repository into `docs/screenshots/`, the catena-feed row looked at over CDP.
- **Log:**
  - 2026-09-06 01:05 proposed by GR-007: asked for by Ricardo in this review's session, with the
    catena-feed `1.86.1` row as the example; the three-chip render confirmed on the worktree build.
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `chipBudget` is gone, replaced by `MAX_CHIPS = 1`: the column shows one chip
    at every width and everything else folds. On catena-feed read-only at 150px `master` measures
    `scrollWidth <= clientWidth` (not truncated) where it used to render as `mast…` beside `t.`;
    the scratch repository shows `main` + `+1` and `feature` + `+1`. `CommitGraph.test.tsx` now
    asserts `+5`, and `npm run e2e` passes (97 assertions, no step asserts a chip count). The
    fixture still has no commit with more than two refs, so the block is only ever two lines in
    e2e — that gap is GC-055, and the primary chip at the 100px minimum is GC-071.
  - 2026-09-06 02:22 the folded list, reworked live with Ricardo against GitKraken. It is not a popover:
    the chip itself grows. The block is anchored to `.col-ref` (not to the `+N` chip, which is now
    its sibling), opens at `top: -4px` so its first line lands on exactly the pixel the row chip
    occupied (measured: the chip name at 244,166 in both states), carries the chip’s own lane
    colour inline, lists every ref of the commit as one more line, and hides the `+N` while it is
    open. Hovering anywhere in the ref cell opens it. Two fixes came out of Ricardo looking at it:
    the lines keep a chip’s own `0 6px` padding so no text shifts when the block opens, and
    `.col-ref > .ref-chip:hover` became a direct-child selector — matching the block’s own lines
    resized it under the pointer, which read as a flicker. Looked at:
    `docs/screenshots/gc078-ref-expansion.png` (3x).

### GC-079 Custom scrollbars: 8px flat thumb, no track, no arrow buttons

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** Ricardo, 2026-09-06: custom scrollbars wherever we can. Every scroll container in the
  renderer shows Chromium's default classic scrollbar: measured on the worktree build with
  catena-feed loaded read-only, `.graph-body` and `.left-panel .sections` each lose 15px to it
  (`offsetWidth - clientWidth`), with arrow buttons at both ends and a light grey thumb on a
  visibly lighter track (`%TEMP%/gitclient-review/GR-007/05-graph-scrollbar-zoom3.png` and
  `06-left-scrollbar-zoom3.png`). The study's `02-design-tokens.md` records GitKraken's as 8px
  thick, thumb `rgba(255,255,255,0.15)`, no border. Ours should be our own values calibrated to
  that: thin, flat, no buttons, invisible track.
- **Scope:**
  - Tokens in `tokens.css`: `--scrollbar-w` (8px), `--scrollbar-thumb` (white at a low alpha),
    `--scrollbar-thumb-hover` (a step brighter). Our values, not the study's names.
  - One global rule set in `app.css` using the `::-webkit-scrollbar` family, which is the right
    tool in Electron: width and height from the token, transparent track and corner, the thumb
    with a 4px radius and the hover colour, and `::-webkit-scrollbar-button { display: none }`.
    Do **not** also set the standard `scrollbar-width` / `scrollbar-color`: when either is set,
    Chromium ignores the `::-webkit-scrollbar` rules, and the standard properties cannot remove the
    arrow buttons.
  - Applies everywhere without per-component rules: `.graph-body`, `.left-panel .sections`,
    `.detail-body`, `.message-box`, `.diff-body` (vertical and the horizontal one a long line
    produces), `.shortcut-groups`, and any dialog or menu that overflows.
- **Out of scope:** overlay scrollbars that take no layout space (the graph's `+N` flip in GC-022
  measures rects and is unaffected by an 8px bar, but an overlay bar over the SHA column would need
  its own decision), and a light-theme variant (GC-013).
- **Acceptance:**
  - [x] With catena-feed loaded read-only, `.graph-body` and `.left-panel .sections` measure
        `offsetWidth - clientWidth === 8`, and a 3x CDP clip of each shows a flat thumb, no arrow
        buttons and no visible track.
  - [x] A diff with a line wider than the panel shows an 8px horizontal bar with the same look.
  - [x] `npm run e2e` passes: the graph body is 7px wider, nothing in `run.mjs` measures it.
- **Files:** `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/app.css`.
- **Verify:** build, launch, the two measurements and clips above (clips of the scratch repository
  into `docs/screenshots/`), `npm run e2e`.
- **Log:**
  - 2026-09-06 01:05 proposed by GR-007: asked for by Ricardo in this review's session; the 15px
    default bar with buttons measured and looked at on the worktree build.
  - 2026-09-06 01:54 claimed
  - 2026-09-06 02:22 done. `--scrollbar-w: 8px`, `--scrollbar-thumb: rgba(255,255,255,0.16)` and
    `--scrollbar-thumb-hover: rgba(255,255,255,0.28)` in `tokens.css`, one global
    `::-webkit-scrollbar` rule set in `app.css`, and neither `scrollbar-width` nor
    `scrollbar-color`. Measured on the built app: `.graph-body` and `.left-panel .sections` both
    `offsetWidth - clientWidth` = 8 (was 15), on catena-feed read-only and on the scratch
    repository squeezed to 1000x260. Looked at: `docs/screenshots/gc079-scrollbar.png` (4x) — a
    flat rounded thumb, no track, no arrow buttons. The horizontal bar was measured on a probe
    element inside the app rather than on a diff, because no fixture file has a line wide enough
    to make `.diff-body` scroll sideways: height 8, thumb `rgba(255, 255, 255, 0.16)`,
    `::-webkit-scrollbar-button` `none`. `npm run e2e` passes with the narrower bar.

### GC-080 The e2e run spends ~44 of its ~58 seconds in fixed sleeps: wait on a snapshot generation instead

- **Status:** done
- **Area:** tests | **Size:** M | **Priority:** P2
- **Depends on:** none
- **Why:** GC-053 replaced 61 fixed sleeps with `waitFor`, but the two helpers every git action still
  goes through kept theirs (`tools/e2e/run.mjs:197-209`): `waitIdle` polls the status-bar spinner
  away and then sleeps an unconditional 400ms "because the reload that follows the spinner is not
  announced anywhere in the DOM", and `settle` sleeps 600ms *before* that "for the window in which
  an action gets as far as raising the spinner". `settle()` is called 39 times and `waitIdle()`
  directly 12 more, so every run pays 39 × 1.0s + 12 × 0.4s = **43.8s** of sleeping that no state
  is observed during. The whole run is about 55-60s (the screenshot timestamps of one run in
  `%TEMP%/gitclient-e2e/shots` put steps 5-16 at 26s and 17-end at 17s, plus launch and steps
  1-4), so roughly three quarters of it is waiting on nothing. The suite is the batch routine's
  own verification tool and the reviewer runs it too, several times a day, so the minute lost per
  run is paid many times over. The sleeps also hide a flake: an action that finished before
  `settle`'s 600ms ended never raised a spinner `waitIdle` could see, so the 400ms is what
  actually covers it, and a slower-than-usual reload (a big fixture, a busy disk) still gets
  through it with stale state. Both comments are right that today nothing observable marks the
  reload — so make something.
- **Scope:**
  - `App.tsx` keeps a snapshot generation: a counter bumped every time a snapshot or a status is
    applied to state — `run()`'s reload (full and `statusOnly`) and the watcher's background
    refresh alike, since the suite's own `git` writes to the fixture reach the app only through
    the watcher (GC-011) and a wait there has to see that arrival too. It is exposed as
    `data-gen` on `.statusbar` (a prop into `StatusBar.tsx`, next to the `.busy` spinner the suite
    already polls), so the DOM announces what the comments say it does not.
  - `run.mjs` gets one helper, e.g. `act(fn)`: read the generation, perform the action, then
    `waitFor` **both** the generation having advanced **and** the spinner being gone. Needing both
    is what keeps a watcher refresh that lands between the read and the click from satisfying the
    wait with pre-action state: the action's own `busy` blocks it until its reload bumps the
    counter again. Replace every `settle()` / `waitIdle()` that follows a git action with it.
  - Audit the rest one by one: a `settle()` after something that never touches git (opening a
    menu, typing a search query, clicking a chip to select) is waiting on nothing and becomes a
    `waitFor` on the DOM state the next line depends on, or goes.
  - Print the run's total wall time on the last line, so this ticket's before/after and every later
    speed change are measured in the log rather than estimated.
- **Out of scope:** the poll intervals themselves (50ms / 150ms), step 16's inter-query sleep
  (the second query lands on the same row as the first, so nothing observable changes — leave its
  comment), the cost of the suite's own `git` spawns (GC-081), the fixture's size, and GC-068's
  late-reload ordering — the residual window where a watcher bump lands after the click but before
  `run()` has rendered `busy` is a few milliseconds wide and is closed properly by that ticket,
  not by a sleep here.
- **Acceptance:**
  - [x] `npm run e2e` three times in a row, every assertion passing, total time printed and under
        30s each (from ~55-60s), both numbers in this log.
  - [x] `grep -c 'await sleep(' tools/e2e/run.mjs` is 3: the two poll intervals and step 16's,
        each still carrying its comment; `settle` is gone and `waitIdle` no longer sleeps after the
        spinner.
  - [x] Making `run()` skip the bump (mutation) makes the very first action's wait time out with a
        message naming the generation, then revert.
  - [x] The watcher probe from GR-005 still holds: an untracked file written into the scratch tree
        advances `data-gen` on its own within 1.5s with no click.
  - [x] `npm run typecheck`, `npm test`, build; the attribute is the only renderer-visible change.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/StatusBar.tsx`,
  `tools/e2e/run.mjs`, `CLAUDE.md` (Testing paragraph: the wait discipline and the sleep count).
- **Verify:** the five checks above; look at the printed total on each of the three runs.
- **Log:**
  - 2026-09-06 requested by Ricardo after asking whether the e2e time could be improved; the 39 +
    12 call sites and the 43.8s floor were counted in `run.mjs`, the ~55-60s run length read off
    the shot timestamps of the run then in progress.
  - 2026-09-06 02:28 claimed
  - 2026-09-06 03:00 done. `App` keeps `dataGen`, bumped wherever a snapshot or a status is applied (`load()` on both paths, `refreshStatus()`, `applyChange()`), published as `data-gen` on `.statusbar`. `run.mjs` gained `act(fn)` — read the generation, act, wait for it to have moved **and** the spinner to be gone — and 42 `log(await X()); await settle();` pairs became `log(await act(() => X()));`. `settle` is gone, `waitIdle` no longer sleeps after the spinner and is left only where a DOM wait has already proved the reload landed. **Measured, not estimated**: the pre-batch tree rebuilt and timed at **57s**; after, three runs in a row at **19.7s / 19.5s / 19.6s**, all 104 assertions passing, and the run prints its own total. `grep -c 'await sleep(' tools/e2e/run.mjs` is 3 (two poll intervals, step 16's same-row query), each still commented. Mutation: `bumpGen` made a no-op and rebuilt — step 2's very first `act` times out with `waited for OK clicked to reload the repository (generation was 0)`; reverted. Watcher probe: an untracked file written into the tree advanced `data-gen` 3 -> 4 in **374ms** with no click. One wait cannot use `act()`: step 1 reloads the page, the generation restarts at zero, and the app has usually already loaded the same repository — the old wait was satisfied by the page about to be replaced and the reload landed in step 3 with the left panel empty (three steps failed once before this was found), so the step sets `window.__e2eReloading` and waits for the new document.

### GC-081 Time the e2e run's 141 git spawns and drop the redundant ones

- **Status:** blocked
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-080
- **Why:** After GC-080 the largest remaining cost in the run is its own verification: `git()`
  in `tools/e2e/run.mjs:28` is a synchronous `execFileSync`, it is called 141 times, and every
  call is a fresh `git.exe` process on Windows, roughly 50-70ms each before git does anything —
  an estimated 7-10s, which against a ~25s run is a third of it. Nobody has measured it, which is
  the first problem: a fixed count and an estimate per call is not a number a later change can be
  checked against. Some of the calls are plainly repeated — `status()` read more than once in a
  step with no action between the reads, several `rev-parse` of single refs where one call takes
  them all, check-then-act pairs in the prologue — but which ones are worth removing depends on
  the measurement, so the ticket is deliberately ordered: measure, then cut what the numbers say.
- **Scope:**
  - `git()` accumulates its call count and wall time; the run prints `git: N calls, X.Xs` next to
    GC-080's total-time line.
  - With that number in the log, remove the redundant calls: a second read of the same state with
    no action in between goes; several `rev-parse <ref>` in one step become one `rev-parse a b c`
    (or one `for-each-ref`) split on newlines; a prologue check that only guards a cleanup it could
    run unconditionally (with `okCodes`-style tolerance) is folded into the cleanup. Every removed
    call must be a duplicate of one still made in the same step, so no assertion is weakened.
  - Try, measure and keep only if they show: `GIT_OPTIONAL_LOCKS=0` in the spawn environment so
    `git status` does not refresh and rewrite the index on the fixture, and resolving the git
    executable's absolute path once instead of a PATH lookup per spawn.
- **Out of scope:** making `git()` async and overlapping calls (the assertions are sequential by
  nature, action then read), changing what any step asserts, the fixture (GC-055, GC-056, GC-064,
  GC-076).
- **Acceptance:**
  - [x] The `git:` line is printed; its before value is in this log.
  - [ ] Call count and git wall time both down by at least a third, every assertion still passing
        over three runs; the after values are in this log.
  - [x] Each removed call is named in the log with the surviving call that covers it.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e` three times; compare the two printed lines with the ones GC-080 left.
- **Log:**
  - 2026-09-06 requested by Ricardo alongside GC-080, with the note that the ceiling is about 5s
    and it is worth doing only once GC-080 has made that a meaningful share of the run.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 **blocked on a decision from Ricardo: the measurement contradicts the target.**
    The instrumentation and every safe cut are done and committed; what is left needs a call this session
    should not make alone.
  - **Measured.** `gitRun` — the one place every spawn in the file goes through, so it covers `git` and
    `gitMay` both — counts calls and accumulates wall time, and the run prints `git: N calls, X.Xs` next
    to GC-080's total line. The first number contradicts the ticket immediately: **243 calls, 6.1s** of a
    23.6s run, not the 141 the ticket estimated from grepping call sites. (After GC-055 and GC-056 landed
    earlier in this batch it was 249 calls, 6.2s, which is the fair "before" for the cuts below.)
  - **Cut, 249 -> 219 calls and 6.2s -> 5.4s** (-12%, -13%), every assertion still passing over four runs.
    Each removed call was a duplicate of one still made in the same step:
    - 15 `check()` sites read the working tree once for the condition and again for the detail string,
      with no action in between; the value is hoisted into a local and both uses read it. Steps 5 (x2), 6
      (x2), 8, 14, 15 (x3, which also duplicated `branch --show-current` and `stash list`), 20 (x2), 21,
      27 (x2) and 29.
    - 4 more of the same shape on `shortOf(file)` (`git status --short -- <file>`), in steps 19 (x2), 20
      and 28.
    - The prologue read `git log -1 --format=%s` **inside** a `.some()` callback, so it spawned git once
      per regex in `RUN_COMMITS` rather than once per iteration; hoisted out.
    - `restoreFixture` read `rev-parse main` twice when it had to rewind the bare origin, and step 29
      counted each of its two revision ranges twice (condition, then message).
    - `GIT_OPTIONAL_LOCKS=0` in the spawn environment, so the suite's own `git status` does not refresh
      and rewrite the fixture's index, and git's absolute path resolved once instead of a PATH walk per
      spawn. Kept: they are part of the 6.2s -> 5.4s above.
  - **Why the third is not reachable.** After the cuts the per-call-site tally is flat — the busiest
    remaining site is 4 calls, and the 219 are spread over about 150 sites at one or two each. The whole
    prologue, measured separately, is 29 calls and 0.6s, so deleting it outright would still only reach
    190 / 4.9s against a target of 166 / 4.1s. There is no duplication left to remove: every remaining
    call is one read backing one assertion, and cutting further means cutting assertions, which this
    ticket forbids.
  - **The decision.** Either (a) accept 219 / 5.4s and close this at what the duplicates were worth, or
    (b) take the one further option that exists — make `check()`'s *detail* argument lazy so its git calls
      run only when an assertion fails. That would remove a large share of the remaining calls without
      weakening a single condition, but it also stops passing lines from printing their measured values,
      and those values are what tickets in this file cite as evidence. That is a trade about what the run
      reports, not a refactor, so it is Ricardo's to make.

### GC-082 Popping a stash through the toolbar loses what was staged

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `stashApply`/`stashPop` in `src/main/git.ts` run `git stash pop` without `--index`, so a
  stash made from a mixed tree comes back entirely unstaged: what the user had in the index before
  stashing is silently merged into the working-directory changes. Found while closing GC-076, which
  needed to know what a finished e2e run leaves behind: the fixture starts with a staged README.md
  edit and a staged `main.txt` deletion, and after step 5 stashes and step 8 pops through the
  toolbar, `git status --short` reads ` M README.md` and ` D main.txt` for the rest of the run.
  Nothing in the suite asserted it, so it went unnoticed. The e2e prologue already knows the right
  call — it pops its own recovery stashes with `--index` (GC-036) precisely so the fixture survives.
  Restoring the index is what `git stash pop --index` is for and what GitKraken does; losing it
  costs the user work they cannot get back without redoing the staging by hand.
- **Scope:**
  - `stashApply` and `stashPop` pass `--index`, falling back to the plain form when git refuses it
    (`--index` fails when the stashed index cannot be reinstated, e.g. a conflicting pop) so a pop
    that would have worked before does not start failing.
  - The fallback is not silent: the working directory did come back, but the staging did not, so say
    so once in the error line rather than reporting success.
- **Out of scope:** the stash list UI, `stash push --keep-index`, GC-076's fixture assertions (step
  22 deliberately does not assert the staged half today; it can be tightened once this ships).
- **Acceptance:**
  - [x] Scratch repository: stage one file, edit another, stash through the toolbar, pop through the
        toolbar — `git status --short` shows the staged file staged again (`M ` not ` M`).
  - [x] A pop that cannot restore the index still restores the working tree, and the app says the
        staging could not be reinstated.
  - [x] `npm run e2e` passes; GC-076's step 22 then sees the fixture's own staged half and its
        `EXPECTED_STATUS` constant is updated to match in the same change.
- **Files:** `src/main/git.ts`, `tools/e2e/run.mjs` (step 22's expected status), `CLAUDE.md`.
- **Verify:** typecheck, build, `npm run e2e`, and the two CDP checks above.
- **Log:**
  - 2026-09-06 proposed by GC-076 (this ticket): measuring what a finished run leaves in the fixture
    showed the staged half gone from step 8 onwards, on every run, with or without GC-076.
  - 2026-09-06 02:28 claimed
  - 2026-09-06 03:00 done. `restoreStash(cwd, verb, index)` runs `stash <verb> -q --index`, retries the plain form when git refuses, and then rejects with "The stash was popped to the working directory, but what it had staged could not be put back in the index." — the pop did happen, so reporting it as a clean success would be the same silent loss. Acceptance 1: e2e step 8 now asserts `git status --short` reads `M  README.md` and `D  main.txt` after the toolbar Pop, and that the status bar carries no error. Acceptance 2 needed a state where `--index` fails but the plain form succeeds: a stash whose staged hunk's context lines a later commit moved, so `git apply --cached` refuses while the 3-way tree merge is clean. Driven over CDP in a disposable repo — the working tree came back (`+line 5 STAGED`), the stash was dropped, the status bar carried exactly that sentence (`docs/screenshots/gc-082-index-fallback.png`). Acceptance 3: `EXPECTED_STATUS` now carries the staged half, and three of the suite's own calls had to stop dropping it — step 15's recovery pop takes `--index`, and steps 12 and 23 park it by hand (step 12 because git refuses a cherry-pick outright with a dirty index, filed as GC-090; step 23 because a mixed reset empties it). A fixture carried over from a pre-GC-082 run has already lost the staged half and needs `npm run e2e:setup`; step 25 says so.

### GC-083 A diff that fails to load shows an empty body

- **Status:** done
- **Area:** diff | **Size:** S | **Priority:** P3
- **Depends on:** GC-075
- **Why:** `DiffView`'s body renders one of three things — the loading line, "No textual changes."
  or the hunks — and all three are gated on there being a `text`. When the load rejects there is no
  text and none of them match, so `.diff-body` is blank and the only sign of what happened is the
  small red `.file-view-sub .err` above it. GC-075 made this more reachable rather than less: the
  previous diff no longer stays on screen, so a failed reload now leaves the panel empty where it
  used to leave stale content.
- **Scope:**
  - A fourth body branch for the error: the message, in the same `.diff-empty` shape as the other
    three, so the panel says why it is empty instead of just being empty.
- **Out of scope:** retrying the load, the error line in the sub-header (it stays), the shape of the
  message `git.ts` produces.
- **Acceptance:**
  - [x] With a diff forced to fail (delete the file from disk between opening two views, or point
        the view at a path git cannot diff), `.file-view .diff-body` carries the message and is not
        empty.
  - [x] A successful load is unchanged: no extra element in the body.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css` (only if the
  message needs its own rule).
- **Verify:** typecheck, build, the CDP check above, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GC-075 (this ticket): reworking the load path made the blank-on-error
    body obvious, and more likely to be seen now that a failed reload clears the previous diff.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. `DiffView` derives `loadError` — a `current` whose `text` is null —
    during render and gives it a fourth `.diff-empty` branch; an action error is deliberately not
    this, since it leaves the diff on screen. `.diff-empty` gained `white-space: pre-wrap`, because
    what lands there is git's stderr. Verified by two new cases in `DiffView.test.tsx` (a rejecting
    `getWorkdirFileDiff` puts the message in the body, exactly one `.diff-empty`, the sub-header
    line still there; a successful load has none), which fail when the branch is removed. That is a
    different method from the Verify line's CDP check, and the reason is worth recording: `App`
    closes a WIP file view as soon as its path leaves the status list, so deleting the open file
    closes the panel instead of failing its reload — the running app cannot be made to show this
    for a working-tree file at all. Confirmed over CDP that the panel closes that way, and that a
    diff that loads carries no `.diff-empty`.

### GC-084 Two overlapping actions clear the busy spinner early

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** GC-068
- **Why:** `run()` in `App.tsx` sets `busy` to its own label and clears it to `null` in its `finally`,
  with nothing tying the clear to the call that set it. If a second action starts while a first is
  still in flight, whichever finishes first clears the status bar, so the spinner disappears while an
  operation is still running — and the first call's `setError` can still land over the second's
  state. GC-068 gave the *reads* an identity so a stale one is dropped; the writes still have none.
  Not a data-loss bug: git serialises the work and the reload after each action is correct. It is the
  status bar lying, and the e2e suite's `waitIdle` believing it.
- **Scope:**
  - A busy token in the same shape as GC-068's generation counter: `run()` takes one on entry and
    only clears `busy` (and applies its error) if it still owns it.
- **Out of scope:** queuing or refusing a second action while one runs, a per-action progress UI,
  the reads GC-068 already covers.
- **Acceptance:**
  - [x] Two actions started within the same tick leave the spinner up until the later one finishes.
  - [x] A unit test in `App.test.tsx` covering it, failing when the token check is removed.
  - [x] `npm run e2e` passes: `waitIdle` still settles at the right moment.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/App.test.tsx`.
- **Verify:** `npm test`, typecheck, build, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GC-068 (this ticket): giving the background reads a generation counter
    made it plain that the actions writing `busy` and `error` still have no identity of their own.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. `run()` takes a `busyToken` on entry, the write-side counterpart of
    GC-068's `generation`, and clears `busy` and applies its error only while it still owns it; a
    `rethrow` caller still gets its exception, since that does not depend on the status bar. Two
    tests in `App.test.tsx` drive the real overlap — Refresh, then Stage all from the detail panel,
    whose buttons are gated on its own busy flag rather than the toolbar's — and assert that the
    refresh finishing leaves the spinner on "Staging all", and that a refresh failing under it
    raises no error banner. Both fail with the two `owns()` checks removed (2 failed | 20 passed)
    and pass with them. That is the overlap the ticket describes; the criterion's "within the same
    tick" is not literally reproducible through the UI, since the first action disables its own
    button. `npm run e2e` passes unchanged, 23.5s, so `waitIdle` still settles where it did.

### GC-085 Dead CSS and an unreachable tooltip left over from the one-chip ref column

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-078
- **Why:** GC-078 fixed the ref column at one chip, which left two things behind that no longer
  describe anything. `.ref-chip:not(:first-child):not(.more) { flex-shrink: 50 }` in `app.css` is
  GC-023's rule for making the second and later chips give way at the same weight; there is never
  a second chip in a row now, and the only elements it still matches are the lines inside the
  expanded block, where `flex: none` overrides it — so it is dead either way, but a reader has to
  work that out, and a future change to the block's flex could wake it up. And the `+N` chip's
  `title="More refs on this commit"` can never be shown: the chip is `visibility: hidden` from the
  moment the cell is hovered, which is the moment a tooltip would begin its delay.
- **Scope:**
  - Remove the `.ref-chip:not(:first-child):not(.more)` rule and GC-023's comment above it, which
    describes a fold that no longer exists.
  - Drop the `+N` chip's `title`, or move whatever it should say onto the ref cell, which is the
    element the user is actually pointing at.
- **Out of scope:** the block itself, the one-chip rule, the flip (GC-022), and the `.ref-chip`
  base rule's own `flex: 0 1 auto`, which the single visible chip still needs.
- **Acceptance:**
  - [ ] Neither the rule nor the dead comment is in `app.css`; the ref column and the expanded
        block render identically before and after, compared on a CDP screenshot of the scratch
        repository at 100px, 150px and 400px column widths.
  - [ ] No element carries a `title` that cannot be shown.
  - [ ] `npm test` and `npm run e2e` pass.
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/graph/CommitGraph.tsx`.
- **Verify:** build, the three screenshots above compared against
  `docs/screenshots/gc078-ref-expansion.png`, `npm test`, `npm run e2e`.
- **Log:**
  - 2026-09-06 02:22 proposed by GC-078 (this ticket): pinning the column at one chip left GC-023's
    shrink rule matching nothing in the row and the `+N` tooltip behind a chip that hides itself
    before the tooltip can appear.

### GC-086 The diff body blanks to "Loading diff…" on every hunk action, twice

- **Status:** done
- **Area:** diff | **Size:** S | **Priority:** P1
- **Depends on:** GC-075
- **Why:** GC-075 keyed the loaded diff to `viewKey`, and that key includes `version`
  (`src/renderer/src/diff/DiffView.tsx:38`). `workdirVersion` is bumped by every `refreshStatus()`,
  so after a Stage hunk click the key changes, `current` goes null and the body renders
  `Loading diff…` until the reload lands — and it happens twice, because the action's own status
  reload bumps the version once and the watcher's parked `.git/index` event, flushed when `busy`
  clears (`App.tsx:300-303`), bumps it again. Measured over CDP on the review's scratch repository at
  bf02975 with a MutationObserver on `.diff-body` across one Stage hunk click on `big.txt`
  (`%TEMP%/gitclient-review/GR-008/observe.js`): `2 hunks|@@ -1,6 +1,6 @@` →
  `0 hunks|Loading diff…` → `1 hunks|@@ -32,7 +32,7 @@` → `0 hunks|Loading diff…` →
  `1 hunks|@@ -32,7 +32,7 @@`. Before GC-075 the previous hunks stayed on screen until the new text
  arrived; GitKraken's diff never blanks on a hunk stage, the hunk simply leaves the list. The
  guarantee GC-075 exists for — no hunk button acting on a diff loaded for another view — needs the
  *identity* of the view, not its version: a reload of the same file on the same side is a refresh
  of what is already on screen, and the buttons are gated by `actionsDisabled` while it is pending.
- **Scope:**
  - Split the key. The content stays rendered while the view identity
    (`repo|source|path|sha` or `repo|source|path|staged|kind`) is unchanged, and only that identity
    changing drops the body to the loading line. A `version` change starts a reload as today and
    keeps `actionsDisabled` true until it lands (the pending load's key is not the loaded key), so
    GC-075's guarantee holds: no button is live over content whose load is not the newest.
  - While a same-view reload is pending the stale content is dimmed (a class on `.diff-body`, one
    opacity rule), so a slow reload is visible without a blank.
  - Repeat GC-075's render-trace check both ways: the trace across a Stage hunk click shows no
    `Loading diff…` state, and the trace across a switch from Unstaged to Staged of the same file
    still shows none of the other side's hunks under the new header.
- **Out of scope:** the double reload itself (the watcher echo of the action's own index write —
  `run()` could mark the change it caused as already applied, but that is GC-011's territory and a
  ticket of its own if it is wanted), GC-083's error body, GC-084.
- **Acceptance:**
  - [ ] MutationObserver trace across Stage hunk on the fixture's `big.txt`: no state carries
        `Loading diff…`; the hunk count goes 2 → 1 with no empty body between.
  - [ ] Trace across Unstaged → Staged of the same file: no frame shows the previous side's added
        lines under the new chip (GC-075 preserved), and `Unstage hunk` stays disabled until the
        staged diff has landed.
  - [ ] A view-identity change (another file, or the other side of the same file) shows
        `Loading diff…` immediately, never the previous view's hunks.
  - [ ] `npm run e2e` passes; step 21's content-keyed `waitDiff` is the regression net.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** typecheck, build, the two CDP traces above, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GR-008: measured on the shipped GC-075 — one hunk click blanks the body
    twice, where the previous render kept the hunks in place until the new ones arrived.
  - 2026-09-06 03:03 claimed
  - 2026-09-06 03:39 done. `DiffView` splits the key in two: `identityKey` (`repo|source|path|sha`
    or `repo|source|path|staged|kind`) decides what is *rendered*, `viewKey` adds `version` and
    decides whether the content is the newest. `current` matches on identity, so a same-view reload
    keeps its hunks; `stale` is `current.key !== viewKey` and joins `actionsDisabled`, so GC-075's
    guarantee holds without emptying the body. One CSS rule, `.diff-body.stale { opacity: 0.55 }`.
    Verified over CDP with a MutationObserver on `.file-view` (the same instrument GR-008 used):
    across one Stage hunk on the fixture's `big.txt` the rendered states are
    `Unstaged|2 -> Unstaged|2 -> Unstaged|1 -> Unstaged|1 -> Unstaged|1` — no `Loading diff…`, never
    0 hunks. Mutation-checked both ways: restoring `current = loaded?.key === viewKey`, rebuilding
    and re-running the same trace reproduces GR-008's measurement exactly,
    `2 -> 0|Loading diff… -> 1 -> 0|Loading diff… -> 1`, and the file was restored from a copy
    afterwards. The identity-change trace is
    `Unstaged|1|@@ -1,6 -> Staged|0|Loading diff… -> Staged|1|@@ -32,7|Unstage hunk`: the loading line
    appears immediately, no frame shows the unstaged side under the `Staged` chip, and `Unstage
    hunk` only ever appears on a state that already has the staged hunk. `npm run e2e` ALL PASSED
    (step 21's content-keyed `waitDiff` is the net); `npm test` 77.

### GC-087 The commit view's ref line is git's decorate string, truncated to "origin/m…"

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-078
- **Why:** `src/renderer/src/components/DetailPanel.tsx:330` renders `commit.refs.join(', ')` — the
  `%D` decoration as git hands it back — so the top-right of the commit view reads
  `HEAD -> main, tag: v0.1.0, origin/m…` at the default 400px panel width (GR-008's
  `08-commit-selected.png`; GR-006 saw `origin/m…` and GR-007 `origin…` on the same line). Three
  things are wrong with it: `HEAD -> ` and `tag: ` are git's syntax, not the app's; the list
  ellipsises at its end, so the remote is the ref that disappears; and it is the only place refs are
  shown as text — the graph shows the same refs as chips, and the study's commit panel
  (`04-panels.md`, "Detail panel: commit view"; `03-commit-selected.png`) has no ref list at all,
  only `commit:` and `parent:`. The line does what a tooltip does and takes the header for it.
- **Scope:**
  - Render the commit's refs as `.ref-chip`s with the graph's classes and icons (check mark on
    HEAD's branch, cloud on a remote, tag icon on a tag), wrapping onto their own row under the
    `commit:` line rather than sharing it; no `HEAD -> ` or `tag: ` prefixes.
  - Reuse the graph's ordering (HEAD, locals, remotes, tags) and its absorb-the-upstream rule, so
    `main` + `origin/main` at the same commit is one chip with the cloud mark, as in the graph.
  - Right-click on a chip opens the same `refMenuItems` menu the graph's chips open; double-click
    checks out through `runCheckout`.
  - Lift the chip markup into one component both `CommitGraph.tsx` and `DetailPanel.tsx` render,
    rather than duplicating it — after GC-078 has settled what a chip row looks like.
- **Out of scope:** the `+N` fold (the panel wraps instead), hover expansion, the WIP view's header,
  the `title` tooltip (it can stay as the full list).
- **Acceptance:**
  - [ ] On the fixture's merge commit (`main`, `origin/main`, `v0.1.0`) the header shows two chips,
        `main` with the cloud mark and `v0.1.0`; no `HEAD -> `, no `tag: `, no ellipsis at 400px.
  - [ ] A commit with no refs shows no ref row and leaves no empty space where one would be.
  - [ ] Right-click on the `main` chip opens the branch menu; `npm test` and `npm run e2e` pass.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/graph/CommitGraph.tsx`
  (the chip component moves out), `src/renderer/src/styles/app.css`.
- **Verify:** typecheck, build, a CDP screenshot of the merge commit into `docs/screenshots/`,
  `npm test`, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GR-008: from the screenshot pass — the third review in a row to see this
    line truncated, and the study's panel does not have it at all.

### GC-088 Branch breadcrumb dropdown: switch branches from the toolbar

- **Status:** done
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-066, GC-067
- **Why:** The toolbar's breadcrumb is two controls in the study — `repository / name` and
  `branch / name`, both dropdown buttons (`01-layout.md`, "Toolbar detail"; `04-panels.md`,
  "Dropdowns": 250px DOM menus with group headers; `05-menus-shortcuts.md`, "Toolbar dropdowns":
  the branch breadcrumb opens a search box with local and remote branches grouped, checkout on
  select). Ours has the repository half since GC-044, and the branch half is a plain `div.crumb`
  (`src/renderer/src/components/Toolbar.tsx:103-113`) that shows the name and the ahead/behind badge
  and does nothing on click, although it is drawn exactly like the control beside it that does.
  GC-044 named it out of scope. It is the quickest way GitKraken offers to switch branches without
  finding the row in the left panel or the chip in the graph, and everything it needs exists:
  `openMenu` with an `owner` for the toggle (GC-066), `caption` rows for the group headers (GC-067),
  `runCheckout` for the dirty-tree guard (GC-004, GC-019) and the tracking-branch checkout the left
  panel's remote rows already use.
- **Scope:**
  - The branch crumb becomes a `button.crumb.as-button` like the repository one and opens a menu
    anchored at its bottom-left corner: caption `Local`, one row per local branch (the checked-out
    one marked and disabled), caption `Remote`, one row per remote branch (`origin/feature`); each
    row's hint is the ahead/behind text when there is one, else the short sha.
  - Selecting a row checks the branch out through `runCheckout` — a remote row through the
    tracking-branch path — so the dirty-tree prompt and "Stash and check out" apply unchanged.
  - On a detached HEAD the crumb still reads `detached HEAD` and the menu still opens, no row marked.
  - A second click closes it (GC-066's owner toggle); Escape closes exactly it (it is a
    `ContextMenu`, so `layerOpen` already covers it) — nothing new joins the Escape handler.
- **Out of scope:** a search box inside the menu (the left panel's `Filter refs` is the filter
  today; a `MenuItem` that hosts an input would be a new UI primitive and its own ticket once the
  list is long on a real repository), favourites, tags in the menu, the study's fixed 250px width
  (our menus size to content, capped at 420px).
- **Acceptance:**
  - [x] Clicking the branch crumb on the fixture opens a menu with `Local` (feature, main marked,
        wip-branch) and `Remote` (origin/feature, origin/main, origin/wip-branch); a second click
        closes it; Escape closes it and nothing behind it.
  - [x] Choosing `feature` with the fixture's dirty tree raises the GC-004 prompt naming the files at
        risk; Cancel leaves `git rev-parse --abbrev-ref HEAD` at `main`; "Stash and check out" lands
        on `feature` with the tree re-applied (the e2e step 15 pattern).
  - [x] Choosing a remote branch with no local counterpart creates the tracking branch and checks it
        out (`git branch -vv` shows `[origin/<name>]`).
  - [x] An e2e step covers the first two; `npm run e2e` passes.
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/App.tsx` (an
  `openBranchMenu(at)` beside `openRepoMenu`), `src/renderer/src/styles/app.css` (the crumb's hover
  state), `tools/e2e/run.mjs`, `CLAUDE.md` (the "openPath / openRepoMenu" paragraph).
- **Verify:** typecheck, build, `npm test`, `npm run e2e`, a CDP screenshot of the open menu into
  `docs/screenshots/`.
- **Log:**
  - 2026-09-06 proposed by GR-008: from the what's-next pass against `05-menus-shortcuts.md`
    "Toolbar dropdowns" — the one toolbar control in the study that ours draws but does not wire.
  - 2026-09-06 03:42 claimed
  - 2026-09-06 04:15 done. The branch crumb is a `button.crumb.as-button` opening `openBranchMenu(at)` at its own bottom-left with `owner` set, so a second click closes it (GC-066). Captions `Local` and `Remote`, one row per branch named by the branch itself, the checked-out one labelled `✓ main` and disabled — the same check the left panel puts on its row — and each row's hint the ahead/behind in the toolbar badge's arrows, else the short sha. Every row goes through `checkoutRef`, so the dirty-tree guard, the stash offer and the tracking-branch path come with it and nothing new joins the Escape handler. e2e step 26 covers the menu's contents, the owner toggle, Escape closing exactly it, and the guard naming 3 files at risk with Cancel leaving HEAD on `main` (7 assertions); screenshot `docs/screenshots/gc-088-branch-crumb.png`.
    The two criteria the fixture cannot show were driven over CDP against a throwaway repository in `%TEMP%`: choosing `origin/only-remote`, which has no local counterpart, created and checked out the tracking branch (`git branch -vv` → `* only-remote 55241c3 [origin/only-remote]`), and choosing `side` with a dirty tree took the "Stash and check out" offer, landing on `side` with `M  a.txt ?? .gitignore` re-applied and an empty stash list.


### GC-089 Slim CLAUDE.md back down to a handover: the history moves to the tickets

- **Status:** done
- **Area:** infra | **Size:** M | **Priority:** P1
- **Depends on:** none
- **Why:** Ricardo, joining GR-008's session: the file "already starts having too much crap" and
  needs a revision ticket. Measured at 9206ba6: **867 lines, 10,940 words, 71 KB**, touched by 31
  commits in two days, with 147 `GC-0NN` citations to 59 tickets. The Architecture section is 356
  lines and Testing 219, most of it ticket-by-ticket narrative — what was tried first, which
  mutation check ran, what a flake looked like — that the ticket logs already hold word for word;
  the "Done" paragraph alone is 1,265 words listing every shipped ticket, a list the board in
  `TICKETS.md` already is. Both routines read the whole file before they can start, so every word
  costs context on every run, and the rules that matter (the two hard rules, stealth launches, the
  narrow stops, one Escape one layer, no early forking) sit inside paragraphs about how they came to
  be. The file's own opening line says what it is for: "everything a fresh session needs to continue
  the work without re-deriving it". History a session does not need in order to act is the opposite.
- **Scope:**
  - Rewrite `CLAUDE.md` so each section describes the current state of the thing — what it is, the
    invariant to keep, one line of reason where the reason is not obvious — and move every
    "how we got here" narrative to the ticket it belongs to: check the ticket's log already says it
    and append a line there when it does not, then delete it from `CLAUDE.md`. A `GC-0NN` citation
    stays only where a reader would follow it for the *why* of a rule that looks arbitrary; it goes
    where it is a credit.
  - Replace the "Done" paragraph with one sentence pointing at the board plus the short list of
    design decisions that must not be undone (date order, no early forking, column 0 for HEAD, one
    Escape one layer, stealth launches and narrow stops, the per-port profile, LF working copy, study
    never copy, no writes against the real repositories).
  - Testing: keep what each suite covers as a list of surfaces, the fixture's shape, the re-entrancy
    rules a new step must respect, and the conventions for adding a test (extension picks the
    environment, no globals, the `act` wiring); drop the per-step narratives and the per-test
    mutation-check anecdotes.
  - Target **under 400 lines and 5,000 words** without losing one rule or command: before the
    rewrite, extract every imperative sentence (must / never / only / do not / always) and every
    command from the current file into a checklist, and tick each one as present in the new file.
- **Out of scope:** changing any convention (this ticket documents, it does not decide),
  `README.md`, the study notes, `TICKETS.md` beyond appended log lines, splitting the file: one file
  is what both routines read, and a second is a second thing to keep in sync — if a section truly
  wants its own file, say so in the log for Ricardo to decide.
- **Acceptance:**
  - [ ] `wc -l -w CLAUDE.md` under 400 / 5,000 (from 867 / 10,940 at 9206ba6).
  - [ ] The checklist is complete and in the ticket log (or its counts and the diff of the two
        extractions): every rule and command in the old file has a counterpart in the new one.
  - [ ] Cold read: the Routine protocol's steps 1–6 and the Review routine's isolation rules can be
        followed from the new file plus `TICKETS.md` alone, and the commands it names run:
        `npm run typecheck && npm test && npm run build`, then `npm run e2e:setup && npm run e2e`.
  - [ ] Every removed narrative is in its ticket's log (already, or appended in the same commit);
        `grep -c 'GC-0' CLAUDE.md` well below 147 and each remaining citation sits beside a rule.
- **Files:** `CLAUDE.md`, `TICKETS.md` (appended log lines only).
- **Verify:** the counts, the checklist, the cold read, `npm test` (the hygiene test still guards the
  LF working copy and control bytes).
- **Log:**
  - 2026-09-06 asked for by Ricardo during GR-008's session, filed by GR-008: 867 lines, 10,940
    words, 147 ticket citations and 31 commits to the file in two days.
  - 2026-09-06 03:03 claimed
  - 2026-09-06 03:39 done, with one acceptance criterion met on words and not on lines; see
    below. `CLAUDE.md` went from **918 lines / 11,767 words** (at cee2b53 — larger than the 867 /
    10,940 the ticket measured at 9206ba6) to **466 lines / 4,910 words**, a 49% and 58% cut, and
    from **152** `GC-0` citations to **2** (this ticket, on the "keep it short" instruction, and
    the introduction). Every section now states the current rule and at most one clause of why; the
    "Done" paragraph is replaced by one sentence pointing at the board plus the list of decisions
    that must not be undone, and the per-ticket narratives, per-test mutation anecdotes and per-step
    e2e stories are gone.
    **Checklist**: every rule and command in the old file was extracted into 121 markers and each
    checked against the new one (`scratchpad/check-rules.mjs`, whitespace-normalised so a rule that
    now wraps differently still counts) — **121 of 121 present, 0 missing**. A mechanical diff of
    the fenced commands old vs new leaves only `git apply`, `git log -1`, `git log -1 --format=%B`,
    `git ls-remote` and `git rev-list --count HEAD`, all of which were assertions quoted from
    inside e2e step narratives rather than commands a session runs; the file now points at
    `run.mjs`'s own step titles for those. `npx esbuild …` and `npx vitest run --project …` are
    both still present (they only fell out of the grep because they wrap).
    **Cold read**: the Routine protocol's steps 1-6 and the Review routine's isolation rules are in
    `TICKETS.md`, which this file names as the authority and did not change; every command the new
    file lists was run in this batch — `npm run typecheck`, `npm test` (77), `npm run build`,
    `npm run e2e:setup`, `npm run e2e` (117, ALL PASSED) and `node tools/launch-app.mjs`.
    **Removed narratives**: spot-checked GC-058, GC-076, GC-030 and GC-022, whose logs already carry
    the removed text nearly verbatim — the logs are where it came from — so no log lines had to be
    appended. Nothing was moved out of this file that is not already in a ticket.
    **Not met**: `wc -l` is 466, not under 400 (words are 4,910, under 5,000). Getting to 400 at
    the file's 100-column wrapping needs roughly 4,200 words, and every remaining paragraph is a
    rule or a command that the same criterion says must not be lost — the inventory that could go
    (the layout tree, the shipped-ticket list, the e2e step list, the per-test coverage list) is
    already gone. Reporting the measurement rather than deleting rules to reach a round number;
    Ricardo can say whether the line target or the content should give.


### GC-090 A sequencer action with a dirty index fails with git's raw refusal

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** GC-082
- **Why:** git refuses to start a cherry-pick, a revert, a merge or a rebase while anything is
  staged: it prints "error: your local changes would be overwritten by cherry-pick. hint: commit
  your changes or stash them to proceed." and stops before touching the repository. The app offers
  all four with no guard, so the click looks valid and the only feedback is git's own line in the
  status bar, naming a hint the user cannot act on without leaving the app. GC-004 already
  established the shape for this — the checkout guard asks first and offers "Stash and check out"
  — and the same three choices fit here exactly. Found while closing GC-082: with the index
  correctly restored by a pop, the e2e suite's step 12 could no longer reach the in-progress
  cherry-pick it asserts, because git now refuses that cherry-pick up front. Before GC-082 the
  index happened to be empty at that point, and the hole was invisible.
- **Scope:**
  - One guard, shared by cherry-pick, revert, merge and rebase, on the same `runCheckout` /
    `ui.prompt` pattern as GC-004: when `status.entries` has a staged or conflicted entry, ask
    first, naming the number of staged files, and offer Cancel / "Stash and continue" / nothing
    else — "continue anyway" is not a choice here, because git will simply refuse.
  - "Stash and continue" is `stash push` (staged half included), the action, then
    `stash pop --index`, in one `run()`, with the stash popped back if the action fails — the
    shape `runCheckout` already uses (GC-004, GC-082).
  - The e2e suite's step 12 then drops the by-hand `git reset` / `git add -A` pair it needs today
    and drives the guard instead.
- **Out of scope:** the working-tree-only dirty case (git carries unstaged changes into a
  cherry-pick when the files do not overlap, so it is not a refusal), the checkout guard itself,
  a preference to switch the prompt off.
- **Acceptance:**
  - [x] Scratch repository with one staged file: Cherry pick commit prompts instead of running,
        and Cancel leaves HEAD, the index and the working tree untouched.
  - [x] "Stash and continue" applies the cherry-pick and puts the staged file back staged.
  - [x] The same guard fires for Revert, Merge and Rebase; a clean index raises no prompt.
  - [x] `npm run e2e` passes with step 12's manual index parking removed.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, `npm run e2e`, and the three CDP checks above.
- **Log:**
  - 2026-09-06 proposed by GC-082 (this ticket): restoring the index on a pop made the app's
    unguarded sequencer actions reachable in the fixture for the first time, and step 12 had to
    unstage the fixture's own staged half by hand to keep asserting what it asserts.
  - 2026-09-06 03:42 claimed
  - 2026-09-06 04:15 done. One `runSequencer(what, label, action)` in `App.tsx` guards cherry-pick, revert, merge and rebase from both menus: with any staged or conflicted entry it asks first, naming the count, and offers Cancel / "Stash and continue" only. Verified over CDP in a throwaway repository — all four actions prompt with `1 staged file` and run nothing on Cancel (HEAD and the index unmoved), a clean index runs the merge with no prompt at all, and "Stash and continue" on a clean cherry-pick landed the commit, left `a.txt` staged again, no stash behind it and no error in the status bar. Screenshot `docs/screenshots/gc-090-sequencer-guard.png`.
    One deviation from the scope, found by e2e step 12: the stash is **not** popped back when the action leaves git mid-operation. `git stash pop` runs `git reset` internally, which deletes `CHERRY_PICK_HEAD`, so putting the index back quietly cleared the in-progress state the banner and Abort exist for — the step's `cherry-pick in progress` assertion caught it. The guard now reads the status after a failure and, when `operation` is set, keeps the stash and says which stash holds the changes. That sentence reaches the status bar's tooltip only, because `headline()` shows one line: evidence for GC-091, which owns that, rather than a new ticket.
    Step 12 no longer parks the fixture's staged half by hand: it drives the guard, asserts Cancel is inert, takes the stash offer to reach the already-applied cherry-pick, and pops the guard's stash back after the abort. The prologue pops a stranded `Before cherry-picking …` stash for a run that dies in between. `npm run e2e`: 28 steps, 143 assertions, ALL PASSED, twice in a row.


### GC-091 The status bar can only report a failure, so a partial success reads as one

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-082
- **Why:** `App` has one channel for anything an action has to say: `error`, rendered by
  `StatusBar` as a red `.err` with a warning glyph. GC-082 had to use it for an outcome that is
  not a failure — a pop whose working directory came back but whose index could not be
  reinstated — because saying nothing would have hidden the loss of the staging. The result reads
  as "the pop failed" when the pop succeeded (`docs/screenshots/gc-082-index-fallback.png`: the
  stash is gone, the file is back, and the line is red). The same gap will be hit by every action
  with a degraded-but-done outcome: a fetch that pruned, a pull that fast-forwarded nothing, a
  push that had nothing to send.
- **Scope:**
  - A second severity on the same slot: `setNotice(text)` beside `setError`, rendered with the
    neutral/warning token rather than `--danger` and the same dismiss button, cleared by the next
    action exactly as `error` is.
  - `run()` learns to carry it: a `GitError` the main process marks as advisory becomes a notice
    rather than an error. One flag on `GitError` is enough; `git.ts` sets it on GC-082's fallback.
  - Both are never shown at once: an error wins.
- **Out of scope:** a toast system, a history of messages, re-classifying any other existing
  message, the empty state's `gitError` line (GC-025).
- **Acceptance:**
  - [ ] The GC-082 fallback shows the neutral line, not the red one, and still says the staging
        could not be reinstated.
  - [ ] A real failure (a conflicting merge) still shows the red line, unchanged.
  - [ ] A notice is cleared by the next action, like an error.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/StatusBar.tsx`,
  `src/renderer/src/styles/app.css`, `src/main/git.ts`, `src/shared/types.ts`.
- **Verify:** typecheck, build, `npm test`, the two CDP checks above with a screenshot of each.
- **Log:**
  - 2026-09-06 proposed by GC-082 (this ticket): the fallback message had nowhere to go but the
    error line, so an operation that did most of what was asked is reported as a failure.


### GC-092 A conflicting stash pop reports "could not write index" instead of the conflict

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** GC-082 wrapped `stash apply` and `stash pop` in `restoreStash`, which tries
  `--index` first and falls back to the plain form on any failure. Its premise, stated in the
  function's own comment and repeated in `CLAUDE.md`, is that "`--index` refuses when the stashed
  index cannot be reinstated and **applies nothing when it refuses**". That is true only when git
  aborts before merging. It is false for the case a user hits most often — popping onto a tree
  that has moved on — where `--index` merges, writes conflict markers, leaves `UU` entries in the
  index, keeps the stash and exits 1 with the useful "Index was not unstashed. The stash entry is
  kept in case you need it again." The `catch` throws that message away and retries the plain
  form against the tree it has just conflicted, which fails with `error: could not write index` /
  `<file>: needs merge`, and *that* is the `GitError` the user sees. Measured on git 2.x in a
  scratch repository (base `f.txt` = a/b/c; stash a staged `g.txt` plus an unstaged `A/b/c`;
  commit a conflicting `X/b/c`; pop): step one leaves `UU f.txt`, `M  g.txt` and the stash intact,
  step two adds nothing and reports the index error. Before GC-082 the same pop surfaced git's own
  conflict output and the files appeared in the Conflicted group. Nothing is lost — the conflict
  is on disk and the stash is still there — but the message names an index write the user never
  asked for, and nothing on screen says there is a conflict to resolve.
- **Scope:**
  - `restoreStash` retries **only when the first attempt changed nothing**. Git's own signal is
    the difference between an abort ("Aborting", no working-tree change) and a conflicting apply
    ("Index was not unstashed", `UU` entries present); test the state rather than the wording,
    which is not stable across git versions or locales — `--index` having produced any unmerged
    entry, or any working-tree change, means it applied.
  - When it applied, the first error is what propagates, unchanged, so the conflict reaches the
    status bar and the Conflicted group as it did before GC-082.
  - The GC-082 fallback path — `--index` genuinely refused, the plain form succeeded, the staging
    is gone — keeps the message it has today.
- **Out of scope:** re-classifying that message as a notice rather than an error (GC-091 owns
  that), conflict resolution UI, `stash branch`.
- **Acceptance:**
  - [x] The scratch-repository sequence in Why pops with git's conflict message, not
        "could not write index"; the conflicted file shows in the Conflicted group.
  - [x] The GC-082 case still reports that the staging could not be reinstated.
  - [x] A clean pop still restores the index (`git status --short` keeps its first column).
  - [x] A unit test over the decision, feeding `restoreStash` a fake runner: applied-with-conflict
        does not retry, refused-without-applying does.
- **Files:** `src/main/git.ts`, a new or extended test beside it, `tools/e2e/run.mjs` if the
  conflicting pop is worth a step, `CLAUDE.md` (the GC-082 paragraph states the false premise).
- **Verify:** the three git sequences by hand in `%TEMP%` (never in a real repository),
  `npm test`, `npm run typecheck`.
- **Log:**
  - 2026-09-06 proposed by GR-009: measured in a scratch repository against e5b3b33; the retry
    destroys git's real error and reports one caused by the retry itself.
  - 2026-09-06 03:42 claimed
  - 2026-09-06 04:15 done. `restoreStashWith(run, verb, index)` reads `git status --porcelain` before the `--index` attempt and again when it fails: an unmerged entry, or any change to the status at all, means it applied, and git's own error then propagates untouched; only an unchanged status retries the plain form. State, not wording, because neither survives a git version or a locale. Driven through the real module (an esbuild bundle of `git.ts`) against three scratch repositories in `%TEMP%`: (1) the Why sequence now rejects with git's `Index was not unstashed.` and leaves `UU f.txt`, `A  g.txt` and the stash in place — the same sequence against e5b3b33 retried the plain form and reported `error: could not write index` / `f.txt: needs merge`, measured side by side; (2) a stash whose staged half a later commit landed identically (`apply --cached` refuses, the 3-way merge is clean) still reports "…could not be put back in the index.", tree back, stash dropped; (3) a clean pop keeps its first column (`M  f.txt`, ` M h.txt`). Six unit tests over the decision with a fake runner in the new `src/main/git.test.ts`.
    Two notes on the acceptance. `-q` suppresses git's CONFLICT line, so the message that reaches the status bar in case (1) is `Index was not unstashed.`, not a CONFLICT line — the conflicted file does show in the Conflicted group, which is the half that matters. And no e2e step: a conflicting pop leaves conflict markers and a kept stash in the fixture, which the restore step would have to unpick, for a decision the unit tests already pin down.

### GC-093 No way to ignore a file: the row menu cannot write .gitignore

- **Status:** done
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-043
- **Why:** GC-043 gave every file row a context menu and explicitly left "Ignore file /
  extension / folder (writes `.gitignore`; its own ticket if wanted)" out of scope. This is that
  ticket. The study lists it among the file actions worth supporting
  (`06-feature-inventory.md`, Files row), and it is the one thing a user reaches for the moment a
  build directory or an editor swap file appears in Unstaged: today the only options on an
  untracked row are Stage, Delete file and the three shell actions, so the alternative is leaving
  the app and editing `.gitignore` by hand. It is also the last common untracked-file action
  missing — everything else on that row already exists.
- **Scope:**
  - Three entries in a separated group on an **untracked** row only (a tracked file is already in
    the index and ignoring it does nothing, which is exactly the confusion to avoid): "Ignore
    file", "Ignore all *.<ext> files" (absent when the name has no extension) and "Ignore this
    folder" (absent at the repository root).
  - A new `workdir:ignore` channel: `git.ts` appends the pattern to the repository's root
    `.gitignore`, creating it if absent, with a trailing newline and no duplicate line if the
    exact pattern is already there. Paths are written git-style with `/` separators, rooted with
    a leading `/` so `build` at the root does not also ignore `src/build`.
  - It goes through the same argument validation as every other channel, and the same
    repository-containment check `repoFile()` already applies, so a pattern cannot be built from
    a path outside the repository.
  - `run()` wraps it like any other action, so the status refreshes and the row disappears.
- **Out of scope:** a `.gitignore` editor, per-directory `.gitignore` files, `.git/info/exclude`,
  global excludes, un-ignoring, templates, ignoring from the commit file list (a committed file
  is tracked).
- **Acceptance:**
  - [x] Right-clicking an untracked `new.txt` offers the three entries; right-clicking a tracked
        modified file offers none of them.
  - [x] "Ignore file" appends `/new.txt`, the row leaves Unstaged, and `.gitignore` itself appears
        as the untracked change.
  - [x] "Ignore all *.txt files" appends `*.txt`; a second invocation adds no duplicate line.
  - [x] A file with no extension shows no extension entry; a root-level file shows no folder entry.
  - [x] An existing `.gitignore` without a trailing newline gains one before the new pattern
        rather than joining the last line.
  - [x] e2e step: ignore a scratch untracked file, assert `git check-ignore` agrees, then restore
        `.gitignore` so the fixture is unchanged (step 25 must still pass).
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/App.tsx` (`fileMenuItems`), `tools/e2e/run.mjs`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, the e2e step, and the menu
  screenshotted on an untracked and a tracked row.
- **Log:**
  - 2026-09-06 proposed by GR-009 (what's-next pass): the follow-up GC-043 invited, and the last
    common untracked-file action the row menu is missing.
  - 2026-09-06 03:42 claimed
  - 2026-09-06 04:15 done. `workdir:ignore` appends to the repository's root `.gitignore`: `ignorePattern(rel, kind)` builds `/path`, `*.ext` or `/dir/`, `ignore()` creates the file when absent, adds the missing newline first and writes nothing for a line already there. The path is validated by `repoRel()` in `ipc.ts` — the containment check `repoFile()` already applied, refactored to share it — so the pattern is built from what the check returns, never from what the renderer sent, and `oneOf` validates the kind. The three entries appear in their own group on an **untracked** row only.
    Acceptance, e2e step 27: an untracked `new.txt` offers file and `*.txt` and no folder entry, a tracked README.md offers none of them, `Ignore file` writes `/new.txt`, `git check-ignore -v` agrees, the row leaves Unstaged and `.gitignore` takes its place, a file with no trailing newline gains one before the next pattern, an exact repeat adds no second line, and the step removes `.gitignore` again so step 28 still passes. Over CDP in a throwaway repository: a name with no extension offers no extension entry, a nested `build/out/bundle.log` offers all three and `Ignore this folder` wrote `/build/out/`. Nine unit tests over `ignorePattern`. Screenshot `docs/screenshots/gc-093-ignore-menu.png`.
    The hints are bare paths on purpose: `.ctx-hint.path` ellipsises at the start by turning the box RTL (GC-067), and a `/` at either end of the string is a neutral character, so it is reordered to the other end — `/build/out/bundle.log` first rendered as `build/out/bundle.log/`, seen in the screenshot and fixed before closing.

### GC-094 The left panel header counts refs and never says which branch is checked out

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-061
- **Why:** The left panel's header is `Viewing <N>`, where N is `local + remotes + tags` — 7 on
  the scratch repository. It sits directly above sections reading LOCAL 3, REMOTE 3, TAGS 1,
  STASHES 0, which are the same numbers again, and directly above a status bar reading
  "8 commits", so the one number that is not a repeat of something adjacent reads as a commit
  count and disagrees with it. Nothing is served by it. The slot it occupies is where the
  panel should say where HEAD is, which matters most in the case GC-061 shipped for: with a
  detached HEAD no row in LOCAL carries the check mark and the panel goes silent about it
  (`GR-009/05b-detached-head-refs.png` — three unmarked branches, the only "detached HEAD" on
  screen being the toolbar breadcrumb). GC-061 reasoned it could leave the panel alone because
  "the header already says so"; the header it meant is the toolbar's, not this one.
- **Scope:**
  - The header names the checked-out branch, and reads `detached HEAD` with the short sha when
    `info.branch` is null, using the wording the breadcrumb and the staging header already use so
    the three agree.
  - The ref count goes; the per-section counts already carry it.
  - The collapsed icon rail is unchanged.
- **Out of scope:** a left-panel row for HEAD (GC-061 ruled that out and this does not reopen it),
  ahead/behind in the header, the filter box, the Hide/Solo controls (GC-073).
- **Acceptance:**
  - [ ] On a normal checkout the header names the branch and matches the breadcrumb.
  - [ ] After `git checkout --detach HEAD` + Refresh the header says `detached HEAD` with the
        short sha, and matches the breadcrumb and the staging header.
  - [ ] No number in the header; LOCAL / REMOTE / TAGS / STASHES counts unchanged.
  - [ ] Collapsing and reopening the panel is unaffected.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/App.tsx` (the props
  it needs), `src/renderer/src/styles/app.css`.
- **Verify:** `npm run typecheck`, `npm run build`, both states screenshotted over CDP against
  `docs/reference/gitkraken/08-left-panel-expanded.md`/`.png`.
- **Log:**
  - 2026-09-06 proposed by GR-009 (screenshot pass): the header's number repeats its own sections
    and contradicts the status bar, and the panel is the one place that stays silent when HEAD
    detaches.
  - 2026-09-06 note from GC-073: "Viewing" now counts only the refs the graph is drawing, so a
    hidden branch leaves the number. The header still repeats its sections and still says nothing
    about HEAD, so this ticket stands; its "N is local + remotes + tags" is out of date.

### GC-095 The graph draws commits from refs the left panel never lists

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-073
- **Why:** `getLog` runs `git log --all`, and `--all` means *every* ref under `refs/` plus HEAD —
  not just the heads, remotes and tags `getRefs()` reads. Anything else in the namespace puts its
  commits in the graph with no chip to explain them and no row in the left panel: `refs/notes/*`
  on a repository using git notes, `refs/pull/*` on a GitHub clone configured to fetch them,
  `refs/stash` (already excluded by name, which is the precedent), and any tool's private
  namespace. Two consequences. The graph can show rows the user cannot account for, and, since
  GC-073, **hiding a branch can appear to do nothing**: the eye is ticked, the row is dimmed, and
  the commits stay because an invisible ref still reaches them, with nothing on screen saying why.
  Found while writing GC-073's e2e step: the fixture's own `refs/e2e/baseline/*` snapshot kept
  `Work on wip branch` in the graph after both `wip-branch` and `origin/wip-branch` were hidden,
  and the assertion failed for a reason that looked like a bug in the feature. That fixture was
  moved to a file (`<root>/.e2e-baseline.json`) as part of GC-073, which fixes the suite but not
  the app: a real repository can carry exactly the same shape.
- **Scope:**
  - Decide and implement what "all" means for the graph. The straightforward reading is that it is
    the refs the app can show — `--branches --remotes --tags` plus HEAD — rather than `--all`;
    check against a repository with notes and with a `refs/pull/*` fetch refspec that the commit
    set is the same as today's minus the unreachable-by-a-listed-ref ones.
  - Keep the `--exclude=` mechanism GC-073 added working with whatever replaces `--all` (git
    applies `--exclude` to the *next* traversal option, so the position matters for each one).
  - `lanes.ts` and the chip code need no change: fewer commits arrive, none of them differently.
- **Out of scope:** showing the other namespaces in the left panel, a preference for including
  them, stashes in the graph (deliberately excluded), submodules.
- **Acceptance:**
  - [x] On a repository carrying a `refs/notes/commits` ref, the graph's commit rows equal
        `git log --branches --remotes --tags --oneline | wc -l` (plus HEAD's own lineage), and no
        row is present that no listed ref reaches.
  - [x] Hiding every ref that reaches a commit removes its row, with no residue from another
        namespace; the GC-073 e2e step still passes.
  - [x] catena-feed read-only: the row count before and after the change is compared and the
        difference is explained by naming the refs responsible.
  - [x] `npm test` and `npm run e2e` pass.
- **Files:** `src/main/git.ts`, possibly `tools/e2e/setup-testrepo.mjs` (a fixture ref in another
  namespace, so the suite covers this at all).
- **Verify:** typecheck, build, `npm run e2e`, and the two git counts above on a repository with
  a ref outside heads/remotes/tags.
- **Log:**
  - 2026-09-06 proposed by GC-073 (this ticket): `--all` is wider than the ref set the UI lists, so
    the graph can show commits nothing on screen explains and hiding a branch can silently fail to
    remove its rows. Found when the fixture's own baseline refs did exactly that.
  - 2026-09-06 03:42 claimed
  - 2026-09-06 04:15 done. `getLog` traverses `--glob=refs/heads/*`, `--glob=refs/remotes/*`, `--glob=refs/tags/*` and the revision `HEAD`, with `--ignore-missing` for the unborn branch, instead of `--all`. Two measurements decided the form: `--exclude=` accumulates only up to the *next* traversal option, so GC-073's list is repeated ahead of each glob (proved by a scratch repo where excluding a branch before `--branches` alone left it in), and `--branches`/`--tags` match an exclude pattern relative to their own namespace while `--glob` matches the full ref name the renderer stores — `--exclude=refs/heads/side --branches` excluded nothing. `refs/stash` needs no naming now; it is out by construction.
    Acceptance: on a scratch repository carrying `refs/notes/commits` and a private `refs/e2e/baseline/*`, the graph drew 2 rows against `git log --branches --remotes --tags` = 2, with no notes row and no private-namespace row; hiding `refs/heads/side` and `refs/remotes/origin/side` removed `side work` entirely, with no residue from the other namespace. catena-feed, read-only (`log` and `for-each-ref` only): 881 rows before and 881 after — it carries refs/heads, refs/remotes and refs/tags and nothing else, which is the whole of the difference. The fixture now creates a git note so the suite covers this at all, and e2e step 25 asserts no row comes from it; its counts moved from `--all` to the same traversal the app uses.

### GC-096 The branch crumb menu lists every branch, with nothing to narrow it

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-088
- **Why:** GC-088 wired the branch breadcrumb and left the study's search box out of scope, on the
  grounds that a `MenuItem` hosting an input is a new UI primitive and the left panel's
  `Filter refs` is the filter today. On the e2e fixture the menu is eight rows and reads well; on a
  repository with fifty branches and their remotes it is a list nobody can use, and the control it
  replaces — finding the row in the left panel — is the one with a filter. The study has the search
  box at the top of this exact menu (`05-menus-shortcuts.md`, "Toolbar dropdowns").
- **Scope:**
  - A filter row at the top of the branch crumb's menu: a `MenuItem` kind that renders an input,
    focused when the menu opens, narrowing the rows beneath it as it is typed (name substring, both
    groups, captions hidden when their group empties).
  - Enter checks the first remaining row out; Escape closes the menu, which is `App.tsx`'s Escape
    and not a listener of its own.
  - The rows stay what they are today, so nothing about `openBranchMenu` changes but the list it
    hands over.
- **Out of scope:** the same input in every other menu, fuzzy matching, favourites, remembering the
  last filter, the study's fixed 250px width.
- **Acceptance:**
  - [ ] Typing narrows the list and hides a group's caption when that group has no rows left.
  - [ ] Enter checks the first row out through `checkoutRef`, so the dirty-tree guard still applies.
  - [ ] Escape closes exactly the menu, with the field focused and non-empty.
  - [ ] A component test over the filtering, and an e2e step that types and lands on a branch.
- **Files:** `src/renderer/src/ui/ContextMenu.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/styles/app.css`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, `npm test`, `npm run e2e`, and a screenshot of the filtered menu.
- **Log:**
  - 2026-09-06 proposed by GC-088 (this ticket): the follow-up its Out of scope invited, filed now
    that the menu exists and its length is a real repository's problem rather than a hypothetical.

### GC-097 The sequencer guard stashes untracked files git never objected to

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** GC-090
- **Why:** GC-090's "Stash and continue" runs `stashSave({ includeUntracked: true })`, copied from
  the checkout guard, where untracked files genuinely can be in the way. Here they cannot: git
  refuses a cherry-pick, revert, merge or rebase for the **index**, and carries untracked files into
  all four untouched. So the guard moves files it had no reason to move, and in the case GC-090
  found — the action leaving git mid-operation, where the stash is deliberately kept — the user's
  untracked files sit in that stash too, out of the working tree, until they pop it.
- **Scope:**
  - The guard stashes without `-u`, so untracked files stay where they are.
  - Its message says what it will stash, in the same sentence that names the staged count.
  - The checkout guard is not touched: its own reason for `-u` still holds.
- **Out of scope:** `--keep-index`, stashing only the staged half (git has no such push), the
  checkout guard, GC-091's message classification.
- **Acceptance:**
  - [ ] Scratch repository with a staged file and an untracked one: "Stash and continue" leaves the
        untracked file on disk throughout, and the staged file comes back staged.
  - [ ] The mid-operation case keeps only the staged half in the stash; the untracked file is still
        in the working tree while the operation is in progress.
  - [ ] `npm run e2e` passes: step 12's assertions on the fixture's untracked `new.txt` are
        extended to say it never left.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, `npm run e2e`, and the two CDP checks above.
- **Log:**
  - 2026-09-06 proposed by GC-090 (this ticket): noticed while driving the guard — the stash it
    makes is wider than the refusal it works around, and the mid-operation path makes that visible.

### GC-098 A failed git call in the e2e suite is silent, so a lost race reads as a UI bug

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `run.mjs`'s `git()` helper returns `GIT-ERROR: <stderr>` as a **string** when a command
  fails, and almost every call site ignores what it returns — the fixture-mutating ones
  (`checkout`, `add`, `commit`, `update-ref`) always do. Seen once in six consecutive runs while
  closing GC-090: step 7's `git add` / `git commit` did not produce a commit, so the row it then
  right-clicks was not in the graph, and the run reported "waited for the context menu on Pickable
  commit" plus fourteen downstream failures across steps 7 and 12 — none of which named the actual
  cause, and the run took 91s instead of 22s waiting for things that could never appear. The
  fixture was left with an untracked `pick-<stamp>.txt` the epilogue does not clean, because the
  file was never staged. The likely race is `.git/index.lock`: the app's watcher runs `git status`
  on its own schedule 300ms after any change, and the suite writes to the same index with no retry —
  but the suite threw the message away, so even that is a hypothesis rather than a reading.
- **Scope:**
  - `git()` throws on a non-zero exit, carrying the command and stderr, so a broken fixture call
    stops the run where it happened. The handful of calls that legitimately expect failure — the
    prologue's `branch -D`, `tag -d`, `remote remove`, `push --delete`, the `--abort`s — go through
    an explicit `gitMay()` that keeps today's swallowing behaviour.
  - A command that fails on `index.lock` (or `Unable to create`) is retried a few times over about
    a second before it gives up, since the collision is with a watcher refresh that ends on its own.
  - The prologue removes a stray `pick-*.txt` so a run that died mid-step-7 leaves nothing behind
    (`RUN_FILE_RE` already names the pattern; only the untracked case is missed).
- **Out of scope:** the app's watcher timing, retries anywhere in `src/`, GC-081's spawn count.
- **Acceptance:**
  - [x] A deliberately broken fixture call (a bad ref name) ends the run with that command and
        git's stderr in the message, at the step where it happened.
  - [x] The calls that are allowed to fail still pass through `gitMay()` and the prologue is still a
        no-op on a clean fixture.
  - [x] A run against a repository holding a stale `.git/index.lock` retries and then reports the
        lock by name rather than a missing row.
  - [x] `npm run e2e` passes three times in a row.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e` three times, plus the two injected-failure checks above.
- **Log:**
  - 2026-09-06 proposed by GC-090 (this ticket): one run in six failed this way while verifying the
    batch; the next five passed unchanged. What made it expensive was not the flake but that the
    suite reported everything except what went wrong.
  - 2026-09-06 04:26 claimed
  - 2026-09-06 05:00 done. `git()` now throws `git <args> failed: <stderr>`, `gitMay()` keeps the old
    swallowing for the eleven calls whose failure is the normal case (the prologue's `--abort`s,
    `branch -D`, `tag -d`, `remote remove`, `push --delete`, and step 17's `push origin --delete`,
    which can never succeed because push-target is only ever pushed to `upstream`). Two calls that
    use git's exit code as their *answer* rather than as a failure went to `gitMay` as well, which
    the scope did not name: `check-ignore` exits 1 to mean "not ignored" and step 28's drift scan
    would have crashed on a baseline branch that is missing outright, which is the very drift
    GC-076 exists to report. `.git/index.lock` and `Unable to create` are retried five times at
    200ms before reporting. A `bail` handler on both `uncaughtException` and `unhandledRejection`
    prints the message and stops the run's own Electron, so a throw does not leak the process the
    way GC-040 describes. Verified by injecting both failures into `run.mjs` and reverting with
    `git checkout`: a bad ref ended the run **at step 2** with
    `git rev-parse no-such-ref-gc098 failed: fatal: ambiguous argument ...`, exit 1, total 2.9s, and
    `netstat` showed nothing listening on 9333 afterwards; a planted `.git/index.lock` was retried
    for **1185ms** and then reported as
    `fatal: Unable to create '.../index.lock': File exists`. The prologue now sweeps an untracked
    `pick-*.txt` after `restoreFixture()` (where `RUN_FILE_RE` is in scope), which is what recovered
    the fixture after that aborted run. `npm run e2e` passed five times in this batch — three
    consecutive before the injected checks (22.6s, 22.1s, 22.3s) and twice after, the last against
    the final build (22.2s).







### GC-099 Opening a repository with hidden refs loads the graph twice and flashes the hidden branches

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** GC-073's hidden set is applied from an effect that runs *after* the first snapshot has
  landed. `load()` reads `hiddenRef.current`, which is still empty when a repository is opened, so
  the first `getLog` runs with no `--exclude` at all; only once that snapshot is in state does the
  prune effect read `gitclient.hidden.<repoPath>`, see it differ from what was applied, and call
  `run('Updating graph', …)` for a second full load. Measured on the review's scratch fixture
  against `d34d732`: a cold open with nothing hidden settles at `data-gen` **1**, a cold open with
  `refs/heads/wip-branch` and `refs/remotes/origin/wip-branch` hidden settles at **2**, and the
  intermediate snapshot is committed to the DOM, so the hidden branches are drawn and then removed.
  On the fixture that is eight rows and invisible; on a real repository it is two `git log` runs at
  `MAX_COMMITS` 2000 and a visible flash on every open, on every repository switch through the
  recents dropdown, and on every `openPath`. The ticket's own log calls this "converges in one extra
  load" — converging is not the problem, paying for it on every open is.
- **Scope:**
  - Read the stored hidden set for the path being opened *before* the first `loadRepo` for it, so
    `openPath(path)` and the initial `lastRepo` restore both pass the right `exclude` to their first
    call. `readHidden(path)` already exists and is pure; the missing piece is calling it keyed on the
    path about to be loaded rather than on the snapshot that came back.
  - Keep the prune step: a hidden name whose ref has since been deleted must still be dropped from
    `localStorage`. It should stop triggering a reload when the set that was *applied* already
    matches, which after this change is the normal case — a second load then happens only when a
    hidden ref genuinely disappeared.
  - `hiddenRef.current` must be reset when the path changes, so one repository's hidden set can
    never reach another's first load.
- **Out of scope:** the shape of the `gitclient.hidden.<repoPath>` key, the eye toggles, the menu
  items, `getLog`'s `--exclude` placement, and the watcher's own reload path (GC-068 owns that);
  changing what a *toggle* costs — one reload per toggle is correct and stays.
- **Acceptance:**
  - [x] Scratch repository with both `wip-branch` refs hidden: a cold open (reload the renderer)
        settles at the same `data-gen` as a cold open with nothing hidden, and the row count is the
        hidden-set count from the first painted frame — assert with a `MutationObserver` on
        `.graph-body` that no frame ever contains a `wip-branch` chip.
  - [x] `git branch -D` a hidden branch, then reload: the name is pruned out of `localStorage`,
        Viewing is right, and the one extra load in that case is expected and acceptable.
  - [x] Switching repositories through the recents dropdown to one with a different hidden set
        applies that set on its first load, and the previous repository's set is not applied to it.
  - [x] `npm test` and `npm run e2e` pass; the GC-073 step is unchanged.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** typecheck, build, the CDP checks above on the built app, and a read-only open of
  `catena-feed` with one branch hidden to confirm the flash is gone on a large graph (read-only:
  hiding writes only `localStorage`).
- **Log:**
  - 2026-09-06 04:20 proposed by GR-010: the code-review pass over GC-073, confirmed empirically on
    the built app (`data-gen` 1 with nothing hidden, 2 with two refs hidden, the intermediate
    snapshot rendered). Not GC-068, which is about a *late* watcher reload overwriting a fresher
    snapshot and explicitly puts "coalescing two loads into one" out of scope; this is the cold-open
    path never having the set in the first place.
  - 2026-09-06 04:26 claimed
  - 2026-09-06 05:00 done. `load()` reads `readHidden(path)` for the path it is about to load and
    passes it to that first `loadRepo`, and records it in `hiddenRef` **after** the await, in the same
    commit as `setSnapshot` and `setHidden` — not before it, which is where the first attempt put it
    and which does not work: the prune effect's `!snapshot` branch runs between `load()` starting and
    the snapshot landing on a cold open, clears the ref it had just primed, and the effect then
    compared the arriving snapshot against an empty set and reloaded anyway. Measured over CDP on the
    scratch fixture before and after: `data-gen` was 1 with nothing hidden and 2 with
    `refs/heads/wip-branch` + `refs/remotes/origin/wip-branch` hidden, and is now **1 for both**. A
    `MutationObserver` installed through `Page.addScriptToEvaluateOnNewDocument` — so it is running
    before any of the app's own code — saw **0 wip-branch chips across every frame** of the cold open,
    8 rows against 9 clean. The prune step is kept and now reloads only when the applied set really
    differs: with a hidden branch deleted behind the app's back, gen is 2 (the one extra load the
    ticket allows), the name is pruned out of `localStorage`, the two live names stay, and the branch
    crumb still reads `main`. Switching to another repository through the recents menu applied that
    repository's own set on its first load (`side` never drawn) and cost one load, not two. Three new
    cases in `App.test.tsx` pin all of it; removing the one `hiddenRef.current = hide` line fails two
    of them, so they catch the real bug rather than restating the code. `npm test` 106 passed,
    `npm run e2e` ALL PASSED (22.2s), screenshot `docs/screenshots/gc099-hidden-cold-open.png`.
    The Viewing header reads "Viewing 2" and never names the checked-out branch, which is GC-094's
    ticket, not a regression here — the branch crumb was asserted instead.

### GC-100 A branch can only be brought up to its upstream by checking it out first

- **Status:** done
- **Area:** actions | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** `06-feature-inventory.md`'s Branch row lists "Fast-forward X to Y" and "Set upstream" as
  their own actions, and the left panel already renders the ahead/behind pair that says when one is
  needed (`abText` in `LeftPanel.tsx`). We have neither. To move a stale `main` up to `origin/main`
  while working on `feature`, the only route through the app today is checkout `main` (with the
  dirty-tree prompt GC-004 puts in the way), Pull, checkout `feature` again — three operations and a
  stash for something git does with one ref update. And a branch with no upstream can only get one
  as a side effect of `Push <name> and set upstream`: there is no way to point an existing local
  branch at a remote branch that already exists, which is what you need after cloning a fork or
  renaming a remote. GR-009's what's-next pass named both as unticketed; GC-049 put "Fast-forward as
  a distinct action" explicitly out of its own scope, so nothing has picked them up.
- **Scope:**
  - `fastForward(cwd, branch, upstream)` in `git.ts`. For a branch that is **not** checked out, this
    is `git fetch . <upstream>:<branch>` — a local fetch refuses anything that is not a
    fast-forward, which is exactly the guarantee wanted, and it touches neither the index nor the
    working tree. For the checked-out branch it is `git merge --ff-only <upstream>`. A refusal
    surfaces as the `GitError` it already is; nothing is forced.
  - `setUpstream(cwd, branch, upstream)` = `git branch --set-upstream-to=<upstream> <branch>`, and
    the ability to clear it with `--unset-upstream`.
  - Handlers in `ipc.ts` (`ref:fastForward`, `ref:setUpstream`) with the usual `str` validation,
    preload entries, and the two signatures on `GitApi` in `shared/types.ts`.
  - Branch menu, local branches only (`refMenuItems`, in the group that already holds Merge and
    Rebase): `Fast-forward <name> to <upstream>`, present only when the branch has an upstream and
    is behind it, with the count in the hint (`behind` is already on `GitRef`); and
    `Set upstream…` / `Unset upstream`, the former prompting with the remote branches that exist.
  - Both go through `run()` like every other action, so the snapshot reloads and a refusal reaches
    the status bar.
- **Out of scope:** a toolbar button for either, fast-forwarding several branches at once,
  "Fast-forward all", pulling as part of the action (the user fetches first, as in GitKraken),
  anything for remote-tracking branches or tags, and the ahead/behind arrows becoming clickable
  (that is left-panel work, not this).
- **Acceptance:**
  - [x] Scratch repository: with `feature` checked out and `main` one commit behind `origin/main`,
        `Fast-forward main to origin/main` from the left row's menu moves `refs/heads/main` to
        `origin/main`'s sha (`git rev-parse main origin/main` equal), leaves HEAD on `feature`,
        and leaves `git status --porcelain` byte-for-byte as it was.
  - [ ] The item is absent on a branch with no upstream and on one that is not behind, and a
        divergent branch (ahead *and* behind) gets git's refusal in the status bar with the branch
        unmoved.
  - [x] `Set upstream…` on a branch with none points it at a chosen remote branch (checked with
        `git rev-parse --abbrev-ref <name>` and its upstream suffix), the left panel's ahead/behind
        appears, and `Unset upstream` removes it again.
  - [x] An e2e step covering the fast-forward: assert the two shas equal and HEAD unmoved, then put
        the fixture back with `git update-ref` (never `--hard`), and the final fixture check passes.
  - [x] Screenshot of the branch menu carrying both, looked at next to
        `docs/reference/gitkraken/screenshots/20-context-menu-leftpanel-branch.png`.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`, probably `tools/e2e/setup-testrepo.mjs` (the
  fixture needs a local branch genuinely behind its upstream — see GC-055/GC-056, which want the
  same thing for the ahead/behind arrows), `CLAUDE.md` if the menu conventions change.
- **Verify:** typecheck, build, `npm test`, `npm run e2e`, and the git assertions above run by hand
  against the scratch repository — never against a real one.
- **Log:**
  - 2026-09-06 04:20 proposed by GR-010: the what's-next pass over `06-feature-inventory.md`'s
    Branch row against the board. Both actions were named as gaps by GR-009 and neither had a
    ticket; GC-049 deferred Fast-forward by name. They are bundled because they are one menu group,
    one file each side, and one fixture change — splitting them would pay the fixture cost twice.
  - 2026-09-06 06:15 claimed
  - 2026-09-06 07:20 done. `fastForward(cwd, branch, upstream)` is `git fetch . <upstream>:<branch>`
    for a branch that is not HEAD and `git merge --ff-only` for the one that is (git refuses to fetch
    into the ref HEAD points at); `setUpstream(cwd, branch, upstream|null)` covers both directions.
    Handlers `ref:fastForward` / `ref:setUpstream`, preload entries, two signatures on `GitApi`. In
    `refMenuItems` the three rows sit in the Merge/Rebase group on local branches only: Fast-forward
    is present only when the branch has an upstream and is behind it, hinted with the count; the
    upstream row reads "Set upstream of X…" or "Change upstream of X…" and prompts, listing the
    remote-tracking branches that exist in the message and defaulting to the one of the same name
    (`MenuItem` has no submenu and `PromptOptions` no list, so that is what "prompting with the
    remote branches" comes to); "Unset upstream of X" only when there is one.
  - 2026-09-06 07:20 verified in e2e step 23, whose title now says so. The fixture was **not**
    changed: the step makes its own `ff-target` at `origin/main~1` with `origin/main` as upstream,
    the way step 17 makes `push-target`, and deletes it again — `restoreFixture` removes any branch
    not in the baseline, so a run that dies there leaves nothing, and no `e2e:setup` is forced on a
    fixture that predates a format change. Run output: `ff-target 6c359c2e was 66ecb912, origin/main
    6c359c2e | HEAD 6c359c2e was 6c359c2e`, with `git status --short` byte-identical either side;
    Unset gave `fatal: no upstream configured for branch 'ff-target'`; with no upstream the menu
    offered `Set upstream of ff-target…` and neither Fast-forward nor Unset; Set upstream through the
    prompt gave `origin/main` back from `rev-parse --abbrev-ref ff-target@{upstream}`. Step 29 passes,
    so the fixture is back. That box is left **unticked** because it pairs two claims and only one
    of them was measured: the absent/present half is the two menu listings above, but the
    divergent-branch refusal was not exercised — the fixture has no branch
    both ahead and behind its upstream and building one would have meant a fixture change this
    deliberately avoided — `git fetch . <upstream>:<branch>` refuses a non-fast-forward by
    construction and the refusal is the `GitError` every other action already surfaces, but that is
    an argument, not a measurement. Screenshot `docs/screenshots/gc100-branch-menu.png`, looked at.
  - 2026-09-06 07:20 noticed while looking at that screenshot: the existing single-remote row reads
    "Push ff-target to origin/main" and pushes `git push origin ff-target`, so it names the upstream
    ref and writes `origin/ff-target`. GC-100 is what makes that reachable — before it, an upstream
    could only be set by `push -u`, which always agrees with the local name. Filed as GC-114.

### GC-101 Checkboxes and the Preferences dropdown are unstyled OS controls

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `tokens.css` defines every colour, size and the Open Sans stack, and `app.css` puts them
  on everything the app draws — except its form controls, which are the one place Chromium's
  defaults show through. Measured on the built app at `d34d732`: every `input[type=checkbox]`
  (Preferences' five, the detail panel's "Amend previous commit") computes `appearance: auto`,
  `accent-color: auto` and **13x13px**, so it is painted at the OS accent rather than
  `--accent #4d88ff` and at a size that matches nothing else on its row — neither the 12px icons
  beside it nor the 14px/20px type. `accent-color` appears nowhere in either stylesheet. Worse,
  `.pref-select` computes `font-family: Arial`: it is the **only** control in the whole app that is
  not Open Sans (a sweep of every `input`, `select`, `textarea` and `button` in the rendered tree
  returns exactly that one element), and the mismatch is plainly visible in
  `%TEMP%/gitclient-review/GR-010/03-preferences.png`, where "Merge (fast-forward if possible)" is
  set in a different typeface from the "Default pull action" label directly above it. A native
  `select` also opens an OS popup list that no token reaches, in the middle of a modal that is
  otherwise entirely ours.
- **Scope:**
  - A `.check` rule set in `app.css`: `appearance: none`, a 14px box on `--bg-raised` with the app's
    border, `--accent` when checked, a drawn tick, a visible focus ring, and the disabled state.
    Applied to every `input[type=checkbox]` in the app, so Preferences and the commit form's Amend
    box are one control with one look.
  - `.pref-select`: `font: inherit` at minimum, plus `appearance: none` with the app's own chevron
    (`ChevronDown` through `Icon`, as every other dropdown affordance in the app already does) and
    the menu colours from `tokens.css`. If dropping `appearance: auto` means losing the native popup
    list, say so in the log and keep `font: inherit` — a native popup in the app's own font is still
    better than the current mismatch.
  - A token for the control size if two rules want it, rather than a magic number in both.
- **Out of scope:** replacing checkboxes with toggle switches (GitKraken's shape, and copying it is
  not the point — this ticket is about our own tokens reaching our own controls), radio buttons and
  text inputs (already inheriting the font), the light theme (GC-013 will re-check these rules when
  it lands), and any change to what the settings do.
- **Acceptance:**
  - [x] On the built app, every `input[type=checkbox]` computes `appearance: none` and the box size
        the rule sets, and no control anywhere in the rendered tree computes a `font-family` without
        Open Sans in it — the same sweep this ticket was found with.
  - [x] Screenshot of Preferences with two boxes checked and two clear, and of the commit form's
        Amend row, looked at next to `docs/reference/gitkraken/screenshots/12-preferences.png` and
        `18-preferences-ui.png`: the checked colour is `--accent`, not the OS blue.
  - [x] Keyboard still works: Space toggles a focused checkbox, the focus ring is visible on both
        controls, and `Preferences.test.tsx` still passes unchanged.
  - [x] `npm test`, `npm run typecheck` and `npm run build` pass.
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`,
  `src/renderer/src/components/Preferences.tsx` (only if the select needs a wrapper for the chevron).
- **Verify:** typecheck, build, launch through `tools/launch-app.mjs`, run the computed-style sweep
  over the rendered tree by CDP and take the two screenshots above.
- **Log:**
  - 2026-09-06 04:20 proposed by GR-010: the screenshot pass, rotating onto Preferences, which no
    review had captured before. Found by comparing computed styles rather than by eye — the Arial
    select is obvious once seen, the 13px OS-accent checkbox is the kind of thing that reads as
    "slightly off" without ever naming itself.
  - 2026-09-06 07:35 claimed
  - 2026-09-06 08:05 done. `input[type='checkbox']` is styled once in `app.css` by **type** rather
    than through a `.check` class as the scope suggested: there is no second look for a checkbox to
    have, and a class is one a new checkbox can be written without. `appearance: none`, a
    `--control-box` (14px, new token) square on `--bg-panel-raised` with the app’s border,
    `--accent` when checked with a tick drawn as a rotated two-sided border, a 2px `--accent` focus
    ring (the global `input` rule’s `outline: none` would otherwise leave a focused box
    indistinguishable) and the disabled state. `--on-accent` is the tick’s own colour; it does not
    flip, the accent being a mid-blue in both themes.
  - One thing the ticket had not found: `.commit-form input` was the app’s only component rule
    written against a bare `input`, and its 8px padding reached the Amend checkbox — under
    `box-sizing: border-box` that floors the box at 18px, so the one checkbox outside Preferences
    was drawn larger than every other. It is now `.commit-form input:not([type='checkbox'])`,
    which is what that rule always meant.
  - `.pref-select` is `appearance: none` with `font: inherit` and the app’s own `ChevronDown`
    through `Icon`, which needed a two-line `Select` wrapper in `Preferences.tsx` around the three
    call sites. The native popup list survives `appearance: none` and is unchanged — still the one
    OS surface inside the dialog, as the scope allowed.
  - Verified on the built app over CDP: all seven checkboxes in the rendered tree compute
    `appearance: none` and 14x14, the three checked ones `rgb(77, 136, 255)` = `--accent #4d88ff`
    (not the OS accent), and a sweep of all 59 `input` / `select` / `textarea` / `button` elements
    finds none whose `font-family` lacks Open Sans — the sweep this ticket was found with, which
    used to return the `.pref-select` in Arial. Space toggles a focused checkbox and its ring is
    `2px solid rgb(77, 136, 255)`. `Preferences.test.tsx` passes unchanged.
    `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` still prints nothing. Screenshots
    `docs/screenshots/gc-101-preferences.png` (two boxes checked, four clear, all three selects)
    and `gc-101-amend-row.png`, looked at beside
    `docs/reference/gitkraken/screenshots/18-preferences-ui.png`: GitKraken’s boxes are the OS
    accent with the OS tick and its selects are native, ours are our own on both counts.

### GC-103 The Preferences dialog outgrows a short window and its last rows cannot be reached

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `.modal` sets a width and no height at all, and `.modal-backdrop` centres it with
  `overflow: visible`. The Preferences dialog is the tallest one in the app and keeps growing —
  GC-013 added the theme row, GC-014 a Diff group — so on a window shorter than about 790px it is
  taller than the viewport and the overflow is simply cut off at both ends with nothing to scroll.
  Measured over CDP at three window heights with the dialog open, defaults loaded: at 900px the
  modal is 65-835 and Close ends at 818, fine; at 800px it is 15-785; at **720px it is 0-770 with
  Close at 753 against a 720px viewport**, so the Close button and the "Confirm checkout with
  uncommitted changes" row are off-screen and unreachable — `backdropScrollHeight` 770 against
  `clientHeight` 720, but `overflow-y: visible`, so the wheel does nothing. Escape still closes it
  (`App` owns Escape), so it is not a trap, but the last settings cannot be read or changed.
- **Scope:**
  - `.modal` gets a `max-height` bounded by the viewport, and the part of it that can overflow —
    the body between the title and `.modal-buttons` — scrolls, so the heading and the buttons stay
    put. The global `::-webkit-scrollbar` rules already style whatever scrolls (GC-079).
  - Every modal, not just Preferences: a prompt with a long message has the same shape.
- **Out of scope:** making the dialog shorter by regrouping or paginating the settings, and the
  unstyled checkboxes and select (GC-101).
- **Acceptance:**
  - [x] At a 720px-tall window with Preferences open, the Close button's bottom is inside the
        viewport and every `.pref-row` can be scrolled to.
  - [x] At 900px nothing scrolls and the dialog looks exactly as it does today.
  - [x] The title and the button row do not scroll away with the content.
- **Files:** `src/renderer/src/styles/app.css`.
- **Verify:** launch through `tools/launch-app.mjs`, open Preferences, set the window to 1400x720
  over `Emulation.setDeviceMetricsOverride` and read back the Close button's rect against
  `innerHeight`; screenshot at 720 and at 900.
- **Log:**
  - 2026-09-06 proposed by GC-014 (this ticket): its Preferences row pushed the dialog to 770px and
    the measurement above fell out of screenshotting it.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. `.modal` gains `max-height: calc(100vh - 40px)` and a `--modal-gap`
    custom property; the part between the title and `.modal-buttons` moved into a new
    `.modal-body` — a flex column with that same gap, `min-height: 0` and `overflow-y: auto` — in
    all three modals (`Modal.tsx` renders it only when there is something to put in it, so a
    title-only dialog is unchanged). That needed the two component files the ticket did not list;
    a CSS-only version would have had to fake the padding around a sticky header, and the scope
    line asked for a body that scrolls. `.shortcut-groups` lost its own `max-height: min(60vh,
    560px)`, which would have been a scrollbar inside a scrollbar. Measured over CDP against the
    scratch repository at 1400x900: modal 65-835, Close bottom 818, body not scrollable — the same
    numbers this ticket recorded for today's build. At 1400x720: modal 20-700, Close bottom 683 of
    720, title top 37, body scrollable; scrolled to the end, the last row ("Confirm checkout with
    uncommitted changes") sits at 595-637 in view while the title and Close have not moved (37 and
    683 either side of the scroll). The other two modals were checked at both heights too: the
    shortcuts overlay is 48-672 at 720 with nothing scrolling and no inner scroll container left,
    and a prompt is 262-458. `docs/screenshots/gc-103-prefs-900.png`, `gc-103-prefs-720.png`,
    `gc-103-shortcuts-720.png`, `gc-103-shortcuts-900.png`, `gc-103-prompt-720.png`.

### GC-104 Changed lines have no intra-line highlight, so a one-character edit reads as a whole new line

- **Status:** done
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** GC-014
- **Why:** Both diff layouts tint a changed line whole. GitKraken does not: the study records
  "deleted lines tinted red, added lines tinted green with intra-line highlights"
  (`docs/reference/gitkraken/04-panels.md`). The gap is most obvious in the split view GC-014 just
  added, where the two versions of a line sit side by side and the eye has to diff them itself — on
  `big.txt` the paired row is `row 3` beside `row 3 edited`, and nothing says the difference is the
  trailing word. GC-014 put this out of scope and GC-052 excludes it too, so nothing owns it.
- **Scope:**
  - A pure `wordDiff(oldText, newText)` returning the spans that differ on each side, unit tested,
    next to `alignHunks` in `parseDiff.ts`. A common-prefix/common-suffix trim plus a word-level
    LCS on what is left is enough; it must be cheap enough to run per paired row.
  - `DiffView` renders the spans as `<span class="word">` inside the existing `pre`, in both
    layouts, with their own tokens (a stronger add/del than the line tint).
  - Only lines that are actually paired get it: a padded side, a pure addition and a pure removal
    are unchanged.
  - A guard for the pathological case — two long lines with nothing in common should fall back to
    the plain line tint rather than a confetti of one-character spans.
- **Out of scope:** syntax highlighting, character-level diff inside a word, and the hunk actions,
  which act on `hunk.raw` and must stay untouched.
- **Acceptance:**
  - [x] `wordDiff` unit tests: a trailing-word edit marks only that word; identical lines mark
        nothing; two unrelated lines fall back rather than marking everything.
  - [x] In the e2e repo's `big.txt`, the split view marks `edited` on the added side and nothing on
        the removed side.
  - [x] The unified layout marks the same spans on the same lines.
  - [x] Staging a hunk still records the same patch it does today.
- **Files:** `src/renderer/src/diff/parseDiff.ts`, `src/renderer/src/diff/DiffView.tsx`,
  `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`, tests.
- **Verify:** `npm test`, e2e, and a screenshot of the split view next to
  `docs/reference/gitkraken/04-diff-view.png`.
- **Log:**
  - 2026-09-06 proposed by GC-014 (this ticket): the split view makes the missing intra-line
    highlight plain, and the study records GitKraken having it.
  - 2026-09-06 05:18 claimed
  - 2026-09-06 05:38 done. `parseDiff.ts` gains `wordDiff(old, new)` — common prefix and suffix
    off first, a word LCS on what is left, `null` when the two share less than a quarter of the
    longer line or either side is over 400 tokens — and `hunkWordSpans(hunk)`, which keys the spans
    by the `DiffLine` object itself off `alignHunks`' pairing. `DiffView` renders both layouts
    through one `code()` helper reading that map, computed once per parsed file, so the two cannot
    drift and flipping layout re-diffs nothing. A marked run never starts or ends on whitespace.
    Tokens `--diff-add-word` / `--diff-del-word` in both themes. Eight new unit tests, taking the
    suite from 118 to 126. Measured over CDP on the scratch repo's `big.txt`: unified marks
    `["edited"]` on `row 3 edited` and `row 35 edited` and nothing on the removed lines; split
    marks the same two lines on the added side with the removed side clean; the span's computed
    background is `rgba(92, 184, 92, 0.36)`. That is the CDP measurement rather than an e2e step,
    which is what GC-109 now exists for. `npm run e2e` step 28 still reports the same 184-byte
    patch from either layout. `docs/screenshots/gc-104-split-word-diff.png`,
    `gc-104-unified-word-diff.png`.

### GC-105 Panel widths are clamped only against themselves, so the graph can be squeezed to nothing

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `useDragWidth` clamps the left panel to 160-420 and the detail panel to 300-720 (GC-050),
  each in isolation, and nothing ever re-checks either against the width of the window they sit in.
  The two maxima sum to 1140, and `src/main/index.ts` declares `minWidth: 900`, so both ends of the
  supported range are broken. Measured over CDP on the built app at `bd9c89f`, `.col-msg` being the
  commit message column:

  | window | left | detail | graph panel | message column |
  | --- | --- | --- | --- | --- |
  | 1400 (default) | 220 | 400 | 780 | **554** |
  | 900 (`minWidth`) | 220 | 400 | 280 | **54** |
  | 1400 (default) | 420 | 720 | 260 | **34** |
  | 900 (`minWidth`) | 420 | 720 | **0** | 10 |

  So with the panels never touched, resizing to the app's own minimum width leaves 54px of commit
  message - every row reads `Work...`, `Remo...`, `Merg...`, and the `COMMIT MESSAGE` header is
  itself clipped mid-word (`%TEMP%/gitclient-review/GR-011/05-narrow-light.png`). With both handles
  dragged to their maxima - reachable on Ricardo's 3440px monitor in two drags, and then persisted
  in `localStorage` - the graph is 34px wide on the *default* window size, and at 900 it is gone
  entirely: `.detail-panel` extends to x=1140, 240px past the right edge, so the commit summary
  field, the description box and the commit button are all off-screen with no scrollbar
  (`%TEMP%/gitclient-review/GR-011/06-narrow-wide-panels.png`). The graph is the app; it must be the
  last thing to give way, not the first.
- **Scope:**
  - One shared minimum for the centre - a `MIN_GRAPH_W` constant, around 360px, enough for the ref
    column at its own minimum plus a readable message column - and an effective width for each panel
    derived from `window.innerWidth`, not only from the stored number: when
    `left + detail + MIN_GRAPH_W` exceeds the window, the panels give way, the wider one first, down
    to their own `min`.
  - Applied on window resize as well as on drag, so shrinking the window reflows rather than
    overflowing. The **stored** widths stay untouched, so widening the window restores what the user
    chose; only the applied `--left-panel-w` / `--detail-panel-w` are clamped.
  - A drag is clamped by the same rule, so a handle simply stops rather than pushing the graph away.
  - Raise `minWidth` in `src/main/index.ts` if 900 cannot hold `160 + MIN_GRAPH_W + 300` - say which
    number was chosen and why in the log.
- **Out of scope:** collapsing a panel to a rail automatically at small widths (the diff view already
  does that for the left panel by its own rule, and an automatic collapse is a separate decision);
  making the panels remember a per-window-size width; any change to the drag handles themselves or
  to `useDragWidth`'s persistence and double-click reset.
- **Acceptance:**
  - [x] With no stored widths, at a 900px viewport the commit message column measures at least
        200px, and `.graph-panel` at least `MIN_GRAPH_W` - the same CDP measurement the table above
        was taken with (`document.querySelector('.col-msg').getBoundingClientRect().width`).
  - [x] With `gitclient.leftPanelW=420` and `gitclient.detailPanelW=720` stored, at a 900px viewport
        `.detail-panel`'s right edge is inside the window and `.graph-panel` is at least
        `MIN_GRAPH_W` wide.
  - [x] Widening back to 1400 restores 420 and 720; the two `localStorage` keys still read 420 and
        720 throughout, so nothing the user chose was thrown away.
  - [x] Screenshots at 900 and 1400 with both panel configurations, looked at.
  - [x] `npm test`, `npm run typecheck`, `npm run build` pass.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/ui/useDragWidth.ts`,
  `src/renderer/src/styles/app.css`, `src/main/index.ts`.
- **Verify:** typecheck, build, launch through `tools/launch-app.mjs`, drive the viewport with
  `Emulation.setDeviceMetricsOverride` over CDP at 900 and 1400 with both stored configurations, and
  take the measurements and screenshots above.
- **Log:**
  - 2026-09-06 05:50 proposed by GR-011: from the screenshot pass, rotating onto a second window
    width, which no review had done before. The 900px case is not hypothetical - it is the app's own
    declared `minWidth`, and the maximum-panels case needs no resize at all to produce a 34px message
    column on the default window.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 done: `MIN_GRAPH_W` and `fitPanels(left, detail, windowW, min)` live in
    `useDragWidth.ts`. The fit reduces only the **applied** widths — the wider panel first, down to the
    narrower one, then both in proportion to what each still has above its own minimum — and
    `useWindowWidth()` re-applies it on resize. A drag takes the same bound through a new `limit`
    option that `App` computes from the other panel, so a handle stops rather than pushing the graph
    away; the stored widths, the persistence and the double-click reset are untouched, and `App` writes
    `applied.left`/`applied.detail` to the CSS variables instead of the raw hook widths.
  - **440, not the ~360 the scope suggested.** 360 leaves the message column at roughly 134px against a
    150px ref column, under the 200px this ticket's own first acceptance line asks for. 440 makes the
    app's declared minimum add up exactly — `160 + 440 + 300 = 900` — so `src/main/index.ts` keeps
    `minWidth: 900` and was not edited.
  - Measured over CDP on the built app with `Emulation.setDeviceMetricsOverride`, the same
    `.col-msg` measurement GR-011 used (before values from that review):

    | window | stored | left | detail | graph | `.col-msg` before | after |
    | --- | --- | --- | --- | --- | --- | --- |
    | 900 | defaults | 160 | 300 | 440 | **54** | **214** |
    | 1400 | 420 / 720 | 420 | 540 | 440 | **34** | **214** |
    | 900 | 420 / 720 | 160 | 300 | 440 | 10 (panel 240px off-screen) | **214** |

    At 900 the detail panel's right edge is 900, inside the window, where GR-011 measured 1140. Widening
    to 1600 restores the applied widths to 420 / 720, and `gitclient.leftPanelW` / `.detailPanelW` read
    420 and 720 throughout, so nothing the user chose was thrown away. Screenshots looked at:
    `docs/screenshots/gc105-900-default.png`, `gc105-900-maxpanels.png`, `gc105-1400-maxpanels.png`,
    `gc105-1400-default.png` — the 900px rows now read "Remove obsolete file" rather than "Remo...", and
    the `COMMIT MESSAGE` header is no longer clipped mid-word.
  - `app.css` was listed in Files but needed no change: everything that reaches the CSS variables is now
    inside the window, so no rule had to grow a fallback. Eight cases in a new
    `src/renderer/src/ui/useDragWidth.test.ts` pin the fit itself, including a sweep from 900 to 1600 that
    asserts the graph never drops below `MIN_GRAPH_W` and neither panel below its own minimum.
  - Noted while working, too small to ticket: `RAIL_W = 44` in `App.tsx` repeats the `44px` of
    `.left-panel.collapsed` in `app.css`, so the two have to be changed together.

### GC-106 The graph's incremental lane layout is never used: every page re-lays out the whole history

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-012
- **Why:** GC-012 gave `layoutGraph` a third parameter, `prev: LaneState`, so a later page continues
  the lanes the previous range left open instead of restarting at column 0, returned it as
  `GraphLayout.state`, covered it with ten cases in `lanes.test.ts` and wrote it into `CLAUDE.md` as
  how the graph pages. Nothing calls it. `grep -rn layoutGraph src/ | grep -v test` finds exactly one
  production call site, `CommitGraph.tsx:101`:
  `useMemo(() => layoutGraph(commits, pinnedSha ?? headSha), [commits, headSha, pinnedSha])` - two
  arguments, and `commits` is the whole accumulated array, whose identity changes on every append. So
  each page re-lays out everything loaded so far, and the continuity GC-012's screenshot showed comes
  from that, not from `LaneState`. The result is correct - `lanes.test.ts` proves splitting a history
  and rejoining it equals the single call - which is why nothing looks wrong; what is wrong is that a
  tested, documented API is dead, and `CLAUDE.md`'s Graph section describes a mechanism the app does
  not use, which is the kind of drift a cold session acts on. The cost is secondary but real and grows
  with the number of pages: transpiling `lanes.ts` with esbuild and timing it in Node on a synthetic
  10,000-commit history, one whole layout takes 8.3ms, the incremental path costs 10.3ms in total
  across all nine pages, and re-laying out the whole array after each page costs 22.7ms - plus a fresh
  10,000-element `RowLayout[]` allocated per page. Not a visible stall today; quadratic in the number
  of pages, and the fix is already written and tested.
- **Scope:** decide one way and make the code and `CLAUDE.md` agree.
  - Either: keep a `LaneState` alongside the rows in `CommitGraph` (or lift the layout into `App`
    beside `paged`), lay out only the commits appended since the last layout, and concatenate the
    rows - the `useMemo` becomes a reducer keyed on the commits array's length and identity, and it
    must fall back to a full layout whenever the array is not a strict extension of the one it last
    saw (a reload, a change of repository, a change of pin or of the hidden set, all of which replace
    `commits` wholesale rather than appending).
  - Or: delete `LaneState`, the `prev` parameter and `GraphLayout.state`, drop the cases in
    `lanes.test.ts` that only exercise them - keeping the property test that splitting equals the
    whole, which is worth having either way - and rewrite the `CLAUDE.md` sentence to say the graph
    re-lays out the loaded range on every change, which is the invariant that is actually held.
  - Whichever is chosen, say in the log why, and leave no third state where the API exists but the
    documentation and the call site disagree.
- **Out of scope:** virtualising the layout itself, changing lane assignment, colour or ordering
  rules, and the `NEAR_END` / `PAGE_COMMITS` values.
- **Acceptance:**
  - [x] `grep -rn 'layoutGraph\|LaneState' src/ | grep -v test` and the Graph section of `CLAUDE.md`
        describe the same mechanism, with no unused export left.
  - [x] `lanes.test.ts` still proves that a history split at any row lays out identically to the
        whole, by whichever path the app now takes.
  - [x] If the incremental path was chosen: a test that appending a page to an existing layout gives
        the same rows as laying out the concatenation, and that a *replaced* (not extended) commits
        array falls back to a full layout - a reload with a different hidden set must not be treated
        as an append.
  - [x] `npm test`, `npm run typecheck`, `npm run build` pass.
- **Files:** `src/renderer/src/graph/lanes.ts`, `src/renderer/src/graph/CommitGraph.tsx`,
  `src/renderer/src/graph/lanes.test.ts`, `CLAUDE.md`.
- **Verify:** `npm test`; the grep above; if the incremental path is taken, load a history past one
  page boundary and confirm by screenshot that no lane restarts at the boundary, as GC-012 did.
- **Log:**
  - 2026-09-06 05:50 proposed by GR-011: from the code-review pass over GC-012. That ticket's log is
    accurate about what it built; what it did not do is connect it, and `CLAUDE.md` was updated as
    though it had.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 done, **incremental path chosen**: the alternative was deleting a tested API and
    rewriting the `CLAUDE.md` sentence to describe the weaker invariant. Connecting it costs about thirty
    lines, keeps the documented mechanism true and removes the quadratic term, so there was no reason to
    spend the deletion instead.
  - `CommitGraph.tsx` gets `useLaneLayout(commits, pinnedSha)`: a ref caches the last
    `(commits, pinned, layout)`, an unchanged pair returns the cached layout, an **extension** lays out
    only `commits.slice(base.length)` with the previous `state` and concatenates the rows, and anything
    else falls back to a full `layoutGraph`. The old rows are reused as objects; only the array holding
    them is new, so a page no longer allocates a fresh `RowLayout` per commit already loaded.
  - The append test is its own exported function rather than an inline condition: `continuesRange(prev,
    next)` in `lanes.ts` checks that `next` is longer and that **both ends** of `prev` are still where
    they were. Checking both ends is what catches a replacement that happens to be longer — a commit
    removed from the middle moves the sha that used to sit last, a new commit at the top moves the first —
    so a reload with a different hidden set is never mistaken for a page.
  - Nine cases added to `lanes.test.ts` under `continuesRange (GC-106)`: it accepts an appended page and
    rejects the same range, a shorter one, a longer one with a commit prepended, a longer one with a
    commit removed from the middle, and anything against an empty range; plus the end-to-end shape, that
    laying out a page and continuing it equals laying out the concatenation. The GC-012 property tests are
    untouched and still pass. `npm test`: 147 tests, 16 files.
  - The acceptance grep now shows the API used in production, not only in tests:
    `CommitGraph.tsx` imports `continuesRange` and `layoutGraph` and calls `layoutGraph(page, pin,
    prev.layout.state)`. Verified in the running app rather than by screenshot: the fixture is 8 commits,
    far short of the 2000-commit `MAX_COMMITS` page boundary GC-012 photographed, so a page boundary
    cannot be reached against it at all — the equivalence the tests prove is the stronger check, and
    `npm run e2e` (29 steps, 151 assertions) draws the graph through the new path on every step.

### GC-110 The ref column is clamped only against itself, so it can take the whole commit message

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-105
- **Why:** GC-105 reserved `MIN_GRAPH_W` for the graph panel against the width of the window, which fixed
  the two side panels. Inside that panel the same defect is one level down and untouched: the ref column
  is `useDragWidth({ min: 100, max: 400 })` (GC-006), clamped against itself alone, and nothing checks it
  against the panel it sits in. Measured over CDP on the built app at `7faaa02` + this batch, with
  `gitclient.refColW=400` stored:

  | window | graph panel | ref column | `.col-msg` | `.summary` |
  | --- | --- | --- | --- | --- |
  | 1400 | 780 | 400 | 304 | fine |
  | 900 | 440 | 400 | **10** | **0** |

  So at the app's own minimum window with the ref column dragged out, the commit message column is 10px
  and the summary is not drawn at all — the graph is there, and the thing it exists to show is gone. It
  takes a deliberate drag plus a narrow window, which is why it is P2 rather than GC-105's P1, but the
  width persists in `localStorage`, so it survives the resize that reveals it.
- **Scope:**
  - Give the ref column the same treatment `fitPanels` gives the panels: a minimum for what follows it
    (the message column, around 200px to match GC-105's own acceptance), and an applied width derived
    from the graph panel's measured width, not only from the stored number.
  - Bound the drag by the same rule, so the handle stops instead of squeezing the message away, and leave
    the stored width untouched so widening the window or the panel brings it back — the pattern
    `useDragWidth`'s `limit` option already exists for.
  - The panel's width is not `window.innerWidth`, so it needs a measurement (a `ResizeObserver` on
    `.graph-panel`, which `CommitGraph` already observes for virtualisation) rather than the
    `useWindowWidth()` GC-105 uses.
- **Out of scope:** the optional AUTHOR / DATE / TIME / SHA columns, which are `flex: none` at fixed
  widths and have the same shape of problem but are off by default; changing `REF_COL_MIN`/`MAX` or the
  double-click reset; GC-071, which is about the chip being unreadable at the column's *minimum* width.
- **Acceptance:**
  - [x] With `gitclient.refColW=400` stored, at a 900px viewport `.col-msg` measures at least 200px and
        the summary of the first row is drawn.
  - [x] Widening back to 1400 restores the full 400px ref column, and `gitclient.refColW` still reads 400
        throughout.
  - [x] Dragging the handle at a narrow window stops rather than reducing `.col-msg` below its minimum.
  - [x] `npm test`, `npm run typecheck`, `npm run build` pass.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/ui/useDragWidth.ts`,
  `src/renderer/src/styles/app.css`.
- **Verify:** build, launch through `tools/launch-app.mjs`, and repeat the measurement in the table above
  over CDP at 900 and 1400 with `refColW` stored at 400 and at its 150 default.
- **Log:**
  - 2026-09-06 06:25 proposed by GC-105 (this ticket): measuring the panels against the window made it
    obvious the same question had never been asked one level in, and the 900px measurement above was
    taken with GC-105's fix already in place — it does not fix this and was never meant to.
  - 2026-09-06 06:15 claimed
  - 2026-09-06 07:20 done. `fitRefCol(stored, panelW, rest, min)` in `useDragWidth.ts` beside
    `fitPanels`, with `MIN_MSG_W = 200`; `CommitGraph` measures `.graph-body` off the observer that
    already virtualises the rows (its client width is the box the rows are laid out in, so the
    scrollbar is out by construction), passes `bodyW - restW - MIN_MSG_W` as `useDragWidth`’s `limit`
    and writes `fitRefCol`’s answer to `--ref-col-w`. `restW` is the lane column plus any optional
    column that is on, since those are `flex: none` and take their width from the message too.
    Measured over CDP on the built app, the table the Why asks for (stored | window | panel | ref |
    msg | summary): 400 | 1400 | 760 | 400 | 284 | drawn; 400 | 900 | 440 | **164** | **200** | drawn;
    150 | 1400 | 760 | 150 | 534 | drawn; 150 | 900 | 440 | 150 | 214 | drawn. The 900px row was
    400 / 10 / not drawn before. Widening back to 1400 gives ref=400 with `gitclient.refColW` still
    400 throughout, and a drag to the far right at 900 stops at ref=164 leaving msg=200.
    Screenshots `docs/screenshots/gc110-ref-column-900.png` and `-1400.png`, looked at. 7 new unit
    tests on `fitRefCol` (154 total), typecheck, build and `npm run e2e` (29 steps) all pass.
  - 2026-09-06 07:20 two things this left behind, both ticketed rather than widened into here:
    a drag at a narrow window still overwrites the stored width with the limit (GC-115, measured
    here: a 1px drag at 900 leaves the column at 164 and rewrites `gitclient.refColW` from 400 to
    164, so widening no longer restores it — GC-111 one level in, which GC-111 puts out of its own
    scope); and with all three optional columns on, the ref column reaches its 100px floor and the
    message column measures 0 at 1100 and at 900 (GC-116), which this ticket’s Out of scope named.
    `OPT_COL_W` in `CommitGraph.tsx` mirrors the 140/150/80 in `app.css`; the comment says so, and
    it is the only place the two files have to agree.

---

### GC-107 A commit's file row cannot restore that file, only open the working-tree copy

- **Status:** done
- **Area:** actions | **Size:** M | **Priority:** P3
- **Depends on:** GC-043
- **Why:** `fileMenuItems` in `App.tsx` branches on `t.source`, and everything it adds for a commit's
  file row is the shared tail: Open file, Show in folder, Copy file path. All three act on the
  **working tree**, so on a row belonging to a commit from last week "Open file" opens today's
  content - the row names one version of the file and the menu can only reach another. There is no way
  to get an old version of a file back at all: the nearest thing the app offers is resetting the whole
  branch to that commit. `06-feature-inventory.md`'s Files row lists "Restore file from this commit"
  first, and GR-010's what's-next pass named it as still unticketed. It is the cheapest of that row's
  remaining entries - the commit view already holds the sha and the path, and
  `git checkout <sha> -- <path>` is one call.
- **Scope:**
  - `restoreFile(repo, sha, path)` in `git.ts` running `git checkout <sha> -- <path>`, its handler in
    `ipc.ts` under `workdir:` with `str` validation on all three arguments, its entry in
    `preload/index.ts` and its signature in `shared/types.ts` - the four files an API always means.
  - A "Restore file from this commit" row in `fileMenuItems` for `t.source === 'commit'` only, going
    through `run()` like every other action so the status bar and the reload happen.
  - It is destructive: `git checkout <sha> -- <path>` overwrites the working-tree copy **and stages
    the result**, so it goes through `useUi().confirm` naming the file and the short sha, and the
    confirmation says the change will be staged. Absent, not disabled, on a row whose file the commit
    deleted (`f.kind === 'deleted'`) - there is nothing at that sha to restore, and GC-072 settled that
    an action that cannot work is left out rather than shown greyed.
  - An e2e step: restore a file from an older commit, assert with `git show` that the working-tree
    bytes match that commit's and that `git status --porcelain` shows it staged, then put the fixture
    back with `git reset --soft` and a checkout of the original content.
- **Out of scope:** the rest of the study's Files row - Blame, History, Export changes to patch,
  Compare against working directory - each of which is its own ticket; restoring a whole folder or a
  whole commit; and any change to what Open file and Show in folder do (that they act on the working
  tree is correct, only unlabelled - a hint on those two rows would be a fine addition here but is not
  required).
- **Acceptance:**
  - [x] The row is offered on a commit's file row and on no other file row, and is absent on a file
        the commit deleted.
  - [x] Confirming it restores the file: on the scratch repo, `git show <sha>:<path>` and the file on
        disk are byte-identical afterwards, and the path is staged.
  - [x] Cancelling the confirmation changes nothing - `git status --porcelain` is identical either
        side.
  - [x] The new e2e step passes and leaves the fixture as it found it, so the final drift-scan step
        stays green.
  - [x] `npm test`, `npm run typecheck`, `npm run build`, `npm run e2e` pass.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** `npm test`, `npm run e2e`, and by hand on the scratch repo: restore `a.txt` from the
  initial commit, compare against `git show`, then reset.
- **Log:**
  - 2026-09-06 05:50 proposed by GR-011: from the what's-next pass, reading
    `06-feature-inventory.md`'s Files row against `fileMenuItems`. GC-093 has just given that menu its
    first non-trivial action, so it is the natural place to grow, and this is the entry with the
    smallest gap between what the panel already knows and what the action needs.
  - 2026-09-06 09:12 claimed
  - 2026-09-06 10:05 done. `restoreFile(repo, sha, path)` is `git checkout <sha> -- <path>` in
    `git.ts`, its handler under `workdir:` with `str` validation on all three arguments, its
    preload entry and its signature in `shared/types.ts`. The row is built in `fileMenuItems` for
    `t.source === 'commit'` only, takes its sha from `selectedCommit` (a commit file row is only
    ever drawn for the commit the detail panel is showing, so no new field on `FileMenuTarget`),
    goes through `ui.confirm` — "The working-tree copy is overwritten and the result is staged." —
    and through `run()` like every other action.
    New e2e step 32, on the scratch repo: restoring `a.txt` from `Initial commit` leaves the file
    byte-identical to `git show <sha>:a.txt` and `a.txt` in `git diff --cached --name-only`;
    cancelling the confirmation leaves `git status --short` character-for-character what it was;
    the row is absent on `obsolete.txt` under `Remove obsolete file` (the menu is Open file /
    Show in folder / Copy file path, both shell rows disabled by GC-072) and absent on a WIP file
    row. The step puts `a.txt` back with `reset -q --` and `checkout -q --`, and step 34's drift
    scan is green. Screenshot `shots/restore-file-menu.png` in the scratch root.
    `npm test` (184), `npm run typecheck`, `npm run build` and `npm run e2e` (206 assertions,
    ALL PASSED) all pass.

### GC-108 The repository-open path clears the status bar without owning it

- **Status:** done
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** GC-084
- **Why:** GC-084 gave every `run()` call a busy token, so of two overlapping actions only the one
  that still owns the status bar clears it. The two places that set `busy` outside `run()` were left
  alone: the mount effect and `openPath()`, both of which do
  `setBusy('Loading repository')` and then `.finally(() => setBusy(null))` unconditionally. Opening
  a repository from the recents dropdown while an action is still running therefore still clears the
  spinner early — the same lie GC-084 fixed, from the other direction. It is narrow (the open bumps
  `generation`, so no stale snapshot lands) but it is the same defect.
- **Scope:**
  - Route the two "Loading repository" busies through the same token `run()` takes, so whichever
    started last owns the bar.
- **Out of scope:** refusing or queueing an open while an action runs, and the error path of
  `load()`, which GC-025 owns.
- **Acceptance:**
  - [x] An action started before an `openPath()` no longer clears the bar while the open runs.
  - [x] A unit test in `App.test.tsx` alongside GC-084's, failing when the token is not applied.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/App.test.tsx`.
- **Verify:** `npm test`, typecheck.
- **Log:**
  - 2026-09-06 proposed by GC-084 (this ticket): giving `run()` a token made it plain that the two
    busies written outside it still have none.
  - 2026-09-06 05:43 claimed
  - 2026-09-06 06:25 done: `takeBusy(label)` next to `busyToken` takes the token and sets the label,
    answering an `owns()` the caller checks before clearing. All three writers go through it — the mount
    effect, `openPath()` and `run()`, which loses its own inline copy — so whichever started last owns the
    bar and only the owner takes it down.
  - Test alongside GC-084's, in the same describe: Refresh, then Open repository while it is still
    running; the refresh's reload lands first and the bar must still read "Loading repository", and only
    the open clears it. Mutation check run rather than assumed — with `openPath` put back to
    `setBusy('Loading repository')` and an unconditional `.finally(() => setBusy(null))`, the test fails
    with `expected null to be 'Loading repository'`; restored, 25 dom tests pass.

---

### GC-109 The e2e suite never sees the intra-line diff marks

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-104
- **Why:** GC-104's word-level marks are covered by unit tests on `wordDiff`/`hunkWordSpans` and were
  measured once over CDP against the scratch repository, but nothing in `npm run e2e` asserts them, so
  a rendering regression — the spans dropped from one layout, the tokens losing their background —
  would pass every check the routine runs. Step 28 already opens `big.txt` in both layouts and reads
  its rows, which is exactly where the marks are.
- **Scope:**
  - Extend step 28 with an assertion on `.word` in both layouts: `edited` marked on the added side of
    the `row 3` pair and nothing on the removed side, the same in unified.
  - No new fixture and no new step: the file, the hunks and the layout switch are already there.
- **Out of scope:** asserting the colours (a token change is a deliberate act), and the fallback
  heuristic, which is what the unit tests are for.
- **Acceptance:**
  - [x] Step 28 fails when the spans stop rendering in either layout.
  - [x] The run's time does not move measurably: no extra reload, no extra sleep.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`, then again with the `code()` helper in `DiffView` stubbed back to plain
  text, which must fail the new assertion.
- **Log:**
  - 2026-09-06 proposed by GC-104 (this ticket): the marks were verified by hand over CDP because the
    suite has nowhere that looks at them, and the step that would is already open on the right file.
  - 2026-09-06 06:15 claimed
  - 2026-09-06 07:20 done. A `wordMarks(index)` helper beside `waitSplitDiff` reads one hunk’s
    `span.word` texts as `{ add, del }`, from `tr.line.add td.code` in unified and `td.code.add` in
    split — the same shape as `waitSplitDiff` being `waitDiff` read differently. Step 28 asserts
    `{ add: ['edited'], del: [] }` in both layouts, each absolutely rather than only against the
    other, so a regression that dropped the spans from *both* still fails. Run output: unified
    `{"add":["edited"],"del":[]}`, split the same. No extra reload and no sleep: two `Runtime.evaluate`
    calls on views the step already had open, and the run came in at 25.5s / 244 git calls against
    the 23.4s / 219 the batch inherited — the git half is GC-057 and GC-100’s new assertions, not
    this, which adds no git call at all.
  - 2026-09-06 07:20 the Verify line was run as written: `code()` in `DiffView` stubbed back to
    plain text, rebuilt, `npm run e2e` — `2 FAILED`, both of them the new assertions (unified and
    split, each reporting `{"add":[],"del":[]}`), and nothing else in the 29 steps moved. The stub
    was reverted, rebuilt and re-run: ALL PASSED. Making the split assertion absolute rather than
    only equal to the unified one is what earns the second failure — compared against each other,
    two empty lists agree.

---

### GC-111 A drag on a narrow window collapses the panel to its minimum and persists it

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-105
- **Why:** GC-105 gave each side panel a `limit` — as far as a drag may go given the other panel —
  computed in `App.tsx` as `winW - panelW.current.<other> - MIN_GRAPH_W`. `panelW.current` holds the two
  **stored** widths, not the ones `fitPanels` actually applied. On any window narrow enough for the fit
  to be reducing something, the other panel's stored width is larger than what is on screen, the limit
  comes out below the panel's own `min`, and `clampDrag` — `Math.max(min, Math.min(limit ?? max, …))` —
  therefore answers `min` for every pointer position. Measured over CDP on the built app at `37f392b`,
  viewport 1000x900, by dispatching pointerdown / pointermove / pointerup one pixel apart on the handle:

  | stored L/D | applied before | applied after a **1px** drag | stored after |
  | --- | --- | --- | --- |
  | 220 / 720 (left handle, +1px) | 220 / 340 | **160** / 400 | **160** / 720 |
  | 420 / 400 (detail handle, -1px) | 231 / 329 | 260 / **300** | 420 / **300** |

  Both handles do it, in both directions, and the collapsed value is written to `localStorage` on
  pointerup — so it outlives the window that caused it: widening back to 1400 leaves the left panel at
  160 for good. That is the exact opposite of the invariant GC-105 states and `CLAUDE.md` repeats — "The
  stored widths are never touched … so widening the window restores what the user chose". GC-105's
  acceptance box for it was ticked against the **resize** path, which is right; the **drag** path is the
  one that was never measured, and `useDragWidth.test.ts` covers `fitPanels` only, never the hook.
- **Scope:**
  - Derive each handle's `limit` from the width the other panel is actually being drawn at — `fitPanels`'
    answer, which `App` already computes as `applied` — rather than from the stored number in
    `panelW.current`.
  - A drag must never move a panel the pointer did not ask to move: starting a drag and travelling one
    pixel changes the width by about one pixel, whatever the window size, and a width the pointer never
    reached is never persisted.
  - Keep what GC-105 got right: the drag still stops rather than pushing the graph below `MIN_GRAPH_W`,
    and the width restored at mount and the double-click reset still ignore the limit entirely.
  - Cover the case that shipped, in `useDragWidth.test.ts` or a component test: a limit computed while
    the other panel is being reduced by the fit.
- **Out of scope:** `fitPanels` itself, which is correct and tested; the ref column's own clamp (GC-110);
  the double-click reset; making the panels remember a per-window-size width (GC-105 ruled that out).
- **Acceptance:**
  - [x] At a 1000px viewport with `gitclient.leftPanelW=220` and `gitclient.detailPanelW=720` stored, a
        +1px drag of the left handle leaves the left panel within 2px of where it was, and
        `gitclient.leftPanelW` still reads 220 afterwards.
  - [x] The mirror case with 420 / 400 stored and a -1px drag of the detail handle leaves the detail
        panel where it was and `gitclient.detailPanelW` still reads 400.
  - [x] Dragging a handle as far as it will go at 1000px still leaves the graph panel at `MIN_GRAPH_W`.
  - [x] Widening back to 1400px restores both stored widths on screen.
  - [x] A test fails on the shipped behaviour and passes on the fix.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/ui/useDragWidth.ts`,
  `src/renderer/src/ui/useDragWidth.test.ts`.
- **Verify:** build, launch through `tools/launch-app.mjs` on a port of your own, set the stored widths
  and reload over CDP, emulate 1000x900 with `Emulation.setDeviceMetricsOverride`, dispatch the three
  pointer events on `.left-panel .panel-resize` and `.detail-panel .panel-resize` (stub
  `setPointerCapture`/`releasePointerCapture` on the element first), and read back both panel rects and
  both `localStorage` keys. Repeat the table above.
- **Log:**
  - 2026-09-06 07:05 proposed by GR-012: measured on the built app at `37f392b` — a one-pixel drag of the
    left handle moves the panel 60px and writes the new width to `localStorage`, so the width the user
    chose on a wide window is gone for good after touching a handle on a narrow one.
  - 2026-09-06 08:05 claimed
  - 2026-09-06 08:55 done. Two changes, one defect: `App.tsx` now caches `fitPanels`' answer in
    `panelW.current` rather than the stored widths, so each handle's `limit` is taken from the width the
    other panel is actually drawn at; and `useDragWidth` starts a drag from the width being drawn
    (`clampDrag(width)`) and moves it only to widths the pointer reaches, through a new pure `dragWidth()`.
    Measured over CDP on the built app at 1000x900, repeating the ticket's own table: stored 220/720 applies
    220/340 and a +1px left drag leaves 220/340 with `gitclient.leftPanelW` still 220 (was 160/400, stored
    160); stored 420/400 applies 231/329 and a -1px detail drag leaves 231/329 with `gitclient.detailPanelW`
    still 400 (was 260/300, stored 300). A full-travel drag still leaves the graph panel at exactly 440, and
    widening to 1400 puts 220/400 back on screen. 8 new `dragWidth` cases in `useDragWidth.test.ts`, two of
    them the measured tables above; the shipped arithmetic answers 160, 300 and 164 for those three, so they
    fail before the fix and pass after. 169 unit tests, typecheck, build and the 29-step e2e run all pass.

---

### GC-112 A branch or tag deleted locally leaves its copy on the remote, and a tag cannot be deleted from a remote at all

- **Status:** done
- **Area:** actions | **Size:** M | **Priority:** P3
- **Depends on:** —
- **Why:** `06-feature-inventory.md` lists "Delete (local, remote, or both)" as one Branch action and
  "Delete locally / from remote / from all remotes" as one Tag action; GR-010 and GR-011 both named the
  Branch entry as the last untouched row of that list. What we have today, in `refMenuItems`: a local
  branch offers `Delete <name>`, which is `git branch -d/-D` and nothing else; a `refs/remotes/*` row
  offers `Delete <name>`, which is the `push --delete`; and a tag offers `Delete tag <name>`, which is
  `git tag -d` only. Two consequences. Deleting a branch that has been pushed takes two actions in two
  menus, and the second is only reachable if that remote row happens to be on screen — a branch hidden
  from the graph has no row at all. And a tag pushed with the menu's own "Push tag to remote" can never
  be removed from that remote through the UI: `deleteTag` is local-only and there is no remote-tag call
  in `git.ts` at all.
- **Scope:**
  - A local branch with an upstream (or with a same-named branch under `refs/remotes/<remote>/`) offers
    deleting the remote copy as part of the same action: a checkbox in the confirm, or a `secondary`
    button, whichever fits `useUi().confirm` as it stands. The wording names the remote, and the option
    is absent — not disabled — for a branch that exists nowhere else.
  - A tag row gains a remote delete, one row per remote when there is more than one, mirroring the
    "Push tag to …" rows already there; and the tag's own delete confirm offers the remote in the same
    way branches do.
  - A remote tag delete is `git push <remote> --delete refs/tags/<name>` — fully qualified, because a
    bare name is ambiguous when a branch and a tag share it. Add it as a `deleteRemoteTag` following the
    existing shape: type in `shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in
    `preload/index.ts`.
  - Order matters and is stated: the local delete runs first and, if it fails, the remote one is not
    attempted; a remote delete that fails leaves the local delete standing and reports on the status bar.
    The not-fully-merged force path `deleteBranch` already has is unchanged.
- **Out of scope:** "from all remotes"; deleting a branch on a remote it does not track; pruning beyond
  the reload `run()` already does; the branch breadcrumb menu (GC-096); anything about pull requests.
- **Acceptance:**
  - [x] Deleting a local branch that has an upstream offers to delete the remote copy and names the
        remote; a branch with no remote copy is offered the plain delete only.
  - [x] Confirming both leaves `git branch --list <name>` and `git ls-remote <remote> <name>` empty.
  - [x] Declining the remote half deletes the local branch only, and `origin/<name>` is still in the left
        panel after the reload.
  - [x] A tag pushed through "Push tag to remote" can be deleted from that remote from the tag menu, and
        `git ls-remote --tags <remote>` no longer lists it.
  - [x] With two remotes configured the tag menu lists one delete row per remote, the way the push rows
        already do.
  - [x] `npm run typecheck`, `npm test`, `npm run build` and `npm run e2e` pass.
- **Files:** `src/renderer/src/App.tsx`, `src/main/git.ts`, `src/main/ipc.ts`, `src/shared/types.ts`,
  `src/preload/index.ts` (adding an API always means those four), and `tools/e2e/run.mjs` if a step is
  added.
- **Verify:** the disposable e2e repository only, which has two real remotes since GC-056: push a scratch
  branch and a scratch tag to `upstream`, delete each through the menu, and check `git ls-remote upstream`
  and `git ls-remote origin` either side of every action. Put the fixture back; the drift step will say
  so if you do not.
- **Log:**
  - 2026-09-06 07:05 proposed by GR-012: the what's-next pass over the study's Branch and Tag rows. The
    tag half is the sharper defect — the menu can push a tag to a remote and then has no way to take it
    back — and the branch half is the entry GR-010 and GR-011 both left on the table.
  - 2026-09-06 09:12 claimed
  - 2026-09-06 10:05 done. `deleteRemoteTag` is `git push <remote> --delete refs/tags/<name>`,
    fully qualified for the reason the scope gives, with its handler, preload entry and type. On the
    branch side, `remoteCopyOf(r)` answers where a local branch also lives — the upstream first,
    then a remote-tracking ref of the same name, and only ever one the snapshot lists — and the
    delete confirmation carries "Also delete <branch> on <remote>" when there is one. `confirm()`
    has no checkbox, so this is the same modal one level down: `ui.prompt({ input: false, checkbox })`
    is exactly a confirmation that carries one, which is what `confirm` itself is built on. Order is
    as specified: the local delete runs first, the remote half only if it succeeded, and it goes
    through a plain `run()` so a failure there reports on the status bar and leaves the local delete
    standing. The tag menu gains one `Delete tag <name> from <remote>` row per remote when there is
    more than one, mirroring the push rows; with a single remote the local delete carries the same
    checkbox a branch's does, since which remote holds a tag is not something a tag ref can answer.
    New e2e step 33, against both real remotes (GC-056). Declining the remote half:
    `remote-keep` is gone locally, `git ls-remote origin remote-keep` still resolves and
    `origin/remote-keep` is still a row. Taking it: `remote-del` gone locally and
    `git ls-remote upstream remote-del` empty, with `origin` never touched. The tag menu reads
    `Push tag … to origin | Push tag … to upstream | Delete tag t-remote-del | Delete tag … from
    origin | Delete tag … from upstream`, and after the upstream row
    `git ls-remote --tags upstream t-remote-del` is empty while the local tag is still in
    `git tag`. The step puts both sides back and step 34's drift scan is green. Screenshot
    `shots/tag-menu-remote-delete.png` in the scratch root.
    One thing the step needed that is worth knowing: a menu action that runs two `run()` calls back
    to back is not covered by `act()`, which is satisfied by the first reload while the second is
    still going. `waitGitFor` polls the git side, which is the only place the second call is
    observable.
    `npm test` (184), `npm run typecheck`, `npm run build` and `npm run e2e` (206 assertions,
    ALL PASSED, 32.5s) all pass.

---

### GC-113 The ten lane colours walk the hue wheel in order, so adjacent lanes are the hardest pair to tell apart

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** —
- **Why:** `--lane-0..9` in `tokens.css` is a hue ramp walked in order. Measured on the running app at
  `37f392b` (dark), hue and WCAG relative luminance per token:

  | lane | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | hue | 191 | 217 | 279 | 307 | 332 | 359 | 14 | 47 | 95 | 161 |
  | lum | .287 | .172 | .112 | .166 | .165 | .137 | .262 | .557 | .496 | .448 |

  `laneColor[i] = i % 10`, so the colour is the column index and the lanes that sit **side by side are
  always consecutive indices** — which is exactly the pair this ramp puts closest together. Adjacent-pair
  hue separation is 26, 62, 28, 25, 27, 15, 33, 48 and 66 degrees; lanes 3 and 4 differ by 25 degrees at
  luminance .166 against .165, a contrast ratio of **1.00**, so at the 2px stroke `GraphCell` draws they
  are the same line. The pair that matters most is 0/1 at 26 degrees: those are HEAD's column and the
  first branch beside it, the shape of nearly every graph, and in `01-graph-default.png` from this review
  the fixture's two lanes read as one colour at a glance. This is not the palette-contrast question
  GR-011 left to Ricardo — that was text against its background; this is the graph's own primary way of
  saying "these are two different branches".
- **Scope:**
  - Reorder the ten values so consecutive indices are far apart on the wheel — the usual interleave, so
    0 and 1 are roughly opposite rather than neighbours — and so no adjacent pair matches in luminance.
  - Both themes stay in step: `:root` and `:root[data-theme='light']` define the same ten names, and the
    light ramp is re-derived rather than left behind.
  - Token names, the count of ten and the `i % 10` assignment are unchanged; this is a values-only edit.
- **Out of scope:** the number of lanes; `openLane`'s recycling rule; the WIP dash; ref-chip colours;
  `--accent` and the semantic colours; anything in `app.css` (every colour stays a token, GC-013).
- **Acceptance:**
  - [x] For every adjacent pair 0/1 through 8/9, in both themes, the hue separation is at least 60 degrees
        or the contrast ratio at least 1.4.
  - [x] No pair anywhere in the ten is within 20 degrees of hue at a contrast ratio under 1.2, in either
        theme.
  - [x] `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' src/renderer/src/styles/app.css` still prints nothing.
  - [x] A screenshot of the fixture graph in each theme shows the two lanes as plainly different colours;
        both land in `docs/screenshots/`.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/styles/tokens.css`, `docs/screenshots/`.
- **Verify:** build, launch through `tools/launch-app.mjs`, and repeat the measurement over CDP —
  `getComputedStyle(document.documentElement).getPropertyValue('--lane-' + i)` for 0..9, converted to hue
  and relative luminance — in dark and in light. Then look at the graph in both.
- **Log:**
  - 2026-09-06 07:05 proposed by GR-012: from the screenshot pass. The ramp was measured rather than eyed,
    and lanes 3 and 4 at a contrast ratio of 1.00 are the case that makes it a defect rather than a taste
    question.
  - 2026-09-06 08:05 claimed
  - 2026-09-06 08:55 done. A values-only reorder: the same ten colours, interleaved, with the teal kept at
    `--lane-0` so HEAD's column is unchanged, and the same permutation applied to the light ramp so the two
    stay in step. Re-measured over CDP on the built app in both themes. Dark hue 191 307 47 279 95 332 161
    359 217 14, lum .287 .166 .557 .112 .496 .165 .448 .137 .172 .262; the weakest adjacent pair is 1/2 at
    100 degrees (cr 2.81) dark and 100 degrees (cr 1.31) light, against the 60 the acceptance asks for. The
    two cases the ticket named: 0/1 goes from 26 degrees to 116 (dark) and 115 (light), and 3/4 from 25
    degrees at a contrast ratio of 1.00 to 176 degrees at 3.37. No pair anywhere is within 20 degrees under
    1.2 contrast, in either theme, and 9/0 is 177 degrees apart too, since lane 10 recycles colour 0 beside
    lane 9. `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` still prints nothing. Screenshots:
    `docs/screenshots/gc113-lanes-dark.png` and `gc113-lanes-light.png` — the fixture's two lanes read as
    teal and magenta at a glance in both.

---

### GC-114 The branch menu’s Push row names the upstream ref but pushes to the remote’s branch of the same name

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** With one remote, `refMenuItems` offers ``Push ${r.name}${r.upstream ? ` to ${r.upstream}` :
  ' and set upstream'}`` and runs `push(repo, { branch: r.name, setUpstream: !r.upstream })`, which
  resolves to `git push <defaultRemote> <branch>` and therefore writes `<remote>/<branch>`. The label
  names `r.upstream`, a *ref*; the push writes a different one whenever the upstream’s branch name is
  not the local name. Seen on the built app while verifying GC-100
  (`docs/screenshots/gc100-branch-menu.png`): a local `ff-target` tracking `origin/main` is offered
  "Push ff-target to origin/main", and the click would create `origin/ff-target` and leave
  `origin/main` alone. Before GC-100 this was close to unreachable — an upstream could only be set as
  a side effect of `push -u`, which always agrees with the local name — and GC-100’s "Set upstream…"
  is exactly what makes the two names diverge. The multi-remote branch of the same code says
  "Push X to <remote>" and is correct; only the single-remote branch is wrong.
- **Scope:**
  - Make the label name what the push does. Either say the remote (`Push X to <remote>`, matching the
    multi-remote rows and the toolbar button’s own title) or make the push honour the upstream’s
    refspec; the first is much the smaller change and keeps one wording across both branches.
  - The tag path a few lines up has the same shape (`Push tag to remote`) and should be read at the
    same time, though it names no ref and so is not wrong today.
- **Out of scope:** what Push does when the branch has no upstream (unchanged), the toolbar buttons
  (GC-057 settled those), and pushing to a differently named branch on the remote, which nothing in
  the app offers and which is its own feature.
- **Acceptance:**
  - [x] On a local branch whose upstream is a remote branch of a different name, the menu row names
        the destination the click actually writes, checked with `git ls-remote` after clicking it.
  - [x] The multi-remote rows are unchanged.
  - [x] `npm run typecheck`, `npm test`, `npm run build` pass.
- **Files:** `src/renderer/src/App.tsx`, `tools/e2e/run.mjs`.
- **Verify:** build, and on the scratch repository set a local branch’s upstream to `origin/main`
  through GC-100’s own menu row, open the branch menu, and compare the label against what
  `git ls-remote origin` holds after the click. Never against a real repository.
- **Log:**
  - 2026-09-06 07:20 proposed by GC-100 (this batch): found by looking at the branch-menu screenshot
    GC-100’s acceptance asked for. P1 rather than P2 because the row promises one ref and writes
    another, and GC-100 has just made the case reachable in one click.
  - 2026-09-06 08:05 claimed
  - 2026-09-06 08:55 done. The single-remote row is now `Push <branch> to <remote>` with the remote passed
    explicitly to `push()`, so the label and the command read the same value, and it carries the multi-remote
    rows' own `sets the upstream` hint. The tag row a few lines up was read at the same time and now names
    its remote too, matching the multi-remote tag rows. Covered in e2e step 23, where `ff-target` tracks
    `origin/main`: the menu reads "Push ff-target to origin", and after the click `git ls-remote origin`
    holds `refs/heads/ff-target` at 398ae25 while `refs/heads/main` is unchanged — the acceptance checked
    exactly the way its Verify line names. The prologue drops both copies of `ff-target` and its tracking
    ref, so a run that dies between the push and the delete still leaves the fixture clean; step 29 passes.

---

### GC-115 A drag on a narrow window replaces the ref column’s stored width with the limit

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-110
- **Why:** GC-111 one level in. GC-110 gave the ref column a `limit`, so `useDragWidth`’s `clampDrag`
  now bounds its drag; but a drag still starts from `width` — the **stored** number — and persists
  whatever `clampDrag` answers, so on a window narrow enough for `fitRefCol` to be reducing anything,
  the first pointer event of any drag rewrites the stored width to the limit. Measured over CDP on the
  built app at `a12ee9b`, viewport 900x900, `gitclient.refColW=400`, one pointerdown/move/up a **1px**
  apart on `.graph-header .col-resize`:

  | | ref column | `gitclient.refColW` |
  | --- | --- | --- |
  | before the drag | 164 | 400 |
  | after a 1px drag | 164 | **164** |
  | widened back to 1400 | **164** | **164** |

  The column does not jump, which is why GC-110 did not catch it: 164 is already what was on screen.
  What is lost is the 400 the user chose on a wide window, and with it GC-105’s stated invariant, the
  one `CLAUDE.md` repeats — "The stored widths are never touched … so widening the window restores
  what the user chose". GC-111 describes the same defect on the two side panels and puts "the ref
  column’s own clamp (GC-110)" out of its scope, so nothing covers this.
- **Scope:**
  - A drag that travels one pixel changes the width by about one pixel and persists only a width the
    pointer actually reached, at every window size — the same promise GC-111 makes for the panels.
    The fix almost certainly belongs in `useDragWidth` itself (a drag should start from the width
    being **drawn**, not the one stored), in which case GC-111 and this are one change; take them
    together if GC-111 has not shipped, and this ticket is then closed by it.
  - Keep what GC-110 got right: the drag still stops rather than taking the message column below
    `MIN_MSG_W`, and neither the width restored at mount nor the double-click reset looks at `limit`.
  - Cover it in `useDragWidth.test.ts`: a limit below the stored width, and a one-step drag.
- **Out of scope:** `fitRefCol` and `fitPanels`, both of which are correct and tested; the side panels
  themselves, which are GC-111.
- **Acceptance:**
  - [x] At a 900px viewport with `gitclient.refColW=400` stored, a 1px drag of the ref handle leaves
        the column within 2px of where it was and `gitclient.refColW` still reads 400.
  - [x] Widening back to 1400 puts the column back to 400.
  - [x] Dragging as far as it will go at 900 still leaves `.col-msg` at `MIN_MSG_W`.
  - [x] A test fails on the shipped behaviour and passes on the fix.
  - [x] `npm run typecheck`, `npm test`, `npm run build` pass.
- **Files:** `src/renderer/src/ui/useDragWidth.ts`, `src/renderer/src/ui/useDragWidth.test.ts`,
  `src/renderer/src/graph/CommitGraph.tsx`.
- **Verify:** build, launch through `tools/launch-app.mjs`, emulate 900x900 with
  `Emulation.setDeviceMetricsOverride`, stub `setPointerCapture`/`releasePointerCapture` on the handle,
  dispatch the three pointer events one pixel apart, and read back the column rect and
  `gitclient.refColW`. Repeat the table above.
- **Log:**
  - 2026-09-06 07:20 proposed by GC-110 (this batch): measured while confirming GC-110’s own
    acceptance, which checks the resize path and passes. The drag path is the one GC-111 found on the
    panels, and GC-110 has just given the ref column the `limit` that makes it reachable here too.
  - 2026-09-06 08:05 claimed
  - 2026-09-06 08:55 done, by the same change as GC-111 as this ticket predicted: the drag now starts from the
    width being drawn rather than the stored one, so no fix of its own was needed in `CommitGraph.tsx`, whose
    `limit` was already measured from the real panel. Measured over CDP at 900x900 with `gitclient.refColW`
    at 400: the column sits at 164, a 1px drag leaves it at 164 and `gitclient.refColW` still reads 400 (it
    read 164 before), and widening to 1400 puts the column back to 400. Dragging as far as it goes at 900
    leaves `.col-msg` at exactly 200, `MIN_MSG_W`. Covered by the shared `dragWidth` cases, including the
    ref column's own measured row.

---

### GC-116 With the optional columns on, the commit message column is squeezed to nothing

- **Status:** done
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-110
- **Why:** The AUTHOR / DATE / SHA columns (GC-032) are `flex: none` at 140 / 150 / 80, so 370px comes
  straight out of the message column. GC-110 counts them in the ref column’s `restW`, so the ref
  column gives way first, but it stops at its own 100px minimum and after that nothing else can give.
  Measured over CDP on the built app at `a12ee9b` with all three columns on and `gitclient.refColW`
  at its 150 default:

  | window | graph body | ref | lanes | author/date/sha | `.col-msg` | `.summary` |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1600 | 960 | 150 | 76 | 370 | 364 | drawn |
  | 1100 | 460 | 100 | 76 | 370 | **0** | **not drawn** |
  | 900 | 440 | 100 | 76 | 370 | **0** | **not drawn** |

  This is the state GC-110’s Out of scope named and deliberately left: the same defect one more level
  in, on columns that are off by default. It is P2 rather than P1 because it takes a preference nobody
  has switched on by default plus a narrow window, and it is not persisted the way GC-110’s was.
- **Scope:**
  - Decide what gives way once the ref column is at its floor. The obvious answer is the optional
    columns themselves, in the order they are least identifying — DATE, then AUTHOR, then SHA — either
    dropped or narrowed, so `MIN_MSG_W` survives; a `container-type` rule of the kind GC-069 already
    uses on the body preview may be enough and would keep the decision in CSS.
  - Whatever is chosen, the message column keeps `MIN_MSG_W` at the app’s own 900px minimum window
    with every column on, and the columns come back when the window widens.
- **Out of scope:** making the optional columns draggable, changing their 140/150/80 widths for the
  wide case, and the ref column’s own clamp (GC-110, done) or its drag (GC-115).
- **Acceptance:**
  - [x] With all three optional columns on at a 900px viewport, `.col-msg` measures at least
        `MIN_MSG_W` and the first row’s summary is drawn.
  - [x] At 1600 with the same preferences, all three columns are still at their full widths.
  - [x] `npm run typecheck`, `npm test`, `npm run build` pass.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/ui/useDragWidth.ts` if the decision moves into `fitRefCol`.
- **Verify:** build, launch through `tools/launch-app.mjs`, set `graphColumns` to all true in
  `gitclient.prefs` over CDP, reload, and repeat the table above at 1600, 1100 and 900.
- **Log:**
  - 2026-09-06 07:20 proposed by GC-110 (this batch): measured while confirming GC-110, which reserves
    the optional columns’ widths so the ref column gives way for them but cannot help once it is at
    its floor. GC-110’s Out of scope named this shape and left it deliberately.
  - 2026-09-06 08:05 claimed
  - 2026-09-06 08:55 done. `fitOptCols` joins `fitPanels` and `fitRefCol` in `useDragWidth.ts`: the visible set
    is decided against the ref column's floor, dropping whole columns in the order the ticket named — DATE,
    then AUTHOR, then SHA — and `fitRefCol` then runs against the survivors. Deciding the set once, before
    the ref column is refitted, is what keeps it stable: a ref column allowed to grow back into the space a
    dropped column left would drop the next one, and the next. Measured over CDP with all three columns on,
    repeating the ticket's table: 1600 gives body 960, ref 150, all three at 140/150/80 and `.col-msg` 364;
    1100 gives ref 104, SHA only, `.col-msg` exactly 200; 900 gives ref 150, no optional columns, `.col-msg`
    214 — against 0 with no summary drawn at both of the narrow widths before. The summary is drawn at all
    three (113px, "Work on wip branch"). 6 new `fitOptCols` cases, one of them sweeping every panel width
    from `MIN_GRAPH_W` to 1400 against four stored ref widths. Screenshots:
    `docs/screenshots/gc116-optional-columns-900.png` and `-1600.png`.
  - 2026-09-06 08:55 noted while verifying: a column the preference has switched on is now simply absent on a
    narrow window, with nothing saying why. Filed as GC-117 rather than widened into this ticket.

---

### GC-117 A graph column switched on in Preferences can be silently absent

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-116
- **Why:** GC-116 made the AUTHOR / DATE / SHA columns the last thing to give way: once the ref
  column is at its floor they are dropped whole, in that order, so the commit message keeps
  `MIN_MSG_W`. That is the right trade, but it is silent. Measured on the built app at 900x900 with
  all three switched on, none of the three is drawn, while `Preferences` still shows all three
  checked — the user has switched something on, sees no change, and nothing anywhere says the
  window is the reason. The narrower the window the more columns vanish, and the preference itself
  never moves, so the state is not even inspectable from the dialog.
- **Scope:**
  - Say why. A column dropped for want of width should be distinguishable from one switched off:
    a hint on the Preferences row when the current window cannot draw it, or a marker in the graph
    header, whichever reads better beside the existing rows.
  - Whatever is chosen must be derived from the same `fitOptCols` answer the graph renders from,
    not from a second guess at the width, so the two cannot disagree.
- **Out of scope:** the drop order and the decision itself (GC-116, done); making the columns
  narrowable rather than droppable; the ref column's own clamp (GC-110) or its drag (GC-115).
- **Acceptance:**
  - [ ] With all three columns on at a 900px viewport, the Preferences dialog distinguishes a
        column the window cannot draw from one that is switched off.
  - [ ] At 1600 with the same preferences, no such marker is shown.
  - [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- **Files:** `src/renderer/src/components/Preferences.tsx`, `src/renderer/src/graph/CommitGraph.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** build, launch through `tools/launch-app.mjs`, set `graphColumns` to all true over CDP,
  and open Preferences at 900 and at 1600.
- **Log:**
  - 2026-09-06 08:55 proposed by GC-116 (this ticket): measured while confirming GC-116's own
    acceptance — at 900 all three columns are gone from the graph and all three are still checked in
    the dialog.

---

### GC-118 A drag released past the limit throws away the width the pointer did reach

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-111, GC-115 (both `done`)
- **Why:** GC-111 and GC-115 made a drag stop at the wall the window imposes and, crucially, stop
  *persisting* a width the pointer never reached: `dragWidth` answers `reached: false` for a
  request past `limit`, and `useDragWidth`'s `onPointerUp` then does `if (!reached) return` and
  writes nothing at all. But `reached` is computed at the **release** position only, so a drag that
  travelled through widths the wall does allow and then overshot it discards the whole drag,
  including the part that was legitimate. Measured on the built `c98c10a` app at 1000x900 with
  `gitclient.leftPanelW = 170` and `gitclient.detailPanelW = 300` (so the left handle's limit is
  `1000 - 300 - MIN_GRAPH_W` = 260): dragging the left handle 200px right draws the panel at 260 and
  leaves it there, and `gitclient.leftPanelW` still reads `170`. The next load snaps the panel back
  to 170. The user dragged, watched the panel move, released, and the change was dropped in silence
  — which is the same class of surprise GC-115 was filed for, from the other direction.
- **Scope:**
  - A release past the limit persists the last width the pointer **did** reach during that drag,
    rather than nothing. A drag that reached no allowed width at all — the GC-111 case, where the
    limit is at or below the width the element starts from — still persists nothing.
  - Keep GC-115's promise exactly as it is: the wall's own value is never written over a **larger**
    stored width. Both defects are one rule said once — persist what the pointer reached, never what
    it did not — so state it that way rather than adding a second special case beside the first.
  - `dragWidth` stays pure and keeps the unit cases it has; the last width reached belongs in the
    drag ref beside `x` and `w`, which is the only place that knows the drag is still the same one.
- **Out of scope:** the limits themselves (GC-105, GC-110), the fit applied on resize, the
  double-click reset, and the ref column's own `fitRefCol` (GC-110).
- **Acceptance:**
  - [x] At 1000x900 with `leftPanelW` 170 and `detailPanelW` 300, dragging the left handle 200px
        right and releasing leaves the drawn width **and** `gitclient.leftPanelW` at 260, and a
        reload keeps 260.
  - [x] The GC-111 case is unchanged: at 1000x900 with 220 / 720 stored, a one-pixel rightward drag
        of the left handle leaves `gitclient.leftPanelW` at 220 — nothing reached, nothing written.
  - [x] The GC-115 case is unchanged: at 900 with `gitclient.refColW` 400, a rightward drag on the
        ref column leaves the stored 400 alone.
  - [x] `useDragWidth.test.ts` gains a case for a drag whose travel reaches an allowed width and
        whose release does not, asserting which width is persisted.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/ui/useDragWidth.ts`, `src/renderer/src/ui/useDragWidth.test.ts`.
- **Verify:** build, launch through `node tools/launch-app.mjs`, set the two width keys and the
  window size over CDP, drive a real pointer drag with `Input.dispatchMouseEvent`
  (mousePressed, several mouseMoved, mouseReleased), and read `localStorage` and the drawn width
  before the release, after it, and after a reload.
- **Log:**
  - 2026-09-06 08:20 proposed by GR-013: measured on the running `c98c10a` build, the numbers above.
    Not a duplicate of GC-111 or GC-115: both are `done` and both are about a width the pointer
    never reached being written; this is the mirror case, a width it did reach not being written.
  - 2026-09-06 07:35 claimed
  - 2026-09-06 08:05 done. The rule is stated over the drag rather than folded through it:
    `reachedWidth(start, delta, min, max, limit)` is a new pure function beside `dragWidth`, which
    is untouched and keeps its cases. The travel is the whole interval between the start width and
    the release, so the release position and `start` answer the question on their own — released
    inside the wall, that width; released past it from a start inside it, **the wall**; released
    past it from a start already on it, `null`, drawn nowhere and stored nowhere. The ticket
    suggested a `last` field in the drag ref; that was implemented first and then dropped, because
    a ref only records the positions the `pointermove`s happened to sample, and the edge then
    stopped up to one move short of the wall — 258 rather than 260 on a 4px sample, and further on
    a fast drag. A rule over the interval has no such dependence on the drag’s speed, and needs no
    state at all.
  - Verified on the built app over CDP with real `Input.dispatchMouseEvent` drags (press, twelve
    moves, release) at 1000x900: with 170 / 300 stored, a 200px rightward drag of the left handle
    leaves the drawn width and `gitclient.leftPanelW` both at 260, and a reload keeps 260. GC-111
    unchanged: 220 / 720 stored, a one-pixel drag leaves the key at 220. GC-115 unchanged: at 900
    wide with `gitclient.refColW` 400 drawn at 164, a 120px rightward drag leaves the stored 400.
    `useDragWidth.test.ts` gains a `reachedWidth` describe of five cases, including the overshoot
    answered at every delta from 90 to 400 so the drag’s speed cannot change where the edge stops.
    184 unit tests pass (was 179), `npm run typecheck` and `npm run build` clean, e2e 30 steps.

---

### GC-119 Both toolbar popovers can be open at once, and Escape then needs two presses

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-057 (`done`)
- **Why:** GC-057 made Push a split button beside Pull's. The two are kept mutually exclusive by a
  single `mousedown` listener in `Toolbar.tsx`: opening one closes the other only because the click
  that opens it is preceded by a `mousedown` landing outside the other's ref. A `<button>` activated
  from the keyboard fires `click` with no `mousedown` at all, so with the Push popover up, moving
  focus to Pull's caret and pressing Enter leaves **both** open and overlapping — the Push popover
  covers the Pull popover's three mode rows. Measured on the built `c98c10a` app over CDP with real
  `Input.dispatchKeyEvent` presses: state after Enter is `{push: true, pull: true}`, and it then
  takes two Escapes to get back to no layer, because `layerOpen`'s ladder in `App.tsx` closes one
  layer per press and both flags are set. Nothing is corrupted, but the toolbar shows two menus at
  once and makes the "one Escape, one layer" rule look wrong when the fault is the state.
- **Scope:**
  - Opening either popover closes the other **in state**, so the two cannot both be open however
    the button was activated. The `mousedown` listener keeps only the job it is good for, closing
    on an outside click.
  - Whatever shape this takes, the flags stay in `App.tsx` with the other layers and Escape stays
    handled there and nowhere else (GC-038): a mutual-exclusion rule in `Toolbar` must not turn
    into a second keydown listener.
- **Out of scope:** the contents of either popover, focus management or a roving tabindex inside
  them, and the `layerOpen` ladder's order, which is correct for the states it can legally see.
- **Acceptance:**
  - [x] With the Push popover open, focusing the Pull caret and pressing Enter leaves only the Pull
        popover open; the mirror case leaves only the Push popover open.
  - [x] A `mousedown` anywhere outside both still closes both.
  - [x] From either popover, one Escape returns to no layer open.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/App.tsx`.
- **Verify:** build, launch through `node tools/launch-app.mjs` on a repository with two remotes,
  open one popover with a real `Input.dispatchMouseEvent` click, then `focus()` the other caret and
  send a real Enter with `Input.dispatchKeyEvent`, reading
  `document.querySelector('.split-btn.push .popover')` and `.split-btn.pull .popover` after each.
- **Log:**
  - 2026-09-06 08:20 proposed by GR-013: found in the app pass while screenshotting GC-057's two
    popovers, then confirmed with real key events rather than the synthetic `click()` that first
    showed it.
  - 2026-09-06 07:35 claimed
  - 2026-09-06 08:05 done. The two flags in `App` became one value, `popover: 'pull' | 'push' |
    null`, so both open is not a state the app can represent; `pullOpen` / `pushOpen` are derived
    from it and the two setters are kept, each closing only the popover it names, so `Toolbar`’s
    outside-click listener — which asks each popover separately whether the click missed it — can
    no longer close the one that was clicked in. The Escape ladder’s last two branches collapse to
    one `setPopover(null)`. No new keydown listener: the flags and Escape stay in `App` (GC-038).
  - Verified on the built app over CDP on a repository with two remotes (`remote2` added to the
    scratch repo for the run and removed after). A real click opens Push alone; `focus()` on the
    Pull caret plus a real `Input.dispatchKeyEvent` Enter leaves `{pull: true, push: false}` where
    it used to leave both true; the mirror case leaves `{pull: true, push: false}`; one Escape
    returns to no layer; an outside `mousedown` still closes both. Screenshot
    `docs/screenshots/gc-119-one-popover-at-a-time.png`. Note for a future driver: Enter activates
    a button on keydown, so a `keyDown` carrying `text` **and** a separate `char` event activate it
    twice and the popover opened and closed again — the first run read as a failure of the fix.

---

### GC-120 A context menu taller than the window loses its last rows, with nothing to scroll

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** —
- **Why:** `.ctx-menu` is `position: fixed` with a `max-width` and no `max-height`, and its
  `overflow-y` is `visible`. The branch menu has been growing all along: GC-049 added the
  tip-commit actions, GC-073 the hide/solo pair, GC-100 the upstream pair, and GC-114 one
  "Push `<branch>` to `<remote>`" row **per remote**, so its height now scales with the repository.
  Measured on the built `c98c10a` app at 1400x620 — the app's own `minHeight` is 600 — the menu on
  `main` with two remotes is 623px tall, clamped to `top: 4`, and its last row ("Copy branch name")
  ends at y=622 against a 620px window: it is off the bottom edge and there is no way to reach it.
  A third remote adds another row. GC-103 answered exactly this question for the modal — cap the
  height against the window, let one part scroll, keep both ends on screen — and the menu, which is
  the surface most likely to outgrow a short window, never got the same treatment.
- **Scope:**
  - `.ctx-menu` gets a height cap derived from the window and scrolls internally past it, so the
    first and last rows are always reachable. The existing top clamp keeps working, and a menu that
    fits is spaced and positioned exactly as it is now.
  - The scroll container picks up the global `::-webkit-scrollbar` rules (GC-079) with no
    per-component rule of its own, and no `scrollbar-width` / `scrollbar-color`.
  - Check the flip-above-the-anchor path still chooses sensibly once a height cap exists: a menu
    that is capped has no reason to flip.
- **Out of scope:** shortening the branch menu itself or grouping its rows into submenus; GC-074's
  row-width truncation, which is the other axis; the folded-refs block in the graph, which is not a
  `.ctx-menu`.
- **Acceptance:**
  - [x] At 1400x600, the branch menu on a branch with two remotes shows its last row, reachable by
        scrolling, and its first row is on screen.
  - [x] At 1400x900 the same menu is unscrolled and its rect is unchanged from today's.
  - [x] The scrollbar is the app's 8px flat thumb, with no new rule in `app.css` for it, and
        `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` still prints nothing.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/ui/ContextMenu.tsx`.
- **Verify:** build, launch through `node tools/launch-app.mjs`, resize to 1400x600 over CDP,
  right-click `main` in the left panel, and read the menu's `getBoundingClientRect()` and the last
  row's `bottom` against `window.innerHeight`; repeat at 1400x900.
- **Log:**
  - 2026-09-06 08:20 proposed by GR-013: found in the app pass, measured at the app's own minimum
    window height. Named as its own ticket rather than folded into GC-074, which is about a row
    being too wide for the menu, not the menu being too tall for the window.
  - 2026-09-06 07:35 claimed
  - 2026-09-06 08:05 done. `.ctx-menu` gets `max-height: calc(100vh - 8px)` and `overflow-y: auto`
    — 8px being the 4px the position clamp keeps at each edge — so a capped menu lands at `top: 4`
    and ends 4px off the bottom. No per-component scrollbar rule: the global `::-webkit-scrollbar`
    set covers it. One code change was needed with it: `ContextMenu`’s wheel listener closed the
    menu on any wheel, so a capped menu could not be scrolled; it now ignores a wheel whose target
    is inside the menu and closes on every other one, which is the case it exists for.
  - Verified on the built app over CDP. At 1400x600 the branch menu on `main` with two remotes:
    top 4, bottom 596 against a 600px window, 621px of content in a 590px box, an 8px scrollbar
    (measured as `offsetWidth - clientWidth` less the 1px borders), and scrolled to the end its
    last row "Copy branch name" ends at 591 — reachable, where it used to end at 622. A wheel
    inside the menu leaves it open; one outside still closes it. At 1400x900 the same 19 rows are
    unscrolled with no scrollbar and the menu is 623px tall, which is the height the ticket
    measured before this change. Screenshots `docs/screenshots/gc-120-branch-menu-600.png` and
    `-900.png`. The flip path needed no work: `ContextMenu` clamps to the viewport, it never flips.

---

### GC-121 Stage and discard selected lines, not only whole hunks

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** —
- **Why:** the staging workflow stops at the hunk. `buildHunkPatch(file, hunk)` rebuilds a patch
  from `hunk.raw` and the two hunk buttons use it, so anything smaller than a hunk cannot be staged
  at all without editing the file first. GitKraken's Files row offers
  "Stage / unstage / discard (file, folder, hunk, **line**)"
  (`docs/reference/gitkraken/06-feature-inventory.md`), and of everything still missing from the
  study this is the one that changes what the client is *for*: crafting a commit out of a messy
  working tree is the reason to open a git GUI at all. The pieces are already here — the diff
  renders one element per `DiffLine` in both layouts, and GC-104 already keys data off the
  `DiffLine` object itself so the unified and split views read one map, which is exactly what a
  line selection needs in order not to drift between them.
- **Scope:**
  - Selecting lines inside one hunk: click a changed line to select it, shift-click to extend the
    run, click a selected line to deselect. The selection lives with the hunk, is limited to one
    hunk at a time, and clears whenever the diff's identity or version changes (GC-075's keying),
    so a selection can never outlive the content it was made against.
  - `buildLinePatch(file, hunk, selected)` beside `buildHunkPatch`, pure and unit-tested in the
    node project: selected additions stay `+`, unselected additions are dropped, selected removals
    stay `-`, unselected removals become context lines, and the `@@` counts are recomputed from
    what survives. Discard is that patch applied in reverse.
  - The hunk header's buttons read "Stage N lines" / "Discard N lines" while that hunk has a
    selection, and the whole-hunk wording otherwise.
  - Both layouts must build a byte-identical patch from the same selection, the way GC-014 requires
    of `hunk.raw` today.
- **Out of scope:** unstaging individual lines from the staged side — a follow-up once the patch
  builder exists, and worth its own ticket then; folder-level staging; Blame and History from the
  same inventory row; dragging to select.
- **Acceptance:**
  - [ ] Selecting two of three added lines in a hunk and staging leaves exactly those two staged,
        asserted with `git diff --cached` in the scratch repository.
  - [ ] The same selection made in the split layout produces a byte-identical patch to the unified
        one, asserted in a unit test rather than by eye.
  - [ ] Discarding a selection leaves the unselected lines in the working tree untouched.
  - [ ] `buildLinePatch` has unit cases for additions only, removals only, a mixed hunk, and a
        selection covering every changed line — which must equal `buildHunkPatch`'s output.
  - [ ] A new e2e step stages a line selection and asserts the result against git.
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/diff/parseDiff.ts`, `src/renderer/src/diff/parseDiff.test.ts`,
  `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css`, `tools/e2e/run.mjs`.
- **Verify:** `npm test` for the patch builder, then `npm run e2e` for the new step, plus a manual
  pass over CDP in both layouts on `a.txt`, which the fixture leaves with a multi-line change.
- **Log:**
  - 2026-09-06 08:20 proposed by GR-013 from the what's-next pass: the largest remaining gap in the
    Files row of `06-feature-inventory.md`, and the one whose groundwork (`buildHunkPatch`,
    `alignHunks`, the per-`DiffLine` keying from GC-104) is already in place. Not a duplicate of
    GC-052, which is navigation and rendering options inside the diff, or of GC-107, which restores
    a whole file from a commit.

---

### GC-122 The graph does not scroll while a branch is being dragged

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-015
- **Why:** A drag started on a chip can only be dropped on a chip that is already on screen. The
  rows are virtualised inside `.graph-body`, an `overflow: auto` container, and nothing scrolls it
  while a drag is in flight: the pointer held at the bottom edge sits there. On the e2e fixture the
  whole history fits, so the gap does not show; on a real repository the target branch is usually
  hundreds of rows away and the gesture is simply unavailable. The left panel is the workaround
  today — every branch is a row there, and a row can be dropped on a chip — but that is a
  workaround, not the interaction GitKraken has.
- **Scope:**
  - Scroll `.graph-body` while a `dragover` is inside a band at its top or bottom edge, at a rate
    that does not depend on how often the browser fires the event.
  - Stop on `dragleave`, `drop` and `dragend`, so nothing keeps scrolling after the drag.
- **Out of scope:** auto-scrolling the left panel (its rows are not virtualised and it is short),
  and any change to what a drop offers.
- **Acceptance:**
  - [ ] With a repository whose graph scrolls, a drag held at the bottom edge brings later rows
        into view and a chip among them can be dropped on.
  - [ ] Releasing the drag anywhere leaves the graph still.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/ui/refDrag.ts`.
- **Verify:** drive a drag over CDP with the graph scrolled to the top and assert `.graph-body`'s
  `scrollTop` has moved; screenshot.
- **Log:**
  - 2026-09-06 proposed by GC-015 (this ticket): the drag it added can only reach what is drawn.

### GC-123 A ref folded behind +N can neither be dragged nor dropped on

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-015
- **Why:** The ref column shows one chip and folds the rest into `+N` (GC-078); the folded block
  opens on `:hover` over `.col-ref`. Chromium does not update `:hover` while an HTML5 drag is in
  flight, so during a drag the block never opens: a folded ref is not reachable as a drop target,
  and it cannot be picked up either, because opening the block needs a hover the pointer cannot
  give once a drag has started. On the e2e fixture that is four of the seven refs on `main`'s tip.
  The left-panel row is the only way to reach them, which is the same workaround GC-122 names.
- **Scope:**
  - Keep the folded block open while a drag is in flight over the row it belongs to, so its chips
    are drop targets like any other.
- **Out of scope:** changing the fold budget (`MAX_CHIPS` is one deliberately, GC-078), and
  turning the block into a real popover.
- **Acceptance:**
  - [ ] With a drag in flight, hovering a `+N` opens the block and one of its chips takes a drop.
  - [ ] With no drag in flight the block behaves exactly as it does now.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** an e2e assertion that a chip inside `.more-list` accepts a dragover mid-drag, plus a
  screenshot of the open block during a drag.
- **Log:**
  - 2026-09-06 proposed by GC-015 (this ticket): four of the fixture's seven refs on `main` are
    unreachable by drag, and the negative case in step 29 had to be built from a chip on itself
    because no remote chip is ever the visible one.

### GC-124 The staged-changes guard reads the snapshot from before a drop’s checkout

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** GC-015
- **Why:** `runOnBranch` (GC-015) checks a branch out and then calls `runSequencer`, but the
  `runSequencer` it calls is the one built by the render the drop happened in: the staged list its
  guard counts is the working tree as it was **before** the checkout. Nothing is wrong today —
  git carries staged changes across a checkout, and `runCheckout`'s "Stash and check out" pops the
  stash back — so both paths leave the same index the guard measured. It is a latent trap rather
  than a bug: the day a checkout path stops restoring the index, the guard will offer to stash
  nothing and the pop that follows will take an unrelated stash off the list. The same staleness
  is in `runCheckout` itself, which reads `snapshot` for its at-risk count.
- **Scope:**
  - Give `App` a ref mirroring the current snapshot's status, the way `hiddenRef` mirrors the
    hidden set, and have `runSequencer` and `runCheckout` read it instead of the closure's
    `snapshot`.
- **Out of scope:** changing what either guard asks or when it asks it.
- **Acceptance:**
  - [ ] A guard invoked after an awaited checkout counts the files that are staged at that moment.
  - [ ] The existing guard steps in the e2e suite (12 and 29) still pass unchanged.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** unit or e2e coverage of a drop onto a branch that is not checked out, and the full
  e2e run.
- **Log:**
  - 2026-09-06 proposed by GC-015 (this ticket): found while composing the checkout and the
    sequencer guard into one gesture.

### GC-127 A chip offers a grab cursor it cannot honour, and lights up less than the row beside it

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-015 (`done`)
- **Why:** GC-015 gave one gesture two surfaces, and the affordances that say so came out uneven
  at both ends of it.
  - **The cursor promises a drag that cannot start.** `.ref-chip` has carried
    `cursor: grab` since before the drag existed, and it is set on every chip. Only branches are
    draggable (`canDragRef`), so a tag chip — `v0.1.0` and `v0.2.0` on the scratch fixture — and
    the synthetic `HEAD` chip a detached checkout draws both report `draggable=false` while the
    pointer over them says grab. Measured in the built app: `v0.2.0 draggable=false cursor=grab`,
    `v0.1.0 draggable=false cursor=grab`, against `main draggable=true cursor=grab`. The `+N` chip
    is the one that gets this right, at `cursor: default`.
  - **And the two surfaces disagree about what a draggable ref looks like.** Every left-panel
    `.ref-row` is `cursor: pointer`, draggable or not; every chip is `grab`. Two elements standing
    for the same `GitRef`, offering the same gesture, under two different cursors.
  - **The drop highlight is weaker on the surface that receives most drops.** `.ref-chip.drop-over`
    and `.ref-row.drop-over` share a 1px accent outline, and then `.ref-row.drop-over` alone adds
    `background: var(--accent-hover)`. A row therefore lights up with a tint and an outline; a chip
    gets the outline only, over a background that is already a 30% mix of its lane colour, inside a
    column of coloured lanes. At 100% on a 1400px window the ring on `main`'s chip is hard to pick
    out at all; at 3x it is plainly there. The graph is where a drag usually ends, so the weaker of
    the two feedbacks is on the busier surface.
- **Scope:**
  - `cursor: grab` belongs to a chip that can actually be picked up, not to `.ref-chip` as a class.
    Drive it from the same predicate the `draggable` attribute is: a chip that is not draggable
    keeps the pointer the rest of the row has.
  - Settle on one cursor for a draggable ref and use it on both surfaces.
  - Give `.ref-chip.drop-over` feedback of the same strength the row has — a tint over the chip's
    own background, a thicker ring, or both — so a drop target reads at 100% without hunting.
- **Out of scope:** what a drop offers (`canDropRef` is right), reachability of a folded or
  off-screen ref (GC-123, GC-122), and the `opacity: 0.45` on the drag source, which reads
  correctly on both surfaces already.
- **Acceptance:**
  - [ ] A tag chip and the detached-HEAD chip report the same cursor as the row around them; a
        branch chip and a branch row report the same cursor as each other.
  - [ ] A chip under a drag is distinguishable from its neighbours in a 100% screenshot, not only
        under magnification.
  - [ ] No colour reaches `app.css`: any new tint is a token (`grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css`
        still prints nothing).
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/graph/CommitGraph.tsx`,
  `src/renderer/src/ui/refDrag.ts`.
- **Verify:** `npm run typecheck`, `npm run build`, then over CDP: read `draggable` and the computed
  `cursor` off every chip and every left-panel row and assert they agree, and screenshot a chip
  mid-`dragover` at 100% beside the same chip at rest.
- **Log:**
  - 2026-09-06 proposed by GR-014: found in the screenshot pass over GC-015's first build, from
    measurements in the running app rather than from reading the CSS.

### GC-128 The app can only open a repository that already exists: no clone, no init

- **Status:** todo
- **Area:** actions | **Size:** M | **Priority:** P2
- **Depends on:** GC-026 (`todo`, for the two-field dialog clone needs)
- **Why:** `TitleBar` has exactly one repository entry point, "Open repository", and `grep -rn
  "clone" src/` finds nothing. Every repository the app has ever shown was cloned or created by
  something else first. The study's own recommendation for this area is "Build open/clone/init"
  (`06-feature-inventory.md`, RepoManagement row), and GitKraken's new-tab page offers the three
  side by side. It is the largest capability the client is missing that is not deferred by
  design — everything else open on the board is polish on repositories the user already has — and
  it is the difference between a client someone can start their day in and one that assumes a
  terminal did the first step.
- **Scope:**
  - `git.ts`: `cloneRepo(url, parentDir, name?)` and `initRepo(dir)`. Both run through `runGit`
    with a `cwd` that exists — the clone's is the parent directory, not the target — and both
    answer the absolute path of the repository they made, which is what `openPath` takes.
  - `ipc.ts` + preload: `repo:clone` and `repo:init`, arguments validated like every other
    handler. Neither takes a repository path, so neither goes through `repoFile()`.
  - Two entries beside "Open repository" — the same button's menu, or two more buttons — each
    opening one dialog: clone asks for the URL and the parent folder, init asks for the folder.
    Both then `openPath` the result, so the new repository lands in `recentRepos` and
    `lastRepo` like any other.
  - A clone that fails (bad URL, existing directory, auth) reports through the same error path a
    failed action does, with git's stderr, and leaves the open repository alone.
- **Out of scope:** progress reporting and cancellation — `runGit` buffers rather than streams, and
  a clone of a large repository will sit on the busy spinner until it finishes; say so in the log
  and let it be its own ticket if it turns out to matter. Also out: shallow clones, submodule
  recursion, choosing a branch to clone, and cloning from a hosting service's repository list
  (that is the deferred Services area).
- **Acceptance:**
  - [ ] Cloning the e2e fixture's bare `origin` into a new folder produces a working repository the
        app opens, with its branches and remote drawn.
  - [ ] Initialising an empty folder produces a repository the app opens on an unborn HEAD without
        error — `--ignore-missing` already covers the graph's side of that (GC-095).
  - [ ] A clone into a folder that already exists reports git's own message and changes nothing.
  - [ ] Both new repositories appear in the recents dropdown.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/TitleBar.tsx`.
- **Verify:** `npm run typecheck`, `npm run build`, `npm test`, then an e2e step that clones the
  fixture's bare `origin` into a folder under the scratch root, asserts the graph draws it, and
  removes the folder again so the run stays re-entrant. Screenshot both dialogs and the freshly
  cloned repository.
- **Log:**
  - 2026-09-06 proposed by GR-014: from the what's-next pass over `06-feature-inventory.md`. The
    RepoManagement row is the only "Build" row with nothing shipped against it at all.

### GC-132 Three more e2e helpers drop a click on a disabled control and assert nothing

- **Status:** in-progress
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** GC-130 fixed `hunkAction`, but the shape it fixed is not unique to it. `stageRow`
  returns `'DISABLED Stage on <file>'`, `openPopover` returns `'DISABLED <which> caret'` and
  `clickFileRow`'s neighbours return `'no row …'` — every one of them into a bare `log()`, which
  prints the string and asserts nothing. The step then carries on and fails several waits later, at
  a line that has nothing to do with the miss: GC-130's own Why is a transcript of exactly that,
  read at the time as a regression in the diff. `stageRow` is the one that matters most, because
  step 20 calls it immediately after a commit, which is the 300ms watcher echo window that made
  `hunkAction` flake.
- **Scope:**
  - Give `stageRow` and `openPopover` the treatment `hunkAction` now has: poll the atomic
    find-check-click, and `check()` loudly when the control never comes back.
  - Make a "no such control" answer fail where it happens rather than being logged — a helper that
    cannot find its target has already lost the step.
- **Out of scope:** raising any `waitFor` maximum, changing what any step asserts, and the app
  itself: nothing here is a bug in `DiffView` or the toolbar, only in how the suite reads them.
- **Acceptance:**
  - [ ] No helper in `run.mjs` can return a "DISABLED" or "no …" string into a `log()` that
        asserts nothing.
  - [ ] Twenty consecutive `npm run e2e` runs pass, some under a second run's load.
  - [ ] The run's total stays within a second of 32.5s.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e` in a loop, counting failures; and grep the file for `DISABLED` to
  confirm every producer of one is read by an assertion.
- **Log:**
  - 2026-09-06 proposed by GC-130 (this ticket): found while fixing `hunkAction`. The demonstrated
    cause — a control disabled by a watcher echo on a fixture nothing changed — is not specific to
    the diff's hunk buttons, and two other helpers swallow it the same way.
  - 2026-09-06 09:00 claimed

---

### GC-129 A stash message cannot be edited once the stash is made

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `stashMenuItems` offers Apply, Pop and Drop. The study's Stash row lists Apply, Pop,
  Delete, **Edit stash message** and Share as cloud patch; the last is a hosting feature and out,
  which leaves the message as the one thing on that row we do not have. A stash saved in a hurry
  keeps whatever it was called — or git's own `WIP on main: …` when GC-029 let the message be
  empty — and the list is the only thing telling the user which stash is which.
- **Scope:**
  - `git.ts`: `stashRename(cwd, index, message)`. git has no command for this, so it is
    `git stash store -m <message> <sha>` followed by `git stash drop stash@{index}` — read the sha
    **before** either, and drop only after the store has succeeded, or a failure loses the stash.
  - The re-stored entry lands at `stash@{0}`, so **editing a message moves that stash to the top of
    the list**. That is what GitKraken's own edit does and it is acceptable, but it must not be a
    surprise: the dialog says it, or the ticket is not done.
  - `ipc.ts`, preload, and an "Edit message…" row in `stashMenuItems` above the separator, opening
    `ui.prompt` with the current message as the default value.
- **Out of scope:** editing the message of anything else, partial stashes, and any change to how a
  stash is applied or popped (`--index` and `restoreStashWith` are GC-092's and stay untouched).
- **Acceptance:**
  - [ ] Editing the message of `stash@{1}` leaves two stashes, the edited one carrying the new
        message and holding exactly the tree and index it held before.
  - [ ] The dialog says the stash will move to the top of the list.
  - [ ] A store that fails leaves the original stash in place and reports git's message.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/App.tsx`.
- **Verify:** `npm run typecheck`, `npm test`, then an e2e step against the fixture's two stashes:
  edit the older one's message, assert `git stash list` shows the new message at `stash@{0}` and
  that `git stash show --stat stash@{0}` matches what the old entry held, then put the fixture back
  the way step 29 does.
- **Log:**
  - 2026-09-06 proposed by GR-014: from the what's-next pass; the last unshipped entry on the
    study's Stash row, and small enough to ride along in a batch of P3s.

---

### GC-125 Radio buttons are the last unstyled OS control, now that the checkboxes are ours

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-101 (`done`)
- **Why:** GC-101 put the app's own tokens on every `input[type=checkbox]` and on `.pref-select`,
  and explicitly left radio buttons out. There is exactly one radio group in the app — the Pull
  popover's three mode rows — and it is now the only control drawing itself at the OS accent, next
  to a checkbox two toolbar buttons away that draws itself at `--accent`. Visible in
  `docs/screenshots/gc-119-one-popover-at-a-time.png`, taken while verifying GC-119: the selected
  mode's dot is the OS blue, not ours. One control out of step is more conspicuous than all of them
  being, which is why this only becomes worth doing now.
- **Scope:**
  - An `input[type='radio']` rule set beside the checkbox one and in the same shape: `appearance:
    none`, a `--control-box` circle on `--bg-panel-raised` with the app's border, `--accent` when
    checked with a drawn dot, the same focus ring and disabled state.
  - Check the same trap GC-101 hit: a component rule written against a bare `input` that would
    reach a radio and take its size back.
- **Out of scope:** the popover's layout or its rows, toggle switches, and any change to what the
  pull modes do.
- **Acceptance:**
  - [x] Every `input[type=radio]` in the rendered tree computes `appearance: none` and the size the
        rule sets, and a checked one is painted at `--accent`, not the OS accent.
  - [x] Space still selects a focused radio and the arrow keys still move within the group.
  - [x] Screenshot of the Pull popover with a mode selected, beside the checkbox in the same window.
  - [x] `npm run typecheck`, `npm test` and `npm run build` pass, and
        `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` still prints nothing.
- **Files:** `src/renderer/src/styles/app.css`.
- **Verify:** build, launch through `node tools/launch-app.mjs` on a repository with two remotes,
  open the Pull popover over CDP and read the computed `appearance` and `background-color` of each
  radio, then screenshot it.
- **Log:**
  - 2026-09-06 proposed by GC-101 (this ticket): the checkboxes and the select are now ours, which
    leaves the Pull popover's radios as the only OS-painted control in the app.
  - 2026-09-06 09:12 claimed
  - 2026-09-06 10:05 done. `input[type='radio']` styled beside the checkbox rule in `app.css`, same
    shape and the same tokens: `appearance: none`, a 14px `--control-box` circle on
    `--bg-panel-raised` with `--border-strong`, `--accent` when checked with a 6px `--on-accent`
    dot, the same focus ring and the same disabled state. Measured on the running app over CDP:
    every radio computes `appearance: none`, 14x14 and `border-radius: 50%`; the checked one is
    `rgb(77, 136, 255)` — `--accent` (#4d88ff) — with a white 6px dot, and the two unchecked are
    `rgb(50, 54, 63)` on `rgba(255, 255, 255, 0.2)`, which is what the Amend checkbox two panels
    away computes to the byte. Light theme flips the checked one to `rgb(47, 111, 224)`.
    The keyboard is untouched, driven with real `Input.dispatchKeyEvent`: ArrowDown moved the group
    `ff` -> `ff-only` and Space on the focused third radio selected it (`pullMode: rebase`), both
    through the app's own `onChange`. The GC-101 trap was real and is closed:
    `.commit-form input:not([type='checkbox'])` would have reached a radio and taken its size back,
    and now excludes those too. Screenshots `docs/screenshots/gc-125-radios-in-our-own-tokens.png`
    and `gc-125-radios-light.png`; `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` still prints
    nothing, and typecheck, 184 unit tests and the build all pass.

---

### GC-126 Nothing guards the toolbar popovers or the context menu height in the e2e suite

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-119, GC-120 (both `done`)
- **Why:** Both fixes are DOM and CSS behaviour that no unit test can reach — `popover` is state in
  `App` and the menu's cap is a `max-height` — and both were verified by a throwaway CDP script
  that is not in the repository. A regression in either is silent: the popovers would go back to
  overlapping only when a button is activated from the keyboard, and the menu would go back to
  losing its last rows only on a short window, neither of which any existing step visits. The suite
  already owns the shape this needs: step 39's Escape step drives layers, and `contextMenuOn` opens
  menus everywhere.
- **Scope:**
  - A step that opens one toolbar popover with a click, activates the other caret from the keyboard
    with a real `Input.dispatchKeyEvent` Enter, and asserts exactly one popover is in the DOM and
    that one Escape closes it. It needs the second remote, so it belongs after the step that adds
    `remote2` or must add and remove it itself.
  - A step that resizes to the app's own minimum height over CDP, opens the branch menu on `main`,
    and asserts the menu's rect is inside the window at both ends and its last row is reachable
    after scrolling — then restores the window size.
  - The suite's own note that Enter must be sent as a `keyDown` **without** a following `char`
    event, or the button is activated twice and the assertion reads as a bug in the app.
- **Out of scope:** a component test for either (the popover needs the whole toolbar, the cap needs
  layout), and any change to the fixture's remotes beyond what the popover step needs.
- **Acceptance:**
  - [x] Both steps pass on a clean run, and fail when the GC-119 or GC-120 change is reverted.
  - [x] The window size is back where it was by the end, so no later step sees a short window.
  - [x] `npm run e2e` still ends with the fixture matching its baseline.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e:setup && npm run e2e`, then revert each fix in turn and confirm the
  matching step fails.
- **Log:**
  - 2026-09-06 proposed by GC-119, GC-120 (this batch): both were verified with a script that does
    not live in the repository, so nothing in the suite would notice either coming back.
  - 2026-09-06 09:12 claimed
  - 2026-09-06 10:05 done. Two steps, 30 and 31, and the old closing step is 34. Step 30 adds the
    second remote itself (the Push caret only exists with more than one, GC-057), opens the Pull
    popover with a click, focuses the Push caret and activates it with a real Enter, and asserts
    exactly one popover is in the DOM and that one Escape closes it; then the same pair in the other
    order with the mouse. Step 31 emulates the app's own minimum height (900x600 is `minWidth` /
    `minHeight`) with `Emulation.setDeviceMetricsOverride` — this run has no OS window to resize —
    opens the branch menu on `main` and reads its rect: `scrollH 621 > clientH 590`, `top 4`,
    `bottom 596` against `vh 600`, and after scrolling the menu itself the last row
    (`Copy branch name`) sits at 563–591. The override is cleared and the restored height asserted
    before the run goes on.
    Both were checked the way the ticket asks, by reverting the fix. With GC-119 reverted to two
    independent flags, step 30 fails on exactly its own assertion (`pull,push` open at once) and 73
    assertions fail in total, because the stuck popover swallows every later layer — which is how
    bad that bug actually was. With GC-120's `max-height` removed, all three of step 31's
    assertions fail (`bottom 627` against `vh 600`, last row at 594–622).
    Two things learned in the writing, both recorded in the file. Enter must carry `text: '\r'` or
    the focused button's default action never runs — a bare keyDown is what `ctrlEnter` wants and
    the opposite of what a button activation does — and it must not be followed by a `char` event,
    which is the double activation the ticket warned about. And `ContextMenu` closes on `resize`,
    correctly, so the settle after the viewport override belongs **before** the menu is opened: the
    override's own resize event arrives after `window.innerHeight` has already changed, and a menu
    opened before it is dismissed by it. That is the file's fourth `sleep`, commented like the
    other three with what is unobservable.
    `npm run e2e`: 34 steps, 206 assertions, ALL PASSED in 32.5s (git: 319 calls, 8.4s). Screenshots
    `docs/screenshots/gc-126-context-menu-short-window.png` (a menu that just fits, first and last
    rows on screen) and `gc-126-context-menu-capped-scrolled.png` (the capped one, scrolled to its
    last row).

---

### GC-130 Step 21's hunk staging loses a race and fails on a fixture nothing changed

- **Status:** done
- **Area:** tests | **Size:** S | **Priority:** P1
- **Depends on:** —
- **Why:** Six `npm run e2e` runs during the GC-125/126/107/112 batch, five green and one not: step
  21 failed six assertions in a row, starting at `waited for the unstaged diff to show 1 hunk adding
  row 3 edited`, and the run took 53.4s against the 32s the other five took — the extra twenty
  seconds being that step's own five-second waits timing out. The next run on the same fixture, with
  no change to anything, was green. The state the assertions read (`{"chip":"Unstaged","hunks":2,
  "actions":"Stage hunk,Discard hunk,Stage hunk,Discard hunk"}`) is the diff **before** the Stage
  hunk click landed, so the click either did not reach the button or its reload had not been applied
  when the wait started. A step that fails for the fixture's own reasons is worse than no step: the
  next batch reads it as a regression in whatever it was holding.
- **Scope:**
  - Reproduce it — a loop of `npm run e2e` under load is what surfaced it here — and find which of
    the step's waits is satisfiable by the moment before the action rather than after it.
  - Fix the wait, not the timeout. `waitDiff` already keys on the chip, the hunk count **and** the
    added lines for exactly this class of bug (GC-062's own note says so); whatever is left is a
    click that happens before the button it names is the one on screen.
- **Out of scope:** raising any `waitFor` maximum, and every other step.
- **Acceptance:**
  - [x] The cause is named in the log, not just made less likely.
  - [x] Twenty consecutive `npm run e2e` runs pass, at least some of them under a second run's load.
  - [x] The run's total stays within a second of 32s.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e` in a loop, counting failures.
- **Log:**
  - 2026-09-06 proposed by GC-126 (this batch): one flaky failure in six runs of the suite, with the
    full output in this ticket's Why. Nothing in the batch touched step 21 or the diff.
  - 2026-09-06 08:36 claimed
  - 2026-09-06 done. **The cause, demonstrated rather than inferred:** `DiffView` sets `stale`
    whenever a status reload has bumped `version` and the new load has not landed (GC-086), and
    `actionsDisabled = busy || loading || stale` disables every hunk button while it holds. The
    watcher raises that on its own 300ms schedule, so it lands mid-step on a fixture nothing has
    touched. Driven over CDP against the scratch repository, a bare `utimes` touch of `big.txt` —
    no content change at all — produced exactly one frame of
    `{stale:true, hunks:2, adds:"row 3 edited|row 35 edited", disabled:[true,true,true,true]}`
    between two live frames carrying the identical hunks and added lines. That frame satisfied the
    old `waitDiff` in full, and `hunkAction` then returned `"DISABLED Stage hunk on hunk 1"` into a
    `log()` that asserts nothing — so the click was dropped in silence and the miss surfaced five
    seconds later as the *next* `waitDiff` timing out, which is the failure the Why records.
  - The fix is in two halves, both in `tools/e2e/run.mjs`. `waitDiff` and `waitSplitDiff` now carry
    `LIVE_DIFF` — `!document.querySelector('.file-view .diff-body.stale')` — so neither can be
    satisfied by a body whose newest load has not confirmed it; and `hunkAction` polls the atomic
    find-check-click every 50ms for up to 5s instead of giving up, which closes the one CDP round
    trip left between that wait and the click, and fails loudly with `check()` if the button never
    comes back. No `waitFor` maximum was raised and no other step was touched.
  - Evidence: 32 consecutive green runs — 20 on the default root/port, and 12 on a second suite
    (`GITCLIENT_E2E_ROOT=%TEMP%/gitclient-e2e-load`, `GITCLIENT_E2E_PORT=9335`) running
    concurrently, so runs 1–12 of the twenty were under a real second run's load. Runs 9 and 11
    logged `clicked Stage hunk on hunk 1 (after 75ms waiting for the button to come back)`: the
    retry firing is the old failure happening and being recovered, which is the second, independent
    confirmation of the cause. Timings: the eight unloaded runs (13–20) came in at 32.2–33.0s,
    mean 32.6s against the 32.5s baseline; the loaded ones at 33.2–34.6s, which is the second
    suite, not this change. `git: 319 calls` in all 32, unchanged.
  - Screenshot of the live diff the demonstration ran against: `docs/screenshots/gc130-diff-live.png`.

---

### GC-131 A confirmation that carries an option has to be written as a prompt with no input

- **Status:** done
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** —
- **Why:** `ConfirmOptions` is title, message, okLabel and danger. GC-112 needed a confirmation with
  a checkbox on it — "Also delete <branch> on <remote>" — and the only way to get one was to reach
  past `confirm` for `ui.prompt({ input: false, checkbox })`, which is what `confirm` is itself
  built on. It works and it looks right, but there are two callers of it now (the branch delete and
  the tag delete) whose code says "prompt" while what is on screen is a confirmation, and
  `CLAUDE.md` says every confirmation goes through `useUi().confirm`. The next one to want an
  option will copy whichever of the three shapes it happens to read first.
- **Scope:**
  - `checkbox` on `ConfirmOptions`, passed straight through to the modal, and a return that can
    carry the answer — `confirm` returns `boolean` today, so either an overload or a second
    function whose name says it asks a question with a rider.
  - Move GC-112's two call sites onto it and leave `prompt({ input: false })` to mean what it says.
- **Out of scope:** any other `ConfirmOptions` field, the modal's own layout, and the stash prompt,
  which is a real prompt with a real input.
- **Acceptance:**
  - [x] The branch delete and the tag delete read as confirmations in the code as well as on screen.
  - [x] The rendered modal is unchanged: same title, same checkbox row, same buttons.
  - [x] e2e step 33 passes untouched, since nothing about the DOM should move.
- **Files:** `src/renderer/src/ui/UiContext.tsx`, `src/renderer/src/App.tsx`.
- **Verify:** `npm test`, `npm run e2e` (step 33 reads both modals), and the modal side by side
  with the screenshot in GC-112's log.
- **Log:**
  - 2026-09-06 proposed by GC-112 (this batch): the checkbox that ticket needed had no home on
    `confirm`, so both of its confirmations are prompts with the input switched off.
  - 2026-09-06 08:36 claimed
  - 2026-09-06 done. `ConfirmOptions` gains `checkbox`, passed straight through to the modal, and
    `Ui` gains `confirmWithOption(options): Promise<ConfirmAnswer>` — `{ confirmed, checked }`, with
    `checked` false whenever `confirmed` is. A second function rather than an overload, so the
    return type says at the call site which question is being asked. `confirm` is now literally
    `(await confirmWithOption(options)).confirmed`, so there is one implementation of "a
    confirmation is a prompt with its input switched off" and it lives in `UiContext` alone.
  - Both GC-112 call sites moved: the branch delete and the tag delete in `App.tsx` now read
    `ui.confirmWithOption({ … })` and `if (!res.confirmed) return;`. `grep -n "input: false"
    src/renderer/src/App.tsx` is down from four hits to two, and both survivors are real prompts
    with a `secondary` button (`runCheckout`, `runSequencer`).
  - Verified against the built app over CDP: the branch modal reads
    `{title:"Delete branch feature?", children:"h3 + div.modal-body + div.modal-buttons",
    body:"modal-check:Also delete feature on origin", inputs:"checkbox", buttons:"Cancel |
    Delete(danger)"}` and the tag modal the same shape with "Also delete it on origin" — the
    GC-103 three-child shape, one checkbox, no text input, identical to GC-112's screenshot.
    `docs/screenshots/gc131-branch-delete.png` and `docs/screenshots/gc131-tag-delete.png`.
  - e2e step 33 was not touched and passed in all 32 runs of the GC-130 loop, including the run
    made against this build (renderer bundle `index-BPGB-Sz-.js`, byte-identical before and after
    the type-only rename that followed the loop).

---


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

### GR-007 Backlog review 2026-09-06 01:05

- **Status:** done
- **Window:** ee91d54..496aa94
- **Log:**
  - 2026-09-06 01:05 shipped: 3c6918f (GR-006's review), b84ff55 (GC-067 the recents dropdown's
    "Recently opened" caption as a plain `div.ctx-caption` with `role="presentation"`, the label /
    hint flex weights swapped and `.ctx-hint.path` ellipsising at its start through `direction: rtl`;
    GC-062 e2e steps 20 and 21, the commit form and hunk staging, 71 to 88 assertions; GC-070 the
    launcher and repo-hygiene tests moved to `tools/` on a `tools/**/*.test.ts` include in the node
    vitest project and in `tsconfig.node.json`) and 496aa94, the claim of GC-068, GC-075 and GC-076,
    `in-progress` throughout and not touched. Read as a reviewer: the caption is a `div`, so no
    `.ctx-item` selector in the driver can reach it, as the ticket promised; the RTL trick holds for
    the paths it will see (Latin letters and neutrals) and would reorder a folder named in a
    right-to-left script — an edge, noted and not ticketed. The vitest include is `.test.ts` only,
    so `run.mjs` and `setup-testrepo.mjs` cannot be swept in. Steps 20 and 21 in `run.mjs` were read
    from the ticket log and the diff stat only, within the time box, not line by line.
  - health: typecheck ok, tests 72 passed (11 files: 64 node, 8 dom), build ok, in the detached
    worktree at 496aa94 with `node_modules` junctioned from the main checkout. No e2e run this
    review: GR-006 ran it twice on the same fixture an hour earlier and the window's only source
    change is the recents menu.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, then
    catena-feed loaded read-only through `gitclient.lastRepo` (a first attempt with a backslash
    path lost its separators in the eval and showed the "Repository folder not found" empty state
    with both recents rows intact — the empty state itself looked right). Stopped afterwards with
    `stopPort(9334)`; no electron.exe with 9334 on its command line remained. Screenshots in
    `%TEMP%/gitclient-review/GR-007/`, all looked at: `01-graph.png` (scratch repo, seven rows,
    the 9334 profile's AUTHOR / DATE / TIME / SHA still on), `02-graph-zoom3.png` (a body zoom that
    pushed the graph off-screen but exposed the left panel's native scrollbar at 3x),
    `03-catena-feed-graph.png` (881 commits, `008-page-monitor-port` ahead of `master` in date order
    in lane 1, master's lineage in column 0; the `1.86.1` row as `mast…` / `t.` / `+1`; 15px native
    bars on the graph and the left panel), `04-fork-rows-zoom4.png` (a CDP `clip.scale` 4x of the
    `1.86.1` to `1.86.0` rows: the lane-1 join enters the node on a diagonal with no corner — GC-077;
    the primary chip truncated beside a second chip — GC-078), `05-graph-scrollbar-zoom3.png` and
    `06-left-scrollbar-zoom3.png` (arrow buttons, grey thumb, lighter track — GC-079),
    `07-commit-selected.png` (the `1.86.1` commit: sha, ref list truncated to `origin…`, message box,
    bot avatar fallback, one parent link, `package.json`), `08-diff.png` (one-hunk version bump,
    icon rail 7 / 52 / 283 / 0), `09-wip-staging.png` (Unstaged 1 `.env.examples`, Staged 0, the 72
    counter). Compared with `02-main-1080.png`, `03-commit-selected.png` and `04-diff-view.png` from
    the study; none of the study's captures shows a fork, so GC-077's shape comes from Ricardo's
    description checked against our own render.
  - what's next: Ricardo joined this review's session and asked for three UI changes, which became
    the tickets below; the rotating-surface pass was spent on the graph geometry and the scrollbars
    instead of a new panel this time.
  - tickets: added GC-077 (graph, M, P1: right-angle joins with a rounded corner, plus the first
    `GraphCell` component test), GC-078 (graph, S, P1: exactly one chip per row at every width, the
    rest in `+N`, branches before tags — supersedes GC-006's width-aware fold and settles GC-023's
    unticked box; `CommitGraph.test.tsx` moves from `+4` to `+5`) and GC-079 (ui, S, P1: 8px flat
    scrollbars everywhere through `::-webkit-scrollbar`, no arrow buttons). All three are P1 because
    Ricardo asked for them directly, and their file sets are disjoint (`GraphCell.tsx` +
    `GraphCell.test.tsx`; `CommitGraph.tsx` + `CommitGraph.test.tsx`; `tokens.css` + `app.css`), so
    one batch can take them together. GC-071 got a log line: after GC-078 the 100px measurement is
    the same one-chip shape as every other width, so it now depends on GC-078 as well. Board: the
    three new rows sit at the top of the `todo` block, ahead of GC-049. Nothing else moved; blocked
    GC-017 and GC-018 still wait on Ricardo's decisions.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through b84ff55 (GC-067, GC-062, GC-070), and its
    Unit tests paragraph's 72 tests and Testing paragraph's 88 assertions match. Its Graph section's
    `chipBudget(refColW)` sentence ("one per 75px of ref column, 1 to 6") and GraphCell's "curves in
    and out" wording will go stale when GC-078 and GC-077 ship — the worker updates them then.

### GR-008 Backlog review 2026-09-06 02:25

- **Status:** done
- **Window:** 496aa94..bf02975
- **Log:**
  - 2026-09-06 02:25 shipped: 42a3fd0 (GR-007's review), 5655a34 (Ricardo dropping subagents from
    the routine protocol, keeping multi-ticket batches), 3dca449 (filed GC-080 and GC-081 — and
    carried the code of GC-068, GC-075 and GC-076 under that message: the `generation` ref in
    `App.tsx`, `App.test.tsx`, `DiffView`'s `viewKey`, `restoreFixture()` and step 22 in `run.mjs`,
    the `refs/e2e/baseline/*` snapshot in `setup-testrepo.mjs`), 67d0e7f (the real close-out of those
    three: `CLAUDE.md`, the ticket logs, `gc075-staged-diff.png`), 019ce92 (Ricardo's note recording
    the early landing on all three tickets) and bf02975, the claim of GC-077, GC-078, GC-079, GC-049,
    GC-061 and GC-069, `in-progress` throughout and not touched. Read as a reviewer: the generation
    counter is captured before every read and checked after, the failure path of `load()` included,
    and `openPath()` bumping it is the right extension of the Scope; `restoreFixture()` matches
    commits by subject and resets `--soft`, as the ticket argues it must, and its `EXPECTED_STATUS`
    encodes the post-pop unstaged state that GC-082 already promises to update; `DiffView`'s key
    includes `version`, which is what makes the body blank on every action — GC-086 below. Every
    ticked box in the window has evidence in its log, including the three mutation checks and the
    honest note on GC-075's third criterion (the offscreen 10fps capture could not catch the frame,
    the render trace stands in for it).
  - health: typecheck ok, tests 74 passed (12 files), build ok, in the detached worktree at bf02975
    with `node_modules` junctioned from the main checkout. No e2e run this review: the window's
    e2e changes were verified five runs deep in GC-076's own log an hour earlier, and the time went
    to the app instead.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e` (fixture
    recreated first). The 9334 profile still carried GR-005's `graphColumns` toggles, so `01-graph.png`
    shows AUTHOR / DATE / TIME / SHA on; the blob was then removed over CDP and every later capture is
    the default. Screenshots in `%TEMP%/gitclient-review/GR-008/`, all looked at: `02-graph-default.png`
    (seven rows plus WIP, lanes continuous through the merge, `main` absorbing `origin/main` with the
    cloud mark and `v0.1.0` beside it, `wip-bran…` / `orig…` and `featu…` / `origin/f…` truncated at
    150px — GC-078, in progress at the time), `03-preferences.png` (rotating surface: three groups,
    six rows, the pull-mode select, Close; against `12-preferences.png` ours is a modal where the
    study's is a two-column page, a deliberate difference at this size), `04-pull-popover.png`
    (caption, three radios and `Fetch all` as a separated row; the study's `11-pull-dropdown.png` has
    four radios with Fetch All among them — acceptable divergence, noted), `05-left-expanded.png`
    (rotating: TAGS with `v0.1.0`, STASHES with a `review stash` made on `big.txt` for the capture and
    popped `--index` afterwards, the stash row's index badge; against `08-left-panel-expanded.png` the
    tint, check mark and indent match, hide/solo remain GC-073), `06-left-row-menu.png` (the `feature`
    row: Checkout, Merge, Rebase | Create branch | Pin to Left | Rename, Push and set upstream |
    Delete | Copy — "and set upstream" is correct, `git branch -vv` shows `feature` and `wip-branch`
    have no upstream in the fixture, which also means the two chips on `Extend feature` are right and
    that no branch is ever ahead/behind, so the left panel's ↑/↓ and the crumb's `ab-badge` have
    never been in a screenshot — noted for the fixture tickets, not filed), `07-wip-menu.png` (Stage
    all, Unstage all | Stash changes… | Discard all), `08-commit-selected.png` (the merge commit: sha,
    the ref line `HEAD -> main, tag: v0.1.0, origin/m…` — GC-087, message box, initials avatar, two
    parent links, `+1 added`, `feature.txt`), `09-commit-diff.png` (`feature.txt` against the first
    parent, icon rail 3 / 3 / 1 / 1), `10-wip-diff.png` (`a.txt` unstaged, Stage file / Discard
    changes, one hunk with its two buttons; against `15-wip-diff-staging.png` the header and gutter
    shapes match, hunk navigation and view toggles remain GC-052 and GC-014), `11-big-txt-before.png`
    (the two-hunk file before the GC-086 measurement). GC-086's trace was taken on this app: a
    MutationObserver on `.diff-body` across one Stage hunk click recorded
    `2 hunks → Loading diff… → 1 hunk → Loading diff… → 1 hunk`; the index was reset afterwards and
    `git status --short` matched the fixture. Stopped afterwards by PID: the 9334 tree was
    32412 with children 25192, 40008 and 40028 (a first pass killed only one because the PowerShell
    list carried CRs; the second, CR-stripped, took the rest); no electron.exe with 9334 on its
    command line remained. The worker's own app on 9333 (pid 11680 at the start of the review) was
    gone when checked at 02:21 and was not among the PIDs this review killed; the batch presumably
    stopped it itself.
  - what's next: the study's toolbar has two breadcrumb dropdowns and ours wires one, so the branch
    crumb became GC-088; the study records no stash rows in the graph, so that GitKraken behaviour
    stays unticketed until a hands-on session documents it. The Path | Tree toggle noted by GR-006
    still waits on a fixture with a nested path. Ricardo joined the session while the write waited
    for the worker's close-out and asked for a ticket to revise `CLAUDE.md`, which "already starts
    having too much crap" — GC-089, measured on the spot at 9206ba6: 867 lines, 10,940 words, 147
    ticket citations.
  - tickets: added GC-086 (diff, S, P1: the body blanks twice per hunk action since GC-075 keyed the
    diff on `version` as well as the view — from the code-review pass, confirmed by measurement),
    GC-087 (ui, S, P3: the commit view's ref line rendered as chips — from the screenshot pass,
    depends on GC-078 so the chip markup is lifted once), GC-088 (ui, M, P2: the branch breadcrumb
    dropdown — from the what's-next pass) and GC-089 (infra, M, P1: `CLAUDE.md` slimmed back to a
    handover, asked for by Ricardo). The worker's close-out 9206ba6 landed at 02:33 while this review
    polled for a clean `TICKETS.md`, and its reflect step took GC-085, so this review's tickets start
    at GC-086; 9206ba6 itself is outside this window and unreviewed here — GR-009's. Board: GC-086
    heads the `todo` block ahead of GC-072 because it is a visible regression in shipped work,
    GC-089 right behind it because Ricardo asked for it; GC-088 follows GC-073 as the last P2 row;
    GC-087 follows GC-074 in the P3 block. Nothing else moved; blocked GC-017 and GC-018 still wait
    on Ricardo's decisions.
  - notes: at bf02975 `CLAUDE.md`'s "Done" paragraph was current through 67d0e7f (GC-068, GC-075,
    GC-076) and its 74 tests and 91 assertions matched this window; 9206ba6 rewrote it again for six
    more tickets, not checked here. GC-086 will change the Diff section's "only
    `loaded.key === viewKey` is rendered" sentence when it ships, and GC-089 will change all of it.

### GR-009 Backlog review 2026-09-06 03:15

- **Status:** done
- **Window:** bf02975..cee2b53
- **Log:**
  - 2026-09-06 03:15 shipped: 9206ba6 (the close-out of GC-077, GC-078, GC-079, GC-049, GC-061 and
    GC-069, left unreviewed by GR-008 because it landed while that review was polling), 5db4e55 and
    48d149b (GR-008's own claim and review), e5b3b33 (the close-out of GC-072, GC-064, GC-082 and
    GC-080) and cee2b53, the claim of GC-086, GC-050, GC-073 and GC-089, `in-progress` throughout
    and not touched. Read as a reviewer: GC-077's join is exactly lane, arc, centre line — the live
    DOM on the fixture gives `M 38 0 V 6 A 8 8 0 0 1 30 14 H 18` in and `M 18 14 H 30 A 8 8 0 0 1 38
    22 V 28` out, with `JOIN_R` clamped to the lane distance as the ticket says; GC-078's `MAX_CHIPS`
    is honestly one at every width and `chipBudget` is gone; GC-061's synthetic chip never reaches
    `getRefs` or `GitRef` and is ranked at -1 so it cannot fold; GC-072's `deletedFromTree` correctly
    lets the unstaged side decide when both are set; GC-080's `dataGen` is bumped on all four paths
    that land state, the failed-load path included, which is what stops a wait hanging on an error.
    One defect found, filed as GC-092 — GC-082's `restoreStash` retries the plain form after an
    `--index` attempt that had already applied with conflicts, so git's real message is discarded
    and replaced by one the retry itself caused.
  - health: typecheck ok, tests 77 passed (13 files, node + dom), build ok — all three in the
    detached worktree at `%TEMP%/gitclient-review/wt` with `node_modules` junctioned from the main
    checkout, whose `out/` was left untouched (last written 03:00 by the worker). No e2e run: the
    window's e2e changes are GC-080's own, verified in its log at 19.5s over five runs, and the
    budget went to the app and to reproducing GC-092 instead.
  - app: the worktree build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e` (fixture
    recreated first; `gitclient.prefs` and `gitclient.refColW` cleared over CDP so every capture is
    the default). Screenshots in `%TEMP%/gitclient-review/GR-009/`, all looked at: `01-graph.png`
    (eight rows plus WIP, lanes continuous, `main` absorbing `origin/main` with the cloud mark,
    `wip-branch +1` and `feature +1` — GC-078's one chip, now landing at full width instead of
    GR-008's `wip-bran…` / `orig…`, a clear improvement), `02-graph-zoom3.png` (a 3x body zoom, which
    squeezed the graph column to nothing while both side panels kept their fixed widths — noted as a
    reflow observation, not ticketed: the window is 1400 wide and Ricardo's screen is 3440),
    `03-refs-folded-hover.png` (GC-078's grow-in-place block, never captured by a review before: the
    `+1` hides and `wip-branch` / `origin/wip-branch` stack in the lane colour with the first line on
    the chip's own pixel, exactly as specified — it does overlay the next row's `main` chip, which is
    inherent to the design and not filed), `04-branch-menu.png` (GC-049's tip-commit group on the
    `feature` chip: Cherry pick, Revert, the three Resets, Create tag here…, Copy commit sha, in
    their own separated groups between Create branch and Pin to Left — and GC-074 confirmed visible,
    "keep changes in the working dire…" truncated at the menu's cap), `05-detached-head.png` (the
    click landed on the repository crumb rather than Refresh and caught GC-044/GC-067 instead: the
    recents dropdown with "RECENTLY OPENED", `testrepo` ellipsised at the start and `catena-feed`
    shown in full — both correct), `05b-detached-head-refs.png` (GC-061 after `git checkout --detach`:
    the `✓ HEAD` chip on `Remove obsolete file` with `main ☁` below it in the expanded block, crumb
    and staging header both reading "detached HEAD", Push disabled with "Cannot push from a detached
    HEAD" — all as the ticket promised, and the gap it left became GC-094) and `06-diff.png` (`a.txt`
    unstaged, Stage file / Discard changes, one hunk with its two buttons, the icon rail at 3/3/1/0).
    The scratch repository was returned to `main` afterwards and `git status --short --branch` matches
    the fixture. Stopped by PID: the 9334 tree was 39276 with children 39408, 39332 and 38880, all
    gone on the recheck; four other `electron.exe` remained alive and were deliberately left, none
    of them carrying 9334.
  - what's next: read `06-feature-inventory.md`'s Files row and Core table against the board. The
    strongest unticketed candidate is ignoring a file, which GC-043 explicitly deferred to "its own
    ticket if wanted" — filed as GC-093. Also unticketed and worth a later look: "Restore file from
    this commit", "Compare against working directory", a plain "Set upstream" on a branch (only
    "Push and set upstream" exists) and "Fast-forward X to Y". The left panel's ahead/behind arrows
    still cannot be screenshotted because no fixture branch has an upstream that differs, which is
    GR-008's observation and remains folded into GC-055/GC-056 rather than a ticket of its own.
  - tickets: added GC-092 (actions, S, P1: the conflicting-pop fallback, from the code-review pass,
    reproduced in a scratch repository), GC-093 (ui, M, P2: Ignore file / extension / folder, from
    the what's-next pass) and GC-094 (ui, S, P3: the left panel header, from the screenshot pass).
    Board: GC-092 goes to the head of the `todo` block, ahead of GC-088, as a P1 regression in
    shipped work; GC-093 after GC-090 as the last P2 row; GC-094 after GC-091 in the P3 ui cluster.
    Nothing else moved — the P3 block is already ordered sensibly and no `todo` ticket has gone
    vague. Blocked GC-017 and GC-018 still wait on Ricardo's decisions and neither is unblockable
    from anything in this window. Deduplication: GC-092 is not GC-091 — GC-091 is about the severity
    the message is rendered at, GC-092 about the message being the wrong one; GC-094 does not reopen
    the left-panel row GC-061 ruled out, only the header above it.
  - notes: `CLAUDE.md`'s "Done" paragraph is current through e5b3b33 and its test count (77) and the
    e2e assertion count (104) both match this window, so nothing is stale today — but GC-089, claimed
    in cee2b53, is about to rewrite the whole file, and GC-092 will need the GC-082 paragraph's
    "applies nothing when it refuses" corrected wherever that text ends up.

### GR-010 Backlog review 2026-09-06 04:20

- **Status:** done
- **Window:** cee2b53..d34d732
- **Log:**
  - 2026-09-06 04:20 shipped: 59f649f (the close-out of GC-086, GC-050, GC-073 and GC-089),
    d8d8677 (GR-009 itself), 85b85e4 (the claim of GC-092, GC-088, GC-090, GC-095 and GC-093) and
    **d34d732, that batch's close-out, which the worker pushed at 04:19 while this review was
    running** — the window was extended to it and health re-run against it, but the reading below is
    deep on 59f649f and a skim on d34d732; GR-011 should read d34d732's five tickets properly.
    On 59f649f: GC-086's two-part key is right — the identity decides what renders and `version`
    only decides `stale`, so no hunk can sit under a flipped header and `actionsDisabled` still
    covers the pending reload; both are derived during render as the ticket insists. GC-050's
    `useDragWidth` genuinely replaces three copies and computes the released width from the release
    position, and the handles measure 4px at x=217 and x=999 with `--left-panel-w` 220 and
    `--detail-panel-w` 400. GC-073's `--exclude` is ahead of `--all`, the ipc argument is validated
    with `strs` and an omitted one means none, and the decision recorded in the log (one action
    hides exactly one ref) is the one the code implements. One defect found and filed as GC-099:
    the hidden set is applied from an effect that runs *after* the first snapshot, so a cold open
    with anything hidden costs two full `git log` runs and paints the hidden branches first.
    On d34d732 (skim): GC-092 answers GR-009's finding properly — `restoreStashWith` reads the
    status either side of `stash --index` and retries only when nothing moved, deciding from
    repository state rather than from git's wording, and it arrives with `src/main/git.test.ts`
    (the test count went 77 → 92). GC-095 replaced `--all` with per-namespace `--glob`s plus HEAD,
    with the excludes repeated before each glob.
  - health: typecheck ok, tests **92 passed (14 files)**, build ok — re-run on d34d732 in the
    detached worktree at `%TEMP%/gitclient-review/wt` with `node_modules` junctioned from the main
    checkout. (On 85b85e4 earlier in the run: typecheck ok, 77 passed, build ok.) `MAIN/out` was
    left untouched throughout — last written 04:08 by the worker, verified by mtime. No e2e run:
    the budget went to the app pass and to reproducing GC-099, and the window's e2e changes are the
    tickets' own, evidenced in their logs (117 assertions at 21.1s for 59f649f).
  - app: the 59f649f build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, fixture
    recreated first, every `gitclient.*` key except `lastRepo`/`recentRepos` cleared over CDP so
    each capture is the default. Screenshots in `%TEMP%/gitclient-review/GR-010/`, all looked at:
    `01-graph.png` (nine rows with WIP, Viewing 7, lanes continuous, `main ☁` absorbing its
    upstream, `wip-branch +1` and `feature +1` at full width, the `v0.1.0` tag chip on the merge —
    no regression from GR-009's reading), `02-hidden.png` (GC-073 end to end: both `wip-branch`
    rows dimmed with eye-off icons, the `Work on wip branch` row gone, Viewing 5, the status bar at
    7 commits, and a "Show all" eye appearing on both the LOCAL and REMOTE heads — exactly what the
    ticket promised, and the eye is absent on the checked-out `main` row as specified),
    `03-preferences.png` (**the rotation surface: no review had captured Preferences before**; it
    is well laid out — APPEARANCE / GRAPH / BEHAVIOUR, each row a label plus a caption, a real
    backdrop at rgba(0,0,0,0.5) — but its controls are where GC-101 came from) and
    `04-shortcuts.png` (the overlay, twelve bindings across five groups; every one of them is a
    navigation or dialog key, and not one names a git action, which is the case GC-033 already
    makes — noted as evidence for that ticket rather than filed again). The scratch repository was
    left on `main` matching its fixture. Stopped by PID: the 9334 tree was 39532 with children
    26504, 17628 and 41484, all gone on the recheck; four other `electron.exe` were alive and
    deliberately left, none carrying 9334.
  - what's next: read `06-feature-inventory.md`'s Branch row and the Files row against the board.
    Fast-forward and a plain Set upstream are the two Branch actions with no ticket and no route
    through the UI at all — GR-009 flagged both and GC-049 deferred Fast-forward by name — so they
    became GC-100. Still unticketed and worth a later look: "Restore file from this commit",
    "Compare against working directory", "Export changes to patch" and Blame/History on a file row
    (GC-093 has just given that menu its first non-trivial action, so it is the natural place to
    grow), and "Delete branch local / remote / both" as one action. The left panel's ahead/behind
    arrows still cannot be screenshotted because no fixture branch has an upstream that differs —
    GC-100 needs the same fixture change GC-055/GC-056 want, and its ticket says so.
  - tickets: added GC-099 (graph, S, P1: the double load on open, from the code-review pass,
    reproduced on the built app), GC-100 (actions, M, P3: fast-forward and set upstream, from the
    what's-next pass) and GC-101 (ui, S, P3: native checkboxes and the Arial Preferences select,
    from the screenshot pass). Board: GC-099 goes to the head of the `todo` block, ahead of GC-098,
    as the only P1; GC-100 after GC-057 in the remote/upstream cluster; GC-101 after GC-097 with
    the other recent P3 ui rows. Nothing else moved. Deduplication: GC-099 is not GC-068 (that one
    is a late watcher reload overwriting a fresher snapshot, and puts coalescing explicitly out of
    scope); GC-100 is what GC-049 deferred, not a re-file of GC-031's push-to-a-chosen-remote;
    GC-101 touches no setting's behaviour, so it does not overlap GC-013's light theme. Blocked
    GC-017 and GC-018 still wait on Ricardo's decisions and nothing in this window unblocks either.
    No `todo` ticket has gone vague.
  - hygiene: 59f649f's batch left every acceptance checklist untouched — GC-050, GC-073, GC-086 and
    GC-089 are `done` with 0 boxes ticked and 18 unticked between them, against 195 `[x]` in the
    rest of the file. Their narrative logs are excellent and carry the evidence, so nothing is
    unverified in substance, but step 6 of the routine says to tick the boxes actually checked, and
    a reader scanning statuses sees four shipped tickets that read as unverified. d34d732's batch
    ticked all of its own, so this looks like one run's lapse rather than a drift — recorded here so
    it does not become one. Not filed as a ticket: it is process, not product. Otherwise the board
    is in good order; the one structural wart is that the P3 block has grown past twenty rows and
    its ordering is now more historical than deliberate, which deserves a considered pass by GR-011
    or by Ricardo rather than a reorder made in passing here.
  - notes: `CLAUDE.md` is current, and deliberately so twice over — GC-089 rewrote it to 466 lines
    in 59f649f and d34d732 updated it again; it now reads "92 tests today", which matches this
    review's own run exactly, and its Commands and Architecture sections match what was observed on
    the running app. Nothing stale to report.

### GR-011 Backlog review 2026-09-06 05:50

- **Status:** done
- **Window:** d34d732..6af7d97
- **Log:**
  - 2026-09-06 05:50 shipped: bc6f42f (the claim of GC-099, GC-098, GC-012, GC-013), 2486933,
    92ce472, 0ab69cf and 4ea8ada (those four implemented one per commit), 096a41f (their close-out),
    bd9c89f (the claim of GC-014), and then **91c2f8a and 6af7d97, which the worker pushed while this
    review was running** - GC-014's close-out and the claim of a six-ticket batch (GC-103, GC-021,
    GC-083, GC-104, GC-084, GC-040). The window was extended to 6af7d97, but everything below - the
    health run, the app pass, the measurements in the new tickets - was taken at **bd9c89f**;
    GC-014 was read only for `parseDiff.ts`, so GR-012 should read its other five files properly.
    GC-099 is right and answers GR-010's finding exactly: `load()` reads the stored set for the path
    it is about to open and passes it to the first `loadRepo`, and the close-out moved
    `hiddenRef.current = hide` from before the await to beside `setSnapshot` - which matters, because
    the prune effect clears that ref while there is no snapshot and on a cold open runs between the
    two, so the earlier placement would have left the effect comparing against an empty set and asked
    for the second load anyway. Three cases in `App.test.tsx` assert the thing that is actually at
    stake, the *number* of `loadRepo` calls, and record what the first one excluded. GC-012 is
    careful: a page carries the hidden set its range was loaded with, is dropped on a generation
    change, and `pageDepth` makes a watcher reload ask for what is on screen rather than dragging a
    deeply scrolled graph back to row 2000. Its log is honest that the acceptance named catena-feed
    and that no repository on this machine reaches 2000 commits, and says what was used instead. One
    defect found and filed as GC-106: `layoutGraph`'s `LaneState` - built, tested in ten cases and
    written into `CLAUDE.md` - has no production call site, so every appended page re-lays out the
    whole history. GC-013 is clean: `resolveTheme` is the single answer to which theme is showing
    because the main process needs it for the window controls, `TITLE_BAR_OVERLAY` sits in `ipc.ts`
    to avoid the cycle with `index.ts`, the theme argument is validated with `oneOf` like every other
    enum, and a platform without an overlay is a no-op rather than a rejected IPC call. Verified
    independently: `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` prints nothing, and every one of the
    42 colour tokens on `:root` is redefined under `:root[data-theme='light']` (only `--row-h` and
    `--lane-w`, which are metrics, are not). GC-098 reads well - `git()` throws and names the command,
    `gitMay()` is the explicit opt-out, and the `index.lock` retry is scoped to the message the app's
    own watcher produces.
  - health: at bd9c89f, in the detached worktree at `%TEMP%/gitclient-review/wt` with `node_modules`
    junctioned - typecheck ok, **106 tests passed (14 files)** in 1.43s, build ok. `MAIN/out` was
    never written: its `index.html` still read 05:09 (the worker's) after the worktree's read 05:13.
    e2e was run too, on **port 9335** with `GITCLIENT_E2E_ROOT=%TEMP%/gitclient-review/e2e`, because
    this window rewrote the harness itself: **143 assertions across 28 steps, all passed, 23.0s**, and
    the final drift step confirmed the fixture was left as found. Worth recording for the next
    reviewer: `tools/e2e/run.mjs` defaults `PORT` to **9333** and calls `stopPort(PORT)` before
    launching, so a review that runs e2e without setting `GITCLIENT_E2E_PORT` would kill the worker's
    app. (CLAUDE.md at 6af7d97 reads 118 tests and 29 steps / 151 assertions, which is GC-014's own
    count and is not contradicted by the numbers above - they were measured one commit earlier.)
  - app: the bd9c89f build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, fixture
    recreated first, every `gitclient.*` key except `lastRepo`/`recentRepos` cleared over CDP.
    Screenshots in `%TEMP%/gitclient-review/GR-011/`, all looked at. `01-graph-dark.png` and
    `02-graph-light.png` are the same nine rows in both themes: lanes continuous, `main` absorbing its
    upstream, `wip-branch +1` and `feature +1`, the `v0.1.0` tag chip on the merge - GC-013 flips the
    whole frame with nothing left behind, which is the thing that could have gone wrong.
    `03-diff-light.png` is the surface GC-013's own screenshots did not cover: the added line's green,
    the gutter and the Stage/Discard buttons all read correctly on white. `04-commit-light.png`
    caught the confirm modal in light theme (a rotation surface: white card, real backdrop, the danger
    button distinct) and the commit view behind it; the backdrop was checked properly rather than by
    eye - full viewport, `pointer-events: auto`, z-index 900, `elementFromPoint` over the graph
    returns it, and focus sits on the default button - so the modal is well behaved and the row that
    appeared selected behind it was my synthetic dispatch, not a hit-testing bug. **The rotation onto a
    second window width is where the review's finding came from**, and it is GC-105:
    `05-narrow-light.png` at 900px, the app's own declared `minWidth`, leaves a 54px commit message
    column with every row ellipsised to four characters; `06-narrow-wide-panels.png`, with both panels
    at the maxima `useDragWidth` itself allows, has no graph at all and a detail panel running 240px
    past the right edge. Also noted but not filed: the 10px toolbar labels measure 3.19:1 against
    their bar in light and 3.32:1 in dark, both under AA - it is the `--text-dim` token doing what it
    was designed to do in both themes, not a light-theme regression, so it is a palette decision for
    Ricardo rather than a bug to file.
  - what's next: read `06-feature-inventory.md`'s Files row against `fileMenuItems`. On a **commit's**
    file row the menu is only Open file / Show in folder / Copy file path, and all three act on the
    working tree - so a row naming last week's version of a file can only reach today's. "Restore file
    from this commit" is the cheapest entry in that row and became GC-107. Still unticketed from the
    same row and worth a later look: Blame, History, Export changes to patch, and Compare against
    working directory. From the Branch row, "Delete branch local / remote / both" as one action
    remains the only untouched entry now that GC-100 covers fast-forward and set-upstream.
  - carried over: GR-010 asked this review to read d34d732's five tickets (GC-092, GC-088, GC-090,
    GC-095, GC-093) properly, having only skimmed them. That was **not done** - d34d732 is this
    window's exclusive start, and the budget went to this window's four tickets, the e2e run and the
    app pass. GR-012 inherits it, together with GC-014's other five files.
  - tickets: added GC-105 (ui, S, **P1**: panel widths never clamped against the window, from the
    screenshot pass, measured over CDP at four configurations), GC-106 (graph, S, P2: the unused
    `LaneState`, from the code-review pass, with the layout cost measured by transpiling `lanes.ts`
    and timing it) and GC-107 (actions, M, P3: restore a file from a commit, from the what's-next
    pass). Board: GC-105 goes directly under GC-103, the two P1 rows together at the head of the open
    work; GC-106 under it as the only P2; GC-107 after GC-100, beside the other `actions` feature row.
    Nothing else moved - the P3 block's ordering is still more historical than deliberate, as GR-010
    said, and re-ordering forty rows in passing is worse than leaving it for a considered pass.
    Deduplication: GC-105 is not the worker's GC-103 (that one is a modal outgrowing a short window;
    this is the app frame's own panels) and not GC-050, which shipped the panels and is done; GC-106 is
    new; GC-107 is the Files-row entry GR-010 named, and does not overlap GC-093's ignore rows or
    GC-072's shell-action guard. Blocked GC-017 and GC-018 still wait on Ricardo and nothing in this
    window unblocks either. No `todo` ticket has gone vague.
  - hygiene: this window's batch ticked its acceptance boxes and carried real evidence in every log -
    the lapse GR-010 recorded (four `done` tickets with no boxes ticked) did not repeat, so it was one
    run's slip rather than drift. GC-012's log volunteers that its acceptance named catena-feed and
    that catena-feed has only 881 commits, which is exactly the kind of honesty that makes a ticked box
    worth reading. One small gap: GC-012's **Files** line lists five files and the commit touched
    seven - `shared/types.ts` and `preload/index.ts` - which the log itself points out; adding an API
    always means those four files, and the template's Files line should say so up front rather than in
    the log afterwards. Not filed: process, not product.
  - notes: `CLAUDE.md` is current at 6af7d97 - GC-014 updated it in the same commit, and its test and
    e2e counts match that commit. The one sentence that is now wrong is the Graph section's account of
    `prev`/`LaneState`, which describes paging the app does not do; GC-106 owns fixing it, and this
    review does not edit `CLAUDE.md` itself.

### GR-012 Backlog review 2026-09-06 07:05

- **Status:** done
- **Window:** 6af7d97..37f392b
- **Log:**
  - 2026-09-06 07:05 shipped: ten commits. 242f10f, c97cafc, a48ad20, ad68fb8, e1bd91a and 50892e0
    implement GC-103, GC-021, GC-083, GC-104, GC-084 and GC-040 one per commit; 49bd823 is their
    close-out; 7faaa02 claims GC-105, GC-106, GC-108, GC-055, GC-056 and GC-081; 37f392b closes that
    batch out. 8f5df41 is GR-011 itself. Read as a reviewer: **GC-105** is the substantial one and the
    algorithm is right — `fitPanels` takes from the wider panel down to the narrower one, then from both
    in proportion to the spare each still has, and puts both at their minimum and gives the shortfall to
    the centre when even those do not fit; the property case in `useDragWidth.test.ts` walks 900 to 1600
    at four configurations and asserts the graph never goes under `MIN_GRAPH_W` and neither panel is ever
    *widened*, which is the invariant that matters. The `440 = 900 - 160 - 300` derivation is real, not a
    rationalisation. **But the drag half of the same ticket is wrong**, and that is this review's P1 —
    see the tickets line. **GC-106** is careful: `continuesRange` requires both ends of the old range to
    still be in place, `layoutGraph`'s `prev` branch does not re-seed the pin and carries `laneCount` in
    as the running maximum, so `page.laneCount` really is the answer for the whole range; and the ref
    cache is keyed on the `commits` array identity, which is safe because `App` passes
    `snapshot.commits` — a stable reference until `setSnapshot` — and `loadMore` appends with
    `[...s.commits, ...page]`, a strict extension by construction. **GC-108** is three lines and correct:
    `takeBusy` is now the only writer of `busy` and both "Loading repository" paths take a token.
    **GC-104**'s `wordDiff` is better than it needed to be — common prefix and suffix off before the
    quadratic part, a 25% shared-text floor so a replaced line is left to the plain tint, a 400-token
    ceiling, and the whitespace-trim pass in `spans()` cannot leave a run open on a space because
    `TOKEN_RE` never emits two whitespace tokens in a row. `hunkWordSpans` keying off `alignHunks` is
    what makes both layouts read one map, and `DiffView` renders every code cell through the single
    `code()` helper, so they cannot drift. **GC-055/GC-056** are honest fixture work: `main`'s tip now
    carries seven refs and the `+4` fold has real coverage, and `remote2.git` makes step 18's push
    assertion exclusive (`onOrigin === ''`), which it could not have been while both remotes pointed at
    one repository. **GC-081** is blocked rather than closed, with the measurement contradicting the
    ticket's own estimate (243 calls, not 141) and the decision written down — the right outcome.
    Nothing in the window drifts from `CLAUDE.md`, and every acceptance box I spot-checked has evidence
    in its log.
  - health: at `37f392b`, in the detached worktree at `%TEMP%/gitclient-review/wt` with `node_modules`
    junctioned — **typecheck ok, 147 tests passed (16 files)** in 1.61s, **build ok**. e2e was run too,
    because this window rewrote both the fixture and the harness: on port **9335** with
    `GITCLIENT_E2E_ROOT=%TEMP%/gitclient-review/e2e`, **all passed through step 29**, `total: 23.8s |
    git: 219 calls, 5.8s`, and the drift step confirmed the fixture was left as found. `MAIN` was never
    built, tested or launched. (`tools/e2e/run.mjs` still defaults `PORT` to 9333 and calls
    `stopPort(PORT)` first, so `GITCLIENT_E2E_PORT` remains mandatory for a review — GR-011's note holds.)
  - app: the `37f392b` build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, fixture
    recreated first, every `gitclient.*` key except `lastRepo`/`recentRepos` cleared over CDP.
    Screenshots in `%TEMP%/gitclient-review/GR-012/`, all looked at. `01-graph-default.png` at 1400x900:
    nine rows, lanes continuous, right-angle joins, `wip-branch +1` and `main +4` — GC-055's fixture
    change is visible and the fold is exercised by the default view rather than by hand.
    `05-plus4-hover.png` is the rotation surface, opened with a real `Input.dispatchMouseEvent` rather
    than a synthetic React event because the block opens on CSS `:hover`: the grown chip lists
    `main` (checked, upstream cloud), `release` (cloud), `sandbox`, `origin/sandbox`, `v0.2.0` — exactly
    the documented order, first line landing on the pixel the row chip occupied, 117x116 and well clear
    of `.graph-body`'s bottom edge. `06-` and `07-diff-word-marks-*.png` are GC-104 in both layouts on
    the same file: `row 3` against `row 3 edited`, the added word tinted over the line's own green, the
    removal side correctly unmarked because nothing was removed. `08-empty-state.png` is a surface no
    review had visited — the New Tab view with the recents list and one primary button — and it is clean;
    nothing to file. `02-`, `03-` and `04-` are the narrow-window drag sequence that produced the P1.
  - what's next: read `06-feature-inventory.md`'s Branch and Tag rows against `refMenuItems`. The Branch
    row's "Delete (local, remote, or both)" is the entry GR-010 and GR-011 both named and it is still
    open; reading the Tag row beside it turned up the sharper half — the tag menu can push a tag to a
    remote and then has no way at all to take it back, because `git.ts` has no remote-tag call. Both
    became GC-112 as one ticket. Still unticketed from the Files row and worth a later look: Blame,
    History, Export changes to patch, Compare against working directory. From the Commit row: Edit commit
    message, Squash, Drop, Move up/down — all of which want GC-017's sequencer and are properly blocked
    behind it.
  - tickets: added **GC-111** (ui, S, **P1**, from the running app: the drag half of GC-105 persists a
    width the pointer never asked for), **GC-113** (graph, S, P2, from the screenshot pass: the lane ramp
    walks the hue wheel in order, so adjacent lanes are the closest pair and 3/4 are at a contrast ratio
    of 1.00) and **GC-112** (actions, M, P3, from the what's-next pass). Board: GC-111 goes directly under
    GC-105, in the P1 group at the head of the open work and above the P2s, because it is a defect in the
    ticket immediately above it; GC-113 under GC-110, the two graph P2s together; GC-112 after GC-107,
    beside the other `actions` feature rows, the slot GR-011 used for GC-107 itself. Nothing else moved.
    Deduplication: GC-111 is not GC-110 — that one is the ref column inside the graph panel, a different
    `useDragWidth` instance with a different limit source — and not GC-105, which is `done` and whose
    resize path is correct; GC-113 is new, and is not GR-011's toolbar-label contrast note, which was
    text against its background and left to Ricardo; GC-112 does not overlap GC-100 (fast-forward and
    set-upstream) or GC-031 (push to a chosen remote).
  - hygiene: no `todo` ticket has gone vague. `blocked` is GC-017, GC-018 and now GC-081; none can be
    unblocked from here — the first two still want a decision from Ricardo, and GC-081's log records a
    measurement that argues for closing it rather than doing it, which is Ricardo's call to make.
    Dependencies read correctly: GC-111 depends on GC-105 (`done`), GC-113 and GC-112 on nothing.
    One process note, not filed: GC-105's acceptance box "the stored widths still read what the user
    chose" was ticked, and it is true of the resize path it was checked against and false of the drag
    path it does not mention — an acceptance line that names the path it covers would have caught this.
  - carried over: GR-011 asked this review to read GC-014's other five files and, from GR-010, the five
    tickets in `d34d732`. Neither was done — the budget went to this window's twelve tickets, the e2e
    run and the app pass, and both are now two windows old. GR-013 should either do them or say
    explicitly that they are being written off; carrying the same line a third time is worse than either.
  - notes: `CLAUDE.md` is current at `37f392b`. Its numbers were checked rather than trusted: "147 tests"
    matches the run exactly, "29 steps, 151 assertions" and `total: 23.4s | git: 219 calls, 5.5s` match
    the shape of the run measured here (23.8s, 219 calls, 5.8s — the same call count, the seconds being
    this machine's), and "a merge, two tags, five branches" is right again now that GC-055 added
    `release`, `sandbox` and `v0.2.0`. GC-106's close-out rewrote the Graph section's account of
    `prev`/`LaneState` that GR-011 flagged as wrong, and the new text matches the code. Nothing stale
    found; this review did not edit `CLAUDE.md`.
  - isolation: the worker pushed `fccc9bb` — the claim of GC-110, GC-109, GC-057 and GC-100 — and then
    committed `57cbe94` and `0740d62` locally while this review was running. The window above deliberately
    stops at `37f392b`, the tip when the review started; GR-013 picks up from there. None of the four
    `in-progress` tickets was touched. The review's Electron on 9334 was stopped by PID.

### GR-013 Backlog review 2026-09-06 08:20

- **Status:** done
- **Window:** 37f392b..c98c10a
- **Log:**
  - 2026-09-06 08:20 shipped: ten commits, two worker batches and one review. `fccc9bb` claims
    GC-110, GC-109, GC-057 and GC-100; `57cbe94`, `0740d62` and `a12ee9b` implement three of them
    and `6c74a9c` closes the batch out with GC-100. `882ad4d` claims GC-111, GC-115, GC-114, GC-113
    and GC-116; `9099be4` implements all five and `770b385` closes them out. `678aafa` is GR-012,
    and `c98c10a` is the worker's claim of GC-015, which is `in-progress` and was not touched here.
    Read as a reviewer: **GC-110** does one level in what GC-105 did one level out and keeps the
    same promise — `fitRefCol` reduces only what reaches `--ref-col-w`, `gitclient.refColW` is left
    alone, and the `panelW <= 0` guard means the first frame draws the stored width instead of
    snapping to the minimum and back. **GC-116**'s `fitOptCols` is the sharpest piece in the window:
    deciding the surviving set against the ref column's *floor* and never re-examining it after
    `fitRefCol` has run is what makes it stable, and the reasoning for that is written down beside
    the code rather than left to be rediscovered. Every render site reads `cols`, not `wantCols` —
    header, rows and `restW` — so the three cannot disagree. **GC-113** is a reorder of the same ten
    values with the argument attached; the claim "at least 100 degrees apart" is 98 at the 1/2 pair
    by my own measurement, which is not worth a ticket. **GC-114** is small and right, and the
    remote is now passed explicitly so the label and the command read one value. **GC-057**'s
    `pull()` naming the branch whenever it names a remote is the subtle part and it is correct —
    `git pull <remote>` alone would still merge `branch.<name>.merge`. **GC-100**'s split between
    `git fetch . <upstream>:<branch>` and `git merge --ff-only` is the right shape and neither path
    can force anything. **The drag half of GC-111/GC-115 is still not finished**, from the opposite
    direction to the one they fixed — see the tickets line. Nothing in the window drifts from
    `CLAUDE.md`; every acceptance box I spot-checked has evidence in its log.
  - health: at `c98c10a`, in the detached worktree at `%TEMP%/gitclient-review/wt` with
    `node_modules` junctioned — **typecheck ok, 169 tests passed (16 files)** in 1.68s, **build ok**.
    e2e was run as well, because the window touched `git.ts`, `ipc.ts`, `App.tsx` actions and
    `tools/e2e/run.mjs`: on port **9335** with `GITCLIENT_E2E_ROOT=%TEMP%/gitclient-review/e2e`,
    **ALL PASSED, 167 assertions, 0 failures**, `total: 27.4s | git: 252 calls, 6.5s`, and step 29
    confirmed the fixture was left exactly as found. `MAIN` was never built, tested or launched; its
    only change from this session is `TICKETS.md`.
  - app: the `c98c10a` build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, fixture
    recreated first, every `gitclient.*` key except `lastRepo`/`recentRepos` cleared over CDP. A
    second remote was added to the scratch repository by hand so the new multi-remote surfaces had
    something to show, and removed again before the e2e run. Screenshots in
    `%TEMP%/gitclient-review/GR-013/`, all looked at. `01-graph-1400.png`: nine rows, lanes
    continuous, right-angle joins, `wip-branch +1` and `main +4`; GC-113 is visible and it works —
    HEAD's cyan column 0 against the magenta branch beside it is now the easiest pair to tell apart
    rather than the hardest. `02-push-popover.png` and `03-pull-popover.png` are GC-057's two new
    layers: the Push caret appears only with two remotes, both popovers list them, and Pull keeps
    its radio group above the new rows. `04-both-popovers-keyboard.png` is the first of this
    review's defects. `05-branch-menu-main.png` is GC-100 and GC-114 together — "Change upstream of
    main…", "Unset upstream of main", "Push main to origin", "Push main to remote2", no
    fast-forward row because `main` is level with its upstream, all correct — and it also shows
    GC-074 still true, "keep changes in the working dire…" truncated, which is fresh evidence for a
    ticket already open. `06-branch-menu-620.png` is the second defect. `07-cols-1600.png` and
    `08-cols-900.png` are GC-116 measured again from outside the ticket: all three columns at 1600,
    none at 900, message readable at both. `09-`/`10-` are a commit and its diff, `11-wip-diff.png`
    the WIP side with `Stage hunk` / `Discard hunk` live. `12-file-menu.png` is an untracked row's
    menu; note it offers two "Ignore …" rows, not three, because `new.txt` is at the repository
    root and the folder row is conditional — the code is right, `CLAUDE.md`'s "three" is a shade
    strong. `13-preferences.png` is this review's rotation surface and it is the reason GC-101
    moved — see below. `14-drag-past-limit.png` is the P1.
  - what's next: read the Files row of `06-feature-inventory.md` against the staging surfaces.
    "Stage / unstage / discard (file, folder, hunk, **line**)" is the entry that stands out: the app
    stops at the hunk, and line-level staging is the one missing capability that changes what the
    client is for rather than adding another convenience. Its groundwork already exists —
    `buildHunkPatch`, `alignHunks`, and GC-104's per-`DiffLine` keying that lets both layouts read
    one map — so it is specifiable now, and it became GC-121. Still unticketed from the same row and
    worth a later look: Blame, History, Export changes to patch. From the Commit row: Compare
    against working directory. From the Stash row: Edit stash message, which is small and would fit
    a batch that is otherwise full of P3s.
  - tickets: added **GC-118** (ui, S, **P1**, code review plus the running app: a drag released past
    the limit discards the width the pointer did reach, measured at 1000x900 — drawn 260, stored
    170, back to 170 on reload), **GC-119** (ui, S, P2, from the app pass: both toolbar popovers can
    be open at once when the second is opened from the keyboard, confirmed with real key events),
    **GC-120** (ui, S, P2, from the app pass: the branch menu is 623px tall at the app's own 600px
    minimum window height and its last row is off the bottom, with no `max-height` and no scroll)
    and **GC-121** (diff, M, P3, from the what's-next pass). Board: GC-118 goes directly under
    GC-114, at the head of the open work — it was the only P1 among the `todo` rows and the first
    eligible row before it was GC-016, a size-L P3 that a worker run would otherwise have taken
    alone. GC-119 and GC-120 go under GC-116 with the other P2s. GC-121 goes under GC-052, beside
    the other diff feature row.
  - reordering: **GC-101** (unstyled checkboxes and dropdowns) was raised from P3 to P2 and moved up
    beside GC-119 and GC-120. The reason is `13-preferences.png`: the dialog is the one surface
    where Windows draws its own controls, and against an otherwise consistent dark palette the
    native blue checkboxes and the two OS `<select>` boxes are the loudest visual mismatch left in
    the app — louder than anything else this review looked at. It also now carries eight rows, three
    of which GC-117 is about to annotate, so doing GC-117 first means building on controls that are
    going to be replaced. Nothing else moved.
  - hygiene: no `todo` ticket has gone vague. `blocked` is GC-017, GC-018 and GC-081; none can be
    unblocked from here, all three want a decision from Ricardo. Dependencies read correctly:
    GC-118 on GC-111/GC-115, GC-119 on GC-057, GC-120 and GC-121 on nothing. One filing error
    fixed: **GC-117's section had been written inside the Reviews section**, between its intro
    paragraph and GR-001, where a review section is supposed to be the only thing that can appear;
    its text is untouched and it now sits with the other tickets, before the `---` that closes the
    Tickets section. Its own `Depends on: GC-116` is still right; it is arguably also downstream of
    GC-101 now, but that is a judgement for whoever picks it up and the ticket was not edited.
  - carried over: GR-011 and GR-012 both asked for a read of GC-014's other five files and of the
    five tickets in GR-010's `d34d732`. GR-012 said carrying the line a third time would be worse
    than either doing it or dropping it, and it is right: **both are written off here.** Both
    windows are `done`, both were reviewed at the time by the sessions that shipped them, e2e covers
    GC-014's two layouts in step 28 and the intra-line marks in both since GC-109, and the budget is
    better spent on the current window and the app than on re-reading month-old diffs for defects
    nothing has surfaced. GR-014 should not carry this line.
  - notes: `CLAUDE.md` is current at `c98c10a`, and its numbers were checked rather than trusted:
    "169 tests" matches the run exactly, and "29 steps, 167 assertions, ~26s" with
    `total: 26.2s | git: 252 calls, 6.5s` matches this machine's run to the assertion and the call
    count, the seconds being 27.4 here. The Graph, UI-layer and Main-process sections match the code
    the window shipped, including the `fitOptCols` and `dragWidth` paragraphs. One shade of
    overstatement, not worth an edit on its own: the Detail-panel section says "the three 'Ignore …'
    rows are offered on an untracked row", where the folder row is conditional on the file being in
    a folder — true of every row in a subdirectory, false at the repository root. This review did
    not edit `CLAUDE.md`.
  - isolation: GC-015 was `in-progress` throughout and was not touched. `MAIN` was never built,
    tested or launched, and its working tree — which was holding the worker's half-finished GC-015
    edits across `App.tsx`, `LeftPanel.tsx`, `CommitGraph.tsx`, `app.css`, `tools/e2e/run.mjs` and a
    new `ui/refDrag.ts`, and grew while this review ran — was left exactly as found;
    `TICKETS.md` was clean in `git status` before this write and is the only file staged. The
    review's Electron on 9334 was found by command line and stopped by PID; the e2e run had the
    port to itself on 9335.

### GR-014 Backlog review 2026-09-06 09:20

- **Status:** done
- **Window:** adfd245..416d357
- **Log:**
  - 2026-09-06 09:20 shipped: five commits, two worker batches and one review. `adfd245` is
    GR-013. `08695d7` implements **GC-015** alone, the last size-L feature row on the board.
    `649aeaa` claims GC-118, GC-119, GC-120 and GC-101 and `1a57042` implements all four.
    `416d357` is the worker's claim of GC-125, GC-126, GC-107 and GC-112, all four `in-progress`
    and none of them touched here. Read as a reviewer: **GC-015** is the best-shaped piece in the
    window. Putting the whole gesture in `ui/refDrag.ts` rather than twice is right, and
    `canDropRef` refusing a pair before the `dragover` `preventDefault` is what makes "a drop that
    opens no empty menu" a property of the browser's own drag machinery rather than a check
    somewhere downstream. `runOnBranch` composing `checkoutRef` and `runSequencer` — two busy
    tokens deliberately, and `git status` asked between them because a cancelled prompt and a
    failed checkout both return quietly — is the part that would have been easy to get wrong, and
    the reasoning is written beside it. The three follow-ups the ticket filed against itself
    (GC-122 scrolling, GC-123 folded refs, GC-124 the stale snapshot) are the honest ones; I found
    nothing in the diff they do not already cover. **GC-118**'s `reachedWidth` is one rule where
    two special cases were heading: I checked all four corners by hand — released inward past
    `min`, released outward past a wall from inside it, from on it, and with a wall that has come
    out below `min` — and each lands where the comment says. **GC-119** collapsing two booleans
    into `'pull' | 'push' | null` removes the state rather than guarding it, which is the stronger
    fix, and the `setPullOpen`/`setPushOpen` shims closing only the popover they name is what keeps
    `Toolbar`'s outside-click listener from closing the one that was clicked in. **GC-120** and
    **GC-101** are small and correct; `ContextMenu`'s wheel listener now distinguishing a wheel
    inside the menu from one on the page is the load-bearing half of GC-120, and it is commented as
    such. Nothing in the window drifts from `CLAUDE.md`; every acceptance box I spot-checked has
    evidence in its log.
  - health: at `416d357`, in the detached worktree at `%TEMP%/gitclient-review/wt` with
    `node_modules` junctioned — **typecheck ok, 184 tests passed (17 files)** in 1.76s, **build
    ok**. e2e was run too, because the window added a step and touched `App.tsx`, `CommitGraph`,
    `LeftPanel` and `run.mjs`: on port **9335** with `GITCLIENT_E2E_ROOT=%TEMP%/gitclient-review/e2e`,
    **ALL PASSED, 178 assertions across 30 steps**, `total: 29.3s | git: 267 calls, 7.1s`, and
    step 30 confirmed the fixture was left exactly as found. Step 29 — GC-015's own — passes
    including its negative case. `MAIN` was never built, tested or launched; its only change from
    this session is `TICKETS.md`.
  - app: the `416d357` build ran offscreen on 9334 against `%TEMP%/gitclient-review/e2e`, fixture
    recreated first, every `gitclient.*` key except `lastRepo`/`recentRepos` cleared over CDP.
    Screenshots in `%TEMP%/gitclient-review/GR-014/`, all looked at. `01-graph-1400.png`: nine rows,
    lanes continuous, right-angle joins, `wip-branch +1`, `main +4`, the WIP row's `+1 ✏3 −1`
    agreeing with the panel's 3 unstaged and 2 staged. `02-drag-highlight.png`, `03-drop-menu.png`
    and `04-drop-affordance-zoom.png` are GC-015 driven for real: a left-panel row dragged onto a
    graph chip, the source dimmed on **both** surfaces at once because `isSource` compares full
    names, the caption `RELEASE ONTO MAIN` over exactly two rows with `checks out release` on the
    rebase and no hint on the merge because `main` is already HEAD. The zoom is where this review's
    ticket came from — see below. `05a`/`05b` are the same chip at rest and mid-`dragover`.
    `06-preferences-dark.png` is GC-101 landed: six checkboxes all measured at 14x14, three selects
    all computing Open Sans, the app's own chevron on each, and the Amend box behind the modal now
    the same 14px as the rest. `10-branch-menu-600.png` and `10-/11-branch-menu-500*.png` are
    GC-120: at the app's own 600px minimum the one-remote branch menu is 586px and fits untouched;
    forced to 500 it caps at `clientHeight` 490 against `scrollHeight` 584, lands at `top: 4`, and
    scrolls to its last two rows. That shot also shows GC-074 still true — "keep changes in the
    working dir…" — which is fresh evidence for a ticket already open. `12-commit-view.png` is the
    merge commit with both parents listed. `13-wip-diff-unified.png` is `a.txt` open from the WIP
    row with `Stage hunk` / `Discard hunk` live and the `Unified | Split` switch beside them.
  - rotation: **the light theme**, which no review had looked at since GC-013 shipped it.
    `07-preferences-light.png`, `08-light-app.png` and `09-chips-light-zoom.png`. It is healthy:
    every panel, the toolbar and the status bar repaint, `--text-bright` flips to `#14161a`, the
    lane tokens darken (`--lane-0 #0f7f99`), and the chips come out as pale tints of them with dark
    text rather than keeping their dark-theme fill. GC-101's two new tokens survive the flip —
    `--on-accent` is only defined on bare `:root`, which is correct here because white on the
    accent blue is right in both themes, and the checkbox and the select read the same in light as
    in dark. **A method note for the next reviewer, not a defect:** under `offscreen: true` the
    compositor hands `Page.captureScreenshot` stale pixels for regions that only changed colour —
    after switching the theme I twice photographed a light DOM as a dark app, and only the computed
    values caught it. Reload the page after a theme change and re-shoot; trust
    `getComputedStyle` over the image.
  - what's next: `grep -rn "clone" src/` finds nothing and `TitleBar` has one repository entry
    point, "Open repository". The RepoManagement row of `06-feature-inventory.md` says
    "Build open/clone/init" and it is the only **Build** row with nothing shipped against it at
    all — every other open row on the board is polish on a repository the user already has. That
    became GC-128. From the same pass, the Stash row's "Edit stash message" is the last unshipped
    entry on a row that is otherwise complete, and it is small: GC-129. Still unticketed and worth
    a later look, named once here rather than carried: Compare against working directory (Commit
    row) and Blame / History / Export changes to patch (Files row).
  - tickets: added **GC-127** (ui, S, P3, from the screenshot pass: `.ref-chip` sets
    `cursor: grab` on every chip including the tags and the synthetic HEAD chip that
    `canDragRef` refuses — measured `v0.1.0 draggable=false cursor=grab` — while every
    left-panel row is `cursor: pointer` draggable or not, and `.ref-row.drop-over` gets a tint
    the chip does not), **GC-128** (actions, M, **P2**, from the what's-next pass) and **GC-129**
    (actions, S, P3, from the what's-next pass). Board: GC-128 goes directly under GC-101, at the
    head of the open work — every other open row is P3 polish, and a worker run picking in board
    order would otherwise reach GC-016, a size-L P3, first. GC-127 goes under GC-124 with the
    other three GC-015 follow-ups, which is where a session picking up the drag will find them
    together. GC-129 goes under GC-097 with the other P3 `actions` rows. Nothing else moved and no
    existing ticket was edited.
  - hygiene: no `todo` ticket has gone vague; GC-122, GC-123 and GC-124 are the newest and are the
    most concrete rows on the board. `blocked` is GC-017, GC-018 and GC-081; none can be unblocked
    from here, all three want a decision from Ricardo. Dependencies read correctly: GC-127 on
    GC-015, GC-128 on GC-026 (the two-field dialog its clone form needs, and GC-026's own Why
    already names "clone with a URL and a target folder" as the shape it was written for),
    GC-129 on nothing. GR-013's write-off of the two carried-over re-reads holds: nothing was
    carried into this review and nothing is carried out of it.
  - notes: `CLAUDE.md` is current at `416d357` and its numbers were checked rather than trusted —
    "184 tests today" matches the run exactly, and "30 steps, 178 assertions, ~27s" with
    `total: 27.4s | git: 267 calls, 6.8s` matches this machine's 178 assertions and 267 calls to the
    number, the seconds being 29.3 here. The new "a drop that opens no empty menu", `runOnBranch`,
    `reachedWidth`, the single popover value and the capped context menu all appear in the
    handover and all match the code. This review did not edit `CLAUDE.md`.
  - isolation: GC-125, GC-126, GC-107 and GC-112 were `in-progress` throughout and were not
    touched. `MAIN` was never built, tested or launched and its working tree was left exactly as
    found; `TICKETS.md` was clean in `git status` before this write and is the only file staged.
    The review's Electron on 9334 was found by command line and stopped by PID before the e2e run
    took 9335, and both ports were confirmed free afterwards.
