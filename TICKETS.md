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
| GC-172 | A tab returned to comes back scrolled to the top, whatever it was left at | graph | S | P1 | todo |
| GC-164 | A repository picked from the recents list replaces the tab it was picked from | ui | S | P2 | done |
| GC-163 | The `+` button opens a folder dialog instead of a new tab | ui | M | P2 | done |
| GC-169 | Pull, push and fetch cannot survive a credential the helper cannot fix, and report one line of the reason | actions | M | P1 | todo |
| GC-170 | A stash is a chip on its parent, where GitKraken gives it a row of its own above the tip | graph | M | P2 | todo |
| GC-153 | The left panel's four sections share one scroll, so 52 remote branches hide Tags and Stashes | ui | M | P2 | todo |
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
| GC-123 | A ref folded behind +N can neither be dragged nor dropped on | graph | S | P3 | done |
| GC-124 | The staged-changes guard reads the snapshot from before a drop’s checkout | actions | S | P3 | done |
| GC-127 | A chip offers a grab cursor it cannot honour, and lights up less than the row beside it | ui | S | P3 | done |
| GC-136 | A hidden detail panel has nothing on screen to bring it back | ui | S | P3 | done |
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
| GC-159 | The remote menu can copy a URL but cannot open the remote on its hosting service | actions | S | P3 | todo |
| GC-165 | The empty state’s recents paths ellipsise at the wrong end, unlike the menu’s | ui | S | P3 | todo |
| GC-173 | An empty tab given a repository that is already open is left behind | ui | S | P3 | todo |
| GC-166 | A file can be diffed but never followed: no history for one path | graph | M | P3 | todo |
| GC-171 | A stash row spends 66px on its age and leaves its message 77px of the 192 it wants | ui | S | P3 | todo |
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
- **Area:** ui | **Size:** M | **Priority:** P2
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
  - Every section keeps a **minimum height** in the share, not only a visible header: a section
    squeezed to its header alone is reachable but useless, and the ask is that STASHES stays
    *readable* at the bottom with TAGS open. The floor is the header plus a small number of rows,
    and a share that cannot give every open section its floor falls back to scrolling the column
    of headers rather than to zero-height sections.
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
  - [ ] Expanding TAGS on a repository with a long REMOTE leaves STASHES showing its header **and
        at least one row**, rather than only its header.
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
  - 2026-09-06 extended by GR-020, from Ricardo's inbox: he reported the same thing from the other
    end - expanding TAGS pushes STASHES off the bottom - and named a requirement GR-017 had not:
    a **minimum height per section**, so the sections below stay readable and not merely present.
    Confirmed unchanged at 23ce5c2 in the running app: `.left-panel .sections` computes to
    `overflow: auto`, `display: block`, one scroll box over all four. Raised P3 -> P2: it is the
    only open ticket that makes the panel wrong on every real repository, and the stakeholder has
    now raised it twice.
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

### GC-172 A tab returned to comes back scrolled to the top, whatever it was left at

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P1
- **Depends on:** GC-016
- **Why:** GC-016 promised that a tab switch preserves the scroll position, and it does not. The
  offset is parked correctly — `graphTop` is in `TabState`, `showTab` puts it back and hands it to
  `CommitGraph` as `scrollTop` — but `CommitGraph`'s "scroll the selected row into view" layout
  effect runs on the same mount and wins, because a remount is exactly when `selected` is new to
  it. With the selection on the working-directory row, which is what a repository opens on, that
  means row 0: the graph comes back at the top however far down the user had scrolled.
  Measured on the built app at `be96b22`, on a 300px-tall viewport so the fixture's nine rows
  overflow: scrolled to 84, clicked the second tab, clicked back, `scrollTop` 0. The same on the
  recents path (GC-164) and on a plain click between two tabs, so it is the restore that is broken
  and not one route into it. The selection and the commit draft do come back, which is why this
  reads as a small thing and is not: the scroll position is the one part of GC-016's promise a user
  notices immediately on a repository with more than a screenful of history.
- **Scope:**
  - Make the two agree on a remount: the selection effect must not override an offset that was
    deliberately restored. Either it skips the mount it is handed a `scrollTop` for, or the restore
    happens after it, or the effect only scrolls when the selected row is genuinely outside the
    range being shown — the third is closest to what it is for, and would also stop it fighting the
    user's own scrolling.
  - Whatever it is, a tab whose selection *is* off-screen at the restored offset must still end up
    somewhere sensible rather than at a blank stretch of graph.
- **Out of scope:** remembering the offset across a restart (it is session state, like the parked
  snapshot), and the offset of a file view (there is no graph behind one to restore).
- **Acceptance:**
  - [ ] A tab scrolled part-way down, switched away from and returned to, comes back at that offset.
  - [ ] True on both routes: clicking another tab, and opening a second repository from the recents
        list (GC-164).
  - [ ] Selecting a commit that is off-screen still scrolls it into view, which is what the effect
        exists for.
  - [ ] The unticked acceptance boxes in GC-163 and GC-164 can be ticked against this build.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, possibly `src/renderer/src/App.tsx`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then over CDP with
  `Emulation.setDeviceMetricsOverride` at a height short enough that the fixture's graph overflows
  — the fixture is nine rows, so a full-height window cannot show this at all: scroll, switch,
  switch back, read `scrollTop`. A component test in `CommitGraph.test.tsx` can pin the decision
  itself if the fix is a predicate rather than a lifecycle change.
- **Log:**
  - 2026-09-06 proposed by GC-164 (this ticket): its second acceptance criterion could not be
    ticked, and the same measurement on a plain tab switch showed the criterion had never held —
    so this is GC-016's bug surfacing, not GC-164's regression, and it is filed rather than folded
    into a ticket that did not cause it.

---

### GC-173 An empty tab given a repository that is already open is left behind

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-163
- **Why:** `+` makes a tab holding no repository (GC-163) and its recents page is where one is
  chosen. Choosing a repository that is **already in the bar** goes through `openPath`, which
  finds the tab already holding it and switches to it — the right answer to "take me there", and
  the rule every tabbed application follows. But the empty tab the user was standing in is still
  open behind them, and nothing closed it: the bar grows by one tab that holds nothing, for a
  gesture that opened no repository. Reachable in two clicks from a cold start.
- **Scope:**
  - An empty tab that ends up handing the user to another tab closes itself, since it was made for
    a repository it did not get. Only that case: an empty tab the user leaves by clicking another
    tab is still theirs and stays.
- **Out of scope:** any change to what `openPath` does with a repository already in the bar
  (GC-016's rule, and it is right), and closing an empty tab on any other trigger.
- **Acceptance:**
  - [ ] With one repository open, `+` then picking that same repository from the new tab's recents
        page leaves exactly one tab, showing it.
  - [ ] `+` then picking a repository that is **not** open still fills the empty tab in place, as
        GC-163 has it.
  - [ ] `+` then clicking the first tab leaves the empty tab in the bar.
- **Files:** `src/renderer/src/App.tsx`.
- **Verify:** `npm run typecheck`, `npm test`, then over CDP: press `+`, pick the showing
  repository from the page, assert `document.querySelectorAll('.titlebar .tab').length === 1`.
- **Log:**
  - 2026-09-06 proposed by GC-163 (this ticket): found while driving the new tab page — the empty
    tab is filled in place for a repository that is new to the bar, and left standing for one that
    is not.

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

### GC-169 Pull, push and fetch cannot survive a credential the helper cannot fix, and report one line of the reason

- **Status:** todo
- **Area:** actions | **Size:** M | **Priority:** P1
- **Depends on:** none
- **Why:** Ricardo cannot pull `catena-feed` at all. GitHub's `Catena-Media` organisation enforces
  SAML SSO, and the credential Git Credential Manager has stored needs an interactive
  re-authorisation; git answers the fetch with three lines - two `remote:` lines carrying the
  instruction and the URL, then `fatal: unable to access '...': The requested URL returned error:
  403`. Two things in our code make that a dead end. First, `runGit` sets
  `GIT_TERMINAL_PROMPT: '0'` **unconditionally**, on every spawn (`git.ts:85`) - correct for the
  hundred-odd read-only calls a snapshot makes, wrong for the three that talk to a remote, because
  it is the one setting that could let the helper ask. Second, and worse, the app throws away the
  half of the message that says what to do: `StatusBar`'s `headline()` prefers a line matching
  `/^(error|fatal):|CONFLICT|failed/i`, which on this error is the `fatal:` line - the one that
  says 403 and nothing else - and the `remote:` lines naming SAML SSO are dropped. What survives is
  then drawn in a `button.err` at `max-width: 45%`, `white-space: nowrap`, ellipsised, whose only
  full text is a native `title` tooltip. So the user is told "403" and is given no reason, no URL
  and nothing to click. Every authentication failure in the app has this shape; SAML SSO is only
  the one that cannot be got past by waiting.
- **Scope:**
  - A failure of a **remote** operation (`fetch`, `pull`, `push`) that git blames on
    authentication or authorization gets a real surface instead of one status-bar line: a modal
    carrying the **whole** of git's message, unabridged and selectable, the remote and the URL it
    was talking to, and a Copy button. The status bar keeps its one-line summary, and the summary
    is what opens the modal.
  - Recognise the case rather than guessing: a `GitError` from a remote command whose text matches
    the small set git and the common helpers actually emit (`403`, `401`, `Authentication failed`,
    `could not read Username`, `terminal prompts disabled`, `Permission denied (publickey)`,
    `SAML`) is flagged on the error the way `ADVISORY` already is - **on the error's `name`**, for
    GC-091's reason: Electron serialises a rejected handler down to a string and a property of its
    own never crosses. One more word both processes agree on, in `shared/types.ts`.
  - `GIT_TERMINAL_PROMPT` stops being unconditional. The remote commands are the only ones that can
    ever need a credential, so `RunOptions` grows a flag that lets those three spawn with prompting
    **on**, and `runGit` keeps `'0'` for everything else. `windowsHide: true` stays, so nothing pops
    a console; what this buys is the credential helper's own GUI being allowed to run, which is the
    only thing that can complete an SSO re-authorisation.
  - Because a helper's GUI can hang forever waiting for a person, a remote command spawned that way
    gets a timeout and a Cancel: the modal's Cancel kills the child, and the action reports that it
    was cancelled rather than that it failed.
- **Out of scope:** storing or reading any credential ourselves - the system helper stays the only
  place credentials live and the app never sees one (this is not negotiable, and the acceptance
  says so); adding a Sign in flow, an OAuth client or a token field; SSH key management; the push
  and pull menus themselves.
- **Acceptance:**
  - [ ] A remote command that fails on authentication raises the modal, and the modal shows every
        line git wrote, the `remote:` lines included, not `headline()`'s pick of one.
  - [ ] The modal names the remote and its URL, and Copy puts the whole message on the clipboard.
  - [ ] The status bar still shows a one-line summary, and clicking it reopens the modal.
  - [ ] A non-authentication failure of the same command (a rejected non-fast-forward push, say) is
        **not** flagged and behaves exactly as it does today.
  - [ ] Only `fetch`, `pull` and `push` spawn with prompting enabled; a unit test over `runGit`'s
        option asserts every other command still gets `GIT_TERMINAL_PROMPT=0`.
  - [ ] Cancel kills the child and the action reports cancellation, not failure.
  - [ ] No code path reads, writes, logs or displays a password, token or credential value.
  - [ ] Unit tests for the classifier over the real message texts above, and for the flag surviving
        the IPC round trip the way `ADVISORY` does.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/main/git.ts`, `src/main/ipc.ts`, `src/shared/types.ts`,
  `src/renderer/src/App.tsx`, `src/renderer/src/components/StatusBar.tsx`,
  `src/renderer/src/styles/app.css`, `CLAUDE.md`
- **Verify:** `npm test`, build, launch through `tools/launch-app.mjs` on the scratch repository.
  Reproduce the failure **without touching a real repository**: add a remote pointing at a URL that
  answers 403 (or at a local bare repo made unreadable) and fetch it from the UI, and separately
  drive the classifier over the recorded message texts in a unit test. **Do not reproduce this
  against `catena-feed`** - rule 2 forbids it, and `git ls-remote` shows the same refusal read-only
  if a live sample of the message is ever needed.
- **Log:**
  - 2026-09-06 proposed by GR-020, from Ricardo's inbox: he reported a 403 on `catena-feed` under
    SAML SSO and asked that the app cope with it. Investigating turned a credential story into a
    reporting one - the deeper defect is that `headline()` picks the `fatal:` line and drops the
    two `remote:` lines that say what to do, so the user is shown the least useful sentence git
    wrote, in a 45%-wide ellipsised button whose full text is a hover tooltip. P1 because it is the
    only open ticket that makes the app unusable against the repositories Ricardo actually works
    in, and it was found by the stakeholder rather than by a review.

### GC-170 A stash is a chip on its parent, where GitKraken gives it a row of its own above the tip

- **Status:** todo
- **Area:** graph | **Size:** M | **Priority:** P2
- **Depends on:** GC-140
- **Why:** GC-140 shipped and the chip is genuinely there - confirmed at 23ce5c2 in the running app
  (`%TEMP%/gitclient-review/GR-020/02-stash-in-graph.png`): a 20x20 `span.stash-chip` at the end of
  `main`'s ref cell, carrying an archive glyph and a `title` of
  `stash@{0}: On main: review: a stash to look at`. So the ask is not that GC-140 failed; it is that
  the answer is the wrong shape. **The message never appears on screen at all** - it is a tooltip -
  and 20px of ref column is a costly place to put it: GC-156 had to be written precisely because
  the marker took the room the primary chip's name needed, and it still costs `main` its upstream
  cloud on any row that carries one (compare `01-graph.png` with `02-stash-in-graph.png`).
  Ricardo's screenshot of GitKraken on `catena-feed` shows a different answer and a cheaper one: the
  stash is **a row of its own** at the top of its branch's lane, directly above the branch's tip - a
  circle node drawn with a **dashed outline** carrying a stash icon, the lane line running down from
  it into the tip, and the stash's message in the message column
  (`Auto stash before checking out "origin/008-page-monitor-port"`), selectable like a commit row.
  No chip on the parent at all. The study cannot arbitrate this: `docs/reference/gitkraken/` has
  **no** note on stashes in the graph anywhere - `03-graph.md` does not mention them - which is why
  GC-140 had to invent a shape, and is itself a gap to close.
- **Scope:**
  - A stash becomes a synthetic row in the graph, drawn immediately above the commit it was taken
    from, in that commit's lane: a node with a dashed outline and the stash glyph, the lane line
    continuing down into the parent, and the stash's message in the COMMIT MESSAGE column.
  - The row is selectable like a commit row and takes the same `.selected` treatment. Selecting it
    shows the stash in the detail panel - at minimum its message, its age and its parent; what the
    panel draws for a stash is this ticket's to decide, and the commit view is the shape to copy.
  - Right-click gives `stashMenuItems` and double-click applies, which is what the chip and the
    left-panel row already offer from the same source - the gestures do not change, only where they
    live.
  - The `.stash-chip` on the parent row **goes**, and with it `chipRoom`'s `STASH_CHIP_W` term:
    GC-156's arithmetic must come back to counting only the siblings that remain, rather than being
    left carrying a constant for a marker no row draws.
  - A stash whose parent is outside the loaded range still draws nothing, exactly as today.
  - The lane and row arithmetic is `lanes.ts`' business and must keep its property: splitting a
    history at any row and laying out the halves still equals laying out the whole, with stash rows
    included. Row indices reach `rowIndexOf`, the virtualiser and the WIP row's offset, so every one
    of those has to agree on the new count.
  - Record the shape in `docs/reference/gitkraken/03-graph.md` as an observation, described in our
    own words from Ricardo's screenshot - never copied from GitKraken's markup, CSS or strings.
- **Out of scope:** a stash lane of its own separate from its parent's; stashes whose parent is not
  loaded; the left panel's stash row (GC-150 owns its click, GC-171 its width); editing the message
  (GC-129, shipped).
- **Acceptance:**
  - [ ] With one stash taken on the checked-out branch, the graph draws a row above that branch's
        tip whose message column reads the stash's message, and the tip's ref cell carries no
        `.stash-chip`.
  - [ ] The stash node is drawn with a dashed outline and its lane line runs down into the parent.
  - [ ] Clicking the row selects it; right-click opens `stashMenuItems`; double-click applies.
  - [ ] Two stashes on the same parent draw two rows, in `git stash list` order, newest first.
  - [ ] A stash whose parent is not in the loaded range draws nothing and moves nothing.
  - [ ] `chipRoom` no longer counts a stash marker, and `CommitGraph.test.tsx`'s GC-156 case is
        updated rather than deleted - the cloud must still be kept at a width where it fits.
  - [ ] `lanes.test.ts`'s split-and-rejoin property still holds with stash rows present.
  - [ ] `03-graph.md` gains a stash section, written from the observation and citing nothing of
        GitKraken's own code or strings.
  - [ ] `npm run typecheck` and `npm test` pass, and the e2e suite still passes - its stash steps
        assert against the chip today.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/graph/GraphCell.tsx`,
  `src/renderer/src/graph/lanes.ts`, `src/renderer/src/graph/lanes.test.ts`,
  `src/renderer/src/graph/CommitGraph.test.tsx`, `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/styles/app.css`, `tools/e2e/run.mjs`,
  `docs/reference/gitkraken/03-graph.md`, `CLAUDE.md`
- **Verify:** `npm test`, build, launch through `tools/launch-app.mjs` on the scratch repository,
  take a stash, screenshot into `docs/screenshots/` and look at it beside the description above:
  a dashed node above the tip, the message readable in its own column, no chip on the parent. Then
  take a second stash on the same parent and confirm two rows in list order.
- **Log:**
  - 2026-09-06 proposed by GR-020, from Ricardo's inbox: he asked for the row explicitly and said
    the chip is not what GitKraken does. The build was checked first, as he asked - GC-140's chip
    **is** present at 23ce5c2, so this replaces a shipped answer rather than reporting a missing
    one, which is why it is its own ticket and not a reopening of GC-140. `Depends on: GC-140`
    because the `Stash.parent` field it added is exactly what the row needs.

### GC-171 A stash row spends 66px on its age and leaves its message 77px of the 192 it wants

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-135
- **Why:** measured at 23ce5c2 in the running app, at the **default** 220px left panel
  (`%TEMP%/gitclient-review/GR-020/06-stash-row.png`): the row is 219px, and its four children take
  12px of icon, 5.9px of `.stash-idx`, **77.2px** of `.row-name` against a `scrollWidth` of **192**,
  and **65.9px** of `.row-when`. What is drawn is `On main: re…` - eleven characters, of which
  nine would have been git's own `On <branch>: ` prefix. Every stash git makes carries that prefix,
  so the part that survives is the part that is identical across every stash on the branch: two
  stashes on `main` render as the same row. The age won that space because `.ref-row .row-when`
  is `flex: none` with **no width at all** (`app.css:2150`), so it is content-sized and grows with
  the phrase - `CLAUDE.md` describes it as "`flex: none` at 39px" and "four or five characters",
  which is the ahead/behind readout it was copied from, not what `relativeTime` renders: "2 minutes
  ago" is thirteen characters and 66px, and "11 months ago" is wider still. The same paragraph's
  "at 300px and above the name is back at its natural width" does not hold either - at 300px the
  name gets about 158px of the 192 it wants. GC-135 was right that the age belongs on the row; it
  is the arithmetic that is off, and the message is the half that identifies the stash.
- **Scope:**
  - `.row-when` stops being content-sized on a stash row. Give it a width that does not move with
    the phrase, and let the phrase ellipsise or shorten inside it rather than taking the row's
    remainder - the age is an approximation being read at a glance, the message is an identity.
  - The message gets the remainder and a floor, so that at the default panel width it shows enough
    to tell two stashes apart rather than enough to show the prefix they share.
  - Decide what to do with git's `On <branch>: ` prefix in this row. It repeats the section it is
    in and, on the checked-out branch, the panel header directly above; dropping it in the drawn
    text (never in the `title`, and never in what `stashRename` writes) buys the message nine
    characters at no cost. Whichever way it goes, say why in the code.
  - `CLAUDE.md`'s GC-135 paragraph is corrected in the same commit: the 39px and the "four or five
    characters" are both wrong, and so is the claim about 300px.
- **Out of scope:** the branch row's own ahead/behind readout, which is genuinely four or five
  characters and is not what this measures; the panel's default width; `relativeTime` itself and
  the wording it produces (GC-135 settled those); a stash row's click behaviour (GC-150).
- **Acceptance:**
  - [ ] At the default 220px panel, two stashes taken on the same branch with different messages
        render as two visibly different rows.
  - [ ] `.row-when` on a stash row is the same width for "2 minutes ago" and for "11 months ago".
  - [ ] The full message and the absolute timestamp are still both on the row's `title`.
  - [ ] A `LeftPanel.test.tsx` case pins the drawn message against a long one, so the split cannot
        drift back.
  - [ ] `CLAUDE.md`'s stash-row paragraph states the measured widths rather than the 39px.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`, `CLAUDE.md`
- **Verify:** `npm test`, build, launch through `tools/launch-app.mjs` on the scratch repository,
  take two stashes on the same branch with different messages, screenshot the expanded STASHES
  section at the default panel width and look at it: two rows that can be told apart. Then read the
  children's `getBoundingClientRect().width` back over CDP and check the age's width is unchanged
  by the phrase.
- **Log:**
  - 2026-09-06 proposed by GR-020: found in the UI pass while reproducing an inbox item about
    stashes, on the rotation surface GR-019 did not reach. It is the second half of GC-156's
    lesson one panel over - a piece of furniture sized by its own content taking the room the
    name needed - which is why it is filed rather than left as a note.

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-020 Backlog review 2026-09-06 14:35

- **Status:** done
- **Window:** ae3a492..23ce5c2
- **Log:**
  - 2026-09-06 14:35 inbox: **three items pending**, all three investigated in the code and
    reproduced in the running app, none declined and none left in Pending. They are decided first
    and outside the zero-to-five budget, so this review's own findings are one of the five allowed.
  - inbox 1, pull on `catena-feed` fails with a 403 under the organisation's SAML SSO: confirmed
    from the code, and **not reproduced against `catena-feed`** - rule 2 forbids a write there and
    Ricardo's own `git ls-remote` already showed the refusal read-only, so the item carried its own
    evidence and needed none of mine. Reading the code turned a credential story into a reporting
    one. `runGit` sets `GIT_TERMINAL_PROMPT: '0'` unconditionally on every spawn (`git.ts:85`),
    which is right for the hundred read-only calls a snapshot makes and wrong for the three that
    talk to a remote. But the sharper defect is downstream: `StatusBar`'s `headline()` prefers a
    line matching `/^(error|fatal):|CONFLICT|failed/i`, which on this error picks the `fatal: ...
    403` line and **drops the two `remote:` lines that name SAML SSO and say what to do** - so the
    app shows the least useful sentence git wrote, in a `button.err` at `max-width: 45%`,
    `white-space: nowrap`, ellipsised, whose only full text is a native `title` tooltip.
    **-> GC-169**, at P1: it is the only open ticket that makes the app unusable against the
    repositories Ricardo actually works in.
  - inbox 2, stashes still do not show in the graph: he asked to check whether the build even has
    GC-140's chip, and it does. Took a stash in the review's own scratch repository and confirmed a
    20x20 `span.stash-chip` at the end of `main`'s ref cell with a `title` of
    `stash@{0}: On main: review: a stash to look at` (`02-stash-in-graph.png`). So GC-140 shipped
    and the shape is what is wrong: **the message never reaches the screen at all**, and 20px of
    ref column is expensive - the same row loses `main`'s upstream cloud to it, which is GC-156
    working exactly as designed and is the cost of the chip rather than a defect. The study cannot
    arbitrate: `docs/reference/gitkraken/` has **no** stash note in the graph anywhere, `03-graph.md`
    included, which is why GC-140 had to invent a shape and is itself a gap.
    **-> GC-170**, which replaces the chip with the row he described - dashed node above the tip,
    lane line down into it, message in its own column - and closes the study gap in the same
    commit. Filed as `Depends on: GC-140` rather than as a reopening, since `Stash.parent` is
    exactly what the row needs.
  - inbox 3, left panel sections overflow the panel: **already covered by GC-153**, which GR-017
    wrote from the other end (52 remote branches pushing TAGS and STASHES off) with evidence from
    `catena-feed`. Confirmed unchanged at 23ce5c2: `.left-panel .sections` computes to
    `overflow: auto`, `display: block`, one scroll box over all four. **-> extended GC-153** with
    the one requirement it did not carry - a **minimum height per section**, because "every header
    on screen" is satisfied by a section squeezed to its header alone and his ask is that STASHES
    stays readable, not merely present - plus an acceptance line for it. No new ticket: duplicating
    a ticket the stakeholder has now independently reported twice would be the wrong answer to
    being right about it twice.
  - shipped: **eleven commits**, two batches. `9336964` closes GC-156, GC-157, GC-158, GC-160 and
    GC-161; `72d0694` closes GC-129, GC-134, GC-135, GC-102, GC-117 and GC-122. Read as a reviewer,
    **GC-129** is the one whose correctness is least obvious and it is right: the sha is read before
    the drop that makes it unreachable, the drop is awaited only after the store resolves, and it
    targets `index + 1` because `git stash store` prepends a reflog entry - the comment states all
    three, and the reasoning matches what git actually does. **GC-102** is clean: `rememberedTheme()`
    is read lazily because `index.ts` calls `app.setPath` after the module is imported, both
    failure paths fall back to dark, and the write is wrapped because an unwritable profile should
    only cost the next start one frame. It also quietly fixed a real drift - `index.ts` carried
    `#1b1d22` where `--bg-app` is `#1c1e23`. **GC-134** is a straight move with its tests moved
    with it. No bug found in any diff.
  - verified live rather than from the diffs: **GC-129**'s "Edit message…" row is in the stash
    menu, opened from the graph chip (`04-stash-menu.png`). **GC-135**'s relative times render in
    both places it targeted - `authored 3 minutes ago` on the commit view (`03-commit-view.png`)
    and `2 minutes ago` on the stash row (`06-stash-row.png`). **GC-157**'s parents column gives way
    before the authored date on the fixture's merge commit at the default 400px panel.
    **GC-144**'s dash covers the whole WIP-to-`main` run (`01-graph.png`).
  - health: at 23ce5c2 in the detached worktree with `node_modules` junctioned - **typecheck ok,
    306 tests passed (22 files)** in 2.36s, **build ok**. The build landed in the worktree's own
    `out/` (14:14) and `MAIN/out` kept its 13:56 timestamps: `MAIN` was never built, tested or
    launched.
  - app: the worktree build ran offscreen on 9334 against the review's own scratch root. Six
    screenshots in `%TEMP%/gitclient-review/GR-020/`, all looked at. `01-graph.png` and
    `02-stash-in-graph.png` are the same graph without and with a stash, which is what settled
    inbox 2 and showed GC-156's cloud-dropping as a cost rather than a bug. `03-commit-view.png`
    is the detail panel on the merge commit. `04-stash-menu.png` is the stash context menu.
    `05-shortcuts.png` and `06-stash-row.png` are this review's two rotation surfaces - the
    shortcuts overlay, which no review had screenshotted, where GC-103's scrolling body keeps the
    title and Close fixed and nothing is clipped; and the expanded STASHES section, which is where
    this review's own finding came from.
  - tickets: added **GC-169** (actions, M, P1) and **GC-170** (graph, M, P2) from the inbox,
    extended **GC-153** from it, and added **GC-171** (ui, S, P3) as this review's own single
    finding. **GC-171** is the UI-pass find and it is measured, not impressionistic: at the default
    220px panel the stash row's `.row-name` is drawn at 77.2px against a `scrollWidth` of 192,
    while `.row-when` takes 65.9px because `.ref-row .row-when` is `flex: none` with **no width at
    all** - so what is on screen is `On main: re…`, eleven characters of a prefix every stash on the
    branch shares, and two stashes on `main` render identically. It is GC-156's lesson one panel
    over: furniture sized by its own content taking the room the name needed. No what's-next ticket
    this run - GR-019's two named gaps (Blame, Export to patch) still want the surface decision it
    described, and the inbox supplied three items and most of the budget, so forcing a fourth would
    have been the weak one.
  - board: **GC-169** and **GC-170** go ahead of GC-128, which is still the first unclaimed row and
    still cannot be started - its `Depends on` is GC-026, `todo` - for the third review running.
    Both new ones are eligible immediately and both came from Ricardo. **GC-153 moves up beside
    them and is raised P3 -> P2**: it is the only open ticket that makes the panel wrong on every
    real repository, and the stakeholder has now reported it twice from two directions. GC-171 goes
    after GC-166 and ahead of GC-026, where GR-015 onwards have put their P3 additions. Nothing
    else moved.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081; none can be unblocked from here and all three
    still want a decision from Ricardo. No `todo` ticket has gone vague. Dependencies on the three
    added: GC-169 on nothing, GC-170 on GC-140 and GC-171 on GC-135, both `done`, so all three are
    eligible the moment they are read.
  - notes, and one that is genuinely stale: `CLAUDE.md` at 23ce5c2 says "306 tests today", which
    matched exactly, and its Architecture section is current for GC-129, GC-134, GC-102, GC-117,
    GC-122 and GC-156. But its **GC-135 paragraph is measurably wrong**: it says the stash row's
    `.row-when` "is `flex: none` at 39px" and that "the age is four or five characters", where
    `app.css:2150` gives it `flex: none` and **no width**, "2 minutes ago" measures 65.9px, and the
    following claim that "at 300px and above the name is back at its natural width" does not hold
    either (about 158px of the 192 wanted). That description was the ahead/behind readout it was
    copied from. This review does not edit `CLAUDE.md`; GC-171 carries the correction, which is
    where it belongs since the same ticket changes the widths.
  - isolation: six tickets were `in-progress` throughout (GC-164, GC-163, GC-123, GC-124, GC-127,
    GC-136) and not one was touched; the three ids added start at GC-169, above every id the worker
    holds. `MAIN` was never built, tested or launched, and its working tree was left exactly as
    found - the write below waited for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be clean in
    `git status` and stages only those two, while the worker's own `src/` edits sat uncommitted
    beside them. The only repository written to was the review's own scratch root: one stash taken
    for `02-stash-in-graph.png` and popped back with `--index`, leaving `git status --short` and an
    empty `stash list` byte-identical to what `e2e:setup` created. `catena-feed` was **not opened
    at all** this run - inbox 1 came with its own read-only evidence and inbox 3 was already
    evidenced on GC-153, so there was nothing a real repository was needed for. The review's
    Electron on 9334 was found by command line and stopped by PID tree; zero remained afterwards.
  - the tip moved as usual: `origin/main` is 23ce5c2 and `MAIN` already carries three unpushed
    worker commits above it (GC-164/GC-163 partial, GC-123, GC-124). Those are **out of this window
    and belong to GR-021**, which should read their diffs properly.
