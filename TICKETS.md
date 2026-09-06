# GitClient tickets

The backlog of work that can be started right now, in a form an unattended session can pick
up. Every ticket has exactly one status. The per-ticket `Status:` line is the source of truth;
the board table below is a convenience and must be kept in sync whenever a status changes.

Read `CLAUDE.md` before touching any ticket. Its two hard rules apply to every ticket: study
GitKraken, never copy it; never run write operations against Ricardo's real repositories.

**Two files, split by status** (GC-145, GC-174). This one holds everything a session can act on:
the scaffolding, the board of open tickets, every `todo`, `in-progress` and `blocked` ticket, and
the newest review. `TICKETS-ARCHIVE.md` holds every `done` ticket's row and section and every
review a newer one has superseded. So "read `TICKETS.md` fully" means this file only; the archive
is looked up by id when a finished ticket's history is actually wanted. The session that sets a
ticket to `done` moves its row and section to the archive in the same commit, and the reviewer
moves the review it supersedes when it writes a new one — `tools/repo-hygiene.test.ts` fails if
the two files ever disagree. And a run reads neither file until `node tools/backlog.mjs` has said
there is a batch to take: most runs are answered by that one line.

## Statuses

| Status | Meaning | Who sets it |
| --- | --- | --- |
| `todo` | Ready to start. Scope and acceptance criteria are written down. | Ricardo (or a session adding a ticket) |
| `in-progress` | Claimed by the running batch. Its presence tells every other worker run to exit; one batch sets it on several tickets at once. Reviews never use it. | The session that claims it |
| `done` | Implemented, verified, committed and pushed. | The session that finished it |
| `blocked` | Cannot proceed without a decision, a design or another ticket. Reason is in the log. | Anyone |

Ricardo can reopen a `done` ticket by setting it back to `todo` with a log line saying why, and
moving its row and section back from the archive in the same edit.

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

0. **Sync, before reading anything.** `git pull --ff-only origin main`. If the pull fails
   (network, authentication, non-fast-forward), stop and report; never work while pushes cannot
   land. Then `git status --porcelain` must be empty. If it is not, a previous run died mid-work:
   stop and report, do not clean up. The one exception is a tree holding exactly the unfinished
   work of a batch whose claim is already on `origin/main` — finishing that close-out is better
   than leaving its lock stranded, but say so in the report.
1. **Ask the backlog, not the files.** `node tools/backlog.mjs` prints one line (GC-174):
   `locked: …` when any ticket is `in-progress` — a batch is running, exit; if the claim it names
   is older than six hours, say so in the report so Ricardo can inspect, and still do not take it
   over — `nothing eligible`, exit; or `eligible: …`, the batch, already selected by the rule in
   step 3. Most runs end here having read nothing else: `CLAUDE.md` and this file together came
   to about 56k tokens, and a run that exited at the lock used to read both first.
2. **Read**, now that there is a batch. `CLAUDE.md`, then this file in full — this file only.
   Every finished ticket's row and section live in `TICKETS-ARCHIVE.md` (GC-145, GC-174), which is
   not read at all unless a specific ticket's history is wanted.
3. **The batch** is what step 1 printed. This is the rule it applies, for checking one by hand:
   walk the board top to bottom, which is priority order; a row is eligible when it is `todo` and
   every ticket in its `Depends on` is `done`, which now means a row on the archive's board; take
   up to six eligible tickets in that order, or just one if the first eligible ticket is size L.
   There is no file-disjointness requirement, since one session working through them in order
   never touches two tickets' files at the same instant.

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
   screenshot paths). **A log line is one sentence** (GC-174): the date, what happened and its
   evidence; what was learned belongs in the ticket's Why, or in `CLAUDE.md` when it is an
   invariant, because a log is read by id later to learn what became of the ticket, and a
   forty-line entry costs every later reader what it cost to write. **A ticket that becomes
   `done` has its section and its board row moved to `TICKETS-ARCHIVE.md` in the same commit**
   (GC-145, GC-174) — status change and move together, never one without the other, or `npm
   test`'s backlog check fails. A ticket that becomes `blocked` stays here, row and section: it
   is still work someone can pick up.

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

> Open `C:/Users/Ricar/Documents/apps/GitClient`. Run `git pull --ff-only origin main`, then
> `node tools/backlog.mjs`. If it prints `locked` or `nothing eligible`, exit and say so, having
> read nothing else. If it prints `eligible`, read `CLAUDE.md`, then follow the "Routine
> protocol" in `TICKETS.md` exactly from step 2: claim that batch and implement it yourself, one
> ticket at a time, no subagents; verify centrally, take each through to `done` or `blocked`
> committed and pushed on `main`, and report the batch, final statuses and commit shas.

That text is a template. The saving lands only once the scheduled task's own prompt says the
same, since that prompt is what a run reads first.

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
  and screenshots a representative spread with `screenshot(target, { scale: 0.5 })` from that
  module — half scale is a quarter of the image tokens and plenty for a reviewer's own eyes; only
  `docs/screenshots/`, which Ricardo reads, is taken at full scale (GC-174). The spread: the
  graph, a commit, the staging view, a diff, and

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

Every ticket a session can act on has a row here, in priority order — `todo`, `in-progress` and
`blocked`. **The status cell is also where the row and the section live**: a row that says `done`
belongs on the board in `TICKETS-ARCHIVE.md`, beside its section, and moves there in the same
commit as the status change (GC-145, GC-174); every row here has its section under Tickets below.
That mapping is total and machine-checked by `tools/repo-hygiene.test.ts`, which is why it is
stated once here rather than as a link in each row: this table has been corrupted before by an
edit built from a string, and the fewer things that rewrite a row, the better. The two boards
together are the whole history; `node tools/backlog.mjs` reads both.

| ID | Title | Area | Size | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| GC-179 | The left panel’s ref filter follows a tab switch, and the other repository looks empty | ui | S | P1 | in-progress |
| GC-180 | A conflicted file opens a diff pane that is blank, with live buttons over it | diff | M | P1 | todo |
| GC-128 | The app can only open a repository that already exists: no clone, no init | actions | M | P2 | in-progress |
| GC-181 | A conflict can be marked resolved but never resolved | actions | S | P2 | todo |
| GC-182 | The graph’s WIP row has a text field wired to nothing | graph | S | P2 | todo |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-143 | The detail panel’s file-kind icons are hairlines, and the commit view draws them as text instead | ui | S | P3 | in-progress |
| GC-146 | A local branch’s chip carries no icon, and an absorbed chip shows only the remote’s | graph | S | P3 | in-progress |
| GC-147 | Nothing joins a ref chip to its node across the 30px between them | graph | S | P3 | in-progress |
| GC-149 | The tab bar has no answer for more tabs than fit across it | ui | S | P3 | in-progress |
| GC-151 | A repository tab is the one row in the app a right-click does nothing on | ui | S | P3 | todo |
| GC-150 | A stash row in the left panel is inert on a single click, and never says which commit it came from | ui | S | P3 | todo |
| GC-152 | A commit can only be read against its parent, never against the working directory | diff | M | P3 | todo |
| GC-159 | The remote menu can copy a URL but cannot open the remote on its hosting service | actions | S | P3 | todo |
| GC-165 | The empty state’s recents paths ellipsise at the wrong end, unlike the menu’s | ui | S | P3 | todo |
| GC-173 | An empty tab given a repository that is already open is left behind | ui | S | P3 | todo |
| GC-166 | A file can be diffed but never followed: no history for one path | graph | M | P3 | todo |
| GC-171 | A stash row spends 66px on its age and leaves its message 77px of the 192 it wants | ui | S | P3 | todo |
| GC-175 | The light theme is a mechanical inversion of the dark one, and every surface boundary is weaker | ui | M | P3 | todo |
| GC-177 | Which left-panel sections are open is forgotten on every reload | ui | S | P3 | todo |
| GC-178 | A selected stash says what it is and offers nothing to do with it | ui | S | P3 | todo |
| GC-017 | Interactive rebase editor | actions | L | P3 | blocked |
| GC-018 | Undo and Redo | actions | L | P3 | blocked |

Priority: P0 do first, P3 nice to have. Size: S under two hours, M half a day, L a day or more.

---

## Adding a ticket

Copy a section, give it the next `GC-0NN`, fill every field, add a row to the board. A ticket
is only `todo` when its scope, acceptance criteria and verification steps are concrete enough
that a session with no other context could finish it. Otherwise mark it `blocked` and say what
decision is missing.

A log line is one sentence: the date, what happened, and its evidence (GC-174). Reasoning goes
in the Why; an invariant goes in `CLAUDE.md`.

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

- **Status:** in-progress
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
  - 2026-09-06 16:08 claimed

---

### GC-143 The detail panel's file-kind icons are hairlines, and the commit view draws them as text instead

- **Status:** in-progress
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
  - 2026-09-06 16:08 claimed

---

### GC-146 A local branch's chip carries no icon, and an absorbed chip shows only the remote's

- **Status:** in-progress
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
  - 2026-09-06 16:08 claimed

---

### GC-147 Nothing joins a ref chip to its node across the 30px between them

- **Status:** in-progress
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
  - 2026-09-06 16:08 claimed

---

### GC-149 The tab bar has no answer for more tabs than fit across it

- **Status:** in-progress
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
  - 2026-09-06 16:08 claimed

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
  - 2026-09-06 GR-020, after the review was committed: the scope above asks whoever takes this to
    decide what to do with git's `On <branch>: ` prefix. **GitKraken strips it** - a capture
    Ricardo sent renders `On 008-page-monitor-port: est` as `est`. So the decision is made, and
    the nine characters it buys the message are the cheapest part of this fix. GC-170 carries the
    same rule for the graph row, and the two must agree: strip for display only, never in the
    `title` and never in what `stashRename` stores.

---

### GC-175 The light theme is a mechanical inversion: every surface boundary is weaker than its dark counterpart

- **Status:** todo
- **Area:** ui | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** measured at cfe9aa9 in the running app by reading the tokens back over CDP and
  computing the WCAG ratio between each pair of adjoining surfaces
  (`%TEMP%/gitclient-review/GR-021/08-graph-light.png`, `09-diff-light.png`). The two themes are
  not the same design at two lightnesses; the light one is systematically flatter:

  | adjoining pair | light | dark |
  | --- | --- | --- |
  | `--bg-panel` over `--bg-app` | **1.066** | 1.161 |
  | `--bg-toolbar` over `--bg-titlebar` | **1.059** | 1.155 |
  | `--bg-titlebar` over `--bg-app` | **1.126** | 1.210 |
  | `--bg-panel-raised` over `--bg-app` | **1.119** | 1.378 |
  | `--bg-menu` over `--bg-panel` | **1.194** | 1.426 |

  Two of those are not close: a context menu floating over a panel gets 1.19 where dark gives it
  1.43, and every raised surface — the menu, a chip, an input — sits at 1.12 over the app where
  dark gives 1.38. The line loses on the same trade: `--border` is `rgba(0, 0, 0, 0.1)` in light
  against `rgba(255, 255, 255, 0.08)` in dark, and because the two sit at opposite ends of the
  sRGB transfer curve the black-at-0.1 line over a near-white surface is the *smaller* luminance
  step of the two. So light is drawn with both a weaker fill and a weaker line at every boundary
  in the app, which is why the title bar, the tab bar, the toolbar and the status bar read as one
  undivided white strip in `08-graph-light.png` and the graph panel and the detail panel do not
  separate at all. The text ramp is not the problem and should be left alone: `--text-dim` over
  `--bg-panel` measures 3.25:1 in light against 3.56:1 in dark, which is the same design.

  The values themselves were never wrong so much as never looked at. GC-013 built the light
  palette by redefining the same token names under `:root[data-theme='light']`, which is the right
  structure and is what makes this fixable in one file; what it did not get is the calibration pass
  the dark ramp had against GitKraken's measurements (`02-design-tokens.md`). Nothing in the study
  records GitKraken's light palette either, and its own inventory row for Theme reads "Dark / light
  only since 11.8 — **Build both**" (`06-feature-inventory.md`), so half the feature is shipped
  untested by eye. It is filed P3 rather than higher because dark is the default, is what the main
  process remembers, and is what Ricardo works in — this is a preference nobody is currently
  stranded by, not a bug in a path anyone is on.
- **Scope:**
  - Recalibrate the light block of `tokens.css` so the surface ramp holds the same *relationships*
    the dark one does, rather than the same absolute lightnesses inverted. The five pairs in the
    table are the acceptance measure; matching dark's ratio to within a reasonable margin on each
    is the target, and the ordering must stay the same (app is the ground, panel sits on it,
    raised and menu sit above that).
  - `--border` in light gets a value that produces a comparable luminance step to dark's, which
    almost certainly means a larger alpha than 0.08 — decide it by measurement, not by matching
    the number.
  - Look at the result, in both themes, on the same four surfaces: the graph, a commit, the
    staging view and an open diff, plus one floating layer (a context menu over a panel) since
    that is the pair that is furthest off.
  - Record the light ramp in `docs/reference/gitkraken/02-design-tokens.md` as **our** calibration
    with the ratios it was built to, the way the dark one is recorded — the study has no light
    palette of GitKraken's to compare against, so what goes there is our own measured values and
    the reasoning, clearly marked as ours.
- **Out of scope:** the text ramp (`--text`, `--text-muted`, `--text-dim`, `--text-bright`), which
  measures equivalently in both themes; the accent and the semantic colours; the ten lane colours,
  whose adjacent-pair separation GC-113 already pins in both themes; the dark palette, which is
  calibrated and must not move; adding a third theme; and any change to how `prefs.ts` resolves
  `system` or how the main process remembers the theme (GC-013, GC-102 settled both).
- **Acceptance:**
  - [ ] In light, `--bg-panel`/`--bg-app`, `--bg-toolbar`/`--bg-titlebar`, `--bg-panel-raised`/
        `--bg-app` and `--bg-menu`/`--bg-panel` each measure within 0.03 of the dark theme's ratio
        for the same pair, read back from the running app rather than computed by hand.
  - [ ] `--border` in light produces a luminance step against `--bg-panel` comparable to dark's.
  - [ ] The title bar, the toolbar and the status bar are distinguishable from each other and from
        the graph in a light screenshot, and the graph panel and the detail panel separate.
  - [ ] Screenshots of the four surfaces plus a context menu, in light, are in
        `docs/screenshots/` and were looked at beside the dark ones.
  - [ ] `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' src/renderer/src/styles/app.css` still prints
        nothing: every value changed is a token.
  - [ ] `docs/reference/gitkraken/02-design-tokens.md` carries the light ramp and its ratios,
        marked as our calibration rather than as an observation of GitKraken.
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/styles/tokens.css`,
  `docs/reference/gitkraken/02-design-tokens.md`, `docs/screenshots/`.
- **Verify:** build, launch through `tools/launch-app.mjs` on the scratch repository, switch the
  theme through Preferences, and screenshot the graph, a commit, the staging view, a diff and an
  open context menu in each theme. Read the ratios back over CDP with the same computation the Why
  used — `getComputedStyle(document.documentElement).getPropertyValue(name)` for each token, then
  the WCAG formula over the pairs — and put the two columns of numbers in the log.
- **Log:**
  - 2026-09-06 proposed by GR-021: the light theme is a shipped preference no review had ever
    looked at, and the rotation pass found it flat; the numbers above are what turned that
    impression into a ticket, and they say the defect is the surface ramp rather than the text.

### GC-177 Which left-panel sections are open is forgotten on every reload

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-153
- **Why:** the open set is `LeftPanel` state seeded from a default — LOCAL and REMOTE open, TAGS
  closed, STASHES open when there are stashes — so opening TAGS on a repository with 283 of them
  lasts until the next reload, and the watcher's own reloads do not clear it only because the
  component stays mounted. GC-153 made this cost more than it did: which sections are open now
  decides how the column is shared, so a user who arranged the panel loses the arrangement and not
  just a disclosure triangle, while the heights they dragged do survive. GC-139 is the same defect
  one level in, for folders, and says the same thing about a set that is remembered nowhere.
- **Scope:**
  - The open set joins the remembered state: its own `localStorage` key, per repository or not —
    the heights (`gitclient.sectionHeights`) are global and this should match them, since the
    sections are the same four in every repository.
  - A missing or hand-edited value falls back to today's defaults, the way `readSectionHeights`
    does, and a stored set that names no section at all is treated as absent rather than as "all
    closed".
  - The default when nothing is stored does not change (GC-153's out-of-scope line still holds).
- **Out of scope:** remembering which folders are open (GC-139 owns that), and the section context
  menu `04-panels.md` records.
- **Acceptance:**
  - [ ] Opening TAGS and reloading comes back with TAGS open, and the heights unchanged.
  - [ ] A hand-edited or absent key falls back to the current defaults.
  - [ ] A `LeftPanel.test.tsx` case for the round trip.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `CLAUDE.md`.
- **Verify:** `npm test`, build, launch through `tools/launch-app.mjs`, open TAGS, reload over CDP
  and read the section states and the stored key back.
- **Log:**
  - 2026-09-06 proposed by GC-153 (this ticket): its share is decided by which sections are open,
    and that set is the one piece of the panel's arrangement nothing remembers.

---

### GC-178 A selected stash says what it is and offers nothing to do with it

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-170
- **Why:** GC-170's stash row is selectable, and selecting it draws a stash view in the detail
  panel: the message, its age, the commit it came from and the files it holds. Every other thing
  the panel can show offers something to do with it — the staging view commits, the commit view
  restores a file from a commit — and this one offers nothing at all. Applying, popping or dropping
  the stash the panel is showing means going back to the row and using its context menu, which is
  the gesture the panel exists to save. `stashMenuItems` already carries the four actions and
  `App` already hands the graph two stash handlers, so the panel is the one surface that has the
  stash and not the actions.
- **Scope:**
  - The stash view's header gets the actions `stashMenuItems` offers, as buttons or as one menu:
    Apply, Pop, Edit message, Drop. Wording and confirmation come from that one source, so a stash
    dropped from here asks exactly what dropping it from the left panel asks.
  - Whatever runs them goes through `App`'s `run()`, like every other git action.
- **Out of scope:** the graph row's own gestures (GC-170 settled them), the left panel's row
  (GC-150, GC-171), and any new stash operation — this is the existing four in a second place.
- **Acceptance:**
  - [ ] The stash view offers Apply, Pop, Edit message and Drop, from `stashMenuItems`.
  - [ ] Dropping from here asks the same question dropping from the left panel asks.
  - [ ] After an action the panel goes back to what the selection then is, rather than showing a
        stash that no longer exists.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, launch on the scratch repository, take a stash, select its row and
  drop it from the panel; assert against `git stash list`.
- **Log:**
  - 2026-09-06 proposed by GC-170 (this ticket): the stash view it added is the only thing the
    detail panel can show that offers no action on what it is showing.

---

### GC-179 The left panel's ref filter follows a tab switch, and the other repository looks empty

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** GC-016
- **Why:** `LeftPanel`'s `filter` is component state and the panel is not keyed by repository, so a
  query typed in one tab is still in the box when another tab is shown — filtering a repository the
  user never filtered. Measured over CDP at 28f0980 with two tabs open: with `release` typed in the
  fixture's panel (3 rows drawn), clicking the second tab left `filter: "release"` in the field and
  drew **zero** `.ref-row` elements, on a repository whose LOCAL section holds `main` and
  `zebra-only`. Nothing on screen says why: the sections show their real counts in their headers
  and no rows under them, which reads as a repository with no branches rather than as a filter.
  It is the same lesson as GC-030 and GC-137 one panel over — a piece of the user's own input
  living in a component whose lifetime is not the thing it describes — and GC-016's rule is that
  what a tab was left with is parked with the tab. The find bar's query and its author chip are
  both in `TabState` for exactly this reason; the ref filter is the one input that is not.
- **Scope:**
  - The ref filter belongs to the tab: either `App` holds it as part of `TabState` beside the find
    bar's `search`, or it is cleared when the repository the panel is drawing changes. The first is
    the one GC-016 asks for and the one that keeps a filter across a switch away and back.
  - Whichever it is, `Ctrl+Alt+F`'s focus tick keeps working and no new `window` listener appears.
- **Out of scope:** the folded set and the section heights, both already remembered (GC-139,
  GC-153); the graph's find bar, which is already parked; and any change to what the filter matches.
- **Acceptance:**
  - [ ] With two repositories open and a query typed in the first, switching to the second shows an
        unfiltered panel.
  - [ ] Switching back shows the first tab's query and its filtered rows again.
  - [ ] A component or `tabs.ts` test covers whichever half is pure.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`
- **Verify:** `npm test`, build, then over CDP with two repositories in `gitclient.tabs`: type a
  query in the first, click the second tab and read the field's value and the row count back.
- **Log:**
  - 2026-09-06 proposed by GC-139 (this ticket): found while giving the closed-folder set a
    per-repository key — the folded set now follows the path and the filter beside it does not.
  - 2026-09-06 16:08 claimed

---

### GC-180 A conflicted file opens a diff pane that is blank, with live buttons over it

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P1
- **Depends on:** —
- **Why:** Reproduced at `3def19a` in a throwaway repository (one file, one content conflict on a
  merge), driven over CDP: clicking the row in Conflicted Files opens the file view and
  `.diff-body`'s `innerHTML` is the **empty string** — not "No textual changes.", not "Binary
  file.", not an error, nothing at all — while the header still reads `f.txt +0 -0` and both
  `Stage file` and `Discard changes` are enabled over it. The cause is that git answers an
  unmerged path with a **combined** diff: `diff --cc f.txt`, `@@@ -1,3 -1,3 +1,7 @@@`, and two
  prefix columns instead of one. `parseUnifiedDiff` keys on `diff --git ` and on `HUNK_RE`, so
  neither matches: its `if (!file) file = startFile()` fallback still creates a file, every line
  falls into `headerLines`, and the result is one file with **zero hunks** and `binary: false`.
  `DiffView`'s four `.diff-empty` branches are `loading`, `loadError`, `text !== null && !file`
  and `file.binary` — a truthy file with no hunks falls through all four and `file.hunks.map`
  renders nothing. So the one screen a user needs during a merge is the one screen that shows
  nothing, and it shows nothing silently. `Discard changes` compounds it: `fileMenuItems`
  deliberately withholds discarding from a conflicted row because git refuses `checkout --` on an
  unmerged path, and the file-view header offers it anyway.
- **Scope:**
  - `DiffView` can never render an empty body: a parsed file with no hunks takes the same
    `.diff-empty` treatment as no file at all, so a payload nothing understands says so rather
    than drawing a void. This is the guard, not the fix.
  - `parseUnifiedDiff` learns the combined form: a `diff --cc <path>` (and `diff --combined`)
    header names the file, an `@@@ -a,b -c,d +e,f @@@` header opens a hunk, and a line carries one
    prefix column per parent plus the merged column. What the view draws from it is one column of
    code with each side's contribution marked; the conflict markers git wrote into the working
    tree are part of the file and are shown as they are.
  - The file-view header follows the rule the row's menu already applies to a conflicted file:
    `Discard changes` is absent, and the staging button says what `fileMenuItems` says
    ("Mark resolved").
  - Every button built from `hunk.raw` stays off for a combined diff, for the reason `-w` turns
    them off (GC-086): it is not a patch `git apply` will take.
- **Out of scope:** a three-way merge editor (the study's own "Later"), line picking on a
  conflicted file, resolving a conflict (GC-181), and the octopus case of more than two parents —
  parse it without crashing, do not design for it.
- **Acceptance:**
  - [ ] Opening a conflicted file never leaves `.diff-body` empty: a driver reading `innerHTML`
        finds either hunks or a `.diff-empty` message.
  - [ ] The conflicted file's hunks are drawn, with both sides' lines distinguishable.
  - [ ] The file-view header on a conflicted file does not offer `Discard changes`.
  - [ ] `parseDiff.test.ts` covers a real `diff --cc` payload as a fixture string, including the
        zero-hunk guard, and no test calls git.
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/diff/parseDiff.ts`, `src/renderer/src/diff/parseDiff.test.ts`,
  `src/renderer/src/diff/DiffView.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** build, then in a **throwaway** repository under `%TEMP%` (never the fixture, never a
  real repository) make two branches change one line and merge them; launch through
  `tools/launch-app.mjs`, open the conflicted file and read `.diff-body` `innerHTML` over CDP.
- **Log:**
  - 2026-09-06 proposed by GR-022: reproduced at `3def19a` — the conflicted file's diff body is the
    empty string, because git's combined diff parses to a file with no hunks and `DiffView` has no
    branch for that.

---

### GC-181 A conflict can be marked resolved but never resolved

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** —
- **Why:** The staging banner says "merge in progress with 1 conflicted file. Resolve them, then
  mark as resolved." and the app offers no way to resolve one. Read off the running app at
  `3def19a`, a conflicted row's context menu is exactly `Mark resolved`, `Open file`, `Show in
  folder`, `Copy file path` — so the only resolution this client supports is leaving for an
  external editor, or `Abort merge`. Every operation that reaches this state is one the app itself
  starts: merge and rebase from a drag (GC-015), cherry-pick and revert from the commit menu, a
  conflicting stash pop (GC-092). Git already has the two answers that cover most conflicts,
  `checkout --ours` and `--theirs`, and neither is reachable from anywhere in the UI. The study
  lists a built-in three-way merge tool as "Later" (`06-feature-inventory.md`); picking a side is
  not that tool, and it is what turns a dead end into a workflow.
- **Scope:**
  - `git.ts` gains `resolveConflict(cwd, path, side)`: `git checkout --ours|--theirs -- <path>`
    followed by `git add -- <path>`, one function making both calls, so a resolved row leaves the
    Conflicted group in one action rather than needing `Mark resolved` afterwards.
  - A conflicted row's context menu gains the two, above `Mark resolved`, worded by what they mean
    rather than by git's flag. During a rebase "ours" and "theirs" are the reverse of what a user
    expects, so the labels must be derived from the operation the snapshot reports, not hard-coded.
  - Both are **absent, not disabled**, on a conflict `--ours` cannot answer (GC-072's rule): a
    delete/modify or add/add conflict where one side has no blob makes `checkout --ours` fail, so
    those rows keep `Mark resolved` alone.
  - The actions go through `App`'s `run()` like every other git action.
- **Out of scope:** a three-way merge editor, resolving a whole group at once, showing the
  conflict's two sides (GC-180), and any change to `Mark resolved` or to Abort.
- **Acceptance:**
  - [ ] A content conflict can be resolved to either side from the row's menu, and the row moves
        to Staged in one action.
  - [ ] The two labels name the right side during a rebase as well as during a merge, and the
        ticket log says how that was checked.
  - [ ] A conflict `--ours` cannot answer offers neither row rather than a failing one.
  - [ ] Unit tests cover `resolveConflict`'s two calls and their order through the `GitRunner`
        seam, as `stashRenameWith` is covered (GC-167).
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/main/git.ts`, `src/main/git.test.ts`, `src/main/ipc.ts`,
  `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx`.
- **Verify:** `npm test`, build, then in a **throwaway** repository under `%TEMP%` (never the
  fixture, never a real repository) create a content conflict, resolve it each way through the
  menu, and assert with `git status --porcelain` and `git show :0:<path>` that the staged blob is
  the side that was asked for.
- **Log:**
  - 2026-09-06 proposed by GR-022: the conflicted row's menu was read off the running app and
    offers nothing that resolves anything, on a state four of the app's own actions produce.

---

### GC-182 The graph's WIP row has a text field wired to nothing

- **Status:** todo
- **Area:** graph | **Size:** S | **Priority:** P2
- **Depends on:** GC-148
- **Why:** `CommitGraph.tsx` renders the WIP row's message cell as
  `<input className="wip-input" placeholder="// WIP" spellCheck={false} onClick={stopPropagation} />`
  — no `value`, no `onChange`, no `onKeyDown`, no ref. Measured at `3def19a` over CDP: typing
  `typed into the graph` into it leaves the staging form's Commit summary empty, pressing Enter
  opens nothing and reports nothing, and the text is still sitting in the row after a Refresh that
  bumped `data-gen`. It is an uncontrolled DOM node, so what was typed is lost the moment the row
  is virtualised out of a long history, a file view opens, or a tab is switched — which is exactly
  the reason GC-148 moved the commit draft out of the panel and into `App` state, and GC-030 moved
  the find bar's query before it. The study describes this field as GitKraken's inline commit
  input (`03-graph.md`, "WIP row"): a summary typed in the graph, committed from there. Ours looks
  like that and is a decoy — a field that accepts input and silently drops it is worse than no
  field, and screenshot `10-conflict-staging.png`'s predecessor in `%TEMP%/gitclient-review/GR-022`
  shows the two side by side, the graph holding text while the summary box below is empty.
- **Scope:**
  - The field becomes the summary half of the commit draft `App` already holds (GC-148): it reads
    that value and writes it, so typing here types in the staging form and the other way round,
    and it is parked and restored with its tab as the rest of `TabState` is.
  - Enter commits what is staged, through the same call the staging form's button makes and under
    the same rule — nothing staged, or an empty summary, does nothing and says nothing.
  - The commit clears the draft exactly as a commit from the panel does; there is one draft, not
    two.
- **Out of scope:** the description body and the 72-character counter (the row is one line),
  amend, inline branch and tag creation on the row (the study lists those separately), and any
  change to the staging form itself.
- **Acceptance:**
  - [ ] Typing in the graph's WIP field puts the same text in the staging form's summary, and the
        reverse, measured over CDP.
  - [ ] The text survives opening a file view, switching tabs and coming back, and a reload that
        bumps `data-gen`.
  - [ ] Enter with something staged and a non-empty summary makes the commit; with nothing staged
        it does nothing.
  - [ ] `CommitGraph.test.tsx` covers the field being controlled, and `npm run typecheck`,
        `npm test` and `npm run build` pass.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`,
  `src/renderer/src/graph/CommitGraph.test.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, launch on the scratch repository, type in the graph field and read
  the staging form's input over CDP; commit with Enter and assert with `git log -1`.
- **Log:**
  - 2026-09-06 proposed by GR-022: measured over CDP at `3def19a` — the field takes typing, the
    staging summary stays empty, Enter does nothing, and the text lives only in an uncontrolled DOM
    node. If Ricardo would rather the graph did not commit at all, the alternative is to make the
    cell a non-interactive `// WIP` label; what is not acceptable is a field that keeps nothing.

---

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-022 Backlog review 2026-09-06 16:35

- **Status:** done
- **Window:** cfe9aa9..3def19a
- **Log:**
  - 2026-09-06 16:35 inbox: `INBOX.md` exists and its **Pending section is empty** — GR-020 drained
    the last three items and Ricardo has added none since. Nothing to investigate, nothing declined,
    nothing left in Pending, and the file is not rewritten this run. The whole budget went to the
    reviewer's own passes.
  - shipped: **thirteen commits**, seven of them code, covering two batches. `084a779` and
    `35f5940` are the previous batch's work that GR-021 explicitly left to this review (GC-172,
    GC-169, GC-170, GC-153, GC-137, GC-138), `eff57e2` and `cabc4c6` finish and close it out;
    `2d5bab0` is GC-026, `92f5d55` GC-176 and GC-167, `35acc13` GC-168, `ff1b54f` GC-162,
    `28f0980` GC-139, `182ea10` the close-out, `3def19a` the current claim. Read as a reviewer,
    **no bug found in any diff.** GC-169 is the largest and is sound: `runRemote` flags only a
    failure `isAuthMessage` recognises, so a non-fast-forward push keeps behaving as it did, the
    URL lookup is best-effort and cannot fail the report, and the prompting child is registered,
    timed and unregistered on every exit path including `error`. GC-176's test naming the six
    functions that reach it is the right shape — a convention that cannot drift silently. GC-139's
    render-phase `setFolded` on a path change is the `DiffView` pattern rather than an effect, and
    its prune settles in one pass because it only ever shrinks. GC-153's `fitSections` level-by-level
    fill was read line by line: it terminates, and its one rough edge — a proportional split that
    clamps a section to `min` can overshoot `avail`, leaving the last section to absorb the drift —
    is unreachable in any geometry the four sections produce and the column scrolls if it were, so
    it is noted here rather than ticketed. Acceptance evidence is present in every ticket log I
    spot-checked.
  - health: at `3def19a` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    406 tests passed (25 files)** in 3.21s, **build ok**. One pre-existing `act(...)` warning from
    `DetailPanel.test.tsx`; it is a warning, not a failure, and predates this window. The build
    landed in the worktree's own `out/`; `MAIN` was never built, tested or launched.
  - app: the worktree build ran offscreen on 9334 against the review's own scratch root. Eleven
    screenshots in `%TEMP%/gitclient-review/GR-022/`, all looked at. `01`-`04` are the graph, a
    commit, the staging view and an open diff and show nothing new. `06`/`07` are **GC-170's stash
    row**, this window's most visible shipped surface, driven end to end: stashing from the toolbar
    put a dashed-node row with a `STASH` label directly above its parent commit, selecting it drew
    the stash view with the whole message, its age, `taken from: c4bdfe0` and the four files, and
    popping it restored the fixture exactly — `M README.md` staged beside ` M a.txt`, ` M big.txt`,
    `D main.txt`, `?? new.txt`, so `--index` held. `09` is **GC-026's dialog**: two labelled fields,
    OK disabled until both are answered. `08` is the branch menu, which is well-formed and whose
    Fast-forward row I checked is correctly conditional rather than missing.
  - the rotation surfaces were the **conflict path** and the **WIP row**, and both produced this
    review's tickets. A conflict was made in a throwaway repository under `%TEMP%` — never the
    fixture, never a real repository — and opened as a second tab. **-> GC-180:** clicking the
    conflicted file opens a file view whose `.diff-body` `innerHTML` is the empty string, with no
    `.diff-empty` element of any kind, while the header reads `f.txt +0 -0` and both `Stage file`
    and `Discard changes` are enabled. Traced rather than guessed: git answers an unmerged path
    with `diff --cc` and `@@@ … @@@`, `parseUnifiedDiff`'s `if (!file) file = startFile()` fallback
    makes a file anyway, no line matches `HUNK_RE`, and a truthy file with zero hunks falls through
    all four of `DiffView`'s empty branches. Filed P1: it is silent, and it is the one screen a
    merge needs. **-> GC-181:** the conflicted row's menu is exactly `Mark resolved`, `Open file`,
    `Show in folder`, `Copy file path`, so the app can mark a conflict resolved and cannot resolve
    one — `checkout --ours`/`--theirs` are reachable from nowhere, on a state four of the app's own
    actions produce. **-> GC-182:** the graph's WIP row renders a real `<input class="wip-input">`
    with no `value`, no `onChange` and no `onKeyDown`; typing `typed into the graph` into it left
    the staging form's summary empty, Enter did nothing, and the text was still in the row after a
    Refresh that bumped `data-gen` — an uncontrolled node holding the user's typing, which is the
    thing GC-148 and GC-030 both exist to prevent.
  - tickets: added **GC-180** (diff, M, P1), **GC-181** (actions, S, P2) and **GC-182** (graph, S,
    P2), all three from the UI pass; the code-review pass found no bug and filed nothing. Checked
    for duplicates against every open row: nothing on the board mentions conflicts, and GC-152 is
    compare-against-working-directory, not this.
  - board: **GC-180 goes directly under GC-179**, the only other P1, and above GC-128; **GC-181 and
    GC-182 go under GC-128**, the other P2, and above the P3 block. Nothing else moved. The
    what's-next pass deliberately added nothing of its own: the study's largest open
    recommendation, "Build open/clone/init", **is** GC-128 and is in the current batch, so the
    board is finally spending its top rows on the biggest gap and did not need pushing.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081; none can be unblocked from here — GC-081's
    block is Ricardo's own decision that its measurement contradicts its target, and the other two
    want a design. No `todo` ticket has gone vague. The remote menu was checked on screen and still
    has no "open on the hosting service", which is GC-159 and needs no second ticket.
  - notes: `CLAUDE.md` at `3def19a` says "406 tests today", which matched the run exactly, and its
    Architecture, Commands and design-decision paragraphs are current for GC-026, GC-176, GC-167,
    GC-168, GC-162 and GC-139. GR-020's finding that the GC-135 paragraph is measurably wrong still
    stands and is still carried by GC-171, unclaimed. Nothing else looked stale.
  - isolation: six tickets were `in-progress` throughout (GC-179, GC-128, GC-143, GC-146, GC-147,
    GC-149) and not one was touched; the three ids added are above every id the worker holds.
    `MAIN` was never built, tested or launched and its working tree was left exactly as found — the
    write below waited for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be clean and stages only those
    two, while eleven of the worker's source edits sat uncommitted beside them. The only
    repositories written to were the review's own scratch root and a throwaway conflict repository
    under `%TEMP%`; the stash taken in the scratch root was popped back and `git status --porcelain`
    matches the fixture. `catena-feed` was **not opened** this run. The review's Electron on 9334
    was found by command line and stopped by PID tree; zero remained afterwards.
