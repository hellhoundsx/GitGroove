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
| GC-189 | Removing a review worktree can delete the real `node_modules` through its junction | infra | S | P1 | todo |
| GC-190 | A remote added outside the app never appears until the window is reloaded | ui | S | P2 | todo |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-173 | An empty tab given a repository that is already open is left behind | ui | S | P3 | todo |
| GC-166 | A file can be diffed but never followed: no history for one path | graph | M | P3 | todo |
| GC-171 | A stash row spends 66px on its age and leaves its message 77px of the 192 it wants | ui | S | P3 | todo |
| GC-175 | The light theme is a mechanical inversion of the dark one, and every surface boundary is weaker | ui | M | P3 | todo |
| GC-177 | Which left-panel sections are open is forgotten on every reload | ui | S | P3 | todo |
| GC-178 | A selected stash says what it is and offers nothing to do with it | ui | S | P3 | todo |
| GC-183 | The graph row's own change readout is the text glyphs GC-143 took out of the panel | ui | S | P3 | todo |
| GC-184 | The folded +N block cannot be opened by any driver, so nothing covers it end to end | tests | S | P3 | todo |
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

### GC-183 The graph row's own change readout is the text glyphs GC-143 took out of the panel

- **Status:** todo
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

### GC-189 Removing a review worktree can delete the real node_modules through its junction

- **Status:** todo
- **Area:** infra | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** The review routine's isolation recipe — "a detached git worktree of `origin/main` under
  `%TEMP%/gitclient-review/wt` (with `node_modules` junctioned from here), which it removes when
  done" — has a hole in its last step. A recursive removal of that worktree **follows the
  junction** and deletes files out of this checkout's real `node_modules`.
  Measured on 2026-09-06 during the GC-186 batch, which made the same kind of worktree to read a
  baseline test count: after `Remove-Item <wt>/node_modules -Force` (which failed on its own
  confirmation prompt) and `git worktree remove --force <wt>`, this repository's
  `node_modules/.bin` and 129 packages were gone — every entry alphabetically before
  `@esbuild`, `@babel/*` among them. `npm run typecheck` then failed with "'tsc' is not
  recognized" and `npm run build` with "Cannot find package '@babel/core'". The repair was
  `npm rebuild --ignore-scripts` followed by `npm install --ignore-scripts`, and it was nearly
  worse: a plain `npm install` was refused with `EBUSY` on
  `node_modules/electron/dist/resources/default_app.asar` because an unrelated Electron was
  running, and killing it is exactly what rule 4 forbids.
  The hourly reviewer has been doing this for weeks without the damage showing, so whatever order
  it uses is either safe or lucky; either way the order is currently a sentence in
  `TICKETS.md` rather than something a script gets right by construction, and every session that
  follows the recipe by hand can hit it.
- **Scope:**
  - One helper both routines can call — `tools/scratch-worktree.mjs` or similar — that makes a
    worktree with a junctioned `node_modules` and removes it again, in the one order that is
    safe: delete the junction as a **link** (not its contents), assert it is gone and that this
    checkout's `node_modules/.bin` still exists, and only then `git worktree remove`.
  - It refuses to remove anything if the junction is still present, so a failure leaves the
    worktree standing rather than reaching through it.
  - A unit test beside it, on a temporary directory, pinning that the link is removed and the
    target's contents are not — the property that was violated.
  - The "Review routine" paragraph in `TICKETS.md` names the helper instead of describing the
    steps.
- **Out of scope:** the review routine's own scheduled prompt (outside this repository), and any
  change to how `node_modules` is shared.
- **Acceptance:**
  - [ ] The helper creates and removes a worktree whose `node_modules` is a junction, and this
        checkout's `node_modules` is byte-identical before and after — checked by counting entries
        and asserting `.bin` survives.
  - [ ] A unit test covers the link-versus-contents distinction.
  - [ ] Removal refuses to proceed while the junction is still there.
  - [ ] `TICKETS.md`'s review-routine paragraph points at the helper.
- **Files:** new `tools/scratch-worktree.mjs`, new `tools/scratch-worktree.test.ts`, `TICKETS.md`
- **Verify:** run the helper twice over, and after each removal print
  `(Get-ChildItem node_modules).Count` and `Test-Path node_modules/.bin` for this checkout; both
  must be unchanged. Then `npm test`.
- **Log:**
  - 2026-09-06 proposed by GC-186 (this ticket's batch): the batch's own baseline measurement
    destroyed 129 packages and `node_modules/.bin` in this checkout by removing a worktree whose
    `node_modules` was a junction, and the repair was blocked by an unrelated running Electron.

---

### GC-190 A remote added outside the app never appears until the window is reloaded

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** GC-011
- **Why:** `scopeOf` in `watch.ts` answers `refs` for `.git/refs`, `.git/HEAD` and
  `.git/packed-refs`, and `tree` for everything else. `.git/config` is everything else, so a
  change to it refreshes the status and nothing more — and the remotes, which only the full
  snapshot carries, stay as they were.
  Measured on 2026-09-06 while verifying GC-159: `git remote add web <url>` in the scratch
  repository, with the app open on it, never produced a REMOTE row — a 20-second wait on the DOM
  timed out, and the row appeared immediately after a page reload. The same is true of anything
  else `.git/config` holds that the app draws: a branch's upstream set with
  `git branch --set-upstream-to` on the command line, a remote's URL edited by hand, a remote
  renamed or removed. The app's own actions are unaffected, because `run()` reloads the snapshot
  itself; this is only about a change made outside it, which is exactly what GC-011 exists for.
- **Scope:**
  - `scopeOf` answers `refs` for `config` as well, so a `.git/config` write triggers the full
    reload that a ref change already does.
  - Check that this cannot loop: the app writes `.git/config` itself (`remoteAdd`,
    `remoteSetUrl`, `setUpstream`), and a full reload must not be able to cause another write to
    it. The `.git/index.lock` loop that `watch.ts` documents is the precedent to check against.
  - A unit test in `watch.test.ts` beside the existing `scopeOf` cases.
- **Out of scope:** watching anything else under `.git/` that is currently ignored, and the
  debounce.
- **Acceptance:**
  - [ ] `scopeOf('.git/config')` is `refs`, covered by a unit test.
  - [ ] With the app open on the scratch repository, `git remote add` on the command line makes
        the REMOTE row appear without a reload.
  - [ ] `git branch --set-upstream-to` on the command line updates the branch row's
        ahead/behind the same way.
  - [ ] Adding a remote through the app still costs one reload, not two.
- **Files:** `src/main/watch.ts`, `src/main/watch.test.ts`
- **Verify:** `npm test`, then launch on the scratch repository and run `git remote add` and
  `git remote remove` from a shell, watching `data-gen` on the status bar move and the row
  appear and go.
- **Log:**
  - 2026-09-06 proposed by GC-159 (this ticket's batch): the ticket's own positive case could not
    be reached without a page reload, because a `.git/config` change scopes the watcher to
    `tree` and the remotes only come with a full snapshot.

---

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-023 Backlog review 2026-09-06 17:35

- **Status:** done
- **Window:** fa60c51..6996bc0
- **Log:**
  - 2026-09-06 17:35 inbox: `INBOX.md` exists and its **Pending section is empty** — GR-020 drained
    the last three items and nothing has been added since. Nothing to investigate from the file,
    nothing declined, nothing left in Pending, and it is not rewritten this run. Ricardo was
    however **at the machine and sent two messages mid-run**, which are stakeholder input by any
    other name and were treated as inbox items: "can you focus on improving design?", which
    redirected the rest of the budget from the code-review pass to the UI pass, and a correction to
    GC-147 with a GitKraken capture attached, which became GC-186. Both are recorded here rather
    than in `INBOX.md`, which he did not write them to.
  - shipped: **three commits**, one of them code. `7b7b280` is GR-022 itself, `6996bc0` the current
    claim, and `fa60c51` is the whole of the previous batch — GC-179, GC-128, GC-143, GC-146,
    GC-147 and GC-149 — at 36 files and +1115/-347. Read as a reviewer: GC-128's `cloneRepo` is
    sound where it matters, running in the parent because `runGit` refuses a cwd that does not
    exist, naming the folder on the command line so the path it answers with is the path git used,
    and refusing a folder name that is really a path before anything is spawned (`folder !==
    basename(folder)` catches `../x`, an absolute path and a drive-relative `C:x` alike). It goes
    through `runRemote`, so GC-176's test picks it up. `report()` extracted out of `run()` is the
    right shape and both callers now report a credential refusal identically. Two nits not worth
    tickets: `makeRepo` calls `report(e)` **without** the `owns()` guard `run()` applies, so a
    clone failing while another action owns the status bar writes over it — unreachable in
    practice, since a clone is not startable while the bar is busy; and `RefChip.tsx`'s new JSDoc
    for `kindMarks` opens at column 0 inside the interface, which is cosmetic. **One real defect
    found, and it is in the diff rather than in the app's older code — GC-185, below.**
  - health: at `6996bc0` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    417 tests passed (25 files)** in 2.84s, **build ok**, into the worktree's own `out/`. The one
    `act(...)` warning from `DetailPanel.test.tsx` is still there and still a warning. `MAIN` was
    never built, tested or launched; its `out/` timestamp was left at the worker's own 17:08.
  - app: the worktree build ran offscreen on 9334 against the review's own scratch root. Seven
    screenshots in `%TEMP%/gitclient-review/GR-023/`, all looked at. `01` is the graph with
    GC-146's laptop/cloud marks and GC-147's band; `05` is the **Preferences dialog**, this run's
    rotation surface, which I checked for GC-142's boundary treatment and found already has it —
    `.pref-group-title` carries `border-bottom: 1px solid var(--border)`, so the impression that
    its groups float is the half-scale screenshot and not the app, and no ticket was filed for it.
    Its body does scroll unsignalled (802 against 744) but that is GC-103's deliberate shape.
    `06`/`07` are 2x crops of the ref column and a selected row, which is where GC-186 was measured.
  - **GC-128 driven end to end.** The clone dialog was opened from the repository menu, which now
    reads Recently opened / Open repository… / Clone repository… / Initialise repository…. Cloning
    the fixture's bare `remote.git` into a scratch folder worked exactly as specified: it made
    `clonedest/remote`, opened it in a **new** tab beside the fixture rather than replacing it
    (GC-164's rule), and the bar read "remote / 8 commits". A wrong URL reported git's own `fatal:
    … does not appear to be a git repository` on the status bar and left the open repository alone.
    **-> GC-185:** the dialog's "Browse…" is `disabled` on opening and stays disabled until "Clone
    into" has been typed by hand. Measured, not inferred: `Cancel:live | Browse…:disabled |
    Clone:disabled` on opening, unchanged after filling the URL alone, live only once both fields
    are filled. `Modal.tsx:139` gates the secondary on the same `incomplete` as OK, and GC-128 is
    the first caller whose secondary meets a required field — the other two pass `input: false`.
    Filed P1: the folder picker is unreachable for its purpose from every cold clone.
  - **-> GC-186, and it is this review's headline.** Ricardo saw GC-147's band and said it is on
    the wrong side of the node and on too few rows. The study agrees with him and GC-147 read it
    backwards: `03-graph.md` line 45 puts the lane-tinted band **right** of the node, line 58 makes
    the chip-to-node connector a **2px line**, and what shipped is a 22px band left of the node
    with a 1px line on it and nothing to its right. Measured: **4 of 9 fixture rows carry a
    `.ref-line`** (`joined = rowRefs.length > 0`), `.col-msg`'s background is `rgba(0, 0, 0, 0)`,
    and the selected row is a flat `rgba(77, 136, 255, 0.2)` wash rather than a lane band. Filed
    P1, M, with the selected row's treatment inside its scope, since a band on every row and a full
    wash on the selected one cannot both stand.
  - tickets: added **GC-185** (ui, S, P1) and **GC-186** (graph, M, P1). Both come from the UI pass,
    which is where Ricardo asked the budget to go; the code-review pass contributed the two nits
    above and no ticket of its own. Deduplicated against every open row: nothing mentions the clone
    dialog, and GC-147 is `done` so its correction is a new ticket rather than a reopening. GC-183,
    which is the graph row's text glyphs, is adjacent to GC-186 but is the message column's readout
    and stays separate.
  - board: both new rows go **directly under GC-180**, the P1 the worker holds, and above the P2
    block — GC-186 first, because it is the one Ricardo raised and the one on screen in every
    session. Nothing else moved; the P3 order still looks right and no `todo` has gone vague.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081, none unblockable from here for the reasons
    GR-022 gave. GC-159's "View on service" is still uncovered and still needs no second ticket.
  - notes: `CLAUDE.md` at `6996bc0` says "417 tests today", which matched the run exactly, and its
    GC-147 paragraph — "a band joining the last chip to its node in two halves that meet at the
    column boundary" — is the invariant GC-186 will have to rewrite, in both the Graph section and
    the design-decisions paragraph. Flagged here rather than edited; the reviewer never touches
    `CLAUDE.md`. GR-020's finding about the GC-135 paragraph still stands, still carried by GC-171.
  - isolation: six tickets were `in-progress` throughout (GC-180, GC-181, GC-182, GC-151, GC-150,
    GC-152) and not one was touched; the two ids added are above every id the worker holds. `MAIN`
    was never built, tested or launched and its working tree was left as found — this write waited
    for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be clean and stages only those two, while
    twenty-one of the worker's source edits sat uncommitted beside them. The only repositories
    written to were the review's own scratch root and a throwaway clone under `%TEMP%`;
    `catena-feed` was **not opened** this run, and the clone that verified GC-128 pulled from the
    fixture's own bare `remote.git`, never from a real remote. The review's Electron on 9334 was
    found by command line and stopped by PID tree; zero remained afterwards.
