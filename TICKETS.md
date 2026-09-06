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
| GC-202 | A rejected push draws the least useful line git wrote and hides the four that explain it | ui | S | P1 | in-progress |
| GC-200 | The lane band's flat edge and the node's arc leave a crescent of untinted row between them | ui | S | P2 | in-progress |
| GC-203 | `--force-with-lease` is implemented, typed and validated, and no call site can reach it | actions | S | P2 | todo |
| GC-197 | The staging view's two file lists cannot be collapsed, so Staged is unreachable past 20 files | ui | S | P2 | in-progress |
| GC-196 | The detail panel's second design pass: an audit against the study before anything changes | ui | M | P2 | in-progress |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-178 | A selected stash says what it is and offers nothing to do with it | ui | S | P3 | in-progress |
| GC-183 | The graph row's own change readout is the text glyphs GC-143 took out of the panel | ui | S | P3 | in-progress |
| GC-184 | The folded +N block cannot be opened by any driver, so nothing covers it end to end | tests | S | P3 | todo |
| GC-198 | `repoRel()` cannot answer "is this path inside the repository" without also requiring it on disk | infra | S | P3 | todo |
| GC-199 | A stash row carries five things at a 220px panel and the message gets 48px of them | ui | S | P3 | todo |
| GC-201 | The lane band is a flat wash where it should read as light coming off the lane | ui | S | P3 | todo |
| GC-204 | Blame: the file view's third mode, and the last Build row of the study's file panel | diff | M | P3 | todo |
| GC-205 | The staging view's bottom section keeps its place now, but still cannot be resized | ui | S | P3 | todo |
| GC-206 | The detail panel draws every file row, and it is now the box that scrolls | ui | S | P3 | todo |
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

### GC-178 A selected stash says what it is and offers nothing to do with it

- **Status:** in-progress
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
  - 2026-09-06 19:43 claimed

---

### GC-183 The graph row's own change readout is the text glyphs GC-143 took out of the panel

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-143
- **Why:** GC-143 replaced the detail panel's literal `+`, `✎`, `−` and `→` with `FileKindIcon`,
  so a modified file is the same mark in the readout and in the file row beneath it. The graph's
  WIP row draws a third rendering of the same three states and was deliberately out of that
  ticket's scope: `.graph-row .col-msg .readout` is `<span class="add">+ 1</span>`,
  `<span class="mod">✎ 3</span>`, `<span class="del">− 1</span>` — measured on the fixture's WIP
  row, which is the row a user looks at most. Its classes are `add`/`mod`/`del` rather than
  `kind-*`, so it does not even share the panel's colour rule, and `✎` is a font glyph whose
  weight and shape are whatever Open Sans has, next to a lucide pencil eight pixels away.
- **Scope:**
  - The three counts render `FileKindIcon` for their kind, as the detail panel's readout does.
  - The classes become the `kind-*` the tokens are keyed by, so one rule colours both surfaces.
  - It is a 22px row in a virtualised list, so check the icons do not change the row's height.
- **Out of scope:** the WIP row's other contents, and the counts themselves.
- **Acceptance:**
  - [ ] The WIP row's readout draws the same mark for a kind that the detail panel draws.
  - [ ] No text glyph is left in any readout: `grep -n '✎' src/renderer/src` prints nothing.
  - [ ] The graph row is still 28px and the WIP row still lines up with the rows under it.
- **Files:** `src/renderer/src/graph/CommitGraph.tsx`, `src/renderer/src/styles/app.css`.
- **Verify:** `npm test`, build, launch on the scratch repository and zoom on the WIP row.
- **Log:**
  - 2026-09-06 proposed by GC-143 (this ticket): found while replacing the panel's glyphs. The
    ticket named the panel's two renderings and fixed both; this is the third, one surface over,
    and it was put out of scope rather than missed.
  - 2026-09-06 19:43 claimed

---

### GC-184 The folded +N block cannot be opened by any driver, so nothing covers it end to end

- **Status:** todo
- **Area:** tests | **Size:** S | **Priority:** P3
- **Depends on:** GC-123
- **Why:** The `+N` fold opens on `:hover`, and `:hover` never fires in the app the routine
  launches: it runs offscreen (`webPreferences.offscreen`, GC-060's stealth), where a CDP
  `Input.dispatchMouseEvent` `mouseMoved` does not update the hover state — measured while
  verifying GC-147, where a real dispatched move left `getComputedStyle(list).display` at
  `none`. So the e2e suite drives no hover at all and the block has never been opened in a run.
  What covers it today is jsdom class assertions (GC-058's `flip-up`), which apply no stylesheet
  and so cannot see the two things that have actually broken here: the `overflow: hidden` that
  clipped it to 28px (GC-123) and the padding that shifted its first line (GC-022, GC-078).
  There is a way in that does not need hover: `.more-drag`, which GC-123 added for the same
  reason and which the CSS treats as the hover state by construction — every rule that opens the
  block is written as a `:hover, .more-drag` pair — and which a `dragover` carrying
  `REF_DRAG_TYPE` sets. Step 39 already dispatches exactly those events.
- **Scope:**
  - An e2e step that opens the fold on the fixture's `main` row through a `dragover` carrying
    `REF_DRAG_TYPE`, and asserts what only a rendered stylesheet can answer: every folded ref is
    a line, the block is taller than the 28px row and is not clipped, it stays inside
    `.graph-body`, and its first line sits on the pixel the row chip occupied.
  - The step ends the drag and leaves the class off, so no later step meets an open block.
- **Out of scope:** making `:hover` reachable — an offscreen window is what keeps a run
  invisible (rule 3) and is not up for trade; and the flip-up decision near the bottom edge,
  which needs a row there and is its own step if it is wanted.
- **Acceptance:**
  - [ ] A run opens the folded block and asserts its height, its clipping and its lines.
  - [ ] The step leaves the graph as it found it, and the suite still ends ALL PASSED.
- **Files:** `tools/e2e/run.mjs`.
- **Verify:** `npm run e2e`; the step must fail if `.col-ref.more-drag`'s `overflow: visible`
  rule is removed, which is the regression GC-123 fixed.
- **Log:**
  - 2026-09-06 proposed by GC-147 (this ticket): the ticket's acceptance asked that hovering
    `+N` still work over the new band, and there was no way to hover; the check had to be made
    through `.more-drag` instead, which is what showed the gap.

---

### GC-196 The detail panel's second design pass: an audit against the study before anything changes

- **Status:** in-progress
- **Area:** ui | **Size:** M | **Priority:** P2
- **Depends on:** GC-191, GC-192
- **Why:** GC-142 gave the panel its boundary treatment and GC-143 its file-kind marks, and both
  landed, but Ricardo's reading of the result is that it still does not look finished. He asked
  for the panel to be gone over **as a whole** against GitKraken's, with what is wrong written
  down before anything is changed — which is the opposite order from the four defects that came
  out of the same look and are already tickets of their own (GC-191, GC-192, and the group heads
  in GC-197).
  What is left after those three is the part no single measurement settles: spacing, the type
  scale, the file rows and their hover actions, the group heads' weight, and the commit form's
  own composition. `docs/reference/gitkraken/04-panels.md` describes both views in order — the
  36px header bar, the controls row with its Path | Tree toggle, the two lists with their action
  buttons and per-row hover button, and the bottom section's tabs, amend checkbox, message box
  with counter, description, commit options and primary button whose **label states what it will
  do** ("Commit changes to N files") — and it is specific enough to audit against line by line.
  This ticket exists because a pass done as a list of small edits is how a panel ends up looking
  assembled rather than designed, and because the finding list is what Ricardo asked for first.
- **Scope:**
  - **First, and before any edit:** a written audit in this ticket's Log — one line per finding,
    each naming the surface, what the study says, what ours does, and a measurement or a
    screenshot reference. Cover, at minimum: the header bar and its buttons; the group heads'
    weight and their action buttons; a file row's height, type scale and hover actions in both
    views; the commit form's field sizes, the amend row, the counter and the primary button's
    label; the commit view's author block, its change readout and its ref chips; and the vertical
    rhythm between the panel's sections.
  - Then the changes the audit names, each traceable to one of its lines. A finding worth its own
    ticket — anything L-shaped, or any behaviour rather than appearance — is filed as one and
    named in the Log instead of being done here.
  - Screenshots of both views before and after, at the default panel width and at 300px, in
    `docs/screenshots/`.
  - Every colour and metric a token in `tokens.css` (`CLAUDE.md`, Styling).
- **Out of scope:** the panel's vertical composition (GC-191), the file rows' path layout
  (GC-192), collapsible group heads (GC-197), the graph row's own readout (GC-183), and the
  features the study lists that we have not built — the Path | Tree toggle, the Stash and Cloud
  Patch tabs, commit options, and anything AI.
- **Acceptance:**
  - [ ] The Log holds the written audit, and it was written before the first code change in this
        ticket's commits — visible in the commit order.
  - [ ] Every change made is traceable to one line of that audit; anything in the audit that was
        **not** done says why, or names the ticket that will.
  - [ ] Both views screenshotted before and after, at two panel widths, and looked at.
  - [ ] `npm test` and `npm run typecheck` pass; no `rgba()` or hex added to `app.css`.
  - [ ] Nothing GC-191, GC-192 or GC-197 owns was changed here.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`
- **Verify:** build, launch on a repository with a mixed working tree and a multi-file commit,
  screenshot both views at 400px and 300px panel widths, and read the panel's measured metrics
  back over CDP for the numbers the audit cites.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: the panel still does not read as
    finished after GC-142 and GC-143, and the four defects the same look produced are carved off
    as GC-191, GC-192 and GC-197 so this one is the judgement call that is left — with the
    finding list as its first deliverable, which is what Ricardo asked for.
  - 2026-09-06 19:43 claimed

---

### GC-197 The staging view's two file lists cannot be collapsed, so Staged is unreachable past 20 files

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-191
- **Why:** `docs/reference/gitkraken/04-panels.md` line 62 describes the staging view as "two
  **collapsible** lists sharing the vertical space". Ours are two `.file-list` blocks whose
  `.group-head` carries a count and a Stage-all / Unstage-all button and nothing that closes it.
  Measured on 2026-09-06 with 29 unstaged files and 0 staged: the Unstaged list rendered 788px and
  the Staged head sat below it, so reaching the group you are staging **into** means scrolling
  past every row of the group you are staging **from**. The same is true in reverse while
  unstaging a large change.
  The app already has the answer one panel over: GC-153 gave the left panel four sections that
  share its height under heads that never scroll away, with the closed set remembered and
  `fitSections` deciding the share, and GC-139 established the shape for remembering which groups
  are closed per repository. This is that pattern applied to the two lists whose counts already
  read like section heads. GC-191 is a dependency because it decides which block in
  `.detail-body` scrolls, and a collapse that fights a crushed message box would be measured
  against the wrong layout.
- **Scope:**
  - Each group head toggles its list, with a chevron on the head like the left panel's sections,
    and the head's count and action button unaffected by the state.
  - A closed group is its head and nothing more, and the open group takes the room it releases.
  - Collapsing is state, not a preference: it goes on its own `gitclient.*` key, per repository
    like `gitclient.folded.<repoPath>` (GC-139), or is session-only — say which and why. Either
    way a group that has entries and was never touched starts **open**.
  - A group that becomes empty must not leave a stale closed state that hides the rows when it
    fills again.
  - The Conflicted group (GC-181) takes the same treatment, since it is a third group in the same
    column.
- **Out of scope:** dragging the boundary between the two lists (the left panel's
  `useBoundaryDrag` is a bigger ask and can be its own ticket), the commit view's single file
  list, and everything GC-191 and GC-196 own.
- **Acceptance:**
  - [ ] Clicking the Unstaged head closes it, and the Staged head moves up to take its place —
        measured with 29 unstaged entries.
  - [ ] With one group closed, the other's rows are visible without scrolling at the counts where
        both together would not fit.
  - [ ] A group with entries that has never been toggled renders open.
  - [ ] Whichever persistence is chosen survives — or deliberately does not survive — a reload, as
        stated in the Log, and is covered by a unit test if it is stored.
  - [ ] The Conflicted group behaves the same way.
- **Files:** `src/renderer/src/components/DetailPanel.tsx`,
  `src/renderer/src/styles/app.css`, possibly `src/renderer/src/App.tsx`
- **Verify:** build, launch on a repository with about thirty changed files across all three
  staging states, and drive the two heads over CDP, reading back each list's rect and
  `.detail-body`'s `scrollHeight` versus `clientHeight` in each state.
- **Log:**
  - 2026-09-06 proposed by GR-024: the study calls these lists collapsible and ours are not, and
    with 29 unstaged files the Unstaged list measured 788px, putting the Staged head — the group
    you are staging into — below the fold.
  - 2026-09-06 19:43 claimed

---


### GC-198 `repoRel()` cannot answer "is this path inside the repository" without also requiring it on disk

- **Status:** todo
- **Area:** infra | **Size:** S | **Priority:** P3
- **Depends on:** none
- **Why:** `repoRel()` in `ipc.ts` does two things at once: it refuses a path that resolves outside
  the repository (GC-093's rule, the security one) and it refuses one missing from the working tree.
  Both are right for the `shell:*` channels it was written for — `openFile` and `showInFolder` can
  do nothing with a path that is not on disk. They are not right together anywhere else, and three
  handlers now take their path through a bare `str` **because of the second check**, each with its
  own comment saying git resolves the path itself: `workdir:resolveConflict`, `workdir:restoreFile`
  and, as of GC-166, `repo:fileLog` — whose whole point is a file the working tree no longer has.
  So the containment check, which is the one that matters, is skipped by the three handlers that
  cannot use the existence check, and the reason is a comment repeated three times rather than a
  function. `repoRel` already has a sibling in this shape: `repoFile()` is `repoRel` plus a resolve.
- **Scope:**
  - Split the two: a containment-only answer (`repoRelAny`, or `repoRel(repo, path, { onDisk })`)
    and the existing `repoRel` expressed in terms of it, so there is one implementation of the rule
    that refuses a `..`, an absolute path or another drive.
  - The three handlers above take the containment-only form instead of a bare `str`, and their
    three comments collapse into the one sentence the function's own doc carries.
  - A unit test for the containment-only form: a `..`, an absolute path, another Windows drive, and
    a path that is inside but not on disk, which must now pass.
- **Out of scope:** the `shell:*` channels' behaviour, which must keep refusing a missing file;
  `repoFile()`; and any change to what the three handlers do once the path is accepted.
- **Acceptance:**
  - [ ] `repo:fileLog`, `workdir:restoreFile` and `workdir:resolveConflict` refuse a path outside
        the repository, asserted per handler.
  - [ ] A path inside the repository but absent from the working tree is accepted by the new form
        and still refused by `repoRel`.
  - [ ] The three per-handler comments are gone, replaced by the function's own.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/main/ipc.ts`, new `src/main/ipc.test.ts` (or the nearest existing home for it).
- **Verify:** `npm test`, then drive one of the three over CDP with a `../` path and read the error.
- **Log:**
  - 2026-09-06 proposed by GC-166 (this ticket's batch): its own scope said the path should go
    through `repoRel()`, and it could not, because the acceptance criterion "History on the
    fixture's deleted file lists the commit that deleted it" is exactly the case `repoRel` refuses.

---

### GC-199 A stash row carries five things at a 220px panel and the message gets 48px of them

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-171
- **Why:** measured after GC-171, in the running app at the **default** 220px panel: the row is
  219px and spends 34px on padding (`.ref-row`'s 26px left, for the folder tree's alignment, plus
  8 right), 32px on its four `--sp-2` gaps, 12 on the archive icon, 6 on `.stash-idx`, 41 on
  GC-150's short sha and 46 on GC-171's age — 171px of furniture before the message sees anything,
  which leaves it **48px of the 207 it wants**. GC-171 fixed the two things it named — the age was
  content-sized and grew with its own phrase, and git's `On <branch>: ` prefix was eating the first
  nine characters — and those were worth 12px and nine characters. What is left is not a bug in any
  one of them: it is five items on a 220px row. Two stashes can be told apart now ("the di…" against
  "rewrit…"), which is what GC-171 was asked for, but that is the floor and not a readable row.
  At 300px the message has 128px and at 420px its natural width, so this is about the default alone.
- **Scope:**
  - Decide what gives way on a narrow panel, and say why in the code. The candidates, in the order
    they cost the row: the sha (41px, GC-150 — it is the one item repeated verbatim on the graph row
    directly above the same stash), the 26px left padding (there so a row's icon aligns under the
    folder chevrons, which a stash row has none of), and the gaps.
  - Whatever gives way must come back when there is room, the way `fitOptCols` drops a whole graph
    column rather than narrowing it (GC-116) — that is the pattern this is one panel over, and its
    rule is "whole ones rather than narrowed", because half a sha identifies a commit no better
    than none.
  - A `LeftPanel.test.tsx` case pinning what is drawn at the narrow width and what comes back.
- **Out of scope:** `relativeTime`'s wording (GC-135), the prefix rule (GC-170, GC-171), the
  panel's default width, and the branch rows, whose ahead/behind is genuinely four or five
  characters.
- **Acceptance:**
  - [ ] At the default 220px panel a stash message gets materially more than 48px, measured in the
        running app, with the numbers in this log.
  - [ ] Whatever was dropped is back at a wider panel, asserted rather than eyeballed.
  - [ ] Nothing is drawn half: no truncated sha, no truncated age.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/LeftPanel.tsx`,
  `src/renderer/src/components/LeftPanel.test.tsx`, `src/renderer/src/styles/app.css`,
  `src/renderer/src/styles/tokens.css`, `CLAUDE.md`
- **Verify:** build, launch through `tools/launch-app.mjs`, take two stashes on the same branch with
  different messages, and read `getBoundingClientRect().width` back for every child of the row at
  220, 300 and 420px.
- **Log:**
  - 2026-09-06 proposed by GC-171 (this ticket's batch): its own fix landed and the row is still
    48px of message, because the pressure that is left is the number of items on the row rather
    than the width of any one of them.

---

### GC-200 The lane band's flat edge and the node's arc leave a crescent of untinted row between them

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** GC-186 put the band right of the node on every row, which is the study's own shape
  (`03-graph.md` line 45), and it reads as the lane. Where it fails is at the one pixel the two are
  supposed to meet. `Band` in `GraphCell.tsx` draws `rect x={x + NODE / 2 - 1}` — a **flat** left
  edge at the node's drawn radius — with `height={BAND_H}` = 22, while the node is a 20px circle
  whose stroke reaches r = 10. Measured in the running app on 2026-09-06: a commit row's node is
  `cx 18, r 9` and its band is `x 27, y 3, w 49, h 22`. At x = 27 the circle's outer boundary spans
  only ±sqrt(10² − 9²) = ±4.36px of the row, so between y 3 and y 9.6, and again between y 18.4 and
  y 25, the band's square corner stands clear of the arc with the row's own background showing
  through. Two crescents, one above the meeting point and one below. A **taller** band makes them
  bigger, not smaller, which is why this cannot be tuned away with `BAND_H`.
  Zoomed captures at 10x are in `%TEMP%/gitclient-review/GR-025/`: `03-commit-node-zoom.png` is a
  filled commit node and `02-node-zoom.png` the dashed WIP node, where the wedges are widest
  because that circle is unfilled against the selected row's accent wash.
  The study points at a fix as well as the defect: the same line records "a wider app-background
  **mask** hides lines behind the node", so GitKraken treats the node's neighbourhood as its own
  region rather than butting a rectangle against a circle.
- **Scope:**
  - Make the band and the node meet with nothing showing between them. The straightforward option,
    since `Band` is already drawn **first** in all three cell kinds and every line and node paints
    over it, is to start the rect at the node's **centre** (`x`) rather than at `x + NODE / 2 - 1`
    and let the circle cover what it overlaps. Any answer is fine as long as the acceptance below
    holds; say in the comment which was chosen and why.
  - Check all three cell kinds. The commit node is filled (`--bg-panel-raised`); the stash and WIP
    nodes are filled too (`--bg-panel` / `--bg-app`) but stroked **dashed**, so a band running under
    them must not show through the gaps in the dash as a tinted ring — read the pixels, do not
    assume.
  - A `GraphCell` test pinning the band's geometry against the node's, so the relationship is a
    number rather than a screenshot.
- **Out of scope:** the band's paint, which is GC-201; its height, its tint and whether it is drawn
  at all, all of which GC-186 settled; the chip connector left of the node (GC-186), which is a
  separate 2px line; and the selected row's accent wash.
- **Acceptance:**
  - [ ] On a commit row, a stash row and the WIP row, no row-background pixel lies between the
        node's outer edge and the band, at any y the band covers — read back over CDP or asserted
        in a unit test, not eyeballed.
  - [ ] A dashed node (stash, WIP) shows no band through the gaps in its stroke.
  - [ ] Every line and node still paints over the band: GC-186's "drawn first" property is
        unchanged in all three cell kinds.
  - [ ] `npm run typecheck` and `npm test` pass; no colour added to a stylesheet.
- **Files:** `src/renderer/src/graph/GraphCell.tsx`,
  `src/renderer/src/graph/GraphCell.test.tsx` (or the nearest existing home)
- **Verify:** build, launch through `tools/launch-app.mjs`, and capture `Page.captureScreenshot`
  clips at `scale: 10` around a commit node, a stash node and the WIP node, before and after, and
  look at all six.
- **Log:**
  - 2026-09-06 proposed by GR-025, from Ricardo's inbox: the band butts a square corner against a
    circle, so at the measured `cx 18, r 9` / `x 27, h 22` the two touch at exactly one point and
    leave about 6.6px of untinted row above and below it.
  - 2026-09-06 19:43 claimed

---

### GC-201 The lane band is a flat wash where it should read as light coming off the lane

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P3
- **Depends on:** GC-200
- **Why:** GC-186's band is right and Ricardo says so — the ask is the next step, not a correction.
  Today it is one rectangle at `BAND_TINT = 0.1` of the lane colour, the same opacity from the
  node's edge to the cell's, which is what makes it read as a printed rectangle: it has a hard
  right edge in the middle of the row and nothing about it says which end the lane is at. The
  GitKraken capture Ricardo compared it against reads as the row being lit from the lane rather
  than as a block laid on it. `03-graph.md` line 45 records only a "background band
  (`commit-bg-color`, 50% lane tint)", so the study settles the *place* and not the paint; this is
  our own call, which is why it is a ticket and not a bug.
  It is filed after GC-200 because that ticket decides where the band's left edge is, and a
  gradient's first stop is exactly that edge.
- **Scope:**
  - Give the band a gradient, strongest at the node and falling away to the right, so the row reads
    as lane light. An SVG `linearGradient` per lane colour is the direct route; a `color-mix` on the
    lane variable is the other. Whichever is used, the paint must come from the **same lane
    variable** the flat fill uses — no new colour literal, in the component or in a stylesheet
    (`CLAUDE.md`, Styling).
  - Keep every one of GC-186's promises, and say so in the comment: drawn **first** in all three
    cell kinds so every line and node paints over it; on **every** row, not only the selected and
    WIP ones; the height and the right edge unchanged unless the work says otherwise.
  - Check it in **both themes**: a tint calibrated on the dark ramp is not the same tint on the
    light one (GC-175), and a gradient that reads as light on dark can read as a smudge on light.
  - Screenshots of the graph in both themes, before and after, in `docs/screenshots/`.
- **Out of scope:** the band's geometry at the node (GC-200), the selected row's accent wash, the
  chip connector, and the lane colours themselves.
- **Acceptance:**
  - [ ] The band's paint varies across its width and is built from the row's lane variable; no hex
        or `rgba()` literal was added anywhere.
  - [ ] Drawn first in all three cell kinds, on every row, with every line and node over it —
        unchanged from GC-186 and asserted, not assumed.
  - [ ] Screenshots of the graph before and after in both themes, at 100%, looked at side by side.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/graph/GraphCell.tsx`, possibly
  `src/renderer/src/styles/tokens.css`
- **Verify:** build, launch through `tools/launch-app.mjs` on a repository with several lanes,
  screenshot the graph in dark and in light at full scale, and compare against
  `%TEMP%/gitclient-review/GR-025/01-graph.png`, which is the flat band as it ships today.
- **Log:**
  - 2026-09-06 proposed by GR-025, from Ricardo's inbox: the band landed and reads well, and the
    remaining complaint is that one opacity across the whole cell reads as a printed rectangle
    rather than as light off the lane.

---

### GC-202 A rejected push draws the least useful line git wrote and hides the four that explain it

- **Status:** in-progress
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** Reproduced in the running app on 2026-09-06 on the review's own scratch repository, by
  amending a commit already on `origin` and pressing Push. git wrote seven lines, all of which
  crossed IPC intact and all of which are sitting on the status bar button's `title`:
  `! [rejected]        main -> main (non-fast-forward)`, then
  `error: failed to push some refs to '<url>'`, then four `hint:` lines ending "use 'git pull'
  before pushing again". What is **drawn** is
  `error: failed to push some refs to 'C:\Users\...\remote.git'` and nothing else — the one line
  that names no cause and no remedy, with the path eating most of the width. Screenshot:
  `%TEMP%/gitclient-review/GR-025/11-push-rejected.png`.
  Two separate things put it there. `headline()` in `StatusBar.tsx` picks the first line matching
  `/^(error|fatal):|CONFLICT|failed/i`, and for a push that is the `error:` line rather than the
  `! [rejected] … (non-fast-forward)` line above it. And GC-169 built exactly the surface this
  needs — a summary on the bar, the whole of git's message in `AuthErrorDialog`, opened by clicking
  the summary — but wired `onErrorDetails` to credential failures alone, so every other multi-line
  failure still dismisses on a click and keeps its explanation in a tooltip. A `title` is not where
  a remedy belongs: nothing on screen says there is more to read.
  This is the half of Ricardo's inbox item that stands on its own — it makes **every** push, pull,
  merge and rebase failure legible, whatever is decided about force pushing in GC-203.
- **Scope:**
  - `headline()` picks the line that says *why*. A rejection's reason is on the `! [rejected]`
    line; keep the existing matches for the cases where they are already right (`fatal:`,
    `CONFLICT`). Unit-tested against real git output for at least: a non-fast-forward push, a
    fetch-first rejection, a merge conflict, an auth failure and a single-line error.
  - The details dialog opens for any failure whose message has more than one line, not only for a
    credential one: `onErrorDetails` is set whenever there is more to show, and the bar says so — a
    click must not silently dismiss a message the user has not read all of. Keep GC-169's rule that
    an ordinary one-line error still dismisses on a click.
  - `AuthErrorDialog` is the wrong name once it shows more than auth failures; rename it for what it
    is, or say in the log why it stays.
  - No change to what `git.ts` sends: the whole message already crosses.
- **Out of scope:** force pushing (GC-203); the advisory/notice split (GC-091), which is about
  severity and not about length; and any new IPC.
- **Acceptance:**
  - [ ] A push rejected as non-fast-forward draws a line naming the rejection, not "failed to push
        some refs", asserted on the rendered text.
  - [ ] The same failure offers the whole of git's message, hints included, in the dialog, reached
        without hovering anything.
  - [ ] A one-line failure behaves exactly as it does today: one line, click dismisses.
  - [ ] A credential failure is unchanged — GC-169's summary line and its dialog both still work.
  - [ ] `npm run typecheck` and `npm test` pass.
- **Files:** `src/renderer/src/components/StatusBar.tsx`,
  `src/renderer/src/components/StatusBar.test.tsx` (or the nearest existing home),
  `src/renderer/src/App.tsx`, `src/renderer/src/components/AuthErrorDialog.tsx`,
  `src/renderer/src/styles/app.css`
- **Verify:** build, launch through `tools/launch-app.mjs` against a scratch repository whose branch
  has been amended after pushing, press Push, and read the drawn line and the dialog back over CDP.
  Never against a real repository.
- **Log:**
  - 2026-09-06 proposed by GR-025, from Ricardo's inbox: measured in the app, git's seven lines
    reach the renderer and sit on a `title` while the bar draws the one line that explains nothing.
  - 2026-09-06 19:43 claimed

---

### GC-203 `--force-with-lease` is implemented, typed and validated, and no call site can reach it

- **Status:** todo
- **Area:** actions | **Size:** S | **Priority:** P2
- **Depends on:** GC-202
- **Why:** Ricardo amended a commit that was already on the remote and the app had no way to publish
  it. Confirmed in the source: `PushRequest.force` is a typed field in `shared/types.ts`, `ipc.ts`
  validates it (`force: !!r.force`) and `push()` in `git.ts` turns it into `--force-with-lease` —
  the safe form, which refuses when the remote has moved since the last fetch. All five call sites
  in `App.tsx` pass only `remote`, `branch` and `setUpstream`: the toolbar button (line 2354), its
  popover, the branch menu's two rows (1675, 1689) and the tag menu's (1540, 1543). So the
  capability has never been reachable from the UI, and a grep for `force` outside `deleteBranch`
  finds it only in the type, the handler and the git call.
  Amending a published commit is the ordinary case, not an exotic one, and it is the one the
  staging form's own Amend checkbox leads people into.
- **Scope:**
  - A way to force a push, using the `--force-with-lease` that already exists — never `--force`.
    The natural home is the Push popover, which already carries the push's options, with the branch
    menu's rows a second candidate; pick one and say why in the log rather than adding it
    everywhere.
  - Behind a confirmation through `useUi().confirm` (`CLAUDE.md`, UI layer — the native `confirm()`
    is not used), whose wording says what is being overwritten and names the remote and branch, the
    way every other row that pushes names its remote rather than an upstream ref (GC-114).
  - The rejection GC-202 makes legible is the natural way in: a user who has just been told the push
    was rejected as non-fast-forward is the one who needs this. Whether the dialog offers it
    directly is a judgement call — decide it and say why, but do not make a destructive action a
    one-click follow-on from an error message without a confirmation of its own.
  - The amend path: the staging form offers Amend with nothing saying the commit being amended is
    already published. Say so where the checkbox is — the branch's ahead/behind is already in the
    snapshot, so "this commit is on `<remote>`; amending it will need a force push" is a derivation
    and not a new git call. If that turns out to need more than a line, file it and say so here.
- **Out of scope:** `--force` without a lease, ever; force-pushing tags; deleting a remote branch
  (GC-112 owns that); and the message a rejection draws (GC-202).
- **Acceptance:**
  - [ ] A force push is reachable from the UI, runs `--force-with-lease`, and is asserted by reading
        the command git received rather than by the push appearing to work.
  - [ ] It asks first, through the app's own modal, and the question names the remote and the
        branch.
  - [ ] Cancelling runs nothing.
  - [ ] A force push whose lease is stale — the remote moved after the last fetch — fails and
        reports, rather than overwriting.
  - [ ] The amend hint appears only when the commit being amended is on a remote, and never costs a
        git call.
  - [ ] `npm run typecheck` and `npm test` pass; the e2e suite still passes.
- **Files:** `src/renderer/src/App.tsx`, `src/renderer/src/components/Toolbar.tsx`,
  `src/renderer/src/components/DetailPanel.tsx`, `tools/e2e/run.mjs`, `CLAUDE.md`
- **Verify:** build, and drive it against the **e2e scratch repository only** (`CLAUDE.md`, rule 2):
  amend a commit that is on the fixture's bare `remote.git`, force push, and assert with
  `git -C remote.git rev-parse` that the remote ref moved. Never against `catena-feed` or
  `kyushu-route`.
- **Log:**
  - 2026-09-06 proposed by GR-025, from Ricardo's inbox: he could not publish an amended commit;
    the flag that would have done it safely is implemented and validated and reachable from nowhere
    in the renderer.

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

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-025 Backlog review 2026-09-06 19:35

- **Status:** done
- **Window:** 7e75deb..c97776b
- **Log:**
  - 2026-09-06 19:35 inbox: **three items in Pending**, all three investigated, all three
    reproduced in the built app or confirmed in the source, and all three ticketed — as four
    tickets, because the third item names two halves that stand apart. Nothing declined, nothing
    left in Pending. Item by item:
  - inbox 1 (the band should read as light off the lane, not a flat wash) **-> GC-201**. Confirmed
    as written: `Band` is one rect at `BAND_TINT = 0.1`, the same opacity from the node's edge to
    the cell's, measured on the fixture as `x 27, y 3, w 49, h 22, opacity 0.1, fill var(--lane-0)`.
    His constraint is right and is carried into the acceptance verbatim: the paint must come from
    the same lane variable, so an SVG `linearGradient` or a `color-mix` and never a literal, with
    GC-186's three promises — drawn first in all three cell kinds, on every row, height and right
    edge unchanged — asserted rather than assumed. Filed P3 and **after GC-200**, because that
    ticket moves the band's left edge and a gradient's first stop is exactly that edge. One thing
    added from the study he did not have: `03-graph.md` line 45 records the *place* and the 50%
    selected-row tint and says nothing about the paint, so the gradient is our own call.
  - inbox 2 (the band does not attach to the circle) **-> GC-200**, and his geometry is exactly
    right. Measured in the running app: node `cx 18, r 9` — stroke width 2, so the outer edge is at
    r = 10 — against a band starting at `x 27` with `h 22`. At x = 27 the circle spans only
    ±sqrt(10² − 9²) = ±4.36px, so the band's square corner stands clear of the arc from y 3 to
    y 9.6 and again from y 18.4 to y 25. Two 10x clips are the evidence and both are unmistakable:
    `03-commit-node-zoom.png` (a filled commit node) and `02-node-zoom.png` (the dashed WIP node on
    a selected row, where the wedges are widest). His proposed fix — run the band from the node's
    **centre** and let the circle paint over it — is sound and is written as the straightforward
    option rather than as the requirement: `Band` is already drawn first in all three cell kinds.
    His ask to check the WIP and stash nodes is in the scope and in an acceptance box of its own,
    with the reason he could not have known: both are filled as well as dashed
    (`--bg-panel` / `--bg-app`), so the risk is a tinted ring through the gaps in the dash rather
    than a band showing through the middle. The study is on his side too — the same line records "a
    wider app-background **mask** hides lines behind the node", so GitKraken does not butt a
    rectangle against a circle either.
  - inbox 3 (an amended commit could not be pushed) **-> GC-202 and GC-203**, split at the seam he
    drew himself. His reading of the code is exactly correct: `PushRequest.force` is typed,
    `ipc.ts` validates it as `force: !!r.force`, `push()` turns it into `--force-with-lease`, and
    all five call sites in `App.tsx` (2354, the popover, 1675, 1689, 1540/1543) pass only `remote`,
    `branch` and `setUpstream` — a grep for `force` outside `deleteBranch` finds it in the type, the
    handler and the git call and nowhere else. That half is **GC-203**, P2, behind a confirmation
    through `useUi().confirm`, `--force-with-lease` only and never `--force`, with his amend-path
    observation in scope: the ahead/behind is already in the snapshot, so warning at the Amend
    checkbox is a derivation and not a git call.
    The other half is the better ticket and is filed **P1 as GC-202**, because I reproduced it and
    it is worse *and* smaller than it looked. Amending a pushed commit in the review's own scratch
    repository and pressing Push in the app: git wrote seven lines and **all seven crossed IPC
    intact** — they are sitting on the status bar button's `title` — while the bar drew
    `error: failed to push some refs to 'C:\Users\...\remote.git'`, which is the one line naming
    neither the cause nor the remedy, with the path taking most of the width
    (`11-push-rejected.png`). So this is not a message that was lost, it is two wiring faults:
    `headline()` matches `^(error|fatal):|CONFLICT|failed` and so prefers the `error:` line over the
    `! [rejected] main -> main (non-fast-forward)` line above it, and GC-169's details dialog —
    which already exists and already shows the whole of git's message — is wired to
    `onErrorDetails` for credential failures alone, so every other multi-line failure dismisses on a
    click with its hints in a tooltip. Fixing it makes every push, pull, merge and rebase failure
    legible, whatever is decided about GC-203, which is why it goes first and why GC-203 depends
    on it.
  - shipped: **four commits, one of them code.** `1cfb619` and `c97776b` are claims, `eb29407` is
    GR-024, and `aa4c569` is GC-189/190/173/166/171/175 at 33 files and +1416/-409. Read as a
    reviewer, it holds up. `getFileLog` is the same `--date-order` traversal and the same
    `LOG_FORMAT`, and GC-166 extracted `parseCommits` so the two cannot drift — the right move.
    `scopeOf`'s new `config` case cannot loop, for the reason its own comment gives: a full reload
    reads config and never writes it. `revisitTab` drops the empty tab with a `setTabs` and touches
    neither `gitclient.tabs` nor the reopen stack, which is correct since neither holds an empty
    tab. `DiffView`'s `nav` and `hist` are both derived during render against the identity they
    were chosen for, which is GC-075's discipline applied without an effect. The one thing I would
    have written differently is not worth a ticket: the history is keyed `repo|path` with no
    `version`, so a commit made while a file view is open leaves the list one commit short until
    the view is reopened — deliberate ("a visit to it is not a fetch"), narrow, and self-correcting.
    No new ticket came out of the code-review pass.
  - health: at `c97776b` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    495 tests passed (26 files)** in 15.29s, **build ok** into the worktree's own `out/`, whose
    mtime I checked against `MAIN`'s to confirm nothing was written there. `MAIN` was never built,
    tested or launched.
  - app: the worktree's build ran offscreen on 9334 against the review's own scratch root. Eleven
    captures in `%TEMP%/gitclient-review/GR-025/`, all looked at. `01` is the graph with GC-186's
    band; `02` and `03` are the 10x node clips that carry GC-200. `04` commit, `05` staging, `06` a
    diff. `07` is **GC-166's History list**, this window's new surface, working: two rows for
    `a.txt` with summary, author, GC-135's relative time and the short sha, and the diff-only
    controls correctly greyed with `HISTORY_OFF` on them. `08`–`10` are this run's rotation, the
    **light theme** (GC-175) — graph, commit view and the branch context menu, which is the surface
    GR-024 did not take. It reads as intended: the ramp is subtle by construction, since the dark
    ratios it reproduces are 1.16:1 between adjoining surfaces. I measured text contrast rather
    than judging it, and it is sound — graph message 8.87:1, ref row 9.90, statusbar path 5.47,
    graph author 5.15; the weakest is `.ctx-hint` at 3.35:1, which is a 12px hint and the same
    role dark gives its dimmest alpha, so I am recording it here rather than filing it. `11` is
    the rejected push behind GC-202.
  - tickets: added **GC-200** (ui, S, P2), **GC-201** (ui, S, P3), **GC-202** (ui, S, P1),
    **GC-203** (actions, S, P2) and **GC-204** (diff, M, P3). The first four are the inbox and do
    not count against the reviewer's own budget; **GC-204 is this review's own**, from the
    what's-next pass. `04-panels.md` puts Blame and History in one slot of the file view's header,
    GC-166 shipped History into exactly that slot last night, and GC-166's own Out of scope says
    "Blame … is its own ticket" — which nobody then wrote, though GR-018 and four reviews after it
    all named it as "worth a later look". Every reason to defer it has gone: the surface, the
    segmented control, the identity-keyed load and `time.ts` all exist, and it is the last Build row
    of `06-feature-inventory.md`'s file panel still missing. Deduplicated against every open row:
    nothing touches the band, the push path, the status bar's headline or the file view's modes;
    GC-198 is the containment check GC-204 wants and is named as a soft dependency rather than
    duplicated.
  - board: **GC-202 goes above every open todo**, at P1 — a push rejected as non-fast-forward is
    an ordinary situation with no explanation and no way through, and the fix is small because the
    message and the dialog both already exist. Then **GC-200** and **GC-203** in the P2 block ahead
    of GC-197 and GC-196: GC-200 is on every row of the main screen and is a few lines of geometry,
    and GC-203 sits with the ticket it depends on. **GC-201** and **GC-204** go into the P3 block
    after GC-199, before the two blocked L tickets. Nothing already on the board moved.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081, none unblockable from here for the reasons
    GR-022 gave. Six tickets are `in-progress` at `c97776b` (GC-191, GC-192, GC-193, GC-194,
    GC-195, GC-177), claimed while this review was preparing; the board was re-read immediately
    before this write and no new id collides with any of them. No `todo` has gone vague; GC-196's
    dependency on GC-191 and GC-192 still reads correctly now that both are being implemented.
  - notes: `CLAUDE.md` at `c97776b` says "495 tests today", which matched this run exactly, and its
    GC-166, GC-171, GC-173, GC-175 and GC-190 paragraphs are all current. GR-020's finding about
    the GC-135 paragraph is settled — GC-171 shipped and `CLAUDE.md` now states the `--row-when-w`
    rule and retracts the old "at 300px the name is back at its natural width" claim by name.
    Nothing stale found this run. Flagged here rather than edited; the reviewer never touches
    `CLAUDE.md`.
  - isolation: `MAIN` was never built, tested or launched, and its working tree — which held
    twenty-one of the worker's uncommitted source edits and screenshots throughout — was left
    exactly as found; this write waited for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be clean and
    stages only those two. The worktree was added and removed through
    `tools/scratch-worktree.mjs` (GC-189), which reported `node_modules: 109 entries` on the way in
    and asserted `.bin` on the way out. The only repository written to was the review's own scratch
    root, where a commit was amended to produce the rejected push and then reset back to
    `772b41b` so the next run's fixture is undrifted; `catena-feed` and `kyushu-route` were **not
    opened**. The review's Electron on 9334 was found by command line and stopped by PID tree,
    leaving nothing listening on the port; four unrelated `electron.exe` processes belonging to
    `MAIN`'s checkout were left alone, which is what rule 4 exists for.
