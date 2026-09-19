import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { GitApi, RepoChange, ShellApi } from '@shared/types';

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args);

const api: GitApi = {
  checkGit: call('repo:checkGit'),
  openRepoDialog: call('repo:openDialog'),
  chooseFolder: call('repo:chooseFolder'),
  cloneRepo: call('repo:clone'),
  initRepo: call('repo:init'),
  loadRepo: call('repo:load'),
  getLog: call('repo:log'),
  getFileLog: call('repo:fileLog'),
  getStatus: call('repo:status'),
  watchRepo: call('repo:watch'),
  // The one main -> renderer push (GC-011): it hands back an unsubscribe so a React effect can
  // clean up and a remount cannot stack listeners on the channel.
  onRepoChanged: (listener: (change: RepoChange) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, change: RepoChange): void => listener(change);
    ipcRenderer.on('repo:changed', handler);
    return () => {
      ipcRenderer.off('repo:changed', handler);
    };
  },
  getCommitFiles: call('commit:files'),
  getCommitFileDiff: call('commit:fileDiff'),
  getCompare: call('commit:compare'),
  getCompareFileDiff: call('commit:compareFileDiff'),
  getWorkdirFileDiff: call('workdir:fileDiff'),
  stage: call('workdir:stage'),
  unstage: call('workdir:unstage'),
  stageAll: call('workdir:stageAll'),
  unstageAll: call('workdir:unstageAll'),
  discard: call('workdir:discard'),
  ignore: call('workdir:ignore'),
  resolveConflict: call('workdir:resolveConflict'),
  restoreFile: call('workdir:restoreFile'),
  applyPatch: call('workdir:applyPatch'),
  commit: call('workdir:commit'),
  checkout: call('ref:checkout'),
  createBranch: call('ref:createBranch'),
  deleteBranch: call('ref:deleteBranch'),
  renameBranch: call('ref:renameBranch'),
  deleteRemoteBranch: call('ref:deleteRemoteBranch'),
  merge: call('ref:merge'),
  rebase: call('ref:rebase'),
  cherryPick: call('ref:cherryPick'),
  revert: call('ref:revert'),
  reset: call('ref:reset'),
  abortOperation: call('ref:abortOperation'),
  createTag: call('ref:createTag'),
  deleteTag: call('ref:deleteTag'),
  deleteRemoteTag: call('ref:deleteRemoteTag'),
  fastForward: call('ref:fastForward'),
  setUpstream: call('ref:setUpstream'),
  remoteAdd: call('remote:add'),
  remoteRemove: call('remote:remove'),
  remoteSetUrl: call('remote:setUrl'),
  remoteRename: call('remote:rename'),
  fetch: call('remote:fetch'),
  pull: call('remote:pull'),
  push: call('remote:push'),
  cancelRemote: call('remote:cancel'),
  stashSave: call('stash:save'),
  stashApply: call('stash:apply'),
  stashPop: call('stash:pop'),
  stashDrop: call('stash:drop'),
  stashRename: call('stash:rename'),
};

// Handing a file to the OS is not git, so it gets its own bridge rather than another section of
// `window.api` (GC-043).
const shell: ShellApi = {
  openFile: call('shell:openPath'),
  showInFolder: call('shell:showItemInFolder'),
  openExternal: call('shell:openExternal'),
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('shell', shell);
contextBridge.exposeInMainWorld('platform', process.platform);
