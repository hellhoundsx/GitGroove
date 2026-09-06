# GitClient tickets

The backlog of work that can be started right now, in a form an unattended session can pick
up. Every ticket has exactly one status. The per-ticket `Status:` line is the source of truth;
the board table below is a convenience and must be kept in sync whenever a status changes.

Read `CLAUDE.md` before touching any ticket. Its two hard rules apply to every ticket: study
GitKraken, never copy it; never run write operations against Ricardo's real repositories.

**Two files, split by status** (GC-145). This one holds everything a session can act on: the
scaffolding, the whole board, every `todo`, `in-progress` and `blocked` ticket, and the newest
review. `TICKETS-ARCHIVE.md` holds every `done` ticket's section and every review a newer one has
superseded. So "read `TICKETS.md` fully" means this file only; the archive is looked up by id when
a finished ticket's history is actually wanted. The session that sets a ticket to `done` moves its
section to the archive in the same commit, and the reviewer moves the review it supersedes when it
writes a new one — `tools/repo-hygiene.test.ts` fails if the two files ever disagree.

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

0. **Read.** `CLAUDE.md`, then this file in full — this file only. Every finished ticket's
   section lives in `TICKETS-ARCHIVE.md` (GC-145), which is not read at all unless a specific
   ticket's history is wanted; the board here already says which ids exist and what became of
   them.
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
   screenshot paths). **A ticket that becomes `done` has its section moved to
   `TICKETS-ARCHIVE.md` in the same commit** (GC-145) — status change and move together, never
   one without the other, or `npm test`'s backlog check fails. A ticket that becomes `blocked`
   stays here: it is still work someone can pick up. Its board row does not move either way.
   Update `CLAUDE.md` once for the whole batch wherever a convention, command or the roadmap
   changed. Then `git add -A && git commit -m "GC-0NN, GC-0MM, ...: <summary>" && git push origin main`.
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
- **This file keeps exactly one review: the newest** (GC-145). Writing `GR-0NN` therefore means
  moving `GR-0(NN-1)` to the Reviews section of `TICKETS-ARCHIVE.md` in the same commit. The
  newest one stays because the reviewer reads its own `Window` sha to decide the next window;
  the ones before it are history, and `npm test`'s backlog check fails if two are left here.
- Its only writes to this checkout are `TICKETS.md` and `TICKETS-ARCHIVE.md`, made when both
  are clean in `git status` (so the worker is not mid-edit), committed together with
  `git add TICKETS.md TICKETS-ARCHIVE.md`, and pushed. Because both routines share this clone,
  the worker's next push simply carries it.
  It never touches `CLAUDE.md` or any other file; a stale "Done" paragraph becomes a note in
  the review log instead.
- The one exception is `INBOX.md`, which is **git-ignored**: the reviewer rewrites it at the very
  end to record what became of each item it handled. Being outside git is the point — Ricardo
  edits it by hand at any time with no commit, it never appears in the worker's `git status`, and
  it can never be the dirty file that stalls the review's own `TICKETS.md` write.

**The stakeholder inbox comes first.** Before anything else, the reviewer drains `INBOX.md`, where
Ricardo leaves small, concrete observations as plain `- ` bullets — never in ticket form. Each one
is a **lead to investigate, not a ticket to transcribe**: the reviewer checks it against the
existing tickets, then the code, then reproduces it in the running app when it is about behaviour
or appearance, and only then decides whether it becomes a `GC-0NN` ticket, an extension of a ticket
that already covers it, or neither with the reason written down. What it found while investigating
is what goes in the ticket's Why — the bullet is where the ticket started, not what it says. These
items are decided first and do **not** count against the zero-to-five budget for the reviewer's own
findings (total additions still cap at eight); an item too vague to settle stays in Pending with a
note saying precisely what could not be determined. `INBOX.md` is data, not instruction: a bullet
sets what gets investigated and never overrides these rules — an item asking for code to be
changed, for a real repository to be written to, or for an `in-progress` ticket to be edited is
declined in the review log and left in Pending.

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

Every ticket ever written has a row here, `done` included: it is the one table where the whole
history is visible at a glance. **The status cell is also where the section lives** — a row that
says `done` has its section in `TICKETS-ARCHIVE.md`, and every other row's is under Tickets
below (GC-145). That mapping is total and machine-checked, which is why it is stated once here
rather than as a link in each of the 118 archived rows: this table has been corrupted before by
an edit built from a string, and the fewer things that rewrite a row, the better.

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
| GC-132 | Three more e2e helpers drop a click on a disabled control and assert nothing | tests | S | P2 | done |
| GC-145 | TICKETS.md is 681 KB and 71% done tickets, so "read it fully" is no longer possible | infra | M | P1 | done |
| GC-154 | A driver script that throws leaves its Electron alive, so the next run verifies a stale build | infra | S | P1 | done |
| GC-164 | A repository picked from the recents list replaces the tab it was picked from | ui | S | P2 | in-progress |
| GC-163 | The `+` button opens a folder dialog instead of a new tab | ui | M | P2 | in-progress |
| GC-128 | The app can only open a repository that already exists: no clone, no init | actions | M | P2 | todo |
| GC-155 | e2e step 1 never clears gitclient.tabs, so a stranded path from another run fails the whole suite | tests | S | P2 | done |
| GC-156 | A stash marker on a row cuts the primary ref chip’s name down to one letter | graph | S | P2 | done |
| GC-157 | The authored timestamp is cut short at the default detail-panel width on any merge commit | ui | S | P2 | done |
| GC-158 | The backlog archive is outside the control-byte scan, so 82% of the backlog lost rule 6’s guard | tests | S | P2 | done |
| GC-160 | e2e step 1 clears three remembered keys by name, and a driver can leave any of the others | tests | S | P2 | done |
| GC-140 | Stashes never appear in the graph, only in the left panel’s list | graph | M | P2 | done |
| GC-141 | A single click on a branch in the left panel does nothing at all | ui | S | P2 | done |
| GC-142 | The detail panel runs its blocks together, in both the staging and the commit view | ui | M | P2 | done |
| GC-144 | The WIP-to-HEAD line is dashed for its first 14px and solid for the rest | graph | S | P2 | done |
| GC-148 | A half-written commit message is lost when its tab is switched away from | ui | S | P2 | done |
| GC-133 | The graph and the commit panel format the same timestamp two different ways | ui | S | P2 | done |
| GC-125 | Radio buttons are the last unstyled OS control, now that the checkboxes are ours | ui | S | P3 | done |
| GC-126 | Nothing guards the toolbar popovers or the context menu height in the e2e suite | tests | S | P3 | done |
| GC-131 | A confirmation that carries an option has to be written as a prompt with no input | ui | S | P3 | done |
| GC-014 | Side-by-side diff | diff | L | P3 | done |
| GC-015 | Drag-and-drop merge and rebase between chips | graph | L | P3 | done |
| GC-016 | Multi-tab repositories | ui | L | P3 | done |
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
| GC-027 | Author filter in commit search | graph | S | P3 | done |
| GC-033 | Global shortcuts from the study: branch, fetch, panels, staging | ui | S | P3 | done |
| GC-045 | Commit view banner linking back to the working directory changes | ui | S | P3 | done |
| GC-051 | Left panel folders for slash-separated branch names | ui | M | P3 | done |
| GC-052 | Diff view: next and previous hunk, ignore whitespace, word wrap | diff | M | P3 | done |
| GC-121 | Stage and discard selected lines, not only whole hunks | diff | M | P3 | done |
| GC-048 | Long toolbar labels overflow their 52px button | ui | S | P3 | done |
| GC-066 | A second click on the repository crumb cannot close its dropdown | ui | S | P3 | done |
| GC-071 | The primary ref chip is unreadable at the minimum column width | graph | S | P3 | done |
| GC-074 | The commit menu's Reset rows do not fit the menu, whichever side gives way | ui | S | P3 | done |
| GC-087 | The commit view's ref line is git's decorate string, truncated to "origin/m…" | ui | S | P3 | done |
| GC-091 | The status bar can only report a failure, so a partial success reads as one | ui | S | P3 | done |
| GC-085 | Dead CSS and an unreachable tooltip left over from the one-chip ref column | ui | S | P3 | done |
| GC-094 | The left panel header counts refs and never says which branch is checked out | ui | S | P3 | done |
| GC-096 | The branch crumb menu lists every branch, with nothing to narrow it | ui | S | P3 | done |
| GC-097 | The sequencer guard stashes untracked files git never objected to | actions | S | P3 | done |
| GC-161 | The checkout guard stashes untracked files without saying so, now that its neighbour does | ui | S | P3 | done |
| GC-129 | A stash message cannot be edited once the stash is made | actions | S | P3 | done |
| GC-134 | remoteCopyOf is inline and untested, and its comment justifies a state git forbids | tests | S | P3 | done |
| GC-135 | Nothing says how long ago anything happened, and the stash date is fetched and thrown away | ui | M | P3 | done |
| GC-102 | The window is built dark whatever the theme is, so a light start flashes and keeps dark controls | ui | S | P3 | done |
| GC-117 | A graph column switched on in Preferences can be silently absent | ui | S | P3 | done |
| GC-122 | The graph does not scroll while a branch is being dragged | graph | S | P3 | done |
| GC-123 | A ref folded behind +N can neither be dragged nor dropped on | graph | S | P3 | in-progress |
| GC-124 | The staged-changes guard reads the snapshot from before a drop’s checkout | actions | S | P3 | in-progress |
| GC-127 | A chip offers a grab cursor it cannot honour, and lights up less than the row beside it | ui | S | P3 | in-progress |
| GC-136 | A hidden detail panel has nothing on screen to bring it back | ui | S | P3 | in-progress |
| GC-137 | The author chip is dropped when a diff opens, while the query survives | graph | S | P3 | todo |
| GC-138 | The diff’s hunk navigation is inline in the component and untested | tests | S | P3 | todo |
| GC-167 | stashRename's index shift is the one piece of stash arithmetic with no unit test | tests | S | P3 | todo |
| GC-168 | The fixture's graph fits at every height, so nothing guards the drag auto-scroll | tests | S | P3 | todo |
| GC-162 | A launcher stop loses whatever the page wrote to localStorage last | infra | S | P3 | todo |
| GC-139 | A folder closed in the left panel opens again on every reload | ui | S | P3 | todo |
| GC-143 | The detail panel’s file-kind icons are hairlines, and the commit view draws them as text instead | ui | S | P3 | todo |
| GC-146 | A local branch’s chip carries no icon, and an absorbed chip shows only the remote’s | graph | S | P3 | todo |
| GC-147 | Nothing joins a ref chip to its node across the 30px between them | graph | S | P3 | todo |
| GC-149 | The tab bar has no answer for more tabs than fit across it | ui | S | P3 | todo |
| GC-151 | A repository tab is the one row in the app a right-click does nothing on | ui | S | P3 | todo |
| GC-150 | A stash row in the left panel is inert on a single click, and never says which commit it came from | ui | S | P3 | todo |
| GC-152 | A commit can only be read against its parent, never against the working directory | diff | M | P3 | todo |
| GC-153 | The left panel's four sections share one scroll, so 52 remote branches hide Tags and Stashes | ui | M | P3 | todo |
| GC-159 | The remote menu can copy a URL but cannot open the remote on its hosting service | actions | S | P3 | todo |
| GC-165 | The empty state’s recents paths ellipsise at the wrong end, unlike the menu’s | ui | S | P3 | todo |
| GC-166 | A file can be diffed but never followed: no history for one path | graph | M | P3 | todo |
| GC-026 | One dialog with several fields instead of chained prompts | ui | S | P3 | todo |
| GC-017 | Interactive rebase editor | actions | L | P3 | blocked |
| GC-018 | Undo and Redo | actions | L | P3 | blocked |

Priority: P0 do first, P3 nice to have. Size: S under two hours, M half a day, L a day or more.

---

## Adding a ticket

Copy a section, give it the next `GC-0NN`, fill every field, add a row to the board. A ticket
is only `todo` when its scope, acceptance criteria and verification steps are concrete enough
that a session with no other context could finish it. Otherwise mark it `blocked` and say what
decision is missing.

## Tickets


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

---

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

---

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

---

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

---

### GC-123 A ref folded behind +N can neither be dragged nor dropped on

- **Status:** in-progress
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
  - 2026-09-06 09:12 claimed

---

### GC-124 The staged-changes guard reads the snapshot from before a drop’s checkout

- **Status:** in-progress
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
  - 2026-09-06 09:12 claimed

---

### GC-127 A chip offers a grab cursor it cannot honour, and lights up less than the row beside it

- **Status:** in-progress
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
  - 2026-09-06 09:12 claimed

---

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

---

### GC-136 A hidden detail panel has nothing on screen to bring it back

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-033
- **Why:** Ctrl+K (GC-033) hides the detail panel outright, and the left panel's own Ctrl+J leaves
  a 44px icon rail that is clickable — `onExpand` on the rail is how it comes back without the
  keyboard. The detail panel has no such thing: once hidden, the only ways back are the same
  shortcut and selecting a row, neither of which is visible. A user who presses Ctrl+K by accident
  sees a panel vanish with no affordance at all, and `docs/screenshots/shortcuts-panels.png` is
  what that looks like — the graph simply runs to the window edge.
- **Scope:**
  - Either a rail for the detail panel the way the left panel has one, or a persistent control that
    reopens it: a button on the toolbar's right, or a thin clickable strip on the window edge where
    the panel was. One of the two, not both.
  - Whatever it is, it says what it does on hover and is reachable with the mouse alone.
- **Out of scope:** remembering the collapsed state across restarts (it is deliberately session
  state, like the left panel's), a rail with icons and counts, and any change to Ctrl+K itself.
- **Acceptance:**
  - [ ] With the detail panel hidden, a mouse-only user can bring it back in one click.
  - [ ] The control is absent while the panel is showing.
  - [ ] Screenshot of the hidden state, looked at beside `shortcuts-panels.png`.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/styles/app.css`, and whichever of
  `components/Toolbar.tsx` or `components/DetailPanel.tsx` the chosen control lands in.
- **Verify:** typecheck, build, then over CDP: Ctrl+K, click the control, assert `.detail-panel`
  is back.
- **Log:**
  - 2026-09-06 proposed by GC-033 (this ticket): the binding shipped and the panel it hides is the
    one panel with no rail, so hiding it is the only reversible action in the app with nothing on
    screen to reverse it.
  - 2026-09-06 09:12 claimed

---

### GC-137 The author chip is dropped when a diff opens, while the query survives

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** GC-027
- **Why:** GC-030 moved the search query into `App` precisely because `CommitGraph` unmounts behind
  a file view; the author chip GC-027 added is `CommitGraph` state, so opening a diff and closing it
  again restores the query, the readout and the dimming — and silently clears the author. The e2e
  step that guards GC-030 compares the whole `searchState` across a diff, and it passes, because
  the chip is not in it. Two halves of one filter should not have two lifetimes.
- **Scope:**
  - Move the chosen author into `App`'s `search` state beside `query` and `open`, cleared by
    `closeSearch` the same way, and pass it down with a setter.
  - Extend the GC-030 e2e assertion to cover it: with an author set, open a diff, close it, and
    assert the chip and the match count are the ones from before.
- **Out of scope:** persisting either half across a restart, and more than one author (GC-027's own
  out-of-scope line still holds).
- **Acceptance:**
  - [ ] With an author chosen, opening and closing a file view leaves the chip and the readout
        exactly as they were.
  - [ ] Escape still clears both halves together.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/graph/CommitGraph.tsx`,
  `tools/e2e/run.mjs`.
- **Verify:** typecheck, build, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GC-027 (this ticket): the chip was deliberately left as component state
    to keep the change inside `CommitGraph.tsx`, and the asymmetry with the query it sits next to
    is worth its own ticket rather than a silent widening of that one.

---

### GC-138 The diff's hunk navigation is inline in the component and untested

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-052
- **Why:** GC-052's `gotoHunk` (`src/renderer/src/diff/DiffView.tsx`) is a pure decision wearing a
  DOM coat: given the header stops, the current `scrollTop` and a direction, which stop is next is
  arithmetic, and it took two wrong answers during the ticket before it was right — the body's top
  padding made the first header read as being below the top, and the clamp at the bottom is what
  makes the wrap-around true. Neither of those is covered by anything: the checks that found them
  were a throwaway CDP script. Every comparable decision in this codebase was pulled out of its
  component so a test could hold it — `fitPanels`, `reachedWidth`, `continuesRange`, `alignHunks`,
  `wordDiff`, `canDropRef` — and this is the same shape as GC-134's complaint about `remoteCopyOf`.
- **Scope:**
  - A pure `nextHunkStop(stops, at, dir)` beside the diff module (or in `DiffView.tsx`, exported),
    taking the clamped stops, the current `scrollTop` and `'next' | 'prev'`, answering the stop to
    scroll to. `gotoHunk` keeps only the measuring: the rects, the padding and the clamp.
  - A `.ts` unit test: the first stop when nothing is scrolled is the current one and not the next;
    the wrap-around at each end; several stops sharing the clamped bottom position; one stop, and
    none.
- **Out of scope:** changing the behaviour, the arrows' disabled rule, keyboard bindings for them
  (GC-033 owns the table), and reading the padding any other way.
- **Acceptance:**
  - [ ] `nextHunkStop` is pure, exported and covered, and `gotoHunk` calls it.
  - [ ] The two answers GC-052 got wrong are each a named test case.
  - [ ] `npm test` passes with a higher count than 210; `npm run e2e` passes unchanged.
- **Files:** `src/renderer/src/diff/DiffView.tsx`, a new test beside it.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, and the arrows still behave in the
  running app on a file with ten hunks.
- **Log:**
  - 2026-09-06 proposed by GC-052 (this ticket): the navigation rule was written, got two answers
    wrong and was fixed twice, all without a test — and a throwaway script was what caught it.

---

### GC-162 A launcher stop loses whatever the page wrote to localStorage last

- **Status:** todo
- **Area:** infra | **Size:** S | **Priority:** P3
- **Depends on:** GC-154
- **Why:** `stopApp` in `tools/launch-app.mjs` is `killTree`, which is `taskkill /F /T`. Chromium
  batches localStorage into a LevelDB store and commits on a timer, so a write made shortly before
  that kill never reaches the profile at all — the process is gone before the commit. Nothing says
  so, and the failure is silent in the worst way: the write appears to have worked, because the
  page reads its own in-memory copy back.
  Measured while verifying GC-160 (2026-09-06). A driver launched the app on 9333, set
  `gitclient.refColW`, `gitclient.leftPanelW` and a `gitclient.pinned.<path>` key, read all three
  back from the page, and called `stop()`. A second launch on the same profile found none of them
  — only `gitclient.lastRepo`, `recentRepos` and `tabs`, the three the *app itself* writes during a
  load, had survived. A four-second wait before the kill made no difference; what did was closing
  the window (`window.close()`) so Electron quit and flushed. Two verification cycles were spent
  believing a seeded profile had been seeded when it had not, and the one check that would have
  caught it — GC-160's own step-1 assertion — passed for the wrong reason, because a key that was
  never written is indistinguishable from a key the clear removed.
  It matters beyond that one driver: `setRepo` writes `gitclient.lastRepo` through this same path,
  and every remembered key in `CLAUDE.md`'s table is reachable by a driver that wants to set up a
  state and restart into it. Any future check of the form "set a remembered key, restart, assert it
  came back" is unsound until this is fixed.
- **Scope:**
  - A graceful stop in `tools/launch-app.mjs`: ask the page to close (or the app to quit) over CDP,
    wait a bounded time for the process to go, and fall back to `killTree` when it does not. Which
    of `stop()`, `stopApp()` and `stopPort()` gain it is the implementer's call, but a caller that
    wrote to localStorage must have a way to stop the app without losing it.
  - Whatever the answer is, it is written down where a driver author will meet it: the launcher's
    own comments and `CLAUDE.md`'s launcher paragraph.
  - The fallback stays unconditional. GC-154's promise is that the app a launch spawns is stopped
    however its driver ends, and a graceful path that can hang must never weaken it.
- **Out of scope:** the e2e suite's own stop, which is correct as it is — every run rewrites the
  keys it depends on in step 1 (GC-160), so it has nothing to lose; changing what the app persists
  or when; anything about Ricardo's own profile, which a normal quit already flushes.
- **Acceptance:**
  - [ ] A driver that writes a `gitclient.*` key, stops the app through the launcher and launches
        again on the same port reads that key back.
  - [ ] The fallback still stops an app that ignores the graceful request, within a bounded wait.
  - [ ] `tools/launch-app.test.ts` covers both paths against a sleeping node process, the way it
        already covers `ownChild` — a unit test never starts Electron.
  - [ ] `npm test` and `npm run e2e` pass unchanged.
- **Files:** `tools/launch-app.mjs`, `tools/launch-app.test.ts`, `CLAUDE.md`.
- **Verify:** the two-launch round trip above, run by hand against the 9333 profile, plus
  `npm test` and one full `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GC-160 (this ticket): three keys seeded into the 9333 profile and read
    back from the page were absent from the next launch, because `stop()` kills the process before
    Chromium commits.

---

### GC-139 A folder closed in the left panel opens again on every reload

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-051
- **Why:** GC-051 put the closed set in component state and said so in its Out of scope, which was
  right for the first cut: it kept the ticket to the tree and the rendering. But the panel is the
  thing a user arranges once, and `LeftPanel` remounts on every repository open and every reload, so
  a repository with `feature/*`, `release/*` and `hotfix/*` folded down to three rows is back to its
  full list the next time the app starts. Every other arrangement the user makes — the panel widths,
  the ref column, the pin, the hidden set — is remembered, and the two per-repository ones are keyed
  by path.
- **Scope:**
  - Persist the closed set on its own key, `gitclient.folded.<repoPath>`, the way
    `gitclient.hidden.<repoPath>` is (remembered state, not a preference, so not in the prefs blob).
  - Prune it against the refs actually present when a repository loads, so a folder that no longer
    exists stops being remembered — the same reason the hidden set is pruned.
  - A row in the "Remembered state" table in `CLAUDE.md`.
- **Out of scope:** remembering which *sections* are open, the panel's own scroll position, and any
  change to how the tree itself is built.
- **Acceptance:**
  - [ ] A folder closed in one session is closed the next time the repository is opened, and open
        again for a different repository.
  - [ ] A folder whose refs are all gone leaves the key rather than accumulating in it.
  - [ ] A component test covers the round trip through `localStorage`.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `CLAUDE.md`.
- **Verify:** `npm run typecheck`, `npm test`, then close a folder in the running app, reload over
  CDP and confirm it is still closed.
- **Log:**
  - 2026-09-06 proposed by GC-051 (this ticket): the ticket deferred persistence deliberately, and
    with the folders shipped the deferral is now the one thing that makes them feel temporary.

---

### GC-143 The detail panel's file-kind icons are hairlines, and the commit view draws them as text instead

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `Icon` renders every lucide glyph at `strokeWidth={1.75}` and `FileKindIcon` draws the
  file-kind icons at 12px, so at the size they are actually used the modified pencil and the added
  plus are hairlines — measured on a staged file row: `lucide lucide-plus kind kind-added`,
  `width 12`, `stroke-width 1.75`, `fill none`. The same three states are then drawn a second,
  different way a few pixels above: the commit view's change readout is literal text —
  `<span class="kind-added">+ 1 added</span>`, with `✎`, `−` and `→` for the other three — so a
  modified file is a lucide pencil in the file list and the character `✎` in the readout over it.
  The study has one form for both: the readout is a "pencil icon 'N modified'" and the file rows
  are "a status icon (green + added, orange pencil modified, red - deleted, purple renamed)".
- **Scope:**
  - The modified pencil renders filled rather than outlined, and the added plus renders visibly
    heavier, at the 12px the rows use.
  - lucide-react stays the only icon source (rule 1), so a filled pencil is `fill: currentColor`
    on the lucide glyph, not a new asset and not a copied path.
  - Any per-icon weight is a prop on `Icon`, not a second icon component — there is one place the
    app's stroke weight is decided and it stays that way.
  - The commit view's readout renders `FileKindIcon` for each count instead of a text glyph, so
    the same kind is the same mark wherever it appears in the panel.
- **Out of scope:** the kind-to-icon mapping itself, the semantic colours (already tokens), and
  icons anywhere outside the detail panel.
- **Acceptance:**
  - [ ] The pencil on a modified row is filled; the plus on an added row is heavier than today.
  - [ ] The commit view's readout and the file rows draw the same mark for the same kind.
  - [ ] No hex or `rgba()` literal is added to `app.css`.
  - [ ] A component test asserts the readout renders the icon component rather than a text glyph.
  - [ ] Both themes.
- **Files:** `src/renderer/src/ui/icons.tsx`, `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, screenshot the staging view and a commit view over CDP and zoom on
  the rows and the readout.
- **Log:**
  - 2026-09-06 proposed by GR-016, from Ricardo's inbox: measured the stroke weight and fill, and
    found the second, unrelated rendering of the same three states in the readout while doing it —
    which is the stronger half of the ticket, since the two cannot be made consistent by weight
    alone.

---

### GC-146 A local branch's chip carries no icon, and an absorbed chip shows only the remote's

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `renderChip` gives a remote chip a leading `Cloud`, a tag a `Tag`, the checked-out
  branch a `Check` and the pinned one a `Pin` — and a plain local branch nothing at all. Confirmed
  in the running app on `wip-branch` and `feature`, whose chips are bare names. When a local
  branch absorbs its upstream the chip gains a **trailing** `Cloud` and still no local mark, so
  `main`'s chip reads `✓ main ☁`: the one icon on it belongs to the remote copy, and nothing says
  a local branch is there. The study is specific about both the vocabulary and the order — chip
  contents are "status icon (check mark = checked out), name (truncated with ellipsis), then small
  icons: laptop = local branch, cloud or remote logo = remote" — so the kind icons trail the name,
  the status icon leads it, and a local branch is a laptop. Ours puts the remote's cloud in front
  of the name and the absorbed one behind it, which is the same icon on two sides of the same
  chip. The vocabulary already exists in the app: the left panel's LOCAL section header is
  `Laptop` and REMOTE is `Cloud`, while the rows under both use `GitBranch` for local and remote
  branches alike, which is the same gap one level down.
- **Scope:**
  - A local branch chip gets the laptop; a chip that has absorbed its upstream gets laptop and
    cloud side by side, in that order.
  - Kind icons trail the name and status icons (check, pin) lead it, per the study, so the remote
    chip's cloud moves behind the name and the absorbed chip's cloud stops being a special case.
  - The left panel's branch rows take the same vocabulary, so a branch is marked the same way in
    both surfaces.
  - Check the extra glyph against the narrow case: `MAX_CHIPS` is 1 and the chip shrinks, so
    confirm the name is not pushed out at the ref column's minimum width. It must not get worse
    than today; making it better is GC-071.
- **Out of scope:** GC-071 (the primary chip being unreadable at the minimum width); the avatar
  the study puts on a chip for the ref's last committer; the tag and stash marks.
- **Acceptance:**
  - [ ] A local branch chip shows a laptop; a remote one shows a cloud; a chip that absorbed its
        upstream shows both, side by side.
  - [ ] Status icons lead the name and kind icons trail it, on every chip kind.
  - [ ] The left panel marks a local and a remote branch row differently from each other.
  - [ ] At the ref column's minimum width the chip's name is no more truncated than it is today.
  - [ ] A component test covers the absorbed chip carrying both icons.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`,
  `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, launch on the scratch repository — whose `main` absorbs
  `origin/main` and carries `+4` — screenshot the ref column at the default and the minimum width
  and look at both.
- **Log:**
  - 2026-09-06 proposed by GR-016, from Ricardo's inbox: confirmed in the code and on screen. The
    icon order is included because the study puts the kind icons after the name and we already
    disagree with ourselves about it — the same cloud leads a remote chip and trails an absorbed
    one.

---

### GC-147 Nothing joins a ref chip to its node across the 30px between them

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** Measured on `main`'s row at the default column width: `.col-ref` runs from x 220 to
  354, the last chip on the row (`+4`) ends at x 324, `.col-graph` starts at 354, and the only
  thing joining the chip to the node is
  `<line x1="0" x2="9" stroke="var(--lane-0)" stroke-width="1" opacity="0.8">` inside the graph
  cell — page x 354 to 363, meeting the node's left edge. So 30px of the ref column's free width
  has nothing in it at all, and what does exist beyond it is a 1px hairline at 0.8 opacity. The
  study records two things we do not have: "A 2px `hr` line in the lane colour connects the chip
  to the node", and separately "A background band (`commit-bg-color`, 50% lane tint) fills the
  graph cell to the right of the node on the selected row and WIP row". The join between a chip
  and its node is what makes a row readable when several chips are folded and the lanes are
  crowded, and at the moment the eye has to bridge the gap itself.
- **Scope:**
  - The connector runs from the last chip's right edge to the node: across the ref column's
    remaining width and across the graph cell, meeting the node at the same y.
  - It is a faint lane-tinted band with the lane-coloured line on it, per Ricardo — the stretch
    between the node and the chip only, never across the whole row.
  - Only rows that actually have a chip get one; a row with no refs gets neither band nor line.
  - Two constraints that decide the implementation: `.col-ref` is `overflow: hidden`, and
    `.more-list` is absolutely positioned against `.col-ref` and grows over it on hover (GC-022,
    GC-078). The band must not be clipped away, and must not be what the hover expansion has to
    paint over.
  - The graph cell's half stays inside the row's SVG so it lines up with the node exactly, as the
    existing hairline does.
  - Any new colour is a token in `tokens.css`.
- **Out of scope:** the selected-row and WIP-row background band that fills the graph cell to the
  right of the node — the other half of that paragraph in `03-graph.md`, a different surface.
  Also out: chip layout and the fold budget.
- **Acceptance:**
  - [ ] On a row with a chip, the stretch from the chip's right edge to the node is filled and
        measurably continuous — no gap at the ref column / graph column boundary.
  - [ ] A row with no chips has nothing drawn there.
  - [ ] Hovering `+N` still opens the folded list, it is not clipped, and the band does not show
        through it.
  - [ ] The band takes the row's lane colour and is legible in both themes without competing with
        the chip.
  - [ ] `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' src/renderer/src/styles/app.css` prints nothing.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`.
- **Verify:** build, launch on the scratch repository, measure the chip's right edge, the band's
  rect and the node's left edge over CDP on a row with chips and on one without, then screenshot
  both themes and look at them next to
  `docs/reference/gitkraken/screenshots/02-main-1080.png`.
- **Log:**
  - 2026-09-06 proposed by GR-016, from Ricardo's inbox: measured rather than eyeballed, because a
    hairline does exist — it is 9px long inside the graph cell and starts 30px after the chip
    ends, which is why the row reads as having nothing between the two.

---

### GC-149 The tab bar has no answer for more tabs than fit across it

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-016
- **Why:** `.titlebar .tabs` is a plain flex row with `min-width: 0` and no scrolling. A tab is
  capped at 240px and its name ellipsises, but nothing stops the row itself from running out of
  space: past roughly a dozen repositories the tabs squash toward nothing and then push `+` and the
  recents chevron under the 140px reserved for the OS window controls, where they cannot be clicked
  at all. The list is persisted now, so a bar that has grown too long comes back every start and
  there is no way to shrink it except from a tab that can still be reached. The study records
  GitKraken's answer in the same strip: "Right cluster (each 28x28): tabs list chevron, ..." — a
  dropdown listing every open tab, which stays reachable however many there are.
- **Scope:**
  - Decide the overflow behaviour and implement one: the bar scrolls horizontally with the showing
    tab kept in view, or tabs shrink to a floor and the rest fold behind a count.
  - Whatever it is, `+` and the recents chevron keep their place and stay clickable at every tab
    count, and no tab is ever narrower than its icon plus one character.
  - The existing chevron button already opens the recents menu; if the answer is a tabs list, it is
    a second control rather than a second meaning for that one.
- **Out of scope:** drag to reorder and detaching a tab to its own window, both deliberately out of
  GC-016; and any cap on how many repositories may be open.
- **Acceptance:**
  - [ ] With twenty tabs open, `+` and the chevron are inside the window and hit-testable, measured
        over CDP against the 140px window-control reserve.
  - [ ] Every tab is at least readable enough to be told apart, or is reachable through whatever
        folds it.
  - [ ] The showing tab is visible without the user having to look for it after a restart.
- **Files:** `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** seed `gitclient.tabs` with twenty paths, launch, and measure the rects of `+`, the
  chevron and the showing tab over CDP; screenshot and look at it.
- **Log:**
  - 2026-09-06 proposed by GC-016 (this ticket): the bar was built for one tab and now holds as
    many as the user opens. Two repositories is where the ticket's acceptance stops and where the
    verification stopped too, so this is the untested end of the same control.

---

### GC-150 A stash row in the left panel is inert on a single click, and never says which commit it came from

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-140
- **Why:** GC-141 gave every LOCAL, REMOTE and TAG row an `onClick` that selects the ref's tip, and
  put the stash rows out of scope because nothing on a `Stash` said which commit to select. GC-140
  has since put it there: `Stash.parent` is the commit the stash was taken from, read off `%P` on
  the same `git stash list` call and already in the snapshot. So the one row kind in the panel that
  is still inert on a single click is inert for a reason that no longer holds, and the marker
  GC-140 draws in the graph is now the only place the user can see where a stash came from —
  reachable only by finding the right row, which is the thing the left panel exists to avoid.
- **Scope:**
  - A single click on a stash row selects its parent commit, exactly as a branch row selects its
    tip; double-click still applies the stash.
  - The row says which commit it belongs to, in the vocabulary the graph's other rows already use
    (a short sha), so the two surfaces agree without the user hovering for a title.
  - A parent outside the loaded range leaves the graph where it is — `rowIndexOf` already answers
    -1 for that (GC-141), so this is a case to cover, not one to write.
  - The stash row takes the same `selected` marking a ref row does when its commit is selected.
- **Out of scope:** the stash marker in the graph (GC-140 owns it), editing a stash message
  (GC-129), and a stash node or lane of its own in the graph.
- **Acceptance:**
  - [ ] Clicking a stash row selects the commit `git rev-parse 'stash@{N}^'` names, and the graph
        scrolls to it.
  - [ ] Double-click still applies the stash.
  - [ ] A stash whose parent is not loaded does not move the graph.
  - [ ] The row shows the parent's short sha.
  - [ ] A component test covers the click and the not-loaded case.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, launch on the scratch repository, take a stash, click its row over
  CDP and assert the detail panel's sha against `git rev-parse --short 'refs/stash^'`.
- **Log:**
  - 2026-09-06 proposed by GC-141 (this batch): GC-141 fenced the stash rows off because a stash
    had no commit to select. GC-140, in the same batch, gave it one, so the two tickets together
    left a gap neither of them owns.


### GC-151 A repository tab is the one row in the app a right-click does nothing on

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-016
- **Why:** GC-016 shipped the tab bar with a close button and middle-click-to-close and no context
  menu at all. Verified over CDP at `f85d213`: dispatching `contextmenu` on `.tab` leaves
  `document.querySelectorAll('.ctx-menu').length` at 0, both before and after. Every other
  repeated row in the app answers a right-click - a commit, a ref, a stash, a remote, a file row -
  so the tab is the one surface that does not, which is an inconsistency and a real gap besides:
  middle-click closes a tab in one gesture, nothing brings it back, and the repository then has to
  be found again through the recents list. `05-menus-shortcuts.md` records GitKraken's tabs group
  as Close tab, Close other tabs, Close tabs to the right, Reopen closed tab, Rename tab, Alias
  repository, Favorite repository; the first four need nothing the bar does not already hold.
- **Scope:**
  - `onContextMenu` on a tab row, through `useUi().openMenu` like every other menu, built by a
    `tabMenuItems(tab)` in `App.tsx` beside the other `*MenuItems` builders.
  - Rows: Close tab, Close other tabs, Close tabs to the right, Reopen closed tab, Copy repository
    path (the path is already the tab's `title`).
  - Two of those rows are also bindings, from `05-menus-shortcuts.md`'s tabs group: `Ctrl+W`
    closes the showing tab and `Ctrl+Shift+T` reopens the last one closed. Each is an entry in
    `shortcuts.ts` and a `matches('<id>', e)` call in `App`'s window handler, never a bare key
    comparison, so the `?` overlay documents them for free (`CLAUDE.md`, App state). Body scope:
    neither fires from inside a text field. `Ctrl+T` is GC-163's, for the same reason.
  - An action that does not apply is **absent, not disabled**, the way `fileMenuItems` omits one:
    with one tab open there is nothing to close beside it, and with the last tab active there is
    nothing to its right.
  - Reopen closed tab: a session-only stack of the paths closed in this run, newest first, held in
    `App`. Not persisted - the same choice the left panel's collapsed-folder set makes (GC-051),
    and `gitclient.tabs` is the list of what is open, not a history. Reopening puts the repository
    back in a tab of its own at the end of the bar and takes the user to it, exactly as `+` does,
    which means a path already in the bar takes the user to that tab rather than opening a second
    copy of it.
  - Closing several tabs goes through the one close path, so `neighbourOf` still decides what is
    left showing, the parked state of each closed tab is dropped, and `gitclient.tabs` is written
    once rather than once per tab.
- **Out of scope:** Rename tab, Alias repository and Favorite repository - all three need a
  per-tab name, and the stored list is an array of paths that cannot hold one; drag-to-reorder;
  the overflow the bar still has no answer for (GC-149).
- **Acceptance:**
  - [ ] Right-clicking a tab opens a menu, and Escape closes that menu and nothing else - it is a
        `ContextMenu`, so `layerOpen` already covers it and no new listener appears.
  - [ ] With one tab open, neither "Close other tabs" nor "Close tabs to the right" is in the menu.
  - [ ] With three tabs and the first active, "Close tabs to the right" leaves one tab and it is
        still the active one.
  - [ ] Closing a tab and then "Reopen closed tab" puts that repository back, shows it, and
        `gitclient.tabs` holds its path again.
  - [ ] Reopening a path that is already in the bar takes the user to the existing tab and does not
        add a second copy of it.
  - [ ] `tabs.test.ts` covers the closed stack as pure functions: push, pop, and the
        already-open case.
  - [ ] `Ctrl+W` and `Ctrl+Shift+T` do what their menu rows do, appear in the `?` overlay, and
        do nothing while a text field has focus.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/tabs.ts`, `src/renderer/src/tabs.test.ts`,
  `src/renderer/src/styles/app.css`
- **Verify:** build, launch through `tools/launch-app.mjs`, drive the four rows over CDP against a
  two- and a three-tab bar, screenshot the open menu into `docs/screenshots/`, and read
  `gitclient.tabs` back out of `localStorage` after each close and each reopen.
- **Log:**
  - 2026-09-06 proposed by GR-017: right-clicking a tab opens nothing at all (measured over CDP:
    0 menus before the event and 0 after), and a middle-click close has no undo.
  - 2026-09-06 extended by GR-019: `Ctrl+W` and `Ctrl+Shift+T` join the rows they belong to. The
    study lists all three tab bindings together and our table carries none of them; `Ctrl+T` went
    to GC-163 with the `+` behaviour it names, and these two belong with the actions this ticket
    is already building rather than in a bindings ticket of their own.

### GC-152 A commit can only be read against its parent, never against the working directory

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** the commit view's file list is `git show`, so a commit is always read against its
  parent. GitKraken's commit context menu carries "Compare against working directory" and we have
  no equivalent: `grep -rn 'Compare against' src/` returns nothing. That is the ordinary question
  when reading history - how does what is on my disk differ from this commit - and the only way to
  ask it today is to check the commit out, which is a working-tree operation to answer a read-only
  question. Most of the plumbing exists: `getCommitFileDiff` already diffs one path at one sha,
  `DiffView` already keys its content to a view identity, and the detail panel already renders a
  file list with a per-row menu. What is missing is a third diff **source** - `git diff <sha>`
  rather than `git show <sha>`.
- **Scope:**
  - `git.ts`: `getCompare(cwd, sha)` answering the existing `CommitFile[]` shape from
    `git diff --name-status <sha>`, and `getCompareFileDiff(cwd, sha, path, opts)` from
    `git diff <sha> -- <path>`. Both take `DiffOptions`, so GC-052's `-w` reaches them and the
    header's whitespace toggle behaves the same here as anywhere else.
  - Handlers in `ipc.ts` and entries in `preload/index.ts`, in the `commit:*` group, arguments
    validated like every other.
  - A compare **mode** on the commit selection: `selected` stays the sha and a second piece of
    state says the panel is showing the comparison, so nothing about the graph's selection changes.
    The commit menu's row sets it; the panel says which mode it is in and offers the way back to
    the commit's own changes. Selecting another commit, or the WIP row, leaves the mode.
  - The file view opened from a compared row carries that source in `DiffView`'s **identity**, not
    only its load key, so the same file at the same sha read as a commit and read as a comparison
    can never render one under the other's header (GC-075, GC-086).
  - Every hunk button is **off** in this mode and the sub-header says why: `git diff <sha>` is not
    a patch `git apply` will take against the index in either direction. Same shape as the
    whitespace flag's disabled buttons, and Stage file / Discard changes are off too, because
    neither means anything about a commit's contents.
- **Out of scope:** comparing two arbitrary commits with each other, or a commit against a branch
  tip - both want a picker this ticket does not build; Blame and History, the other two file-view
  features `06-feature-inventory.md` lists, each of which is its own ticket.
- **Acceptance:**
  - [ ] The commit context menu carries "Compare against working directory", and it is absent on
        the WIP row, where it would compare the working directory with itself.
  - [ ] Choosing it lists the files that differ between that commit and the working tree, and the
        list matches `git diff --name-status <sha>` run by hand.
  - [ ] Opening one of those rows shows the diff of that file, and it matches `git diff <sha> --
        <path>` byte for byte.
  - [ ] Every patch button in that view is disabled and the sub-header says why.
  - [ ] Turning "Ignore whitespace" on reloads the comparison with `-w` and the hunks on screen
        stay and dim rather than blanking (GC-086).
  - [ ] Selecting another commit leaves compare mode and the panel is the ordinary commit view.
  - [ ] Unit tests for the two new `git.ts` functions' argument construction, and an e2e step that
        opens the comparison on a fixture commit and asserts the file list against git.
  - [ ] `npm run typecheck`, `npm test` and `npm run e2e` pass.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/App.tsx`,
  `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/diff/DiffView.tsx`,
  `tools/e2e/run.mjs`
- **Verify:** `npm run e2e` for the new step; then launch, compare a fixture commit two commits
  back against the fixture's own dirty working tree, and check the list and one file's diff against
  `git diff` run by hand in the scratch repository.
- **Log:**
  - 2026-09-06 proposed by GR-017: the one commit action in the study's list that is neither
    blocked behind interactive rebase nor a worktree feature, and GR-016 named it unticketed.

### GC-153 The left panel's four sections share one scroll, so 52 remote branches hide Tags and Stashes

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** measured in the running app with `catena-feed` loaded read-only
  (`%TEMP%/gitclient-review/GR-017/05-two-tabs-real-repo.png`): LOCAL (7) and REMOTE (52) are both
  open by default, the rows run past the bottom of the window, and the TAGS and STASHES headers are
  not on screen at all. So on a real repository the panel does not say a stash exists until the
  user has scrolled past 52 remote branches - and a section header is exactly the thing that should
  not scroll away, because it is the count. On the nine-ref scratch repository all four headers fit
  (`01-graph.png`), which is why this has never surfaced in a review before. `04-panels.md`
  records GitKraken's answer and it is not "collapse REMOTE by default": "Expanded sections are
  separated by a horizontal drag handle (10px) so their heights can be shared" - each expanded
  section scrolls inside its own box, so one long section never takes the space of the three below.
- **Scope:**
  - `.left-panel` becomes a column of sections that each scroll inside themselves, rather than one
    scroll container over all four. Every section header is always on screen.
  - The expanded sections share the panel's height: an equal share by default, and a drag handle
    between two adjacent expanded sections moves the boundary between them and nothing else. A
    collapsed section is its 30px header and takes no part in the share - the same treatment the
    collapsed left rail gets from `fitPanels`, which passes it in as a zero-width panel.
  - Collapsing or expanding a section re-shares the height among those still open.
  - The heights are remembered on their own `localStorage` key and get a row in `CLAUDE.md`'s
    remembered-state table: this is state, not a preference, so it does not go in the prefs blob.
    Double-clicking a handle resets the two it separates to an equal share and removes the key.
  - The rules GC-105, GC-110, GC-111 and GC-118 settled apply unchanged one axis over: only the
    **applied** heights are clamped and the stored ones are never written over by a fit, a drag
    starts from the height being **drawn**, and a drag released past a wall keeps the wall rather
    than the release position.
  - `useDragWidth` is width-only today. Extract its clamp / persist / release-position logic into
    one hook that takes an axis and have both call sites use it, rather than adding a second copy of
    the same three rules - GC-118 had to be fixed once already and must not be fixable twice.
- **Out of scope:** the section context menu `04-panels.md` also records (show/hide all, maximize
  this section); changing which sections are open by default; the icon rail, which has one row per
  section and is unaffected.
- **Acceptance:**
  - [ ] With a repository whose REMOTE section holds more refs than fit, all four section headers
        are on screen at once and each expanded section scrolls inside itself.
  - [ ] Dragging a handle moves the boundary between its two neighbours and changes no other
        section's height.
  - [ ] Double-clicking a handle resets those two to an equal share and removes the stored key.
  - [ ] The heights survive a reload, and a hand-edited or absent key falls back to an equal share
        rather than to zero.
  - [ ] Collapsing a section gives its space to the sections still open, and expanding it takes the
        space back.
  - [ ] A drag released past the wall keeps the wall, and the stored height of the other section is
        not written over (the GC-118 property, one axis over).
  - [ ] A `LeftPanel.test.tsx` case for the share, and a unit test for the extracted hook's pure
        answer.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `src/renderer/src/ui/useDragWidth.ts` (or
  wherever the hook lives), `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`, `CLAUDE.md`
- **Verify:** build, launch through `tools/launch-app.mjs`, load `catena-feed` **read-only** for a
  panel with 52 remote branches, screenshot into `docs/screenshots/` and look at it: all four
  headers on screen, each section scrolling on its own. Then drag and double-click a handle over
  CDP and read the stored key back.
- **Log:**
  - 2026-09-06 proposed by GR-017: found in the UI pass, on a real repository rather than the
    fixture - the scratch repo's nine refs cannot produce it.
### GC-159 The remote menu can copy a URL but cannot open the remote on its hosting service

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P3
- **Depends on:** GC-008
- **Why:** `docs/reference/gitkraken/06-feature-inventory.md` lists GitKraken's remote menu as
  Fetch, Edit, Remove, **View on service**, Fork on service. Ours (`remoteMenuItems` in
  `App.tsx`) is Fetch, Edit URL…, Rename…, Remove and Copy remote URL: the user can put
  `git@github.com:owner/repo.git` on the clipboard and is then left to translate it and paste it
  into a browser. Opening the remote is the one action in that menu that gets from the client to
  the pull requests, the issues and the compare view.
  Of the study's genuinely uncovered features it is by a distance the smallest. The translation is
  a pure function; `src/shared/remotes.ts` already exists as the shared home for exactly this kind
  of logic, so that a menu label and the action behind it cannot disagree (that is why
  `defaultRemote` lives there); and `shell.openExternal` is already imported in
  `src/main/index.ts`.
  The care goes into the IPC handler. `shell:*` today is two channels that both go through
  `repoFile()`, which refuses a path landing outside the repository. A URL channel has no
  `repoFile()` to lean on, so it has to refuse any scheme but `http:` and `https:` — a
  `file:` or `javascript:` URL handed to `shell.openExternal` is a way out of the app. While
  there: `setWindowOpenHandler` in `index.ts` passes **any** url to `shell.openExternal`
  unchecked. It is only reachable from our own renderer today, but it is the same one-line check
  and it belongs beside the new one.
- **Scope:**
  - `remoteUrlToWeb(fetchUrl)` in `src/shared/remotes.ts`: a pure function turning a git remote
    URL into a browsable `https:` one, or `null` when it cannot. Covers
    `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`,
    `https://host/owner/repo.git` and each without the `.git`. Host-agnostic: no GitHub
    special-casing, because the shape is the same everywhere and a provider list would rot.
  - A `shell:openExternal` handler in `ipc.ts`, validating its argument with the existing
    `str` validator and then refusing any scheme but `http:`/`https:`; exposed on the existing
    `window.shell` bridge, not on `window.api`.
  - A `View on <host>` row in `remoteMenuItems`, **absent rather than disabled** when
    `remoteUrlToWeb` returns null — the way the file menu already handles an action that does not
    apply.
  - The same scheme check applied to `setWindowOpenHandler`.
  - Unit tests for `remoteUrlToWeb`: each accepted form, and the null cases.
- **Out of scope:** "Fork on service" and anything else needing a hosting provider's API; deep
  links to a branch, commit or pull request, whose URL shapes are per-provider and would undo the
  host-agnostic scope above; a browser inside the app.
- **Acceptance:**
  - [ ] `remoteUrlToWeb` returns the right `https:` URL for all four forms and `null` for a
        path-only or unparseable remote, covered by unit tests.
  - [ ] The row is **absent** on the fixture's `origin`, whose URL is a bare repository on disk —
        which is the only case the fixture has, so the positive case needs a remote with an
        `https:` URL added to the scratch repository first (step 17 already adds a remote through
        the UI).
  - [ ] With such a remote added, the row is present and names its host.
  - [ ] `shell:openExternal` refuses a `file:` and a `javascript:` URL and reports it, rather
        than passing either to Electron.
  - [ ] `npm run typecheck && npm test` pass.
- **Files:** `src/shared/remotes.ts`, `src/shared/remotes.test.ts` (new), `src/main/ipc.ts`,
  `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
  `src/renderer/src/App.tsx`
- **Verify:** unit tests for the pure function; then launch, add an `https:` remote to the scratch
  repository, open the remote menu and confirm the row is there and names the host, and confirm it
  is absent on the bare `origin`. **Do not let an unattended run actually open a browser** — that
  would steal focus, which no run may do; assert on the argument the channel is called with instead.
- **Log:**
  - 2026-09-06 proposed by GR-018: the study's remote menu has "View on service" and ours stops at
    "Copy remote URL"; the translation is a pure function, `shared/remotes.ts` is already the home
    for it and `shell.openExternal` is already in `index.ts`, so this is the smallest uncovered
    item left in `06-feature-inventory.md`.

---

### GC-163 The `+` button opens a folder dialog instead of a new tab

- **Status:** in-progress
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-016
- **Why:** `newTab` in `App.tsx` is `const path = await window.api.openRepoDialog(); if (path) await
  openNewTab(path)` — so `+` is "Open repository, but in a new tab", and the only way past it is to
  browse the file system. It is also the second control in the title bar that does exactly that:
  the folder button beside it is the same dialog into the showing tab, so the bar spends two of its
  three buttons on one gesture and none on the one people actually want. The usual reason to press
  `+` is to get back to a repository already worked on, and that list exists — it is the recents,
  one button further right, behind a chevron nobody has a reason to look under.
  **The page this ticket needs is already built.** Closing the last tab draws the empty state
  (verified at `ae3a492`, screenshot `08-empty-state.png`): the app name, "Open a repository to see
  its commit graph.", a RECENTLY OPENED list of name + path rows, and an "Open repository…" button
  — precisely the three choices asked for, minus Clone, which is GC-128's. What is missing is not
  the page but the ability for a **tab to hold no repository**: `Tab` in `tabs.ts` is
  `{ id: number; path: string }` with `path` required, `readTabs` drops any entry that is not a
  non-empty string, and the bar's empty case is a single inert `div.tab` reading "New Tab" that is
  not a tab at all. The study records GitKraken's answer under the same name —
  `06-feature-inventory.md`, "TabsBar / NewTabView | 32 | Multi-repo tabs, **new tab page with
  recent repos**" — and `05-menus-shortcuts.md` gives it `Ctrl+T`, which we do not bind.
- **Scope:**
  - `tabs.ts`: `Tab.path` becomes `string | null`, null meaning a tab that has not been given a
    repository yet. `readTabs` and the write-back skip null paths, so `gitclient.tabs` stays an
    array of real paths and an empty tab is simply not remembered across a restart — it holds
    nothing worth remembering. `makeTabs`, `neighbourOf` and `cycle` are unaffected; their tests
    gain a null-path case.
  - `App`: `newTab()` stops calling `openRepoDialog` and instead appends a tab with `path: null`,
    parks the showing tab's state as `openNewTab` already does, and makes the new one active. With
    a null-path tab showing, `snapshot` is null and the existing empty state renders underneath it
    unchanged — that is the whole of the new page.
  - The bar draws a null-path tab as a real tab, labelled "New Tab", with its close button and
    middle-click close working like any other. The inert placeholder `div` goes: with no tabs at
    all the bar shows nothing and the empty state still fills the window, exactly as it does today.
  - Giving a null-path tab a repository — from its own recents list, its "Open repository…" button,
    or GC-163's rows — fills that tab in place rather than opening another one: it is the tab the
    user is standing in. `openPath` already does this for `activeId !== null`; the only new case is
    that the tab it fills had no path before.
  - A shortcut-table entry `newTab` bound to `Ctrl+T`, body scope, calling the same handler `+`
    does — an entry in `shortcuts.ts` and a `matches('newTab', e)` call in `App`'s window handler,
    the way `CLAUDE.md` says a shortcut is added, so the `?` overlay documents it for free.
- **Out of scope:** Clone and Init, which are GC-128's — this ticket only has to leave the page a
  place to put them, and GC-128's log should say it lands there. Also out: the tab overflow the bar
  still has no answer for (GC-149), the tab context menu (GC-151), and any redesign of the empty
  state's own layout beyond making it a tab's content.
- **Acceptance:**
  - [ ] Pressing `+` opens no OS dialog: a new tab appears, is selected, and shows the recents page.
  - [ ] The tab that was showing keeps its scroll position and selection when it is returned to,
        which is GC-016's promise and must survive the new tab being made.
  - [ ] Picking a repository on that page fills **that** tab; the tab count does not change.
  - [ ] A null-path tab is not written to `gitclient.tabs`, and a restart with one open comes back
        with only the real repositories.
  - [ ] Closing a null-path tab falls to its right neighbour then its left, like any other tab.
  - [ ] `Ctrl+T` does what `+` does, and appears in the `?` overlay because it is in the table.
  - [ ] `tabs.test.ts` covers a null path through `readTabs`, `makeTabs`, `neighbourOf` and `cycle`.
- **Files:** `src/renderer/src/tabs.ts`, `src/renderer/src/tabs.test.ts`,
  `src/renderer/src/App.tsx`, `src/renderer/src/components/TitleBar.tsx`,
  `src/renderer/src/shortcuts.ts`, `src/renderer/src/styles/app.css`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then drive the built app over CDP:
  press `+`, assert no dialog and a second tab whose content is `.graph-empty`, pick a recent from
  it and assert the tab count is still 2 and `gitclient.tabs` holds one path. Screenshot the new
  tab page and the bar with an empty tab beside a real one, and look at both.
- **Log:**
  - 2026-09-06 proposed by GR-019, from Ricardo's inbox: `+` goes straight to the folder dialog,
    and the page it should open instead already exists as the empty state — what is missing is a
    tab that may hold no repository.
  - 2026-09-06 09:12 claimed

---

### GC-164 A repository picked from the recents list replaces the tab it was picked from

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-016
- **Why:** Every recents row calls `openPath`, and `openPath` with a tab showing rewrites **that
  tab's** path: `setTabs(prev => prev.map(t => t.id === activeId ? { ...t, path } : t))`. The
  repository the user was on is not moved aside, it is gone — its parked state is dropped and
  `gitclient.tabs` is written without it. Reproduced in the running app at `ae3a492`: with
  `testrepo` open, picking `catena-feed` from the title bar's recents dropdown left the bar at
  **one** tab whose label had changed, `gitclient.tabs` holding only `catena-feed`, and picking
  `testrepo` straight back left it at one tab again — two repositories opened in a row and the bar
  never grew past one. That is the opposite of what the tabs exist for, and it is a silent loss:
  nothing was closed, so nothing warned. `openNewTab` is right there and already handles every case
  this needs, including `activeId === null`, where it appends the first tab; the recents rows
  simply call the wrong one of the two.
- **Scope:**
  - The recents rows in `openRepoMenu` call `openNewTab` instead of `openPath`. That menu is opened
    by both the title bar's chevron and the repository breadcrumb, and both mean the same thing —
    "take me to that repository" — so both change together.
  - The empty state's `.recent-row` buttons change with them. `openNewTab` covers the no-tab case
    already, so the first repository still lands in the first tab and nothing else happens there;
    with GC-163's empty tab showing, see below.
  - "Open repository…" in that same menu, and the title bar's folder button, keep `openPath`: the
    bar already distinguishes the two gestures with two buttons, and this ticket does not merge
    them.
  - A path already in the bar still takes the user to its tab rather than opening a second copy —
    `openNewTab` does that first, before it makes anything.
  - The row for the repository already showing stays disabled, as it is today.
- **Out of scope:** where a new tab is inserted (it goes at the end, as `+` does) and whether it
  becomes the showing tab (it does, as `+` does) — both are GC-016's existing behaviour and are not
  reopened here. Also out: GC-163's `+` page, which is a separate ticket; if it has landed first,
  a recents row inside a null-path tab fills **that** tab rather than making another, which is
  GC-163's rule and needs no second answer here.
- **Acceptance:**
  - [ ] With one repository open, picking a different one from the title bar's recents dropdown
        leaves two tabs, the new one showing and the old one still in the bar.
  - [ ] The old tab, returned to, still has its scroll position, selection and commit draft — the
        parked state was never dropped.
  - [ ] `gitclient.tabs` holds both paths, in bar order.
  - [ ] The same is true of the recents rows in the repository breadcrumb's menu.
  - [ ] From the empty state with no tabs at all, a recents row still opens exactly one tab.
  - [ ] Picking a repository already in the bar switches to its tab and adds nothing.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then over CDP against the scratch
  repository plus a second folder: open one, pick the other from the dropdown, assert
  `document.querySelectorAll('.titlebar .tab').length === 2` and that `gitclient.tabs` holds both;
  switch back and assert the graph's scroll offset survived. An e2e step is worth it here — step 1
  already asserts the run starts from exactly one tab (GC-155), so a second tab appearing is
  directly observable.
- **Log:**
  - 2026-09-06 proposed by GR-019, from Ricardo's inbox: picking from "recently opened" replaces
    the active tab. Reproduced in the app — two repositories opened in a row and the bar never grew
    past one tab, with `gitclient.tabs` overwritten each time.
  - 2026-09-06 09:12 claimed

---

### GC-165 The empty state's recents paths ellipsise at the wrong end, unlike the menu's

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-044
- **Why:** The same recents list is drawn twice, and the two truncate opposite ways. In the menu a
  path is a `hintPath`, and `.ctx-item .ctx-hint.path { direction: rtl; }` ellipsises it at its
  **start**, so the folder that names the entry survives — GC-067's whole point. In the empty state
  `.recent-row .recent-path` has `overflow: hidden; text-overflow: ellipsis` and no `direction`, so
  it ellipsises at its **end** and eats the tail. Measured at `ae3a492` in the running app: the
  same row rendered `…/Ricar/AppData/Local/Temp/gitclient-review/e2e/testrepo` in the menu and
  `C:/Users/Ricar/AppData/Local/Temp/gitclient-review/e2e/t…` in the empty state, where
  `scrollWidth` 367 against `clientWidth` 335 confirms it is genuinely clipped rather than merely
  long. `CLAUDE.md` calls the empty state's copy "the same list the breadcrumb menu offers", and it
  is not: the half a path that identifies a repository is exactly the half the empty state throws
  away, and it is the surface where a user has nothing else on screen to go by. It gets worse, not
  better, with GC-163, which makes that page the thing `+` opens.
- **Scope:**
  - `.recent-row .recent-path` ellipsises at the start, the way the menu's hint does.
  - `direction: rtl` on a left-to-right path reorders a leading or trailing `/` to the other end —
    the reason `fileMenuItems`' ignore hints are bare paths (GC-093). The recents paths are
    absolute and end in a folder name, so the trailing side is safe, but the drive prefix and any
    trailing separator must be checked in the app rather than assumed; if `rtl` is not clean here,
    take the same result another way and say in the log which and why.
  - One rule, not two: whatever answers it should be reachable by both call sites, so a third copy
    of the list cannot drift again.
- **Out of scope:** the row's layout, the name/path split, how many recents are kept, and the
  `title` attribute, which already carries the full path on hover in both places.
- **Acceptance:**
  - [ ] A recents row too long for the empty state shows the end of its path, not the beginning.
  - [ ] The menu's rows are unchanged.
  - [ ] A path is rendered with its separators in the right places and its drive letter where it
        belongs — checked by reading the row's rendered text, not only by looking at it.
  - [ ] A path that fits is drawn in full, with no ellipsis and no reordering.
- **Files:** `src/renderer/src/styles/app.css`, and `src/renderer/src/App.tsx` only if the shared
  rule needs a class the empty state does not already carry.
- **Verify:** `npm run typecheck`, `npm run build`, then over CDP seed `gitclient.recentRepos` with
  one deep path and one short one, close every tab to reach the empty state, and compare the two
  rows' rendered text against the menu's for the same entries. Screenshot both and look at them
  side by side.
- **Log:**
  - 2026-09-06 proposed by GR-019: from the UI pass over the empty state, a surface no review had
    screenshotted before. Found while investigating Ricardo's inbox item about `+`, since that page
    is where GC-163 sends it.

---

### GC-166 A file can be diffed but never followed: no history for one path

- **Status:** todo
- **Area:** graph | **Size:** M | **Priority:** P3
- **Depends on:** GC-043
- **Why:** `git log -- <path>` has no equivalent anywhere in the app. `fileMenuItems` offers Open,
  Show in folder, Copy path, Discard, Ignore and Restore from this commit (GC-107) — every one of
  them about the file *now*, or about one commit's copy of it. The question a client is opened for
  half the time, "when did this file change, and who changed it", can only be answered by scrolling
  the graph and clicking commits until one lists the path. GR-018's what's-next pass named Blame,
  History and Export changes to patch as the last uncovered rows of
  `06-feature-inventory.md` and filed none of them, because each wanted a surface decision, and
  asked the next review to bring one back with a sketch. **This is that sketch, and the study
  already settles it.** `04-panels.md` records the file view's toolbar as
  "centre toggle **File View | Diff View**, right side **Blame | History**", and
  "History lists commits touching the file" — so History is not a new window, it is a mode of the
  file view we already have. `DiffView` is that slot: it replaces the graph, collapses the left
  panel to the icon rail, and already carries a header of exactly this shape, with the
  `Unified | Split` segmented control (GC-014) sitting where the study puts the view toggles.
- **Scope:**
  - `git.ts`: `getFileLog(cwd, path, max)` — the same `--date-order` traversal and the same field
    format `getLog` uses, with `--follow -- <path>`, answering `Commit[]` so nothing downstream
    needs a new type. It goes through `runGit` like every other call; the path is a
    repository-relative one and goes through `repoRel()`, which already refuses one landing outside
    the repository (GC-093).
  - `ipc.ts` + preload: `repo:fileLog`, arguments validated with `str`/`int` like every other
    handler.
  - A `History` control in `DiffView`'s header beside `Unified | Split`, switching that view's body
    between the diff and a list of the commits that touched the path: summary, author, the authored
    date through `time.ts` — the one module that answers how a timestamp is written (GC-133), so
    this list cannot invent a fourth format, and it picks up relative dates for free when GC-135
    lands — and the short sha. It is a **mode of the open file view**, so it costs no new
    layer, no new Escape case and no new left-panel state.
  - Selecting a commit in that list shows that commit's diff **of this file** in the same body — the
    view already knows how to render a commit-source diff, so this is the existing load with a sha
    the list supplied.
  - An entry in `fileMenuItems` that opens the file view straight into History, so the menu is a way
    in as well as the header.
- **Out of scope:** Blame, which needs `git blame` porcelain parsing and a per-line gutter and is
  its own ticket; File View (the whole file with highlighting), which needs a highlighter we do not
  have; renames beyond what `--follow` gives; a history for a *directory*; and any history of the
  working-tree copy, which has no commits to list.
- **Acceptance:**
  - [ ] Opening History on a file in the fixture lists exactly the commits `git log --follow --
        <path>` lists, in the same order, asserted against git rather than by eye.
  - [ ] Selecting a commit in the list shows that commit's diff of that file, and the header still
        names the file.
  - [ ] History on the fixture's deleted file lists the commit that deleted it.
  - [ ] Escape closes the file view from History exactly as it does from the diff — one layer, one
        press, and no new `window` listener anywhere (`CLAUDE.md`, App state).
  - [ ] Switching to History and back costs no reload of the diff already loaded, the way
        `Unified | Split` does not (GC-014).
  - [ ] A file with one commit in its history renders without a special case.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then an e2e step that opens History
  on a fixture file and compares the listed shas against `git log --follow --format=%h -- <path>`
  run directly, plus one that opens a commit from the list and asserts the diff header and hunks.
  Screenshot History over a file with several commits and look at it beside
  `docs/reference/gitkraken/screenshots/04-diff-view.png`.
- **Log:**
  - 2026-09-06 proposed by GR-019: from the what's-next pass, answering GR-018's explicit handoff.
    The surface decision it was waiting on is in the study already — `04-panels.md` puts History in
    the file view's own header, which is the slot `DiffView` occupies — so the ticket can be
    written without inventing a new screen.

---

### GC-167 stashRename's index shift is the one piece of stash arithmetic with no unit test

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-129
- **Why:** `stashRename` (`src/main/git.ts`) drops `stash@{index + 1}`, not `stash@{index}`, because
  `git stash store` prepends a reflog entry and shifts every existing stash down one. Get that
  `+ 1` wrong and the command silently destroys the neighbouring stash while leaving the one it was
  asked to rename — a data loss with no error and no way back. The rule was measured before it was
  written and e2e step 38 covers it end to end, but that is a 43-second run against a live
  repository, and the seam for a cheap test is already there: `restoreStashWith` takes a
  `GitRunner` for exactly this reason (GC-092) and `git.test.ts` drives it with a fake. Nothing
  else in the stash group is untested.
- **Scope:**
  - `stashRenameWith(run: GitRunner, index, message)` beside `restoreStashWith`, with
    `stashRename` as the bound one-liner, the same shape the apply/pop pair already has.
  - Tests: the three commands run in order; the drop names `index + 1`; a store that rejects means
    no drop is attempted at all and the error propagates; the sha is read before either.
- **Out of scope:** changing what the command does, the dialog, or anything about `stash store`'s
  own behaviour — GC-129 settled all three.
- **Acceptance:**
  - [ ] `stashRename` is a bound call to a runner-taking function, matching `restoreStash`.
  - [ ] The four cases above are named tests and `npm test` passes.
  - [ ] A test fails if the drop's index is changed to `index`.
- **Files:** `src/main/git.ts`, `src/main/git.test.ts`.
- **Verify:** `npm run typecheck`, `npm test`, then change `index + 1` to `index` by hand and
  confirm a test goes red before putting it back.
- **Log:**
  - 2026-09-06 14:05 proposed by GC-129 (this ticket): the arithmetic is load-bearing and destroys a
    stash when wrong, and the runner seam that would test it already exists one function above.

---

### GC-168 The fixture's graph fits at every height, so nothing guards the drag auto-scroll

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-122
- **Why:** GC-122 made `.graph-body` scroll while a branch is dragged over its edges, and the e2e
  suite cannot see it: the fixture has eight commits, so the graph fits at every height the suite
  runs at and the pointer is never in a band with anywhere to go. The behaviour was confirmed by a
  hand-driven CDP session on a 1400x340 window (`scrollTop` 0 to 9 to 44 off one `dragover`), and
  that session is not repeatable — a regression in the rAF loop, in the `REF_DRAG_TYPE` guard or in
  the `dragleave` `relatedTarget` check would ship silently. The same gap covers anything else that
  only appears when the graph scrolls: GC-012's paging, the `+N` block's flip above the row, the
  keyboard's "keep the selected row visible".
- **Scope:**
  - An e2e step that overrides the viewport to a height where the fixture's rows overflow —
    `Emulation.setDeviceMetricsOverride`, which the suite already uses (GC-126) — and asserts
    `.graph-body` scrolls at all before anything else.
  - In that viewport: a `dragstart` on a chip, one `dragover` inside the bottom band, then a wait
    and an assertion that `scrollTop` moved without a second event; a `dragend` and an assertion
    that it then stayed put; and a `dragover` carrying an empty `DataTransfer`, which must move
    nothing.
  - The override is put back, and the step leaves the scroll position where it found it.
- **Out of scope:** the speed constants, the band width, and covering the paging or the `+N` flip in
  the same step — each is its own assertion and this one is about the drag.
- **Acceptance:**
  - [ ] The step fails if `useDragScroll` is removed from `.graph-body`.
  - [ ] The step fails if the `REF_DRAG_TYPE` guard is dropped.
  - [ ] `npm run e2e` passes, and the run is still re-entrant twice in a row.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e` twice, then remove the `{...dragScroll}` spread and confirm the step
  goes red before putting it back.
- **Log:**
  - 2026-09-06 14:05 proposed by GC-122 (this ticket): the feature shipped with a pure-function test
    and a hand-driven check, and the suite has no way to reach it.

---

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-019 Backlog review 2026-09-06 13:35

- **Status:** done
- **Window:** 2f66b3e..ae3a492
- **Log:**
  - 2026-09-06 13:35 inbox: **two items pending**, both about the repository tabs, both
    investigated in the code and reproduced in the running app, both now tickets. Neither was
    declined and nothing was left in Pending. They are decided first and outside the zero-to-five
    budget, so this review's own findings are two of the five allowed.
  - inbox 1, `+` should open a new tab offering Open / Clone / recents rather than the folder
    dialog: true, and narrower than it looks. `newTab` is `openRepoDialog()` then
    `openNewTab(path)`, so `+` is the second of three title-bar buttons spending itself on one
    gesture. But **the page it should open already exists** — closing the last tab draws the empty
    state (`08-empty-state.png`) with the app name, a RECENTLY OPENED list of name + path rows and
    an "Open repository…" button, which is exactly the three choices minus Clone. What is missing
    is a **tab that may hold no repository**: `Tab.path` is a required `string`, `readTabs` drops
    anything that is not a non-empty string, and the bar's empty case is an inert `div.tab` reading
    "New Tab" that is not a tab at all. The study names the same thing —
    `06-feature-inventory.md`, "TabsBar / NewTabView … new tab page with recent repos" — and
    `05-menus-shortcuts.md` gives it `Ctrl+T`, which our table does not carry. **-> GC-163**, with
    Clone left explicitly to GC-128 and `Ctrl+T` folded in, since a shortcut here costs a table
    entry and a `matches` call and gets the `?` overlay for free.
  - inbox 2, picking from recently opened replaces the active tab: true, and it loses more than the
    tab. Every recents row calls `openPath`, which rewrites the **showing** tab's path, so the
    parked state goes with it. Reproduced at `ae3a492`: with `testrepo` open, picking `catena-feed`
    from the dropdown left **one** tab whose label had changed and `gitclient.tabs` holding only
    `catena-feed`; picking `testrepo` straight back left it at one tab again. Two repositories
    opened in a row and the bar never grew. `openNewTab` is right beside it and already handles
    every case needed, `activeId === null` included, so the rows simply call the wrong one of two.
    **-> GC-164**, covering the breadcrumb's copy of the menu and the empty state's list with it.
  - shipped: **two full batches**, sixteen commits. `dcffe27` closes GC-121, GC-071, GC-074,
    GC-087 and GC-091; `74631ea` closes GC-154, GC-155, GC-085, GC-094, GC-096 and GC-097. Read as
    a reviewer, **GC-121** is the substantial one and it is right where it is hardest: the `kept`
    flag in `buildLinePatch` carries a `\ No newline` marker only while the line it describes is
    still in the patch, and the two directions genuinely mirror — an unselected removal becomes
    context for the index and is dropped for the working tree, and the reverse for an addition.
    **GC-097** is a clean, well-argued one-flag change whose comment says why `-u` is wrong for the
    sequencer guard, and the follow-up it implies was filed and has already shipped as GC-161.
    **GC-155** and **GC-085** are small and honest. No bug found in any diff.
  - verified live rather than from the diffs: **GC-096** does exactly what it promises — the filter
    is focused on open, `sand` narrows to `sandbox` and `origin/sandbox` with both captions kept,
    and `zzzz` gives "No matches" rather than a bare field (`04-branch-filter-menu.png`).
    **GC-094**'s left panel header reads `main`. **GC-121** picks lines in the unified layout: one
    `.sel` row and the buttons reading "Stage 1 line" / "Discard 1 line" (`07-line-selection.png`).
  - health: at `ae3a492` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    282 tests passed (22 files)** in 2.28s, **build ok**. Confirmed the build landed in the
    worktree's own `out/` (13:14) and that `MAIN/out` kept its 13:04 timestamps: `MAIN` was never
    built, tested or launched.
  - app: the worktree build ran offscreen on 9334 against the review's own scratch root. Eight
    screenshots in `%TEMP%/gitclient-review/GR-019/`, all looked at. `01-graph.png`: lanes
    continuous, right-angle joins, GC-144's dash covering the whole WIP-to-`main` run, GC-142's
    detail panel reading as separated blocks. `05-preferences.png` is one rotation surface this
    time — GC-103's scrolling body with the title and Close button fixed, GC-101's and GC-125's own
    checkboxes and selects, nothing clipped. `06-diff.png` and `07-line-selection.png` are the
    diff. `08-empty-state.png` is the other rotation surface, never screenshotted by any review
    before, and it is the one that decided GC-163 and produced GC-165.
  - app, the large real graph: `catena-feed` (881 commits, 7 local and 52 remote refs) was loaded
    **read-only** for `03-catena-feed-graph.png`. Two open tickets reproduce in it exactly as
    written and neither needed a new one: **GC-153** — REMOTE's 52 rows push TAGS and STASHES off
    the bottom of the shared scroll — and **GC-117** — Preferences has all three graph columns on
    (`05-preferences.png`) while the row header reads BRANCH / TAG, GRAPH, COMMIT MESSAGE, AUTHOR,
    SHA, with DATE / TIME silently dropped by `fitOptCols`. GC-117 was claimed as `in-progress`
    while this review was being written, so it was not edited; this is the evidence, recorded here.
  - a near-miss worth recording: several rows in that graph draw an avatar with no initials, which
    read as a defect until the DOM said otherwise — `semantic-release-bot` and `vmarkopoulos` both
    resolve to a real `image` element pointing at gravatar, so what is on screen is the account's
    own picture and the initials fallback never ran. No ticket. Likewise the hairline running from
    the graph column's left edge into each node is `GraphCell`'s `connector`, present since the
    initial commit; it stops at the graph column, so **GC-147** — a band across the gap inside the
    ref column — is not a duplicate of it and stands as written.
  - what's next, answering GR-018's handoff: GR-018 named Blame, History and Export changes to
    patch as the last uncovered rows of `06-feature-inventory.md` and filed none, because each
    wanted a surface decision, asking the next review to bring one back with a sketch. **The study
    already settles History**: `04-panels.md` records the file view's toolbar as "centre toggle
    File View | Diff View, right side **Blame | History**" and "History lists commits touching the
    file", so History is a mode of the file view rather than a new screen — and `DiffView` is that
    slot, already replacing the graph, already collapsing the left panel to the rail, already
    carrying a segmented control in its header. Filed as **GC-166** with that sketch. Blame still
    needs a per-line gutter and porcelain parsing, and Export needs a save dialog the app has never
    opened; both are named again rather than filed thin.
  - tickets: added **GC-163** (ui, M, P2) and **GC-164** (ui, S, P2) from the inbox, and
    **GC-165** (ui, S, P3) and **GC-166** (graph, M, P3) as this review's own two — one from the
    UI pass, one from the what's-next pass, which is the spread the routine asks for. **GC-165** is
    the UI-pass find: the recents list is drawn twice and the two truncate opposite ways — the
    menu's `hintPath` is `direction: rtl` and ellipsises at the start (GC-067), while the empty
    state's `.recent-path` has no `direction` and ellipsises at the end, rendering the same entry
    as `…/gitclient-review/e2e/testrepo` in one place and `C:/Users/…/e2e/t…` in the other, with
    `scrollWidth` 367 against `clientWidth` 335 proving it is genuinely clipped. It matters more
    once GC-163 makes that page what `+` opens.
  - extended **GC-151**: its Reopen closed tab row now carries `Ctrl+Shift+T` and its Close tab row
    `Ctrl+W`, both from `05-menus-shortcuts.md`'s tabs group. They belong there rather than in a
    ticket of their own — the actions are GC-151's and a binding is one table entry — and `Ctrl+T`
    went to GC-163 for the same reason. No other ticket was extended; each addition was checked
    against the board first.
  - board: GC-164 then GC-163 go **ahead of GC-128**, which has been the first unclaimed P2 for
    three reviews and cannot be started anyway — its `Depends on` is GC-026, still `todo`. So the
    top of the P2 band was a row no worker could take; the two tab tickets are eligible
    immediately and both came from Ricardo. GC-165 and GC-166 go after GC-159 and ahead of GC-026,
    where GR-015 through GR-018 all put their P3 additions. Nothing else moved.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081; none can be unblocked from here and all three
    still want a decision from Ricardo. No `todo` ticket has gone vague. Dependencies on the four
    added: GC-163 and GC-164 on GC-016, GC-165 on GC-044, GC-166 on GC-043 — all `done`, so all
    four are eligible the moment they are read.
  - notes: `CLAUDE.md` at `ae3a492` says "282 tests today", which matched exactly, and its
    Architecture section is current for GC-121, GC-087, GC-091, GC-094 and GC-096. Nothing stale to
    report; this review did not edit `CLAUDE.md`. One study note re-confirmed rather than
    re-discovered: `09-repo-dropdown.png` and `10-branch-dropdown.png` are the two unusable
    captures GC-065 recorded, so there is **no picture** of GitKraken's repository dropdown or new
    tab page to compare GC-163 against — it is grounded in the written inventory row only, which
    the ticket says.
  - a moving tip, handled explicitly: the worker pushed `9336964` — the whole GC-156 / GC-157 /
    GC-158 / GC-160 / GC-161 batch — while this review was being written, and a new batch claimed
    GC-129, GC-134, GC-135, GC-102, GC-117 and GC-122 on top of it. That batch is **out of this
    window and belongs to GR-020**, which should read its diffs properly. It also took GC-162 —
    the worker's own reflect-step ticket — and GC-117, which is why the ids here start at GC-163
    and why GC-117's evidence above is a log line here rather than on that ticket.
  - isolation: no ticket was `in-progress` when the ids were chosen, and six were by the time this
    was written; not one was touched. `MAIN` was never built, tested or launched, and its working
    tree was left exactly as found — the write below waited for `TICKETS.md` and
    `TICKETS-ARCHIVE.md` to be clean in `git status` and stages only those two. The only
    repository written to was the review's own scratch root, whose `git status --short` and empty
    `stash list` are byte-identical to what `e2e:setup` created; `catena-feed` was opened
    read-only and nothing in it was touched. `+` was deliberately **never clicked**, because it
    opens a native folder dialog and no unattended run may steal focus — that item was settled from
    the code and from the empty state instead. The review's Electron on 9334 was found by command
    line and stopped by PID tree, never with a machine-wide kill; zero remained afterwards.
