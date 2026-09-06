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
| GC-191 | With many changed files the commit message is a clipped line and the commit form is off the panel | ui | S | P1 | todo |
| GC-192 | A file row prints its folder and its name as two things, and cuts the name rather than the folder | ui | S | P2 | todo |
| GC-193 | A tab and a toolbar button answer the pointer with 25% of alpha and nothing else | ui | S | P2 | todo |
| GC-194 | The two crumbs open menus and draw nothing that says so | ui | S | P2 | todo |
| GC-195 | A scrolling modal puts its scrollbar 17px inside its own border | ui | S | P2 | todo |
| GC-197 | The staging view's two file lists cannot be collapsed, so Staged is unreachable past 20 files | ui | S | P2 | todo |
| GC-196 | The detail panel's second design pass: an audit against the study before anything changes | ui | M | P2 | todo |
| GC-081 | Time the e2e run's 141 git spawns and drop the redundant ones | tests | S | P3 | blocked |
| GC-177 | Which left-panel sections are open is forgotten on every reload | ui | S | P3 | todo |
| GC-178 | A selected stash says what it is and offers nothing to do with it | ui | S | P3 | todo |
| GC-183 | The graph row's own change readout is the text glyphs GC-143 took out of the panel | ui | S | P3 | todo |
| GC-184 | The folded +N block cannot be opened by any driver, so nothing covers it end to end | tests | S | P3 | todo |
| GC-198 | `repoRel()` cannot answer "is this path inside the repository" without also requiring it on disk | infra | S | P3 | todo |
| GC-199 | A stash row carries five things at a 220px panel and the message gets 48px of them | ui | S | P3 | todo |
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

### GC-191 With many changed files the commit message is a clipped line and the commit form is off the panel

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P1
- **Depends on:** none
- **Why:** `.detail-body` is a flex column with `overflow: auto`, and a flex item whose overflow is
  anything but `visible` has an automatic minimum size of **zero**. `.message-box` carries
  `overflow: auto`, so it is the one block in that column that can be crushed to nothing;
  `.file-list` has no overflow of its own and so cannot shrink below its rows. The result is that
  the file list takes the panel and the message — the thing a reader opens a commit for — is what
  gives way. `max-height: 160px` is a cap with no floor under it.
  Measured on 2026-09-06 in the built app at 1400x900, on a throwaway repository with a 29-file
  commit carrying this project's own kind of long summary: `.message-box` rendered **12px of
  clientHeight against a scrollHeight of 160**, and its `h2` — the summary alone — wanted **100px**
  (four lines) and got 12. One clipped half-line of "GC-180, GC-181, GC-182, GC-151, GC-150" was
  all that was readable, with `.file-list` at 801px beside it.
  The **staging view is worse, and by the same cause**: with 29 unstaged files, `.detail-body`
  measured `scrollHeight 1084` against `clientHeight 756`, and `.commit-form` — 201px of summary
  field, description and commit button — sat entirely below the fold, 328px down. The app's
  primary action is unreachable without scrolling past every changed file. Nothing in either view
  is broken at four or five files, which is why this has stood.
  GitKraken's own shape, from `docs/reference/gitkraken/04-panels.md` line 60 onwards, is the
  opposite arrangement in both views: the commit view's message sits at the top at its natural
  height, and the staging view's bottom section (message box, amend, commit button) is a
  **vertically resizable section with a default of about 275px** with the file lists sharing what
  is left. The file list is what scrolls.
- **Scope:**
  - The message box keeps a floor tall enough for its **summary in full** — the description may
    still be capped and scroll — instead of being the block that collapses. `flex: none`, or an
    explicit `min-height`, or moving the `overflow` off the flex item; whichever is chosen, state
    in a comment why a flex item with `overflow` cannot be left to shrink.
  - `.file-list` becomes the block that gives way and scrolls, in both the commit view and the
    staging view, so the blocks above and below it keep their place.
  - The staging view's `.commit-form` keeps its place at the bottom of the panel at every file
    count, rather than being pushed below the fold.
  - Check a one-line message as well as a long one: a short message must not gain empty space,
    which is the failure mode a bare `min-height` introduces.
- **Out of scope:** making the commit form drag-resizable (GitKraken's section is; ours need only
  keep its place), collapsing the Unstaged / Staged groups (GC-197), the file rows' own layout
  (GC-192), and the panel's wider design pass (GC-196).
- **Acceptance:**
  - [ ] With a 29-file commit selected at the default 400px panel, the summary renders in full
        (its `h2` `scrollHeight` equals its `clientHeight`) and the file list scrolls.
  - [ ] With 29 unstaged files, the commit summary input is inside `.detail-body`'s visible box
        without scrolling — measured, not eyeballed.
  - [ ] A one-line commit message leaves the message box at its natural height, with no reserved
        empty space below the text.
  - [ ] The same two checks hold at the 300px panel minimum.
  - [ ] A screenshot of each view at 29 files in `docs/screenshots/`.
- **Files:** `src/renderer/src/styles/app.css`, possibly
  `src/renderer/src/components/DetailPanel.tsx`
- **Verify:** build, launch through `tools/launch-app.mjs` on a repository with a commit touching
  around thirty files and a working tree of the same size, and read back
  `getBoundingClientRect()` and `scrollHeight`/`clientHeight` for `.message-box`, its `h2`,
  `.file-list`, `.commit-form` and `.detail-body` over CDP in both views.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: reproduced in the built app and measured
    — the message box gets 12px of the 160 it wants and the staging view's commit form sits 328px
    below the fold, both because `overflow: auto` on a flex item makes it the only block that can
    shrink.

---

### GC-192 A file row prints its folder and its name as two things, and cuts the name rather than the folder

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `FileRow` in `DetailPanel.tsx` splits a path into a `.dir` and a `.name` span — which is
  the study's own treatment (`04-panels.md` line 70: "path in dim text and filename in normal
  text") — but `.file-row` is a flex row with `gap: var(--sp-2)`, and that gap falls **between the
  two halves of one path** as well as after the kind icon. Measured on 2026-09-06 in the built
  app: `gapPx: 8` between `src/renderer/src/components/` and `DetailPanel.tsx`, so one path reads
  as two separate columns. The study records no such gap.
  The second half is the ellipsis, and it is backwards by the app's own rule that a name is the
  identity of the thing (GC-071 for a ref chip, GC-135 for a stash row). `.file-row .name` carries
  `overflow: hidden; text-overflow: ellipsis` and `.dir` carries neither, so the folder keeps its
  full width and the **filename** is what gets cut. Measured at the 300px panel minimum:
  `.dir` 170px unclipped, `.name` cut from 83px to 53px. The folder is also the half that should
  lose its *head* rather than its tail, which `.ctx-hint.path` already does with `direction: rtl`
  (GC-067, GC-165).
  The file view's own header was checked with it, as Ricardo asked: it is **not** affected by the
  gap — `DiffView.tsx` puts both spans inside one `.path` span, and the measured gap there is
  `0`. It has the other half of the problem, though: `.file-view-head .path` ellipsises the whole
  run at its end, so a path too long for the header loses the filename.
- **Scope:**
  - The gap between `.dir` and `.name` goes, without losing the gap after the kind icon or before
    the hover actions — so it is a rule on the two spans rather than a change to `.file-row`'s
    own `gap`.
  - The folder is what gives way: `.dir` shrinks and ellipsises, `.name` keeps its natural width.
  - The folder ellipsises at its **start**, reusing the `direction: rtl` treatment
    `.ctx-hint.path` and `.recent-row .recent-path` already share, so the folder nearest the file
    is the part that survives.
  - The file view's header gets the same answer: the filename survives and the folder gives way.
  - A comment saying which half is the identity and why, in the `app.css` block.
- **Out of scope:** the kind icons (GC-143, done), the hover action buttons, and anything about
  the panel's vertical composition (GC-191).
- **Acceptance:**
  - [ ] `.dir` and `.name` render with no space between them in a detail-panel file row —
        measured, `Math.round(name.left - dir.right) === 0`.
  - [ ] At the 300px panel minimum, a row whose path is `src/renderer/src/components/DetailPanel.tsx`
        shows the whole filename and an ellipsised folder, not the reverse.
  - [ ] The folder's ellipsis is at its start, so the last folder segment is readable.
  - [ ] The same two properties hold in the file view's header.
  - [ ] The gap after the kind icon and before the hover actions is unchanged.
- **Files:** `src/renderer/src/styles/app.css`, possibly
  `src/renderer/src/components/DetailPanel.tsx` and `src/renderer/src/diff/DiffView.tsx`
- **Verify:** build, launch on a repository with deeply nested changed files, and read back
  `getBoundingClientRect()` for `.dir` and `.name` plus `scrollWidth` versus `clientWidth` for
  each, at the default panel and at 300px, in the detail panel and in the file view.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: measured the 8px gap and confirmed the
    ellipsis is on the filename rather than the folder; the file view's own header shares the
    ellipsis half but not the gap, since its two spans sit inside one `.path`.

---

### GC-193 A tab and a toolbar button answer the pointer with 25% of alpha and nothing else

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `.titlebar .tab:hover`, `.titlebar .tab-icon-btn:hover` and `.tool-btn:hover` all do
  exactly one thing: lift the text from `--text-muted` to `--text-bright`. No background, no
  shape, no border. Measured on 2026-09-06 in the built app: a toolbar button goes
  `rgba(255,255,255,0.75)` to `rgb(255,255,255)` with `backgroundColor` staying
  `rgba(0,0,0,0)` — a 25% alpha lift on a 10px label is the whole of the feedback. And the
  **selected** tab has no hover response at all: idle and hovered both measured
  `color rgb(255,255,255)` on `background rgb(51,55,63)`, byte for byte, because
  `.tab.selected` already sets the brightest text there is.
  The vocabulary for this is already in the app and already calibrated: `--accent-hover` is what
  `.file-row:hover` and every `.ref-row:hover` use, and `--hover-overlay` is what
  `.tab-close:hover` uses — so the two busiest rows in the window are the two that opted out.
  The study's Row states table (`02-design-tokens.md`) puts GitKraken's hover row at
  `rgba(77,136,255,0.10)`, the value `--accent-hover` was calibrated against, and its `plain`
  button hovers to the same tint. It does **not** record a hover treatment for GitKraken's own
  toolbar icon buttons or tab strip, so this is the app's own vocabulary applied consistently
  rather than a measurement to match; if the study's screenshots settle it, record what they say.
- **Scope:**
  - A tab answers the pointer with a background, not only with brighter text, and the **selected**
    tab answers too — one step above whatever it already draws.
  - The three title-bar buttons (`.tab-icon-btn`: open, new tab, recents) take the same treatment
    as a tab, since they sit in the same row.
  - `.tool-btn` takes a background on hover, within its own box, and keeps its `:disabled` and
    `.active` states distinguishable from it.
  - Every value comes from an existing token in `tokens.css` or a new token there — never an
    `rgba()` in `app.css`, which `tools/repo-hygiene.test.ts` enforces.
  - Check both themes: a tint calibrated on `--bg-titlebar` in the dark theme has to still read on
    the light one.
- **Out of scope:** the toolbar's layout, the split Pull/Push buttons' own carets, `.crumb`
  (GC-194), and the graph and panel rows, which already have their hover.
- **Acceptance:**
  - [ ] Hovering an unselected tab changes its `backgroundColor`, measured before and after.
  - [ ] Hovering the **selected** tab produces a measurable change from its idle state.
  - [ ] Hovering a live `.tool-btn` changes its `backgroundColor`; a disabled one does not.
  - [ ] `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' src/renderer/src/styles/app.css` still prints
        nothing.
  - [ ] Screenshots of the title bar and toolbar hovered, in both themes, in `docs/screenshots/`.
- **Files:** `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`
- **Verify:** build, launch, and drive `Input.dispatchMouseEvent` `mouseMoved` onto a tab, the
  selected tab, a title-bar button and a toolbar button in turn, reading `getComputedStyle`
  before and after each; repeat with `prefs.theme` set to `light`.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: measured both rows — a toolbar button's
    hover is a 0.75-to-1.0 alpha lift with a transparent background, and the selected tab's
    hovered and idle styles are identical.

---

### GC-194 The two crumbs open menus and draw nothing that says so

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** Both crumbs in the toolbar are `.crumb.as-button` and both open a real dropdown — the
  repository crumb opens the recents menu and the branch crumb the filtered branch list (GC-044,
  GC-066, GC-096), each anchored to its own bottom-left corner with `owner` set so a second click
  closes it. Neither draws an affordance. Confirmed on 2026-09-06 in the built app: the
  `repository / manyfiles` and `branch / main` crumbs render a caption and a value and no glyph.
  The app already has the vocabulary in two places — `ChevronDown` on the tab bar's recents button
  and on `.pref-select`, and on the split buttons' `.caret-btn` — so these two are the only
  controls in the window that open a menu and stay silent about it.
- **Scope:**
  - A `ChevronDown` on each crumb, through `Icon` from `ui/icons.tsx` like every other icon, sized
    to sit with the crumb's two-line caption/value stack rather than beside a single label.
  - It is part of the button, so it takes the crumb's own hover and disabled colour and never
    becomes a second click target.
  - The chevron must not change where the menu is anchored: the dropdown still hangs off the
    crumb's bottom-left corner, which is what `onRepoMenu` / `onBranchMenu` pass.
  - Check the branch crumb's `.ab-badge`, which already sits after the branch name, so the row
    does not end up with two trailing marks fighting for the same place.
- **Out of scope:** the crumbs' hover treatment (GC-193), the breadcrumb's content, and any change
  to the menus themselves.
- **Acceptance:**
  - [ ] Both crumbs render a chevron, and clicking anywhere on the crumb — chevron included —
        still opens the menu and a second click still closes it.
  - [ ] The menu's top-left corner is still at the crumb's bottom-left, measured against
        `getBoundingClientRect()`.
  - [ ] A branch with an ahead/behind badge still lays out on one line with the chevron.
  - [ ] Screenshot in `docs/screenshots/`.
- **Files:** `src/renderer/src/components/Toolbar.tsx`, `src/renderer/src/styles/app.css`
- **Verify:** build, launch, screenshot the toolbar, then click each crumb over CDP and assert the
  menu opens, its rect lines up with the crumb, and a second click closes it.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: confirmed in the built app that both
    crumbs are `owner`-anchored dropdowns with no glyph, while the same window draws
    `ChevronDown` on three other controls that open something.

---

### GC-195 A scrolling modal puts its scrollbar 17px inside its own border

- **Status:** todo
- **Area:** ui | **Size:** S | **Priority:** P2
- **Depends on:** none
- **Why:** `.modal` carries `padding: var(--sp-4)` and `.modal-body` — the only part that scrolls
  (GC-103) — sits inside that padding, so the 8px scrollbar is drawn 16px in from the modal's
  border. Measured on 2026-09-06 with Preferences open on a 1400x620 window, where the body
  genuinely scrolls (`scrollHeight 802` against `clientHeight 464`): the bar's right edge is
  **17px** from the modal's right edge, and the checkbox column sits **0px** from the bar's left
  edge. So the bar floats in the middle of a gutter with the controls crowded against one side of
  it and dead space on the other, which is what it looks like.
  This is a decision about where a scrollbar belongs in a padded modal, not a colour: either the
  scroll box keeps its own inner padding so the content stops short of the bar, or the body
  scrolls to the modal's edge with the horizontal padding moved onto the body's children. Every
  scrolling modal shares `.modal-body`, so whichever is chosen is one rule — and
  `.modal.shortcuts` and `.modal.auth-error` have to be looked at with it, since both scroll and
  the second holds preformatted text whose own box would move.
- **Scope:**
  - One answer for `.modal-body`, applied once, with a comment saying which of the two shapes was
    chosen and why.
  - The content keeps clear of the scrollbar: no control ends flush against it.
  - A body that does **not** scroll is unchanged — no reserved gutter and no shifted content, so
    an ordinary prompt looks exactly as it does now.
  - `.modal.prefs`, `.modal.shortcuts` and `.modal.auth-error` all checked at a window short
    enough to scroll, and the `h3` and `.modal-buttons` rows still line up with the body's
    content.
- **Out of scope:** the global `::-webkit-scrollbar` treatment, which is deliberate and shared
  (`CLAUDE.md`, Styling), and `.modal`'s own `max-height` (GC-103).
- **Acceptance:**
  - [ ] With Preferences scrolling, the distance from the scrollbar to the nearest control is
        greater than zero and the dead space to its right is gone — both measured.
  - [ ] A prompt whose body does not scroll has its content in exactly the same place as before,
        checked against a screenshot or a measured rect.
  - [ ] The shortcuts dialog and the credential-refusal dialog both scroll correctly, with their
        title and buttons still aligned with the body.
  - [ ] Screenshots of a scrolling and a non-scrolling modal in `docs/screenshots/`.
- **Files:** `src/renderer/src/styles/app.css`
- **Verify:** build, launch, override the viewport to a short height, open each of the three
  modals over CDP and read back the modal's and body's rects, the scrollbar width
  (`offsetWidth - clientWidth`) and the right edge of the nearest control.
- **Log:**
  - 2026-09-06 proposed by GR-024, from Ricardo's inbox: measured the gutter — 17px of dead space
    right of the bar and 0px between the bar and the controls, because `.modal`'s padding is
    outside the scroll box.

---

### GC-196 The detail panel's second design pass: an audit against the study before anything changes

- **Status:** todo
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

---

### GC-197 The staging view's two file lists cannot be collapsed, so Staged is unreachable past 20 files

- **Status:** todo
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

## Reviews

Hourly backlog reviews by the review routine (see "Review routine" above). Review tickets use
`GR-0NN`, never appear on the board, are never picked by the ticket routine and are written
once, as `done`: reviews run regardless of the worker's lock and never take it. Each review
appends its own section here.

### GR-024 Backlog review 2026-09-06 18:35

- **Status:** done
- **Window:** aa593d9..7e75deb
- **Log:**
  - 2026-09-06 18:35 inbox: **six items in Pending**, all six investigated and all six ticketed —
    they are Ricardo's own look at the app after GC-142/GC-143 landed, and five of the six were
    reproduced and measured in the built app rather than only read in the source. Nothing was
    declined, nothing left in Pending, and `INBOX.md` is rewritten at the end of this run with the
    six moved to Handled. Item by item, in the order they were written:
  - inbox 1 (file rows print folder and name as two things) **-> GC-192**. Confirmed and measured:
    `gapPx: 8` between `src/renderer/src/components/` and `DetailPanel.tsx`, which is
    `.file-row`'s own `gap: var(--sp-2)` falling between the two halves of one path. Ricardo asked
    that the file view's header be checked with it: it is **not** affected — `DiffView.tsx` puts
    both spans inside one `.path` span and the measured gap there is `0`. His second point holds
    on both surfaces though: at the 300px panel minimum `.dir` kept its full 170px unclipped while
    `.name` was cut from 83px to 53px, and the file view's `.path` ellipsises the whole run at its
    end, so the filename is what is lost there too. The study is on his side —
    `04-panels.md` line 70 records the two-part treatment and no gap.
  - inbox 2 (the right sidebar wants another design pass) **-> GC-196**, written the way he asked
    for it: the audit is the first deliverable and the code changes follow it, with the acceptance
    box requiring the finding list to precede the first edit in the commit order. Four of the
    findings that same look would produce are carved off as tickets of their own — GC-191,
    GC-192 and GC-197 — so GC-196 is only the judgement call that is left: spacing, the type
    scale, the group heads' weight, the file rows' hover actions and the commit form's
    composition, against `04-panels.md`'s line-by-line description of both views.
  - inbox 3 (the crumbs open menus and draw no chevron) **-> GC-194**. Confirmed in the built app:
    both `.crumb.as-button` controls are `owner`-anchored dropdowns (GC-044, GC-066, GC-096) and
    neither draws a glyph, while the same window draws `ChevronDown` on the recents button,
    `.pref-select` and the split buttons' `.caret-btn`. Filed S/P2 with the anchor and the
    ahead/behind badge named, since the chevron must not move the menu or fight the badge.
  - inbox 4 (the Preferences scrollbar looks bad) **-> GC-195**, and it is exactly the diagnosis he
    gave. Measured with Preferences open on a 1400x620 window, where the body genuinely scrolls
    (`scrollHeight 802` against `clientHeight 464`): the 8px bar's right edge is **17px** from the
    modal's right edge and the checkbox column is **0px** from its left edge. Filed as the
    decision he asked for — a padded scroll box, or the padding moved onto the body's children —
    with `.modal.shortcuts` and `.modal.auth-error` in scope, since both scroll too.
  - inbox 5 (hover on the tabs and the toolbar buttons) **-> GC-193**. Measured, and the stronger
    half of his complaint is the true one: a toolbar button hovers from
    `rgba(255,255,255,0.75)` to `rgb(255,255,255)` with `backgroundColor` staying
    `rgba(0,0,0,0)`, and the **selected** tab's hovered and idle computed styles are identical —
    `rgb(255,255,255)` on `rgb(51,55,63)` both ways — because `.tab.selected` already sets the
    brightest text there is. On his ask to check GitKraken: the study's Row states table puts its
    hover row at `rgba(77,136,255,0.10)`, which is what `--accent-hover` was calibrated against
    and what `.file-row:hover` already uses, but it records **no** hover treatment for
    GitKraken's toolbar icon buttons or its tab strip. So the ticket is written as the app's own
    vocabulary applied consistently, not as a measurement to match, and says so.
  - inbox 6 (the commit title is unreadable with many changed files) **-> GC-191, filed P1**, and it
    is this review's headline. His diagnosis was right and the numbers are worse than the symptom
    he described. On a throwaway repository with a 29-file commit, at 1400x900:
    `.message-box` rendered **12px of clientHeight against a scrollHeight of 160**, and its `h2`
    — the summary alone — wanted **100px** and got 12, which is the one clipped half-line he saw.
    He asked that the staging view be checked with it, and that is where the worse finding is:
    with 29 unstaged files, `.detail-body` measured `scrollHeight 1084` against
    `clientHeight 756` and `.commit-form` sat **entirely below the fold, 328px down** — 201px of
    summary field, description and commit button that cannot be reached without scrolling past
    every changed file. Same cause both times, exactly as he said: `overflow: auto` on a flex item
    gives it an automatic minimum size of zero, so `.message-box` is the only block in
    `.detail-body` that can be crushed and `.file-list`, having no overflow, cannot shrink below
    its rows. The one-line-message case is in the acceptance, since a bare `min-height` would
    break it.
  - shipped: **four commits, two of them code.** `aa593d9` is GR-023, `f848e03` and the current
    `1cfb619` are claims, `1e78e42` is GC-180/181/182/151/150/152 at 27 files and +1197/-54, and
    `7e75deb` is GC-186/185/187/188/159/165 at 24 files and +525/-115. Read as a reviewer, both
    hold up. `CONFLICT_STAGES` in `shared/types.ts` is correct against git's own stage numbering
    for all seven unmerged codes — `AU`/`UD` have stage 2 only, `UA`/`DU` stage 3 only, `DD`
    neither — which is the table an offered-then-failing menu row would come from.
    `resolveConflictWith` runs the `add` only after the checkout resolves, so a half-resolved path
    is not recorded. GC-159's `remoteUrlToWeb` is the sound shape: host-agnostic, `file:` refused
    by name, an `http:` remote keeping its own scheme so an intranet link is not rewritten dead,
    `user@` and an ssh port stripped, and the scp branch refusing a one-character host so a
    Windows drive letter cannot pass as one; `isWebUrl` is one `new URL().protocol` check and both
    channels that can reach `openExternal` ask it, which is the right place for it. No new ticket
    came out of the code-review pass.
  - health: at `7e75deb` in the detached worktree with `node_modules` junctioned — **typecheck ok,
    479 tests passed (25 files)** in 9.44s, **build ok** into the worktree's own `out/`. `MAIN` was
    never built, tested or launched.
  - app: the worktree's build ran offscreen on 9334 against the review's own scratch root, and
    then against a throwaway 29-file repository under `%TEMP%` built for the two inbox items that
    need one. Nine screenshots in `%TEMP%/gitclient-review/GR-024/`, all looked at. `01` is the
    graph, and GC-186's band is there on every row, right of the node, at a tint that reads as the
    lane rather than as a stripe. `02` is a commit, `06` a diff with GC-152's `commit: <sha>`
    sub-header and a live Unified | Split. `04` is the one that carries this review: it shows both
    inbox 1 and inbox 6 in one frame — the folder and filename split by 8px, and the message box
    cut through the middle of its glyphs. `09` is the staging view at 29 files with the commit form
    nowhere on screen. `07` is the **Preferences dialog**, this run's rotation surface, captured
    short enough to scroll for inbox 4; while there I re-checked GR-023's note and
    `.pref-group-title` does carry its `border-bottom`, at `rgba(255,255,255,0.08)`, which is
    faint but present on all four groups.
  - tickets: added **GC-191** (ui, S, P1), **GC-192**, **GC-193**, **GC-194**, **GC-195** (ui, S,
    P2), **GC-196** (ui, M, P2) and **GC-197** (ui, S, P2). Six are the inbox items and do not
    count against the reviewer's own budget; **GC-197 is this review's own**, from the
    what's-next pass: `04-panels.md` line 62 calls the staging view's two lists "collapsible" and
    ours are not, and with 29 unstaged files the Unstaged list measured 788px, putting the Staged
    head — the group you are staging into — below the fold. It is GC-153's answer one panel over.
    Deduplicated against every open row: nothing touches the detail panel's vertical composition,
    the crumbs, the modal gutter or either hover row; GC-183 is the graph's readout and stays
    separate; GC-175 is the light theme's boundaries and is `in-progress`, so GC-193's
    two-theme check is written to respect whatever it lands.
  - board: **GC-191 goes to the very top**, above the two P1s the worker is holding. GC-189's
    hazard has a safe order that works — this run followed it and `MAIN`'s `node_modules` is
    intact at 109 entries with `.bin` present, checked before and after — while GC-191 has no
    workaround at all: the commit form is the app's primary action and it is off the panel. The
    other six rows go into the P2 block under GC-190, ordered by how visible each is with how
    little it costs: GC-192, GC-194, GC-193, GC-195, GC-197, then GC-196, which depends on the
    first two and on GC-197 being carved out of it. Nothing already on the board moved, and no
    `in-progress` row or section was touched.
  - hygiene: `blocked` is GC-017, GC-018 and GC-081, none unblockable from here for the reasons
    GR-022 gave. Six tickets went `in-progress` at `1cfb619` while this review was running
    (GC-189, GC-190, GC-173, GC-166, GC-171, GC-175); the board was re-read immediately before
    this write and every new id is above all of them, so nothing collides. No `todo` has gone
    vague.
  - notes: `CLAUDE.md` at `7e75deb` says "479 tests today", which matched the run exactly, and its
    GC-186 paragraphs — the band right of the node on every row, the connector as a 2px line —
    are current. GR-020's finding about the GC-135 paragraph still stands and is still carried by
    GC-171, now `in-progress`. Flagged here rather than edited; the reviewer never touches
    `CLAUDE.md`.
  - isolation: `MAIN` was never built, tested or launched, and its working tree was left as found;
    this write waited for `TICKETS.md` and `TICKETS-ARCHIVE.md` to be clean and stages only those
    two. The only repositories written to were the review's own scratch root and a throwaway
    29-file repository under `%TEMP%` created for this run; `catena-feed` and `kyushu-route` were
    **not opened**. The review's Electron on 9334 was found by command line and stopped by PID
    tree, leaving nothing on the port; four unrelated `electron.exe` processes belonging to
    another tree were left alone, which is what rule 4 exists for.
