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
  `node_modules` junctioned from here), which it removes when done. **Both are
  `node tools/scratch-worktree.mjs add <dir> [ref]` and `remove <dir>`, never done by hand**
  (GC-189): a recursive delete of that worktree follows the junction and deletes files out of this
  checkout's real `node_modules` — measured on 2026-09-06, 129 packages and `node_modules/.bin`
  gone, and the repair blocked by an unrelated running Electron. The helper removes the junction as
  a *link*, asserts it is gone and that `.bin` survives, and only then runs `git worktree remove`;
  if the junction is still standing it refuses and leaves the worktree, because an unremoved
  worktree costs a `git worktree prune` and the other way round costs an `npm install`.
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
| GC-210 | The force push is destructive, reachable and covered by nothing the suite runs | tests | S | P2 | todo |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-208 | An image in a commit says "Binary file." where the picture is what the reader wants | diff | M | P3 | todo |
| GC-204 | Blame: the file view's third mode, and the last Build row of the study's file panel | diff | M | P3 | todo |
| GC-205 | The staging view's bottom section keeps its place now, but still cannot be resized | ui | S | P3 | todo |
| GC-207 | The staging view's two file lists take an equal share of the panel whatever each holds | ui | S | P3 | todo |
| GC-206 | The detail panel draws every file row, and it is now the box that scrolls | ui | S | P3 | todo |
| GC-211 | An empty staging group's head is drawn 4px above the box it is stuck to | ui | S | P3 | todo |
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

### GC-204 Blame: the file view's third mode, and the last Build row of the study's file panel

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** `04-panels.md` records the file view's toolbar as "centre toggle **File View | Diff
  View**, right side **Blame | History**". GC-166 built History and put it exactly there, and its
  Out of scope named the remaining one outright: "Blame, which needs `git blame` porcelain parsing
  and a per-line gutter and is its own ticket". Nobody wrote that ticket. It has been carried as
  "worth a later look" by GR-018 and four reviews after it, and every reason to defer it has now
  gone: the surface exists, the segmented control exists, the load-keyed-to-identity discipline
  exists (GC-075, GC-152), and `time.ts` already answers how a timestamp is written.
  `06-feature-inventory.md` lists this row as Build, and with History shipped it is the only part of
  it still missing.
  It is the question a client is opened for that the graph cannot answer: not "when did this file
  change" (History) but "who wrote **this line**, and in which commit".
- **Scope:**
  - `git.ts`: `getBlame(cwd, path, rev?)` over `git blame --porcelain`, parsed into one record per
    line — sha, author name, author time, and the line's text — with the porcelain format's
    repeated-header abbreviation handled (a sha's header block is written once and later lines of
    the same sha carry only the sha). Answers a typed array in `shared/types.ts`; a binary file and
    a path git will not blame are answered rather than thrown.
  - `ipc.ts` + preload: `repo:blame`, path validated the way `repo:fileLog` is, and it wants the
    containment-only check GC-198 is adding rather than a bare `str` — take that dependency if
    GC-198 has landed, and say so if it has not.
  - A `Blame` entry in `DiffView`'s `Diff | History` control, so the file view has three modes and
    not two. It is a **mode**, exactly as History is: keyed by the identity it was chosen for,
    compared during render, costing no new layer and no new Escape case, and leaving the diff's own
    load untouched so switching back reloads nothing (GC-014, GC-166).
  - The body: the file's lines with a left gutter carrying the commit, grouped so a run of lines
    from one commit is marked once rather than repeated on every line. Clicking a gutter entry hands
    the sha up through `onOpenCommit`, the way a History row already does.
  - Every diff-only control disabled with one reason while Blame is showing, GC-188's rule and
    GC-166's `HISTORY_OFF` generalised to say which mode is up.
  - A unit test for the porcelain parser against captured output, including the abbreviated repeat,
    an uncommitted line (`0000000…`), and a file with one line.
- **Out of scope:** File View (the whole file with syntax highlighting), which needs a highlighter
  the app does not have; blame of the working-tree copy's uncommitted lines beyond marking them as
  not committed; `-C`/`-M` rename-detection flags; blaming a directory; and any change to the diff
  or history bodies.
- **Acceptance:**
  - [ ] Blame on a fixture file attributes every line to the sha `git blame --porcelain` gives for
        it, asserted against git rather than by eye.
  - [ ] A run of consecutive lines from one commit is marked once, and the line numbers still run
        1..N.
  - [ ] Clicking a gutter entry opens that commit's diff of the same file, and the header still
        names the file.
  - [ ] Switching Diff to Blame and back issues no second diff load, asserted on the request count.
  - [ ] A file git cannot blame (binary, or absent at that revision) says so in the body rather than
        rendering an empty one — the guard GC-180 established.
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/main/git.ts`, `src/main/git.test.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/diff/DiffView.tsx`,
  `src/renderer/src/diff/DiffView.test.tsx`, `src/renderer/src/styles/app.css`, `CLAUDE.md`
- **Verify:** `npm test`, then build and launch through `tools/launch-app.mjs` on the e2e fixture,
  open a file with commits from more than one author, switch to Blame and read the gutter back over
  CDP against `git blame --porcelain` run on the same file.
- **Log:**
  - 2026-09-06 proposed by GR-025: GC-166 shipped History into the slot the study shares between
    Blame and History and named Blame as its own ticket; this is that ticket, and it is the last
    Build row of `06-feature-inventory.md`'s file panel still unbuilt.

---

### GC-205 The staging view's bottom section keeps its place now, but still cannot be resized

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-191
- **Why:** GC-191 made `.commit-form` the block that keeps the bottom of the panel while the file
  lists give way, which is what it set out to do — but it fixed the split at whatever the form's
  own content comes to, and named making it resizable as out of scope without filing anything, so
  nothing owns it. `docs/reference/gitkraken/04-panels.md` line 71 records GitKraken's as a
  **vertically resizable section with a default of about 275px**, and the user's own ratio between
  the files they are reading and the message they are writing is exactly the kind of arrangement
  this app remembers everywhere else (the panel widths, the ref column, the left panel's section
  heights). Measured at 1400x900 with 29 unstaged files: the form is 201px and the lists share the
  474 above it, with no way to give the description more room without widening the whole panel.
  The machinery exists — `useBoundaryDrag` in `useDragWidth.ts` is a pair sharing a fixed total
  (GC-153), which is this exact shape one panel over.
- **Scope:**
  - A drag handle on the boundary between the last file list and `.commit-form`, through
    `useBoundaryDrag`, so `reachedWidth`'s rules (GC-111, GC-115, GC-118) hold here without a
    second copy of them.
  - A floor for each side: the form keeps its summary field and its button, a list keeps its head.
  - The height is remembered, on its own key beside `gitclient.sectionHeights` — remembered state,
    never the prefs blob — and a double-click on the handle drops it.
  - Only the applied height is ever clamped on a short panel; the stored one is untouched.
- **Out of scope:** collapsing the groups (GC-197), the form's own composition (GC-196), and the
  commit view, which has no form to size against.
- **Acceptance:**
  - [ ] Dragging the handle moves the boundary and neither side goes under its floor — measured.
  - [ ] The height survives a reload, and a double-click removes the key and restores the split.
  - [ ] At the 300px panel minimum and a short window the stored height is not overwritten.
  - [ ] A unit test for the floor arithmetic, beside the `fitSections` cases.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/ui/useDragWidth.ts`, `src/renderer/src/styles/app.css`, `CLAUDE.md`
- **Verify:** build, launch on a repository with about thirty unstaged files, drag the handle over
  CDP and read back the rects either side, reload and read the stored key.
- **Log:**
  - 2026-09-06 proposed by GC-191 (this ticket): its own out-of-scope line names this and files
    nothing, so between GC-191, GC-196 and GC-197 no ticket owns the split the user cannot move.

---

### GC-207 The staging view's two file lists take an equal share of the panel whatever each holds

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-197
- **Why:** Both `.file-list` blocks are `flex: 1 1 auto` with the same basis, so the space they
  share is split **equally** rather than by what each is holding. Measured during GC-196's audit at
  a 400px panel with three unstaged and two staged files: Unstaged was given 260px for 112px of
  content and Staged 247px for 86px, so 309px of the 756px body — 41% — was ruled empty box under
  five rows. It goes the other way too: with 32 unstaged and 2 staged, Unstaged got 449px for 32
  rows while Staged held 57px it could not use, so the group being staged *from* overflowed while
  the group being staged *into* wasted half of what it had.
  `docs/reference/gitkraken/04-panels.md` line 62 has the two lists sharing the vertical space, so
  filling the panel is right and only the split is wrong — and the app already answers this one
  panel over: `fitSections` (GC-153) gives each section what it asks for, then fills the column
  level by level, with a floor so a squeezed section keeps rows rather than only its head. GC-197
  made the imbalance survivable by hand — close the group you are not using — and this is the same
  question answered without asking the user to.
- **Scope:**
  - The two lists (three with Conflicted) share the space by what each is asking for rather than
    equally, through `fitSections` or the same rule, with `MIN_SECTION_H`'s equivalent as the floor.
  - A closed group (GC-197) takes no part, exactly as a closed left-panel section does.
  - The commit form keeps its place at every count, which is GC-191's promise and must not move.
- **Out of scope:** dragging the boundary between the lists or between the lists and the form
  (GC-205), virtualising the rows (GC-206), and collapsing (GC-197, done).
- **Acceptance:**
  - [ ] With 3 unstaged and 2 staged, neither list is given materially more than its rows need,
        and the numbers are in this log.
  - [ ] With ~30 unstaged and 2 staged, Unstaged takes the room Staged cannot use, and Staged keeps
        its floor.
  - [ ] `.commit-form` sits at the same place in both cases.
  - [ ] A unit test for the share, beside the `fitSections` cases.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/ui/useDragWidth.ts`,
  `src/renderer/src/styles/app.css`
- **Verify:** build, launch on a repository with about thirty changed files across both states, and
  read each list's rect and `.detail-body`'s `scrollHeight` versus `clientHeight` back over CDP at
  both counts.
- **Log:**
  - 2026-09-06 proposed by GC-196 (this ticket's batch): its audit measured the equal split as 41%
    of the body ruled empty at low counts and an overflowing Unstaged list beside an unusable
    Staged one at high counts, and named it as the one finding worth its own ticket.

---

### GC-206 The detail panel draws every file row, and it is now the box that scrolls

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-191
- **Why:** `DetailPanel` maps every entry to a `FileRow`: a commit touching a thousand files is a
  thousand rows in the DOM, where the graph beside it has virtualised its own since GC-005 and
  `docs/reference/gitkraken/04-panels.md` line 89 records GitKraken's file list as virtualised
  too. It has stood because nothing measured it — the e2e fixture's largest commit touches three
  files. GC-191 changes the reason it matters rather than the cost: `.file-list` is now the
  element with `overflow: auto`, so it is a real scroll box with a known height, which is exactly
  what a virtualiser needs and what the panel did not have while the whole body scrolled.
  Measured on a throwaway repository at 1400x900: a 29-file commit renders 29 rows into a 331px
  box showing 12 of them, so 17 are laid out to be scrolled past.
- **Scope:**
  - The rows in both file lists are virtualised the way `CommitGraph` does it: a fixed row height
    mirrored from `app.css`, an overscan, and a spacer for the scroll height.
  - The sticky `.group-head` and the boundary rules stay where they are.
  - The measurement first: how many rows a real repository produces and what the panel costs at
    that count, in this ticket's Log, so the change is answering a number.
- **Out of scope:** the rows' own layout (GC-192), collapsing the groups (GC-197), and the commit
  view's "View all files" checkbox the study lists, which we have not built.
- **Acceptance:**
  - [ ] With a commit of several hundred files, the number of `.file-row` elements is bounded by
        what the box can show plus the overscan — measured.
  - [ ] Scrolling to the end reaches the last file, and clicking a row still opens its diff.
  - [ ] The staging view's three lists each virtualise independently, with their heads unmoved.
  - [ ] `npm test` and `npm run typecheck` pass, and the e2e suite's file-row steps are unchanged.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`, `src/renderer/src/styles/app.css`
- **Verify:** build, launch on a repository with a commit touching several hundred files, and read
  back `document.querySelectorAll('.file-row').length` against the list's client height.
- **Log:**
  - 2026-09-06 proposed by GC-191 (this ticket): making `.file-list` the scroll box is what gives
    the panel the bounded box a virtualiser needs, and the study records the list as virtualised.

---
### GC-208 An image in a commit says "Binary file." where the picture is what the reader wants

- **Status:** todo
- **Area:** diff | **Size:** M | **Priority:** P3
- **Depends on:** none
- **Why:** Asked for by Ricardo and reproduced: opening `docs/screenshots/gc175-01-graph-dark.png`
  from a commit's file list draws the four words "Binary file." and nothing else
  (`05-binary-diff.png` in this review's folder). It is the study's own row, not a nicety —
  `06-feature-inventory.md` line 14 lists GitKraken's `DiffImage` under "Diff, file, blame, history
  views, image diff" and marks the row "Build (text diff first)", and the text diff has been built
  for many tickets now. This repository commits screenshots on nearly every ticket, so it is a file
  kind the app's own history is full of and can show nothing about.
  Ricardo's reading of the code is correct at every point and was checked: `DiffView.tsx:550` draws
  `.diff-empty` when `file.binary`, `parseDiff.ts:165` sets that off git's own
  `Binary files … differ` marker, and `looksBinary` in `git.ts` synthesises the same marker for an
  untracked file. The transport is the real constraint he names: `runGit` calls
  `child.stdout.setEncoding('utf8')` (`git.ts:146`), so **every** git call in the app decodes as
  text and would corrupt a PNG on the way through. The CSP is not in the way — `index.html` already
  allows `img-src 'self' data:`, so a base64 blob renders with no change there.
  One thing found while reproducing it that he could not have seen: on that same binary file the
  header's `Unified | Split` control is **live** — both buttons enabled, with nothing to lay out
  either way — while the two hunk arrows beside it are correctly disabled. That is GC-188's rule
  ("the layout switch says what is drawn, not what is preferred") unapplied one case over, and it is
  in this ticket because whatever an image body turns out to be, the same control has to answer for
  it.
- **Scope:**
  - A binary-safe way out of `git.ts`, since the existing one cannot carry bytes. The narrow form is
    a `RunOptions` flag that skips `setEncoding` and resolves a `Buffer`, used by one new function
    that reads a blob at a revision (`git cat-file blob <sha>:<path>`, or `git show`), plus the
    working-tree side, which is a file on disk that `repoFile()` already knows how to resolve and
    refuse safely. Everything else keeps decoding as text.
  - Decide and write down **which kinds are shown and what happens to the rest**, because "binary"
    covers a 40MB video as well as a 12KB icon: an allow-list of image types the renderer can
    actually draw, a size cap above which the file is described rather than fetched, and a body for
    everything else that says more than today's four words — the kind, and the size, which
    `git cat-file -s` answers without moving any bytes.
  - The body itself: one image for a file the commit added or deleted, and **before and after** for
    one it modified, which is the half Ricardo asked for by name. The two sides are the same
    question the diff already answers, so say in the code how a reader tells them apart.
  - `Unified | Split` disabled with its reason on it whenever the body is not a text diff, GC-188's
    rule and GC-166's `HISTORY_OFF` shape. `prefs.diffView` is never written by this, so the next
    text file opens in the layout the user chose.
  - It is a **body**, not a mode: the file view keeps `Diff | History` and gains no third control
    here (GC-204 owns Blame). The load stays keyed to the view identity the way every other body is
    (GC-075, GC-152), so an image can never render under a header that has already flipped.
- **Out of scope:** a diff *between* two images beyond showing both (no swipe, onion-skin or
  pixel-difference view), image files in the graph or the left panel, thumbnails in the file rows,
  editing or exporting an image, and non-image binaries getting any body richer than a description.
- **Acceptance:**
  - [ ] A committed PNG opens as the picture, asserted on the rendered element's natural dimensions
        against the real file's, not on the absence of "Binary file.".
  - [ ] Bytes survive the round trip: the blob the renderer receives is byte-for-byte
        `git cat-file blob` of the same path, asserted on a hash rather than by looking at it.
  - [ ] A modified image shows both sides; an added and a deleted one show the one side that exists.
  - [ ] A binary that is not a shown kind, and one over the size cap, each say what they are and how
        large rather than rendering an empty body — the guard GC-180 established.
  - [ ] `Unified | Split` is disabled with a reason whenever the body is not a text diff, and
        `prefs.diffView` is unchanged afterwards.
  - [ ] No `img-src` or other CSP change was needed.
  - [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
- **Files:** `src/main/git.ts`, `src/main/git.test.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
  `src/shared/types.ts`, `src/renderer/src/diff/DiffView.tsx`,
  `src/renderer/src/diff/DiffView.test.tsx`, `src/renderer/src/styles/app.css`, `CLAUDE.md`
- **Verify:** `npm test`, then build and launch through `tools/launch-app.mjs` on a repository whose
  history commits images — this checkout's own `docs/screenshots/` is the case Ricardo reported, and
  the review worktree is a safe copy of it — open an added image and a modified one, and compare the
  drawn bytes against `git cat-file blob` run on the same path.
- **Log:**
  - 2026-09-06 proposed by GR-026, from Ricardo's inbox: reproduced on a committed PNG, which draws
    four words; it is the study's own "image diff" Build row, and the one constraint in the way is
    that every git call in the app decodes as utf8.

---

### GC-210 The force push is destructive, reachable and covered by nothing the suite runs

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P2
- **Depends on:** GC-203
- **Why:** GC-203 made `--force-with-lease` reachable from the Push popover, and what proves it is
  the *lease* rather than a plain `--force` is that a stale one is refused — the renderer cannot see
  git's argv, so behaviour is the only evidence there is. That was checked by hand, once, in a
  throwaway driver: amend a commit that is on the fixture's bare `remote.git`, move the bare ref
  behind the app's back, force push and watch it come back `! [rejected] main -> main (stale info)`,
  then restore the ref and watch the same row move `refs/heads/main` to the amended sha. Nothing in
  `npm run e2e` does any of that, so the one action in the app that can destroy published history
  has no repeatable coverage at all, and a future change from `--force-with-lease` to `--force`
  would pass every check this repository runs.
  What kept it out of GC-203 is real and is what this ticket has to solve: a force push moves the
  bare origin, and step 43 asserts every branch is back on its baseline tip *there* as well as here
  — which is exactly the check that would catch it, so the step has to put the remote back itself.
- **Scope:**
  - An e2e step that amends a published commit through the staging form, force pushes it from the
    popover, and asserts with `git -C remote.git rev-parse` that the remote ref moved to the amended
    sha — not that the status bar looks happy.
  - The stale-lease case in the same step: move `refs/heads/main` in the bare repository directly,
    force push, and assert the push was **refused** and the remote unchanged. That assertion is what
    names the flag; without it the step passes under `--force` too.
  - The confirmation is part of it: cancelling runs nothing, and the question names the remote and
    the branch (GC-114).
  - Putting the fixture back: the local branch resets to its baseline and the remote is force pushed
    or `update-ref`d back, before step 43 measures. Decide which and say why — a `update-ref` in the
    bare repository is not the app's own path but it cannot itself fail the way a push can.
- **Out of scope:** the amend hint (a rendering, covered by whatever unit test wants it), pushing
  tags, and any new git call.
- **Acceptance:**
  - [ ] A run force pushes an amended commit and asserts the bare repository's ref moved to it.
  - [ ] A run with a stale lease asserts the push was refused and the remote unchanged.
  - [ ] The step puts both repositories back, and step 43 still passes with no drift reported.
  - [ ] `npm run e2e` ends ALL PASSED.
- **Files:** `tools/e2e/run.mjs`, `CLAUDE.md`
- **Verify:** `npm run e2e` twice in a row, since a step that half-restores the fixture passes once.
- **Log:**
  - 2026-09-06 proposed by GC-203 (this ticket): its own verification had to be a throwaway driver
    because a force push moves the bare origin that step 43's baseline check exists to catch, and a
    destructive action verified once by hand is not verified.

---

### GC-211 An empty staging group's head is drawn 4px above the box it is stuck to

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-209
- **Why:** Found while measuring GC-209. `.file-list` has `min-height: 30px`, which is "its head and
  never less" (GC-153's argument, one panel over) — but the head is 30px **plus** its 4px
  `margin-bottom`, so a group squeezed to that floor is 34px of content in a 30px box and the sticky
  head hangs 4px out of the top of it. Measured in the app at 1400x480 on this checkout, with 25
  unstaged files and none staged: the Staged list's box top was 199 and its head's top 195, so the
  head was drawn into the 12px gap that separates the two lists. Nothing overlaps a row — the group
  is empty, which is the only case that reaches the floor — so it is cosmetic, and it is filed
  separately from GC-209 because that ticket is about the clipping edge and this is about the floor.
- **Scope:**
  - Make the floor the head's own outer height rather than its box height, or move the 4px so it is
    not part of what has to fit. Whichever, say in the comment which number `min-height` is.
  - Check the same arithmetic in `MIN_SECTION_H` (GC-153), which is stated as "a header and two
    rows" and may have the same off-by-a-margin.
- **Out of scope:** the share the lists take (GC-207), whether the bottom one can be resized
  (GC-205), and the sticky edge itself (GC-209).
- **Acceptance:**
  - [ ] An empty group at its floor draws its head inside its own box, measured over CDP.
  - [ ] A group with rows is unchanged at every height, measured at the same window.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/styles/app.css`, possibly
  `src/renderer/src/components/LeftPanel.tsx`
- **Verify:** build, launch through `tools/launch-app.mjs` on a repository with unstaged files and
  nothing staged, and read the Staged head's rect back against its list's.
- **Log:**
  - 2026-09-06 proposed by GC-209 (this ticket's batch): measured at 1400x480, the Staged head's top
    was 195 against its list's 199, which is the head's 4px margin inside a 30px floor.

---


## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-026 Backlog review 2026-09-06 21:05

- **Status:** done
- **Window:** c97776b..8b94374
- **Log:**
  - 2026-09-06 21:05 inbox: **two items in Pending**, both investigated, both reproduced in the
    built app, both ticketed. Nothing declined, nothing left in Pending. Neither counts against the
    reviewer's own budget.
  - inbox 1 (we should be able to see images) **-> GC-208**. Reproduced: opening
    `docs/screenshots/gc175-01-graph-dark.png` from a commit's file list draws "Binary file." and
    nothing else (`05-binary-diff.png`). Every line of his reading of the code checked out —
    `DiffView.tsx:550`, `parseDiff.ts:165`, `looksBinary`, and the constraint that matters,
    `child.stdout.setEncoding('utf8')` at `git.ts:146`, which is why the bytes cannot come down the
    path every other diff uses. His CSP note is right too: `index.html` already carries
    `img-src 'self' data:`, so a base64 blob needs no change there. Both questions he said had to be
    settled first are written into the scope as decisions the ticket must make and record — the
    binary-safe transport, and which kinds are shown with what happens to the rest, since "binary"
    covers a 40MB video as well as a 12KB icon. One thing added that he could not have seen: on that
    same binary file the header's `Unified | Split` control is **live**, both buttons enabled with
    nothing to lay out either way, while the two hunk arrows beside it are correctly disabled — so
    GC-188's rule is unapplied one case over, and it is in this ticket because the same control has
    to answer for whatever an image body becomes. Filed M/P3 beside GC-204, the other Build row of
    the study's file panel.
  - inbox 2 (the "33 files changed" head sits over the rows) **-> GC-209**, and **the part he could
    not account for is the cause**. He wrote that the capture did not add up — a row above a head
    stuck at `top: 0` should be clipped away entirely — and asked for it to be reproduced before
    anything was decided. It reproduces on the same file he named. The two edges are not the same
    edge: a sticky inset is resolved against the scroll container's **content** box while overflow
    clipping happens at its **padding** box, and `.file-list` carries GC-142's `padding-top: 12px`.
    Measured at 1400x900 on a 33-file commit with the list scrolled to 100 — list rect top 345,
    `border-top` 1px so the scrollport clips at 346, `padding-top` 12px so the head is stuck at 358,
    and the `TICKETS.md` row spans 344 to 370, putting 12 of its 26 pixels in the strip the head
    does not cover. `04-sticky-head.png` shows the top half of that row's name and its kind icon
    legible above the band. So it is not the head's colour and not a missing shadow: it is 12px of
    padding on the sticky edge of a scroll box, and the fix is to make the two edges the same edge.
    Filed P2 — it is small, and it hits any commit with more files than the list can show, which is
    most of them. His reading that the pinning itself is deliberate is right and is in Out of scope,
    since GC-206 depends on it.
  - shipped: **thirteen commits, two of them claims and one a review.** `b70c473`/`c249ecc` closed
    GC-191, GC-192, GC-193, GC-194, GC-195 and GC-177; `8b94374` and the six commits under it closed
    GC-202, GC-200, GC-197, GC-196, GC-178 and GC-183. Read as a reviewer it holds up, and two
    things are worth naming. GC-202's `HEADLINE_PATTERNS` is the right shape — an ordered list tried
    one at a time, with the rejection pattern first because its parenthesis is the reason, replacing
    a single alternation that matched in document order — and it is exported and covered by 112 new
    lines of `StatusBar.test.tsx`; `failureParts` correctly returns `null` for a one-line failure,
    which is what leaves that case exactly as it was, and only `auth` opens the dialog unasked.
    GC-196's e2e follow-through is the other: the count became its own `.count` element, and the
    step-1634 wait was rewritten to find the group by title and read the number off that element
    rather than out of one label string — the kind of change that is silently skipped and was not.
    No new ticket came out of the code-review pass.
  - health: at `8b94374` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    521 tests passed (27 files)** in 3.57s, **build ok** into the worktree's own `out/`, whose mtime
    (20:53) I checked against `MAIN`'s (20:08) to confirm nothing was written there. `MAIN` was never
    built, tested or launched.
  - app: the worktree's build ran offscreen on 9334 against the review's own scratch root. Nine
    captures in `%TEMP%/gitclient-review/GR-026/`, all looked at. `01` graph, `02` commit, `03`
    staging and `09` a text diff are the spread; GC-186/GC-200's band, GC-183's file-kind marks on
    the WIP row and GC-104's intra-line marks all read correctly. `04` and `05` carry the two inbox
    items. This run's rotation is the **Preferences dialog** and the **empty tab**, neither taken by
    GR-024 or GR-025. Preferences confirms GC-195 shipped as described and measures right:
    `.modal` padding `16px 0`, `.modal-body` padding `0 16px`, body 441-959 inside a modal 440-960,
    so the scrollbar sits at the dialog's own edge with the content inset — the defect Ricardo
    reported is gone (`06-preferences.png`). The empty tab (`08`) shows GC-163 and GC-164 working:
    a real tab labelled "New Tab" with its own close box, the recents list under it, and GC-165's
    start-ellipsised paths keeping the folder that names each entry.
  - tickets: added **GC-208** (diff, M, P3) and **GC-209** (ui, S, P2), both from the inbox.
    **No ticket of the reviewer's own this run, and that is a deliberate call rather than a quiet
    one.** The UI pass's candidates were all already on the board and were deduplicated against it:
    the staging lists' equal share is GC-207 (visible again in `03`, three unstaged and two staged
    in two half-empty boxes), the stash row is GC-199, the band's paint is GC-201, the unvirtualised
    file list is GC-206 and the unmovable form boundary is GC-205. The what's-next pass re-read
    `06-feature-inventory.md` against the board and its strongest remaining row is line 14's image
    diff — which is inbox item 1, so it is filed once as GC-208 rather than twice. One inconsistency
    was found and judged not worth a ticket: GC-197 gave the staging view's three heads a chevron
    and a toggle while the commit view's single head has neither, so GC-142's "a file list is one
    thing in both views" has drifted — but collapsing the only group in the commit view would leave
    an empty panel, so the divergence is the correct behaviour and only the shared selector looks
    odd. Recorded here instead.
  - board: **GC-209 goes directly under GC-203**, at the bottom of the P2 block — GC-203 is a
    workflow with no way through and outranks a rendering defect, but GC-209 is small, certain and
    on the panel a user reads on every commit. **GC-208 goes above GC-204** in the P3 block, so the
    study's two file-view Build rows sit together and the one Ricardo asked for is the first of
    them. Nothing already on the board moved.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081, none unblockable from here — GC-081 still waits
    on Ricardo's call between accepting 219 calls / 5.4s and making `check()`'s detail lazy, which
    is a trade about what the run reports and not a refactor. Nothing is `in-progress` at
    `8b94374`: the worker closed its batch and left no claim standing, and the board was re-read
    immediately before this write. No `todo` has gone vague, and GC-201's dependency on GC-200 is
    now satisfied since GC-200 is `done`.
  - notes: `CLAUDE.md` at `8b94374` says "521 tests today", which matched this run exactly, and its
    GC-196, GC-197, GC-200 and GC-202 paragraphs are all current and accurate against the code I
    read. Nothing stale found. Flagged here rather than edited; the reviewer never touches
    `CLAUDE.md`.
  - isolation: `MAIN` was never built, tested or launched, its working tree was clean throughout and
    was left exactly as found, and this write waited for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be
    clean and stages only those two. The worktree was added and removed through
    `tools/scratch-worktree.mjs` (GC-189), which reported `node_modules: 109 entries` on the way in
    and asserted `.bin` on the way out. The repositories opened were the review's own scratch root
    and the review's own detached worktree — the latter read-only, to get a commit with enough files
    to reproduce inbox item 2, since the e2e fixture's largest touches three; **no write operation
    ran in either**, and `catena-feed` and `kyushu-route` were not opened. The review's Electron on
    9334 was found by command line and stopped by PID tree, leaving nothing listening on the port;
    four unrelated `electron.exe` processes were left alone, which is what rule 4 exists for.
