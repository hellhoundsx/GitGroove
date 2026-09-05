# 06 Feature inventory

Derived from the UI string table (5,301 strings in 282 prefix groups). Counts are
the number of strings in that area, a rough proxy for feature size. The last
column is our recommendation for a first version of our own client.

## Core Git client (build)

| Area | Strings | What it covers | Plan |
| --- | --- | --- | --- |
| Graph / GraphHeader / OptionalGraphZone / RefZone | 32 | Commit graph, columns, WIP row, inline branch/tag creation | Build |
| ContextMenu | 167 | Every right-click action on commits, branches, tags, stashes, remotes, tabs, files (see 05) | Build core subset |
| CommitDetailPanel / RightPanel / StagingPanel / UncommittedFileList / FileNode* | 60 | Staging, commit form, commit details, file lists | Build |
| FileViewPanel / FileContentsPanel / CommitDiffSection / DiffImage | 36 | Diff, file, blame, history views, image diff | Build (text diff first) |
| CommitMessage / WorkDirMessageInput | 11 | Summary/description inputs, 72-char hint, templates | Build |
| LeftPanel / RefBar / Ref | 46 | Ref panel sections, filter, solo/hide, ahead/behind | Build |
| Toolbar / PullOptions / BreadCrumbs | 13 | Toolbar actions, pull modes, repo/branch breadcrumb | Build |
| TabsBar / NewTabView | 32 | Multi-repo tabs, new tab page with recent repos | Build (tabs + recents) |
| StatusBar | 11 | Mostly billing warnings | Minimal |
| KeyBinding / KeyBindingHeader | 34 | Shortcut reference dialog | Build |
| UndoRedo | 6 | Undo/redo of git operations via reflog | Later |
| Merge / ConflictsHeader | 27 | Built-in 3-way merge tool | Later |
| Rebasing / PendingInteractiveRebasePanel | 18 | Interactive rebase editor: pick, reword, squash, drop, reorder | Later |
| Stash / StashBar / StashMessage | 19 | Stash create, apply, pop, partial stash | Build |
| Submodule / Worktree / Lfs / SparseCheckout | 158 | Advanced repo features | Later |
| GitFlow | 44 | Gitflow branch helpers | Skip |
| RepoManagement / OpenRepo / InitRepo / CloneRepo / ShallowCloneForm | 119 | Repo management screens | Build open/clone/init |
| FuzzyFinder / CommitSearch / CommitFilter | 79 | Command palette, commit search | Build palette later |
| GeneralPreferences / UIPreferences / CommitPreferences / EditorPreferences / ToolPreferences / GPGPreferences / CLIPreferences / ExperimentalPreferences / NotificationPreferences | 220 | Preferences pages | Build General, UI, Commit, Editor |
| Cli / TerminalContextMenu | 782 | In-app terminal with a rich Git CLI (autocomplete, help) | Later (plain xterm) |
| Theme | 8 | Dark / light only since 11.8 | Build both |
| Timeline / Time / DateTime | 24 | Relative and formatted dates | Build |

## Hosting and collaboration (defer or skip)

| Area | Strings | Notes |
| --- | --- | --- |
| PullRequest* (View, Filter, Panel, Bar, Template, Tooltip, MergeForm, ...) | 240 | PR browsing, review, merge inside the app |
| IssueTracker* / Jira / Trello / IssueViewPanel | 260 | Issue integrations |
| Services / IntegrationView / Authentication / PromptForCreds / Ssh / SSHConfig | 180 | OAuth to GitHub, GitLab, Bitbucket, Azure DevOps, credential prompts |
| FocusView* (Launchpad) | 200 | Cross-repo PR/issue dashboard |
| Workspace* / AddEditWorkspace / WorkspaceRepositories | 170 | Multi-repo workspaces |
| Team* / OrganizationMember / TeamVisibility / ConflictDetection* | 130 | Team features, proactive conflict detection |
| CloudPatch / Patch / CodeSuggest | 80 | Cloud patches, code suggestions |
| Notification* | 90 | In-app notification centre |

## Commercial and platform (skip)

| Area | Strings | Notes |
| --- | --- | --- |
| Registration / Trial / License / Standalone / SelfHostedConfiguration / PurchaseReceipt / Shop / StartUpPromoModal / PrivateRepoOffer | 300 | Accounts, licensing, upsell |
| Ai / AI / GKAIPreferences / AiCommitMessageGeneration | 190 | AI commit messages, explain, recompose |
| Onboarding* / SatisfactionSurvey / Feedback / GitSurveyForm | 90 | First-run tutorials, surveys |
| DeepLink / GKDotDev / Profile / ProfileAccountMenu | 85 | Deep links, profiles |
| Error / ErrorMessage / *Error | 380 | Error strings across all features |

## Context menu actions worth supporting (from the ContextMenu group)

Commit: Checkout this commit, Create branch here, Create tag here, Create annotated
tag here, Cherry pick commit, Revert commit, Reset <branch> to this commit (Soft /
Mixed / Hard with hints), Edit commit message, Squash commit(s), Drop commit(s),
Move commit up/down, Interactive rebase children of this commit, Compare against
working directory, Copy commit sha, Copy link to commit, Create worktree from this
commit, Jump to commit in graph (from detail panel).

Branch: Checkout, Merge X into Y, Rebase X onto Y, Interactive rebase, Fast-forward
X to Y, Push X to..., Push and start a pull request, Set upstream, Rename, Delete
(local, remote, or both), Hide/Show/Solo in graph, Pin to Left, Copy branch name,
Copy link, Create worktree from branch, Start a pull request.

Tag: Checkout the commit at tag, Push tag to remote, Delete locally / from remote /
from all remotes, Annotate, Copy tag name.

Stash: Apply, Pop, Delete, Edit stash message, Share as cloud patch.

Remote: Fetch, Edit, Remove, View on service, Fork on service.

Tabs: Close tab, Close other tabs, Close tabs to the right, Reopen closed tab,
Rename tab, Alias repository, Favorite repository.

Files: Copy file path, Restore file from this commit, Open in external editor,
Show in folder, Ignore file / extension / folder, Stage / unstage / discard (file,
folder, hunk, line), Export changes to patch, Blame, History.
