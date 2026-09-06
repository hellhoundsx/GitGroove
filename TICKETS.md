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
| GC-128 | The app can only open a repository that already exists: no clone, no init | actions | M | P2 | todo |
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
| GC-121 | Stage and discard selected lines, not only whole hunks | diff | M | P3 | in-progress |
| GC-048 | Long toolbar labels overflow their 52px button | ui | S | P3 | done |
| GC-066 | A second click on the repository crumb cannot close its dropdown | ui | S | P3 | done |
| GC-071 | The primary ref chip is unreadable at the minimum column width | graph | S | P3 | in-progress |
| GC-074 | The commit menu's Reset rows do not fit the menu, whichever side gives way | ui | S | P3 | in-progress |
| GC-087 | The commit view's ref line is git's decorate string, truncated to "origin/m…" | ui | S | P3 | in-progress |
| GC-091 | The status bar can only report a failure, so a partial success reads as one | ui | S | P3 | in-progress |
| GC-085 | Dead CSS and an unreachable tooltip left over from the one-chip ref column | ui | S | P3 | todo |
| GC-094 | The left panel header counts refs and never says which branch is checked out | ui | S | P3 | todo |
| GC-096 | The branch crumb menu lists every branch, with nothing to narrow it | ui | S | P3 | todo |
| GC-097 | The sequencer guard stashes untracked files git never objected to | actions | S | P3 | todo |
| GC-129 | A stash message cannot be edited once the stash is made | actions | S | P3 | todo |
| GC-134 | remoteCopyOf is inline and untested, and its comment justifies a state git forbids | tests | S | P3 | todo |
| GC-135 | Nothing says how long ago anything happened, and the stash date is fetched and thrown away | ui | M | P3 | todo |
| GC-102 | The window is built dark whatever the theme is, so a light start flashes and keeps dark controls | ui | S | P3 | todo |
| GC-117 | A graph column switched on in Preferences can be silently absent | ui | S | P3 | todo |
| GC-122 | The graph does not scroll while a branch is being dragged | graph | S | P3 | todo |
| GC-123 | A ref folded behind +N can neither be dragged nor dropped on | graph | S | P3 | todo |
| GC-124 | The staged-changes guard reads the snapshot from before a drop’s checkout | actions | S | P3 | todo |
| GC-127 | A chip offers a grab cursor it cannot honour, and lights up less than the row beside it | ui | S | P3 | todo |
| GC-136 | A hidden detail panel has nothing on screen to bring it back | ui | S | P3 | todo |
| GC-137 | The author chip is dropped when a diff opens, while the query survives | graph | S | P3 | todo |
| GC-138 | The diff’s hunk navigation is inline in the component and untested | tests | S | P3 | todo |
| GC-139 | A folder closed in the left panel opens again on every reload | ui | S | P3 | todo |
| GC-143 | The detail panel’s file-kind icons are hairlines, and the commit view draws them as text instead | ui | S | P3 | todo |
| GC-146 | A local branch’s chip carries no icon, and an absorbed chip shows only the remote’s | graph | S | P3 | todo |
| GC-147 | Nothing joins a ref chip to its node across the 30px between them | graph | S | P3 | todo |
| GC-149 | The tab bar has no answer for more tabs than fit across it | ui | S | P3 | todo |
| GC-151 | A repository tab is the one row in the app a right-click does nothing on | ui | S | P3 | todo |
| GC-150 | A stash row in the left panel is inert on a single click, and never says which commit it came from | ui | S | P3 | todo |
| GC-152 | A commit can only be read against its parent, never against the working directory | diff | M | P3 | todo |
| GC-153 | The left panel's four sections share one scroll, so 52 remote branches hide Tags and Stashes | ui | M | P3 | todo |
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

### GC-071 The primary ref chip is unreadable at the minimum column width

- **Status:** in-progress
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
  - 2026-09-06 11:27 claimed

---

### GC-074 The commit menu's Reset rows do not fit the menu, whichever side gives way

- **Status:** in-progress
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
  - 2026-09-06 11:27 claimed

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

---

### GC-087 The commit view's ref line is git's decorate string, truncated to "origin/m…"

- **Status:** in-progress
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
  - Make `commit: <short sha>` in the same header bar copy the full sha when clicked, with a
    `cursor: pointer` and a title saying so. The study's `04-panels.md` point 2 has that line
    clickable to copy; today it is a bare `div.detail-head` with `cursor: auto` and no title
    (GR-015, measured at `5f705ee`). The commit menu's "Copy commit sha" stays — this is the same
    action offered where the sha is already on screen.
- **Out of scope:** the `+N` fold (the panel wraps instead), hover expansion, the WIP view's header,
  the `title` tooltip (it can stay as the full list).
- **Acceptance:**
  - [ ] On the fixture's merge commit (`main`, `origin/main`, `v0.1.0`) the header shows two chips,
        `main` with the cloud mark and `v0.1.0`; no `HEAD -> `, no `tag: `, no ellipsis at 400px.
  - [ ] A commit with no refs shows no ref row and leaves no empty space where one would be.
  - [ ] Clicking `commit: <sha>` in the header copies the full sha, and the cursor and the title
        say it is clickable.
  - [ ] Right-click on the `main` chip opens the branch menu; `npm test` and `npm run e2e` pass.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/graph/CommitGraph.tsx`
  (the chip component moves out), `src/renderer/src/styles/app.css`.
- **Verify:** typecheck, build, a CDP screenshot of the merge commit into `docs/screenshots/`,
  `npm test`, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GR-008: from the screenshot pass — the third review in a row to see this
    line truncated, and the study's panel does not have it at all.
  - 2026-09-06 extended by GR-015: the clickable `commit:` sha, from the same header bar and the
    same paragraph of the study, added here rather than as a ticket of its own.
  - 2026-09-06 11:27 claimed

---

### GC-091 The status bar can only report a failure, so a partial success reads as one

- **Status:** in-progress
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
  - 2026-09-06 11:27 claimed

---

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

---

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

---

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

### GC-121 Stage and discard selected lines, not only whole hunks

- **Status:** in-progress
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
  - 2026-09-06 11:27 claimed

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

---

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

---

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

---

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

### GC-134 remoteCopyOf is inline and untested, and its comment justifies a state git forbids

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-112
- **Why:** GC-112's `remoteCopyOf` (`src/renderer/src/App.tsx:815`) answers "where else does this
  branch live", and it is the only thing between a delete confirmation and a checkbox naming the
  wrong remote. Every comparable decision in this codebase was pulled out of its component so a
  test could hold it — `fitPanels`, `reachedWidth`, `continuesRange`, `alignHunks`, `wordDiff`,
  `canDropRef` — and the closest relative of all, `defaultRemote`, already sits in
  `src/shared/remotes.ts` with its own `remotes.test.ts`. `remoteCopyOf` is a `useCallback` in the
  middle of a 1,300-line component instead, and the window that shipped it added no unit test at
  all (184 tests before, 184 after). Its e2e cover, step 33, exercises one path: one remote,
  upstream present. Untested are the two branches the comment is proudest of — the same-name
  fallback for a branch pushed without `-u`, and a pruned upstream falling through to it. And the
  reason given for the sort is not true: the comment says the longest match wins "because `origin`
  and `origin/fork` are both legal remote names", but git refuses that pair in both directions —
  `git remote add origin/fork` while `origin` exists is
  `fatal: remote name 'origin/fork' is a subset of existing remote 'origin'`, and adding `foo`
  after `foo/bar` is the same fatal the other way round (both verified at `5f705ee`). The sort is
  harmless and may stay; the justification beside it is one a later session would believe.
- **Scope:**
  - Move `remoteCopyOf` into `src/shared/remotes.ts` as a pure function over the refs, the remotes
    and the branch, and call it from `App.tsx`. There is no React in it, and `remotes.ts` is
    already where a menu label and a git call are made to agree.
  - Correct the comment: what the split has to survive is a **branch** name with slashes
    (`origin` + `feature/x` gives `origin/feature/x`), which it already does; git makes the nested
    *remote* case unreachable.
  - Extend `src/shared/remotes.test.ts`: the upstream wins when the snapshot lists it; a pruned
    upstream falls through to a same-name remote ref; a branch on no remote answers `null`; a
    slashed branch name splits at the remote and not at the first slash; a branch whose only copy
    is on a remote the snapshot does not list answers `null`.
- **Out of scope:** changing which remote is chosen when several carry the same branch name (the
  label names it, so the answer is readable), offering more than one copy at once, and the tag
  menu's separate per-remote shape.
- **Acceptance:**
  - [ ] `grep -n remoteCopyOf src/renderer/src/App.tsx` shows an import and its call sites, no
        definition.
  - [ ] The five cases above are named tests in `src/shared/remotes.test.ts`, and `npm test` passes
        with a higher count than 184.
  - [ ] No comment in the tree claims `origin` and `origin/fork` can coexist.
  - [ ] `npm run e2e` still passes step 33 unchanged.
- **Files:** `src/shared/remotes.ts`, `src/shared/remotes.test.ts`, `src/renderer/src/App.tsx`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`.
- **Log:**
  - 2026-09-06 proposed by GR-015: from the code-review pass; the convention the rest of the
    codebase follows, plus a justification checked against git and found false.

---

### GC-135 Nothing says how long ago anything happened, and the stash date is fetched and thrown away

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** GC-133
- **Why:** `grep -rn "ago" src/renderer/src` finds nothing: every timestamp in this app is an
  absolute instant. The study's `06-feature-inventory.md` has
  `Timeline / Time / DateTime | 24 | Relative and formatted dates | Build`, and with GC-128 filed
  against RepoManagement it is now one of the last **Build** rows with nothing shipped against it
  at all. The sharpest instance is the stash list: `Stash.date` is declared in `shared/types.ts`,
  `getStashes` fills it from `%ci`, and `LeftPanel.tsx:219-224` renders the index and the message
  and drops it on the floor. A stash list is exactly where "how old is this" is the question being
  asked, and the answer is already in the snapshot. The commit view's author line is the second:
  `authored 06/09/2026, 09:14:32` gives the instant, and a history is read for the distance.
- **Scope:**
  - `relativeTime(iso, now)` in the `src/renderer/src/time.ts` GC-133 creates: "just now",
    "N minutes / hours / days ago" with singular and plural right, then the absolute date past a
    threshold. Pure, with `now` injected so the test does not depend on the clock.
  - The left panel's stash row renders it in a dim trailing span, and the absolute form joins the
    message already on the row's `title`.
  - The commit view's author line reads `authored 3 hours ago`, with the absolute string as its
    `title`.
  - Boundary tests: 59s, 60s, 23h, 24h, the threshold itself, and a date in the **future**, which a
    commit made under a skewed clock produces and which must not render as "-1 minutes ago".
- **Out of scope:** the graph's DATE / TIME column, which stays exactly as it is — the study names
  that column "COMMIT DATE / TIME" and a column exists to be read down and compared; a preference
  choosing between the two forms; the WIP row; translating the words.
- **Acceptance:**
  - [ ] A stash made a minute ago shows a relative age in the left panel, and hovering the row
        shows the absolute date beside its message.
  - [ ] The commit view's author line shows the relative form with the absolute on hover.
  - [ ] The DATE / TIME column renders byte-for-byte what it renders today.
  - [ ] The boundary tests above exist, `npm test` passes, and `npm run e2e` passes.
- **Files:** `src/renderer/src/time.ts`, `src/renderer/src/time.test.ts`,
  `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** `npm run typecheck`, `npm test`, `npm run build`, then a stash made by hand in the
  scratch repo (the fixture has none at rest) and CDP screenshots of the expanded Stashes section
  and of a selected commit into `docs/screenshots/`.
- **Log:**
  - 2026-09-06 proposed by GR-015: from the what's-next pass; the study's DateTime row is `Build`
    with nothing shipped, and `Stash.date` is already loaded on every snapshot and never drawn.

---

### GC-136 A hidden detail panel has nothing on screen to bring it back

- **Status:** todo
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

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-017 Backlog review 2026-09-06 11:20

- **Status:** done
- **Window:** 7a84981..f85d213
- **Log:**
  - 2026-09-06 11:20 inbox: **`INBOX.md` exists and its Pending section is empty.** All eight
    items GR-016 drained are in Handled with what each became, and Ricardo has added nothing since.
    Nothing was declined and nothing is left unsettled, so this review's additions are its own
    findings and the zero-to-five budget applies in full.
  - shipped: five commits in the window, two of them bookkeeping. `ddfda83` closes **GC-133**,
    **GC-051** and **GC-052**; `9331d9a` is **GC-016**; `f85d213` is the first implementation
    commit of the batch that was still open while this ran. Read as a reviewer, **GC-016** is the
    strongest piece: `tabs.ts` answers the three questions the bar asks as pure functions
    (`readTabs`, `neighbourOf`, `cycle`) rather than inside a click handler, and the two
    decisions that were easy to get wrong are both right - the parked state is keyed by tab **id**
    rather than path, because git rewrites the path under it, and the graph and detail panel get
    **prefixed** keys, because two siblings under one key is not a swap. Verified the failure path
    in the app rather than trusting the log: a tab whose folder does not exist shows the empty state
    with the error named in it and in the status bar, keeps its recents list, and drops only the
    missing path from it (`07-tab-missing-repo.png`) - which is exactly what GC-025's rule asks
    for. One thing I chased and dropped: `GraphCell`'s `dashColor` derives a colour from a
    **lane** index while every other line derives it from a `color` field, which looked like a
    latent mismatch until `lanes.ts` line 127 settled it - `laneColor[i] = i % 10`, so the two
    are the same number by construction and the expression is correct. No bug found in the window.
  - health: at `f85d213` in the detached worktree with `node_modules` junctioned - **typecheck
    ok, 246 tests passed (21 files)** in 2.17s, **build ok**. The worker then pushed `576bd57`
    while this review was being written, so health was re-run at that tip as well: **typecheck ok,
    253 tests (21 files)**. e2e was not re-run: the batch that owns every harness-visible change in
    this window was mid-flight throughout and runs the suite itself in its own step 6, and running
    a second suite against a second scratch root while it did would have measured nothing new.
    `MAIN` was never built, tested or launched.
  - app: the `f85d213` build ran offscreen on 9334, first against
    `%TEMP%/gitclient-review/e2e` and then against `catena-feed` **loaded read-only**.
    Seven screenshots in `%TEMP%/gitclient-review/GR-017/`, all looked at. `01-graph.png`: nine
    rows, lanes continuous, right-angle joins, and GC-144's dashed run now covering the whole
    distance from the WIP node to `main` rather than 14px of it. `02-commit-view.png` is the
    merge commit with both parents linked. `03-diff.png` is GC-052 landed - the two hunk arrows,
    the whitespace and wrap toggles, `Unified | Split`; the toggles carry `.seg-btn.on` with
    `--accent-soft` behind them, so "on" is visible, which I checked in the CSS after the
    screenshot showed both off. `04-prefs.png` is the Preferences dialog with GC-052's new DIFF
    group; all four groups and every documented setting are present and the body scrolls inside the
    modal (GC-103). `05-two-tabs-real-repo.png` is two tabs with an 881-commit repository in the
    second, and is the evidence for GC-153 below. `06-commit-menu.png` is the commit context menu
    on that repository and is fresh evidence for **GC-074**, already `todo`: all three Reset rows
    have their hints cut to `keep all change...`, `keep changes...` and `discard all cha...`.
    `07-tab-missing-repo.png` is the missing-folder tab above.
  - app, the reflow rotation: squeezed the graph panel to 280px and measured what gave way.
    `fitOptCols` had dropped all three optional columns and `fitRefCol` had taken the ref column
    to its 100px floor, leaving the message 104px - which is the documented last-resort behaviour,
    not a defect, because 280 is below `100 + 76 + MIN_MSG_W` and everything had already given
    way. Recorded because the probe is misleading: shrinking the document does **not** move
    `window.innerWidth`, so `fitPanels` never ran and the panels stayed at 220/400 - a real
    narrow window would have reduced them first. A true narrow-window pass needs
    `Emulation.setDeviceMetricsOverride`, which `tools/gk-recon/cdp.mjs` does not expose; GC-105
    and GC-110 both have unit tests covering the arithmetic, so this is a gap in the review's tools
    rather than in the app.
  - what's next: ran the pass GR-016 could not, against
    `06-feature-inventory.md`'s context-menu list. Most of it is already covered or already
    ruled out: the Copy family all exists (`Copy commit sha`, `Copy commit summary`,
    `Copy branch name`, `Copy tag name`, `Copy file path`, `Copy remote URL`), tag creation
    and annotation exist, ahead/behind is rendered on every left-panel row already (`.ab`), and
    Squash / Drop / Move / Interactive rebase are behind `GC-017`, which is `blocked`. What is
    genuinely missing and not blocked: **Compare against working directory** (now GC-152), the tab
    context menu (GC-151), and Blame / History / Export changes to patch, which I did **not** file -
    each is its own M-or-larger ticket and three at once would be a wish list rather than a backlog.
    Naming them here so the next review can pick one up.
  - tickets: added **GC-151** (ui, S, P3), **GC-152** (diff, M, P3) and **GC-153** (ui, M, P3) -
    three of the five allowed. One from the shipped-feature follow-up, one from the what's-next
    pass, one from the UI pass, which is the spread the routine asks for. No existing ticket was
    extended: each of the three was checked against the board first and none was covered. Board:
    GC-151 goes directly below **GC-149** so the two tab-bar tickets are adjacent and a worker can
    take both against one file; GC-152 and GC-153 go after GC-150 and ahead of GC-026, where GR-015
    and GR-016 both put their P3 additions. Nothing else moved, and no reordering was needed -
    GC-128 is still the only P2 and still the first open row a worker meets.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081; none can be unblocked from here and all three
    still want a decision from Ricardo. No `todo` ticket has gone vague. Dependencies: GC-151
    depends on GC-016, which is `done`, so it is eligible immediately; GC-152 and GC-153 depend on
    nothing and touch different surfaces from each other and from GC-151.
  - notes: `CLAUDE.md` at `f85d213` says "229 tests today" against an actual 253 at the tip, and
    its Architecture section does not yet mention the stash marker, the clickable ref row or the
    parked commit draft. That is not stale documentation to report - it is the open batch's step 8,
    which updates `CLAUDE.md` once for the whole batch, and `576bd57` landed while this was being
    written. Checked at that sha and it is current. This review did not edit `CLAUDE.md`.
  - isolation: **six tickets were `in-progress` while this review ran** - GC-145, GC-140, GC-141,
    GC-142, GC-144 and GC-148 - and not one was touched. `MAIN` was never built, tested or
    launched, and its working tree was left exactly as found; `TICKETS.md` and
    `TICKETS-ARCHIVE.md` were both clean in `git status` before this write and are the only files
    staged. The batch closed out at `576bd57` between the poll and the write, so this write is
    built on the post-GC-145 split: GR-016 moved to the archive's Reviews section in the same
    commit, and `576bd57` itself is out of this window and belongs to GR-018. The only repository
    written to was the review's own scratch root; `catena-feed` was opened read-only for the graph
    and closed again, and nothing in it was touched. The review's Electron on 9334 was found by
    command line and stopped by PID.
